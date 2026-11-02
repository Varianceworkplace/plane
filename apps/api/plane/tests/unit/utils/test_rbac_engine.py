# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Role-based access, step 2: the rules engine (plane.utils.rbac).

The workspace below is the plan's example: PM A leads Team A (A1, A2), PM B leads Team B (B1), the two teams share
one project, HR sees everything, and an employee only sees the work items assigned to them.
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from plane.db.models import (
    AccessGrant,
    Issue,
    IssueAssignee,
    Project,
    ProjectMember,
    ProjectTeam,
    Role,
    TeamMember,
    User,
    UserRole,
    WorkspaceMember,
)
from plane.db.models.workspace import Team
from plane.utils.rbac import AccessProfile


def _user(workspace, name, role=15):
    uid = uuid4().hex[:8]
    user = User.objects.create(email=f"{name}-{uid}@plane.so", username=f"{name}_{uid}", first_name=name)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def _issue(project, name, assignee=None, creator=None):
    issue = Issue.objects.create(name=name, workspace=project.workspace, project=project)
    if creator:
        # BaseModel.save fills created_by from the request's user; tests have none
        Issue.all_objects.filter(pk=issue.pk).update(created_by=creator)
    if assignee:
        IssueAssignee.objects.create(issue=issue, assignee=assignee, project=project)
    return issue


@pytest.fixture
def org(db, workspace, create_user):
    w = workspace
    roles = {role.key: role for role in Role.objects.filter(workspace=w, is_system=True)}
    people = {
        "admin": create_user,
        "hr": _user(w, "hr"),
        "pm_a": _user(w, "pm_a"),
        "pm_b": _user(w, "pm_b"),
        "a1": _user(w, "a1"),
        "a2": _user(w, "a2"),
        "b1": _user(w, "b1"),
        "loner": _user(w, "loner"),  # no team, no role
    }
    for name, key in (
        ("hr", "hr"),
        ("pm_a", "pm"),
        ("pm_b", "pm"),
        ("a1", "employee"),
        ("a2", "employee"),
        ("b1", "employee"),
    ):
        UserRole.objects.create(workspace=w, role=roles[key], member=people[name])

    team_a = Team.objects.create(name="Team A", workspace=w)
    team_b = Team.objects.create(name="Team B", workspace=w)
    for team, lead, members in ((team_a, "pm_a", ("a1", "a2")), (team_b, "pm_b", ("b1",))):
        TeamMember.objects.create(workspace=w, team=team, member=people[lead], is_lead=True)
        for name in members:
            TeamMember.objects.create(workspace=w, team=team, member=people[name])

    projects = {
        "a": Project.objects.create(name="Alpha", identifier="ALPHA", workspace=w),
        "b": Project.objects.create(name="Beta", identifier="BETA", workspace=w),
        "shared": Project.objects.create(name="Shared", identifier="SHARED", workspace=w),
        "open": Project.objects.create(name="Open", identifier="OPEN", workspace=w),
        "private": Project.objects.create(name="Secret", identifier="SECRET", workspace=w, network=0),
    }
    for key, teams in (("a", [team_a]), ("b", [team_b]), ("shared", [team_a, team_b])):
        for team in teams:
            ProjectTeam.objects.create(workspace=w, project=projects[key], team=team)
    for key, names in (
        ("a", ("pm_a", "a1", "a2")),
        ("b", ("pm_b", "b1", "a1")),
        ("shared", ("pm_a", "pm_b", "a1", "b1", "loner")),
        ("private", ("b1",)),
    ):
        for name in names:
            ProjectMember.objects.create(workspace=w, project=projects[key], member=people[name], role=15)

    issues = {
        "shared_a1": _issue(projects["shared"], "Shared - A1", assignee=people["a1"]),
        "shared_b1": _issue(projects["shared"], "Shared - B1", assignee=people["b1"]),
        "shared_new": _issue(projects["shared"], "Shared - unassigned", creator=people["a1"]),
        "shared_loner": _issue(projects["shared"], "Shared - loner", assignee=people["loner"]),
        "a_a2": _issue(projects["a"], "Alpha - A2", assignee=people["a2"]),
        "b_b1": _issue(projects["b"], "Beta - B1", assignee=people["b1"]),
        "b_a1": _issue(projects["b"], "Beta - A1", assignee=people["a1"]),
        "private_b1": _issue(projects["private"], "Secret - B1", assignee=people["b1"]),
    }
    return {
        "workspace": w,
        "people": people,
        "projects": projects,
        "issues": issues,
        "teams": (team_a, team_b),
        "roles": roles,
    }


def _profile(org, name):
    return AccessProfile.load(org["people"][name], org["workspace"].id)


