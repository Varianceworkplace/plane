# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the project summary dashboard (plane.app.views.project_summary).

Rules under test:
  * work item counts: open, completed, cancelled, overdue and due soon (open items only), progress leaves cancelled out
  * priority counts, expected hours from the work items' expected time, worked hours from worklogs
  * only the requested project counts; people outside the project can't open it
  * every project member sees the whole project, whatever their role (assigned work items and everyone's time too)
  * joining the project is what opens the summary
  * with role-based access on: HR, Project Managers and Employees in the project all see the same summary
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueTimeEstimate,
    IssueWorkLog,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.tests.unit.utils.test_rbac_engine import _issue, org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import sync_project_access


def _user(workspace, first_name, role=15):
    uid = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{first_name.lower()}-{uid}@plane.so",
        username=f"{first_name.lower()}_{uid}",
        first_name=first_name,
        last_name="Test",
        display_name=first_name.lower(),
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _log(issue, user, minutes):
    return IssueWorkLog.objects.create(
        project=issue.project, issue=issue, logged_by=user, duration=minutes, description="work"
    )


def _estimate(issue, minutes):
    return IssueTimeEstimate.objects.create(
        project=issue.project, workspace=issue.workspace, issue=issue, expected_duration=minutes
    )


@pytest.fixture
def setup(db, workspace, create_user):
    people = {
        "ws_admin": create_user,
        "hiral": _user(workspace, "Hiral"),
        "vijay": _user(workspace, "Vijay"),
        "idle": _user(workspace, "Idle"),  # project member without work items or time
        "outsider": _user(workspace, "Outsider"),  # member of no project
    }
    project = Project.objects.create(
        name="Alpha", identifier="ALPHA", workspace=workspace, created_by=create_user, is_time_tracking_enabled=True
    )
    other = Project.objects.create(
        name="Beta", identifier="BETA", workspace=workspace, created_by=create_user, is_time_tracking_enabled=True
    )
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    for who in ("hiral", "vijay", "idle"):
        ProjectMember.objects.create(project=project, member=people[who], role=15, is_active=True)
    ProjectMember.objects.create(project=other, member=create_user, role=20, is_active=True)

    states = {
        group: State.objects.create(name=group.title(), project=project, workspace=workspace, group=group)
        for group in ("unstarted", "started", "completed", "cancelled")
    }
    today = timezone.now().date()

    def issue(name, group="unstarted", priority="none", target_date=None, assignee=None, project_=project):
        state = states[group] if project_ == project else None
        item = Issue.objects.create(
            name=name,
            workspace=workspace,
            project=project_,
            state=state,
            priority=priority,
            target_date=target_date,
            created_by=create_user,
        )
        if assignee:
            IssueAssignee.objects.create(issue=item, assignee=people[assignee], project=project_, workspace=workspace)
        return item

    items = {
        "overdue": issue("Overdue", priority="urgent", target_date=today - timedelta(days=2)),
        "soon": issue("Due soon", group="started", priority="high", target_date=today + timedelta(days=3)),
        "later": issue("Due later", priority="medium", target_date=today + timedelta(days=30)),
        "done_late": issue("Done late", group="completed", priority="low", target_date=today - timedelta(days=5)),
        "cancelled": issue("Cancelled", group="cancelled"),
        "hiral_open": issue("Hiral open", priority="medium", assignee="hiral"),
        "hiral_done": issue("Hiral done", group="completed", assignee="hiral"),
        "vijay_open": issue("Vijay open", group="started", assignee="vijay"),
    }
    beta_item = issue("Beta task", project_=other)

    _estimate(items["hiral_open"], 300)
    _estimate(items["hiral_done"], 120)
    _estimate(items["overdue"], 60)
    _estimate(items["vijay_open"], 90)
    _log(items["hiral_open"], people["hiral"], 200)
    _log(items["hiral_done"], people["hiral"], 150)
    _log(items["vijay_open"], people["vijay"], 45)
    _log(items["overdue"], people["ws_admin"], 30)
    _log(beta_item, people["hiral"], 500)  # another project: never counted
    _estimate(beta_item, 999)

    return {
        "workspace": workspace,
        "project": project,
        "people": people,
        "clients": {name: _client(user) for name, user in people.items()},
    }


def _get(setup, who, project=None):
    project = project or setup["project"]
    return setup["clients"][who].get(f"/api/workspaces/{setup['workspace'].slug}/projects/{project.id}/summary/")


def _summary(setup, who):
    response = _get(setup, who)
    assert response.status_code == status.HTTP_200_OK, response.content
    return response.json()


def _team(summary):
    return {row["display_name"]: row for row in summary["team"]}


FULL_WORK_ITEMS = {
    "total": 8,
    "open": 5,
    "completed": 2,
    "cancelled": 1,
    "overdue": 1,  # the completed one past its date doesn't count
    "due_soon": 1,
    "progress": 29,  # 2 completed of 7 (cancelled left out)
}


@pytest.mark.contract
class TestProjectSummary:
    def test_counts_priorities_and_hours(self, setup):
        summary = _summary(setup, "ws_admin")
        assert summary["work_items"] == FULL_WORK_ITEMS
        assert summary["priority"] == {"urgent": 1, "high": 1, "medium": 2, "low": 1, "none": 3}
        assert summary["time"] == {
            "is_time_tracking_enabled": True,
            "expected_duration": 570,
            "worked_duration": 425,  # everyone's time in this project, not Beta's
        }

    def test_team_lists_every_member_with_their_work(self, setup):
        team = _team(_summary(setup, "ws_admin"))
        assert set(team) >= {"hiral", "vijay", "idle"}
        assert {key: team["hiral"][key] for key in ("expected_duration", "worked_duration")} == {
            "expected_duration": 420,
            "worked_duration": 350,
        }
        assert (team["hiral"]["work_items"], team["hiral"]["completed_work_items"]) == (2, 1)
        assert (team["vijay"]["work_items"], team["vijay"]["worked_duration"]) == (1, 45)
        assert (team["idle"]["work_items"], team["idle"]["worked_duration"]) == (0, 0)

    @pytest.mark.parametrize("who", ["hiral", "vijay", "idle"])
    def test_every_member_sees_the_whole_project(self, setup, who):
        assert _summary(setup, who) == _summary(setup, "ws_admin")

    def test_numbers_belong_to_the_requested_project_only(self, setup):
        beta = Project.objects.get(identifier="BETA", workspace=setup["workspace"])
        summary = _get(setup, "ws_admin", project=beta).json()
        assert summary["work_items"]["total"] == 1
        assert summary["time"]["expected_duration"] == 999
        assert summary["time"]["worked_duration"] == 500

    def test_joining_the_project_opens_the_summary(self, setup):
        assert _get(setup, "outsider").status_code == status.HTTP_403_FORBIDDEN
        ProjectMember.objects.create(project=setup["project"], member=setup["people"]["outsider"], role=15)
        summary = _summary(setup, "outsider")
        assert summary["work_items"] == FULL_WORK_ITEMS
        assert "outsider" in _team(summary)

    def test_numbers_follow_changes(self, setup):
        hiral_open = Issue.all_objects.get(name="Hiral open")
        _log(hiral_open, setup["people"]["hiral"], 25)
        hiral_open.state = State.objects.get(project=setup["project"], group="completed")
        hiral_open.save()
        summary = _summary(setup, "vijay")
        assert summary["work_items"]["completed"] == 3
        assert summary["time"]["worked_duration"] == 450


@pytest.fixture
def rbac(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)
    for who, key in (("a1", "shared_a1"), ("b1", "shared_b1"), ("loner", "shared_loner")):
        issue = org["issues"][key]
        IssueWorkLog.objects.create(
            workspace=org["workspace"],
            project_id=issue.project_id,
            issue=issue,
            logged_by=org["people"][who],
            duration=60,
            description=f"time of {who}",
        )
    return {**org, "clients": {name: _client(user) for name, user in org["people"].items()}}


@pytest.mark.contract
class TestProjectSummaryRoles:
    def _summary(self, setup, who):
        project_id = setup["issues"]["shared_a1"].project_id
        response = setup["clients"][who].get(
            f"/api/workspaces/{setup['workspace'].slug}/projects/{project_id}/summary/"
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        return response.json()

    @pytest.mark.parametrize("who", ["hr", "pm_a", "pm_b", "a1"])
    def test_every_role_sees_the_whole_project(self, rbac, who):
        summary = self._summary(rbac, who)
        assert summary["time"]["worked_duration"] == 180
        names = {rbac["people"][key].display_name: key for key in rbac["people"]}
        with_time = {names[row["display_name"]] for row in summary["team"] if row["worked_duration"]}
        assert with_time == {"a1", "b1", "loner"}
        assert summary == self._summary(rbac, "hr")
