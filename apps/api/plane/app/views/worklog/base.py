# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Time tracking (worklogs).

  * A project admin turns time tracking on per project (Project.is_time_tracking_enabled).
  * Project admins and members log time on work items of that project.
  * A worklog can be edited or deleted by the member who logged it, a project admin or a workspace admin.
  * Workspace admins review and download every worklog in the workspace (Settings > Worklogs).
  * Members can also start / stop a timer on a work item: one timer per member per workspace. Stopping
    freezes the end time; saving it (with a note) turns it into a worklog with start and end times.
"""

# Python imports
import csv
import io
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime

# Third party imports
from openpyxl import Workbook
from openpyxl.styles import Font
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    MAX_WORKLOG_DURATION,
    Issue,
    IssueWorkLog,
    IssueWorkLogTimer,
    Project,
    ProjectMember,
    WorkspaceMember,
)
from plane.utils.csv_utils import sanitize_csv_row

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


def format_duration(minutes):
    hours, mins = divmod(int(minutes or 0), 60)
    if hours and mins:
        return f"{hours}h {mins}m"
    if hours:
        return f"{hours}h"
    return f"{mins}m"


def serialize_user(user):
    return {
        "id": str(user.id),
        "display_name": user.display_name,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "avatar_url": user.avatar_url,
    }


def serialize_worklog(worklog):
    issue = worklog.issue
    project = worklog.project
    return {
        "id": str(worklog.id),
        "duration": worklog.duration,
        "description": worklog.description,
        "logged_by": serialize_user(worklog.logged_by),
        "issue": {
            "id": str(issue.id),
            "name": issue.name,
            "sequence_id": issue.sequence_id,
        },
        "project": {
            "id": str(project.id),
            "name": project.name,
            "identifier": project.identifier,
        },
        "started_at": worklog.started_at,
        "ended_at": worklog.ended_at,
        "created_at": worklog.created_at,
        "updated_at": worklog.updated_at,
    }


def parse_worklog_payload(data, partial=False):
    """Returns (cleaned_data, errors)."""
    cleaned, errors = {}, {}
    if "duration" in data or not partial:
        try:
            duration = int(data.get("duration"))
        except (TypeError, ValueError):
            duration = None
        if duration is None or duration < 1:
            errors["duration"] = "Enter a time greater than zero."
        elif duration > MAX_WORKLOG_DURATION:
            errors["duration"] = "A single entry can't be longer than 999h 59m."
        else:
            cleaned["duration"] = duration
    if "description" in data or not partial:
        description = data.get("description") or ""
        if not isinstance(description, str):
            errors["description"] = "Description must be text."
        else:
            cleaned["description"] = description.strip()
    return cleaned, errors


def is_project_or_workspace_admin(user, slug, project_id):
    return (
        ProjectMember.objects.filter(
            member=user, workspace__slug=slug, project_id=project_id, role=ROLE.ADMIN.value, is_active=True
        ).exists()
        or WorkspaceMember.objects.filter(
            member=user, workspace__slug=slug, role=ROLE.ADMIN.value, is_active=True
        ).exists()
    )


def worklog_queryset(slug):
    return (
        IssueWorkLog.objects.filter(
            workspace__slug=slug,
            project__is_ticket_project=False,
            project__deleted_at__isnull=True,
            issue__deleted_at__isnull=True,
        )
        .select_related("issue", "project", "logged_by")
        .order_by("-created_at")
    )


# ---------------------------------------------------------------- work item worklogs


class IssueWorkLogEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        worklogs = worklog_queryset(slug).filter(project_id=project_id, issue_id=issue_id)
        return Response([serialize_worklog(w) for w in worklogs], status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        project = Project.objects.filter(pk=project_id, workspace__slug=slug, archived_at__isnull=True).first()
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_time_tracking_enabled:
            return Response(
                {"error": "Time tracking is turned off for this project."}, status=status.HTTP_400_BAD_REQUEST
            )
        issue = Issue.objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()
        if not issue:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)

        data, errors = parse_worklog_payload(request.data)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        worklog = IssueWorkLog.objects.create(project=project, issue=issue, logged_by=request.user, **data)
        worklog = worklog_queryset(slug).get(pk=worklog.pk)
        return Response(serialize_worklog(worklog), status=status.HTTP_201_CREATED)


class IssueWorkLogDetailEndpoint(BaseAPIView):
    def get_worklog(self, request, slug, project_id, issue_id, pk):
        """Returns (worklog, error_response)."""
        worklog = worklog_queryset(slug).filter(project_id=project_id, issue_id=issue_id, pk=pk).first()
        if not worklog:
            return None, Response({"error": "Worklog not found."}, status=status.HTTP_404_NOT_FOUND)
        if worklog.logged_by_id != request.user.id and not is_project_or_workspace_admin(
            request.user, slug, project_id
        ):
            return None, Response(
                {"error": "You can only change time you logged yourself."}, status=status.HTTP_403_FORBIDDEN
            )
        return worklog, None

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, issue_id, pk):
        worklog, error = self.get_worklog(request, slug, project_id, issue_id, pk)
        if error:
            return error
        data, errors = parse_worklog_payload(request.data, partial=True)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        for key, value in data.items():
            setattr(worklog, key, value)
        # keep a timer entry consistent: the end moves with the edited total
        if "duration" in data and worklog.started_at:
            worklog.ended_at = worklog.started_at + timedelta(minutes=worklog.duration)
        worklog.save()
        return Response(serialize_worklog(worklog), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, issue_id, pk):
        worklog, error = self.get_worklog(request, slug, project_id, issue_id, pk)
        if error:
            return error
        worklog.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- workspace worklogs (Settings > Worklogs)


def _uuid_list(value):
    result = []
    for item in (value or "").split(","):
        try:
            result.append(uuid.UUID(item.strip()))
        except ValueError:
            continue
    return result


def filtered_workspace_worklogs(request, slug):
    """Applies ?logged_by=&project=&start=&end= (start / end are ISO datetimes, end exclusive)."""
    worklogs = worklog_queryset(slug)
    users = _uuid_list(request.GET.get("logged_by"))
    if users:
        worklogs = worklogs.filter(logged_by_id__in=users)
    projects = _uuid_list(request.GET.get("project"))
    if projects:
        worklogs = worklogs.filter(project_id__in=projects)
    start = parse_datetime(request.GET.get("start") or "")
    if start:
        worklogs = worklogs.filter(created_at__gte=start)
    end = parse_datetime(request.GET.get("end") or "")
    if end:
        worklogs = worklogs.filter(created_at__lt=end)
    return worklogs


class WorkspaceWorkLogEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        worklogs = filtered_workspace_worklogs(request, slug)
        try:
            per_page = min(max(int(request.GET.get("per_page", DEFAULT_PAGE_SIZE)), 1), MAX_PAGE_SIZE)
            page = max(int(request.GET.get("page", 1)), 1)
        except ValueError:
            per_page, page = DEFAULT_PAGE_SIZE, 1
        total_count = worklogs.count()
        total_duration = worklogs.aggregate(total=Sum("duration"))["total"] or 0
        offset = (page - 1) * per_page
        return Response(
            {
                "results": [serialize_worklog(w) for w in worklogs[offset : offset + per_page]],
                "total_count": total_count,
                "total_duration": total_duration,
                "page": page,
                "per_page": per_page,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceWorkLogDownloadEndpoint(BaseAPIView):
    HEADERS = [
        "Project",
        "Work item ID",
        "Work item",
        "Logged by",
        "Email",
        "Date",
        "Start time",
        "End time",
        "Time",
        "Duration (minutes)",
        "Hours",
        "Description",
    ]

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        # "type", not "format": DRF reserves ?format= for renderer negotiation
        file_format = request.GET.get("type", "csv")
        if file_format not in ("csv", "xlsx"):
            return Response({"error": "Type must be csv or xlsx."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            tz = ZoneInfo(request.user.user_timezone or "UTC")
        except Exception:
            tz = ZoneInfo("UTC")

        def local(value, fmt):
            return value.astimezone(tz).strftime(fmt) if value else ""

        rows = []
        for worklog in filtered_workspace_worklogs(request, slug).select_related("logged_by"):
            rows.append(
                [
                    worklog.project.name,
                    f"{worklog.project.identifier}-{worklog.issue.sequence_id}",
                    worklog.issue.name,
                    worklog.logged_by.display_name,
                    worklog.logged_by.email,
                    local(worklog.started_at or worklog.created_at, "%Y-%m-%d"),
                    local(worklog.started_at, "%H:%M"),
                    local(worklog.ended_at, "%H:%M"),
                    format_duration(worklog.duration),
                    worklog.duration,
                    round(worklog.duration / 60, 2),
                    worklog.description,
                ]
            )

        filename = f"{slug}-worklogs-{datetime.now(tz).strftime('%Y%m%d')}"
        if file_format == "xlsx":
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "Worklogs"
            sheet.append(self.HEADERS)
            for cell in sheet[1]:
                cell.font = Font(bold=True)
            for row in rows:
                sheet.append(sanitize_csv_row(row))
            buffer = io.BytesIO()
            workbook.save(buffer)
            response = HttpResponse(
                buffer.getvalue(),
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            response["Content-Disposition"] = f'attachment; filename="{filename}.xlsx"'
            return response

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
        writer = csv.writer(response)
        writer.writerow(self.HEADERS)
        for row in rows:
            writer.writerow(sanitize_csv_row(row))
        return response


# ---------------------------------------------------------------- start / stop timer


def timer_minutes(timer, now=None):
    """Whole minutes between start and stop (or now), rounded, at least one."""
    end = timer.stopped_at or now or timezone.now()
    seconds = max((end - timer.started_at).total_seconds(), 0)
    return max(1, int(seconds / 60 + 0.5))


def serialize_timer(timer):
    now = timezone.now()
    end = timer.stopped_at or now
    return {
        "id": str(timer.id),
        "issue": {"id": str(timer.issue.id), "name": timer.issue.name, "sequence_id": timer.issue.sequence_id},
        "project": {"id": str(timer.project.id), "name": timer.project.name, "identifier": timer.project.identifier},
        "started_at": timer.started_at,
        "stopped_at": timer.stopped_at,
        "is_running": timer.stopped_at is None,
        "elapsed_seconds": int(max((end - timer.started_at).total_seconds(), 0)),
        "duration": timer_minutes(timer, now),
        "server_now": now,
    }


def current_timer(slug, user):
    return (
        IssueWorkLogTimer.objects.filter(workspace__slug=slug, user=user)
        .select_related("issue", "project")
        .first()
    )


class IssueWorkLogTimerStartEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        project = Project.objects.filter(pk=project_id, workspace__slug=slug, archived_at__isnull=True).first()
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_time_tracking_enabled:
            return Response(
                {"error": "Time tracking is turned off for this project."}, status=status.HTTP_400_BAD_REQUEST
            )
        issue = Issue.objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()
        if not issue:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)

        running = current_timer(slug, request.user)
        if running:
            return Response(
                {"error": "You already have a timer. Stop it before starting a new one.", "timer": serialize_timer(running)},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            with transaction.atomic():
                timer = IssueWorkLogTimer.objects.create(
                    project=project, issue=issue, user=request.user, started_at=timezone.now()
                )
        except IntegrityError:
            running = current_timer(slug, request.user)
            return Response(
                {
                    "error": "You already have a timer. Stop it before starting a new one.",
                    "timer": serialize_timer(running) if running else None,
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(serialize_timer(current_timer(slug, request.user) or timer), status=status.HTTP_201_CREATED)


class WorkspaceWorkLogTimerEndpoint(BaseAPIView):
    """The signed-in member's own timer."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        timer = current_timer(slug, request.user)
        return Response({"timer": serialize_timer(timer) if timer else None}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def delete(self, request, slug):
        """Discard the timer without logging any time."""
        timer = current_timer(slug, request.user)
        if timer:
            timer.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceWorkLogTimerStopEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        timer = current_timer(slug, request.user)
        if not timer:
            return Response({"error": "No timer is running."}, status=status.HTTP_404_NOT_FOUND)
        if timer.stopped_at is None:
            timer.stopped_at = timezone.now()
            timer.save(update_fields=["stopped_at", "updated_at"])
        return Response(serialize_timer(timer), status=status.HTTP_200_OK)


class WorkspaceWorkLogTimerSaveEndpoint(BaseAPIView):
    """Turns the (stopped) timer into a worklog. A note describing the work is required."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        timer = current_timer(slug, request.user)
        if not timer:
            return Response({"error": "No timer to save."}, status=status.HTTP_404_NOT_FOUND)

        description = request.data.get("description")
        if not isinstance(description, str) or not description.strip():
            return Response({"description": "Describe the work you did."}, status=status.HTTP_400_BAD_REQUEST)

        if not ProjectMember.objects.filter(
            member=request.user,
            project_id=timer.project_id,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
            is_active=True,
        ).exists():
            return Response(
                {"error": "You are no longer a member of this project. Discard the timer instead."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not Issue.objects.filter(pk=timer.issue_id, project_id=timer.project_id).exists():
            return Response(
                {"error": "The work item no longer exists. Discard the timer instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if timer.stopped_at is None:
            timer.stopped_at = timezone.now()
        duration = timer_minutes(timer)
        if duration > MAX_WORKLOG_DURATION:
            return Response(
                {"error": "The timer ran longer than 999h 59m. Discard it and log the time manually."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            worklog = IssueWorkLog.objects.create(
                project_id=timer.project_id,
                issue_id=timer.issue_id,
                logged_by=request.user,
                duration=duration,
                description=description.strip(),
                started_at=timer.started_at,
                ended_at=timer.stopped_at,
            )
            timer.delete(soft=False)
        return Response(serialize_worklog(worklog_queryset(slug).get(pk=worklog.pk)), status=status.HTTP_201_CREATED)


__all__ = [
    "IssueWorkLogEndpoint",
    "IssueWorkLogDetailEndpoint",
    "IssueWorkLogTimerStartEndpoint",
    "WorkspaceWorkLogEndpoint",
    "WorkspaceWorkLogDownloadEndpoint",
    "WorkspaceWorkLogTimerEndpoint",
    "WorkspaceWorkLogTimerSaveEndpoint",
    "WorkspaceWorkLogTimerStopEndpoint",
    "format_duration",
]
