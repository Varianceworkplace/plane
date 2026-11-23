# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Access control › People: Disable, Enable and Delete permanently (plane.utils.member_removal).

The workspace is the plan's example (plane/tests/unit/utils/test_rbac_engine.py): HR, PM A leading Team A (A1, A2),
PM B leading Team B (B1), and the workspace admin, who owns the workspace.

  * Disable: the person loses access everywhere at once (sign-in refused, open sessions end); nothing of theirs
    changes, and Enable gives it all back.
  * Delete (only once disabled): their shared work (projects, tasks, comments, pages) goes to the person HR picks;
    their own records (time entries, memberships, roles, teams, notifications, ...) go; then the account.
  * Workspace admins and HR (Employees and members › Delete) may; PMs and employees may not; never yourself, the
    workspace owner or another admin unless you're one.
"""

import uuid

import pytest
from django.core.cache import cache
from django.test import Client
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    DraftIssue,
    Issue,
    IssueAssignee,
    IssueComment,
    IssueWorkLog,
    IssueWorkLogTimer,
    Notification,
    Page,
    Project,
    ProjectMember,
    Session,
    TeamMember,
    User,
    UserRole,
    Workspace,
    WorkspaceMember,
)
from plane.license.models import Instance
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.member_removal import AUDIT_FIELDS, DELETE, EMPTIED, MERGE, PRECHECKED, TRANSFER, _person_links
from plane.utils.rbac import sync_project_access


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


def _url(setup, who, action):
    return f"/api/workspaces/{setup['workspace'].slug}/access-control/members/{setup['people'][who].id}/{action}/"


def _disable(setup, actor, who):
    return setup["clients"][actor].post(_url(setup, who, "disable"))


def _enable(setup, actor, who):
    return setup["clients"][actor].post(_url(setup, who, "enable"))


def _delete(setup, actor, who, transfer_to):
    to = setup["people"][transfer_to].id if transfer_to in setup["people"] else transfer_to
    return setup["clients"][actor].post(_url(setup, who, "delete"), {"transfer_to": str(to)}, format="json")


def _people(setup, who="hr", include_disabled=True):
    query = "?include_disabled=1" if include_disabled else ""
    response = setup["clients"][who].get(f"/api/workspaces/{setup['workspace'].slug}/access-control/members/{query}")
    assert response.status_code == 200, response.content
    return {row["member_id"]: row for row in response.json()}


@pytest.mark.contract
class TestWhoMay:
    def test_hr_and_admins_may_pms_and_employees_may_not(self, setup):
        assert _disable(setup, "pm_a", "a1").status_code == status.HTTP_403_FORBIDDEN
        assert _disable(setup, "a2", "a1").status_code == status.HTTP_403_FORBIDDEN
        assert _disable(setup, "hr", "a1").status_code == status.HTTP_200_OK
        assert _enable(setup, "admin", "a1").status_code == status.HTTP_200_OK

    def test_never_yourself_or_the_owner(self, setup):
        assert _disable(setup, "hr", "hr").status_code == status.HTTP_400_BAD_REQUEST
        # the workspace admin owns the workspace
        response = _disable(setup, "hr", "admin")
        assert response.status_code in (status.HTTP_400_BAD_REQUEST, status.HTTP_403_FORBIDDEN)
        assert User.objects.get(pk=setup["people"]["admin"].pk).is_active

    def test_only_admins_act_on_admins(self, setup):
        WorkspaceMember.objects.filter(workspace=setup["workspace"], member=setup["people"]["pm_b"]).update(role=20)
        assert _disable(setup, "hr", "pm_b").status_code == status.HTTP_403_FORBIDDEN
        assert _disable(setup, "admin", "pm_b").status_code == status.HTTP_200_OK

    def test_the_people_list_says_whom_you_may_act_on(self, setup):
        hr_view = _people(setup, "hr")
        assert hr_view[str(setup["people"]["a1"].id)]["can_remove"] is True
        assert hr_view[str(setup["people"]["hr"].id)]["can_remove"] is False  # yourself
        assert hr_view[str(setup["people"]["admin"].id)]["can_remove"] is False  # owner


@pytest.mark.contract
class TestDisable:
    def test_access_ends_at_once_and_nothing_else_changes(self, setup):
        a1 = setup["people"]["a1"]
        signed_in = APIClient()
        signed_in.force_login(a1)  # a real session, as in the browser
        projects_url = f"/api/workspaces/{setup['workspace'].slug}/projects/"
        assert signed_in.get(projects_url).status_code == 200
        roles = set(UserRole.objects.filter(member=a1).values_list("role_id", flat=True))
        teams = set(TeamMember.objects.filter(member=a1).values_list("team_id", flat=True))
        projects = set(
            ProjectMember.objects.filter(member=a1, is_active=True, rbac_managed=False).values_list(
                "project_id", flat=True
            )
        )

        assert _disable(setup, "hr", "a1").status_code == 200

        a1.refresh_from_db()
        assert a1.is_active is False and a1.last_logout_time is not None
        assert not Session.objects.filter(user_id=str(a1.id)).exists()
        assert signed_in.get(projects_url).status_code in (401, 403)
        membership = WorkspaceMember.objects.get(workspace=setup["workspace"], member=a1)
        assert membership.is_active is False  # suspended: pickers grey them out
        # their roles, teams and the memberships they were given stay
        assert set(UserRole.objects.filter(member=a1).values_list("role_id", flat=True)) == roles
        assert set(TeamMember.objects.filter(member=a1).values_list("team_id", flat=True)) == teams
        assert (
            set(
                ProjectMember.objects.filter(member=a1, is_active=True, rbac_managed=False).values_list(
                    "project_id", flat=True
                )
            )
            == projects
        )
        # the People tab still lists them, as disabled; other lists (Overview) don't
        assert _people(setup)[str(a1.id)]["is_active"] is False
        assert str(a1.id) not in _people(setup, include_disabled=False)
        # and the workspace's member list marks them, as Plane does for suspended members
        rows = setup["clients"]["hr"].get(f"/api/workspaces/{setup['workspace'].slug}/members/").json()
        assert [row for row in rows if row["member"]["id"] == str(a1.id)]

    def test_twice_is_refused(self, setup):
        assert _disable(setup, "hr", "a1").status_code == 200
        assert _disable(setup, "hr", "a1").status_code == 400

    def test_enable_gives_access_back(self, setup):
        a1 = setup["people"]["a1"]
        _disable(setup, "hr", "a1")
        assert _enable(setup, "hr", "a1").status_code == 200
        a1.refresh_from_db()
        assert a1.is_active is True
        assert WorkspaceMember.objects.get(workspace=setup["workspace"], member=a1).is_active is True
        client = APIClient()
        client.force_login(a1)
        assert client.get(f"/api/workspaces/{setup['workspace'].slug}/projects/").status_code == 200
        assert _people(setup)[str(a1.id)]["is_active"] is True
        assert _enable(setup, "hr", "a1").status_code == 400  # already active


@pytest.fixture
def sign_in_ready(db):
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
    cache.clear()
    yield
    cache.clear()


@pytest.mark.contract
class TestSignIn:
    def test_a_disabled_person_cannot_sign_in_until_enabled(self, setup, sign_in_ready):
        a1 = setup["people"]["a1"]
        a1.set_password("Secret@123")
        a1.save()
        browser = Client(HTTP_USER_AGENT="Mozilla/5.0")
        _disable(setup, "hr", "a1")
        response = browser.post(reverse("sign-in"), {"email": a1.email, "password": "Secret@123"}, follow=False)
        assert "USER_ACCOUNT_DEACTIVATED" in response.url
        assert "_auth_user_id" not in browser.session

        _enable(setup, "hr", "a1")
        cache.clear()
        response = browser.post(reverse("sign-in"), {"email": a1.email, "password": "Secret@123"}, follow=False)
        assert "error_code" not in response.url


@pytest.fixture
def a1_with_work(setup):
    """A1's things: assigned and created tasks, a comment, time (and a running timer), a project they created and
    lead, a page, a draft and a notification. PM B has time too (it must stay)."""
    w, people, projects, issues = setup["workspace"], setup["people"], setup["projects"], setup["issues"]
    a1 = people["a1"]
    own_project = Project.objects.create(name="A1's project", identifier="AONE", workspace=w, project_lead=a1)
    Project.all_objects.filter(pk=own_project.pk).update(created_by=a1)
    ProjectMember.objects.create(workspace=w, project=own_project, member=a1, role=20)
    ProjectMember.objects.create(workspace=w, project=own_project, member=people["a2"], role=15)
    comment = IssueComment.objects.create(
        workspace=w, project=projects["shared"], issue=issues["shared_b1"], actor=a1, comment_html="<p>done</p>"
    )
    page = Page.objects.create(workspace=w, name="A1 notes", owned_by=a1)
    start = timezone.now() - timezone.timedelta(hours=3)
    for issue in (issues["shared_a1"], issues["b_a1"]):
        IssueWorkLog.objects.create(
            workspace=w,
            project=issue.project,
            issue=issue,
            logged_by=a1,
            duration=30,
            started_at=start,
            ended_at=start + timezone.timedelta(minutes=30),
        )
    IssueWorkLog.objects.create(
        workspace=w,
        project=projects["b"],
        issue=issues["b_b1"],
        logged_by=people["pm_b"],
        duration=45,
        started_at=start,
        ended_at=start + timezone.timedelta(minutes=45),
    )
    IssueWorkLogTimer.objects.create(
        workspace=w, project=projects["shared"], issue=issues["shared_a1"], user=a1, started_at=start
    )
    draft = DraftIssue.objects.create(workspace=w, project=projects["a"], name="A1 draft")
    DraftIssue.all_objects.filter(pk=draft.pk).update(created_by=a1)
    Notification.objects.create(
        workspace=w,
        project=projects["a"],
        receiver=a1,
        entity_identifier=issues["a_a2"].id,
        entity_name="issue",
        title="ping",
        sender="in_app:issue_activities:assigned",
    )
    # PM A is on Shared - A1 already: no second assignment after the transfer
    IssueAssignee.objects.create(issue=issues["shared_a1"], assignee=people["pm_a"], project=projects["shared"])
    return {"project": own_project, "comment": comment, "page": page}


@pytest.mark.contract
class TestDelete:
    def test_only_once_disabled(self, setup):
        response = _delete(setup, "hr", "a1", "pm_a")
        assert response.status_code == 400 and "Disable" in response.json()["error"]
        assert User.objects.filter(pk=setup["people"]["a1"].pk).exists()

    def test_the_summary_says_what_will_happen(self, setup, a1_with_work):
        _disable(setup, "hr", "a1")
        response = setup["clients"]["hr"].get(_url(setup, "a1", "delete"))
        assert response.status_code == 200, response.content
        body = response.json()
        assert body["blocker"] is None
        assert body["transfer"]["projects_created"] == 1 and body["transfer"]["projects_led"] == 1
        assert body["transfer"]["tasks_assigned"] == 2 and body["transfer"]["comments"] == 1
        assert body["delete"]["time_entries"] == 2 and body["delete"]["time_minutes"] == 60
        assert body["delete"]["running_timer"] is True
        assert str(setup["people"]["pm_a"].id) in body["transfer_to_ids"]
        assert str(setup["people"]["a1"].id) not in body["transfer_to_ids"]

    def test_shared_work_moves_their_own_records_go(self, setup, a1_with_work):
        people, issues, projects = setup["people"], setup["issues"], setup["projects"]
        a1, pm_a = people["a1"], people["pm_a"]
        a1_id = a1.id
        others_before = {
            "issues": Issue.all_objects.filter(workspace=setup["workspace"]).count(),
            "projects": Project.all_objects.filter(workspace=setup["workspace"]).count(),
            "pm_b_time": IssueWorkLog.objects.filter(logged_by=people["pm_b"]).count(),
            "a2_in_own_project": ProjectMember.objects.filter(
                project=a1_with_work["project"], member=people["a2"], is_active=True
            ).exists(),
        }
        _disable(setup, "hr", "a1")

        response = _delete(setup, "hr", "a1", "pm_a")
        assert response.status_code == 200, response.content

        # the account is gone, and nothing points at it
        assert not User.objects.filter(pk=a1_id).exists()
        for model, field in _person_links():
            manager = getattr(model, "all_objects", model._default_manager)
            assert not manager.filter(**{field.name: a1_id}).exists(), f"{model.__name__}.{field.name}"
        # shared work is PM A's now; nothing else was lost
        assert Issue.all_objects.filter(workspace=setup["workspace"]).count() == others_before["issues"]
        assert Project.all_objects.filter(workspace=setup["workspace"]).count() == others_before["projects"]
        own = Project.objects.get(pk=a1_with_work["project"].pk)
        assert own.project_lead_id == pm_a.id and own.created_by_id == pm_a.id
        assert IssueComment.objects.get(pk=a1_with_work["comment"].pk).actor_id == pm_a.id
        assert Page.objects.get(pk=a1_with_work["page"].pk).owned_by_id == pm_a.id
        assert Issue.objects.get(pk=issues["shared_new"].pk).created_by_id == pm_a.id
        assert set(IssueAssignee.objects.filter(issue=issues["b_a1"]).values_list("assignee_id", flat=True)) == {
            pm_a.id
        }
        # PM A was already on Shared - A1: once, not twice
        assert IssueAssignee.objects.filter(issue=issues["shared_a1"], assignee=pm_a).count() == 1
        # PM A can open what's theirs now: a member of Beta (A1 was) and admin of A1's project
        assert ProjectMember.objects.filter(project=projects["b"], member=pm_a, is_active=True).exists()
        assert ProjectMember.objects.get(project=a1_with_work["project"], member=pm_a).role == 20
        assert others_before["a2_in_own_project"]
        assert ProjectMember.objects.filter(project=a1_with_work["project"], member=people["a2"]).exists()
        # their time is gone (HR's choice), PM B's isn't
        assert not IssueWorkLog.all_objects.filter(issue__in=[issues["shared_a1"], issues["b_a1"]]).exists()
        assert IssueWorkLog.objects.filter(logged_by=people["pm_b"]).count() == others_before["pm_b_time"]
        assert not DraftIssue.all_objects.filter(name="A1 draft").exists()
        # and the People tab no longer lists them
        assert str(a1_id) not in _people(setup)

    def test_pick_an_active_member_to_take_over(self, setup):
        _disable(setup, "hr", "a1")
        _disable(setup, "hr", "a2")
        assert _delete(setup, "hr", "a1", "a1").status_code == 400  # themselves
        assert _delete(setup, "hr", "a1", "a2").status_code == 400  # disabled too
        assert _delete(setup, "hr", "a1", uuid.uuid4()).status_code == 400  # not a member
        assert User.objects.filter(pk=setup["people"]["a1"].pk).exists()

    def test_pms_may_not(self, setup):
        _disable(setup, "hr", "a1")
        assert _delete(setup, "pm_a", "a1", "pm_a").status_code == 403
        assert User.objects.filter(pk=setup["people"]["a1"].pk).exists()

    def test_not_while_they_are_in_another_workspace(self, setup):
        a1 = setup["people"]["a1"]
        other = Workspace.objects.create(name="Other", slug="other-ws", owner=setup["people"]["admin"])
        WorkspaceMember.objects.create(workspace=other, member=a1, role=15)
        _disable(setup, "hr", "a1")
        response = _delete(setup, "hr", "a1", "pm_a")
        assert response.status_code == 400 and "Other" in response.json()["error"]
        assert User.objects.filter(pk=a1.pk).exists()


@pytest.mark.unit
def test_every_link_to_a_person_has_a_rule():
    """A new model pointing at people must say what happens to it when someone is deleted."""
    handled = DELETE | TRANSFER | set(MERGE) | EMPTIED | PRECHECKED
    missing = [
        f"{model.__name__}.{field.name}"
        for model, field in _person_links()
        if field.name not in AUDIT_FIELDS and (model.__name__, field.name) not in handled
    ]
    assert not missing, missing
