# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Role-based access, step 1: the data model (plane.db.models.rbac).

Rules under test:
  * every workspace gets the built-in HR, Project Manager and Employee roles with their default permissions;
    seeding again adds what's missing and never overwrites an admin's edits; nobody is given a role
  * built-in roles can't be deleted, nor can a role someone still holds
  * role names are unique per workspace; a role grants each module/action once, with a valid action and scope
  * people can hold several roles but not the same one twice, only roles of the same workspace
  * team membership (Lead or Member) is unique per person; several teams can own one project, once each
  * a project is shared with exactly one person or one team; expired grants aren't active
  * RBAC is off for every workspace until turned on
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from plane.db.models import (
    SYSTEM_ROLES,
    AccessGrant,
    Project,
    ProjectTeam,
    Role,
    RolePermission,
    TeamMember,
    User,
    UserRole,
    Workspace,
)
from plane.db.models.rbac import seed_system_roles
from plane.db.models.workspace import Team


def _user(name):
    uid = uuid4().hex[:8]
    return User.objects.create(email=f"{name}-{uid}@plane.so", username=f"{name}_{uid}", first_name=name.title())


def _rejected(callable_):
    """True when the database refuses the write (kept in its own transaction so the test can go on)."""
    try:
        with transaction.atomic():
            callable_()
    except IntegrityError:
        return True
    return False


@pytest.fixture
def setup(db, workspace, create_user):
    other_workspace = Workspace.objects.create(name="Other", slug=f"other-{uuid4().hex[:6]}", owner=create_user)
    project = Project.objects.create(name="Verbix", identifier="VERBIX", workspace=workspace)
    team_a = Team.objects.create(name="Team A", workspace=workspace)
    team_b = Team.objects.create(name="Team B", workspace=workspace)
    return {
        "workspace": workspace,
        "other_workspace": other_workspace,
        "project": project,
        "team_a": team_a,
        "team_b": team_b,
        "hiral": _user("hiral"),
        "vijay": _user("vijay"),
        "roles": {role.key: role for role in Role.objects.filter(workspace=workspace, is_system=True)},
    }


def _permissions(role):
    return {(p.module, p.action): p.scope for p in RolePermission.objects.filter(role=role)}


def _expected(key):
    return {
        (module, action): scope for module, actions in SYSTEM_ROLES[key][2].items() for action, scope in actions.items()
    }


@pytest.mark.unit
class TestSystemRoles:
    @pytest.mark.django_db
    def test_every_new_workspace_gets_the_built_in_roles(self, setup):
        for workspace in (setup["workspace"], setup["other_workspace"]):
            roles = Role.objects.filter(workspace=workspace)
            assert {r.key for r in roles} == {"hr", "pm", "employee"}
            assert {r.name for r in roles} == {"HR", "Project Manager", "Employee"}
            assert all(r.is_system for r in roles)
            for role in roles:
                assert _permissions(role) == _expected(role.key)
        # nobody holds a role yet
        assert not UserRole.objects.exists()

    @pytest.mark.django_db
    def test_default_matrix(self, setup):
        hr, pm, employee = (_permissions(setup["roles"][key]) for key in ("hr", "pm", "employee"))
        assert hr[("projects", "delete")] == "all" and hr[("role_management", "edit")] == "all"
        assert pm[("projects", "edit")] == "team" and pm[("work_items", "view")] == "team"
        assert ("role_management", "view") not in pm
        # employees: view projects, see only their own work items, create in their projects, never delete
        assert employee[("projects", "view")] == "all"
        assert ("projects", "edit") not in employee and ("projects", "create") not in employee
        assert employee[("work_items", "view")] == "own" and employee[("work_items", "create")] == "member"
        assert ("work_items", "delete") not in employee
        # tickets keep their own rule (creator and assignee) for everyone, and can't be deleted
        for permissions in (hr, pm, employee):
            assert permissions[("tickets", "view")] == "own" and ("tickets", "delete") not in permissions

    @pytest.mark.django_db
    def test_seeding_again_keeps_edits_and_adds_only_what_is_missing(self, setup):
        workspace = setup["workspace"]
        pm = setup["roles"]["pm"]
        RolePermission.objects.filter(role=pm, module="analytics", action="view").update(scope="all")
        # a built-in role that went missing (e.g. removed directly in the database) comes back
        RolePermission.objects.filter(role=setup["roles"]["employee"]).delete(soft=False)
        Role.objects.filter(pk=setup["roles"]["employee"].pk).delete(soft=False)

        seed_system_roles(Role, RolePermission, workspace.id)

        assert Role.objects.filter(workspace=workspace).count() == 3
        assert _permissions(pm)[("analytics", "view")] == "all"
        assert _permissions(Role.objects.get(workspace=workspace, key="employee")) == _expected("employee")

    @pytest.mark.django_db
    def test_built_in_roles_cannot_be_deleted(self, setup):
        with pytest.raises(ValidationError):
            setup["roles"]["hr"].delete()
        assert Role.objects.filter(pk=setup["roles"]["hr"].pk).exists()


