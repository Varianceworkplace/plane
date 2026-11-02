# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for expected vs worked time on work items (plane.app.views.worklog.estimate).

Rules under test:
  * project admins and members set / change / clear the expected time; guests and non-members can't
  * expected time only in projects with time tracking on
  * worked time is the sum of the work item's worklogs; over_by shows how far past the estimate it is
  * a reason can be noted once there is an estimate
  * the project listing covers work items with an estimate or logged time
  * helpdesk tickets stay unreachable
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


def _user(workspace, first_name, role=15):
    uid = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{first_name.lower()}-{uid}@plane.so",
        username=f"{first_name.lower()}_{uid}",
        first_name=first_name,
        display_name=first_name.lower(),
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _assign(issues, users):
    """Work items are private to their assignees (plane.utils.work_item_visibility): let everyone in."""
    for issue in issues:
        for user in users:
            IssueAssignee.objects.create(issue=issue, assignee=user, project=issue.project)


@pytest.fixture
def setup(db, workspace, create_user):
    people = {"admin": create_user, "member": _user(workspace, "Hiral"), "guest": _user(workspace, "Guest", role=5)}
    people["outsider"] = _user(workspace, "Outsider")
    project = Project.objects.create(
        name="Verbix", identifier="VERBIX", workspace=workspace, created_by=create_user, is_time_tracking_enabled=True
    )
    off = Project.objects.create(name="Off", identifier="OFF", workspace=workspace, created_by=create_user)
    for proj in (project, off):
        ProjectMember.objects.create(project=proj, member=people["admin"], role=20, is_active=True)
        ProjectMember.objects.create(project=proj, member=people["member"], role=15, is_active=True)
        ProjectMember.objects.create(project=proj, member=people["guest"], role=5, is_active=True)
    state = State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    issue = Issue.objects.create(name="Buy number", workspace=workspace, project=project, state=state)
    other = Issue.objects.create(name="Voice bot", workspace=workspace, project=project, state=state)
    off_state = State.objects.create(name="Todo", project=off, workspace=workspace, group="unstarted", default=True)
    off_issue = Issue.objects.create(name="Off task", workspace=workspace, project=off, state=off_state)
    _assign([issue, other, off_issue], people.values())
    return {
        "workspace": workspace,
        "people": people,
        "clients": {name: _client(user) for name, user in people.items()},
        "project": project,
        "issue": issue,
        "other": other,
        "off": off,
        "off_issue": off_issue,
    }


def _url(setup, issue=None, project=None):
    project = project or setup["project"]
    issue = issue or setup["issue"]
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{project.id}/issues/{issue.id}/time-estimate/"


def _list_url(setup, project=None):
    project = project or setup["project"]
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{project.id}/time-estimates/"


def _log(setup, minutes, issue=None):
    ended = timezone.now() - timedelta(hours=1)
    return IssueWorkLog.objects.create(
        project=setup["project"],
        issue=issue or setup["issue"],
        logged_by=setup["people"]["member"],
        duration=minutes,
        description="work",
        started_at=ended - timedelta(minutes=minutes),
        ended_at=ended,
    )


@pytest.mark.contract
def test_expected_vs_worked(setup):
    client = setup["clients"]["member"]
    assert client.get(_url(setup)).json() == {
        "expected_duration": None,
        "worked_duration": 0,
        "worklog_count": 0,
        "over_by": 0,
        "overdue_reason": "",
    }

    response = client.patch(_url(setup), {"expected_duration": 120}, format="json")
    assert response.status_code == status.HTTP_200_OK, response.content
    assert response.json()["expected_duration"] == 120

    _log(setup, 38)
    body = client.get(_url(setup)).json()
    assert body["worked_duration"] == 38 and body["worklog_count"] == 1 and body["over_by"] == 0

    _log(setup, 100)
    body = setup["clients"]["guest"].get(_url(setup)).json()
    assert body["worked_duration"] == 138 and body["over_by"] == 18


