# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The sidebar Projects list: "Show in List" / "Hide from List" (plane.utils.project_list).

The workspace is the plan's example (see plane/tests/unit/utils/test_rbac_engine.py): PM A leads Team A, which owns
Alpha and Shared; PM B leads Team B, which owns Beta and Shared. As in Variance's own workspace, Project Managers
may view every project (Projects › View: All), so the Projects page (All Projects) lists them all.

  * Every project response says whether the project is in the person's list (`in_my_list`).
  * Until they choose, Project Managers' lists hold only the projects they created, lead, or that a team they lead
    owns or is assigned; everyone else's hold every project. HR and workspace admins keep every project.
  * Anyone may show or hide any project they're a member of, their own too; the choice is theirs alone and changes
    nothing else: no membership, ownership, assignment or permission.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Project, ProjectMember, ProjectTeam, ProjectUserProperty, UserRole
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import AccessProfile, sync_project_access


@pytest.fixture
def setup(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    org["roles"]["pm"].permissions.filter(module="projects", action="view").update(scope="all")
    sync_project_access(org["workspace"].id)
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return {**org, "clients": clients}


def _base(setup):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/"


def _listing(setup, who, details=False):
    """project name -> in_my_list, from the sidebar's list (or the Projects page's)."""
    response = setup["clients"][who].get(f"{_base(setup)}details/" if details else _base(setup))
    assert response.status_code == status.HTTP_200_OK, response.content
    return {row["name"]: row["in_my_list"] for row in response.json()}


def _choose(setup, who, project, show):
    return setup["clients"][who].patch(
        f"{_base(setup)}{setup['projects'][project].id}/user-properties/", {"show_in_list": show}, format="json"
    )


def _join(setup, who, project, role=15):
    ProjectMember.objects.create(
        workspace=setup["workspace"], project=setup["projects"][project], member=setup["people"][who], role=role
    )


@pytest.mark.contract
class TestDefaults:
    def test_a_pms_list_starts_with_the_projects_they_manage(self, setup):
        # PM A's team owns Alpha and Shared; Beta is Team B's, Open no team's
        for details in (False, True):
            listing = _listing(setup, "pm_a", details=details)
            assert (listing["Alpha"], listing["Shared"]) == (True, True)
            assert (listing["Beta"], listing["Open"]) == (False, False)

    def test_projects_a_pm_created_or_leads_are_in_their_list(self, setup):
        open_project = setup["projects"]["open"]
        Project.objects.filter(pk=open_project.pk).update(created_by=setup["people"]["pm_b"])
        beta = setup["projects"]["b"]
        Project.objects.filter(pk=beta.pk).update(project_lead=setup["people"]["pm_a"])
        listing = _listing(setup, "pm_a")
        assert listing["Beta"] is True  # PM A leads it
        assert listing["Open"] is False  # PM B created it
        assert _listing(setup, "pm_b")["Open"] is True

    def test_a_project_assigned_to_a_pms_team_is_in_their_list(self, setup):
        from plane.db.models import ProjectDetail

        team_a, _ = setup["teams"]
        ProjectDetail.objects.create(
            workspace=setup["workspace"], project=setup["projects"]["open"], assigned_team=team_a
        )
        assert _listing(setup, "pm_a")["Open"] is True

    def test_everyone_else_keeps_every_project(self, setup):
        for who in ("a1", "hr", "admin"):
            assert set(_listing(setup, who).values()) == {True}, who
        # a PM who is also HR keeps every project too
        UserRole.objects.create(workspace=setup["workspace"], role=setup["roles"]["hr"], member=setup["people"]["pm_b"])
        assert set(_listing(setup, "pm_b").values()) == {True}

    def test_with_role_based_access_off_nobody_starts_with_less(self, setup):
        setup["workspace"].is_rbac_enabled = False
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        assert set(_listing(setup, "pm_a").values()) == {True}

    def test_a_single_project_says_so_too(self, setup):
        response = setup["clients"]["pm_a"].get(f"{_base(setup)}{setup['projects']['a'].id}/")
        assert response.status_code == status.HTTP_200_OK, response.content
        assert response.json()["in_my_list"] is True


@pytest.mark.contract
class TestChoosing:
    def test_a_pm_shows_another_pms_project_and_hides_their_own(self, setup):
        _join(setup, "pm_a", "b")  # PM A works in Beta, which Team B owns
        assert _listing(setup, "pm_a")["Beta"] is False
        assert _choose(setup, "pm_a", "b", True).status_code == status.HTTP_200_OK
        assert _choose(setup, "pm_a", "a", False).status_code == status.HTTP_200_OK
        listing = _listing(setup, "pm_a")
        assert (listing["Beta"], listing["Alpha"], listing["Shared"]) == (True, False, True)
        # their own choice only: PM B's and A1's lists don't change
        assert _listing(setup, "pm_b")["Alpha"] is False
        assert _listing(setup, "a1")["Alpha"] is True
        # and back
        assert _choose(setup, "pm_a", "a", True).status_code == status.HTTP_200_OK
        assert _listing(setup, "pm_a")["Alpha"] is True

    def test_anyone_may_hide_a_project(self, setup):
        assert _choose(setup, "a1", "shared", False).status_code == status.HTTP_200_OK
        listing = _listing(setup, "a1")
        assert listing["Shared"] is False and listing["Alpha"] is True

    def test_hiding_changes_nothing_else(self, setup):
        _join(setup, "pm_a", "b")
        sync_project_access(setup["workspace"].id)
        pm_a = setup["people"]["pm_a"]
        before = {
            "memberships": set(
                ProjectMember.objects.filter(member=pm_a).values_list("project_id", "role", "is_active", "rbac_managed")
            ),
            "owners": set(ProjectTeam.objects.values_list("project_id", "team_id")),
            "projects": set(Project.objects.values_list("id", "created_by_id", "project_lead_id", "network")),
        }
        profile = AccessProfile.load(pm_a, setup["workspace"].id)
        visible = set(Project.objects.filter(profile.project_q("view")).values_list("id", flat=True))

        _choose(setup, "pm_a", "a", False)
        _choose(setup, "pm_a", "b", True)
        sync_project_access(setup["workspace"].id)

        after = {
            "memberships": set(
                ProjectMember.objects.filter(member=pm_a).values_list("project_id", "role", "is_active", "rbac_managed")
            ),
            "owners": set(ProjectTeam.objects.values_list("project_id", "team_id")),
            "projects": set(Project.objects.values_list("id", "created_by_id", "project_lead_id", "network")),
        }
        assert after == before
        profile = AccessProfile.load(pm_a, setup["workspace"].id)
        assert set(Project.objects.filter(profile.project_q("view")).values_list("id", flat=True)) == visible
        # the hidden project still opens, and its tasks are still listed
        assert setup["clients"]["pm_a"].get(f"{_base(setup)}{setup['projects']['a'].id}/").status_code == 200
        assert setup["clients"]["pm_a"].get(f"{_base(setup)}{setup['projects']['a'].id}/issues/").status_code == 200
        # and the Projects page (All Projects) still lists it
        assert "Alpha" in _listing(setup, "pm_a", details=True)

    def test_only_members_choose_and_only_for_themselves(self, setup):
        # PM A isn't in Beta: nothing to show in their sidebar, and no peeking
        assert _choose(setup, "pm_a", "b", True).status_code == status.HTTP_403_FORBIDDEN
        assert not ProjectUserProperty.objects.filter(
            user=setup["people"]["pm_a"], project=setup["projects"]["b"], show_in_list__isnull=False
        ).exists()

    def test_the_choice_outlives_leaving_and_rejoining(self, setup):
        _join(setup, "pm_a", "b")
        _choose(setup, "pm_a", "b", True)
        ProjectMember.objects.filter(member=setup["people"]["pm_a"], project=setup["projects"]["b"]).update(
            is_active=False
        )
        ProjectMember.objects.filter(member=setup["people"]["pm_a"], project=setup["projects"]["b"]).update(
            is_active=True
        )
        assert _listing(setup, "pm_a")["Beta"] is True
