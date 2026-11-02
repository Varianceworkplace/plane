# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Role-based access, step 6: the admin screens' API (plane.app.views.rbac).

Rules under test:
  * workspace admins and people with Role management (HR) manage roles, who holds them, teams and their projects,
    and check anyone's access; nobody else does; only workspace admins switch role-based access on or off
  * a team's Lead permissions replace what its leads' roles grant for those actions (more or less); its members and
    other teams' leads keep their roles
  * built-in roles can't be deleted, nor can a role someone holds; names are unique; permissions are validated
  * a project is shared by whoever may edit it; one share per person or team
"""

from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    AccessGrant,
    Issue,
    ProjectMember,
    ProjectTeam,
    Role,
    RolePermission,
    TeamMember,
    TeamPermission,
    UserRole,
)
from plane.db.models.workspace import Team
from plane.utils.rbac import AccessProfile
from plane.tests.unit.utils.test_rbac_engine import _issue, org  # noqa: F401  (the example workspace fixture)


@pytest.fixture
def setup(org):  # noqa: F811
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return {**org, "clients": clients, "base": f"/api/workspaces/{org['workspace'].slug}/access-control/"}


def _get(setup, who, path=""):
    return setup["clients"][who].get(setup["base"] + path)


@pytest.mark.contract
class TestWhoManages:
    @pytest.mark.parametrize("who, code", [("admin", 200), ("hr", 200), ("pm_a", 403), ("a1", 403)])
    def test_admins_and_hr_only(self, setup, who, code):
        assert _get(setup, who).status_code == code
        assert _get(setup, who, "roles/").status_code == code
        assert _get(setup, who, "teams/").status_code == code
        assert _get(setup, who, "members/").status_code == code

    def test_only_workspace_admins_switch_rbac(self, setup):
        assert _get(setup, "admin").json()["can_switch"] is True
        assert _get(setup, "hr").json()["can_switch"] is False
        assert setup["clients"]["hr"].patch(setup["base"], {"is_rbac_enabled": True}, format="json").status_code == 403
        response = setup["clients"]["admin"].patch(setup["base"], {"is_rbac_enabled": True}, format="json")
        assert response.status_code == 200
        setup["workspace"].refresh_from_db()
        assert setup["workspace"].is_rbac_enabled is True


@pytest.mark.contract
class TestRoles:
    def test_list_shows_the_built_in_roles_and_who_holds_them(self, setup):
        roles = {role["key"]: role for role in _get(setup, "hr", "roles/").json()}
        assert set(roles) == {"hr", "pm", "employee"}
        assert (roles["hr"]["holder_count"], roles["pm"]["holder_count"], roles["employee"]["holder_count"]) == (
            1,
            2,
            3,
        )
        assert {"module": "projects", "action": "edit", "scope": "team"} in roles["pm"]["permissions"]

    def test_create_edit_and_delete_a_role(self, setup):
        hr, url = setup["clients"]["hr"], setup["base"] + "roles/"
        payload = {
            "name": "Auditor",
            "description": "Reads everything",
            "permissions": [{"module": "projects", "action": "view", "scope": "all"}],
        }
        created = hr.post(url, payload, format="json")
        assert created.status_code == status.HTTP_201_CREATED, created.content
        role_id = created.json()["id"]
        assert hr.post(url, {**payload, "permissions": []}, format="json").status_code == 400  # same name
        bad = {"name": "X", "permissions": [{"module": "projects", "action": "fly", "scope": "all"}]}
        assert hr.post(url, bad, format="json").status_code == 400
        twice = {"name": "Y", "permissions": [{"module": "projects", "action": "view", "scope": "all"}] * 2}
        assert hr.post(url, twice, format="json").status_code == 400

        new_permissions = [
            {"module": "work_items", "action": "view", "scope": "all"},
            {"module": "analytics", "action": "view", "scope": "all"},
        ]
        response = hr.patch(f"{url}{role_id}/", {"permissions": new_permissions}, format="json")
        assert response.status_code == 200
        assert set(RolePermission.objects.filter(role_id=role_id).values_list("module", flat=True)) == {
            "work_items",
            "analytics",
        }
        assert hr.delete(f"{url}{role_id}/").status_code == status.HTTP_204_NO_CONTENT
        assert not Role.objects.filter(pk=role_id).exists()

    def test_built_in_and_held_roles_cannot_be_deleted(self, setup):
        hr, url = setup["clients"]["hr"], setup["base"] + "roles/"
        assert hr.delete(f"{url}{setup['roles']['pm'].id}/").status_code == 400
        auditor = Role.objects.create(workspace=setup["workspace"], name="Auditor")
        UserRole.objects.create(workspace=setup["workspace"], role=auditor, member=setup["people"]["a1"])
        response = hr.delete(f"{url}{auditor.id}/")
        assert response.status_code == 400 and "hold" in response.json()["error"]

    def test_giving_people_roles(self, setup):
        hr, a2 = setup["clients"]["hr"], setup["people"]["a2"]
        url = setup["base"] + f"members/{a2.id}/roles/"
        role_ids = [str(setup["roles"]["pm"].id), str(setup["roles"]["employee"].id)]
        assert hr.put(url, {"role_ids": role_ids}, format="json").status_code == 200
        assert set(UserRole.objects.filter(member=a2).values_list("role__key", flat=True)) == {"pm", "employee"}
        assert hr.put(url, {"role_ids": [str(setup["roles"]["hr"].id)]}, format="json").status_code == 200
        assert list(UserRole.objects.filter(member=a2).values_list("role__key", flat=True)) == ["hr"]
        assert hr.put(url, {"role_ids": ["not-a-role"]}, format="json").status_code == 400
        member = next(row for row in _get(setup, "hr", "members/").json() if row["member_id"] == str(a2.id))
        assert member["role_ids"] == [str(setup["roles"]["hr"].id)]


@pytest.mark.contract
class TestTeams:
    def test_create_edit_and_delete_a_team(self, setup):
        hr, url = setup["clients"]["hr"], setup["base"] + "teams/"
        people, projects = setup["people"], setup["projects"]
        payload = {
            "name": "Team C",
            "members": [{"member_id": str(people["pm_b"].id), "is_lead": True}, {"member_id": str(people["a2"].id)}],
            "project_ids": [str(projects["open"].id)],
            "lead_permissions": [{"module": "worklogs", "action": "view", "scope": "all"}],
        }
        created = hr.post(url, payload, format="json")
        assert created.status_code == status.HTTP_201_CREATED, created.content
        team_id = created.json()["id"]
        assert {m["member_id"] for m in created.json()["members"]} == {str(people["pm_b"].id), str(people["a2"].id)}
        assert created.json()["lead_permissions"] == payload["lead_permissions"]
        assert hr.post(url, payload, format="json").status_code == 400  # same name

        response = hr.patch(f"{url}{team_id}/", {"project_ids": [str(projects["a"].id)]}, format="json")
        assert response.status_code == 200 and response.json()["project_ids"] == [str(projects["a"].id)]
        assert hr.delete(f"{url}{team_id}/").status_code == status.HTTP_204_NO_CONTENT
        assert not Team.objects.filter(pk=team_id).exists()
        assert not TeamMember.objects.filter(team_id=team_id).exists()
        assert not ProjectTeam.objects.filter(team_id=team_id).exists()
        assert not TeamPermission.all_objects.filter(team_id=team_id).exists()

    def test_members_must_be_in_the_workspace(self, setup):
        payload = {"name": "Team D", "members": [{"member_id": "00000000-0000-0000-0000-000000000000"}]}
        assert setup["clients"]["hr"].post(setup["base"] + "teams/", payload, format="json").status_code == 400

    def test_lead_permissions_replace_the_leads_roles(self, setup):
        people, workspace_id = setup["people"], setup["workspace"].id
        url = f"{setup['base']}teams/{setup['teams'][0].id}/"
        lead_permissions = [
            {"module": "worklogs", "action": "view", "scope": "all"},
            {"module": "projects", "action": "delete", "scope": "none"},
        ]
        # a lead can't change their own team's permissions
        assert (
            setup["clients"]["pm_a"].patch(url, {"lead_permissions": lead_permissions}, format="json").status_code
            == 403
        )
        bad = {"lead_permissions": [{"module": "worklogs", "action": "view", "scope": "everyone"}]}
        assert setup["clients"]["hr"].patch(url, bad, format="json").status_code == 400

        response = setup["clients"]["admin"].patch(url, {"lead_permissions": lead_permissions}, format="json")
        assert response.status_code == 200, response.content
        assert sorted(response.json()["lead_permissions"], key=lambda p: p["module"]) == lead_permissions[::-1]
        lead = AccessProfile.load(people["pm_a"], workspace_id)
        assert lead.scopes("worklogs", "view") == {"all"}  # the role says Team
        assert lead.scopes("projects", "delete") == set()  # the role says Team
        assert lead.scopes("projects", "edit") == {"team"}  # not set: the role decides
        # the team's members and other teams' leads keep what their roles grant
        assert AccessProfile.load(people["a1"], workspace_id).scopes("worklogs", "view") == {"own"}
        assert AccessProfile.load(people["pm_b"], workspace_id).scopes("worklogs", "view") == {"team"}

        check = _get(setup, "hr", f"members/{people['pm_a'].id}/check/").json()
        assert check["permissions"]["worklogs"]["view"] == ["all"]
        assert check["team_permissions"] == {"worklogs": {"view": ["Team A"]}, "projects": {"delete": ["Team A"]}}

        # without a role a lead gets nothing from the team either
        UserRole.objects.filter(member=people["pm_a"]).delete(soft=False)
        assert AccessProfile.load(people["pm_a"], workspace_id).scopes("worklogs", "view") == set()

        assert setup["clients"]["hr"].patch(url, {"lead_permissions": []}, format="json").status_code == 200
        assert not TeamPermission.objects.filter(team=setup["teams"][0]).exists()


@pytest.mark.contract
def test_check_access_explains_a_persons_rights(setup):
    response = _get(setup, "hr", f"members/{setup['people']['pm_a'].id}/check/")
    assert response.status_code == 200
    body = response.json()
    assert body["roles"] == ["Project Manager"]
    assert body["teams"] == [{"name": "Team A", "is_lead": True}]
    assert body["permissions"]["projects"]["edit"] == ["team"]
    assert body["projects"]["edit"] == ["Alpha", "Shared"]
    loner = _get(setup, "hr", f"members/{setup['people']['loner'].id}/check/").json()
    assert loner["roles"] == ["No role yet: no projects until one is given"]


@pytest.mark.contract
class TestProjectSharing:
    def _url(self, setup, project="a"):
        return f"/api/workspaces/{setup['workspace'].slug}/projects/{setup['projects'][project].id}/access/"

    def test_project_editors_share_it(self, setup):
        setup["workspace"].is_rbac_enabled = True
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        pm_a, url = setup["clients"]["pm_a"], self._url(setup)
        assert pm_a.get(url).json()["can_share"] is True
        assert pm_a.get(url).json()["teams"] == [{"id": str(setup["teams"][0].id), "name": "Team A"}]
        share = {"member_id": str(setup["people"]["b1"].id), "level": "view"}
        created = pm_a.post(url, share, format="json")
        assert created.status_code == status.HTTP_201_CREATED, created.content
        assert pm_a.post(url, share, format="json").status_code == 400  # already shared
        assert (
            setup["clients"]["a1"]
            .post(url, {**share, "member_id": str(setup["people"]["a2"].id)}, format="json")
            .status_code
            == 403
        )
        assert pm_a.post(self._url(setup, "b"), share, format="json").status_code == 403  # not PM A's project
        assert pm_a.delete(f"{url}{created.json()['id']}/").status_code == status.HTTP_204_NO_CONTENT
        assert not AccessGrant.objects.exists()

    def test_with_rbac_off_project_admins_share(self, setup):
        ProjectMember.objects.filter(project=setup["projects"]["a"], member=setup["people"]["a2"]).update(role=20)
        share = {"team_id": str(setup["teams"][1].id), "level": "manage"}
        assert setup["clients"]["a2"].post(self._url(setup), share, format="json").status_code == 201
        assert (
            setup["clients"]["a1"]
            .post(self._url(setup), {**share, "team_id": str(setup["teams"][0].id)}, format="json")
            .status_code
            == 403
        )


def _app_can_on_work_item(me, access, action, issue):
    """The app's check (apps/web/store/user/base-permissions.store.ts canOnWorkItem), from the /me/ payload."""
    scopes = access["permissions"]["work_items"][action]
    if "all" in scopes:
        return True
    items = access["work_items"]
    assignees = [str(a) for a in issue.assignees.values_list("id", flat=True)]
    project_id = str(issue.project_id)
    if scopes and (me in assignees or (not assignees and str(issue.created_by_id) == me)):
        return True
    if "member" in scopes and project_id in items["member_project_ids"]:
        return True
    if "team" in scopes:
        if any(a in items["led_member_ids"] for a in assignees):
            return True
        if project_id in items["team_project_ids"][action] and not any(
            a in items["teamed_member_ids"] for a in assignees
        ):
            return True
    return False


