# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Role-based access, step 5: everything around work items and projects.

The workspace is the plan's example (see plane/tests/unit/utils/test_rbac_engine.py). With RBAC on:
  * a work item's links, attachments, relations, task details, expected time and milestone need "edit" on it;
    commenting only needs to see it;
  * milestones follow the Milestones permissions per project, the workspace milestone list too (View = All there:
    every project's milestones, members or not, except private projects the person can't see), and such a milestone
    opens read-only for people who aren't members of its project;
  * worklog reports follow the Worklogs scope (own / team / all);
  * analytics need the Analytics permission; workspace analytics count only the person's projects (RBAC or not);
  * nobody is notified about a work item they can't see;
  * Employees and members › Edit switches the people it reaches between Member and Guest (HR: everyone, PMs: their
    team members); Admin stays with workspace admins.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import IssueWorkLog, Milestone, MilestoneWorkItem, WorkspaceMember
from plane.tests.unit.utils.test_rbac_engine import _issue, org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import sync_project_access
from plane.utils.work_item_visibility import who_can_see


def _clients(org):  # noqa: F811
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return clients


@pytest.fixture
def rbac(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)
    return {**org, "clients": _clients(org)}


def _ws(setup):
    return f"/api/workspaces/{setup['workspace'].slug}"


def _issue_base(setup, key):
    issue = setup["issues"][key]
    return f"{_ws(setup)}/projects/{issue.project_id}/issues/{issue.id}"


def _drop(setup, role, module, action):
    setup["roles"][role].permissions.filter(module=module, action=action).delete(soft=False)


