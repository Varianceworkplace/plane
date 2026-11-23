# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Who gets a sign-in code, a reset link or a sign-up form, and how many wrong passwords an account takes.

* A disabled member gets no sign-in code or reset link, and is told so at the email step.
* With sign-up off, a new address without an open invitation is told so at the email step and gets no code.
* Wrong passwords are counted per account, so changing addresses (or the X-Forwarded-For header) doesn't help;
  the god-mode sign-in is limited too.
"""

import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.cache import cache
from django.test import Client
from django.utils import timezone
from django.utils.encoding import smart_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from plane.authentication.utils.password_attempts import MAX_FAILED
from plane.db.models import Profile, User, Workspace, WorkspaceMember, WorkspaceMemberInvite
from plane.license.models import Instance, InstanceAdmin, InstanceConfiguration
from plane.settings.redis import redis_instance
from plane.utils.workspace_invites import INVITE_VALID_DAYS

UA = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:15.0) Gecko/20100101 Firefox/15.0.1"
DEACTIVATED, SIGNUP_DISABLED, RATE_LIMITED = "5019", "5015", "5900"


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def instance(db, monkeypatch):
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
    # email and sign-in codes are available (whether settings come from the database or the environment)
    for key, value in (("EMAIL_HOST", "smtp.acme.test"), ("ENABLE_MAGIC_LINK_LOGIN", "1"), ("ENABLE_SIGNUP", "1")):
        InstanceConfiguration.objects.update_or_create(key=key, defaults={"value": value, "category": "TEST"})
        monkeypatch.setenv(key, value)
    return instance


def _sign_up_off(monkeypatch):
    InstanceConfiguration.objects.update_or_create(key="ENABLE_SIGNUP", defaults={"value": "0", "category": "TEST"})
    monkeypatch.setenv("ENABLE_SIGNUP", "0")


def _user(email, password="Right-Passw0rd!xyz", disabled=False):
    user = User.objects.create(email=email, username=uuid.uuid4().hex)
    user.set_password(password)
    if disabled:
        # what Access control > People > Disable does
        user.is_active = False
        user.last_logout_time = timezone.now()
    user.save()
    Profile.objects.get_or_create(user=user)
    return user


def _email_check(email):
    return APIClient().post("/auth/email-check/", {"email": email}, format="json")


@pytest.mark.contract
class TestDisabledPeople:
    def test_told_at_the_email_step(self, instance):
        _user("gone@acme.test", disabled=True)
        response = _email_check("gone@acme.test")
        assert response.status_code == 400 and str(response.json()["error_code"]) == DEACTIVATED

    @patch("plane.bgtasks.magic_link_code_task.magic_link.delay")
    def test_no_sign_in_code(self, mail, instance):
        _user("gone@acme.test", disabled=True)
        redis_instance().delete("magic_gone@acme.test")
        response = APIClient().post("/auth/magic-generate/", {"email": "gone@acme.test"}, format="json")
        assert response.status_code == 400 and str(response.json()["error_code"]) == DEACTIVATED
        mail.assert_not_called()
        assert not redis_instance().get("magic_gone@acme.test")

    @patch("plane.authentication.views.app.password_management.forgot_password.delay")
    def test_no_reset_link(self, mail, instance):
        _user("gone@acme.test", disabled=True)
        response = APIClient().post("/auth/forgot-password/", {"email": "gone@acme.test"}, format="json")
        assert response.status_code == 400 and str(response.json()["error_code"]) == DEACTIVATED
        mail.assert_not_called()

    def test_an_old_reset_link_doesnt_reopen_the_account(self, instance):
        user = _user("gone@acme.test")
        uidb64 = urlsafe_base64_encode(smart_bytes(user.id))
        token = PasswordResetTokenGenerator().make_token(user)
        # disabled after the link was sent (is_active and last_logout_time aren't part of the token)
        User.objects.filter(id=user.id).update(is_active=False, last_logout_time=timezone.now())
        response = Client(HTTP_USER_AGENT=UA).post(
            f"/auth/reset-password/{uidb64}/{token}/", {"password": "N3w-Passw0rd!Lemon"}, follow=False
        )
        assert response.status_code == 302 and f"error_code={DEACTIVATED}" in response.url
        user.refresh_from_db()
        assert user.check_password("Right-Passw0rd!xyz")

    @patch("plane.authentication.views.app.password_management.forgot_password.delay")
    def test_active_people_still_get_their_link(self, mail, instance):
        _user("here@acme.test")
        response = APIClient().post("/auth/forgot-password/", {"email": "here@acme.test"}, format="json")
        assert response.status_code == 200
        mail.assert_called_once()


@pytest.mark.contract
class TestSignUpOff:
    def _invite(self, email, days_old=0):
        admin = _user(f"admin-{uuid.uuid4().hex[:6]}@acme.test")
        workspace = Workspace.objects.create(name="Acme", slug=f"acme-{uuid.uuid4().hex[:6]}", owner=admin)
        WorkspaceMember.objects.create(workspace=workspace, member=admin, role=20)
        invite = WorkspaceMemberInvite.objects.create(
            workspace=workspace, email=email, token=uuid.uuid4().hex, role=15, created_by=admin
        )
        if days_old:
            sent = timezone.now() - timedelta(days=days_old)
            WorkspaceMemberInvite.objects.filter(id=invite.id).update(updated_at=sent)
        return invite

    def test_a_new_address_without_an_invitation_is_told_at_once(self, instance, monkeypatch):
        _sign_up_off(monkeypatch)
        response = _email_check("stranger@elsewhere.test")
        assert response.status_code == 400 and str(response.json()["error_code"]) == SIGNUP_DISABLED

    @patch("plane.bgtasks.magic_link_code_task.magic_link.delay")
    def test_no_code_for_it_either(self, mail, instance, monkeypatch):
        _sign_up_off(monkeypatch)
        response = APIClient().post("/auth/magic-generate/", {"email": "stranger@elsewhere.test"}, format="json")
        assert response.status_code == 400 and str(response.json()["error_code"]) == SIGNUP_DISABLED
        mail.assert_not_called()

    def test_an_open_invitation_lets_them_in(self, instance, monkeypatch):
        _sign_up_off(monkeypatch)
        self._invite("new@acme.test")
        response = _email_check("new@acme.test")
        assert response.status_code == 200 and response.json()["existing"] is False

    def test_an_expired_invitation_doesnt(self, instance, monkeypatch):
        _sign_up_off(monkeypatch)
        self._invite("new@acme.test", days_old=INVITE_VALID_DAYS + 1)
        assert str(_email_check("new@acme.test").json()["error_code"]) == SIGNUP_DISABLED

    def test_with_sign_up_on_anyone_can_start(self, instance):
        response = _email_check("stranger@elsewhere.test")
        assert response.status_code == 200 and response.json()["existing"] is False

    def test_existing_people_sign_in_as_before(self, instance, monkeypatch):
        _sign_up_off(monkeypatch)
        _user("here@acme.test")
        assert _email_check("here@acme.test").json()["existing"] is True


def _sign_in(password, forwarded_for):
    client = Client(HTTP_USER_AGENT=UA)
    response = client.post(
        "/auth/sign-in/",
        {"email": "here@acme.test", "password": password},
        follow=False,
        HTTP_X_FORWARDED_FOR=forwarded_for,
    )
    return client, response


@pytest.mark.contract
class TestWrongPasswords:
    def test_counted_per_account_whatever_the_address(self, instance):
        _user("here@acme.test")
        for attempt in range(MAX_FAILED):
            # a different made-up address every time: the per-address limit never sees a repeat
            _, response = _sign_in("wrong-guess", f"203.0.113.{attempt + 1}")
            assert "error_code" in response.url and f"error_code={RATE_LIMITED}" not in response.url
        client, response = _sign_in("Right-Passw0rd!xyz", "198.51.100.7")
        assert f"error_code={RATE_LIMITED}" in response.url
        assert "_auth_user_id" not in client.session

    def test_a_successful_sign_in_clears_the_count(self, instance):
        _user("here@acme.test")
        for attempt in range(MAX_FAILED - 1):
            _sign_in("wrong-guess", f"203.0.113.{attempt + 1}")
        client, response = _sign_in("Right-Passw0rd!xyz", "198.51.100.7")
        assert "error_code" not in response.url and "_auth_user_id" in client.session
        _, again = _sign_in("wrong-guess", "198.51.100.8")
        assert f"error_code={RATE_LIMITED}" not in again.url

    def test_god_mode_sign_in_is_limited_too(self, instance):
        admin = _user("root@acme.test")
        InstanceAdmin.objects.create(instance=instance, user=admin, role=20)
        url = "/api/instances/admins/sign-in/"
        for attempt in range(MAX_FAILED):
            response = Client(HTTP_USER_AGENT=UA).post(
                url,
                {"email": "root@acme.test", "password": "wrong-guess"},
                HTTP_X_FORWARDED_FOR=f"203.0.113.{attempt + 1}",
            )
            assert f"error_code={RATE_LIMITED}" not in response.url
        response = Client(HTTP_USER_AGENT=UA).post(
            url, {"email": "root@acme.test", "password": "Right-Passw0rd!xyz"}, HTTP_X_FORWARDED_FOR="198.51.100.9"
        )
        assert f"error_code={RATE_LIMITED}" in response.url
