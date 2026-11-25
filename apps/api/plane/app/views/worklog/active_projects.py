# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Sidebar › Projects: the projects the signed-in person is working on come first.

A project counts when they have an ongoing task in it: one that isn't completed or cancelled and that is assigned to
them, carries their timer, or has time they logged. The order follows their latest timer activity:

1. the project of their timer (running, or stopped and waiting for its note)
2. then the time they logged last (saving a timer makes a time log; editing one counts too), latest first
3. then projects where they only have assigned tasks, the most recently changed task first

Everything else stays in the person's own order, which the web app keeps after these.
"""

# Django imports
from django.db.models import Count, Exists, Max, OuterRef, Q

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, IssueAssignee, IssueWorkLog, IssueWorkLogTimer

DONE_GROUPS = ("completed", "cancelled")


class MyActiveProjectsEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        user = request.user
        timer = (
            IssueWorkLogTimer.objects.filter(
                workspace__slug=slug,
                user=user,
                project__archived_at__isnull=True,
                project__is_ticket_project=False,
            )
            .only("project_id", "issue_id")
            .first()
        )

        # the person's ongoing tasks; Issue.issue_objects leaves out drafts, archived work, tickets and what they may
        # not see
        theirs = Q(
            Exists(IssueAssignee.objects.filter(issue_id=OuterRef("pk"), assignee=user, deleted_at__isnull=True))
        ) | Q(Exists(IssueWorkLog.objects.filter(issue_id=OuterRef("pk"), logged_by=user)))
        if timer:
            theirs |= Q(pk=timer.issue_id)
        projects = {
            row["project_id"]: row
            for row in Issue.issue_objects.filter(workspace__slug=slug)
            .exclude(state__group__in=DONE_GROUPS)
            .filter(theirs)
            .values("project_id")
            .annotate(open_tasks=Count("id", distinct=True), last_task_change=Max("updated_at"))
            .order_by()
        }
        # the timer's project comes first even when its task is already done
        if timer and timer.project_id not in projects:
            projects[timer.project_id] = {"project_id": timer.project_id, "open_tasks": 0, "last_task_change": None}

        last_logged = dict(
            IssueWorkLog.objects.filter(workspace__slug=slug, logged_by=user, project_id__in=list(projects))
            .values("project_id")
            .annotate(last=Max("updated_at"))
            .order_by()
            .values_list("project_id", "last")
        )

        def order(row):
            project_id = row["project_id"]
            logged, changed = last_logged.get(project_id), row["last_task_change"]
            return (
                not (timer and timer.project_id == project_id),
                logged is None,
                -logged.timestamp() if logged else 0,
                -changed.timestamp() if changed else 0,
            )

        results = [
            {
                "project_id": str(row["project_id"]),
                "open_tasks": row["open_tasks"],
                "has_timer": bool(timer and timer.project_id == row["project_id"]),
                "last_logged_at": last_logged.get(row["project_id"]),
            }
            for row in sorted(projects.values(), key=order)
        ]
        return Response({"results": results}, status=status.HTTP_200_OK)