@pytest.mark.contract
class TestMyAccess:
    def _me(self, setup, who):
        return _get(setup, who, "me/")

    def test_with_rbac_off_only_the_switch_and_access_management(self, setup):
        assert self._me(setup, "a1").json() == {"is_rbac_enabled": False, "can_manage_access": False}
        assert self._me(setup, "hr").json() == {"is_rbac_enabled": False, "can_manage_access": True}

    def test_everyone_in_the_workspace_reads_their_own(self, setup):
        setup["workspace"].is_rbac_enabled = True
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        a1 = self._me(setup, "a1").json()
        assert a1["is_admin"] is False and a1["can_manage_access"] is False
        assert a1["permissions"]["projects"]["create"] == []
        assert a1["permissions"]["work_items"]["delete"] == []
        assert a1["modules"]["milestones"]["create"] == []
        projects = {key: str(project.id) for key, project in setup["projects"].items()}
        # employees see every public project; nothing to edit
        assert projects["private"] not in a1["projects"]["view"] and projects["open"] in a1["projects"]["view"]
        assert a1["projects"]["edit"] == []
        assert set(a1["work_items"]["create_project_ids"]) == {projects["a"], projects["b"], projects["shared"]}

        pm_a = self._me(setup, "pm_a").json()
        assert set(pm_a["projects"]["edit"]) == {projects["a"], projects["shared"]}
        assert pm_a["permissions"]["projects"]["create"] == ["team"]

        hr = self._me(setup, "hr").json()
        assert hr["can_manage_access"] is True
        assert hr["projects"]["view"] is None and hr["work_items"]["create_project_ids"] is None
        assert self._me(setup, "admin").json()["is_admin"] is True

    def test_role_names_for_the_profile_menu(self, setup):
        setup["workspace"].is_rbac_enabled = True
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        assert self._me(setup, "hr").json()["role_names"] == ["HR"]
        assert self._me(setup, "pm_a").json()["role_names"] == ["Project Manager"]
        assert self._me(setup, "a1").json()["role_names"] == ["Employee"]
        assert self._me(setup, "loner").json()["role_names"] == []
        # several roles all show; a deleted one doesn't
        auditor = Role.objects.create(workspace=setup["workspace"], name="Auditor")
        UserRole.objects.create(workspace=setup["workspace"], role=auditor, member=setup["people"]["a1"])
        assert self._me(setup, "a1").json()["role_names"] == ["Auditor", "Employee"]
        Role.objects.filter(pk=auditor.pk).update(deleted_at=timezone.now())
        assert self._me(setup, "a1").json()["role_names"] == ["Employee"]

    @pytest.mark.parametrize("who", ["hr", "pm_a", "pm_b", "a1", "a2", "b1", "loner"])
    def test_the_apps_work_item_check_matches_the_server(self, setup, who):
        setup["workspace"].is_rbac_enabled = True
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        access = self._me(setup, who).json()
        profile = AccessProfile.load(setup["people"][who], setup["workspace"].id)
        me = str(setup["people"][who].id)
        for action in ("view", "edit", "delete"):
            for key, issue in setup["issues"].items():
                issue = Issue.all_objects.get(pk=issue.pk)  # the fixture sets some creators in the database
                expected = profile.can_on_work_item(action, issue)
                assert _app_can_on_work_item(me, access, action, issue) == expected, (who, action, key)


