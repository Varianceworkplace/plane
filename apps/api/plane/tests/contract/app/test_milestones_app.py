# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for project milestones (plane.app.views.milestone)."""

from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueActivity,
    Milestone,
    MilestoneWorkItem,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)


def _user(workspace, first_name, role=15):
    uid = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{first_name.lower()}-{uid}@plane.so", username=f"{first_name.lower()}_{uid}", first_name=first_name
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def setup(db, workspace, create_user):
    people = {"admin": create_user, "member": _user(workspace, "Hiral"), "guest": _user(workspace, "Guest", role=5)}
    project = Project.objects.create(
        name="Power Layout", identifier="POWER", workspace=workspace, created_by=create_user, is_milestone_enabled=True
    )
    for name, role in (("admin", 20), ("member", 15), ("guest", 5)):
        ProjectMember.objects.create(project=project, member=people[name], role=role, is_active=True)
    todo = State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    done = State.objects.create(name="Done", project=project, workspace=workspace, group="completed")
    issues = [
        Issue.objects.create(name=f"Task {i}", workspace=workspace, project=project, state=todo) for i in range(3)
    ]
    draft = Issue.objects.create(name="Draft", workspace=workspace, project=project, state=todo, is_draft=True)
    archived = Issue.objects.create(
        name="Archived", workspace=workspace, project=project, state=done, archived_at=timezone.now().date()
    )
    return {
        "workspace": workspace,
        "people": people,
        "clients": {name: _client(user) for name, user in people.items()},
        "project": project,
        "issues": issues,
        "draft": draft,
        "archived": archived,
        "done": done,
    }


def _base(setup):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{setup['project'].id}/"


