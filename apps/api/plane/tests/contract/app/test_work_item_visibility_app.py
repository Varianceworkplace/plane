# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for private work items (plane.utils.work_item_visibility).

Rules under test:
  * an assigned work item is only visible to its assignee(s): not to other members, the creator or admins
  * an unassigned work item is visible to its creator, project admins and workspace admins
  * hidden work items are left out of lists and answer 404 everywhere else (detail, comments, worklogs, ...)
  * the assignee can view, edit and delete; nobody else can
  * the creator still gets the work item back when creating it for someone else; the public API follows the rules
"""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import APIToken, Issue, Project, ProjectMember, State, User, WorkspaceMember


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


@pytest.fixture
def setup(db, workspace, create_user):
    people = {
        "ws_admin": create_user,  # workspace admin, not in the project's admin role
        "lead": _user(workspace, "Lead"),  # project admin
        "hiral": _user(workspace, "Hiral"),
        "vijay": _user(workspace, "Vijay"),
        "nutan": _user(workspace, "Nutan"),
    }
    project = Project.objects.create(name="Verbix", identifier="VERBIX", workspace=workspace, created_by=create_user)
    State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    ProjectMember.objects.create(project=project, member=people["ws_admin"], role=15, is_active=True)
    ProjectMember.objects.create(project=project, member=people["lead"], role=20, is_active=True)
    for name in ("hiral", "vijay", "nutan"):
        ProjectMember.objects.create(project=project, member=people[name], role=15, is_active=True)
    return {
        "workspace": workspace,
        "people": people,
        "clients": {name: _client(user) for name, user in people.items()},
        "project": project,
    }


def _issues_url(setup):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{setup['project'].id}/issues/"


def _create(setup, who, name, assignees=()):
    response = setup["clients"][who].post(
        _issues_url(setup),
        {"name": name, "assignee_ids": [str(setup["people"][a].id) for a in assignees]},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    return response.json()


def _listed(setup, who):
    response = setup["clients"][who].get(_issues_url(setup))
    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()
    rows = body["results"] if isinstance(body, dict) else body
    if isinstance(rows, dict):  # grouped results
        rows = [issue for group in rows.values() for issue in group.get("results", [])]
    return {issue["name"] for issue in rows}


def _detail(setup, who, issue):
    return setup["clients"][who].get(f"{_issues_url(setup)}{issue['id']}/")


# ---------------------------------------------------------------- who sees what


@pytest.mark.contract
def test_assigned_work_item_is_only_visible_to_its_assignee(setup):
    # Hiral creates a work item for Vijay
    issue = _create(setup, "hiral", "Buy number", assignees=["vijay"])
    # the creator still gets it back from the create call
    assert issue["name"] == "Buy number"

    assert "Buy number" in _listed(setup, "vijay")
    assert _detail(setup, "vijay", issue).status_code == status.HTTP_200_OK
    for who in ("hiral", "nutan", "lead", "ws_admin"):
        assert "Buy number" not in _listed(setup, who), who
        assert _detail(setup, who, issue).status_code == status.HTTP_404_NOT_FOUND, who


@pytest.mark.contract
def test_several_assignees_all_see_it(setup):
    issue = _create(setup, "lead", "Pair task", assignees=["hiral", "vijay"])
    assert _detail(setup, "hiral", issue).status_code == 200
    assert _detail(setup, "vijay", issue).status_code == 200
    assert _detail(setup, "nutan", issue).status_code == 404
    assert _detail(setup, "lead", issue).status_code == 404


@pytest.mark.contract
def test_unassigned_work_item_is_visible_to_creator_and_admins(setup):
    issue = _create(setup, "hiral", "Backlog idea")
    for who in ("hiral", "lead", "ws_admin"):
        assert _detail(setup, who, issue).status_code == status.HTTP_200_OK, who
        assert "Backlog idea" in _listed(setup, who), who
    assert _detail(setup, "vijay", issue).status_code == status.HTTP_404_NOT_FOUND
    assert "Backlog idea" not in _listed(setup, "vijay")


@pytest.mark.contract
def test_visibility_follows_reassignment(setup):
    issue = _create(setup, "lead", "Moving task", assignees=["hiral"])
    url = f"{_issues_url(setup)}{issue['id']}/"
    response = setup["clients"]["hiral"].patch(url, {"assignee_ids": [str(setup["people"]["vijay"].id)]}, format="json")
    assert response.status_code == status.HTTP_204_NO_CONTENT, response.content
    assert _detail(setup, "hiral", issue).status_code == 404
    assert _detail(setup, "vijay", issue).status_code == 200


# ---------------------------------------------------------------- edit / delete / related data


@pytest.mark.contract
def test_only_the_assignee_can_edit_and_delete(setup):
    issue = _create(setup, "lead", "Private task", assignees=["hiral"])
    url = f"{_issues_url(setup)}{issue['id']}/"
    for who in ("vijay", "lead", "ws_admin"):
        assert setup["clients"][who].patch(url, {"name": "Hijacked"}, format="json").status_code == 404, who
        assert setup["clients"][who].delete(url).status_code == 404, who
    assert Issue.objects.get(pk=issue["id"]).name == "Private task"

    assert setup["clients"]["hiral"].patch(url, {"name": "Renamed"}, format="json").status_code == 204
    assert setup["clients"]["hiral"].delete(url).status_code == status.HTTP_204_NO_CONTENT
    assert not Issue.objects.filter(pk=issue["id"]).exists()


@pytest.mark.contract
def test_related_data_of_hidden_work_items_is_unreachable(setup):
    issue = _create(setup, "lead", "Secret task", assignees=["hiral"])
    base = f"{_issues_url(setup)}{issue['id']}"
    comment = setup["clients"]["hiral"].post(f"{base}/comments/", {"comment_html": "<p>only for me</p>"}, format="json")
    assert comment.status_code == status.HTTP_201_CREATED, comment.content

    for path in ("comments/", "history/", "issue-links/", "worklogs/", "sub-issues/"):
        assert setup["clients"]["vijay"].get(f"{base}/{path}").status_code == 404, path
        assert setup["clients"]["hiral"].get(f"{base}/{path}").status_code == 200, path
    comment_url = f"{base}/comments/{comment.json()['id']}/"
    assert setup["clients"]["vijay"].patch(comment_url, {"comment_html": "<p>x</p>"}, format="json").status_code == 404


@pytest.mark.contract
def test_workspace_wide_lists_hide_it_too(setup):
    _create(setup, "lead", "Hidden everywhere", assignees=["hiral"])
    slug, project_id = setup["workspace"].slug, setup["project"].id
    response = setup["clients"]["vijay"].get(
        f"/api/workspaces/{slug}/projects/{project_id}/search-issues/", {"search": "Hidden"}
    )
    assert response.status_code == 200
    assert all(item["name"] != "Hidden everywhere" for item in response.json())


# ---------------------------------------------------------------- public API


@pytest.mark.contract
def test_public_api_follows_the_rules(setup):
    issue = _create(setup, "lead", "API task", assignees=["hiral"])

    def api_client(who):
        token = APIToken.objects.create(user=setup["people"][who], workspace=setup["workspace"], label=who)
        client = APIClient()
        client.credentials(HTTP_X_API_KEY=token.token)
        return client

    url = f"/api/v1/workspaces/{setup['workspace'].slug}/projects/{setup['project'].id}/issues/"
    vijay, hiral = api_client("vijay"), api_client("hiral")
    assert vijay.get(f"{url}{issue['id']}/").status_code == status.HTTP_404_NOT_FOUND
    assert all(row["id"] != issue["id"] for row in vijay.get(url).json()["results"])
    assert hiral.get(f"{url}{issue['id']}/").status_code == status.HTTP_200_OK

    # the creator gets the new work item back even when it's for someone else
    created = vijay.post(url, {"name": "For Hiral", "assignees": [str(setup["people"]["hiral"].id)]}, format="json")
    assert created.status_code == status.HTTP_201_CREATED, created.content
    assert vijay.get(f"{url}{created.json()['id']}/").status_code == 404
    # and the assignee may delete it
    assert hiral.delete(f"{url}{created.json()['id']}/").status_code == status.HTTP_204_NO_CONTENT
    assert not Issue.objects.filter(pk=created.json()["id"]).exists()
