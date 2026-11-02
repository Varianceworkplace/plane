# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Project details: the vTiger-style "Creating New Project" fields of a project (see plane/utils/project_details.py).

  * Everyone in the project can read them; project admins (and workspace admins in the project) edit them.
"""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import PROGRESS_VALUES, PROJECT_DETAIL_CHOICES, Project, ProjectDetail
from plane.utils.project_details import parse_project_detail_payload, serialize_project_detail


class ProjectDetailOptionsEndpoint(BaseAPIView):
    """The picklist values, so the app shows the same options the server accepts."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        return Response({**PROJECT_DETAIL_CHOICES, "progress": PROGRESS_VALUES}, status=status.HTTP_200_OK)


class ProjectDetailEndpoint(BaseAPIView):
    def get_project(self, slug, project_id):
        return Project.objects.filter(pk=project_id, workspace__slug=slug).first()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        detail = ProjectDetail.objects.filter(project=project).first()
        return Response(serialize_project_detail(detail), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if project.archived_at:
            return Response({"error": "Archived projects cannot be updated"}, status=status.HTTP_400_BAD_REQUEST)

        detail = ProjectDetail.objects.filter(project=project).first()
        cleaned, errors = parse_project_detail_payload(request.data, current=detail)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        if detail:
            for field, value in cleaned.items():
                setattr(detail, field, value)
            detail.save()
        else:
            detail = ProjectDetail.objects.create(project=project, workspace_id=project.workspace_id, **cleaned)
        return Response(serialize_project_detail(detail), status=status.HTTP_200_OK)


__all__ = ["ProjectDetailOptionsEndpoint", "ProjectDetailEndpoint"]
