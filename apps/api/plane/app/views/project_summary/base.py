# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Project summary: the dashboard a project opens on.

  * Work item counts for the project (open, due, completed, by priority), expected hours and worked hours.
  * Every member of the project sees the whole project, whatever their role: being in the project is what opens
    its summary (joining, or a join request being approved). People outside the project get a 403.
  * Team summary: one row per project member, plus anyone else with work items or time in the project.
"""

# Python imports
from datetime import timedelta

# Django imports
from django.db.models import Count, Q, Sum
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.app.views.worklog.base import serialize_user, worklog_queryset
from plane.app.views.worklog.report import user_timezone
from plane.db.models import Issue, IssueAssignee, IssueTimeEstimate, Project, ProjectMember, User
from plane.utils.work_item_visibility import all_work_items

# open work items due within this many days count as due, next to the overdue ones
DUE_SOON_DAYS = 7

CLOSED_GROUPS = ["completed", "cancelled"]
PRIORITIES = ["urgent", "high", "medium", "low", "none"]


def work_item_counts(issues, today):
    open_q = ~Q(state__group__in=CLOSED_GROUPS)
    counts = issues.aggregate(
        total=Count("id", distinct=True),
        open=Count("id", distinct=True, filter=open_q),
        completed=Count("id", distinct=True, filter=Q(state__group="completed")),
        cancelled=Count("id", distinct=True, filter=Q(state__group="cancelled")),
        overdue=Count("id", distinct=True, filter=open_q & Q(target_date__lt=today)),
        due_soon=Count(
            "id",
            distinct=True,
            filter=open_q & Q(target_date__gte=today, target_date__lte=today + timedelta(days=DUE_SOON_DAYS)),
        ),
        **{priority: Count("id", distinct=True, filter=Q(priority=priority)) for priority in PRIORITIES},
    )
    # cancelled work items don't count against progress
    countable = counts["total"] - counts["cancelled"]
    return {
        "total": counts["total"],
        "open": counts["open"],
        "completed": counts["completed"],
        "cancelled": counts["cancelled"],
        "overdue": counts["overdue"],
        "due_soon": counts["due_soon"],
        "progress": round(counts["completed"] * 100 / countable) if countable else 0,
    }, {priority: counts[priority] for priority in PRIORITIES}


def team_summary(project, issue_ids, worklogs):
    assigned = {
        row["assignee_id"]: row
        for row in IssueAssignee.objects.filter(issue_id__in=issue_ids, project_id=project.id)
        .order_by()
        .values("assignee_id")
        .annotate(
            work_items=Count("issue_id", distinct=True),
            completed=Count("issue_id", distinct=True, filter=Q(issue__state__group="completed")),
            open=Count("issue_id", distinct=True, filter=~Q(issue__state__group__in=CLOSED_GROUPS)),
            expected=Sum("issue__time_estimate__expected_duration"),
        )
    }
    worked = {
        row["logged_by_id"]: row["worked"]
        for row in worklogs.order_by().values("logged_by_id").annotate(worked=Sum("duration"))
    }

    people_ids = {
        *assigned,
        *worked,
        *ProjectMember.objects.filter(
            project_id=project.id,
            is_active=True,
            member__isnull=False,
            member__is_bot=False,
            role__gte=ROLE.MEMBER.value,
        ).values_list("member_id", flat=True),
    }

    rows = []
    for user in User.objects.filter(id__in=people_ids):
        row = assigned.get(user.id, {})
        rows.append(
            {
                **serialize_user(user),
                "expected_duration": row.get("expected") or 0,
                "worked_duration": worked.get(user.id, 0),
                "work_items": row.get("work_items", 0),
                "completed_work_items": row.get("completed", 0),
                "open_work_items": row.get("open", 0),
            }
        )
    rows.sort(key=lambda r: (-r["worked_duration"], -r["work_items"], (r["display_name"] or "").lower()))
    return rows


class ProjectSummaryEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        # allow_permission has already checked that the person is an active member of the project
        project = Project.objects.filter(pk=project_id, workspace__slug=slug).first()
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)

        today = timezone.now().astimezone(user_timezone(request.user)).date()
        # the whole project, not only the work items assigned to this person; drafts, archived and triage stay out
        with all_work_items():
            issues = Issue.issue_objects.filter(project_id=project.id, workspace__slug=slug)
        issue_ids = issues.values("id")
        work_items, priority = work_item_counts(issues, today)

        worklogs = worklog_queryset(slug).filter(project_id=project.id)
        expected = IssueTimeEstimate.objects.filter(project_id=project.id, issue_id__in=issue_ids).aggregate(
            total=Sum("expected_duration")
        )["total"]
        worked = worklogs.aggregate(total=Sum("duration"))["total"]

        return Response(
            {
                "work_items": work_items,
                "priority": priority,
                "time": {
                    "is_time_tracking_enabled": project.is_time_tracking_enabled,
                    "expected_duration": expected or 0,
                    "worked_duration": worked or 0,
                },
                "team": team_summary(project, issue_ids, worklogs),
                "due_soon_days": DUE_SOON_DAYS,
            },
            status=status.HTTP_200_OK,
        )


__all__ = ["ProjectSummaryEndpoint"]
