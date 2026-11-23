# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the helpdesk Ticket module (plane.app.views.ticket).

Access rules under test:
  * approval: a new ticket waits for its Manager, who approves (status Approved, the assignee gets it) or rejects it
  * view / comment: the creator, the Manager, and the current assignee once approved
  * edit: the current assignee once approved (workspace/project admins get nothing implicit)
  * delete: impossible through any endpoint
  * ticket data never leaks through generic project / work item endpoints
"""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueActivity, IssueComment, Project, ProjectMember, Ticket, User, WorkspaceMember

BASE = "/api/workspaces/{slug}/tickets/"


def _user(workspace, first_name, role=15):
    uid = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{first_name.lower()}-{uid}@plane.so",
        username=f"{first_name.lower()}_{uid}",
        first_name=first_name,
        last_name="Test",
    )
    user.set_password("test-password")
    user.save()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def people(db, workspace, create_user):
    # create_user is the workspace owner / admin (role 20)
    return {
        "admin": create_user,
        "hiral": _user(workspace, "Hiral"),
        "vijay": _user(workspace, "Vijay"),
        "manoj": _user(workspace, "Manoj"),
        "raj": _user(workspace, "Raj"),
    }


@pytest.fixture
def clients(people):
    return {name: _client(user) for name, user in people.items()}


@pytest.fixture
def meta(clients, workspace):
    response = clients["hiral"].get(BASE.format(slug=workspace.slug) + "meta/")
    assert response.status_code == status.HTTP_200_OK
    return response.json()


def _status_id(meta, name):
    return next(s["id"] for s in meta["statuses"] if s["name"] == name)


@pytest.fixture
def ticket(clients, people, workspace, meta):
    """Hiral creates a ticket, Vijay is assignee and manager."""
    payload = {
        "name": "Request Access to Plane.so Source Code",
        "assignee_id": str(people["vijay"].id),
        "manager_id": str(people["vijay"].id),
        "state_id": _status_id(meta, "Open"),
        "priority": "medium",
        "tool_category": "Software Requirement",
    }
    response = clients["hiral"].post(BASE.format(slug=workspace.slug), payload, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    # the editing tests below start from an approved ticket (approval has its own tests)
    Ticket.objects.filter(id=response.json()["id"]).update(approval_status="approved")
    return response.json()


def _detail(workspace, ticket):
    return BASE.format(slug=workspace.slug) + f"{ticket['id']}/"


@pytest.mark.contract
class TestTicketCreate:
    @pytest.mark.django_db
    def test_required_fields(self, clients, workspace):
        response = clients["hiral"].post(BASE.format(slug=workspace.slug), {}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert set(response.json()) >= {"name", "assignee_id", "state_id", "manager_id"}

    @pytest.mark.django_db
    def test_numbering_and_creator(self, ticket, people):
        assert ticket["ticket_number"] == "TT1"
        assert ticket["created_by"]["id"] == str(people["hiral"].id)
        assert ticket["assignee"]["id"] == str(people["vijay"].id)

    @pytest.mark.django_db
    def test_assignee_must_be_workspace_member(self, clients, workspace, meta, people):
        outsider = User.objects.create(email=f"out-{uuid4().hex[:6]}@plane.so", username=uuid4().hex[:10])
        payload = {
            "name": "x",
            "assignee_id": str(outsider.id),
            "manager_id": str(people["vijay"].id),
            "state_id": _status_id(meta, "Open"),
        }
        response = clients["hiral"].post(BASE.format(slug=workspace.slug), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_tool_category_spelling(self, meta, clients, workspace, people):
        assert "Software Requirement" in meta["tool_categories"]
        assert "Furniture Requirement" in meta["tool_categories"]
        assert "Softeware Requirement" not in meta["tool_categories"]
        payload = {
            "name": "x",
            "assignee_id": str(people["vijay"].id),
            "manager_id": str(people["vijay"].id),
            "state_id": _status_id(meta, "Open"),
            "tool_category": "Softeware Requirement",
        }
        response = clients["hiral"].post(BASE.format(slug=workspace.slug), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_statuses_match_crm(self, meta):
        assert [s["name"] for s in meta["statuses"]] == [
            "Open",
            "In Progress",
            "Wait For Response",
            "Approved",
            "Reject",
            "Completed",
            "Closed",
        ]


@pytest.mark.contract
class TestTicketVisibility:
    @pytest.mark.django_db
    @pytest.mark.parametrize("name,expected", [("hiral", 200), ("vijay", 200), ("admin", 404), ("raj", 404)])
    def test_detail(self, clients, workspace, ticket, name, expected):
        assert clients[name].get(_detail(workspace, ticket)).status_code == expected

    @pytest.mark.django_db
    @pytest.mark.parametrize("name,count", [("hiral", 1), ("vijay", 1), ("admin", 0), ("raj", 0)])
    def test_list(self, clients, workspace, ticket, name, count):
        response = clients[name].get(BASE.format(slug=workspace.slug))
        assert response.json()["total"] == count

    @pytest.mark.django_db
    def test_the_manager_sees_the_ticket_to_approve_it(self, clients, people, workspace, meta):
        payload = {
            "name": "Managed by Manoj",
            "assignee_id": str(people["vijay"].id),
            "manager_id": str(people["manoj"].id),
            "state_id": _status_id(meta, "Open"),
        }
        ticket = clients["hiral"].post(BASE.format(slug=workspace.slug), payload, format="json").json()
        response = clients["manoj"].get(_detail(workspace, ticket))
        assert response.status_code == 200
        assert response.json()["can_approve"] is True and response.json()["can_edit"] is False


@pytest.mark.contract
class TestTicketEdit:
    @pytest.mark.django_db
    def test_assignee_can_edit(self, clients, workspace, ticket, meta):
        response = clients["vijay"].patch(
            _detail(workspace, ticket), {"state_id": _status_id(meta, "Approved")}, format="json"
        )
        assert response.status_code == 200
        assert response.json()["state"]["name"] == "Approved"

    @pytest.mark.django_db
    def test_creator_cannot_edit(self, clients, workspace, ticket):
        response = clients["hiral"].patch(_detail(workspace, ticket), {"name": "changed"}, format="json")
        assert response.status_code == 403

    @pytest.mark.django_db
    @pytest.mark.parametrize("name", ["admin", "raj"])
    def test_others_cannot_edit(self, clients, workspace, ticket, name):
        response = clients[name].patch(_detail(workspace, ticket), {"name": "changed"}, format="json")
        assert response.status_code == 404

    @pytest.mark.django_db
    def test_required_field_cannot_be_cleared(self, clients, workspace, ticket):
        response = clients["vijay"].patch(_detail(workspace, ticket), {"name": "  "}, format="json")
        assert response.status_code == 400

    @pytest.mark.django_db
    def test_reassignment_transfers_access(self, clients, people, workspace, ticket, meta):
        url = _detail(workspace, ticket)
        response = clients["vijay"].patch(
            url,
            {"state_id": _status_id(meta, "Approved"), "assignee_id": str(people["manoj"].id)},
            format="json",
        )
        assert response.status_code == 200
        # Vijay isn't the assignee any more: as the ticket's Manager he still sees it, read-only
        assert clients["vijay"].get(url).json()["can_edit"] is False
        assert clients["vijay"].patch(url, {"name": "x"}, format="json").status_code == 403
        # Manoj gains view + edit immediately
        assert clients["manoj"].get(url).json()["can_edit"] is True
        assert clients["manoj"].patch(url, {"priority": "high"}, format="json").status_code == 200
        # Hiral (creator) still views, read-only
        assert clients["hiral"].get(url).json()["can_edit"] is False
        fields = set(IssueActivity.all_objects.filter(issue_id=ticket["issue_id"]).values_list("field", flat=True))
        assert {"Status", "Assigned To", "Priority"} <= fields

    @pytest.mark.django_db
    def test_closed_ticket(self, clients, workspace, ticket, meta):
        url = _detail(workspace, ticket)
        response = clients["vijay"].patch(url, {"state_id": _status_id(meta, "Closed")}, format="json")
        assert response.status_code == 200
        assert clients["vijay"].get(url).json()["state"]["name"] == "Closed"
        listed = clients["vijay"].get(BASE.format(slug=workspace.slug), {"filter": "open"}).json()
        assert listed["total"] == 0

    @pytest.mark.django_db
    def test_bulk_update_skips_tickets_not_assigned(self, clients, workspace, ticket, meta):
        response = clients["hiral"].patch(
            BASE.format(slug=workspace.slug) + "bulk-update/",
            {"ticket_ids": [ticket["id"]], "changes": {"priority": "urgent"}},
            format="json",
        )
        assert response.json() == {"updated": [], "skipped": [ticket["id"]]}


@pytest.mark.contract
class TestTicketDelete:
    @pytest.mark.django_db
    @pytest.mark.parametrize("name", ["vijay", "hiral", "admin"])
    def test_delete_not_allowed(self, clients, workspace, ticket, name):
        response = clients[name].delete(_detail(workspace, ticket))
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert Issue.ticket_objects.filter(id=ticket["issue_id"]).exists()

    @pytest.mark.django_db
    def test_generic_issue_delete_blocked(self, clients, workspace, ticket):
        issue = Issue.ticket_objects.get(id=ticket["issue_id"])
        url = f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}/issues/{issue.id}/"
        assert clients["admin"].delete(url).status_code == 404
        bulk = f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}/bulk-delete-issues/"
        assert clients["admin"].delete(bulk, {"issue_ids": [str(issue.id)]}, format="json").status_code == 404
        assert Issue.ticket_objects.filter(id=issue.id).exists()


@pytest.mark.contract
class TestTicketIsolation:
    @pytest.mark.django_db
    def test_ticket_project_hidden_from_project_list(self, clients, workspace, ticket):
        response = clients["admin"].get(f"/api/workspaces/{workspace.slug}/projects/")
        assert all(not p.get("is_ticket_project") for p in response.json())
        ticket_project = Project.ticket_projects.get(workspace=workspace)
        assert str(ticket_project.id) not in {p["id"] for p in response.json()}

    @pytest.mark.django_db
    def test_generic_endpoints_return_404_even_for_project_members(self, clients, people, workspace, ticket):
        issue = Issue.ticket_objects.get(id=ticket["issue_id"])
        # Even an explicit project membership must not open a back door
        ProjectMember.objects.create(project_id=issue.project_id, member=people["admin"], workspace=workspace, role=20)
        prefix = f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}"
        for url in [
            f"{prefix}/issues/",
            f"{prefix}/issues/{issue.id}/",
            f"{prefix}/issues/{issue.id}/comments/",
            f"{prefix}/issues/{issue.id}/history/",
            f"{prefix}/states/",
        ]:
            assert clients["admin"].get(url).status_code == 404, url
        assert not Issue.objects.filter(id=issue.id).exists()
        assert not Issue.issue_objects.filter(id=issue.id).exists()


@pytest.mark.contract
class TestTicketComments:
    @pytest.mark.django_db
    def test_creator_and_assignee_can_comment_others_cannot(self, clients, workspace, ticket):
        url = _detail(workspace, ticket) + "comments/"
        body = {"comment_html": "<p>I approved the request.</p>"}
        assert clients["vijay"].post(url, body, format="json").status_code == 201
        assert clients["hiral"].post(url, body, format="json").status_code == 201
        assert clients["raj"].post(url, body, format="json").status_code == 404
        assert clients["admin"].post(url, body, format="json").status_code == 404

    @pytest.mark.django_db
    def test_reply_edit_own_and_no_delete(self, clients, workspace, ticket):
        url = _detail(workspace, ticket) + "comments/"
        parent = clients["vijay"].post(url, {"comment_html": "<p>parent</p>"}, format="json").json()
        reply = (
            clients["hiral"]
            .post(url, {"comment_html": "<p>reply</p>", "parent_id": parent["id"]}, format="json")
            .json()
        )
        assert reply["parent_id"] == parent["id"]
        own = clients["vijay"].patch(f"{url}{parent['id']}/", {"comment_html": "<p>edited</p>"}, format="json")
        assert own.status_code == 200
        other = clients["hiral"].patch(f"{url}{parent['id']}/", {"comment_html": "<p>x</p>"}, format="json")
        assert other.status_code == 403
        assert clients["vijay"].delete(f"{url}{parent['id']}/").status_code == 405

    @pytest.mark.django_db
    def test_empty_comment_rejected(self, clients, workspace, ticket):
        url = _detail(workspace, ticket) + "comments/"
        assert clients["vijay"].post(url, {"comment_html": "<p> </p>"}, format="json").status_code == 400


@pytest.mark.contract
class TestTicketList:
    @pytest.mark.django_db
    def test_filters_search_alphabet(self, clients, people, workspace, meta):
        url = BASE.format(slug=workspace.slug)
        for name, priority in [("Alpha laptop", "high"), ("Beta license", "low")]:
            clients["hiral"].post(
                url,
                {
                    "name": name,
                    "assignee_id": str(people["hiral"].id),
                    "manager_id": str(people["vijay"].id),
                    "state_id": _status_id(meta, "Open"),
                    "priority": priority,
                },
                format="json",
            )
        client = clients["hiral"]
        assert client.get(url, {"filter": "high_priority"}).json()["total"] == 1
        assert client.get(url, {"alphabet": "B"}).json()["results"][0]["name"] == "Beta license"
        assert client.get(url, {"title": "laptop"}).json()["total"] == 1
        assert client.get(url, {"search": "TT2"}).json()["results"][0]["ticket_number"] == "TT2"
        titles = [t["name"] for t in client.get(url, {"order_by": "title"}).json()["results"]]
        assert titles == sorted(titles)


class TestTicketViewsAndSummary:
    """Saved views, exact filter pills and the counts the list page shows."""

    @pytest.fixture
    def tickets(self, clients, people, workspace, meta):
        url = BASE.format(slug=workspace.slug)
        rows = [
            # (creator, assignee, status, priority)
            ("hiral", "hiral", "Open", "high"),
            ("hiral", "vijay", "Open", "low"),
            ("vijay", "hiral", "Closed", "medium"),
        ]
        created = []
        for index, (creator, assignee, state, priority) in enumerate(rows):
            response = clients[creator].post(
                url,
                {
                    "name": f"Ticket {index}",
                    "assignee_id": str(people[assignee].id),
                    "manager_id": str(people["manoj"].id),
                    "state_id": _status_id(meta, state),
                    "priority": priority,
                },
                format="json",
            )
            assert response.status_code == status.HTTP_201_CREATED, response.content
            created.append(response.json())
        # these tests are about views and filters: the tickets are approved (approval has its own tests)
        Ticket.objects.filter(id__in=[t["id"] for t in created]).update(approval_status="approved")
        return created

    @pytest.mark.django_db
    @pytest.mark.parametrize(
        "view, names",
        [
            ("all", {"Ticket 0", "Ticket 1", "Ticket 2"}),
            ("open", {"Ticket 0", "Ticket 1"}),
            ("closed", {"Ticket 2"}),
            ("assigned_to_me", {"Ticket 0", "Ticket 2"}),
            ("created_by_me", {"Ticket 0", "Ticket 1"}),
            ("high_priority", {"Ticket 0"}),
        ],
    )
    def test_saved_views(self, clients, workspace, tickets, view, names):
        response = clients["hiral"].get(BASE.format(slug=workspace.slug), {"filter": view})
        assert {t["name"] for t in response.json()["results"]} == names

    @pytest.mark.django_db
    def test_exact_filters(self, clients, people, workspace, meta, tickets):
        url = BASE.format(slug=workspace.slug)
        client = clients["hiral"]
        open_and_closed = f"{_status_id(meta, 'Closed')},not-a-uuid"
        assert {t["name"] for t in client.get(url, {"state_ids": open_and_closed}).json()["results"]} == {"Ticket 2"}
        assert {t["name"] for t in client.get(url, {"priorities": "low,medium,bogus"}).json()["results"]} == {
            "Ticket 1",
            "Ticket 2",
        }
        by_vijay = client.get(url, {"assignee_ids": str(people["vijay"].id)}).json()
        assert [t["name"] for t in by_vijay["results"]] == ["Ticket 1"]
        # filters combine
        combined = client.get(url, {"filter": "open", "priorities": "high,medium"}).json()
        assert [t["name"] for t in combined["results"]] == ["Ticket 0"]

    @pytest.mark.django_db
    def test_summary_counts_only_visible_tickets(self, clients, workspace, meta, tickets):
        url = BASE.format(slug=workspace.slug) + "summary/"
        hiral = clients["hiral"].get(url).json()
        assert hiral["views"] == {
            "all": 3,
            "awaiting_my_approval": 0,  # Manoj manages these
            "open": 2,
            "assigned_to_me": 2,
            "created_by_me": 2,
            "high_priority": 1,
            "closed": 1,
        }
        assert hiral["statuses"] == {_status_id(meta, "Open"): 2, _status_id(meta, "Closed"): 1}
        # Vijay sees the ticket he created and the one assigned to him
        vijay = clients["vijay"].get(url).json()
        assert vijay["views"]["all"] == 2
        # someone with no tickets sees zeros
        assert clients["raj"].get(url).json()["views"]["all"] == 0


# ---------------------------------------------------------------- approval


def _new_ticket(clients, people, workspace, meta, creator="hiral", assignee="raj", manager="manoj"):
    payload = {
        "name": "New laptop",
        "assignee_id": str(people[assignee].id),
        "manager_id": str(people[manager].id),
        "state_id": _status_id(meta, "Open"),
        "priority": "high",
    }
    response = clients[creator].post(BASE.format(slug=workspace.slug), payload, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    return response.json()


def _decide(clients, who, workspace, ticket, decision, note=""):
    return clients[who].post(
        _detail(workspace, ticket) + "approval/", {"decision": decision, "note": note}, format="json"
    )


@pytest.mark.contract
class TestApproval:
    @pytest.mark.django_db
    def test_a_new_ticket_waits_for_its_manager(self, clients, people, workspace, meta):
        ticket = _new_ticket(clients, people, workspace, meta)
        assert ticket["approval"]["status"] == "pending"
        # the assignee sees it and works on it straight away, but doesn't decide it
        seen = clients["raj"].get(_detail(workspace, ticket))
        assert seen.status_code == 200 and seen.json()["approval"]["status"] == "pending"
        assert seen.json()["can_edit"] is True and seen.json()["can_approve"] is False
        assert clients["raj"].get(BASE.format(slug=workspace.slug)).json()["total"] == 1
        assert clients["raj"].patch(_detail(workspace, ticket), {"name": "x"}, format="json").status_code == 200
        # the creator follows it; the Manager has it waiting
        assert clients["hiral"].get(_detail(workspace, ticket)).json()["approval"]["status"] == "pending"
        mine = clients["manoj"].get(BASE.format(slug=workspace.slug) + "?filter=awaiting_my_approval").json()
        assert mine["total"] == 1 and mine["results"][0]["can_approve"] is True
        summary = clients["manoj"].get(BASE.format(slug=workspace.slug) + "summary/").json()
        assert summary["views"]["awaiting_my_approval"] == 1
        assert "awaiting_my_approval" in {f["key"] for f in meta["filters"]}

    @pytest.mark.django_db
    def test_approving(self, clients, people, workspace, meta):
        ticket = _new_ticket(clients, people, workspace, meta)
        # only the Manager decides
        assert _decide(clients, "hiral", workspace, ticket, "approve").status_code == status.HTTP_403_FORBIDDEN
        assert _decide(clients, "raj", workspace, ticket, "approve").status_code == status.HTTP_403_FORBIDDEN
        assert _decide(clients, "manoj", workspace, ticket, "maybe").status_code == status.HTTP_400_BAD_REQUEST

        response = _decide(clients, "manoj", workspace, ticket, "approve", "Go ahead")
        assert response.status_code == 200, response.content
        body = response.json()
        assert body["approval"]["status"] == "approved" and body["approval"]["decided_by"]["id"] == str(
            people["manoj"].id
        )
        assert body["state"]["name"] == "Approved"
        # the assignee carries on with it
        detail = clients["raj"].get(_detail(workspace, ticket))
        assert detail.status_code == 200 and detail.json()["can_edit"] is True
        edit = clients["raj"].patch(
            _detail(workspace, ticket), {"state_id": _status_id(meta, "In Progress")}, format="json"
        )
        assert edit.status_code == 200
        # the decision is in the history and the note in the comments
        # (tickets are hidden from Plane's own managers: read them unfiltered)
        fields = set(IssueActivity.all_objects.filter(issue_id=ticket["issue_id"]).values_list("field", flat=True))
        assert {"Approval", "Status"} <= fields
        assert IssueComment.all_objects.filter(issue_id=ticket["issue_id"], comment_html__icontains="Go ahead").exists()
        # decided once
        assert _decide(clients, "manoj", workspace, ticket, "reject").status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_rejecting(self, clients, people, workspace, meta):
        ticket = _new_ticket(clients, people, workspace, meta)
        response = _decide(clients, "manoj", workspace, ticket, "reject", "Not in this budget")
        assert response.status_code == 200, response.content
        assert response.json()["approval"]["status"] == "rejected" and response.json()["state"]["name"] == "Reject"
        # the creator and the assignee both see it, with the reason; the assignee can still edit it
        for who, edits in (("hiral", False), ("raj", True)):
            seen = clients[who].get(_detail(workspace, ticket))
            assert seen.status_code == 200
            assert seen.json()["approval"]["note"] == "Not in this budget" and seen.json()["can_edit"] is edits
        assert clients["raj"].patch(_detail(workspace, ticket), {"name": "x"}, format="json").status_code == 200
        assert clients["hiral"].patch(_detail(workspace, ticket), {"name": "y"}, format="json").status_code == 403

    @pytest.mark.django_db
    def test_a_creator_who_is_the_manager_approves_it_at_once(self, clients, people, workspace, meta):
        ticket = _new_ticket(clients, people, workspace, meta, creator="manoj", manager="manoj")
        assert ticket["approval"]["status"] == "approved"
        assert clients["raj"].get(_detail(workspace, ticket)).status_code == 200

    @pytest.mark.django_db
    def test_a_waiting_ticket_leaves_the_decision_to_its_manager(self, clients, people, workspace, meta):
        ticket = _new_ticket(clients, people, workspace, meta)
        url = _detail(workspace, ticket)
        # the assignee works on it...
        working = clients["raj"].patch(url, {"state_id": _status_id(meta, "In Progress")}, format="json")
        assert working.status_code == 200
        # ...but can't approve it by status, or by making themselves its Manager
        for name in ("Approved", "Reject"):
            response = clients["raj"].patch(url, {"state_id": _status_id(meta, name)}, format="json")
            assert response.status_code == 400 and name in response.json()["state_id"][0]
        response = clients["raj"].patch(url, {"manager_id": str(people["raj"].id)}, format="json")
        assert response.status_code == 400 and "manager_id" in response.json()
        bulk = clients["raj"].patch(
            BASE.format(slug=workspace.slug) + "bulk-update/",
            {"ticket_ids": [ticket["id"]], "changes": {"state_id": _status_id(meta, "Approved")}},
            format="json",
        )
        assert bulk.status_code == 200 and bulk.json()["skipped"] == [ticket["id"]]
        row = Ticket.objects.get(id=ticket["id"])
        assert row.issue.state.name == "In Progress" and row.manager_id == people["manoj"].id
        assert row.approval_status == "pending"
        # once decided they're ordinary fields again
        assert _decide(clients, "manoj", workspace, ticket, "approve").status_code == 200
        assert clients["raj"].patch(url, {"manager_id": str(people["hiral"].id)}, format="json").status_code == 200

    @pytest.mark.django_db
    def test_a_new_ticket_cant_start_approved_or_rejected(self, clients, people, workspace, meta):
        payload = {
            "name": "Monitor",
            "assignee_id": str(people["raj"].id),
            "manager_id": str(people["manoj"].id),
            "state_id": _status_id(meta, "Approved"),
        }
        response = clients["hiral"].post(BASE.format(slug=workspace.slug), payload, format="json")
        assert response.status_code == 400 and "state_id" in response.json()
        # unless the creator is the Manager, who approves it at once
        response = clients["manoj"].post(BASE.format(slug=workspace.slug), payload, format="json")
        assert response.status_code == 201 and response.json()["approval"]["status"] == "approved"
