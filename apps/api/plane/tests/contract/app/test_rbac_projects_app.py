# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Role-based access, step 4: projects (plane.utils.rbac.sync_project_access, project views).

The workspace is the plan's example (see plane/tests/unit/utils/test_rbac_engine.py). With RBAC on:
  * project memberships follow the roles: HR is an admin of every project, a PM of their team projects, a view-only
    share gives a guest membership; hand-made memberships are never removed and get their old role back;
    switching RBAC off undoes all of it;
  * the project list and project pages show each person their scope; joining is limited to it, as a guest;
  * creating, editing, deleting and archiving projects and managing their members follow the role;
  * a PM's new project belongs to the teams they lead.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import AccessGrant, Project, ProjectMember, ProjectTeam, TeamMember, UserRole
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import sync_project_access


def _enable(org, on=True):  # noqa: F811
    org["workspace"].is_rbac_enabled = on
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)


@pytest.fixture
def rbac(org):  # noqa: F811
    _enable(org)
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return {**org, "clients": clients}


def _membership(setup, project, who):
    return ProjectMember.objects.filter(project=setup["projects"][project], member=setup["people"][who]).first()


def _base(setup):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/"


def _listed(setup, who):
    response = setup["clients"][who].get(_base(setup))
    assert response.status_code == status.HTTP_200_OK, response.content
    names = {row["name"] for row in response.json()}
    return {key for key, project in setup["projects"].items() if project.name in names}


ALL_PROJECTS = {"a", "b", "shared", "open", "private"}


@pytest.mark.contract
class TestMembershipSync:
    def test_hr_is_admin_of_every_project(self, rbac):
        for project in ALL_PROJECTS:
            membership = _membership(rbac, project, "hr")
            assert membership.role == 20 and membership.is_active and membership.rbac_managed, project

    def test_pms_are_admins_of_their_team_projects_only(self, rbac):
        for project in ("a", "shared"):
            membership = _membership(rbac, project, "pm_a")
            # PM A was a member by hand: raised to admin, the old role kept
            assert (membership.role, membership.rbac_managed, membership.rbac_original_role) == (20, False, 15)
        assert _membership(rbac, "b", "pm_a") is None

    def test_employees_are_left_alone(self, rbac):
        assert _membership(rbac, "a", "a1").role == 15
        assert _membership(rbac, "open", "a1") is None

    def test_a_view_only_share_gives_a_guest_membership_until_it_ends(self, rbac):
        grant = AccessGrant.objects.create(
            workspace=rbac["workspace"], project=rbac["projects"]["b"], member=rbac["people"]["pm_a"], level="view"
        )
        sync_project_access(rbac["workspace"].id)
        assert (_membership(rbac, "b", "pm_a").role, _membership(rbac, "b", "pm_a").is_active) == (5, True)
        grant.delete(soft=False)
        sync_project_access(rbac["workspace"].id)
        assert _membership(rbac, "b", "pm_a").is_active is False

    def test_leaving_a_team_gives_the_old_role_back(self, rbac):
        TeamMember.objects.filter(member=rbac["people"]["pm_a"]).delete(soft=False)
        sync_project_access(rbac["workspace"].id)
        membership = _membership(rbac, "a", "pm_a")
        assert (membership.role, membership.is_active, membership.rbac_original_role) == (15, True, None)

    def test_switching_rbac_off_undoes_every_change(self, rbac):
        _enable(rbac, on=False)
        assert not ProjectMember.objects.filter(member=rbac["people"]["hr"], is_active=True).exists()
        membership = _membership(rbac, "shared", "pm_a")
        assert (membership.role, membership.is_active, membership.rbac_original_role) == (15, True, None)
        # and on again: back as before
        _enable(rbac)
        assert _membership(rbac, "private", "hr").is_active

    def test_a_new_project_reaches_hr(self, rbac):
        project = Project.objects.create(name="Gamma", identifier="GAMMA", workspace=rbac["workspace"])
        sync_project_access(rbac["workspace"].id)
        assert ProjectMember.objects.get(project=project, member=rbac["people"]["hr"]).role == 20