@pytest.mark.contract
class TestWorkItemExtras:
    def test_links_need_edit_but_comments_only_need_to_see_it(self, rbac):
        a1, base = rbac["clients"]["a1"], _issue_base(rbac, "shared_a1")
        link = {"url": "https://example.com/spec", "title": "Spec"}
        assert a1.post(f"{base}/issue-links/", link, format="json").status_code == status.HTTP_201_CREATED
        _drop(rbac, "employee", "work_items", "edit")
        assert a1.post(f"{base}/issue-links/", link, format="json").status_code == status.HTTP_403_FORBIDDEN
        comment = {"comment_html": "<p>On it</p>"}
        assert a1.post(f"{base}/comments/", comment, format="json").status_code == status.HTTP_201_CREATED

    def test_task_details_need_edit(self, rbac):
        a1, base = rbac["clients"]["a1"], _issue_base(rbac, "shared_a1")
        _drop(rbac, "employee", "work_items", "edit")
        response = a1.patch(f"{base}/task-detail/", {"build_version": "1.2"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestMilestones:
    @pytest.fixture
    def alpha(self, rbac):
        project = rbac["projects"]["a"]
        project.is_milestone_enabled = True
        project.save(update_fields=["is_milestone_enabled"])
        milestone = Milestone.objects.create(project=project, title="Phase 1", assigned_to=rbac["people"]["pm_a"])
        return {**rbac, "milestone": milestone, "url": f"{_ws(rbac)}/projects/{project.id}/milestones/"}

    def test_employees_view_milestones_of_their_projects_but_cannot_change_them(self, alpha):
        a1 = alpha["clients"]["a1"]
        assert [m["title"] for m in a1.get(alpha["url"]).json()] == ["Phase 1"]
        payload = {"title": "Phase 2", "assigned_to_id": str(alpha["people"]["a1"].id)}
        assert a1.post(alpha["url"], payload, format="json").status_code == status.HTTP_403_FORBIDDEN
        detail = f"{alpha['url']}{alpha['milestone'].id}/"
        assert a1.patch(detail, {"title": "Renamed"}, format="json").status_code == status.HTTP_403_FORBIDDEN

    def test_pms_manage_milestones_in_their_team_projects(self, alpha):
        pm_a = alpha["clients"]["pm_a"]
        payload = {"title": "Phase 2", "assigned_to_id": str(alpha["people"]["a1"].id)}
        assert pm_a.post(alpha["url"], payload, format="json").status_code == status.HTTP_201_CREATED

    def test_workspace_list_follows_the_milestones_scope(self, alpha):
        url = f"{_ws(alpha)}/milestones/"
        assert [m["title"] for m in alpha["clients"]["a1"].get(url).json()] == ["Phase 1"]
        _drop(alpha, "employee", "milestones", "view")
        assert alpha["clients"]["a1"].get(url).json() == []
        assert alpha["clients"]["a1"].get(alpha["url"]).status_code == status.HTTP_403_FORBIDDEN

    def test_employees_and_pms_see_every_projects_milestones_in_the_list(self, alpha):
        url = f"{_ws(alpha)}/milestones/"
        for key in ("open", "private"):
            project = alpha["projects"][key]
            project.is_milestone_enabled = True
            project.save(update_fields=["is_milestone_enabled"])
            Milestone.objects.create(project=project, title=f"{project.name} phase")
        # nobody but b1 is in Open or the private Secret; pm_a's teams don't own them either
        for who in ("a1", "a2", "pm_a", "pm_b"):
            assert {m["title"] for m in alpha["clients"][who].get(url).json()} == {"Phase 1", "Open phase"}, who
        # with their project's name, also for projects they can't open
        pairs = {(m["title"], m["project_name"]) for m in alpha["clients"]["pm_a"].get(url).json()}
        assert pairs == {("Phase 1", "Alpha"), ("Open phase", "Open")}
        # the private project's milestones stay with the people who can see it: its member and HR
        for who in ("b1", "hr"):
            titles = {m["title"] for m in alpha["clients"][who].get(url).json()}
            assert titles == {"Phase 1", "Open phase", "Secret phase"}, who
        # a role that sees only its projects' milestones keeps to them
        alpha["roles"]["employee"].permissions.filter(module="milestones", action="view").update(scope="member")
        assert [m["title"] for m in alpha["clients"]["a1"].get(url).json()] == ["Phase 1"]
        # the list doesn't open the project's own milestone pages to non-members
        open_url = f"{_ws(alpha)}/projects/{alpha['projects']['open'].id}/milestones/"
        assert alpha["clients"]["pm_a"].get(open_url).status_code == status.HTTP_403_FORBIDDEN

    def test_non_members_open_a_milestone_read_only(self, alpha):
        people = alpha["people"]
        projects = {key: alpha["projects"][key] for key in ("open", "private")}
        for project in projects.values():
            project.is_milestone_enabled = True
            project.save(update_fields=["is_milestone_enabled"])
        phase = Milestone.objects.create(project=projects["open"], title="Open phase", assigned_to=people["pm_a"])
        secret = Milestone.objects.create(project=projects["private"], title="Secret phase")
        for who in ("a1", "b1"):
            task = _issue(projects["open"], f"Open - {who}", assignee=people[who])
            MilestoneWorkItem.objects.create(milestone=phase, issue=task, project=projects["open"])
        url = f"{_ws(alpha)}/milestones/{phase.id}/"

        # a1 is not in Open: the milestone opens, with its project's name and only the work items a1 may see
        response = alpha["clients"]["a1"].get(url)
        assert response.status_code == status.HTTP_200_OK, response.content
        body = response.json()
        assert (body["title"], body["project_name"], body["total_items"]) == ("Open phase", "Open", 2)
        assert [item["name"] for item in body["work_items"]] == ["Open - a1"]
        assert [item["name"] for item in alpha["clients"]["b1"].get(url).json()["work_items"]] == ["Open - b1"]

        # what the list doesn't show doesn't open either: a private project's milestone, or without milestone access
        assert alpha["clients"]["a1"].get(f"{_ws(alpha)}/milestones/{secret.id}/").status_code == 404
        assert alpha["clients"]["b1"].get(f"{_ws(alpha)}/milestones/{secret.id}/").status_code == 200
        _drop(alpha, "employee", "milestones", "view")
        assert alpha["clients"]["a1"].get(url).status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
class TestWorklogReports:
    @pytest.fixture
    def logged(self, rbac):
        start = timezone.now() - timedelta(days=1)
        for who, key in (("a1", "shared_a1"), ("b1", "shared_b1"), ("loner", "shared_loner"), ("a2", "a_a2")):
            issue = rbac["issues"][key]
            IssueWorkLog.objects.create(
                workspace=rbac["workspace"],
                project_id=issue.project_id,
                issue=issue,
                logged_by=rbac["people"][who],
                duration=60,
                description=f"time of {who}",
                started_at=start,
                ended_at=start + timedelta(hours=1),
            )
        return rbac

    def _seen(self, setup, who):
        response = setup["clients"][who].get(f"{_ws(setup)}/worklog-reports/worklogs/")
        assert response.status_code == status.HTTP_200_OK, response.content
        return {row["description"].removeprefix("time of ") for row in response.json()["results"]}

    @pytest.mark.parametrize(
        "who, seen",
        [
            ("hr", {"a1", "b1", "loner", "a2"}),
            ("pm_a", {"a1", "a2", "loner"}),  # B1 is Team B's
            ("pm_b", {"b1", "loner"}),
            ("a1", {"a1"}),
        ],
    )
    def test_reports_follow_the_worklogs_scope(self, logged, who, seen):
        assert self._seen(logged, who) == seen


@pytest.mark.contract
class TestAnalytics:
    def test_project_stats_count_only_the_persons_projects(self, org):  # noqa: F811
        clients = _clients(org)
        response = clients["a1"].get(f"/api/workspaces/{org['workspace'].slug}/project-stats/")
        assert response.status_code == status.HTTP_200_OK, response.content
        seen = {row["id"] for row in response.json()}
        expected = {str(org["projects"][key].id) for key in ("a", "b", "shared")}
        assert seen == expected
        # workspace admins still see every project
        response = clients["admin"].get(f"/api/workspaces/{org['workspace'].slug}/project-stats/")
        assert len(response.json()) == 5

    def test_a_role_without_analytics_is_refused(self, rbac):
        url = f"{_ws(rbac)}/project-stats/"
        assert rbac["clients"]["a1"].get(url).status_code == status.HTTP_200_OK
        _drop(rbac, "employee", "analytics", "view")
        assert rbac["clients"]["a1"].get(url).status_code == status.HTTP_403_FORBIDDEN
        assert rbac["clients"]["a1"].get(f"{_ws(rbac)}/advance-analytics/").status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
def test_nobody_is_notified_about_a_work_item_they_cannot_see(rbac):
    people = rbac["people"]
    ids = {people[name].id for name in ("a1", "b1", "pm_a", "pm_b", "hr")}
    seen = who_can_see(rbac["issues"]["shared_b1"], ids)
    assert seen == {people["b1"].id, people["pm_b"].id, people["hr"].id}


@pytest.mark.contract
class TestMemberRoles:
    @staticmethod
    def _change(setup, who, whom, role):
        member = WorkspaceMember.objects.get(workspace=setup["workspace"], member=setup["people"][whom])
        return setup["clients"][who].patch(f"{_ws(setup)}/members/{member.id}/", {"role": role}, format="json")

    @staticmethod
    def _role(setup, whom):
        return WorkspaceMember.objects.get(workspace=setup["workspace"], member=setup["people"][whom]).role

    def test_hr_switches_anyone_between_member_and_guest(self, rbac):
        assert self._change(rbac, "hr", "b1", 5).status_code == status.HTTP_200_OK
        assert self._role(rbac, "b1") == 5
        assert self._change(rbac, "hr", "b1", 15).status_code == status.HTTP_200_OK
        assert self._role(rbac, "b1") == 15
        # Admin stays with workspace admins: not given, and an admin's role not changed
        assert self._change(rbac, "hr", "b1", 20).status_code == status.HTTP_403_FORBIDDEN
        assert self._change(rbac, "hr", "admin", 15).status_code == status.HTTP_403_FORBIDDEN
        assert self._change(rbac, "admin", "b1", 20).status_code == status.HTTP_200_OK

    def test_pms_switch_only_their_team_members(self, rbac):
        assert self._change(rbac, "pm_a", "a1", 5).status_code == status.HTTP_200_OK
        assert self._role(rbac, "a1") == 5
        assert self._change(rbac, "pm_a", "b1", 5).status_code == status.HTTP_403_FORBIDDEN
        assert self._change(rbac, "pm_a", "pm_b", 5).status_code == status.HTTP_403_FORBIDDEN
        assert self._change(rbac, "pm_a", "pm_a", 5).status_code == status.HTTP_400_BAD_REQUEST  # never their own
        # employees can't change anyone
        assert self._change(rbac, "a2", "a1", 15).status_code == status.HTTP_403_FORBIDDEN

    def test_the_app_is_told_whom_it_may_change(self, rbac):
        def editable(who):
            return rbac["clients"][who].get(f"{_ws(rbac)}/access-control/me/").json()["member_ids"]["edit"]

        people = rbac["people"]
        assert editable("hr") is None
        assert editable("pm_a") == sorted(str(people[name].id) for name in ("pm_a", "a1", "a2"))
        assert editable("a1") == []

    def test_with_rbac_off_only_workspace_admins(self, org):  # noqa: F811
        setup = {**org, "clients": _clients(org)}
        assert self._change(setup, "hr", "b1", 5).status_code == status.HTTP_403_FORBIDDEN
        assert self._change(setup, "admin", "b1", 5).status_code == status.HTTP_200_OK
