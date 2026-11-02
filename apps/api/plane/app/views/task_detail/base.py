# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Project task details: the vTiger-style "Project Task" fields of a work item.

  * A project admin turns them on per project (Project.is_task_details_enabled); work items of such a
    project also keep a single assignee (enforced by the work item serializers).
  * Project admins and members fill the fields in; guests can read them.
  * Picklists only accept the values listed in db/models/task_detail.py.
"""

# Python imports
import uuid

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import PROGRESS_VALUES, TASK_DETAIL_CHOICES, Issue, IssueTaskDetail, Project, WorkspaceMember

TEXT_FIELDS = {
    "git_url": 2000,
    "build_version": 255,
    "user_manual_url": 2000,
    "code_review_comments": 10000,
    "code_review_url": 2000,
    "description_url": 2000,
}


def serialize_task_detail(detail):
    if not detail:
        detail = IssueTaskDetail()
    return {
        **{field: getattr(detail, field) for field in TASK_DETAIL_CHOICES},
        **{field: getattr(detail, field) for field in TEXT_FIELDS},
        "requested_by_id": str(detail.requested_by_id) if detail.requested_by_id else None,
        "not_in_project_plan": detail.not_in_project_plan,
        "create_code_review": detail.create_code_review,
        "progress": detail.progress,
    }


def parse_task_detail_payload(data, slug):
    """Returns (cleaned, errors) for the fields present in `data`."""
    cleaned, errors = {}, {}
    for field, allowed in TASK_DETAIL_CHOICES.items():
        if field in data:
            value = data.get(field) or ""
            if value != "" and value not in allowed:
                errors[field] = "Pick one of the listed options."
            else:
                cleaned[field] = value
    for field, limit in TEXT_FIELDS.items():
        if field in data:
            value = data.get(field)
            value = "" if value is None else value
            if not isinstance(value, str):
                errors[field] = "Must be text."
            elif len(value.strip()) > limit:
                errors[field] = f"Keep it under {limit} characters."
            else:
                cleaned[field] = value.strip()
    for field in ("not_in_project_plan", "create_code_review"):
        if field in data:
            value = data.get(field)
            if field == "create_code_review" and value is None:
                cleaned[field] = None
            elif not isinstance(value, bool):
                errors[field] = "Must be true or false."
            else:
                cleaned[field] = value
    if "progress" in data:
        value = data.get("progress")
        if value is not None and (isinstance(value, bool) or value not in PROGRESS_VALUES):
            errors["progress"] = "Pick a progress between 10% and 100%."
        else:
            cleaned["progress"] = value
    if "requested_by_id" in data:
        value = data.get("requested_by_id")
        if value in (None, ""):
            cleaned["requested_by_id"] = None
        else:
            try:
                user_id = uuid.UUID(str(value))
            except ValueError:
                user_id = None
            if (
                not user_id
                or not WorkspaceMember.objects.filter(workspace__slug=slug, member_id=user_id, is_active=True).exists()
            ):
                errors["requested_by_id"] = "Pick a member of this workspace."
            else:
                cleaned["requested_by_id"] = user_id
    return cleaned, errors


class TaskDetailOptionsEndpoint(BaseAPIView):
    """The picklist values, so the app shows the same options the server accepts."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        return Response({**TASK_DETAIL_CHOICES, "progress": PROGRESS_VALUES}, status=status.HTTP_200_OK)


class IssueTaskDetailEndpoint(BaseAPIView):
    # role-based access (plane.utils.work_item_visibility): changing this is editing the work item
    rbac_work_item_actions = {"POST": "edit", "PUT": "edit", "PATCH": "edit", "DELETE": "edit"}

    def get_issue(self, slug, project_id, issue_id):
        # the default manager already leaves helpdesk tickets out
        return Issue.objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        issue = self.get_issue(slug, project_id, issue_id)
        if not issue:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        detail = IssueTaskDetail.objects.filter(issue=issue).first()
        return Response(serialize_task_detail(detail), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, issue_id):
        project = Project.objects.filter(pk=project_id, workspace__slug=slug, archived_at__isnull=True).first()
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_task_details_enabled:
            return Response(
                {"error": "Task details are turned off for this project."}, status=status.HTTP_400_BAD_REQUEST
            )
        issue = self.get_issue(slug, project_id, issue_id)
        if not issue:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)

        cleaned, errors = parse_task_detail_payload(request.data, slug)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        detail = IssueTaskDetail.objects.filter(issue=issue).first()
        if detail:
            for field, value in cleaned.items():
                setattr(detail, field, value)
            detail.save()
        else:
            detail = IssueTaskDetail.objects.create(project=project, issue=issue, **cleaned)
        return Response(serialize_task_detail(detail), status=status.HTTP_200_OK)


__all__ = ["TaskDetailOptionsEndpoint", "IssueTaskDetailEndpoint"]
