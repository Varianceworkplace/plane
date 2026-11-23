# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sending workspace invitations (plane/app/views/workspace/invite.py, plane/utils/workspace_invites.py).

* The inviter is told the truth: whether emails can go out at all, and later whether each one did.
* Inviting someone again sends their invitation again instead of silently doing nothing; Resend does the same.
* An invitation stays open for a week after it was last sent; after that it can't be joined, doesn't count as
  waiting, and no longer opens sign-up.
"""

import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.authentication.utils.redirection_path import get_redirection_path
from plane.bgtasks.workspace_invitation_task import workspace_invitation
from plane.db.models import Profile, User, Workspace, WorkspaceMember, WorkspaceMemberInvite
from plane.utils.workspace_invites import INVITE_VALID_DAYS, invite_email_status, record_invite_email

ADMIN, MEMBER, GUEST = 20, 15, 5
VIEW = "plane.app.views.workspace.invite"


def _user(email, verified=True):
    user = User.objects.create(email=email, username=uuid.uuid4().hex, is_email_verified=verified)
    user.set_password(uuid.uuid4().hex)
    user.save()
    Profile.objects.get_or_create(user=user)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def org(db):
    admin = _user("admin@acme.test")
    member = _user("member@acme.test")
    workspace = Workspace.objects.create(name="Acme", slug="acme", owner=admin)
    WorkspaceMember.objects.create(workspace=workspace, member=admin, role=ADMIN)
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=MEMBER)
    return {"workspace": workspace, "admin": admin, "member": member}


def _invite(org, emails):
    return _client(org["admin"]).post(
        "/api/workspaces/acme/invitations/", {"emails": [{"email": e, "role": r} for e, r in emails]}, format="json"
    )


def _listed(org):
    response = _client(org["admin"]).get("/api/workspaces/acme/invitations/")
    assert response.status_code == 200
    return {row["email"]: row for row in response.json()}


def _age(invite, days):
    # updated_at is set on save, so back-date it directly
    WorkspaceMemberInvite.objects.filter(id=invite.id).update(updated_at=timezone.now() - timedelta(days=days))


@pytest.mark.contract
class TestSending:
    @patch(f"{VIEW}.workspace_invitation.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=False)
    def test_without_email_set_up_the_inviter_is_told(self, _configured, delay, org):
        response = _invite(org, [("new@acme.test", MEMBER)])
        assert response.status_code == 200
        body = response.json()
        assert body["email_configured"] is False and "isn't set up" in body["message"]
        delay.assert_not_called()
        row = _listed(org)["new@acme.test"]
        assert row["email_status"]["status"] == "not_configured"
        assert row["is_expired"] is False and row["expires_at"]

    @patch(f"{VIEW}.workspace_invitation.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_with_email_set_up_each_invitation_is_emailed(self, _configured, delay, org):
        response = _invite(org, [("new@acme.test", MEMBER), ("two@acme.test", GUEST)])
        assert response.json()["message"] == "Sending 2 invitations by email."
        assert delay.call_count == 2

    @patch(f"{VIEW}.workspace_invitation.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_inviting_again_sends_it_again(self, _configured, delay, org):
        _invite(org, [("new@acme.test", GUEST)])
        invite = WorkspaceMemberInvite.objects.get(email="new@acme.test")
        token = invite.token
        _age(invite, INVITE_VALID_DAYS + 1)
        response = _invite(org, [("new@acme.test", MEMBER)])
        assert response.status_code == 200 and response.json()["resent"] == ["new@acme.test"]
        assert "already invited" in response.json()["message"]
        assert WorkspaceMemberInvite.objects.filter(email="new@acme.test").count() == 1
        invite.refresh_from_db()
        # same link, new role, open again
        assert invite.token == token and invite.role == MEMBER
        assert _listed(org)["new@acme.test"]["is_expired"] is False
        assert delay.call_count == 2

    @patch(f"{VIEW}.workspace_invitation.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_the_same_address_twice_counts_once(self, _configured, delay, org):
        response = _invite(org, [("new@acme.test", GUEST), ("New@Acme.test ", MEMBER)])
        assert response.status_code == 200 and response.json()["invited"] == ["new@acme.test"]
        assert WorkspaceMemberInvite.objects.get(email="new@acme.test").role == MEMBER
        assert delay.call_count == 1

    @patch(f"{VIEW}.workspace_invitation.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_a_declined_invitation_can_be_sent_again(self, _configured, delay, org):
        _invite(org, [("new@acme.test", MEMBER)])
        WorkspaceMemberInvite.objects.filter(email="new@acme.test").update(responded_at=timezone.now())
        _invite(org, [("new@acme.test", MEMBER)])
        assert WorkspaceMemberInvite.objects.get(email="new@acme.test").responded_at is None

    @patch(f"{VIEW}.workspace_invitation.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_a_member_cant_reinvite_over_a_higher_invitation(self, _configured, delay, org):
        _invite(org, [("boss@acme.test", ADMIN)])
        response = _client(org["member"]).post(
            "/api/workspaces/acme/invitations/", {"emails": [{"email": "boss@acme.test", "role": GUEST}]}, format="json"
        )
        assert response.status_code == 400
        assert WorkspaceMemberInvite.objects.get(email="boss@acme.test").role == ADMIN


@pytest.mark.contract
class TestResend:
    @patch(f"{VIEW}.workspace_invitation.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_resend_reopens_and_emails_it(self, _configured, delay, org):
        _invite(org, [("new@acme.test", MEMBER)])
        invite = WorkspaceMemberInvite.objects.get(email="new@acme.test")
        _age(invite, INVITE_VALID_DAYS + 2)
        assert _listed(org)["new@acme.test"]["is_expired"] is True
        response = _client(org["admin"]).post(f"/api/workspaces/acme/invitations/{invite.id}/resend/")
        assert response.status_code == 200 and "sent again" in response.json()["message"]
        assert response.json()["is_expired"] is False
        assert delay.call_count == 2

    @patch(f"{VIEW}.workspace_invitation.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_a_member_cant_resend_a_higher_invitation(self, _configured, delay, org):
        _invite(org, [("boss@acme.test", ADMIN)])
        invite = WorkspaceMemberInvite.objects.get(email="boss@acme.test")
        response = _client(org["member"]).post(f"/api/workspaces/acme/invitations/{invite.id}/resend/")
        assert response.status_code == 403


@pytest.mark.contract
class TestExpiry:
    def _pending(self, org, email="new@acme.test"):
        return WorkspaceMemberInvite.objects.create(
            workspace=org["workspace"], email=email, token=uuid.uuid4().hex, role=MEMBER, created_by=org["admin"]
        )

    def test_an_expired_link_cant_be_used(self, org):
        invite = self._pending(org)
        person = _user("new@acme.test")
        _age(invite, INVITE_VALID_DAYS + 1)
        url = f"/api/workspaces/acme/invitations/{invite.id}/join/"
        response = _client(person).post(url, {"accepted": True, "token": invite.token}, format="json")
        assert response.status_code == 400 and "expired" in response.json()["error"]
        assert not WorkspaceMember.objects.filter(member=person).exists()
        # the public page can say so
        public = APIClient().get(url)
        assert public.json()["is_expired"] is True

    def test_expired_invitations_arent_offered_or_joinable(self, org):
        invite = self._pending(org)
        person = _user("new@acme.test")
        client = _client(person)
        assert len(client.get("/api/users/me/workspaces/invitations/").json()) == 1
        _age(invite, INVITE_VALID_DAYS + 1)
        assert client.get("/api/users/me/workspaces/invitations/").json() == []
        response = client.post(
            "/api/users/me/workspaces/invitations/", {"invitations": [str(invite.id)]}, format="json"
        )
        assert response.status_code == 400 and "expired" in response.json()["error"]

    def test_only_open_invitations_send_someone_to_their_invitations(self, org):
        invite = self._pending(org)
        person = _user("new@acme.test")
        Profile.objects.filter(user=person).update(is_onboarded=True)
        assert get_redirection_path(person) == "invitations"
        _age(invite, INVITE_VALID_DAYS + 1)
        assert get_redirection_path(person) == "create-workspace"


@pytest.mark.contract
class TestEmailOutcome:
    def test_the_job_notes_a_failed_email(self, org):
        invite = WorkspaceMemberInvite.objects.create(
            workspace=org["workspace"], email="new@acme.test", token="tok-1", role=MEMBER, created_by=org["admin"]
        )
        config = ("smtp.acme.test", "user", "secret", "587", "1", "0", "hr@acme.test")
        with (
            patch("plane.bgtasks.workspace_invitation_task.get_email_configuration", return_value=config),
            patch(
                "plane.bgtasks.workspace_invitation_task.EmailMultiAlternatives.send", side_effect=OSError("refused")
            ),
        ):
            workspace_invitation("new@acme.test", org["workspace"].id, "tok-1", "http://localhost", "admin@acme.test")
        status = invite_email_status(invite.id)
        assert status["status"] == "failed" and "refused" in status["error"]

    def test_the_job_notes_a_sent_email_and_no_email_setup(self, org):
        invite = WorkspaceMemberInvite.objects.create(
            workspace=org["workspace"], email="new@acme.test", token="tok-2", role=MEMBER, created_by=org["admin"]
        )
        config = ("smtp.acme.test", "user", "secret", "587", "1", "0", "hr@acme.test")
        with (
            patch("plane.bgtasks.workspace_invitation_task.get_email_configuration", return_value=config),
            patch("plane.bgtasks.workspace_invitation_task.EmailMultiAlternatives.send"),
        ):
            workspace_invitation("new@acme.test", org["workspace"].id, "tok-2", "http://localhost", "admin@acme.test")
        assert invite_email_status(invite.id)["status"] == "sent"
        record_invite_email(invite.id, "sent")  # (and an unset email host is noted without trying)
        with patch(
            "plane.bgtasks.workspace_invitation_task.get_email_configuration",
            return_value=("", "", "", "587", "", "", ""),
        ):
            workspace_invitation("new@acme.test", org["workspace"].id, "tok-2", "http://localhost", "admin@acme.test")
        assert invite_email_status(invite.id)["status"] == "not_configured"