@pytest.mark.contract
def test_change_and_clear_expected_time(setup):
    client = setup["clients"]["admin"]
    client.patch(_url(setup), {"expected_duration": 60}, format="json")
    assert client.patch(_url(setup), {"expected_duration": 90}, format="json").json()["expected_duration"] == 90
    assert IssueTimeEstimate.objects.filter(issue=setup["issue"]).count() == 1

    response = client.patch(_url(setup), {"expected_duration": None}, format="json")
    assert response.status_code == status.HTTP_200_OK
    assert response.json()["expected_duration"] is None
    assert not IssueTimeEstimate.all_objects.filter(issue=setup["issue"]).exists()
    # and it can be set again afterwards
    assert client.patch(_url(setup), {"expected_duration": 30}, format="json").status_code == 200


@pytest.mark.contract
def test_overdue_reason(setup):
    client = setup["clients"]["member"]
    response = client.patch(_url(setup), {"overdue_reason": "Scope grew"}, format="json")
    assert response.status_code == 400 and "expected_duration" in response.json()

    client.patch(_url(setup), {"expected_duration": 60}, format="json")
    _log(setup, 90)
    response = client.patch(_url(setup), {"overdue_reason": "  Client added two screens  "}, format="json")
    assert response.status_code == 200
    assert response.json()["overdue_reason"] == "Client added two screens"
    assert response.json()["expected_duration"] == 60  # untouched

    assert client.patch(_url(setup), {"overdue_reason": 5}, format="json").status_code == 400


@pytest.mark.contract
@pytest.mark.parametrize("value", [0, -10, "abc", 999 * 60 + 60])
def test_invalid_expected_time(setup, value):
    response = setup["clients"]["member"].patch(_url(setup), {"expected_duration": value}, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "expected_duration" in response.json()


@pytest.mark.contract
@pytest.mark.parametrize("who", ["guest", "outsider"])
def test_guests_and_non_members_cannot_set(setup, who):
    response = setup["clients"][who].patch(_url(setup), {"expected_duration": 60}, format="json")
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert not IssueTimeEstimate.objects.exists()


@pytest.mark.contract
def test_needs_time_tracking(setup):
    url = _url(setup, setup["off_issue"], setup["off"])
    response = setup["clients"]["admin"].patch(url, {"expected_duration": 60}, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
def test_project_listing(setup):
    client = setup["clients"]["member"]
    client.patch(_url(setup), {"expected_duration": 120}, format="json")
    _log(setup, 45, setup["other"])
    third = Issue.objects.create(name="Untouched", workspace=setup["workspace"], project=setup["project"])

    listing = setup["clients"]["guest"].get(_list_url(setup)).json()
    assert set(listing) == {str(setup["issue"].id), str(setup["other"].id)}
    assert str(third.id) not in listing
    assert listing[str(setup["issue"].id)]["expected_duration"] == 120
    assert listing[str(setup["issue"].id)]["worked_duration"] == 0
    assert listing[str(setup["other"].id)] == {
        "expected_duration": None,
        "worked_duration": 45,
        "worklog_count": 1,
        "over_by": 0,
        "overdue_reason": "",
    }
    assert setup["clients"]["outsider"].get(_list_url(setup)).status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
def test_deleted_work_items_drop_out(setup):
    client = setup["clients"]["member"]
    client.patch(_url(setup), {"expected_duration": 120}, format="json")
    _log(setup, 30)
    setup["issue"].delete()
    assert client.get(_list_url(setup)).json() == {}
    assert client.get(_url(setup)).status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
def test_ticket_work_items_are_unreachable(setup):
    slug = setup["workspace"].slug
    client = setup["clients"]["member"]
    meta = client.get(f"/api/workspaces/{slug}/tickets/meta/").json()
    ticket = client.post(
        f"/api/workspaces/{slug}/tickets/",
        {
            "name": "Ticket",
            "assignee_id": str(setup["people"]["member"].id),
            "manager_id": str(setup["people"]["member"].id),
            "state_id": meta["statuses"][0]["id"],
        },
        format="json",
    )
    assert ticket.status_code == status.HTTP_201_CREATED, ticket.content
    ticket_issue = Issue.all_objects.get(pk=ticket.json()["issue_id"])
    ticket_project = Project.all_objects.get(pk=ticket_issue.project_id)
    ticket_project.is_time_tracking_enabled = True
    ticket_project.save(update_fields=["is_time_tracking_enabled"])

    url = _url(setup, ticket_issue, ticket_project)
    assert client.patch(url, {"expected_duration": 60}, format="json").status_code == status.HTTP_404_NOT_FOUND
    assert client.get(url).status_code == status.HTTP_404_NOT_FOUND
