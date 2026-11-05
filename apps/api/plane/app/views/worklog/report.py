# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Worklog reports (Reports > Project-wise / User-wise).

  * Totals of logged time per user and project, a month-wise breakdown per user > project > work item,
    a date-wise drill-down and CSV / Excel export.
  * Who sees what:
      - workspace admins: every worklog in the workspace
      - project admins: every worklog in the projects they administer
      - project members: only the time they logged themselves
      - guests: nothing
  * Filters: ?project=&logged_by=&issue=&state_group=&state= (comma separated) and ?from_date=&to_date= (YYYY-MM-DD,
    both inclusive, in the requesting user's timezone). ?team= (departments), ?pm= (the teams a project manager
    leads) and ?group= (member groups) narrow to the people in them, together with ?logged_by=. The date is when the
    work started (timer entries) or when it was logged (manual entries).
  * ?group_by=work_item lists worklogs work item by work item (newest first within each) instead of newest first.
"""

# Python imports
import csv
import io
import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

# Django imports
from django.db.models import Count, DateField, Q, Sum
from django.db.models.functions import Coalesce, TruncDate, TruncMonth
from django.http import HttpResponse

# Third party imports
from openpyxl import Workbook
from openpyxl.styles import Font
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    Issue,
    IssueAssignee,
    MemberGroupMember,
    Project,
    ProjectMember,
    StateGroup,
    TeamMember,
    User,
    WorkspaceMember,
)
from plane.utils.csv_utils import sanitize_csv_row
from plane.utils.rbac import rbac_profile

from .base import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    _uuid_list,
    format_duration,
    serialize_user,
    serialize_worklog,
    worklog_queryset,
)

# Longest range a report covers, so a typo in the year can't scan years of data
MAX_REPORT_DAYS = 366 * 2
REPORT_STATE_GROUPS = [group.value for group in StateGroup if group != StateGroup.TRIAGE]


class ReportFilterError(Exception):
    pass


def user_timezone(user):
    try:
        return ZoneInfo(user.user_timezone or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def report_scope(user, slug, request=None):
    """What the user may see: {"is_workspace_admin", "admin_project_ids", "member_project_ids", "rbac"}.

    With role-based access on, "rbac" holds the person's AccessProfile and its Worklogs scope decides instead.
    """
    is_workspace_admin = WorkspaceMember.objects.filter(
        member=user, workspace__slug=slug, role=ROLE.ADMIN.value, is_active=True
    ).exists()
    admin_project_ids, member_project_ids = set(), set()
    for project_id, role in ProjectMember.objects.filter(
        member=user,
        workspace__slug=slug,
        is_active=True,
        role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
    ).values_list("project_id", "role"):
        (admin_project_ids if role == ROLE.ADMIN.value else member_project_ids).add(project_id)
    return {
        "is_workspace_admin": is_workspace_admin,
        "admin_project_ids": admin_project_ids,
        "member_project_ids": member_project_ids,
        "rbac": rbac_profile(request, slug) if request is not None else None,
    }


def visible_worklogs(user, slug, scope):
    worklogs = worklog_queryset(slug)
    if scope.get("rbac") is not None:
        return worklogs.filter(scope["rbac"].worklog_q("view"))
    if scope["is_workspace_admin"]:
        return worklogs
    return worklogs.filter(
        Q(project_id__in=scope["admin_project_ids"])
        | Q(project_id__in=scope["member_project_ids"], logged_by_id=user.id)
    )


def report_people(request, slug):
    """The people ?logged_by=, ?team=, ?pm= and ?group= narrow a report to (all of them that are given), or None."""
    sets = []
    users = _uuid_list(request.GET.get("logged_by"))
    if users:
        sets.append(set(users))
    teams = _uuid_list(request.GET.get("team"))
    if teams:
        sets.append(
            set(TeamMember.objects.filter(workspace__slug=slug, team_id__in=teams).values_list("member_id", flat=True))
        )
    managers = _uuid_list(request.GET.get("pm"))
    if managers:
        led = TeamMember.objects.filter(workspace__slug=slug, member_id__in=managers, is_lead=True).values("team_id")
        sets.append(
            set(TeamMember.objects.filter(workspace__slug=slug, team_id__in=led).values_list("member_id", flat=True))
        )
    groups = _uuid_list(request.GET.get("group"))
    if groups:
        sets.append(
            set(
                MemberGroupMember.objects.filter(workspace__slug=slug, group_id__in=groups).values_list(
                    "member_id", flat=True
                )
            )
        )
    if not sets:
        return None
    return set.intersection(*sets)


def _parse_date(value, field):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ReportFilterError({field: "Use the YYYY-MM-DD format."})


def report_worklogs(request, slug, scope):
    """Visible worklogs narrowed by the request's filters, annotated with `work_at` and `work_date`.

    Raises ReportFilterError for filters that can't be applied.
    """
    tz = user_timezone(request.user)
    worklogs = (
        visible_worklogs(request.user, slug, scope)
        .select_related("issue__state")
        .annotate(work_at=Coalesce("started_at", "created_at"))
        .annotate(work_date=TruncDate("work_at", tzinfo=tz))
    )

    projects = _uuid_list(request.GET.get("project"))
    if projects:
        worklogs = worklogs.filter(project_id__in=projects)
    people = report_people(request, slug)
    if people is not None:
        worklogs = worklogs.filter(logged_by_id__in=people)
    issues = _uuid_list(request.GET.get("issue"))
    if issues:
        worklogs = worklogs.filter(issue_id__in=issues)
    states = _uuid_list(request.GET.get("state"))
    if states:
        worklogs = worklogs.filter(issue__state_id__in=states)
    groups = [g.strip() for g in (request.GET.get("state_group") or "").split(",") if g.strip()]
    if groups:
        unknown = [g for g in groups if g not in REPORT_STATE_GROUPS]
        if unknown:
            raise ReportFilterError({"state_group": f"Unknown status group: {', '.join(unknown)}."})
        worklogs = worklogs.filter(issue__state__group__in=groups)

    from_date = _parse_date(request.GET.get("from_date"), "from_date")
    to_date = _parse_date(request.GET.get("to_date"), "to_date")
    if from_date and to_date:
        if from_date > to_date:
            raise ReportFilterError({"to_date": "The end date must be on or after the start date."})
        if (to_date - from_date).days > MAX_REPORT_DAYS:
            raise ReportFilterError({"to_date": "A report can cover at most two years."})
    if from_date:
        worklogs = worklogs.filter(work_at__gte=datetime.combine(from_date, time.min, tzinfo=tz))
    if to_date:
        worklogs = worklogs.filter(work_at__lt=datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=tz))

    group_by = request.GET.get("group_by") or ""
    if group_by not in ("", "work_item"):
        raise ReportFilterError({"group_by": "Group by work_item, or leave it out."})
    if group_by == "work_item":
        # one work item after the other, newest entries first within each
        return worklogs.order_by("project__identifier", "issue__sequence_id", "-work_at", "-created_at")
    return worklogs.order_by("-work_at", "-created_at")


def serialize_scope(scope):
    profile = scope.get("rbac")
    if profile is not None:
        scopes = profile.scopes("worklogs", "view")
        return {
            "is_workspace_admin": "all" in scopes,
            # anything wider than "own" reaches other people's time
            "can_view_others": bool(scopes - {"own"}),
            "admin_project_ids": sorted(str(pk) for pk in profile.team_project_ids("edit")),
        }
    return {
        "is_workspace_admin": scope["is_workspace_admin"],
        # project admins and workspace admins can report on other people's time
        "can_view_others": scope["is_workspace_admin"] or bool(scope["admin_project_ids"]),
        "admin_project_ids": sorted(str(pk) for pk in scope["admin_project_ids"]),
    }


def build_summary(worklogs):
    """Totals per user and per project, plus each user's split across projects."""
    rows = list(
        worklogs.order_by()
        .values("logged_by_id", "project_id")
        .annotate(total_duration=Sum("duration"), worklog_count=Count("id"))
    )
    users = {u.id: u for u in User.objects.filter(id__in={r["logged_by_id"] for r in rows})}
    projects = Project.all_objects.filter(id__in={r["project_id"] for r in rows}).only("id", "name", "identifier")
    projects = {p.id: p for p in projects}

    user_totals, project_totals = {}, {}
    for row in rows:
        user = user_totals.setdefault(
            row["logged_by_id"],
            {**serialize_user(users[row["logged_by_id"]]), "total_duration": 0, "worklog_count": 0, "projects": []},
        )
        user["total_duration"] += row["total_duration"]
        user["worklog_count"] += row["worklog_count"]
        user["projects"].append(
            {
                "id": str(row["project_id"]),
                "total_duration": row["total_duration"],
                "worklog_count": row["worklog_count"],
            }
        )
        project = project_totals.setdefault(
            row["project_id"],
            {
                "id": str(row["project_id"]),
                "name": projects[row["project_id"]].name,
                "identifier": projects[row["project_id"]].identifier,
                "total_duration": 0,
                "worklog_count": 0,
            },
        )
        project["total_duration"] += row["total_duration"]
        project["worklog_count"] += row["worklog_count"]

    def by_total(item):
        return (-item["total_duration"], (item.get("display_name") or item.get("name") or "").lower())

    user_list = sorted(user_totals.values(), key=by_total)
    for user in user_list:
        user["projects"].sort(key=lambda p: -p["total_duration"])
    return {
        "total_duration": sum(u["total_duration"] for u in user_list),
        "total_count": sum(u["worklog_count"] for u in user_list),
        "users": user_list,
        "projects": sorted(project_totals.values(), key=by_total),
    }


