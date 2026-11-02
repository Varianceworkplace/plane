# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Groups (plane.db.models.member_group): who manages them, and tasks assigned to one.

The workspace is the plan's example (see plane/tests/unit/utils/test_rbac_engine.py), with RBAC on:
  * HR manages every group, Project Managers only the ones they created, Employees none; everyone can list them
    (the Assigned to dropdown). With RBAC off, workspace admins manage them;
  * a task goes to people or to one group; giving it to one takes it away from the other;
  * everyone in the group sees the task, also in projects they weren't in (the sync adds them as Members, which
    doesn't let them create tasks there), but only its creator and the PMs edit it;
  * nobody is notified when a task is given to a group.
"""

from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueAssignee, MemberGroup, ProjectMember, Workspace
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import AccessProfile, sync_project_access


@pytest.fixture
def rbac(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return {**org, "clients": clients}


def _groups_url(setup, group=None):
    base = f"/api/workspaces/{setup['workspace'].slug}/groups/"
    return f"{base}{group['id']}/" if group else base


def _issues_url(setup, project):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{setup['projects'][project].id}/issues/"


def _ids(setup, *names):
    return [str(setup["people"][name].id) for name in names]


def _create_group(setup, who, name, *members):
    response = setup["clients"][who].post(
        _groups_url(setup), {"name": name, "description": "", "member_ids": _ids(setup, *members)}, format="json"
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    return response.json()


def _create_task(setup, who, project, name, group):
    response = setup["clients"][who].post(
        _issues_url(setup, project), {"name": name, "assignee_group_id": group["id"]}, format="json"
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    return response.json()


def _listed(setup, who, project):
    response = setup["clients"][who].get(_issues_url(setup, project))
    assert response.status_code == status.HTTP_200_OK, response.content
    rows = response.json()["results"]
    if isinstance(rows, dict):  # grouped results
        rows = [issue for group in rows.values() for issue in group.get("results", [])]
    return {issue["name"] for issue in rows}


@pytest.mark.contract
class TestManagingGroups:
    def test_hr_manages_every_group_and_pms_their_own(self, rbac):
        php = _create_group(rbac, "pm_a", "PHP Group", "a1", "a2")
        react = _create_group(rbac, "hr", "React Group", "b1")
        assert set(php["member_ids"]) == set(_ids(rbac, "a1", "a2"))

        # employees can't create groups
        response = rbac["clients"]["a1"].post(_groups_url(rbac), {"name": "Mine", "member_ids": []}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN

        pm_a, pm_b, hr = (rbac["clients"][name] for name in ("pm_a", "pm_b", "hr"))
        assert pm_a.patch(_groups_url(rbac, php), {"description": "Backend"}, format="json").status_code == 200
        assert pm_a.patch(_groups_url(rbac, react), {"name": "Mine now"}, format="json").status_code == 403
        assert pm_b.delete(_groups_url(rbac, php)).status_code == 403
        response = hr.patch(_groups_url(rbac, php), {"member_ids": _ids(rbac, "a1")}, format="json")
        assert response.status_code == 200
        assert response.json()["member_ids"] == _ids(rbac, "a1")
        assert rbac["clients"]["admin"].delete(_groups_url(rbac, react)).status_code == 204
        assert not MemberGroup.objects.filter(pk=react["id"]).exists()

    def test_everyone_lists_the_groups_with_what_they_may_do(self, rbac):
        php = _create_group(rbac, "pm_a", "PHP Group", "a1")
        _create_group(rbac, "hr", "React Group", "b1")
        body = rbac["clients"]["a1"].get(_groups_url(rbac)).json()
        assert (body["can_view"], body["can_create"]) == (False, False)
        assert [group["name"] for group in body["groups"]] == ["PHP Group", "React Group"]
        body = rbac["clients"]["pm_a"].get(_groups_url(rbac)).json()
        assert (body["can_view"], body["can_create"]) == (True, True)
        assert {group["name"]: group["can_edit"] for group in body["groups"]} == {
            "PHP Group": True,
            "React Group": False,
        }
        assert body["groups"][0]["id"] == php["id"]

    def test_names_and_members_are_checked(self, rbac):
        _create_group(rbac, "hr", "PHP Group", "a1")
        hr = rbac["clients"]["hr"]
        response = hr.post(_groups_url(rbac), {"name": " php group ", "member_ids": []}, format="json")
        assert response.status_code == 400 and "name" in response.json()
        response = hr.post(_groups_url(rbac), {"name": "", "member_ids": []}, format="json")
        assert response.status_code == 400 and "name" in response.json()
        stranger = "00000000-0000-0000-0000-000000000001"
        response = hr.post(_groups_url(rbac), {"name": "Other", "member_ids": [stranger]}, format="json")
        assert response.status_code == 400 and "member_ids" in response.json()

    def test_with_rbac_off_workspace_admins_manage_groups(self, rbac):
        rbac["workspace"].is_rbac_enabled = False
        rbac["workspace"].save(update_fields=["is_rbac_enabled"])
        _create_group(rbac, "admin", "PHP Group", "a1")
        response = rbac["clients"]["hr"].post(_groups_url(rbac), {"name": "HR's", "member_ids": []}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert rbac["clients"]["a1"].get(_groups_url(rbac)).json()["groups"][0]["name"] == "PHP Group"


@pytest.mark.contract
class TestAssigningTasksToGroups:
    def test_a_task_goes_to_a_person_or_a_group(self, rbac):
        php = _create_group(rbac, "hr", "PHP Group", "a1", "b1")
        alpha = rbac["projects"]["a"]
        alpha.default_assignee = rbac["people"]["pm_a"]
        alpha.save(update_fields=["default_assignee"])

        created = _create_task(rbac, "pm_a", "a", "Alpha - PHP", php)
        # the group only: not even the project's default assignee
        assert (created["assignee_group_id"], created["assignee_ids"]) == (php["id"], [])
        task = Issue.objects.get(pk=created["id"])

        pm_a = rbac["clients"]["pm_a"]
        url = f"{_issues_url(rbac, 'a')}{task.id}/"
        both = {"assignee_group_id": php["id"], "assignee_ids": _ids(rbac, "a2")}
        assert pm_a.patch(url, both, format="json").status_code == status.HTTP_400_BAD_REQUEST
        # a person takes it over from the group ...
        assert pm_a.patch(url, {"assignee_ids": _ids(rbac, "a2")}, format="json").status_code == 204
        task.refresh_from_db()
        assert task.assignee_group_id is None
        assert list(IssueAssignee.objects.filter(issue=task).values_list("assignee_id", flat=True)) == [
            rbac["people"]["a2"].id
        ]
        # ... and the group from the person
        assert pm_a.patch(url, {"assignee_group_id": php["id"]}, format="json").status_code == 204
        task.refresh_from_db()
        assert str(task.assignee_group_id) == php["id"]
        assert not IssueAssignee.objects.filter(issue=task).exists()
        detail = pm_a.get(url).json()
        assert (detail["assignee_group_id"], detail["assignee_ids"]) == (php["id"], [])

    def test_groups_of_another_workspace_are_refused(self, rbac):
        other = Workspace.objects.create(name="Other", owner=rbac["people"]["admin"], slug="other-groups")
        foreign = MemberGroup.objects.create(workspace=other, name="Foreign")
        response = rbac["clients"]["pm_a"].post(
            _issues_url(rbac, "a"), {"name": "Nope", "assignee_group_id": str(foreign.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Issue.objects.filter(name="Nope").exists()

    def test_nobody_is_notified_when_a_group_is_assigned(self, rbac):
        php = _create_group(rbac, "hr", "PHP Group", "a1")
        with mock.patch("plane.app.views.issue.base.issue_activity") as activity:
            task = _create_task(rbac, "pm_a", "a", "Alpha - PHP", php)
            url = f"{_issues_url(rbac, 'a')}{task['id']}/"
            pm_a = rbac["clients"]["pm_a"]
            pm_a.patch(url, {"assignee_ids": _ids(rbac, "a2"), "assignee_group_id": None}, format="json")
            pm_a.patch(url, {"assignee_group_id": php["id"], "assignee_ids": []}, format="json")
            # other changes to a group's task notify as usual, also when the edit form sends the same group again
            pm_a.patch(url, {"name": "Alpha - PHP v2", "assignee_group_id": php["id"]}, format="json")
        assert [call.kwargs["notification"] for call in activity.delay.call_args_list] == [False, True, False, True]


@pytest.mark.contract
class TestGroupTaskVisibility:
    def test_group_members_see_the_task_and_only_pms_and_its_creator_edit_it(self, rbac):
        # B1 isn't in Alpha; the loner has no role
        php = _create_group(rbac, "hr", "PHP Group", "a2", "b1", "loner")
        task = _create_task(rbac, "pm_a", "a", "Alpha - PHP", php)
        sync_project_access(rbac["workspace"].id)

        membership = ProjectMember.objects.get(project=rbac["projects"]["a"], member=rbac["people"]["b1"])
        assert (membership.role, membership.rbac_managed, membership.is_active) == (15, True, True)
        assert not ProjectMember.objects.filter(project=rbac["projects"]["a"], member=rbac["people"]["loner"]).exists()

        assert _listed(rbac, "b1", "a") == {"Alpha - PHP"}
        assert _listed(rbac, "a2", "a") == {"Alpha - A2", "Alpha - PHP"}
        assert _listed(rbac, "a1", "a") == set()  # in Alpha, not in the group

        url = f"{_issues_url(rbac, 'a')}{task['id']}/"
        b1, a2 = rbac["clients"]["b1"], rbac["clients"]["a2"]
        assert b1.get(url).status_code == status.HTTP_200_OK
        assert b1.patch(url, {"priority": "high"}, format="json").status_code == status.HTTP_403_FORBIDDEN
        assert a2.patch(url, {"priority": "high"}, format="json").status_code == status.HTTP_403_FORBIDDEN
        assert rbac["clients"]["pm_a"].patch(url, {"priority": "high"}, format="json").status_code == 204
        # B1's membership came with the group task: it doesn't let them create tasks in Alpha
        response = b1.post(_issues_url(rbac, "a"), {"name": "B1 in Alpha"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN

        # PM B leads B1, who is in the group: the task is in PM B's team scope
        pm_b = AccessProfile.load(rbac["people"]["pm_b"], rbac["workspace"].id)
        assert Issue.objects.filter(pk=task["id"]).filter(pm_b.work_item_q("edit")).exists()
        # the loner, without a role, sees nothing
        loner = AccessProfile.load(rbac["people"]["loner"], rbac["workspace"].id)
        assert not Issue.all_objects.filter(pk=task["id"]).filter(loner.work_item_q("view")).exists()

        # B1 leaves the group: the task and the membership go
        rbac["clients"]["hr"].patch(_groups_url(rbac, php), {"member_ids": _ids(rbac, "a2")}, format="json")
        sync_project_access(rbac["workspace"].id)
        membership.refresh_from_db()
        assert membership.is_active is False
        b1_profile = AccessProfile.load(rbac["people"]["b1"], rbac["workspace"].id)
        assert not Issue.objects.filter(pk=task["id"]).filter(b1_profile.work_item_q("view")).exists()

    def test_a_raised_guest_membership_still_doesnt_allow_creating(self, rbac):
        ProjectMember.objects.create(
            workspace=rbac["workspace"], project=rbac["projects"]["open"], member=rbac["people"]["b1"], role=5
        )
        qa = _create_group(rbac, "hr", "QA Group", "b1")
        _create_task(rbac, "hr", "open", "Open - QA", qa)
        sync_project_access(rbac["workspace"].id)

        membership = ProjectMember.objects.get(project=rbac["projects"]["open"], member=rbac["people"]["b1"])
        assert (membership.role, membership.rbac_original_role) == (15, 5)
        assert _listed(rbac, "b1", "open") == {"Open - QA"}
        response = rbac["clients"]["b1"].post(_issues_url(rbac, "open"), {"name": "B1 in Open"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        me = rbac["clients"]["b1"].get(f"/api/workspaces/{rbac['workspace'].slug}/access-control/me/").json()
        assert str(rbac["projects"]["open"].id) not in me["work_items"]["create_project_ids"]
        assert me["work_items"]["group_ids"] == [qa["id"]]

    def test_your_work_lists_group_tasks_under_assigned(self, rbac):
        php = _create_group(rbac, "hr", "PHP Group", "a2")
        _create_task(rbac, "pm_a", "a", "Alpha - PHP", php)
        a2 = rbac["people"]["a2"]
        response = rbac["clients"]["a2"].get(
            f"/api/workspaces/{rbac['workspace'].slug}/user-issues/{a2.id}/?assigned_to={a2.id}"
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        assert {issue["name"] for issue in response.json()["results"]} == {"Alpha - A2", "Alpha - PHP"}

    def test_deleting_a_group_unassigns_its_tasks(self, rbac):
        php = _create_group(rbac, "hr", "PHP Group", "a2")
        task = _create_task(rbac, "pm_a", "a", "Alpha - PHP", php)
        assert rbac["clients"]["hr"].delete(_groups_url(rbac, php)).status_code == 204
        assert Issue.objects.get(pk=task["id"]).assignee_group_id is None

    def test_with_rbac_off_group_members_see_the_task(self, rbac):
        rbac["workspace"].is_rbac_enabled = False
        rbac["workspace"].save(update_fields=["is_rbac_enabled"])
        sync_project_access(rbac["workspace"].id)
        php = _create_group(rbac, "admin", "PHP Group", "a1")
        ProjectMember.objects.create(
            workspace=rbac["workspace"], project=rbac["projects"]["shared"], member=rbac["people"]["admin"], role=20
        )
        _create_task(rbac, "admin", "shared", "Shared - PHP", php)
        assert "Shared - PHP" in _listed(rbac, "a1", "shared")
        assert "Shared - PHP" not in _listed(rbac, "b1", "shared")