def _visible_issues(org, name, action="view"):
    q = _profile(org, name).work_item_q(action)
    ids = set(Issue.all_objects.filter(workspace=org["workspace"]).filter(q).values_list("id", flat=True))
    return {key for key, issue in org["issues"].items() if issue.id in ids}


def _visible_projects(org, name, action="view"):
    q = _profile(org, name).project_q(action)
    ids = set(Project.objects.filter(workspace=org["workspace"]).filter(q).values_list("id", flat=True))
    return {key for key, project in org["projects"].items() if project.id in ids}


ALL_ISSUES = {"shared_a1", "shared_b1", "shared_new", "shared_loner", "a_a2", "b_b1", "b_a1", "private_b1"}
ALL_PROJECTS = {"a", "b", "shared", "open", "private"}


@pytest.mark.unit
class TestWorkItems:
    @pytest.mark.django_db
    @pytest.mark.parametrize("name", ["hr", "admin"])
    def test_hr_and_admins_see_every_work_item(self, org, name):
        assert _visible_issues(org, name) == ALL_ISSUES

    @pytest.mark.django_db
    def test_pm_a_sees_team_a_work_and_the_unclaimed_ones_in_team_a_projects(self, org):
        # A1's task in Team B's project counts (it's a Team A member's); B1's task in the shared project doesn't
        assert _visible_issues(org, "pm_a") == {"shared_a1", "shared_new", "shared_loner", "a_a2", "b_a1"}

    @pytest.mark.django_db
    def test_pm_b_sees_team_b_work_and_not_team_a_tasks_in_its_own_project(self, org):
        assert _visible_issues(org, "pm_b") == {"shared_b1", "shared_new", "shared_loner", "b_b1", "private_b1"}

    @pytest.mark.django_db
    def test_employees_see_only_what_is_assigned_to_them(self, org):
        assert _visible_issues(org, "a2") == {"a_a2"}
        assert _visible_issues(org, "b1") == {"shared_b1", "b_b1", "private_b1"}

    @pytest.mark.django_db
    def test_an_unassigned_work_item_stays_with_its_creator_until_it_is_assigned(self, org):
        assert _visible_issues(org, "a1") == {"shared_a1", "shared_new", "b_a1"}
        IssueAssignee.objects.create(
            issue=org["issues"]["shared_new"], assignee=org["people"]["b1"], project=org["projects"]["shared"]
        )
        assert _visible_issues(org, "a1") == {"shared_a1", "b_a1"}

    @pytest.mark.django_db
    def test_no_role_means_no_projects_or_work_items_until_one_is_given(self, org):
        loner = _profile(org, "loner")
        assert loner.has_role is False
        # not even their own work item, nor the project they're a member of
        assert _visible_issues(org, "loner") == set()
        assert _visible_projects(org, "loner") == set()
        assert not loner.can_create_work_item(org["projects"]["shared"].id)
        assert loner.scopes("milestones", "view") == set() and loner.scopes("worklogs", "view") == set()
        # tickets keep their own rules for everyone
        assert loner.scopes("tickets", "view") == {"own"}

        UserRole.objects.create(
            workspace=org["workspace"], role=org["roles"]["employee"], member=org["people"]["loner"]
        )
        assert _profile(org, "loner").has_role is True
        assert _visible_issues(org, "loner") == {"shared_loner"}
        assert _visible_projects(org, "loner") == {"a", "b", "shared", "open"}

    @pytest.mark.django_db
    def test_employees_edit_only_their_own_and_never_delete(self, org):
        a1 = _profile(org, "a1")
        assert a1.can_on_work_item("edit", org["issues"]["shared_a1"])
        assert not a1.can_on_work_item("edit", org["issues"]["shared_b1"])
        assert not a1.can("work_items", "delete")
        assert not a1.can_on_work_item("delete", org["issues"]["shared_a1"])

    @pytest.mark.django_db
    def test_pm_deletes_only_within_their_team_scope(self, org):
        pm_a = _profile(org, "pm_a")
        assert pm_a.can_on_work_item("delete", org["issues"]["a_a2"])
        assert not pm_a.can_on_work_item("delete", org["issues"]["b_b1"])

    @pytest.mark.django_db
    def test_creating_work_items(self, org):
        a1, pm_a, hr = _profile(org, "a1"), _profile(org, "pm_a"), _profile(org, "hr")
        projects = org["projects"]
        # employees: in the projects they're members of
        assert a1.can_create_work_item(projects["a"].id)
        assert not a1.can_create_work_item(projects["open"].id)
        # PMs: in their team projects; HR: anywhere
        assert pm_a.can_create_work_item(projects["shared"].id)
        assert not pm_a.can_create_work_item(projects["b"].id)
        assert hr.can_create_work_item(projects["open"].id)