def month_keys(first, last):
    """ "YYYY-MM" for every month from `first` to `last` (dates), both included."""
    keys, year, month = [], first.year, first.month
    while (year, month) <= (last.year, last.month):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return keys


def build_monthly(worklogs, tz, from_date=None, to_date=None):
    """Minutes per month for each user > project > work item, plus the month totals.

    The months run from the filter's dates; an open end falls back to the first / last month with time.
    """
    rows = list(
        worklogs.order_by()
        .annotate(month=TruncMonth("work_at", tzinfo=tz, output_field=DateField()))
        .values("logged_by_id", "project_id", "issue_id", "month")
        .annotate(total_duration=Sum("duration"), worklog_count=Count("id"))
    )
    users = {u.id: u for u in User.objects.filter(id__in={r["logged_by_id"] for r in rows})}
    projects = Project.all_objects.filter(id__in={r["project_id"] for r in rows}).only("id", "name", "identifier")
    projects = {p.id: p for p in projects}
    issues = Issue.all_objects.filter(id__in={r["issue_id"] for r in rows}).only("id", "name", "sequence_id")
    issues = {i.id: i for i in issues}

    def node(**fields):
        return {**fields, "total_duration": 0, "worklog_count": 0, "months": {}}

    def add(target, month, row):
        target["total_duration"] += row["total_duration"]
        target["worklog_count"] += row["worklog_count"]
        target["months"][month] = target["months"].get(month, 0) + row["total_duration"]

    tree, month_totals = {}, {}
    for row in rows:
        month = row["month"].strftime("%Y-%m")
        month_totals[month] = month_totals.get(month, 0) + row["total_duration"]
        user = tree.setdefault(row["logged_by_id"], node(**serialize_user(users[row["logged_by_id"]]), projects={}))
        project = projects[row["project_id"]]
        project_node = user["projects"].setdefault(
            row["project_id"], node(id=str(project.id), name=project.name, identifier=project.identifier, issues={})
        )
        issue = issues[row["issue_id"]]
        issue_node = project_node["issues"].setdefault(
            row["issue_id"], node(id=str(issue.id), name=issue.name, sequence_id=issue.sequence_id)
        )
        for target in (user, project_node, issue_node):
            add(target, month, row)

    def most_first(items):
        return sorted(
            items, key=lambda item: (-item["total_duration"], (item.get("display_name") or item["name"]).lower())
        )

    user_list = most_first(tree.values())
    for user in user_list:
        user["projects"] = most_first(user["projects"].values())
        for project in user["projects"]:
            project["issues"] = most_first(project["issues"].values())

    first = from_date or (min(r["month"] for r in rows) if rows else None)
    last = to_date or (max(r["month"] for r in rows) if rows else None)
    return {
        "months": month_keys(first, last) if first and last else [],
        "month_totals": month_totals,
        "total_duration": sum(u["total_duration"] for u in user_list),
        "total_count": sum(u["worklog_count"] for u in user_list),
        "users": user_list,
    }