@pytest.mark.contract
class TestRolloutPreview:
    def _preview(self, setup, who="hr"):
        return _get(setup, who, "preview/")

    def _person(self, preview, setup, who):
        member_id = str(setup["people"][who].id)
        return next(p for p in preview["people"] if p["member_id"] == member_id)

    def test_access_managers_only(self, setup):
        assert self._preview(setup, "hr").status_code == 200
        assert self._preview(setup, "admin").status_code == 200
        assert self._preview(setup, "pm_a").status_code == 403
        assert self._preview(setup, "a1").status_code == 403

    def test_what_turning_it_on_changes(self, setup):
        # A2 administers the Open project: today they see its unassigned work; as an Employee only their own
        ProjectMember.objects.create(
            workspace=setup["workspace"], project=setup["projects"]["open"], member=setup["people"]["a2"], role=20
        )
        _issue(setup["projects"]["open"], "Open - unassigned", creator=setup["people"]["admin"])
        preview = self._preview(setup).json()
        assert preview["is_rbac_enabled"] is False
        pm_a = self._person(preview, setup, "pm_a")
        assert pm_a["work_items"] == {"now": 0, "after": 5}
        assert pm_a["projects"] == {"view": 2, "edit": 2}  # their team projects
        assert pm_a["memberships"] == {"added": 0, "raised": 2}  # admin of Alpha and Shared
        hr = self._person(preview, setup, "hr")
        assert hr["memberships"] == {"added": 5, "raised": 0} and hr["roles"] == ["HR"]
        a1 = self._person(preview, setup, "a1")
        assert a1["work_items"] == {"now": 3, "after": 3}
        assert a1["teams"] == [{"name": "Team A", "is_lead": False}]

        warnings = preview["warnings"]
        assert warnings["without_role"] == [str(setup["people"]["loner"].id)]
        assert warnings["projects_without_team"] == ["Open", "Secret"]
        assert warnings["teams_without_lead"] == []
        # A2 loses the Open project's unassigned work; the loner has no role, so loses their own task too
        assert set(warnings["seeing_fewer_work_items"]) == {str(setup["people"][who].id) for who in ("a2", "loner")}
        # nothing was changed
        assert not ProjectMember.objects.filter(member=setup["people"]["hr"]).exists()

    def test_once_on_nothing_changes(self, setup):
        setup["workspace"].is_rbac_enabled = True
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        for person in self._preview(setup).json()["people"]:
            assert person["work_items"]["now"] == person["work_items"]["after"]
            assert person["memberships"]["added"] == 0


