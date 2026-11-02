# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Role-based access: asking to join a project. While it's on, people who can't manage a project don't join it by
themselves: they ask, their PM (a lead of a team they're in) approves or rejects, and only an approval adds them
(as a member: they can then create work items there and edit their own). Both sides hear about it in their Inbox.
"""

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.html import escape

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.app.views.rbac.base import _uuid
from plane.db.models import (
    Notification,
    Project,
    ProjectJoinRequest,
    ProjectMember,
    ProjectUserProperty,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.utils.rbac import pm_ids, rbac_profile

# Notification.entity_name of everything below; the Inbox shows these next to work item notifications
NOTIFICATION_ENTITY = "project_join_request"


def person_name(user):
    return f"{user.first_name} {user.last_name}".strip() or user.display_name or user.email


def user_lite(user):
    if user is None:
        return None
    return {"id": str(user.id), "display_name": user.display_name, "name": person_name(user)}


def serialize_request(join_request, decidable_member_ids):
    return {
        "id": str(join_request.id),
        "project_id": str(join_request.project_id),
        "project_name": join_request.project.name,
        "member": user_lite(join_request.member),
        "status": join_request.status,
        "created_at": join_request.created_at,
        "decided_by": user_lite(join_request.decided_by),
        "decided_at": join_request.decided_at,
        "can_decide": join_request.status == "pending" and join_request.member_id in decidable_member_ids,
    }


def notify(join_request, receiver_ids, actor, kind):
    """kind: requested (to the PMs), approved / rejected (to the person who asked)."""
    project_name = join_request.project.name
    member_name = person_name(join_request.member)
    title = {
        "requested": f"{member_name} asked to join {project_name}",
        "approved": f"{person_name(actor)} approved your request to join {project_name}",
        "rejected": f"{person_name(actor)} rejected your request to join {project_name}",
    }[kind]
    Notification.objects.bulk_create(
        [
            Notification(
                workspace_id=join_request.workspace_id,
                project_id=join_request.project_id,
                entity_identifier=join_request.id,
                entity_name=NOTIFICATION_ENTITY,
                title=title,
                message_html=f"<p>{escape(title)}</p>",
                message_stripped=title,
                sender=f"{NOTIFICATION_ENTITY}:{kind}",
                triggered_by=actor,
                receiver_id=receiver_id,
                data={"join_request": {"kind": kind, "project_name": project_name, "member_name": member_name}},
            )
            for receiver_id in receiver_ids
        ]
    )


def add_to_project(join_request, actor):
    # as a member, so the PM's approval also lets them create work items there and edit their own (what exactly
    # follows their role's work item permissions). An old row (one they left, or one the sync once made and ended,
    # e.g. from when they were a PM) becomes a plain given membership: not the old role, and not the sync's to remove
    ProjectMember.objects.filter(project_id=join_request.project_id, member_id=join_request.member_id).update(
        is_active=True, role=ROLE.MEMBER.value, rbac_managed=False, rbac_original_role=None
    )
    ProjectMember.objects.bulk_create(
        [
            ProjectMember(
                project_id=join_request.project_id,
                member_id=join_request.member_id,
                role=ROLE.MEMBER.value,
                workspace_id=join_request.workspace_id,
                created_by=actor,
            )
        ],
        ignore_conflicts=True,
    )
    ProjectUserProperty.objects.bulk_create(
        [
            ProjectUserProperty(
                project_id=join_request.project_id,
                user_id=join_request.member_id,
                workspace_id=join_request.workspace_id,
                created_by=actor,
            )
        ],
        ignore_conflicts=True,
    )


def bad_request(message):
    return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)


class ProjectJoinRequestEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        """My PMs, my own requests, and the requests of the people I'm the PM of."""
        workspace = Workspace.objects.get(slug=slug)
        profile = rbac_profile(request, slug)
        if profile is None:
            return Response({"is_rbac_enabled": False, "pms": [], "requests": []}, status=status.HTTP_200_OK)
        decidable = profile.led_member_ids - {request.user.id}
        join_requests = (
            ProjectJoinRequest.objects.filter(workspace=workspace)
            .filter(Q(member=request.user) | Q(member_id__in=decidable))
            .select_related("project", "member", "decided_by")[:500]
        )
        pms = User.objects.filter(id__in=pm_ids(workspace.id, request.user.id)).order_by("first_name", "display_name")
        return Response(
            {
                "is_rbac_enabled": True,
                "pms": [user_lite(user) for user in pms],
                "requests": [serialize_request(join_request, decidable) for join_request in join_requests],
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        """Ask to join a project; the person's PMs are notified."""
        workspace = Workspace.objects.get(slug=slug)
        profile = rbac_profile(request, slug)
        if profile is None:
            return bad_request("Role-based access is off: join the project directly.")
        project = (
            Project.objects.filter(workspace=workspace, pk=_uuid(request.data.get("project_id")))
            .filter(archived_at__isnull=True)
            .filter(profile.project_q("view"))
            .first()
        )
        if project is None:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if ProjectMember.objects.filter(project=project, member=request.user, is_active=True).exists():
            return bad_request("You're already a member of this project.")
        if Project.objects.filter(pk=project.pk).filter(profile.project_q("edit")).exists():
            return bad_request("You can join this project directly; no approval is needed.")
        pms = pm_ids(workspace.id, request.user.id)
        if not pms:
            return bad_request(
                "You don't have a PM yet, so nobody can approve your request. Ask HR to add you to a team."
            )

        decidable = set()  # the person asking decides nothing here
        existing = ProjectJoinRequest.objects.filter(project=project, member=request.user, status="pending").first()
        if existing:
            return Response(serialize_request(existing, decidable), status=status.HTTP_200_OK)
        try:
            with transaction.atomic():
                join_request = ProjectJoinRequest.objects.create(
                    workspace=workspace, project=project, member=request.user
                )
        except IntegrityError:
            # a second click got there first
            existing = ProjectJoinRequest.objects.get(project=project, member=request.user, status="pending")
            return Response(serialize_request(existing, decidable), status=status.HTTP_200_OK)
        notify(join_request, pms, request.user, "requested")
        return Response(serialize_request(join_request, decidable), status=status.HTTP_201_CREATED)


class ProjectJoinRequestDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, pk):
        """Approve or reject: only the PM of the person who asked (a lead of a team they're in)."""
        decision = request.data.get("status")
        if decision not in ("approved", "rejected"):
            return bad_request("Status must be approved or rejected.")
        workspace = Workspace.objects.get(slug=slug)
        if not workspace.is_rbac_enabled:
            return bad_request("Role-based access is off: join requests can't be decided.")

        with transaction.atomic():
            join_request = ProjectJoinRequest.objects.select_for_update().filter(workspace=workspace, pk=pk).first()
            if join_request is None:
                return Response({"error": "Request not found."}, status=status.HTTP_404_NOT_FOUND)
            if request.user.id not in pm_ids(workspace.id, join_request.member_id):
                return Response(
                    {"error": f"Only {person_name(join_request.member)}'s PM can approve or reject this request."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if join_request.status != "pending":
                return Response(
                    {
                        "error": f"This request was already {join_request.status}"
                        + (f" by {person_name(join_request.decided_by)}." if join_request.decided_by else ".")
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            if decision == "approved":
                if not WorkspaceMember.objects.filter(
                    workspace=workspace, member_id=join_request.member_id, is_active=True
                ).exists():
                    return bad_request(f"{person_name(join_request.member)} is no longer in this workspace.")
                add_to_project(join_request, request.user)
            join_request.status = decision
            join_request.decided_by = request.user
            join_request.decided_at = timezone.now()
            join_request.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])

        # the other PMs' notifications about it are dealt with
        Notification.objects.filter(
            entity_name=NOTIFICATION_ENTITY, entity_identifier=join_request.id, read_at__isnull=True
        ).update(read_at=timezone.now())
        notify(join_request, [join_request.member_id], request.user, decision)
        decidable = {join_request.member_id}
        return Response(serialize_request(join_request, decidable), status=status.HTTP_200_OK)