def month_label(key):
    return date(int(key[:4]), int(key[5:]), 1).strftime("%b %Y")


def serialize_report_worklog(worklog):
    state = worklog.issue.state
    return {
        **serialize_worklog(worklog),
        "work_date": worklog.work_date.isoformat() if worklog.work_date else None,
        "state": (
            {"id": str(state.id), "name": state.name, "group": state.group, "color": state.color} if state else None
        ),
    }


class ReportBaseEndpoint(BaseAPIView):
    def report(self, request, slug):
        """Returns (scope, worklogs, error_response)."""
        scope = report_scope(request.user, slug, request)
        try:
            return scope, report_worklogs(request, slug, scope), None
        except ReportFilterError as error:
            return scope, None, Response(error.args[0], status=status.HTTP_400_BAD_REQUEST)

    def monthly(self, request, worklogs):
        # the dates were validated by report()
        return build_monthly(
            worklogs,
            user_timezone(request.user),
            _parse_date(request.GET.get("from_date"), "from_date"),
            _parse_date(request.GET.get("to_date"), "to_date"),
        )


class WorkLogReportEndpoint(ReportBaseEndpoint):
    """Totals for the charts: per user, per project and user x project."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        scope, worklogs, error = self.report(request, slug)
        if error:
            return error
        return Response({**build_summary(worklogs), "scope": serialize_scope(scope)}, status=status.HTTP_200_OK)


class WorkLogReportMonthlyEndpoint(ReportBaseEndpoint):
    """Month-wise hours per user > project > work item."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        scope, worklogs, error = self.report(request, slug)
        if error:
            return error
        return Response({**self.monthly(request, worklogs), "scope": serialize_scope(scope)}, status=status.HTTP_200_OK)


