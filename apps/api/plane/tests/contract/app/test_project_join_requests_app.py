# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Role-based access: asking to join a project, and the PM approving or rejecting it (views/rbac/join_request.py).

The workspace is the plan's example (test_rbac_engine.org): PM A leads Team A (A1, A2), PM B leads Team B (B1). Nobody
belongs to the Open project; employees may view it but not manage it, so they have to ask.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueAssignee, Notification, ProjectJoinRequest, ProjectMember, TeamMember
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import sync_project_access

ENTITY = "project_join_request"


@pytest.fixture
def setup(org):  # noqa: F811
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    workspace = org["workspace"]
    workspace.is_rbac_enabled = True
    workspace.save(update_fields=["is_rbac_enabled"])
    return {**org, "clients": clients, "base": f"/api/workspaces/{workspace.slug}/project-join-requests/"}


def _ask(setup, who, project="open"):
    return setup["clients"][who].post(setup["base"], {"project_id": str(setup["projects"][project].id)}, format="json")


def _decide(setup, who, request_id, decision):
    return setup["clients"][who].patch(f"{setup['base']}{request_id}/", {"status": decision}, format="json")


def _join_directly(setup, who, project="open"):
    return setup["clients"][who].post(
        f"/api/users/me/workspaces/{setup['workspace'].slug}/projects/invitations/",
        {"project_ids": [str(setup["projects"][project].id)]},
        format="json",
    )


def _member(setup, who, project="open"):
    return ProjectMember.objects.filter(
        project=setup["projects"][project], member=setup["people"][who], is_active=True
    ).first()


def _notifications(setup, who):
    return list(Notification.objects.filter(receiver=setup["people"][who], entity_name=ENTITY).order_by("created_at"))


@pytest.mark.contract
class TestAsking:
    def test_the_employee_asks_and_only_their_pm_hears(self, setup):
        response = _ask(setup, "a1")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["status"] == "pending" and response.json()["can_decide"] is False
        assert _member(setup, "a1") is None  # not until the PM approves

        [notification] = _notifications(setup, "pm_a")
        assert notification.title == "a1 asked to join Open"
        assert notification.entity_identifier == ProjectJoinRequest.objects.get().id
        assert notification.triggered_by == setup["people"]["a1"] and notification.read_at is None
        for who in ("pm_b", "hr", "admin", "a2", "a1"):
            assert _notifications(setup, who) == [], who

    def test_asking_twice_keeps_one_request(self, setup):
        first = _ask(setup, "a1").json()
        again = _ask(setup, "a1")
        assert again.status_code == status.HTTP_200_OK and again.json()["id"] == first["id"]
        assert ProjectJoinRequest.objects.count() == 1 and len(_notifications(setup, "pm_a")) == 1

    def test_joining_directly_needs_the_pms_approval(self, setup):
        response = _join_directly(setup, "a1")
        assert response.status_code == status.HTTP_403_FORBIDDEN and response.json()["needs_approval"] is True
        assert _member(setup, "a1") is None

    def test_without_a_pm_nobody_can_approve(self, setup):
        team_b = setup["teams"][1]
        TeamMember.objects.filter(team=team_b, is_lead=True).update(is_lead=False)
        response = _ask(setup, "b1")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Ask HR to add you to a team" in response.json()["error"]
        assert ProjectJoinRequest.objects.count() == 0

    def test_people_who_can_manage_the_project_join_directly(self, setup):
        assert _ask(setup, "hr").status_code == status.HTTP_400_BAD_REQUEST
        assert _join_directly(setup, "hr").status_code == status.HTTP_201_CREATED
        assert _member(setup, "hr") is not None

    def test_members_and_projects_they_cant_see(self, setup):
        assert _ask(setup, "a1", "a").status_code == status.HTTP_400_BAD_REQUEST  # already a member
        assert _ask(setup, "a1", "private").status_code == status.HTTP_404_NOT_FOUND

    def test_with_role_based_access_off_joining_is_plain_again(self, setup):
        setup["workspace"].is_rbac_enabled = False
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        assert _ask(setup, "a1").status_code == status.HTTP_400_BAD_REQUEST
        assert _join_directly(setup, "a1").status_code == status.HTTP_201_CREATED
        assert _member(setup, "a1") is not None


