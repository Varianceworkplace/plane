# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Access control › People: disable, enable and permanently delete a member (plane.utils.member_removal),
and start a password reset for them."""

# Python imports
import logging

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.authentication.views.app.password_management import generate_password_token
from plane.bgtasks.forgot_password_task import forgot_password
from plane.db.models import Workspace
from plane.utils.host import base_host
from plane.utils.workspace_invites import email_is_configured
from plane.utils.member_removal import (
    RemovalError,
    check_can_act,
    deletion_summary,
    delete_member,
    disable_member,
    enable_member,
)

from .base import _uuid, can_manage_access, forbidden

WORKSPACE_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]


def _refused(error):
    return Response(
        {"error": error.message},
        status=status.HTTP_403_FORBIDDEN if error.forbidden else status.HTTP_400_BAD_REQUEST,
    )


def _workspace_for(request, slug):
    """The workspace, if the person may manage people in it (People tab)."""
    workspace = Workspace.objects.get(slug=slug)
    return workspace if can_manage_access(request.user, workspace) else None


class MemberDisableEndpoint(BaseAPIView):
    """POST: the person loses access everywhere at once; nothing of theirs changes."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug, member_id):
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return forbidden()
        try:
            disable_member(request.user, workspace, member_id)
        except RemovalError as error:
            return _refused(error)
        return Response({"member_id": str(member_id), "is_active": False}, status=status.HTTP_200_OK)


class MemberEnableEndpoint(BaseAPIView):
    """POST: a disabled person gets their access back, as it was."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug, member_id):
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return forbidden()
        try:
            enable_member(request.user, workspace, member_id)
        except RemovalError as error:
            return _refused(error)
        return Response({"member_id": str(member_id), "is_active": True}, status=status.HTTP_200_OK)


class MemberDeleteEndpoint(BaseAPIView):
    """GET: what deleting the person would do. POST {transfer_to}: delete them for good."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug, member_id):
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return forbidden()
        try:
            return Response(deletion_summary(request.user, workspace, member_id), status=status.HTTP_200_OK)
        except RemovalError as error:
            return _refused(error)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug, member_id):
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return forbidden()
        transfer_to = _uuid(request.data.get("transfer_to"))
        if transfer_to is None:
            return Response({"transfer_to": "Pick who takes over their work."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = delete_member(request.user, workspace, member_id, transfer_to)
        except RemovalError as error:
            return _refused(error)
        return Response(result, status=status.HTTP_200_OK)


__all__ = ["MemberDeleteEndpoint", "MemberDisableEndpoint", "MemberEnableEndpoint"]


class MemberPasswordResetEndpoint(BaseAPIView):
    """POST {"send": "email" | "link"}: Admin and HR start a password reset for someone they manage.

    Either the usual reset email goes to the person, or the link comes back to be shared another way (chat, in
    person) when email doesn't help. Both are the self-service reset link: it works once, for an hour, and the
    person chooses their own password, so nobody else ever knows it. Using it signs them out everywhere else. The
    same people as Disable / Delete may be reset (not yourself, owners or instance admins; HR not an admin)."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug, member_id):
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return forbidden()
        send = request.data.get("send")
        if send not in ("email", "link"):
            return Response({"error": "Choose to email the link or copy it."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            membership = check_can_act(request.user, workspace, member_id, doing="reset the password of")
        except RemovalError as error:
            return _refused(error)
        user = membership.member
        if not membership.is_active or not user.is_active:
            return Response(
                {"error": "They're disabled. Enable them first, then reset their password."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if send == "email" and not email_is_configured():
            return Response(
                {"error": "Email isn't set up, so the link can't be emailed. Copy it and share it instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        uidb64, token = generate_password_token(user=user)
        site = base_host(request=request, is_app=True)
        logging.getLogger("plane.api").info(
            "Password reset link issued",
            extra={"actor_id": str(request.user.id), "member_id": str(user.id), "send": send},
        )
        if send == "email":
            forgot_password.delay(user.first_name, user.email, uidb64, token, site)
            return Response(
                {"message": f"A reset link is on its way to {user.email}. It works once, for 1 hour."},
                status=status.HTTP_200_OK,
            )
        return Response(
            {
                "link": f"{site}/accounts/reset-password/?uidb64={uidb64}&token={token}&email={user.email}",
                "expires_in_minutes": 60,
            },
            status=status.HTTP_200_OK,
        )
