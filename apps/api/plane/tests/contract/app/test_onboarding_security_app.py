# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Joining a workspace safely.

* An invitation's role can't be raised above the requester's own (a Member can't turn an invite into an Admin).
* Joining by email match alone needs a confirmed email; the invitation link (its token) works either way.
* The first time someone proves they own an account's email (an emailed code, a password reset by email), whatever
  was set up without that proof goes: other sessions end and an unconfirmed password stops working.
* A sign-in keeps the whole next_path, query string included, so an invitation link survives it.
"""

import json
import uuid
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

import pytest
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.cache import cache
from django.test import Client
from django.utils import timezone
from django.utils.encoding import smart_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from plane.db.models import Profile, Session, User, Workspace, WorkspaceMember, WorkspaceMemberInvite
from plane.license.models import Instance
from plane.settings.redis import redis_instance
from plane.utils.path_validator import get_safe_redirect_url

ADMIN, MEMBER, GUEST = 20, 15, 5
UA = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:15.0) Gecko/20100101 Firefox/15.0.1"


@pytest.fixture(autouse=True)
def _clear_throttle():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def instance(db):
    instance, _ = Instance.objects.update_or_create(
        id=Instance.objects.first().id if Instance.objects.exists() else uuid.uuid4(),
        defaults={
            "instance_name": "Test Instance",
            "instance_id": str(uuid.uuid4()),
            "current_version": "1.0.0",
            "domain": "http://localhost:8000",
            "last_checked_at": timezone.now(),
            "is_setup_done": True,
        },
    )
    return instance


def _user(email, password="Str0ng-Passw0rd!x", verified=False):
    user = User.objects.create(email=email, username=uuid.uuid4().hex, is_email_verified=verified)
    user.set_password(password)
    user.is_password_autoset = False
    user.save()
    Profile.objects.get_or_create(user=user)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def org(db):
    admin = _user("admin@acme.test", verified=True)
    member = _user("member@acme.test", verified=True)
    workspace = Workspace.objects.create(name="Acme", slug="acme", owner=admin)
    WorkspaceMember.objects.create(workspace=workspace, member=admin, role=ADMIN)
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=MEMBER)
    return {"workspace": workspace, "admin": admin, "member": member}


def _invite(org, email, role=MEMBER):
    return WorkspaceMemberInvite.objects.create(
        workspace=org["workspace"], email=email, token=uuid.uuid4().hex, role=role, created_by=org["admin"]
    )


def _invite_url(invite):
    return f"/api/workspaces/acme/invitations/{invite.id}/"


@pytest.mark.contract
class TestInvitationRoles:
    def test_a_member_cant_turn_an_invitation_into_an_admin(self, org):
        invite = _invite(org, "new@acme.test", role=MEMBER)
        response = _client(org["member"]).patch(_invite_url(invite), {"role": ADMIN}, format="json")
        assert response.status_code == 403
        invite.refresh_from_db()
        assert invite.role == MEMBER

    def test_a_member_changes_roles_up_to_their_own(self, org):
        invite = _invite(org, "new@acme.test", role=GUEST)
        response = _client(org["member"]).patch(_invite_url(invite), {"role": MEMBER}, format="json")
        assert response.status_code == 200 and response.json()["role"] == MEMBER
        # but not an invitation that's already above them
        admin_invite = _invite(org, "boss@acme.test", role=ADMIN)
        response = _client(org["member"]).patch(_invite_url(admin_invite), {"role": GUEST}, format="json")
        assert response.status_code == 403

    def test_an_admin_can_give_any_role(self, org):
        invite = _invite(org, "new@acme.test", role=MEMBER)
        assert _client(org["admin"]).patch(_invite_url(invite), {"role": ADMIN}, format="json").status_code == 200
        invite.refresh_from_db()
        assert invite.role == ADMIN

    def test_only_the_role_of_a_pending_invitation_changes(self, org):
        invite = _invite(org, "new@acme.test", role=MEMBER)
        client = _client(org["admin"])
        assert client.patch(_invite_url(invite), {"role": 7}, format="json").status_code == 400
        assert client.patch(_invite_url(invite), {"accepted": True}, format="json").status_code == 400
        response = client.patch(_invite_url(invite), {"role": GUEST, "accepted": True, "token": "x"}, format="json")
        assert response.status_code == 200
        invite.refresh_from_db()
        assert invite.role == GUEST and invite.accepted is False and invite.token != "x"
        invite.responded_at = timezone.now()
        invite.save()
        assert client.patch(_invite_url(invite), {"role": MEMBER}, format="json").status_code == 400


@pytest.mark.contract
class TestJoiningNeedsProof:
    def test_email_match_alone_needs_a_confirmed_email(self, org):
        invite = _invite(org, "new@acme.test", role=ADMIN)
        squatter = _user("new@acme.test", verified=False)  # signed up with a password, never proved the address
        response = _client(squatter).post(
            "/api/users/me/workspaces/invitations/", {"invitations": [str(invite.id)]}, format="json"
        )
        assert response.status_code == 403 and "invitation link" in response.json()["error"]
        assert not WorkspaceMember.objects.filter(member=squatter).exists()
        assert WorkspaceMemberInvite.objects.filter(id=invite.id).exists()

    def test_a_confirmed_email_joins_from_the_list(self, org):
        invite = _invite(org, "new@acme.test", role=MEMBER)
        person = _user("new@acme.test", verified=True)
        response = _client(person).post(
            "/api/users/me/workspaces/invitations/", {"invitations": [str(invite.id)]}, format="json"
        )
        assert response.status_code == 204
        assert WorkspaceMember.objects.get(member=person, workspace=org["workspace"]).role == MEMBER

    def test_the_invitation_link_works_without_a_confirmed_email(self, org):
        invite = _invite(org, "new@acme.test", role=MEMBER)
        person = _user("new@acme.test", verified=False)
        url = f"/api/workspaces/acme/invitations/{invite.id}/join/"
        assert _client(person).post(url, {"accepted": True, "token": "wrong"}, format="json").status_code == 403
        response = _client(person).post(url, {"accepted": True, "token": invite.token}, format="json")
        assert response.status_code == 200
        assert WorkspaceMember.objects.filter(member=person, workspace=org["workspace"], is_active=True).exists()


def _password_sign_in(email, password):
    client = Client(HTTP_USER_AGENT=UA)
    response = client.post("/auth/sign-in/", {"email": email, "password": password}, follow=False)
    return client, response


@pytest.mark.contract
class TestFirstProofOfTheEmail:
    @patch("plane.bgtasks.magic_link_code_task.magic_link.delay")
    def test_a_code_sign_in_ends_what_was_set_up_without_proof(self, _mail, org, instance):
        squatter_password = "Squ4tter-Passw0rd!"
        account = _user("new@acme.test", password=squatter_password, verified=False)
        squatter, response = _password_sign_in("new@acme.test", squatter_password)
        assert "_auth_user_id" in squatter.session
        assert Session.objects.filter(user_id=str(account.id)).count() == 1

        # the real owner signs in with a code from their inbox
        redis_instance().delete("magic_new@acme.test")
        assert APIClient().post("/auth/magic-generate/", {"email": "new@acme.test"}, format="json").status_code == 200
        code = json.loads(redis_instance().get("magic_new@acme.test"))["token"]
        owner = Client(HTTP_USER_AGENT=UA)
        response = owner.post("/auth/magic-sign-in/", {"email": "new@acme.test", "code": code}, follow=False)
        assert response.status_code == 302 and "error_code" not in response.url

        account.refresh_from_db()
        assert account.is_email_verified is True and account.is_password_autoset is True
        # the squatter's session is gone and their password no longer works
        assert Session.objects.filter(user_id=str(account.id)).count() == 1
        assert squatter.get("/api/users/me/").status_code in (401, 403)
        _, again = _password_sign_in("new@acme.test", squatter_password)
        assert "error_code" in again.url

    def test_a_password_reset_by_email_confirms_it_and_ends_old_sessions(self, org, instance):
        account = _user("new@acme.test", password="Old-Passw0rd!xyz", verified=False)
        old, _ = _password_sign_in("new@acme.test", "Old-Passw0rd!xyz")
        assert Session.objects.filter(user_id=str(account.id)).count() == 1

        account.refresh_from_db()  # the sign-in changed last_login, which the reset token is tied to
        uidb64 = urlsafe_base64_encode(smart_bytes(account.id))
        token = PasswordResetTokenGenerator().make_token(account)
        response = Client(HTTP_USER_AGENT=UA).post(
            f"/auth/reset-password/{uidb64}/{token}/", {"password": "N3w-Passw0rd!Lemon"}, follow=False
        )
        assert response.status_code == 302 and "error_code" not in response.url
        account.refresh_from_db()
        assert account.is_email_verified is True and account.check_password("N3w-Passw0rd!Lemon")
        assert not Session.objects.filter(user_id=str(account.id)).exists()
        assert old.get("/api/users/me/").status_code in (401, 403)

    def test_a_confirmed_account_keeps_its_password_and_sessions(self, org, instance):
        account = _user("member2@acme.test", password="Keep-Passw0rd!xyz", verified=True)
        first, _ = _password_sign_in("member2@acme.test", "Keep-Passw0rd!xyz")
        second, _ = _password_sign_in("member2@acme.test", "Keep-Passw0rd!xyz")
        assert Session.objects.filter(user_id=str(account.id)).count() == 2
        assert first.get("/api/users/me/").status_code == 200


@pytest.mark.contract
class TestTheWayBackAfterSignIn:
    def test_next_path_keeps_its_query_string(self):
        link = "/workspace-invitations/?invitation_id=abc&slug=acme&token=t.o-k_en"
        url = get_safe_redirect_url("http://localhost:3000", link)
        assert parse_qs(urlparse(url).query)["next_path"] == [link]

    @patch("plane.bgtasks.magic_link_code_task.magic_link.delay")
    def test_an_onboarded_code_user_goes_back_to_the_invitation(self, _mail, org, instance):
        person = User.objects.create(email="new@acme.test", username=uuid.uuid4().hex, is_email_verified=True)
        person.set_password(uuid.uuid4().hex)
        person.is_password_autoset = True
        person.save()
        Profile.objects.create(user=person, is_onboarded=True)
        redis_instance().delete("magic_new@acme.test")
        APIClient().post("/auth/magic-generate/", {"email": "new@acme.test"}, format="json")
        code = json.loads(redis_instance().get("magic_new@acme.test"))["token"]
        link = "/workspace-invitations/?invitation_id=abc&slug=acme&token=tok"
        response = Client(HTTP_USER_AGENT=UA).post(
            "/auth/magic-sign-in/", {"email": "new@acme.test", "code": code, "next_path": link}, follow=False
        )
        assert parse_qs(urlparse(response.url).query)["next_path"] == [link]
