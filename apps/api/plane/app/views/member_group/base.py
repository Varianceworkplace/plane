# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Groups (Workspace settings › Groups; plane.db.models.member_group).

  * Every workspace member can list the groups: the Assigned to dropdown offers them next to people.
  * Creating and managing them follows the role's Groups permissions: All = every group, any other scope = the
    groups the person created (HR: all; Project Managers: their own). With role-based access off, workspace admins.
"""

# Django imports
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.db.models.functions import Lower

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import RBAC_ACTIONS, Issue, MemberGroup, MemberGroupMember, Workspace, WorkspaceMember
from plane.db.models.rbac import schedule_project_access_sync
from plane.utils.issue_filters import filter_valid_uuids
from plane.utils.rbac import rbac_profile


class GroupAccess:
    """What the request user may do with groups in a workspace."""

    def __init__(self, request, slug):
        self.user_id = request.user.id
        profile = rbac_profile(request, slug)
        if profile is not None:
            self.scopes = {action: profile.scopes("groups", action) for action in RBAC_ACTIONS}
        else:
            # role-based access off: workspace admins manage every group
            is_admin = WorkspaceMember.objects.filter(
                workspace__slug=slug, member=request.user, role=ROLE.ADMIN.value, is_active=True
            ).exists()
            self.scopes = {action: {"all"} if is_admin else set() for action in RBAC_ACTIONS}

    def can(self, action):
        return bool(self.scopes[action])

    def can_on(self, action, group):
        scopes = self.scopes[action]
        return "all" in scopes or (bool(scopes) and group.created_by_id == self.user_id)


def live_groups(slug):
    return (
        MemberGroup.objects.filter(workspace__slug=slug)
        .annotate(
            task_count=Count(
                "assigned_issues",
                filter=Q(assigned_issues__deleted_at__isnull=True, assigned_issues__is_draft=False),
                distinct=True,
            )
        )
        .prefetch_related(Prefetch("group_members", queryset=MemberGroupMember.objects.order_by("created_at")))
    )


def serialize_group(group, access):
    return {
        "id": str(group.id),
        "name": group.name,
        "description": group.description,
        "member_ids": [str(membership.member_id) for membership in group.group_members.all()],
        "task_count": getattr(group, "task_count", 0) or 0,
        "created_by": str(group.created_by_id) if group.created_by_id else None,
        "created_at": group.created_at,
        "updated_at": group.updated_at,
        "can_edit": access.can_on("edit", group),
        "can_delete": access.can_on("delete", group),
    }


def clean_payload(data, workspace, instance=None):
    """Returns (cleaned, errors) for the fields present in `data` (name required on create)."""
    cleaned, errors = {}, {}
    if "name" in data or instance is None:
        name = data.get("name")
        name = name.strip() if isinstance(name, str) else ""
        duplicates = MemberGroup.objects.filter(workspace=workspace).annotate(lower=Lower("name"))
        if instance is not None:
            duplicates = duplicates.exclude(pk=instance.pk)
        if not name:
            errors["name"] = "Group name is required."
        elif len(name) > 255:
            errors["name"] = "Keep the name under 255 characters."
        elif duplicates.filter(lower=name.lower()).exists():
            errors["name"] = "A group with this name already exists."
        else:
            cleaned["name"] = name
    if "description" in data:
        description = data.get("description")
        cleaned["description"] = description.strip() if isinstance(description, str) else ""
    if "member_ids" in data or instance is None:
        member_ids = data.get("member_ids") or []
        wanted = {str(member_id) for member_id in member_ids} if isinstance(member_ids, list) else set()
        # team members only: workspace guests can't be in a group
        found = {
            str(member_id)
            for member_id in WorkspaceMember.objects.filter(
                workspace=workspace,
                is_active=True,
                role__gte=ROLE.MEMBER.value,
                member_id__in=filter_valid_uuids(list(wanted)),
            ).values_list("member_id", flat=True)
        }
        if not isinstance(member_ids, list) or found != wanted:
            errors["member_ids"] = "Pick people who are members of this workspace."
        else:
            cleaned["member_ids"] = wanted
    return cleaned, errors


def set_members(group, member_ids, user):
    """Makes the group's members exactly `member_ids`. Returns whether anything changed."""
    current = {str(member_id) for member_id in group.group_members.values_list("member_id", flat=True)}
    removed, added = current - member_ids, member_ids - current
    if removed:
        MemberGroupMember.objects.filter(group=group, member_id__in=list(removed)).delete()
    MemberGroupMember.objects.bulk_create(
        [
            MemberGroupMember(
                workspace_id=group.workspace_id,
                group=group,
                member_id=member_id,
                created_by=user,
                updated_by=user,
            )
            for member_id in added
        ]
    )
    return bool(removed or added)


class MemberGroupEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        access = GroupAccess(request, slug)
        groups = live_groups(slug).order_by(Lower("name"))
        return Response(
            {
                "can_view": access.can("view"),
                "can_create": access.can("create"),
                "groups": [serialize_group(group, access) for group in groups],
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        access = GroupAccess(request, slug)
        if not access.can("create"):
            return Response({"error": "You can't create groups."}, status=status.HTTP_403_FORBIDDEN)
        workspace = Workspace.objects.get(slug=slug)
        data = request.data if isinstance(request.data, dict) else {}
        cleaned, errors = clean_payload(data, workspace)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            group = MemberGroup.objects.create(
                workspace=workspace, name=cleaned["name"], description=cleaned.get("description", "")
            )
            set_members(group, cleaned["member_ids"], request.user)
        return Response(serialize_group(live_groups(slug).get(pk=group.pk), access), status=status.HTTP_201_CREATED)


class MemberGroupDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, pk):
        access = GroupAccess(request, slug)
        group = live_groups(slug).filter(pk=pk).first()
        if not group:
            return Response({"error": "Group not found."}, status=status.HTTP_404_NOT_FOUND)
        if not access.can_on("edit", group):
            return Response({"error": "You can only edit the groups you created."}, status=status.HTTP_403_FORBIDDEN)
        data = request.data if isinstance(request.data, dict) else {}
        cleaned, errors = clean_payload(data, group.workspace, instance=group)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            for field in ("name", "description"):
                if field in cleaned:
                    setattr(group, field, cleaned[field])
            group.save()
            # the people who joined or left gain or lose access to the group's tasks
            if "member_ids" in cleaned and set_members(group, cleaned["member_ids"], request.user):
                schedule_project_access_sync(group.workspace_id)
        return Response(serialize_group(live_groups(slug).get(pk=group.pk), access), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, pk):
        access = GroupAccess(request, slug)
        group = MemberGroup.objects.filter(workspace__slug=slug, pk=pk).first()
        if not group:
            return Response({"error": "Group not found."}, status=status.HTTP_404_NOT_FOUND)
        if not access.can_on("delete", group):
            return Response({"error": "You can only delete the groups you created."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            # its tasks become unassigned (their creator, the project's PMs, HR and admins keep them)
            Issue.all_objects.filter(assignee_group=group).update(assignee_group=None)
            MemberGroupMember.objects.filter(group=group).delete()
            group.delete()
            schedule_project_access_sync(group.workspace_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