# ?ordering= keys of the worklog list, and what they sort on
DETAIL_SORTS = {
    "work_date": "work_at",
    "duration": "duration",
    "user": "logged_by__display_name",
    "project": "project__identifier",
    "task": "issue__name",
    "status": "issue__state__name",
}


class WorkLogReportDetailEndpoint(ReportBaseEndpoint):
    """Date-wise worklogs behind a chart bar (usually filtered to one user), or a project's worklogs.

    ?search= matches the work item, the description, the person and the project; ?ordering= sorts by one of
    DETAIL_SORTS (prefix - for descending). Each worklog carries its work item's assignees.

    With ?group_by=work_item the page lists one work item after the other, and `work_items` carries each work
    item's totals over every page, so a group split across pages still shows its full total.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        _, worklogs, error = self.report(request, slug)
        if error:
            return error
        search = (request.GET.get("search") or "").strip()
        if search:
            worklogs = worklogs.filter(
                Q(issue__name__icontains=search)
                | Q(description__icontains=search)
                | Q(logged_by__display_name__icontains=search)
                | Q(logged_by__first_name__icontains=search)
                | Q(logged_by__last_name__icontains=search)
                | Q(project__name__icontains=search)
                | Q(project__identifier__icontains=search)
            )
        ordering = request.GET.get("ordering") or ""
        if ordering:
            field = DETAIL_SORTS.get(ordering.removeprefix("-"))
            if not field:
                return Response(
                    {"ordering": f"Sort by one of: {', '.join(DETAIL_SORTS)} (prefix - for descending)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            direction = "-" if ordering.startswith("-") else ""
            worklogs = worklogs.order_by(f"{direction}{field}", "-work_at", "-created_at")
        try:
            per_page = min(max(int(request.GET.get("per_page", DEFAULT_PAGE_SIZE)), 1), MAX_PAGE_SIZE)
            page = max(int(request.GET.get("page", 1)), 1)
        except ValueError:
            per_page, page = DEFAULT_PAGE_SIZE, 1

        days = [
            {
                "date": day["work_date"].isoformat(),
                "total_duration": day["total_duration"],
                "worklog_count": day["worklog_count"],
            }
            for day in worklogs.order_by()
            .values("work_date")
            .annotate(total_duration=Sum("duration"), worklog_count=Count("id"))
            .order_by("-work_date")
        ]
        offset = (page - 1) * per_page
        page_worklogs = list(worklogs[offset : offset + per_page])
        assignees = {}
        for row in IssueAssignee.objects.filter(issue_id__in={w.issue_id for w in page_worklogs}).select_related(
            "assignee"
        ):
            assignees.setdefault(row.issue_id, []).append(serialize_user(row.assignee))
        body = {
            "results": [
                {**serialize_report_worklog(w), "assignees": assignees.get(w.issue_id, [])} for w in page_worklogs
            ],
            "days": days,
            "total_count": sum(d["worklog_count"] for d in days),
            "total_duration": sum(d["total_duration"] for d in days),
            "page": page,
            "per_page": per_page,
        }
        if request.GET.get("group_by") == "work_item":
            body["work_items"] = [
                {
                    "id": str(row["issue_id"]),
                    "total_duration": row["total_duration"],
                    "worklog_count": row["worklog_count"],
                }
                for row in worklogs.order_by()
                .values("issue_id")
                .annotate(total_duration=Sum("duration"), worklog_count=Count("id"))
            ]
        return Response(body, status=status.HTTP_200_OK)


class WorkLogReportDownloadEndpoint(ReportBaseEndpoint):
    """?type=csv|xlsx&view=summary|monthly|worklogs|analytics (with ?period= for analytics).

    CSV carries the requested view (analytics: every table one after the other); Excel files add the report
    analytics (tasks, people, projects, departments, milestones, tickets) and the worklogs behind it as more sheets.
    """

    WORKLOG_HEADERS = [
        "Date",
        "Project",
        "Work item ID",
        "Work item",
        "Status",
        "Logged by",
        "Email",
        "Start time",
        "End time",
        "Time",
        "Hours",
        "Description",
    ]

    def summary_rows(self, summary):
        projects = summary["projects"]
        rows = [["User", "Email", *[p["name"] for p in projects], "Total hours", "Total time"]]
        emails = dict(User.objects.filter(id__in=[u["id"] for u in summary["users"]]).values_list("id", "email"))
        for user in summary["users"]:
            per_project = {p["id"]: p["total_duration"] for p in user["projects"]}
            rows.append(
                [
                    user["display_name"],
                    emails.get(uuid.UUID(user["id"]), ""),
                    *[round(per_project.get(p["id"], 0) / 60, 2) for p in projects],
                    round(user["total_duration"] / 60, 2),
                    format_duration(user["total_duration"]),
                ]
            )
        rows.append(
            [
                "Total",
                "",
                *[round(p["total_duration"] / 60, 2) for p in projects],
                round(summary["total_duration"] / 60, 2),
                format_duration(summary["total_duration"]),
            ]
        )
        return rows

    def monthly_rows(self, monthly):
        months = monthly["months"]

        def hours(minutes_by_month):
            return [round(minutes_by_month.get(m, 0) / 60, 2) for m in months]

        rows = [["User", "Project", "Work item ID", "Work item", *[month_label(m) for m in months], "Total hours"]]
        for user in monthly["users"]:
            for project in user["projects"]:
                for issue in project["issues"]:
                    rows.append(
                        [
                            user["display_name"],
                            project["name"],
                            f"{project['identifier']}-{issue['sequence_id']}",
                            issue["name"],
                            *hours(issue["months"]),
                            round(issue["total_duration"] / 60, 2),
                        ]
                    )
            rows.append(
                [user["display_name"], "Total", "", "", *hours(user["months"]), round(user["total_duration"] / 60, 2)]
            )
        rows.append(["Total", "", "", "", *hours(monthly["month_totals"]), round(monthly["total_duration"] / 60, 2)])
        return rows

    def worklog_rows(self, worklogs, tz):
        def local(value, fmt):
            return value.astimezone(tz).strftime(fmt) if value else ""

        rows, total = [self.WORKLOG_HEADERS], 0
        for worklog in worklogs:
            total += worklog.duration
            state = worklog.issue.state
            rows.append(
                [
                    worklog.work_date.isoformat() if worklog.work_date else "",
                    worklog.project.name,
                    f"{worklog.project.identifier}-{worklog.issue.sequence_id}",
                    worklog.issue.name,
                    state.name if state else "",
                    worklog.logged_by.display_name,
                    worklog.logged_by.email,
                    local(worklog.started_at, "%H:%M"),
                    local(worklog.ended_at, "%H:%M"),
                    format_duration(worklog.duration),
                    round(worklog.duration / 60, 2),
                    worklog.description,
                ]
            )
        rows.append(["Total", "", "", "", "", "", "", "", "", format_duration(total), round(total / 60, 2), ""])
        return rows

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        # "type", not "format": DRF reserves ?format= for renderer negotiation
        file_format = request.GET.get("type", "csv")
        if file_format not in ("csv", "xlsx"):
            return Response({"error": "Type must be csv or xlsx."}, status=status.HTTP_400_BAD_REQUEST)
        view = request.GET.get("view", "summary")
        if view not in ("summary", "monthly", "worklogs", "analytics"):
            return Response(
                {"error": "View must be summary, monthly, worklogs or analytics."}, status=status.HTTP_400_BAD_REQUEST
            )
        # analytics builds on this module's report filters, so it's imported here
        from .analytics import PERIODS, analytics_sheets, build_analytics

        period = request.GET.get("period") or None
        if period is not None and period not in PERIODS:
            return Response({"period": f"Use one of: {', '.join(PERIODS)}."}, status=status.HTTP_400_BAD_REQUEST)
        scope, worklogs, error = self.report(request, slug)
        if error:
            return error

        tz = user_timezone(request.user)
        sheets = {}
        if view == "monthly":
            sheets["Monthly"] = self.monthly_rows(self.monthly(request, worklogs))
        elif view != "analytics" and (file_format == "xlsx" or view == "summary"):
            sheets["Summary"] = self.summary_rows(build_summary(worklogs))
        analytics = {}
        if view == "analytics" or (file_format == "xlsx" and view in ("summary", "monthly")):
            report_period = period or ("month" if view == "monthly" else None)
            analytics = analytics_sheets(build_analytics(request, slug, scope, worklogs, report_period))
            sheets.update(analytics)
        if file_format == "xlsx" or view == "worklogs":
            sheets["Worklogs"] = self.worklog_rows(worklogs, tz)

        filename = f"{slug}-worklog-report-{datetime.now(tz).strftime('%Y%m%d')}"
        if file_format == "xlsx":
            workbook = Workbook()
            workbook.remove(workbook.active)
            for title, rows in sheets.items():
                sheet = workbook.create_sheet(title)
                for row in rows:
                    sheet.append(sanitize_csv_row(row))
                # header, plus totals and per-user subtotals outside the analytics tables
                for row in sheet.iter_rows():
                    with_totals = title not in analytics and (row[0].row == sheet.max_row or row[1].value == "Total")
                    if row[0].row == 1 or with_totals:
                        for cell in row:
                            cell.font = Font(bold=True)
            buffer = io.BytesIO()
            workbook.save(buffer)
            response = HttpResponse(
                buffer.getvalue(),
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            response["Content-Disposition"] = f'attachment; filename="{filename}.xlsx"'
            return response

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{filename}-{view}.csv"'
        writer = csv.writer(response)
        if view == "analytics":
            for title, rows in analytics.items():
                writer.writerow([title])
                for row in rows:
                    writer.writerow(sanitize_csv_row(row))
                writer.writerow([])
            return response
        for row in next(iter(sheets.values())):
            writer.writerow(sanitize_csv_row(row))
        return response


__all__ = [
    "WorkLogReportEndpoint",
    "WorkLogReportMonthlyEndpoint",
    "WorkLogReportDetailEndpoint",
    "WorkLogReportDownloadEndpoint",
]
