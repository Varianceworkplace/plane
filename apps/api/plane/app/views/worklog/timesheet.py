# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Time Sheet (sidebar › Time Sheet): time entries one by one, as in Workplace's Time Sheet list.

Whose time a person sees is the same rule as Reports (report.visible_worklogs; with role-based access on,
plane.utils.rbac.AccessProfile.worklog_q("view")):
  * everyone: their own time, always;
  * Project Managers: the people in the teams they lead;
  * in a team, the levels above see the levels below (Senior > Mid-level > Junior; the team's leads see everyone in
    it), never another team's people;
  * HR (Worklogs › View: All) and workspace admins: everyone's.

Dates and times are in the browser's timezone (?tz=, an IANA name; the profile's without it), as the page shows them.
GET filters: ?person= (a person's id, or "all" for everyone the viewer may see; the viewer by default; someone they
may not see is refused), ?project=, ?from_date=&to_date= (YYYY-MM-DD, both inclusive, the viewer's timezone),
?search=, ?page=, ?per_page=.
"""

# Python imports
import csv
import io
import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Django imports
from django.db.models import Q, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.http import HttpResponse
from django.utils.text import slugify

# Third party imports
from openpyxl import Workbook
from openpyxl.styles import Font
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import User, WorkspaceMember

from plane.utils.csv_utils import sanitize_csv_row

from .base import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    _uuid_list,
    format_duration,
    is_project_or_workspace_admin,
    serialize_user,
    worklog_queryset,
)
from .report import (
    MAX_REPORT_DAYS,
    ReportFilterError,
    _parse_date,
    report_scope,
    serialize_report_worklog,
    user_timezone,
    visible_worklogs,
)


def timesheet_timezone(request):
    """The viewer's timezone for dates and times: the browser's (?tz=, as the page shows them), else their profile's."""
    name = (request.GET.get("tz") or "").strip()
    if name:
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return user_timezone(request.user)


def timesheet_people(request, slug, scope, worklogs):
    """The people whose time the viewer may see: None = everyone in the workspace."""
    profile = scope.get("rbac")
    if profile is not None:
        ids = profile.worklog_people_ids()
    else:
        ids = None if scope["is_workspace_admin"] else {request.user.id}
    if ids is None:
        return None
    # plus whoever's time reaches them only through projects (people in no team in a PM's projects, Member scope)
    return ids | set(worklogs.order_by().values_list("logged_by_id", flat=True).distinct())


def timesheet_entries(request, slug):
    """Returns (worklogs, people, person, error_response): the entries the request's filters ask for, out of the ones
    the viewer may see (and their own). `people` is whom they may see (None = everyone), `person` the one asked for
    (an id, or "all"). ?ids= narrows to those entries (an export of the rows picked); ids the viewer may not see
    are simply not there."""
    scope = report_scope(request.user, slug, request)
    worklogs = visible_worklogs(request.user, slug, scope) | worklog_queryset(slug).filter(logged_by_id=request.user.id)
    people = timesheet_people(request, slug, scope, worklogs)

    person = (request.GET.get("person") or "").strip() or str(request.user.id)
    if person != "all":
        try:
            person_id = uuid.UUID(person)
        except ValueError:
            return None, people, person, Response({"person": "Pick a person."}, status=status.HTTP_400_BAD_REQUEST)
        if people is not None and person_id not in people:
            return (
                None,
                people,
                person,
                Response({"error": "You can't see this person's timesheet."}, status=status.HTTP_403_FORBIDDEN),
            )
        worklogs = worklogs.filter(logged_by_id=person_id)

    tz = timesheet_timezone(request)
    worklogs = worklogs.annotate(work_at=Coalesce("started_at", "created_at")).annotate(
        work_date=TruncDate("work_at", tzinfo=tz)
    )
    if "ids" in request.GET:
        worklogs = worklogs.filter(pk__in=_uuid_list(request.GET.get("ids")))
    projects = _uuid_list(request.GET.get("project"))
    if projects:
        worklogs = worklogs.filter(project_id__in=projects)
    try:
        from_date = _parse_date(request.GET.get("from_date"), "from_date")
        to_date = _parse_date(request.GET.get("to_date"), "to_date")
        if from_date and to_date and from_date > to_date:
            raise ReportFilterError({"to_date": "The end date must be on or after the start date."})
        if from_date and to_date and (to_date - from_date).days > MAX_REPORT_DAYS:
            raise ReportFilterError({"to_date": "A timesheet can cover at most two years."})
    except ReportFilterError as error:
        return None, people, person, Response(error.args[0], status=status.HTTP_400_BAD_REQUEST)
    if from_date:
        worklogs = worklogs.filter(work_at__gte=datetime.combine(from_date, time.min, tzinfo=tz))
    if to_date:
        worklogs = worklogs.filter(work_at__lt=datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=tz))
    search = (request.GET.get("search") or "").strip()
    if search:
        worklogs = worklogs.filter(
            Q(issue__name__icontains=search)
            | Q(timesheet_no__icontains=search)
            | Q(description__icontains=search)
            | Q(project__name__icontains=search)
            | Q(project__identifier__icontains=search)
        )
    return worklogs.select_related("issue__state").order_by("-work_at", "-created_at"), people, person, None


class TimesheetEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        worklogs, people, person, error = timesheet_entries(request, slug)
        if error:
            return error
        try:
            per_page = min(max(int(request.GET.get("per_page", DEFAULT_PAGE_SIZE)), 1), MAX_PAGE_SIZE)
            page = max(int(request.GET.get("page", 1)), 1)
        except ValueError:
            per_page, page = DEFAULT_PAGE_SIZE, 1
        totals = worklogs.order_by().aggregate(total=Sum("duration"))
        total_count = worklogs.count()
        offset = (page - 1) * per_page

        if people is None:
            people_rows = User.objects.filter(
                pk__in=WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values("member_id"),
                is_bot=False,
            )
        else:
            people_rows = User.objects.filter(pk__in=people, is_bot=False)
        return Response(
            {
                "results": [serialize_report_worklog(w) for w in worklogs[offset : offset + per_page]],
                "total_count": total_count,
                "total_duration": totals["total"] or 0,
                "page": page,
                "per_page": per_page,
                "person": person,
                # whom the person filter offers: the viewer first, then by name
                "people": sorted(
                    (serialize_user(user) for user in people_rows),
                    key=lambda u: (u["id"] != str(request.user.id), (u["display_name"] or "").lower()),
                ),
                "can_view_others": people is None or len(people) > 1,
            },
            status=status.HTTP_200_OK,
        )


class TimesheetEntryEndpoint(BaseAPIView):
    """One time entry, every detail of it (Time Sheet › an entry), with its date in the viewer's timezone (?tz=).

    Only an entry the list would show the viewer (their own, or of someone they may see); any other is "not found",
    never "forbidden", so nobody learns which entries exist."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, pk):
        scope = report_scope(request.user, slug, request)
        worklogs = visible_worklogs(request.user, slug, scope) | worklog_queryset(slug).filter(
            logged_by_id=request.user.id
        )
        worklog = (
            worklogs.filter(pk=pk)
            .annotate(work_at=Coalesce("started_at", "created_at"))
            .annotate(work_date=TruncDate("work_at", tzinfo=timesheet_timezone(request)))
            .select_related("issue__state")
            .first()
        )
        if worklog is None:
            return Response(
                {"error": "This time entry doesn't exist or you can't see it."}, status=status.HTTP_404_NOT_FOUND
            )
        # Edit / Delete on the page: by the rule the task's worklog endpoints apply (their own time, or an admin of
        # the project or the workspace); those endpoints check it again
        can_manage = worklog.logged_by_id == request.user.id or is_project_or_workspace_admin(
            request.user, slug, worklog.project_id
        )
        return Response({**serialize_report_worklog(worklog), "can_manage": can_manage}, status=status.HTTP_200_OK)


EXPORT_HEADERS = [
    "Timesheet No.",
    "Date Start",
    "Date End",
    "Time Start",
    "Time End",
    "Duration",
    "Hours",
    "Task ID",
    "Project Task",
    "Status",
    "Project",
    "Submitted For",
    "Email",
    "Description",
]


def export_rows(worklogs, tz):
    """The Time Sheet's columns, one row per entry and a total; times in the viewer's timezone."""

    def local(value, fmt):
        return value.astimezone(tz).strftime(fmt) if value else ""

    rows, total = [EXPORT_HEADERS], 0
    for worklog in worklogs:
        total += worklog.duration
        state = worklog.issue.state
        start_date = worklog.work_date.isoformat() if worklog.work_date else ""
        rows.append(
            [
                worklog.timesheet_no,
                start_date,
                # entries logged by hand have no end: they're on their day
                local(worklog.ended_at, "%Y-%m-%d") or start_date,
                local(worklog.started_at, "%I:%M %p"),
                local(worklog.ended_at, "%I:%M %p"),
                format_duration(worklog.duration),
                round(worklog.duration / 60, 2),
                f"{worklog.project.identifier}-{worklog.issue.sequence_id}",
                worklog.issue.name,
                state.name if state else "",
                worklog.project.name,
                worklog.logged_by.display_name,
                worklog.logged_by.email,
                worklog.description,
            ]
        )
    rows.append(["Total", "", "", "", "", format_duration(total), round(total / 60, 2), *[""] * 7])
    return rows


class TimesheetDownloadEndpoint(BaseAPIView):
    """Export Entry: ?type=csv|xlsx with the Time Sheet's filters, and ?ids= for the rows picked (all the filtered
    entries without it). Only entries the viewer may see, as on the page."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        # "type", not "format": DRF reserves ?format= for renderer negotiation
        file_format = request.GET.get("type", "csv")
        if file_format not in ("csv", "xlsx"):
            return Response({"error": "Type must be csv or xlsx."}, status=status.HTTP_400_BAD_REQUEST)
        worklogs, _, person, error = timesheet_entries(request, slug)
        if error:
            return error
        tz = timesheet_timezone(request)
        rows = export_rows(worklogs.select_related("logged_by", "project"), tz)
        if person == "all":
            whose = "everyone"
        elif person == str(request.user.id):
            whose = "mine"
        else:
            whose = slugify(User.objects.filter(pk=person).values_list("display_name", flat=True).first() or "person")
        filename = f"{slug}-timesheet-{whose}-{datetime.now(tz).strftime('%Y%m%d')}"

        if file_format == "xlsx":
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "Time Sheet"
            for row in rows:
                sheet.append(sanitize_csv_row(row))
            for row_index in (1, sheet.max_row):
                for cell in sheet[row_index]:
                    cell.font = Font(bold=True)
            buffer = io.BytesIO()
            workbook.save(buffer)
            response = HttpResponse(
                buffer.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
            response["Content-Disposition"] = f'attachment; filename="{filename}.xlsx"'
            return response

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
        writer = csv.writer(response)
        for row in rows:
            writer.writerow(sanitize_csv_row(row))
        return response


__all__ = ["TimesheetDownloadEndpoint", "TimesheetEndpoint", "TimesheetEntryEndpoint"]