@pytest.mark.unit
class TestCustomRoles:
    @pytest.mark.django_db
    def test_names_are_unique_per_workspace(self, setup):
        Role.objects.create(workspace=setup["workspace"], name="Team Lead")
        assert _rejected(lambda: Role.objects.create(workspace=setup["workspace"], name="Team Lead"))
        assert _rejected(lambda: Role.objects.create(workspace=setup["workspace"], name="HR"))
        # the same name is fine in another workspace
        Role.objects.create(workspace=setup["other_workspace"], name="Team Lead")

    @pytest.mark.django_db
    def test_a_role_still_held_cannot_be_deleted(self, setup):
        role = Role.objects.create(workspace=setup["workspace"], name="Auditor")
        holder = UserRole.objects.create(workspace=setup["workspace"], role=role, member=setup["hiral"])
        with pytest.raises(ValidationError):
            role.delete()
        holder.delete(soft=False)
        role.delete()
        assert not Role.objects.filter(pk=role.pk).exists()
        # its name can be used again once deleted
        Role.objects.create(workspace=setup["workspace"], name="Auditor")

    @pytest.mark.django_db
    def test_permissions_are_unique_and_valid(self, setup):
        role = Role.objects.create(workspace=setup["workspace"], name="Auditor")
        RolePermission.objects.create(role=role, module="projects", action="view", scope="all")
        assert _rejected(
            lambda: RolePermission.objects.create(role=role, module="projects", action="view", scope="own")
        )
        assert _rejected(
            lambda: RolePermission.objects.create(role=role, module="projects", action="archive", scope="all")
        )
        assert _rejected(
            lambda: RolePermission.objects.create(role=role, module="projects", action="edit", scope="everyone")
        )


@pytest.mark.unit
class TestUserRoles:
    @pytest.mark.django_db
    def test_several_roles_but_not_the_same_one_twice(self, setup):
        workspace, hiral, roles = setup["workspace"], setup["hiral"], setup["roles"]
        UserRole.objects.create(workspace=workspace, role=roles["pm"], member=hiral)
        UserRole.objects.create(workspace=workspace, role=roles["hr"], member=hiral)
        assert UserRole.objects.filter(member=hiral).count() == 2
        assert _rejected(lambda: UserRole.objects.create(workspace=workspace, role=roles["pm"], member=hiral))

    @pytest.mark.django_db
    def test_only_roles_of_the_same_workspace(self, setup):
        with pytest.raises(ValidationError):
            UserRole.objects.create(
                workspace=setup["other_workspace"], role=setup["roles"]["pm"], member=setup["hiral"]
            )


@pytest.mark.unit
class TestTeams:
    @pytest.mark.django_db
    def test_lead_and_members_once_each(self, setup):
        workspace, team = setup["workspace"], setup["team_a"]
        TeamMember.objects.create(workspace=workspace, team=team, member=setup["vijay"], is_lead=True)
        TeamMember.objects.create(workspace=workspace, team=team, member=setup["hiral"])
        assert list(TeamMember.objects.filter(team=team, is_lead=True).values_list("member", flat=True)) == [
            setup["vijay"].id
        ]
        assert _rejected(lambda: TeamMember.objects.create(workspace=workspace, team=team, member=setup["hiral"]))
        # one person can be in several teams
        TeamMember.objects.create(workspace=workspace, team=setup["team_b"], member=setup["hiral"])

    @pytest.mark.django_db
    def test_team_of_another_workspace_is_refused(self, setup):
        with pytest.raises(ValidationError):
            TeamMember.objects.create(workspace=setup["other_workspace"], team=setup["team_a"], member=setup["hiral"])

    @pytest.mark.django_db
    def test_several_teams_own_one_project_once_each(self, setup):
        workspace, project = setup["workspace"], setup["project"]
        ProjectTeam.objects.create(workspace=workspace, project=project, team=setup["team_a"])
        ProjectTeam.objects.create(workspace=workspace, project=project, team=setup["team_b"])
        assert ProjectTeam.objects.filter(project=project).count() == 2
        assert _rejected(lambda: ProjectTeam.objects.create(workspace=workspace, project=project, team=setup["team_a"]))


@pytest.mark.unit
class TestAccessGrants:
    @pytest.mark.django_db
    def test_shared_with_exactly_one_person_or_team(self, setup):
        workspace, project = setup["workspace"], setup["project"]
        AccessGrant.objects.create(workspace=workspace, project=project, member=setup["hiral"])
        AccessGrant.objects.create(workspace=workspace, project=project, team=setup["team_b"], level="manage")
        assert _rejected(lambda: AccessGrant.objects.create(workspace=workspace, project=project))
        assert _rejected(
            lambda: AccessGrant.objects.create(
                workspace=workspace, project=project, member=setup["vijay"], team=setup["team_a"]
            )
        )
        # once per person or team, and only view / manage
        assert _rejected(
            lambda: AccessGrant.objects.create(workspace=workspace, project=project, member=setup["hiral"])
        )
        assert _rejected(
            lambda: AccessGrant.objects.create(workspace=workspace, project=project, member=setup["vijay"], level="own")
        )

    @pytest.mark.django_db
    def test_expired_grants_are_not_active(self, setup):
        workspace, project, now = setup["workspace"], setup["project"], timezone.now()
        forever = AccessGrant.objects.create(workspace=workspace, project=project, member=setup["hiral"])
        later = AccessGrant.objects.create(
            workspace=workspace, project=project, team=setup["team_a"], expires_at=now + timedelta(days=7)
        )
        AccessGrant.objects.create(
            workspace=workspace, project=project, member=setup["vijay"], expires_at=now - timedelta(minutes=1)
        )
        assert set(AccessGrant.objects.active().values_list("id", flat=True)) == {forever.id, later.id}
        assert AccessGrant.objects.filter(project=project).count() == 3


@pytest.mark.unit
class TestSwitch:
    @pytest.mark.django_db
    def test_rbac_is_off_until_turned_on(self, setup):
        assert Workspace.objects.get(pk=setup["workspace"].pk).is_rbac_enabled is False
        assert Workspace.objects.get(pk=setup["other_workspace"].pk).is_rbac_enabled is False