@pytest.mark.unit
class TestProjects:
    @pytest.mark.django_db
    @pytest.mark.parametrize("name", ["hr", "admin"])
    def test_hr_and_admins_see_every_project_including_private_ones(self, org, name):
        assert _visible_projects(org, name) == ALL_PROJECTS
        assert _visible_projects(org, name, "delete") == ALL_PROJECTS

    @pytest.mark.django_db
    def test_employees_see_projects_but_private_ones_only_as_members(self, org):
        assert _visible_projects(org, "a1") == {"a", "b", "shared", "open"}
        assert _visible_projects(org, "b1") == ALL_PROJECTS
        a1 = _profile(org, "a1")
        for action in ("create", "edit", "delete"):
            assert not a1.can("projects", action)
            assert _visible_projects(org, "a1", action) == set()

    @pytest.mark.django_db
    def test_pms_manage_their_team_projects_only(self, org):
        assert _visible_projects(org, "pm_a") == {"a", "shared"}
        assert _visible_projects(org, "pm_a", "edit") == {"a", "shared"}
        assert _visible_projects(org, "pm_b", "delete") == {"b", "shared"}
        pm_a = _profile(org, "pm_a")
        assert pm_a.can("projects", "create")
        assert not pm_a.can_on_project("edit", org["projects"]["b"])

    @pytest.mark.django_db
    def test_sharing_with_a_pm(self, org):
        w, beta = org["workspace"], org["projects"]["b"]
        grant = AccessGrant.objects.create(workspace=w, project=beta, member=org["people"]["pm_a"], level="view")
        # view only: PM A sees Beta, can't change it, and still doesn't see Team B's tasks in it
        assert "b" in _visible_projects(org, "pm_a")
        assert "b" not in _visible_projects(org, "pm_a", "edit")
        assert "b_b1" not in _visible_issues(org, "pm_a")
        grant.level = "manage"
        grant.save()
        assert "b" in _visible_projects(org, "pm_a", "edit")

    @pytest.mark.django_db
    def test_sharing_with_a_team_and_expiry(self, org):
        w, beta = org["workspace"], org["projects"]["b"]
        grant = AccessGrant.objects.create(workspace=w, project=beta, team=org["teams"][0], level="manage")
        assert "b" in _visible_projects(org, "pm_a", "edit")
        grant.expires_at = timezone.now() - timedelta(minutes=1)
        grant.save()
        assert "b" not in _visible_projects(org, "pm_a")

    @pytest.mark.django_db
    def test_private_project_reaches_the_pm_of_a_team_that_owns_it(self, org):
        ProjectTeam.objects.create(workspace=org["workspace"], project=org["projects"]["private"], team=org["teams"][0])
        assert "private" in _visible_projects(org, "pm_a")
        assert "private" not in _visible_projects(org, "a2")


@pytest.mark.unit
class TestRolesAddUp:
    @pytest.mark.django_db
    def test_two_roles_give_the_rights_of_both(self, org):
        w, a1 = org["workspace"], org["people"]["a1"]
        assert not _profile(org, "a1").can("projects", "edit")
        UserRole.objects.create(workspace=w, role=org["roles"]["pm"], member=a1)
        profile = _profile(org, "a1")
        assert profile.scopes("work_items", "view") == {"own", "team"}
        assert profile.can("projects", "edit")

    @pytest.mark.django_db
    def test_a_team_without_its_pm_is_seen_only_by_hr(self, org):
        TeamMember.objects.filter(member=org["people"]["pm_b"]).delete(soft=False)
        assert "b_b1" not in _visible_issues(org, "pm_b")
        assert "b_b1" in _visible_issues(org, "hr")

    @pytest.mark.django_db
    def test_role_edits_apply(self, org):
        employee = org["roles"]["employee"]
        employee.permissions.filter(module="work_items", action="view").update(scope="member")
        # A2 now sees every work item in the projects they're a member of (Alpha)
        assert _visible_issues(org, "a2") == {"a_a2"}
        assert _visible_issues(org, "a1") == {
            "shared_a1",
            "shared_b1",
            "shared_new",
            "shared_loner",
            "a_a2",
            "b_b1",
            "b_a1",
        }


@pytest.mark.unit
class TestPerRequestCache:
    @pytest.mark.django_db
    def test_worked_out_once_per_request_and_workspace(self, org, django_assert_num_queries):
        from types import SimpleNamespace

        from plane.utils.rbac import access_for

        request = SimpleNamespace(user=org["people"]["pm_a"])
        first = access_for(request, org["workspace"].id)
        with django_assert_num_queries(0):
            assert access_for(request, org["workspace"].id) is first
        # a new request works it out again
        assert access_for(SimpleNamespace(user=org["people"]["pm_a"]), org["workspace"].id) is not first
