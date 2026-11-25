# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sidebar › Projects order (plane.app.views.worklog.active_projects): the projects the person is working on first.

* a project counts with an ongoing task of theirs: not completed or cancelled, and assigned to them, carrying their
  timer, or with time they logged
* order: their timer's project, then the time they logged last, then projects with only assigned tasks (latest change)
* someone else's tasks and time don't count; tickets, archived projects and finished tasks are left out
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
    IssueWorkLog,
    IssueWorkLogTimer,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)


def _user(workspace, first_name, role=15):
    user = User.objects.create(
        email=f"{first_name.lower()}-{uuid4().hex[:8]}@plane.so",
        username=f"{first_name.lower()}_{uuid4().hex[:8]}",
        first_name=first_name,
        display_name=first_name.lower(),
    )
    if workspace:
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _project(workspace, identifier, members, **extra):
    project = Project.objects.create(name=identifier.title(), identifier=identifier, workspace=workspace, **extra)
    common = {"project": project, "workspace": workspace}
    states = {
        "todo": State.objects.create(name="Todo", group="unstarted", default=True, **common),
        "done": State.objects.create(name="Completed", group="completed", **common),
        "cancelled": State.objects.create(name="Cancelled", group="cancelled", **common),
    }
    for user in members:
        ProjectMember.objects.create(project=project, member=user, role=15, is_active=True)
    return project, states


def _task(project, state, assignee=None):
    issue = Issue.objects.create(
        name=f"Task {uuid4().hex[:6]}", workspace=project.workspace, project=project, state=state
    )
    if assignee:
        IssueAssignee.objects.create(issue=issue, assignee=assignee, project=project)
    return issue


def _log(issue, user, hours_ago):
    worklog = IssueWorkLog.objects.create(project=issue.project, issue=issue, logged_by=user, duration=30)
    IssueWorkLog.objects.filter(pk=worklog.pk).update(updated_at=timezone.now() - timedelta(hours=hours_ago))


@pytest.fixture
def setup(db, workspace, create_user):
    me, other = _user(workspace, "Hiral"), _user(workspace, "Vijay")
    members = [create_user, me, other]
    projects, states = {}, {}
    for key in ("alpha", "beta", "gamma", "delta", "shared", "done", "others"):
        projects[key], states[key] = _project(workspace, key.upper(), members)
    projects["tickets"], states["tickets"] = _project(workspace, "TICKETS", members, is_ticket_project=True)
    projects["old"], states["old"] = _project(workspace, "OLD", members, archived_at=timezone.now())
    tasks = {
        "alpha": _task(projects["alpha"], states["alpha"]["todo"], me),
        "beta": _task(projects["beta"], states["beta"]["todo"], me),
        "gamma": _task(projects["gamma"], states["gamma"]["todo"], me),
        "delta": _task(projects["delta"], states["delta"]["todo"], me),
        # nobody's assigned yet (I created it), but I log time on it
        "shared": _task(projects["shared"], states["shared"]["todo"]),
        "done": _task(projects["done"], states["done"]["done"], me),
        "cancelled": _task(projects["done"], states["done"]["cancelled"], me),
        "others": _task(projects["others"], states["others"]["todo"], other),
        "ticket": _task(projects["tickets"], states["tickets"]["todo"], me),
        "old": _task(projects["old"], states["old"]["todo"], me),
    }
    Issue.all_objects.filter(pk=tasks["shared"].pk).update(created_by=me)
    _log(tasks["alpha"], me, 48)
    _log(tasks["beta"], me, 1)
    _log(tasks["shared"], me, 5)
    _log(tasks["done"], me, 0)  # time on a finished task doesn't make its project ongoing
    _log(tasks["others"], other, 0)
    _log(tasks["gamma"], other, 0)  # Vijay's time doesn't move my Gamma up
    # when the assigned-only tasks last changed: Delta's an hour ago, Gamma's three
    for key, hours in (("delta", 1), ("gamma", 3)):
        Issue.all_objects.filter(pk=tasks[key].pk).update(updated_at=timezone.now() - timedelta(hours=hours))
    return {"workspace": workspace, "me": me, "projects": projects, "tasks": tasks}


def _active(setup, client=None):
    client = client or _client(setup["me"])
    response = client.get(f"/api/workspaces/{setup['workspace'].slug}/my-active-projects/")
    assert response.status_code == status.HTTP_200_OK, response.content
    names = {str(project.id): key for key, project in setup["projects"].items()}
    return [(names[row["project_id"]], row) for row in response.json()["results"]]


def _timer(setup, task_key):
    task = setup["tasks"][task_key]
    IssueWorkLogTimer.objects.create(
        project=task.project, issue=task, user=setup["me"], started_at=timezone.now() - timedelta(minutes=5)
    )


@pytest.mark.contract
def test_latest_logged_time_first_then_assigned_only(setup):
    # logged: Beta 1h, Shared 5h, Alpha 2 days ago; then assigned only: Delta changed 1h ago, Gamma 3h
    assert [key for key, _ in _active(setup)] == ["beta", "shared", "alpha", "delta", "gamma"]


@pytest.mark.contract
def test_the_timers_project_comes_first(setup):
    _timer(setup, "alpha")
    rows = _active(setup)
    assert [key for key, _ in rows] == ["alpha", "beta", "shared", "delta", "gamma"]
    assert [key for key, row in rows if row["has_timer"]] == ["alpha"]


@pytest.mark.contract
def test_a_timer_on_a_finished_task_still_comes_first(setup):
    _timer(setup, "done")
    rows = _active(setup)
    assert rows[0][0] == "done" and rows[0][1]["has_timer"] and rows[0][1]["open_tasks"] == 0


@pytest.mark.contract
def test_what_is_left_out(setup):
    keys = [key for key, _ in _active(setup)]
    # only finished tasks (Done), someone else's work (Others), tickets and an archived project
    assert not {"done", "others", "tickets", "old"} & set(keys)


@pytest.mark.contract
def test_counts_and_last_logged(setup):
    rows = dict(_active(setup))
    assert rows["alpha"]["open_tasks"] == 1 and rows["alpha"]["last_logged_at"]
    assert rows["delta"]["last_logged_at"] is None


@pytest.mark.contract
def test_only_workspace_members(setup):
    stranger = _client(_user(None, "Stranger"))
    response = stranger.get(f"/api/workspaces/{setup['workspace'].slug}/my-active-projects/")
    assert response.status_code == status.HTTP_403_FORBIDDEN
