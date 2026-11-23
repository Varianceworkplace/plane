# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from datetime import datetime

import jwt

# Django imports
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone

# Third party modules
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# Module imports
from plane.app.permissions import WorkSpaceAdminPermission
from plane.app.permissions.workspace import Admin, Guest, Member
from plane.app.serializers import (
    WorkSpaceMemberInviteSerializer,
    WorkSpaceMemberInvitePublicSerializer,
    WorkSpaceMemberSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.bgtasks.workspace_invitation_task import workspace_invitation
from plane.db.models import User, Workspace, WorkspaceMember, WorkspaceMemberInvite
from plane.utils.cache import invalidate_cache, invalidate_cache_directly
from plane.utils.host import base_host
from plane.utils.workspace_invites import (
    email_is_configured,
    invite_is_expired,
    open_invites,
    record_invite_email,
)
from .. import BaseViewSet


def send_invitation_emails(request, workspace, invitations):
    """Queues each invitation's email. Without email set up nothing is queued (each invitation notes that), and
    False is returned so the caller can say so instead of claiming they were sent."""
    if not email_is_configured():
        for invite in invitations:
            record_invite_email(invite.id, "not_configured")
        return False
    current_site = base_host(request=request, is_app=True)
    for invite in invitations:
        workspace_invitation.delay(invite.email, workspace.id, invite.token, current_site, request.user.email)
    return True


class WorkspaceInvitationsViewset(BaseViewSet):
    """Endpoint for creating, listing and  deleting workspaces"""

    serializer_class = WorkSpaceMemberInviteSerializer
    model = WorkspaceMemberInvite

    permission_classes = [WorkSpaceAdminPermission]

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("workspace", "workspace__owner", "created_by")
        )

    def create(self, request, slug):
        emails = request.data.get("emails", [])
        # Check if email is provided
        if not emails:
            return Response({"error": "Emails are required"}, status=status.HTTP_400_BAD_REQUEST)

        # check for role level of the requesting user
        requesting_user = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)

        # Check if any invited user has an higher role
        if len([email for email in emails if int(email.get("role", 5)) > requesting_user.role]):
            return Response(
                {"error": "You cannot invite a user with higher role"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the workspace object
        workspace = Workspace.objects.get(slug=slug)

        # Every address must be valid before anything is saved
        wanted = []
        for email in emails:
            address = (email.get("email") or "").strip().lower()
            try:
                validate_email(address)
            except ValidationError:
                return Response(
                    {
                        "error": f"Invalid email - {email} provided a valid email address is required to send the invite"  # noqa: E501
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            wanted.append((address, int(email.get("role", 5))))
        # the same address twice in one go counts once (the last role given)
        wanted = list({address: (address, role) for address, role in wanted}.values())

        # Check if user is already a member of workspace
        workspace_members = WorkspaceMember.objects.filter(
            workspace_id=workspace.id,
            member__email__in=[address for address, _ in wanted],
            is_active=True,
        ).select_related("member", "member__avatar_asset")

        if workspace_members:
            return Response(
                {
                    "error": "Some users are already member of workspace",
                    "workspace_users": WorkSpaceMemberSerializer(workspace_members, many=True).data,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Someone already invited is invited again: their invitation (same link) is sent again with a fresh
        # validity, instead of the new one being dropped. Never past the requester's own role, as for a role change.
        existing = {
            invite.email: invite
            for invite in WorkspaceMemberInvite.objects.filter(
                workspace_id=workspace.id, email__in=[address for address, _ in wanted]
            )
        }
        for address, _role in wanted:
            if address in existing and existing[address].role > requesting_user.role:
                return Response(
                    {"error": f"{address} already has an invitation with a higher role than yours"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        invitations, resent = [], []
        with transaction.atomic():
            for address, role in wanted:
                invite = existing.get(address)
                if invite:
                    invite.role = role
                    invite.accepted = False
                    invite.responded_at = None
                    invite.save()
                    resent.append(invite)
                else:
                    invite = WorkspaceMemberInvite.objects.create(
                        email=address,
                        workspace_id=workspace.id,
                        token=jwt.encode(
                            {"email": {"email": address, "role": role}, "timestamp": datetime.now().timestamp()},
                            settings.SECRET_KEY,
                            algorithm="HS256",
                        ),
                        role=role,
                        created_by=request.user,
                    )
                invitations.append(invite)

        email_ready = send_invitation_emails(request, workspace, invitations)
        total = len(invitations)
        if email_ready:
            message = f"Sending {total} invitation{'' if total == 1 else 's'} by email"
            if resent:
                message += f"; {len(resent)} of them {'was' if len(resent) == 1 else 'were'} already invited, so it was sent again"  # noqa: E501
            message += "."
        else:
            message = (
                "Invitations saved, but email isn't set up, so nobody was emailed. "
                "Copy each invitation link from the pending list and share it."
            )
        return Response(
            {
                "message": message,
                "email_configured": email_ready,
                "invited": [invite.email for invite in invitations],
                "resent": [invite.email for invite in resent],
            },
            status=status.HTTP_200_OK,
        )

    def resend(self, request, slug, pk):
        """Sends a pending (or declined) invitation again, same link, and keeps it open for another stretch."""
        invite = WorkspaceMemberInvite.objects.filter(pk=pk, workspace__slug=slug).select_related("workspace").first()
        if not invite:
            return Response({"error": "Invitation not found"}, status=status.HTTP_404_NOT_FOUND)
        requesting_user = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)
        if invite.role > requesting_user.role:
            return Response(
                {"error": "You cannot resend an invitation with a higher role than your own"},
                status=status.HTTP_403_FORBIDDEN,
            )
        invite.accepted = False
        invite.responded_at = None
        invite.save()
        email_ready = send_invitation_emails(request, invite.workspace, [invite])
        return Response(
            {
                **self.get_serializer(invite).data,
                "email_configured": email_ready,
                "message": f"Invitation sent again to {invite.email}."
                if email_ready
                else "Email isn't set up, so it wasn't emailed. Copy the invitation link and share it.",
            },
            status=status.HTTP_200_OK,
        )

    def partial_update(self, request, slug, pk):
        """Changes a pending invite's role, never to (or from) a role above the requester's own: otherwise a Member
        could invite someone as Member and then make them an Admin. Nothing else on an invite changes here."""
        invite = WorkspaceMemberInvite.objects.filter(pk=pk, workspace__slug=slug).first()
        if not invite:
            return Response({"error": "Invitation not found"}, status=status.HTTP_404_NOT_FOUND)
        if invite.responded_at:
            return Response({"error": "This invitation has already been answered"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            role = int(request.data.get("role"))
        except (TypeError, ValueError):
            role = None
        if role not in (Admin, Member, Guest):
            return Response({"error": "Pick a valid role"}, status=status.HTTP_400_BAD_REQUEST)
        requesting_user = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)
        if max(role, invite.role) > requesting_user.role:
            return Response(
                {"error": "You cannot give an invitation a higher role than your own"},
                status=status.HTTP_403_FORBIDDEN,
            )
        invite.role = role
        invite.save(update_fields=["role", "updated_at"])
        return Response(self.get_serializer(invite).data, status=status.HTTP_200_OK)

    def destroy(self, request, slug, pk):
        workspace_member_invite = WorkspaceMemberInvite.objects.get(pk=pk, workspace__slug=slug)
        workspace_member_invite.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceJoinEndpoint(BaseAPIView):
    permission_classes = [AllowAny]
    """Invitation response endpoint the user can respond to the invitation"""

    @invalidate_cache(path="/api/workspaces/", user=False)
    @invalidate_cache(path="/api/users/me/workspaces/", multiple=True)
    @invalidate_cache(
        path="/api/workspaces/:slug/members/",
        user=False,
        multiple=True,
        url_params=True,
    )
    @invalidate_cache(path="/api/users/me/settings/", multiple=True)
    def post(self, request, slug, pk):
        workspace_invite = WorkspaceMemberInvite.objects.get(pk=pk, workspace__slug=slug)

        token = request.data.get("token", "")

        # Validate the token to verify the user received the invitation email
        if not token or workspace_invite.token != token:
            return Response(
                {"error": "You do not have permission to join the workspace"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Require an authenticated session — the accepting user must be the
        # person who was invited.  Without this check an attacker who registers
        # with the invited address (email-squat) and obtains the token via the
        # GET endpoint can steal the workspace membership (GHSA-4vj8-p63v-8p24).
        if not request.user.is_authenticated:
            return Response(
                {"error": "Authentication required to accept workspace invitation"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if request.user.email.lower() != workspace_invite.email.lower():
            return Response(
                {"error": "You do not have permission to accept this invitation"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if workspace_invite.responded_at is None and invite_is_expired(workspace_invite):
            return Response(
                {"error": "This invitation has expired. Ask your admin to send it again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If already responded then return error
        if workspace_invite.responded_at is None:
            workspace_invite.accepted = request.data.get("accepted", False)
            workspace_invite.responded_at = timezone.now()
            workspace_invite.save()

            if workspace_invite.accepted:
                # Check if the user created account after invitation
                user = User.objects.filter(email=workspace_invite.email).first()

                # If the user is present then create the workspace member
                if user is not None:
                    # Check if the user was already a member of workspace then activate the user
                    workspace_member = WorkspaceMember.objects.filter(
                        workspace=workspace_invite.workspace, member=user
                    ).first()
                    if workspace_member is not None:
                        workspace_member.is_active = True
                        workspace_member.role = workspace_invite.role
                        workspace_member.save()
                    else:
                        # Create a Workspace
                        _ = WorkspaceMember.objects.create(
                            workspace=workspace_invite.workspace,
                            member=user,
                            role=workspace_invite.role,
                        )

                    # Set the user last_workspace_id to the accepted workspace
                    user.last_workspace_id = workspace_invite.workspace.id
                    user.save()

                    # Delete the invitation
                    workspace_invite.delete()

                return Response(
                    {"message": "Workspace Invitation Accepted"},
                    status=status.HTTP_200_OK,
                )

            # Workspace invitation rejected
            return Response(
                {"message": "Workspace Invitation was not accepted"},
                status=status.HTTP_200_OK,
            )

        return Response(
            {"error": "You have already responded to the invitation request"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def get(self, request, slug, pk):
        workspace_invitation = WorkspaceMemberInvite.objects.get(workspace__slug=slug, pk=pk)
        # Use the public serializer that omits the token and invite_link fields so
        # that an unauthenticated caller cannot retrieve the acceptance token
        # (GHSA-86mg-259g-pwgg / GHSA-gf48-p6jp-cwc4).
        serializer = WorkSpaceMemberInvitePublicSerializer(workspace_invitation)
        return Response(serializer.data, status=status.HTTP_200_OK)


class UserWorkspaceInvitationsViewSet(BaseViewSet):
    serializer_class = WorkSpaceMemberInviteSerializer
    model = WorkspaceMemberInvite

    def get_queryset(self):
        # only the ones that can still be joined (not answered, not expired)
        return self.filter_queryset(
            open_invites(super().get_queryset().filter(email=self.request.user.email)).select_related("workspace")
        )

    @invalidate_cache(path="/api/workspaces/", user=False)
    @invalidate_cache(path="/api/users/me/workspaces/", multiple=True)
    def create(self, request):
        # Joining by email match alone needs proof that the address is theirs (an emailed code, a provider that
        # vouches for it, or a password reset by email); otherwise whoever signs up first with an invited address,
        # say a mistyped one, would join with that role. Without that proof, the invitation link (its token) works.
        if not request.user.is_email_verified:
            return Response(
                {"error": "To join, open the invitation link we emailed you."},
                status=status.HTTP_403_FORBIDDEN,
            )
        invitations = request.data.get("invitations", [])
        workspace_invitations = open_invites(
            WorkspaceMemberInvite.objects.filter(pk__in=invitations, email=request.user.email)
        ).order_by("-created_at")
        if invitations and not workspace_invitations.exists():
            return Response(
                {"error": "These invitations have expired or were already answered. Ask your admin to resend them."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If the user is already a member of workspace and was deactivated then activate the user
        for invitation in workspace_invitations:
            invalidate_cache_directly(
                path=f"/api/workspaces/{invitation.workspace.slug}/members/",
                user=False,
                request=request,
                multiple=True,
            )
            # Update the WorkspaceMember for this specific invitation
            WorkspaceMember.objects.filter(workspace_id=invitation.workspace_id, member=request.user).update(
                is_active=True, role=invitation.role
            )

        # Bulk create the user for all the workspaces
        WorkspaceMember.objects.bulk_create(
            [
                WorkspaceMember(
                    workspace=invitation.workspace,
                    member=request.user,
                    role=invitation.role,
                    created_by=request.user,
                )
                for invitation in workspace_invitations
            ],
            ignore_conflicts=True,
        )

        # Delete joined workspace invites
        workspace_invitations.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)