@pytest.mark.contract
class TestProjectList:
    @pytest.mark.parametrize(
        "who, projects",
        [
            ("hr", ALL_PROJECTS),
            ("pm_a", {"a", "shared"}),
            ("pm_b", {"b", "shared"}),
            ("a1", {"a", "b", "shared", "open"}),  # not the private project
            ("b1", ALL_PROJECTS),  # a member of the private one
        ],
    )
    def test_list_follows_the_roles(self, rbac, who, projects):
        assert _listed(rbac, who) == projects

    def test_project_outside_the_scope_is_refused(self, rbac):
        beta = rbac["projects"]["b"].id
        assert rbac["clients"]["pm_a"].get(f"{_base(rbac)}{beta}/").status_code == status.HTTP_403_FORBIDDEN
        # an employee may look at a public project, by joining it
        response = rbac["clients"]["a1"].get(f"{_base(rbac)}{rbac['projects']['open'].id}/")
        assert response.status_code == status.HTTP_409_CONFLICT

    def test_joining_is_limited_to_the_scope_and_needs_the_pms_approval(self, rbac):
        url = f"/api/users/me/workspaces/{rbac['workspace'].slug}/projects/invitations/"
        # employees can't manage Open: they ask their PM instead (test_project_join_requests_app.py)
        response = rbac["clients"]["a1"].post(url, {"project_ids": [str(rbac["projects"]["open"].id)]}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN and response.json()["needs_approval"] is True
        assert _membership(rbac, "open", "a1") is None
        # people who can manage it join directly (HR is already its admin through the sync)
        response = rbac["clients"]["hr"].post(url, {"project_ids": [str(rbac["projects"]["open"].id)]}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        assert _membership(rbac, "open", "hr").is_active
        response = rbac["clients"]["pm_a"].post(url, {"project_ids": [str(rbac["projects"]["b"].id)]}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert _membership(rbac, "b", "pm_a") is None


@pytest.mark.contract
class TestMembersWithoutARole:
    """A new member nobody has given a role sees no projects (not even ones they belong to) until they get one."""

    def test_no_projects_until_a_role_is_given(self, rbac):
        url = f"/api/users/me/workspaces/{rbac['workspace'].slug}/projects/invitations/"
        loner = rbac["clients"]["loner"]
        assert _listed(rbac, "loner") == set()
        assert loner.get(f"{_base(rbac)}details/").json() == []
        # the project they're a member of doesn't open, and nothing can be joined
        assert loner.get(f"{_base(rbac)}{rbac['projects']['shared'].id}/").status_code == status.HTTP_403_FORBIDDEN
        response = loner.post(url, {"project_ids": [str(rbac["projects"]["open"].id)]}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert _membership(rbac, "open", "loner") is None

        UserRole.objects.create(
            workspace=rbac["workspace"], role=rbac["roles"]["employee"], member=rbac["people"]["loner"]
        )
        assert _listed(rbac, "loner") == {"a", "b", "shared", "open"}


@pytest.mark.contract
class TestProjectChanges:
    def test_employees_cannot_create_projects(self, rbac):
        response = rbac["clients"]["a1"].post(_base(rbac), {"name": "Mine", "identifier": "MINE"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Project.objects.filter(identifier="MINE").exists()

    def test_a_pms_new_project_belongs_to_their_team(self, rbac):
        response = rbac["clients"]["pm_a"].post(_base(rbac), {"name": "Delta", "identifier": "DELTA"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        assert list(ProjectTeam.objects.filter(project_id=response.json()["id"]).values_list("team", flat=True)) == [
            rbac["teams"][0].id
        ]

    def test_editing_follows_the_role_not_the_project_role(self, rbac):
        alpha = f"{_base(rbac)}{rbac['projects']['a'].id}/"
        # even as a project admin by hand, an employee can't change the project
        ProjectMember.objects.filter(project=rbac["projects"]["a"], member=rbac["people"]["a1"]).update(role=20)
        assert rbac["clients"]["a1"].patch(alpha, {"description": "x"}, format="json").status_code == 403
        assert rbac["clients"]["pm_a"].patch(alpha, {"description": "Team A"}, format="json").status_code == 200
        beta = f"{_base(rbac)}{rbac['projects']['b'].id}/"
        assert rbac["clients"]["pm_a"].patch(beta, {"description": "x"}, format="json").status_code == 403

    def test_deleting_and_archiving(self, rbac):
        beta = rbac["projects"]["b"].id
        assert rbac["clients"]["pm_a"].delete(f"{_base(rbac)}{beta}/").status_code == status.HTTP_403_FORBIDDEN
        archive = f"{_base(rbac)}{rbac['projects']['a'].id}/archive/"
        assert rbac["clients"]["a1"].post(archive).status_code == status.HTTP_403_FORBIDDEN
        assert rbac["clients"]["pm_b"].delete(f"{_base(rbac)}{beta}/").status_code == status.HTTP_204_NO_CONTENT

    def test_managing_members_is_editing_the_project(self, rbac):
        members = f"{_base(rbac)}{rbac['projects']['a'].id}/members/"
        payload = {"members": [{"member_id": str(rbac["people"]["b1"].id), "role": 15}]}
        assert rbac["clients"]["a2"].post(members, payload, format="json").status_code == 403
        assert rbac["clients"]["pm_a"].post(members, payload, format="json").status_code == 201