@pytest.mark.contract
class TestRolloutCommand:
    def test_on_and_off(self, setup):
        slug = setup["workspace"].slug
        out = StringIO()
        call_command("rbac_rollout", slug, stdout=out)
        assert (
            "Role-based access is off" in out.getvalue()
            and "No role yet (no projects until one is given)" in out.getvalue()
        )

        call_command("rbac_rollout", slug, "--on", stdout=out)
        setup["workspace"].refresh_from_db()
        assert setup["workspace"].is_rbac_enabled is True
        assert (
            ProjectMember.objects.filter(member=setup["people"]["hr"], rbac_managed=True, is_active=True).count() == 5
        )

        call_command("rbac_rollout", slug, "--off", stdout=out)
        setup["workspace"].refresh_from_db()
        assert setup["workspace"].is_rbac_enabled is False
        assert not ProjectMember.objects.filter(member=setup["people"]["hr"], is_active=True).exists()

    def test_unknown_workspace(self, db):
        with pytest.raises(CommandError):
            call_command("rbac_rollout", "no-such-workspace")


@pytest.mark.contract
class TestDemoCommand:
    def test_refuses_off_localhost(self, db, settings):
        settings.APP_BASE_URL = "https://plane.example.com"
        with pytest.raises(CommandError):
            call_command("rbac_demo", stdout=StringIO())

    def test_creates_a_working_demo_and_removes_it(self, db, settings):
        settings.APP_BASE_URL = "http://localhost:3000"
        from plane.db.models import User, Workspace
        from plane.utils.rbac import AccessProfile

        call_command("rbac_demo", stdout=StringIO())
        workspace = Workspace.objects.get(slug="rbac-demo")
        assert workspace.is_rbac_enabled is True
        people = {u.email.split("@")[0][5:]: u for u in User.objects.filter(email__endswith="@rbac-demo.local")}
        assert people["emp-a1"].check_password("RbacDemo@2026")
        # the plan's example: PM A sees Team A's work, an employee only their own, HR everything
        names = {
            key: set(
                Issue.issue_objects.filter(workspace=workspace)
                .filter(AccessProfile.load(people[key], workspace.id).work_item_q("view"))
                .values_list("name", flat=True)
            )
            for key in ("hr", "pm-a", "emp-a1")
        }
        assert len(names["hr"]) == 9
        assert "Beta: help from A1 (Team A's member)" in names["pm-a"]
        assert "Shared: B1's task" not in names["pm-a"]
        assert names["emp-a1"] == {
            "Alpha: unassigned idea from A1",
            "Beta: help from A1 (Team A's member)",
            "Shared: A1's task",
        }
        assert ProjectMember.objects.filter(member=people["hr"], workspace=workspace, role=20).count() == 5

        call_command("rbac_demo", "--remove", stdout=StringIO())
        assert not Workspace.all_objects.filter(slug="rbac-demo").exists()
        assert not User.objects.filter(email__endswith="@rbac-demo.local").exists()
