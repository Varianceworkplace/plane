# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Assigning project tasks and projects to a team (Access control › Teams), which replaced groups.

The workspace is the plan's example (see plane/tests/unit/utils/test_rbac_engine.py): PM A leads Team A (A1, A2),
PM B leads Team B (B1), Team A owns Alpha, Team B owns Beta and both own Shared.

  * A task goes to people or to one team; giving it to one takes it away from the other. Everyone in the team works
    on it as if it were assigned to them (sees and edits it), also in projects they weren't in: the sync makes them
    members, which doesn't let them create tasks there. Nobody is notified when a team is assigned.
  * A project's "Assigned To" is a person (its lead) or a team. The team then works on it as if it owned it: its
    leads have it in their team scope, its members are members of it (private or not) and create tasks there.
    The same goes for the projects a team owns.
  * Only the project's creator and workspace admins change it.
  * Every workspace member can list the teams (the Assigned to dropdowns); only access managers manage them.
"""

from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueAssignee, Project, ProjectDetail, ProjectMember, TeamMember, Workspace
from plane.db.models.project_detail import PROJECT_STATUSES, PROJECT_TYPES
from plane.db.models.workspace import Team
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import AccessProfile, sync_project_access


@pytest.fixture
def rbac(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    # the workspace admin manages these projects (Plane wants workspace admins in a project to change it)
    for project in org["projects"].values():
        ProjectMember.objects.create(
            workspace=org["workspace"], project=project, member=org["people"]["admin"], role=20
        )
    sync_project_access(org["workspace"].id)
    return {**org, "clients": clients}


def _sync(setup):
    sync_project_access(setup["workspace"].id)


def _ids(setup, *names):
    return [str(setup["people"][name].id) for name in names]


def _teams_url(setup, team=None):
    base = f"/api/workspaces/{setup['workspace'].slug}/access-control/teams/"
    return f"{base}{team['id']}/" if team else base


def _create_team(setup, name, *members, lead=None, who="hr"):
    rows = [{"member_id": member_id, "is_lead": False} for member_id in _ids(setup, *members)]
    if lead:
        rows.append({"member_id": _ids(setup, lead)[0], "is_lead": True})
    response = setup["clients"][who].post(_teams_url(setup), {"name": name, "members": rows}, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    _sync(setup)
    return response.json()


def _issues_url(setup, project):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{setup['projects'][project].id}/issues/"


def _create_task(setup, who, project, name, team):
    response = setup["clients"][who].post(
        _issues_url(setup, project), {"name": name, "assignee_team_id": team["id"]}, format="json"
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    _sync(setup)
    return response.json()


def _listed_tasks(setup, who, project):
    response = setup["clients"][who].get(_issues_url(setup, project))
    assert response.status_code == status.HTTP_200_OK, response.content
    rows = response.json()["results"]
    if isinstance(rows, dict):  # grouped results
        rows = [issue for group in rows.values() for issue in group.get("results", [])]
    return {issue["name"] for issue in rows}


def _membership(setup, project, who):
    return ProjectMember.objects.filter(project=setup["projects"][project], member=setup["people"][who]).first()


def _my_access(setup, who):
    return setup["clients"][who].get(f"/api/workspaces/{setup['workspace'].slug}/access-control/me/").json()


# ---------------------------------------------------------------- tasks


@pytest.mark.contract
class TestAssigningTasksToTeams:
    def test_a_task_goes_to_a_person_or_a_team(self, rbac):
        pool = _create_team(rbac, "PHP Pool", "a1", "b1")
        alpha = rbac["projects"]["a"]
        alpha.default_assignee = rbac["people"]["pm_a"]
        alpha.save(update_fields=["default_assignee"])

        created = _create_task(rbac, "pm_a", "a", "Alpha - PHP", pool)
        # the team only: not even the project's default assignee
        assert (created["assignee_team_id"], created["assignee_ids"]) == (pool["id"], [])
        task = Issue.objects.get(pk=created["id"])

        pm_a = rbac["clients"]["pm_a"]
        url = f"{_issues_url(rbac, 'a')}{task.id}/"
        both = {"assignee_team_id": pool["id"], "assignee_ids": _ids(rbac, "a2")}
        response = pm_a.patch(url, both, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["assignee_team_id"] == ["Assign the task to a person or to a team, not both."]
        # a person takes it over from the team ...
        assert pm_a.patch(url, {"assignee_ids": _ids(rbac, "a2")}, format="json").status_code == 204
        task.refresh_from_db()
        assert task.assignee_team_id is None
        assert list(IssueAssignee.objects.filter(issue=task).values_list("assignee_id", flat=True)) == [
            rbac["people"]["a2"].id
        ]
        # ... and the team from the person
        assert pm_a.patch(url, {"assignee_team_id": pool["id"]}, format="json").status_code == 204
        task.refresh_from_db()
        assert str(task.assignee_team_id) == pool["id"]
        assert not IssueAssignee.objects.filter(issue=task).exists()
        detail = pm_a.get(url).json()
        assert (detail["assignee_team_id"], detail["assignee_ids"]) == (pool["id"], [])

    def test_teams_of_another_workspace_are_refused(self, rbac):
        other = Workspace.objects.create(name="Other", owner=rbac["people"]["admin"], slug="other-teams")
        foreign = Team.objects.create(workspace=other, name="Foreign")
        response = rbac["clients"]["pm_a"].post(
            _issues_url(rbac, "a"), {"name": "Nope", "assignee_team_id": str(foreign.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Issue.objects.filter(name="Nope").exists()

    def test_nobody_is_notified_when_a_team_is_assigned(self, rbac):
        pool = _create_team(rbac, "PHP Pool", "a1")
        with mock.patch("plane.app.views.issue.base.issue_activity") as activity:
            task = _create_task(rbac, "pm_a", "a", "Alpha - PHP", pool)
            url = f"{_issues_url(rbac, 'a')}{task['id']}/"
            pm_a = rbac["clients"]["pm_a"]
            pm_a.patch(url, {"assignee_ids": _ids(rbac, "a2"), "assignee_team_id": None}, format="json")
            pm_a.patch(url, {"assignee_team_id": pool["id"], "assignee_ids": []}, format="json")
            # other changes to a team's task notify as usual, also when the edit form sends the same team again
            pm_a.patch(url, {"name": "Alpha - PHP v2", "assignee_team_id": pool["id"]}, format="json")
        assert [call.kwargs["notification"] for call in activity.delay.call_args_list] == [False, True, False, True]

    def test_everyone_lists_the_teams_for_the_dropdowns(self, rbac):
        response = rbac["clients"]["a1"].get(f"{_teams_url(rbac)}options/")
        assert response.status_code == status.HTTP_200_OK, response.content
        teams = {team["name"]: team for team in response.json()}
        assert list(teams) == ["Team A", "Team B"]
        assert set(teams["Team A"]["member_ids"]) == set(_ids(rbac, "pm_a", "a1", "a2"))
        assert teams["Team A"]["lead_ids"] == _ids(rbac, "pm_a")
        # managing them stays with access managers
        assert rbac["clients"]["a1"].get(_teams_url(rbac)).status_code == status.HTTP_403_FORBIDDEN
        assert rbac["clients"]["pm_a"].post(_teams_url(rbac), {"name": "Mine"}, format="json").status_code == 403


@pytest.mark.contract
class TestTeamTaskAccess:
    def test_team_members_see_and_work_on_the_task(self, rbac):
        # a team without a lead; B1 isn't in Alpha, the loner has no role
        pool = _create_team(rbac, "PHP Pool", "a2", "b1", "loner")
        task = _create_task(rbac, "pm_a", "a", "Alpha - PHP", pool)

        membership = _membership(rbac, "a", "b1")
        assert (membership.role, membership.rbac_managed, membership.is_active) == (15, True, True)
        assert _membership(rbac, "a", "loner") is None

        assert _listed_tasks(rbac, "b1", "a") == {"Alpha - PHP"}
        assert _listed_tasks(rbac, "a2", "a") == {"Alpha - A2", "Alpha - PHP"}
        assert _listed_tasks(rbac, "a1", "a") == set()  # in Alpha's team, not in the pool

        url = f"{_issues_url(rbac, 'a')}{task['id']}/"
        b1, a2, a1 = rbac["clients"]["b1"], rbac["clients"]["a2"], rbac["clients"]["a1"]
        assert b1.get(url).status_code == status.HTTP_200_OK
        # the team's members work on it like its assignees, and so do the project's PMs
        assert b1.patch(url, {"priority": "high"}, format="json").status_code == 204
        assert a2.patch(url, {"priority": "low"}, format="json").status_code == 204
        assert a1.patch(url, {"priority": "low"}, format="json").status_code in (403, 404)
        assert rbac["clients"]["pm_a"].patch(url, {"priority": "urgent"}, format="json").status_code == 204
        # B1's membership came with the team task: it doesn't let them create tasks in Alpha
        response = b1.post(_issues_url(rbac, "a"), {"name": "B1 in Alpha"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN

        # PM B leads B1, who is in the pool: the task is in PM B's team scope
        pm_b = AccessProfile.load(rbac["people"]["pm_b"], rbac["workspace"].id)
        assert Issue.objects.filter(pk=task["id"]).filter(pm_b.work_item_q("edit")).exists()
        # the loner, without a role, sees nothing
        loner = AccessProfile.load(rbac["people"]["loner"], rbac["workspace"].id)
        assert not Issue.all_objects.filter(pk=task["id"]).filter(loner.work_item_q("view")).exists()

        # B1 leaves the pool: the task and the membership go
        rows = [{"member_id": member_id, "is_lead": False} for member_id in _ids(rbac, "a2")]
        assert rbac["clients"]["hr"].patch(_teams_url(rbac, pool), {"members": rows}, format="json").status_code == 200
        _sync(rbac)
        membership.refresh_from_db()
        assert membership.is_active is False
        b1_profile = AccessProfile.load(rbac["people"]["b1"], rbac["workspace"].id)
        assert not Issue.objects.filter(pk=task["id"]).filter(b1_profile.work_item_q("view")).exists()

    def test_my_access_lists_my_teams_for_the_app(self, rbac):
        pool = _create_team(rbac, "PHP Pool", "b1")
        team_a, team_b = rbac["teams"]
        assert set(_my_access(rbac, "b1")["work_items"]["team_ids"]) == {str(team_b.id), pool["id"]}
        # PM A leads A1 and A2: the teams they're in
        assert set(_my_access(rbac, "pm_a")["work_items"]["led_team_ids"]) == {str(team_a.id)}
        assert set(_my_access(rbac, "pm_b")["work_items"]["led_team_ids"]) == {str(team_b.id), pool["id"]}

    def test_a_raised_guest_membership_still_doesnt_allow_creating(self, rbac):
        ProjectMember.objects.create(
            workspace=rbac["workspace"], project=rbac["projects"]["open"], member=rbac["people"]["b1"], role=5
        )
        qa = _create_team(rbac, "QA", "b1")
        _create_task(rbac, "hr", "open", "Open - QA", qa)

        membership = _membership(rbac, "open", "b1")
        assert (membership.role, membership.rbac_original_role) == (15, 5)
        assert _listed_tasks(rbac, "b1", "open") == {"Open - QA"}
        response = rbac["clients"]["b1"].post(_issues_url(rbac, "open"), {"name": "B1 in Open"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert str(rbac["projects"]["open"].id) not in _my_access(rbac, "b1")["work_items"]["create_project_ids"]

    def test_your_work_lists_team_tasks_under_assigned(self, rbac):
        pool = _create_team(rbac, "PHP Pool", "a2")
        _create_task(rbac, "pm_a", "a", "Alpha - PHP", pool)
        a2 = rbac["people"]["a2"]
        response = rbac["clients"]["a2"].get(
            f"/api/workspaces/{rbac['workspace'].slug}/user-issues/{a2.id}/?assigned_to={a2.id}"
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        assert {issue["name"] for issue in response.json()["results"]} == {"Alpha - A2", "Alpha - PHP"}

    def test_deleting_a_team_unassigns_its_tasks(self, rbac):
        pool = _create_team(rbac, "PHP Pool", "b1")
        task = _create_task(rbac, "pm_a", "a", "Alpha - PHP", pool)
        assert _membership(rbac, "a", "b1").is_active is True
        assert rbac["clients"]["hr"].delete(_teams_url(rbac, pool)).status_code == 204
        assert Issue.objects.get(pk=task["id"]).assignee_team_id is None
        _sync(rbac)
        assert _membership(rbac, "a", "b1").is_active is False

    def test_with_rbac_off_team_members_see_the_task(self, rbac):
        rbac["workspace"].is_rbac_enabled = False
        rbac["workspace"].save(update_fields=["is_rbac_enabled"])
        _sync(rbac)
        # A2 isn't in Shared: the task brings them in
        pool = _create_team(rbac, "PHP Pool", "a1", "a2", who="admin")
        _create_task(rbac, "admin", "shared", "Shared - PHP", pool)
        membership = _membership(rbac, "shared", "a2")
        assert (membership.role, membership.is_active, membership.rbac_managed) == (15, True, True)
        assert "Shared - PHP" in _listed_tasks(rbac, "a1", "shared")
        assert "Shared - PHP" in _listed_tasks(rbac, "a2", "shared")
        assert "Shared - PHP" not in _listed_tasks(rbac, "b1", "shared")


# ---------------------------------------------------------------- projects


def _projects_url(setup):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/"


def _detail_url(setup, project):
    return f"{_projects_url(setup)}{setup['projects'][project].id}/project-detail/"


def _details(**extra):
    return {
        "start_date": "2026-11-01",
        "target_end_date": "2026-12-31",
        "project_type": PROJECT_TYPES[0],
        "status": PROJECT_STATUSES[0],
        "customer_name": "Acme",
        "user_manual_url": "https://example.com/manual",
        **extra,
    }


def _assign(setup, project, team=None, who="admin"):
    team_id = (team["id"] if isinstance(team, dict) else str(team.id)) if team else None
    response = setup["clients"][who].patch(_detail_url(setup, project), {"assigned_team": team_id}, format="json")
    _sync(setup)
    return response


def _listed_projects(setup, who):
    response = setup["clients"][who].get(_projects_url(setup))
    assert response.status_code == status.HTTP_200_OK, response.content
    return {row["name"] for row in response.json()}


@pytest.mark.contract
class TestCreatingProjects:
    def test_a_project_can_be_assigned_to_a_team(self, rbac):
        _, team_b = rbac["teams"]
        payload = {"name": "Gamma", "identifier": "GAMMA", "project_details": _details(assigned_team=str(team_b.id))}
        response = rbac["clients"]["hr"].post(_projects_url(rbac), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        project = Project.objects.get(pk=response.json()["id"])
        rbac["projects"]["gamma"] = project
        assert project.project_lead_id is None
        assert ProjectDetail.objects.get(project=project).assigned_team_id == team_b.id
        _sync(rbac)
        # its creator is its admin; the team's lead and members work in it
        assert _membership(rbac, "gamma", "hr").role == 20
        for who in ("pm_b", "b1"):
            membership = _membership(rbac, "gamma", who)
            assert (membership.role, membership.is_active, membership.rbac_managed) == (15, True, True)
        assert _membership(rbac, "gamma", "a1") is None
        # B1 creates tasks there
        response = rbac["clients"]["b1"].post(_issues_url(rbac, "gamma"), {"name": "B1 in Gamma"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content

    def test_assigned_to_is_required_and_is_one_person_or_one_team(self, rbac):
        hr = rbac["clients"]["hr"]
        _, team_b = rbac["teams"]
        response = hr.post(
            _projects_url(rbac), {"name": "G1", "identifier": "GONE", "project_details": _details()}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert (
            response.json()["project_details"]["project_lead"] == "Pick the person or team the project is assigned to."
        )
        both = {
            "name": "G2",
            "identifier": "GTWO",
            "project_lead": str(rbac["people"]["pm_a"].id),
            "project_details": _details(assigned_team=str(team_b.id)),
        }
        response = hr.post(_projects_url(rbac), both, format="json")
        assert (
            response.json()["project_details"]["project_lead"]
            == "Assign the project to a person or to a team, not both."
        )
        unknown = {
            "name": "G3",
            "identifier": "GTHREE",
            "project_details": _details(assigned_team=str(rbac["people"]["a1"].id)),
        }
        response = hr.post(_projects_url(rbac), unknown, format="json")
        assert response.json()["project_details"]["assigned_team"] == "Pick one of the workspace's teams."
        assert not Project.objects.filter(name__in=["G1", "G2", "G3"]).exists()

    def test_with_role_based_access_the_lead_works_in_the_project(self, rbac):
        payload = {
            "name": "Delta",
            "identifier": "DELTA",
            "project_lead": str(rbac["people"]["a1"].id),
            "project_details": _details(),
        }
        response = rbac["clients"]["pm_a"].post(_projects_url(rbac), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        lead = ProjectMember.objects.get(project_id=response.json()["id"], member=rbac["people"]["a1"])
        assert lead.role == 15  # only the creator and workspace admins change the project

    def test_a_pms_new_project_lets_their_team_create_tasks(self, rbac):
        # the reported case: a PM creates a project, their team members must be able to add its tasks
        payload = {
            "name": "Zeta",
            "identifier": "ZETA",
            "project_lead": str(rbac["people"]["pm_a"].id),
            "project_details": _details(),
        }
        response = rbac["clients"]["pm_a"].post(_projects_url(rbac), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        rbac["projects"]["zeta"] = Project.objects.get(pk=response.json()["id"])
        _sync(rbac)
        for who in ("a1", "a2"):
            membership = _membership(rbac, "zeta", who)
            assert (membership.role, membership.is_active) == (15, True)
            assert str(rbac["projects"]["zeta"].id) in _my_access(rbac, who)["work_items"]["create_project_ids"]
            response = rbac["clients"][who].post(_issues_url(rbac, "zeta"), {"name": f"{who} in Zeta"}, format="json")
            assert response.status_code == status.HTTP_201_CREATED, response.content
        # Team B's member isn't let in
        assert _membership(rbac, "zeta", "b1") is None
        response = rbac["clients"]["b1"].post(_issues_url(rbac, "zeta"), {"name": "B1 in Zeta"}, format="json")
        assert response.status_code in (403, 404)


@pytest.mark.contract
class TestTeamProjectAccess:
    def test_members_of_an_owning_team_work_in_its_projects(self, rbac):
        # Shared is owned by both teams; A2 was never added to it by hand
        membership = _membership(rbac, "shared", "a2")
        assert (membership.role, membership.is_active, membership.rbac_managed) == (15, True, True)
        response = rbac["clients"]["a2"].post(_issues_url(rbac, "shared"), {"name": "A2 in Shared"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        # an employee still sees only their own tasks there
        assert _listed_tasks(rbac, "a2", "shared") == {"A2 in Shared"}

    def test_team_members_see_the_assigned_project_even_if_private(self, rbac):
        team_a, _ = rbac["teams"]
        assert "Secret" not in _listed_projects(rbac, "a1")
        assert _assign(rbac, "private", team_a).status_code == status.HTTP_200_OK
        assert "Secret" in _listed_projects(rbac, "a1")
        membership = _membership(rbac, "private", "a1")
        assert (membership.role, membership.is_active) == (15, True)
        project = f"{_projects_url(rbac)}{rbac['projects']['private'].id}/"
        assert rbac["clients"]["a1"].get(project).status_code == status.HTTP_200_OK
        # working in it, not changing it
        assert rbac["clients"]["a1"].patch(project, {"description": "x"}, format="json").status_code == 403
        response = rbac["clients"]["a1"].post(_issues_url(rbac, "private"), {"name": "A1 in Secret"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        # the team's lead manages its work: PM A sees the unassigned tasks there
        assert "Secret - B1" not in _listed_tasks(rbac, "pm_a", "private")  # B1 is Team B's
        assert "A1 in Secret" in _listed_tasks(rbac, "pm_a", "private")

    def test_leaving_the_team_or_unassigning_it_ends_access(self, rbac):
        team_a, _ = rbac["teams"]
        _assign(rbac, "private", team_a)
        TeamMember.objects.filter(team=team_a, member=rbac["people"]["a2"]).delete(soft=False)
        _sync(rbac)
        assert _membership(rbac, "private", "a2").is_active is False
        assert "Secret" not in _listed_projects(rbac, "a2")
        _assign(rbac, "private", None)
        assert ProjectDetail.objects.get(project=rbac["projects"]["private"]).assigned_team_id is None
        assert _membership(rbac, "private", "a1").is_active is False
        b1 = _membership(rbac, "private", "b1")
        # B1 was a member of the private project by hand: kept as it was
        assert (b1.role, b1.is_active, b1.rbac_managed) == (15, True, False)

    def test_deleting_the_team_unassigns_its_projects(self, rbac):
        pool = _create_team(rbac, "PHP Pool", "a1")
        _assign(rbac, "open", pool)
        assert _membership(rbac, "open", "a1").is_active is True
        assert rbac["clients"]["hr"].delete(_teams_url(rbac, pool)).status_code == status.HTTP_204_NO_CONTENT
        assert ProjectDetail.objects.get(project=rbac["projects"]["open"]).assigned_team_id is None
        _sync(rbac)
        assert _membership(rbac, "open", "a1").is_active is False

    def test_it_works_with_role_based_access_off(self, rbac):
        team_a, _ = rbac["teams"]
        rbac["workspace"].is_rbac_enabled = False
        rbac["workspace"].save(update_fields=["is_rbac_enabled"])
        _assign(rbac, "private", team_a)
        membership = _membership(rbac, "private", "a1")
        assert (membership.role, membership.is_active, membership.rbac_managed) == (15, True, True)
        assert "Secret" in _listed_projects(rbac, "a1")
        # team ownership alone does nothing with role-based access off
        assert _membership(rbac, "shared", "a2").is_active is False

    def test_the_teams_screens_show_the_assigned_team(self, rbac):
        _, team_b = rbac["teams"]
        _assign(rbac, "open", team_b)
        teams = {team["name"]: team for team in rbac["clients"]["hr"].get(_teams_url(rbac)).json()}
        open_id = str(rbac["projects"]["open"].id)
        assert teams["Team B"]["assigned_project_ids"] == [open_id]
        assert teams["Team B"]["project_names"][open_id] == "Open"
        assert teams["Team B"]["project_names"][str(rbac["projects"]["b"].id)] == "Beta"
        access = (
            rbac["clients"]["admin"].get(f"/api/workspaces/{rbac['workspace'].slug}/projects/{open_id}/access/").json()
        )
        assert access["teams"] == [{"id": str(team_b.id), "name": "Team B", "is_owner": False, "is_assigned": True}]
        # PM B now works in Open as its team's lead
        assert _membership(rbac, "open", "pm_b").role == 15


@pytest.mark.contract
class TestChangingDetails:
    def test_only_the_creator_and_workspace_admins_change_the_details(self, rbac):
        url = _detail_url(rbac, "a")
        assert rbac["clients"]["pm_a"].patch(url, {"customer_name": "X"}, format="json").status_code == 403
        assert rbac["clients"]["hr"].patch(url, {"customer_name": "X"}, format="json").status_code == 403
        Project.objects.filter(pk=rbac["projects"]["a"].pk).update(created_by=rbac["people"]["pm_a"])
        _sync(rbac)
        assert rbac["clients"]["pm_a"].patch(url, {"customer_name": "X"}, format="json").status_code == 200
        assert rbac["clients"]["admin"].patch(url, {"customer_name": "Y"}, format="json").status_code == 200

    def test_a_person_or_a_team_never_both(self, rbac):
        team_a, _ = rbac["teams"]
        alpha = rbac["projects"]["a"]
        Project.objects.filter(pk=alpha.pk).update(project_lead=rbac["people"]["pm_a"])
        _assign(rbac, "a", team_a)
        alpha.refresh_from_db()
        assert alpha.project_lead_id is None
        response = rbac["clients"]["admin"].patch(
            f"{_projects_url(rbac)}{alpha.id}/", {"project_lead": str(rbac["people"]["pm_a"].id)}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        assert ProjectDetail.objects.get(project=alpha).assigned_team_id is None
        detail = rbac["clients"]["admin"].get(_detail_url(rbac, "a")).json()
        assert detail["assigned_team"] is None
