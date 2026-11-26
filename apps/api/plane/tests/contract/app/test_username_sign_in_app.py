# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Signing in with a username, and setting a first password (plane.authentication.utils.login_identifier).

* The sign-in box takes a username (any case) as well as an email address, for the password, the sign-in code and
  "Forgot password?". What goes back to the browser keeps what was typed: a username never shows its email address.
* After the username or email, the password step comes next. Someone who has never had a password (brought over
  from the old CRM) is told so, and offered the emailed link (worded "set your password") or a sign-in code; a code
  sign-in then offers the set-password page. Only with passwords switched off does a code go out straight away.
* The reset link keeps working after a refused password, and lands back on sign-in saying the password is saved.
"""

import html
import json
import uuid
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core import mail
from django.core.cache import cache
from django.test import Client
from django.utils import timezone
from django.utils.encoding import smart_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from plane.bgtasks.forgot_password_task import forgot_password
from plane.db.models import Profile, User
from plane.license.models import Instance, InstanceConfiguration
from plane.settings.redis import redis_instance

UA = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:15.0) Gecko/20100101 Firefox/15.0.1"
PASSWORD = "Right-Passw0rd!xyz"
USER_DOES_NOT_EXIST, AUTH_FAILED, DEACTIVATED, TOO_WEAK = "5060", "5065", "5019", "5021"
INVALID_EMAIL_SIGN_IN = "5075"
RESET_TASK = "plane.authentication.views.app.password_management.forgot_password.delay"
CODE_TASK = "plane.bgtasks.magic_link_code_task.magic_link.delay"


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    yield
    cache.clear()


def _config(monkeypatch, key, value):
    # settings come from the database or the environment: set both
    InstanceConfiguration.objects.update_or_create(key=key, defaults={"value": value, "category": "TEST"})
    monkeypatch.setenv(key, value)


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
    # email, sign-in codes and passwords are all on, as on production
    for key, value in (
        ("EMAIL_HOST", "smtp.acme.test"),
        ("ENABLE_MAGIC_LINK_LOGIN", "1"),
        ("ENABLE_EMAIL_PASSWORD", "1"),
        ("ENABLE_SIGNUP", "1"),
    ):
        _config(monkeypatch, key, value)
    return instance


def _person(username="aryanp", email="aryan.p@acme.test", password=PASSWORD, onboarded=True, disabled=False):
    """Someone with a password; password=None: never had one (as the old CRM's staff were brought over)."""
    user = User.objects.create(email=email, username=username)
    if password:
        user.set_password(password)
        user.is_password_autoset = False
        # a password someone really uses: the address is proven (a first code sign-in on an unproven address
        # drops a password set before it, see confirm_email_ownership)
        user.is_email_verified = True
    else:
        user.set_password(uuid.uuid4().hex)
        user.is_password_autoset = True
    if disabled:
        user.is_active = False
        user.last_logout_time = timezone.now()
    user.save()
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.is_onboarded = onboarded
    profile.save()
    return user


def _email_check(value):
    return APIClient().post("/auth/email-check/", {"email": value}, format="json")


def _sign_in(identifier, password):
    client = Client(HTTP_USER_AGENT=UA)
    response = client.post("/auth/sign-in/", {"email": identifier, "password": password}, follow=False)
    return client, response


def _query(url):
    return {key: values[0] for key, values in parse_qs(urlparse(url).query).items()}


@pytest.mark.contract
class TestTheFirstStep:
    def test_a_username_finds_the_account(self, instance):
        _person()
        response = _email_check("aryanp")
        assert response.status_code == 200
        assert response.json() == {"existing": True, "status": "CREDENTIAL", "is_password_autoset": False}

    def test_in_any_case(self, instance):
        _person()
        assert _email_check("  AryanP ").json()["existing"] is True

    def test_its_email_address_is_never_shown(self, instance):
        _person()
        assert "aryan.p@acme.test" not in _email_check("aryanp").content.decode()

    def test_an_unknown_username_is_told_at_once(self, instance):
        response = _email_check("nobody")
        assert response.status_code == 400 and str(response.json()["error_code"]) == USER_DOES_NOT_EXIST

    def test_email_addresses_work_as_before(self, instance):
        _person()
        assert _email_check("Aryan.P@acme.test").json()["status"] == "CREDENTIAL"
        new = _email_check("someone.new@acme.test").json()
        assert new["existing"] is False and new["status"] == "MAGIC_CODE"

    def test_a_disabled_account_is_told_by_username_too(self, instance):
        _person(disabled=True)
        response = _email_check("aryanp")
        assert response.status_code == 400 and str(response.json()["error_code"]) == DEACTIVATED

    @patch(CODE_TASK)
    def test_without_a_password_the_password_step_still_comes_next(self, code, instance):
        _person(password=None)
        response = _email_check("aryanp").json()
        assert response == {"existing": True, "status": "CREDENTIAL", "is_password_autoset": True}
        code.assert_not_called()

    def test_with_passwords_off_a_code_goes_out_as_before(self, instance, monkeypatch):
        _config(monkeypatch, "ENABLE_EMAIL_PASSWORD", "0")
        _person(password=None)
        assert _email_check("aryanp").json()["status"] == "MAGIC_CODE"


@pytest.mark.contract
class TestPasswordSignIn:
    def test_username_and_password(self, instance):
        _person()
        client, response = _sign_in("aryanp", PASSWORD)
        assert response.status_code == 302 and "error_code" not in response.url
        assert "_auth_user_id" in client.session

    def test_in_any_case(self, instance):
        _person()
        client, response = _sign_in("ARYANP", PASSWORD)
        assert "error_code" not in response.url and "_auth_user_id" in client.session

    def test_email_and_password_as_before(self, instance):
        _person()
        client, response = _sign_in("aryan.p@acme.test", PASSWORD)
        assert "error_code" not in response.url and "_auth_user_id" in client.session

    def test_a_wrong_password_comes_back_with_the_username_not_the_address(self, instance):
        _person()
        client, response = _sign_in("aryanp", "Wrong-Passw0rd!xyz")
        params = _query(response.url)
        assert params["error_code"] == AUTH_FAILED and params["email"] == "aryanp"
        assert "acme.test" not in response.url
        assert "_auth_user_id" not in client.session

    def test_an_unknown_username(self, instance):
        # as any input that isn't an email address got before (the first step already says no such username)
        client, response = _sign_in("nobody", PASSWORD)
        params = _query(response.url)
        assert params["error_code"] == INVALID_EMAIL_SIGN_IN and params["email"] == "nobody"
        assert "_auth_user_id" not in client.session

    def test_no_password_yet_means_no_sign_in_with_one(self, instance):
        _person(password=None)
        client, response = _sign_in("aryanp", PASSWORD)
        assert _query(response.url)["error_code"] == AUTH_FAILED
        assert "_auth_user_id" not in client.session


@pytest.mark.contract
class TestSignInCode:
    def _code_for(self, email):
        return json.loads(redis_instance().get(f"magic_{email}"))["token"]

    @patch(CODE_TASK)
    def test_a_code_by_username_goes_to_the_account_address(self, code, instance):
        _person()
        response = APIClient().post("/auth/magic-generate/", {"email": "aryanp"}, format="json")
        assert response.status_code == 200
        assert code.call_args[0][0] == "aryan.p@acme.test"
        assert "acme.test" not in response.content.decode()

    @patch(CODE_TASK)
    def test_an_unknown_username_gets_no_code(self, code, instance):
        response = APIClient().post("/auth/magic-generate/", {"email": "nobody"}, format="json")
        assert response.status_code == 400 and str(response.json()["error_code"]) == USER_DOES_NOT_EXIST
        code.assert_not_called()

    @patch(CODE_TASK)
    def test_signing_in_with_it_offers_to_set_a_password(self, code, instance):
        _person(password=None)
        APIClient().post("/auth/magic-generate/", {"email": "aryanp"}, format="json")
        client = Client(HTTP_USER_AGENT=UA)
        response = client.post(
            "/auth/magic-sign-in/", {"email": "aryanp", "code": self._code_for("aryan.p@acme.test")}, follow=False
        )
        assert "error_code" not in response.url and "_auth_user_id" in client.session
        assert _query(response.url)["next_path"] == "/accounts/set-password"

    @patch(CODE_TASK)
    def test_with_passwords_off_it_doesnt(self, code, instance, monkeypatch):
        _config(monkeypatch, "ENABLE_EMAIL_PASSWORD", "0")
        _person(password=None)
        APIClient().post("/auth/magic-generate/", {"email": "aryan.p@acme.test"}, format="json")
        client = Client(HTTP_USER_AGENT=UA)
        response = client.post(
            "/auth/magic-sign-in/",
            {"email": "aryan.p@acme.test", "code": self._code_for("aryan.p@acme.test")},
            follow=False,
        )
        assert "_auth_user_id" in client.session
        assert "set-password" not in response.url

    @patch(CODE_TASK)
    def test_someone_with_a_password_goes_on_as_before(self, code, instance):
        _person()
        APIClient().post("/auth/magic-generate/", {"email": "aryanp"}, format="json")
        client = Client(HTTP_USER_AGENT=UA)
        response = client.post(
            "/auth/magic-sign-in/", {"email": "aryanp", "code": self._code_for("aryan.p@acme.test")}, follow=False
        )
        assert "_auth_user_id" in client.session and "set-password" not in response.url

    @patch(CODE_TASK)
    def test_a_wrong_code_comes_back_with_the_username(self, code, instance):
        _person()
        APIClient().post("/auth/magic-generate/", {"email": "aryanp"}, format="json")
        client = Client(HTTP_USER_AGENT=UA)
        response = client.post("/auth/magic-sign-in/", {"email": "aryanp", "code": "nope"}, follow=False)
        assert "error_code" in response.url and "acme.test" not in response.url
        assert "_auth_user_id" not in client.session


@pytest.mark.contract
class TestForgotPassword:
    @patch(RESET_TASK)
    def test_by_username_the_link_goes_to_the_account_address(self, reset, instance):
        _person()
        response = APIClient().post("/auth/forgot-password/", {"email": "aryanp"}, format="json")
        assert response.status_code == 200 and "acme.test" not in response.content.decode()
        assert reset.call_args[0][1] == "aryan.p@acme.test"
        assert reset.call_args[1] == {"first_time": False}

    @patch(RESET_TASK)
    def test_a_first_password_is_worded_as_one(self, reset, instance):
        _person(password=None)
        APIClient().post("/auth/forgot-password/", {"email": "aryanp"}, format="json")
        assert reset.call_args[1] == {"first_time": True}

    @patch(RESET_TASK)
    def test_an_unknown_username_gets_nothing(self, reset, instance):
        response = APIClient().post("/auth/forgot-password/", {"email": "nobody"}, format="json")
        assert response.status_code == 400 and str(response.json()["error_code"]) == USER_DOES_NOT_EXIST
        reset.assert_not_called()

    def test_the_first_password_email(self, instance, monkeypatch):
        _config(monkeypatch, "EMAIL_PORT", "587")
        forgot_password("Aryan", "aryan.p@acme.test", "uid", "tok", "http://app.test", first_time=True)
        assert len(mail.outbox) == 1
        message = mail.outbox[0]
        assert message.subject == "Set your Variance password"
        body = html.unescape(message.alternatives[0][0])
        assert "uidb64=uid&token=tok&email=aryan.p@acme.test&setup=1" in body
        assert "Set your Variance password" in body and "Reset your Variance password" not in body

    def test_the_reset_email_as_before(self, instance, monkeypatch):
        _config(monkeypatch, "EMAIL_PORT", "587")
        forgot_password("Aryan", "aryan.p@acme.test", "uid", "tok", "http://app.test")
        message = mail.outbox[0]
        assert message.subject == "A new password to your Variance account has been requested"
        body = html.unescape(message.alternatives[0][0])
        assert "setup=1" not in body and "Reset your Variance password" in body


@pytest.mark.contract
class TestSettingItWithTheLink:
    def _link(self, user):
        return urlsafe_base64_encode(smart_bytes(user.id)), PasswordResetTokenGenerator().make_token(user)

    def test_then_username_and_new_password_sign_in(self, instance):
        user = _person(password=None)
        uidb64, token = self._link(user)
        response = Client(HTTP_USER_AGENT=UA).post(
            f"/auth/reset-password/{uidb64}/{token}/", {"password": "N3w-Passw0rd!Lemon", "setup": "1"}, follow=False
        )
        params = _query(response.url)
        assert params == {"password_saved": "1", "email": "aryan.p@acme.test"}
        user.refresh_from_db()
        assert user.is_password_autoset is False
        assert _email_check("aryanp").json()["is_password_autoset"] is False
        client, response = _sign_in("aryanp", "N3w-Passw0rd!Lemon")
        assert "error_code" not in response.url and "_auth_user_id" in client.session

    def test_a_weak_password_keeps_the_link(self, instance):
        user = _person(password=None)
        uidb64, token = self._link(user)
        response = Client(HTTP_USER_AGENT=UA).post(
            f"/auth/reset-password/{uidb64}/{token}/", {"password": "password", "setup": "1"}, follow=False
        )
        params = _query(response.url)
        assert params["error_code"] == TOO_WEAK
        assert (params["uidb64"], params["token"], params["setup"]) == (uidb64, token, "1")
        user.refresh_from_db()
        assert user.is_password_autoset is True

    def test_a_used_link_doesnt_work_again(self, instance):
        user = _person(password=None)
        uidb64, token = self._link(user)
        client = Client(HTTP_USER_AGENT=UA)
        client.post(f"/auth/reset-password/{uidb64}/{token}/", {"password": "N3w-Passw0rd!Lemon"}, follow=False)
        response = client.post(
            f"/auth/reset-password/{uidb64}/{token}/", {"password": "An0ther-Passw0rd!Pear"}, follow=False
        )
        params = _query(response.url)
        assert "error_code" in params and "uidb64" not in params
        user.refresh_from_db()
        assert user.check_password("N3w-Passw0rd!Lemon")
