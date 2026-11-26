# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Access control › People › Reset password (plane.app.views.rbac.member_status.MemberPasswordResetEndpoint).

Admin and HR start a reset for someone they manage: the usual reset email goes to them, or the link comes back to be
shared another way. Either way they choose their own password with it. The same people as Disable / Delete may be
reset: not yourself, the workspace owner or an instance admin; HR not another admin; nobody disabled.
"""

import uuid
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.cache import cache
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import Session, User, WorkspaceMember
from plane.license.models import Instance
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import sync_project_access

VIEW = "plane.app.views.rbac.member_status"
UA = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:15.0) Gecko/20100101 Firefox/15.0.1"


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def setup(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return {**org, "clients": clients}


def _reset(setup, actor, who, send="link"):
    member = setup["people"][who] if isinstance(who, str) else who
    url = f"/api/workspaces/{setup['workspace'].slug}/access-control/members/{member.id}/password-reset/"
    return setup["clients"][actor].post(url, {"send": send}, format="json")


@pytest.mark.contract
class TestWhoCanReset:
    def test_hr_and_admins_can(self, setup):
        assert _reset(setup, "hr", "a1").status_code == 200
        assert _reset(setup, "admin", "pm_b").status_code == 200

    def test_pms_and_employees_cant(self, setup):
        assert _reset(setup, "pm_a", "a1").status_code == 403
        assert _reset(setup, "a2", "a1").status_code == 403

    def test_not_yourself_the_owner_or_another_admin(self, setup):
        assert _reset(setup, "hr", "hr").status_code == 400
        # the workspace admin here owns the workspace
        assert _reset(setup, "hr", "admin").status_code in (400, 403)
        second_admin = User.objects.create(email="admin2@acme.test", username=uuid.uuid4().hex)
        WorkspaceMember.objects.create(workspace=setup["workspace"], member=second_admin, role=20)
        response = _reset(setup, "hr", second_admin)
        assert response.status_code == 403 and "admin" in response.json()["error"]
        assert _reset(setup, "admin", second_admin).status_code == 200

    def test_not_someone_disabled(self, setup):
        a1 = setup["people"]["a1"]
        WorkspaceMember.objects.filter(workspace=setup["workspace"], member=a1).update(is_active=False)
        User.objects.filter(id=a1.id).update(is_active=False, last_logout_time=timezone.now())
        response = _reset(setup, "hr", "a1")
        assert response.status_code == 400 and "Enable them first" in response.json()["error"]

    def test_email_or_link_only(self, setup):
        assert _reset(setup, "hr", "a1", send="password").status_code == 400


@pytest.mark.contract
class TestTheLink:
    @patch(f"{VIEW}.forgot_password.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_emailing_it(self, _configured, mail, setup):
        response = _reset(setup, "hr", "a1", send="email")
        assert response.status_code == 200 and setup["people"]["a1"].email in response.json()["message"]
        assert "link" not in response.json()
        assert mail.call_args[0][1] == setup["people"]["a1"].email

    @patch(f"{VIEW}.forgot_password.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_someone_who_never_had_a_password_is_asked_to_set_one(self, _configured, mail, setup):
        a1 = setup["people"]["a1"]
        User.objects.filter(id=a1.id).update(is_password_autoset=True)
        _reset(setup, "hr", "a1", send="email")
        assert mail.call_args[1] == {"first_time": True}
        link = _reset(setup, "hr", "a1").json()["link"]
        assert parse_qs(urlparse(link).query)["setup"] == ["1"]

    @patch(f"{VIEW}.forgot_password.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=True)
    def test_someone_with_a_password_gets_the_reset_wording(self, _configured, mail, setup):
        _reset(setup, "hr", "a1", send="email")
        assert mail.call_args[1] == {"first_time": False}
        assert "setup" not in _reset(setup, "hr", "a1").json()["link"]

    @patch(f"{VIEW}.forgot_password.delay")
    @patch(f"{VIEW}.email_is_configured", return_value=False)
    def test_without_email_set_up_it_can_only_be_copied(self, _configured, mail, setup):
        response = _reset(setup, "hr", "a1", send="email")
        assert response.status_code == 400 and "Copy" in response.json()["error"]
        mail.assert_not_called()

    def test_the_copied_link_lets_them_choose_a_password_and_signs_them_out(self, setup):
        Instance.objects.update_or_create(
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
        a1 = setup["people"]["a1"]
        a1.set_password("Old-Passw0rd!xyz")
        a1.save()
        signed_in = Client(HTTP_USER_AGENT=UA)
        signed_in.post("/auth/sign-in/", {"email": a1.email, "password": "Old-Passw0rd!xyz"})
        assert Session.objects.filter(user_id=str(a1.id)).exists()

        response = _reset(setup, "hr", "a1")
        body = response.json()
        assert response.status_code == 200 and body["expires_in_minutes"] == 60
        query = parse_qs(urlparse(body["link"]).query)
        assert urlparse(body["link"]).path == "/accounts/reset-password/" and query["email"] == [a1.email]
        a1.refresh_from_db()
        assert PasswordResetTokenGenerator().check_token(a1, query["token"][0])

        # what the reset page does with it
        uidb64, token = query["uidb64"][0], query["token"][0]
        done = Client(HTTP_USER_AGENT=UA).post(
            f"/auth/reset-password/{uidb64}/{token}/", {"password": "Chosen-By-Them!42"}
        )
        assert done.status_code == 302 and "error_code" not in done.url
        a1.refresh_from_db()
        assert a1.check_password("Chosen-By-Them!42")
        assert not Session.objects.filter(user_id=str(a1.id)).exists()
        # and it works only once
        again = Client(HTTP_USER_AGENT=UA).post(f"/auth/reset-password/{uidb64}/{token}/", {"password": "An0ther!Pass"})
        assert "error_code" in again.url
