# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Expected vs worked time on work items.

  * Project admins and members set how long a work item is expected to take (projects with time tracking on).
  * Worked time is the sum of the work item's worklogs.
  * When worked time passes the expected time, a reason can be noted on the work item.
  * Guests can read both.
"""

# Django imports
from django.db.models import Count, Sum

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import MAX_WORKLOG_DURATION, Issue, IssueTimeEstimate, Project

from .base import worklog_queryset


def serialize_time_estimate(estimate, worked_duration, worklog_count):
    expected = estimate.expected_duration if estimate else None
    return {
        "expected_duration": expected,
        "worked_duration": worked_duration,
        "worklog_count": worklog_count,
        # minutes past the estimate, 0 while within it
        "over_by": max(worked_duration - expected, 0) if expected else 0,
        "overdue_reason": estimate.overdue_reason if estimate else "",
    }


class IssueTimeEstimateEndpoint(BaseAPIView):
    # role-based access (plane.utils.work_item_visibility): changing this is editing the work item
    rbac_work_item_actions = {"POST": "edit", "PUT": "edit", "PATCH": "edit", "DELETE": "edit"}

    def get_issue(self, slug, project_id, issue_id):
        # the default manager already leaves helpdesk tickets out
        return Issue.objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()

    def summary(self, slug, project_id, issue):
        totals = (
            worklog_queryset(slug)
            .filter(project_id=project_id, issue_id=issue.id)
            .aggregate(worked=Sum("duration"), count=Count("id"))
        )
        estimate = IssueTimeEstimate.objects.filter(issue=issue).first()
        return serialize_time_estimate(estimate, totals["worked"] or 0, totals["count"])

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        issue = self.get_issue(slug, project_id, issue_id)
        if not issue:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.summary(slug, project_id, issue), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, issue_id):
        """{"expected_duration": minutes | null, "overdue_reason": text}. null clears the estimate."""
        project = Project.objects.filter(pk=project_id, workspace__slug=slug, archived_at__isnull=True).first()
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_time_tracking_enabled:
            return Response(
                {"error": "Time tracking is turned off for this project."}, status=status.HTTP_400_BAD_REQUEST
            )
        issue = self.get_issue(slug, project_id, issue_id)
        if not issue:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)

        estimate = IssueTimeEstimate.objects.filter(issue=issue).first()
        errors = {}

        if "expected_duration" in request.data and request.data.get("expected_duration") is None:
            if estimate:
                estimate.delete(soft=False)
            return Response(self.summary(slug, project_id, issue), status=status.HTTP_200_OK)

        expected = estimate.expected_duration if estimate else None
        if "expected_duration" in request.data:
            try:
                expected = int(request.data.get("expected_duration"))
            except (TypeError, ValueError):
                expected = None
            if expected is None or expected < 1:
                errors["expected_duration"] = "Enter an expected time greater than zero."
            elif expected > MAX_WORKLOG_DURATION:
                errors["expected_duration"] = "The expected time can't be more than 999h 59m."
        elif expected is None:
            errors["expected_duration"] = "Set the expected time first."

        reason = estimate.overdue_reason if estimate else ""
        if "overdue_reason" in request.data:
            reason = request.data.get("overdue_reason")
            if not isinstance(reason, str):
                errors["overdue_reason"] = "The reason must be text."
            else:
                reason = reason.strip()
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        if estimate:
            estimate.expected_duration, estimate.overdue_reason = expected, reason
            estimate.save(update_fields=["expected_duration", "overdue_reason", "updated_at", "updated_by"])
        else:
            IssueTimeEstimate.objects.create(
                project=project, issue=issue, expected_duration=expected, overdue_reason=reason
            )
        return Response(self.summary(slug, project_id, issue), status=status.HTTP_200_OK)


class ProjectTimeEstimatesEndpoint(BaseAPIView):
    """Expected and worked minutes for every work item of a project that has either (for list rows)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        worked = {
            row["issue_id"]: row
            for row in worklog_queryset(slug)
            .filter(project_id=project_id)
            .order_by()
            .values("issue_id")
            .annotate(worked=Sum("duration"), count=Count("id"))
        }
        estimates = {
            e.issue_id: e
            for e in IssueTimeEstimate.objects.filter(
                project_id=project_id, workspace__slug=slug, issue__deleted_at__isnull=True
            )
        }
        result = {}
        for issue_id in {*worked, *estimates}:
            row = worked.get(issue_id) or {"worked": 0, "count": 0}
            result[str(issue_id)] = serialize_time_estimate(estimates.get(issue_id), row["worked"], row["count"])
        return Response(result, status=status.HTTP_200_OK)


__all__ = ["IssueTimeEstimateEndpoint", "ProjectTimeEstimatesEndpoint"]