def _create(setup, title, target_date=None, who="member"):
    payload = {"title": title}
    if target_date:
        payload["target_date"] = target_date
    response = setup["clients"][who].post(_base(setup) + "milestones/", payload, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    return response.json()


@pytest.mark.contract
def test_create_list_sorted_and_search(setup):
    _create(setup, "Launch", "2026-12-01")
    _create(setup, "No date")
    _create(setup, "Beta", "2026-11-01")
    client = setup["clients"]["member"]
    titles = [m["title"] for m in client.get(_base(setup) + "milestones/").json()]
    assert titles == ["Beta", "Launch", "No date"]
    assert [m["title"] for m in client.get(_base(setup) + "milestones/", {"search": "lau"}).json()] == ["Launch"]


@pytest.mark.contract
def test_title_required_and_unique(setup):
    _create(setup, "Beta")
    client = setup["clients"]["member"]
    assert client.post(_base(setup) + "milestones/", {"title": "  "}, format="json").status_code == 400
    response = client.post(_base(setup) + "milestones/", {"title": "beta"}, format="json")
    assert response.status_code == 400 and "title" in response.json()


@pytest.mark.contract
def test_guest_cannot_see_or_create(setup):
    client = setup["clients"]["guest"]
    assert client.get(_base(setup) + "milestones/").status_code == status.HTTP_403_FORBIDDEN
    assert client.post(_base(setup) + "milestones/", {"title": "X"}, format="json").status_code == 403


@pytest.mark.contract
def test_link_work_items_and_progress(setup):
    milestone = _create(setup, "Beta", "2026-11-01")
    client = setup["clients"]["member"]
    url = _base(setup) + f"milestones/{milestone['id']}/"

    available = [i["id"] for i in client.get(url + "available-work-items/").json()]
    assert str(setup["draft"].id) not in available and str(setup["archived"].id) not in available
    assert len(available) == 3

    ids = [str(i.id) for i in setup["issues"][:2]] + [str(setup["draft"].id)]
    body = client.post(url + "work-items/", {"add": ids}, format="json").json()
    assert body["total_items"] == 2 and body["progress"] == 0  # the draft was ignored

    issue = setup["issues"][0]
    issue.state = setup["done"]
    issue.save()
    body = client.get(url).json()
    assert body["completed_items"] == 1 and body["progress"] == 50

    linked = client.get(url + "work-items/").json()
    assert {i["id"] for i in linked} == {str(i.id) for i in setup["issues"][:2]}
    assert len(client.get(url + "available-work-items/").json()) == 1

    body = client.post(url + "work-items/", {"remove": [str(setup["issues"][1].id)]}, format="json").json()
    assert body["total_items"] == 1 and body["progress"] == 100


@pytest.mark.contract
def test_work_item_milestone_move_remove_and_activity(setup):
    first = _create(setup, "Beta")
    second = _create(setup, "Launch")
    issue = setup["issues"][0]
    url = _base(setup) + f"issues/{issue.id}/milestone/"
    client = setup["clients"]["member"]

    assert client.get(url).json() == {"milestone": None}
    assert client.put(url, {"milestone_id": first["id"]}, format="json").json()["milestone"]["title"] == "Beta"
    assert client.put(url, {"milestone_id": second["id"]}, format="json").json()["milestone"]["title"] == "Launch"
    assert MilestoneWorkItem.objects.filter(issue=issue).count() == 1
    assert client.put(url, {"milestone_id": None}, format="json").json() == {"milestone": None}
    assert not MilestoneWorkItem.objects.filter(issue=issue).exists()

    moves = list(
        IssueActivity.objects.filter(issue=issue, field="milestone")
        .order_by("created_at")
        .values_list("old_value", "new_value")
    )
    assert moves == [("", "Beta"), ("Beta", "Launch"), ("Launch", "")]

    # the guest can see the work item's milestone but not change it
    client.put(url, {"milestone_id": first["id"]}, format="json")
    assert setup["clients"]["guest"].get(url).json()["milestone"]["title"] == "Beta"
    assert setup["clients"]["guest"].put(url, {"milestone_id": None}, format="json").status_code == 403


@pytest.mark.contract
def test_edit_and_delete_unlinks_work_items(setup):
    milestone = _create(setup, "Beta")
    client = setup["clients"]["member"]
    url = _base(setup) + f"milestones/{milestone['id']}/"
    response = client.patch(url, {"target_date": "2026-11-15", "description_html": "<p>Scope</p>"}, format="json")
    assert response.status_code == 200 and response.json()["target_date"] == "2026-11-15"
    assert client.patch(url, {"target_date": None}, format="json").json()["target_date"] is None

    issue = setup["issues"][0]
    client.post(url + "work-items/", {"add": [str(issue.id)]}, format="json")
    assert client.delete(url).status_code == status.HTTP_204_NO_CONTENT
    assert not Milestone.objects.filter(pk=milestone["id"]).exists()
    assert Issue.objects.filter(pk=issue.id).exists()  # work items are unlinked, not deleted
    assert not MilestoneWorkItem.objects.filter(issue=issue).exists()
    assert IssueActivity.objects.filter(issue=issue, field="milestone", old_value="Beta", new_value="").exists()


@pytest.mark.contract
def test_turning_milestones_off_keeps_data_but_blocks_changes(setup):
    milestone = _create(setup, "Beta")
    project = setup["project"]
    project.is_milestone_enabled = False
    project.save(update_fields=["is_milestone_enabled"])
    client = setup["clients"]["member"]
    assert [m["title"] for m in client.get(_base(setup) + "milestones/").json()] == ["Beta"]
    assert client.post(_base(setup) + "milestones/", {"title": "New"}, format="json").status_code == 400
    assert client.patch(_base(setup) + f"milestones/{milestone['id']}/", {"title": "X"}, format="json").status_code == 400


@pytest.mark.contract
def test_project_list_exposes_milestone_flag(setup):
    response = setup["clients"]["admin"].get(f"/api/workspaces/{setup['workspace'].slug}/projects/")
    projects = {p["identifier"]: p for p in response.json()}
    assert projects["POWER"]["is_milestone_enabled"] is True


@pytest.mark.contract
def test_ticket_project_is_unreachable(setup):
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
    assert ticket.status_code == 201, ticket.content
    issue = Issue.all_objects.get(pk=ticket.json()["issue_id"])
    url = f"/api/workspaces/{slug}/projects/{issue.project_id}/"
    assert client.get(url + "milestones/").status_code == 404
    assert client.put(url + f"issues/{issue.id}/milestone/", {"milestone_id": None}, format="json").status_code == 404