@pytest.mark.contract
class TestDeciding:
    @pytest.mark.parametrize("who", ["pm_b", "hr", "admin", "a2", "a1"])
    def test_only_their_pm_decides(self, setup, who):
        request_id = _ask(setup, "a1").json()["id"]
        for decision in ("approved", "rejected"):
            assert _decide(setup, who, request_id, decision).status_code == status.HTTP_403_FORBIDDEN
        assert ProjectJoinRequest.objects.get().status == "pending" and _member(setup, "a1") is None

    def test_approving_adds_them_as_a_member_and_tells_them(self, setup):
        request_id = _ask(setup, "a1").json()["id"]
        response = _decide(setup, "pm_a", request_id, "approved")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["status"] == "approved" and response.json()["decided_by"]["name"] == "pm_a"
        assert _member(setup, "a1").role == 15  # a member: creates work items and edits their own

        [notification] = _notifications(setup, "a1")
        assert notification.title == "pm_a approved your request to join Open"
        assert notification.triggered_by == setup["people"]["pm_a"]
        # the PM's own notification about it is done with
        assert _notifications(setup, "pm_a")[0].read_at is not None

        again = _decide(setup, "pm_a", request_id, "rejected")
        assert again.status_code == status.HTTP_409_CONFLICT and "already approved by pm_a" in again.json()["error"]

    def test_once_approved_they_create_work_items_and_edit_their_own(self, setup):
        issues_url = f"/api/workspaces/{setup['workspace'].slug}/projects/{setup['projects']['open'].id}/issues/"
        a1 = setup["clients"]["a1"]
        assert a1.post(issues_url, {"name": "Before approval"}, format="json").status_code != status.HTTP_201_CREATED

        _decide(setup, "pm_a", _ask(setup, "a1").json()["id"], "approved")
        created = a1.post(issues_url, {"name": "From A1"}, format="json")
        assert created.status_code == status.HTTP_201_CREATED, created.content
        edited = a1.patch(f"{issues_url}{created.json()['id']}/", {"priority": "high"}, format="json")
        assert edited.status_code == status.HTTP_204_NO_CONTENT
        # someone else's work item there stays out of reach
        other = Issue.objects.create(name="Not A1's", workspace=setup["workspace"], project=setup["projects"]["open"])
        IssueAssignee.objects.create(issue=other, assignee=setup["people"]["a2"], project=setup["projects"]["open"])
        assert a1.patch(f"{issues_url}{other.id}/", {"priority": "low"}, format="json").status_code == 404

    def test_approving_raises_an_earlier_guest_membership(self, setup):
        ProjectMember.objects.create(
            workspace=setup["workspace"],
            project=setup["projects"]["open"],
            member=setup["people"]["a1"],
            role=5,
            is_active=False,
        )
        _decide(setup, "pm_a", _ask(setup, "a1").json()["id"], "approved")
        assert _member(setup, "a1").role == 15

    def test_an_old_admin_row_from_the_sync_becomes_a_plain_membership(self, setup):
        # A1 was once a PM: the sync made them admin of Open, then ended it when they became an employee again
        ProjectMember.objects.create(
            workspace=setup["workspace"],
            project=setup["projects"]["open"],
            member=setup["people"]["a1"],
            role=20,
            is_active=False,
            rbac_managed=True,
        )
        _decide(setup, "pm_a", _ask(setup, "a1").json()["id"], "approved")
        member = _member(setup, "a1")
        assert (member.role, member.rbac_managed, member.rbac_original_role) == (15, False, None)
        # and the next sync leaves the approved membership alone
        sync_project_access(setup["workspace"].id)
        member = _member(setup, "a1")
        assert member is not None and member.role == 15

    def test_rejecting_keeps_them_out_and_they_may_ask_again(self, setup):
        request_id = _ask(setup, "a1").json()["id"]
        assert _decide(setup, "pm_a", request_id, "rejected").status_code == status.HTTP_200_OK
        assert _member(setup, "a1") is None
        [notification] = _notifications(setup, "a1")
        assert notification.title == "pm_a rejected your request to join Open"

        again = _ask(setup, "a1")
        assert again.status_code == status.HTTP_201_CREATED and again.json()["id"] != request_id

    def test_a_decision_must_be_approve_or_reject(self, setup):
        request_id = _ask(setup, "a1").json()["id"]
        assert _decide(setup, "pm_a", request_id, "pending").status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
class TestListing:
    def test_each_side_sees_their_own(self, setup):
        request_id = _ask(setup, "a1").json()["id"]

        a1 = setup["clients"]["a1"].get(setup["base"]).json()
        assert [pm["id"] for pm in a1["pms"]] == [str(setup["people"]["pm_a"].id)]
        assert [(r["id"], r["status"], r["can_decide"]) for r in a1["requests"]] == [(request_id, "pending", False)]

        pm_a = setup["clients"]["pm_a"].get(setup["base"]).json()
        assert pm_a["pms"] == []
        assert [(r["id"], r["can_decide"]) for r in pm_a["requests"]] == [(request_id, True)]

        for who in ("pm_b", "a2", "hr"):
            assert setup["clients"][who].get(setup["base"]).json()["requests"] == [], who

    def test_the_inbox_lists_them(self, setup):
        _ask(setup, "a1")
        response = setup["clients"]["pm_a"].get(f"/api/workspaces/{setup['workspace'].slug}/users/notifications/")
        assert response.status_code == status.HTTP_200_OK
        assert [n["entity_name"] for n in response.json()] == [ENTITY]

    def test_with_role_based_access_off(self, setup):
        setup["workspace"].is_rbac_enabled = False
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        assert setup["clients"]["a1"].get(setup["base"]).json() == {
            "is_rbac_enabled": False,
            "pms": [],
            "requests": [],
        }
