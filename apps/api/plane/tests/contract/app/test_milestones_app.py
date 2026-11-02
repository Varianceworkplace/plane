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
    IssueAssignee,
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


def _assign(issues, users):
    """Work items are private to their assignees (plane.utils.work_item_visibility): let everyone in."""
    for issue in issues:
        for user in users:
            IssueAssignee.objects.create(issue=issue, assignee=user, project=issue.project)


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
    _assign([*issues, draft, archived], people.values())
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


def _create(setup, title, target_date=None, who="member", **fields):
    payload = {"title": title, "assigned_to_id": str(setup["people"]["member"].id), **fields}
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
    assert (
        client.patch(_base(setup) + f"milestones/{milestone['id']}/", {"title": "X"}, format="json").status_code == 400
    )


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


@pytest.mark.contract
def test_create_with_every_workplace_field(setup):
    milestone = _create(
        setup,
        "Phase 1 release",
        "2026-11-30",
        start_date="2026-11-01",
        actual_completion_date="2026-11-28",
        milestone_type="operative",
        status="In Progress",
        description_html="<p>First release</p>",
    )
    assert milestone["start_date"] == "2026-11-01"
    assert milestone["target_date"] == "2026-11-30"
    assert milestone["actual_completion_date"] == "2026-11-28"
    assert milestone["milestone_type"] == "operative"
    assert milestone["status"] == "In Progress"
    assert milestone["assigned_to_id"] == str(setup["people"]["member"].id)
    saved = Milestone.objects.get(pk=milestone["id"])
    assert saved.assigned_to_id == setup["people"]["member"].id
    assert str(saved.start_date) == "2026-11-01"


@pytest.mark.contract
def test_assigned_to_is_required_and_must_be_in_the_project(setup):
    client = setup["clients"]["member"]
    url = _base(setup) + "milestones/"
    missing = client.post(url, {"title": "Beta"}, format="json")
    assert missing.status_code == 400 and "assigned_to_id" in missing.json()
    guest = client.post(url, {"title": "Beta", "assigned_to_id": str(setup["people"]["guest"].id)}, format="json")
    assert guest.status_code == 400 and "assigned_to_id" in guest.json()
    stranger = client.post(url, {"title": "Beta", "assigned_to_id": str(uuid4())}, format="json")
    assert stranger.status_code == 400 and "assigned_to_id" in stranger.json()
    assert not Milestone.objects.filter(project=setup["project"]).exists()

    milestone = _create(setup, "Beta")
    cleared = client.patch(url + f"{milestone['id']}/", {"assigned_to_id": None}, format="json")
    assert cleared.status_code == 400 and "assigned_to_id" in cleared.json()
    moved = client.patch(
        url + f"{milestone['id']}/", {"assigned_to_id": str(setup["people"]["admin"].id)}, format="json"
    )
    assert moved.status_code == 200 and moved.json()["assigned_to_id"] == str(setup["people"]["admin"].id)


@pytest.mark.contract
def test_older_milestone_without_assignee_still_edits_other_fields(setup):
    milestone = Milestone.objects.create(project=setup["project"], title="Legacy")
    response = setup["clients"]["member"].patch(
        _base(setup) + f"milestones/{milestone.id}/", {"target_date": "2026-12-01"}, format="json"
    )
    assert response.status_code == 200, response.content
    assert response.json()["assigned_to_id"] is None


@pytest.mark.contract
@pytest.mark.parametrize(
    "fields",
    [
        {"milestone_type": "strategic"},
        {"status": "done"},
        {"start_date": "01/11/2026"},
        {"actual_completion_date": "soon"},
    ],
)
def test_invalid_values_are_rejected(setup, fields):
    response = setup["clients"]["member"].post(
        _base(setup) + "milestones/",
        {"title": "Beta", "assigned_to_id": str(setup["people"]["member"].id), **fields},
        format="json",
    )
    assert response.status_code == 400
    assert set(fields) <= set(response.json())


@pytest.mark.contract
def test_dates_cannot_end_before_they_start(setup):
    client = setup["clients"]["member"]
    url = _base(setup) + "milestones/"
    response = client.post(
        url,
        {
            "title": "Beta",
            "assigned_to_id": str(setup["people"]["member"].id),
            "start_date": "2026-11-10",
            "target_date": "2026-11-01",
            "actual_completion_date": "2026-11-05",
        },
        format="json",
    )
    assert response.status_code == 400
    assert {"target_date", "actual_completion_date"} <= set(response.json())

    # checked against the saved start date too
    milestone = _create(setup, "Gamma", "2026-11-30", start_date="2026-11-10")
    response = client.patch(url + f"{milestone['id']}/", {"actual_completion_date": "2026-11-01"}, format="json")
    assert response.status_code == 400 and "actual_completion_date" in response.json()


@pytest.mark.contract
def test_options_list_the_picklists(setup):
    response = setup["clients"]["guest"].get(f"/api/workspaces/{setup['workspace'].slug}/milestone-options/")
    assert response.status_code == 200
    assert response.json()["milestone_type"] == ["administrative", "operative", "other"]
    assert "In Progress" in response.json()["status"]


@pytest.mark.contract
def test_workspace_list_covers_the_projects_the_user_works_in(setup):
    workspace, people = setup["workspace"], setup["people"]
    _create(setup, "Beta", "2026-11-01")

    def project(identifier, **fields):
        return Project.objects.create(
            name=identifier.title(),
            identifier=identifier,
            workspace=workspace,
            created_by=people["admin"],
            **{"is_milestone_enabled": True, **fields},
        )

    # the member is a guest here: left out for them
    as_guest = project("GUESTED")
    ProjectMember.objects.create(project=as_guest, member=people["member"], role=5, is_active=True)
    Milestone.objects.create(project=as_guest, title="Guest only")
    # not a member at all
    Milestone.objects.create(project=project("OTHER"), title="Not mine")
    # member, but milestones are off / the project is archived
    off = project("OFF", is_milestone_enabled=False)
    archived = project("OLD", archived_at=timezone.now())
    for hidden in (off, archived):
        ProjectMember.objects.create(project=hidden, member=people["member"], role=15, is_active=True)
        Milestone.objects.create(project=hidden, title=f"Hidden {hidden.identifier}")

    url = f"/api/workspaces/{workspace.slug}/milestones/"
    member_view = setup["clients"]["member"].get(url)
    assert member_view.status_code == 200
    assert [m["title"] for m in member_view.json()] == ["Beta"]
    assert member_view.json()[0]["project_id"] == str(setup["project"].id)
    assert member_view.json()[0]["assigned_to_id"] == str(people["member"].id)

    # a workspace admin gets the projects they're in with any role
    ProjectMember.objects.create(project=as_guest, member=people["admin"], role=5, is_active=True)
    assert {m["title"] for m in setup["clients"]["admin"].get(url).json()} == {"Beta", "Guest only"}

    # workspace guests have no milestones page
    assert setup["clients"]["guest"].get(url).status_code == 403
