# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for project task details (plane.app.views.task_detail).

Rules under test:
  * project admins and members fill in the vTiger-style task fields; guests read them; others can't
  * fields can only be saved in projects with task details turned on
  * picklists, progress, yes / no and "requested by" only accept valid values
  * work items of such projects keep a single assignee (app API and public v1 API); other projects don't change
"""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    APIToken,
    Issue,
    IssueAssignee,
    IssueTaskDetail,
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


def _project(workspace, owner, people, name, identifier, enabled):
    project = Project.objects.create(
        name=name, identifier=identifier, workspace=workspace, created_by=owner, is_task_details_enabled=enabled
    )
    State.objects.create(name="Open", project=project, workspace=workspace, group="unstarted", default=True)
    ProjectMember.objects.create(project=project, member=people["admin"], role=20, is_active=True)
    ProjectMember.objects.create(project=project, member=people["member"], role=15, is_active=True)
    ProjectMember.objects.create(project=project, member=people["other"], role=15, is_active=True)
    ProjectMember.objects.create(project=project, member=people["guest"], role=5, is_active=True)
    return project


@pytest.fixture
def setup(db, workspace, create_user):
    people = {
        "admin": create_user,
        "member": _user(workspace, "Hiral"),
        "other": _user(workspace, "Vijay"),
        "guest": _user(workspace, "Guest", role=5),
        "outsider": _user(workspace, "Outsider"),
    }
    project = _project(workspace, create_user, people, "Verbix", "VERBIX", enabled=True)
    plain = _project(workspace, create_user, people, "Plain", "PLAIN", enabled=False)
    issue = Issue.objects.create(name="Buy number", workspace=workspace, project=project)
    plain_issue = Issue.objects.create(name="Plain task", workspace=workspace, project=plain)
    _assign([issue, plain_issue], people.values())
    return {
        "workspace": workspace,
        "people": people,
        "clients": {name: _client(user) for name, user in people.items()},
        "project": project,
        "issue": issue,
        "plain": plain,
        "plain_issue": plain_issue,
    }


def _url(setup, issue=None, project=None):
    project = project or setup["project"]
    issue = issue or setup["issue"]
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{project.id}/issues/{issue.id}/task-detail/"


FULL = {
    "task_type": "Development",
    "project_phase": "Phase-2",
    "technology": "ReactJs",
    "not_in_project_plan": True,
    "git_url": "  https://git.example.com/verbix/merge_requests/12  ",
    "create_code_review": True,
    "build_version": "1.4.4",
    "user_manual_url": "https://docs.example.com/verbix",
    "bug_type": "UI",
    "severity": "Major",
    "environment": "Stag. and Prod.",
    "progress": 40,
    "code_review_comments": "Looks good",
    "code_review_url": "https://git.example.com/review/3",
    "description_url": "https://figma.example.com/file/1",
}


# ---------------------------------------------------------------- fields


@pytest.mark.contract
def test_options_match_the_vtiger_form(setup):
    options = setup["clients"]["guest"].get(f"/api/workspaces/{setup['workspace'].slug}/task-detail-options/").json()
    assert "Other Task" in options["task_type"] and len(options["task_type"]) == 28
    assert options["project_phase"][0] == "Phase-1" and options["project_phase"][-1] == "Phase-10"
    assert options["severity"] == ["Critical", "Blocker", "Major", "Moderate", "Minor"]
    assert options["progress"] == [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]


@pytest.mark.contract
def test_fill_in_and_read_task_details(setup):
    client = setup["clients"]["member"]
    empty = client.get(_url(setup)).json()
    assert empty["task_type"] == "" and empty["progress"] is None and empty["create_code_review"] is None

    payload = {**FULL, "requested_by_id": str(setup["people"]["other"].id)}
    response = client.patch(_url(setup), payload, format="json")
    assert response.status_code == status.HTTP_200_OK, response.content
    body = setup["clients"]["guest"].get(_url(setup)).json()
    assert body == {
        **FULL,
        "git_url": "https://git.example.com/verbix/merge_requests/12",
        "requested_by_id": str(setup["people"]["other"].id),
    }

    # partial updates leave the other fields alone; empty values clear
    client.patch(_url(setup), {"progress": 100, "bug_type": "", "requested_by_id": None}, format="json")
    detail = IssueTaskDetail.objects.get(issue=setup["issue"])
    assert detail.progress == 100 and detail.bug_type == "" and detail.requested_by_id is None
    assert detail.task_type == "Development"


@pytest.mark.contract
@pytest.mark.parametrize(
    "payload",
    [
        {"task_type": "Coding"},
        {"severity": "critical"},
        {"progress": 45},
        {"progress": True},
        {"create_code_review": "Yes"},
        {"not_in_project_plan": None},
        {"git_url": 12},
        {"build_version": "x" * 256},
        {"requested_by_id": "not-a-uuid"},
    ],
)
def test_invalid_values_are_rejected(setup, payload):
    response = setup["clients"]["member"].patch(_url(setup), payload, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert set(payload) <= set(response.json())
    assert not IssueTaskDetail.objects.exists()


@pytest.mark.contract
def test_requested_by_must_be_in_the_workspace(setup):
    stranger = User.objects.create(email="stranger@plane.so", username="stranger")
    response = setup["clients"]["member"].patch(_url(setup), {"requested_by_id": str(stranger.id)}, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
@pytest.mark.parametrize("who", ["guest", "outsider"])
def test_guests_and_non_members_cannot_edit(setup, who):
    response = setup["clients"][who].patch(_url(setup), {"task_type": "Bug"}, format="json")
    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
def test_needs_task_details_turned_on(setup):
    url = _url(setup, setup["plain_issue"], setup["plain"])
    assert setup["clients"]["admin"].patch(url, {"task_type": "Bug"}, format="json").status_code == 400


@pytest.mark.contract
def test_project_exposes_the_switch(setup):
    projects = setup["clients"]["admin"].get(f"/api/workspaces/{setup['workspace'].slug}/projects/").json()
    flags = {p["identifier"]: p["is_task_details_enabled"] for p in projects}
    assert flags == {"VERBIX": True, "PLAIN": False}


# ---------------------------------------------------------------- single assignee


def _issues_url(setup, project):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{project.id}/issues/"


@pytest.mark.contract
def test_single_assignee_on_create_and_update(setup):
    client = setup["clients"]["member"]
    hiral, vijay = str(setup["people"]["member"].id), str(setup["people"]["other"].id)
    url = _issues_url(setup, setup["project"])

    response = client.post(url, {"name": "Two people", "assignee_ids": [hiral, vijay]}, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "assignee_ids" in response.json()

    response = client.post(url, {"name": "One person", "assignee_ids": [hiral]}, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    issue_id = response.json()["id"]

    response = client.patch(f"{url}{issue_id}/", {"assignee_ids": [hiral, vijay]}, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert client.patch(f"{url}{issue_id}/", {"assignee_ids": [vijay]}, format="json").status_code == 204
    assert list(IssueAssignee.objects.filter(issue_id=issue_id).values_list("assignee_id", flat=True)) == [
        setup["people"]["other"].id
    ]


@pytest.mark.contract
def test_other_projects_keep_several_assignees(setup):
    hiral, vijay = str(setup["people"]["member"].id), str(setup["people"]["other"].id)
    response = setup["clients"]["member"].post(
        _issues_url(setup, setup["plain"]), {"name": "Pair work", "assignee_ids": [hiral, vijay]}, format="json"
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert len(response.json()["assignee_ids"]) == 2


@pytest.mark.contract
def test_single_assignee_in_the_public_api(setup):
    token = APIToken.objects.create(user=setup["people"]["admin"], workspace=setup["workspace"], label="test")
    client = APIClient()
    client.credentials(HTTP_X_API_KEY=token.token)
    url = f"/api/v1/workspaces/{setup['workspace'].slug}/projects/{setup['project'].id}/issues/"
    hiral, vijay = str(setup["people"]["member"].id), str(setup["people"]["other"].id)

    response = client.post(url, {"name": "Two people", "assignees": [hiral, vijay]}, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert client.post(url, {"name": "One person", "assignees": [hiral]}, format="json").status_code == 201


# ---------------------------------------------------------------- new projects


@pytest.mark.contract
def test_new_projects_start_with_task_details_and_time_tracking(setup):
    slug = setup["workspace"].slug
    client = setup["clients"]["admin"]
    response = client.post(f"/api/workspaces/{slug}/projects/", {"name": "Fresh", "identifier": "FRESH"}, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    fresh = Project.objects.get(identifier="FRESH")
    assert fresh.is_task_details_enabled and fresh.is_time_tracking_enabled

    # a request can still leave them off
    response = client.post(
        f"/api/workspaces/{slug}/projects/",
        {
            "name": "Plain two",
            "identifier": "PLAIN2",
            "is_task_details_enabled": False,
            "is_time_tracking_enabled": False,
        },
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    plain = Project.objects.get(identifier="PLAIN2")
    assert not plain.is_task_details_enabled and not plain.is_time_tracking_enabled

    # the public API too
    token = APIToken.objects.create(user=setup["people"]["admin"], workspace=setup["workspace"], label="projects")
    api = APIClient()
    api.credentials(HTTP_X_API_KEY=token.token)
    response = api.post(
        f"/api/v1/workspaces/{slug}/projects/", {"name": "Via API", "identifier": "VIAAPI"}, format="json"
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    via_api = Project.objects.get(identifier="VIAAPI")
    assert via_api.is_task_details_enabled and via_api.is_time_tracking_enabled
