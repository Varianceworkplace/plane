# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for project details (plane.app.views.project_detail and the app's project create).

Rules under test:
  * a create that sends `project_details` must fill in every required field and pick a lead ("Assigned To");
    nothing is created when one is missing
  * a create without `project_details` works as before
  * everyone in the project reads the details; only project admins edit them; outsiders get nothing
  * picklists, progress, dates and hours only accept valid values; required fields can't be cleared
"""

from decimal import Decimal
from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Project, ProjectDetail, ProjectMember, User, WorkspaceMember

VALID_DETAILS = {
    "start_date": "2026-11-02",
    "target_end_date": "2026-12-31",
    "actual_end_date": None,
    "estimated_hours": "120.5",
    "project_type": "Fix contract",
    "status": "initiated",
    "related_to": "Verbix Inc",
    "customer_name": "John Carter",
    "user_manual_url": "https://docs.example.com/verbix",
    "salesforce_org_id": "00D5g000004XYZ",
    "project_url": "https://verbix.example.com",
    "progress": 20,
}


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
        "admin": create_user,
        "member": _user(workspace, "Hiral"),
        "lead": _user(workspace, "Vijay"),
        "guest": _user(workspace, "Guest", role=5),
        "outsider": _user(workspace, "Outsider"),
    }
    project = Project.objects.create(name="Verbix", identifier="VERBIX", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=people["admin"], role=20, is_active=True)
    ProjectMember.objects.create(project=project, member=people["member"], role=15, is_active=True)
    ProjectMember.objects.create(project=project, member=people["guest"], role=5, is_active=True)
    return {
        "workspace": workspace,
        "people": people,
        "clients": {name: _client(user) for name, user in people.items()},
        "project": project,
    }


def _create_url(workspace):
    return f"/api/workspaces/{workspace.slug}/projects/"


def _detail_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/project-detail/"


@pytest.mark.contract
class TestCreateProjectWithDetails:
    def _payload(self, setup, **details):
        return {
            "name": "Verbix-ai",
            "identifier": "VAI",
            "network": 2,
            "project_lead": str(setup["people"]["lead"].id),
            "project_details": {**VALID_DETAILS, **details},
        }

    def test_create_saves_every_field(self, setup):
        response = setup["clients"]["admin"].post(_create_url(setup["workspace"]), self._payload(setup), format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        project = Project.objects.get(pk=response.data["id"])
        assert str(project.project_lead_id) == str(setup["people"]["lead"].id)
        detail = ProjectDetail.objects.get(project=project)
        assert str(detail.start_date) == "2026-11-02"
        assert str(detail.target_end_date) == "2026-12-31"
        assert detail.actual_end_date is None
        assert detail.estimated_hours == Decimal("120.50")
        assert detail.project_type == "Fix contract"
        assert detail.status == "initiated"
        assert detail.related_to == "Verbix Inc"
        assert detail.customer_name == "John Carter"
        assert detail.user_manual_url == "https://docs.example.com/verbix"
        assert detail.salesforce_org_id == "00D5g000004XYZ"
        assert detail.project_url == "https://verbix.example.com"
        assert detail.progress == 20
        assert detail.workspace_id == setup["workspace"].id

    @pytest.mark.parametrize(
        "field", ["start_date", "target_end_date", "project_type", "status", "customer_name", "user_manual_url"]
    )
    def test_each_required_field_is_checked(self, setup, field):
        payload = self._payload(setup)
        del payload["project_details"][field]
        response = setup["clients"]["admin"].post(_create_url(setup["workspace"]), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert field in response.data["project_details"]
        assert not Project.objects.filter(identifier="VAI").exists()

    def test_blank_required_text_is_rejected(self, setup):
        payload = self._payload(setup, customer_name="   ")
        response = setup["clients"]["admin"].post(_create_url(setup["workspace"]), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "customer_name" in response.data["project_details"]

    def test_assigned_to_is_required(self, setup):
        payload = self._payload(setup)
        payload["project_lead"] = None
        response = setup["clients"]["admin"].post(_create_url(setup["workspace"]), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "project_lead" in response.data["project_details"]
        assert not Project.objects.filter(identifier="VAI").exists()

    def test_invalid_values_are_rejected(self, setup):
        payload = self._payload(
            setup,
            project_type="Retainer",
            status="done",
            progress=15,
            estimated_hours="lots",
            target_end_date="2026-10-01",
        )
        response = setup["clients"]["admin"].post(_create_url(setup["workspace"]), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        errors = response.data["project_details"]
        assert {"project_type", "status", "progress", "estimated_hours", "target_end_date"} <= set(errors)

    def test_failure_part_way_leaves_no_project_behind(self, setup, mocker):
        # a half-made project would block its identifier, so the next try says "identifier already taken"
        mocker.patch.object(ProjectDetail.objects, "create", side_effect=RuntimeError("boom"))
        response = setup["clients"]["admin"].post(_create_url(setup["workspace"]), self._payload(setup), format="json")
        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert not Project.all_objects.filter(identifier="VAI").exists()

        mocker.stopall()
        retry = setup["clients"]["admin"].post(_create_url(setup["workspace"]), self._payload(setup), format="json")
        assert retry.status_code == status.HTTP_201_CREATED, retry.data

    def test_create_without_details_still_works(self, setup):
        response = setup["clients"]["admin"].post(
            _create_url(setup["workspace"]), {"name": "Plain", "identifier": "PLN", "network": 2}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert not ProjectDetail.objects.filter(project_id=response.data["id"]).exists()


@pytest.mark.contract
class TestProjectDetailEndpoint:
    def test_read_before_anything_is_saved(self, setup):
        response = setup["clients"]["member"].get(_detail_url(setup["workspace"], setup["project"]))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["status"] == ""
        assert response.data["start_date"] is None
        assert response.data["estimated_hours"] is None

    def test_admin_saves_and_everyone_in_the_project_reads(self, setup):
        url = _detail_url(setup["workspace"], setup["project"])
        response = setup["clients"]["admin"].patch(url, VALID_DETAILS, format="json")
        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["estimated_hours"] == 120.5
        for name in ("member", "guest"):
            read = setup["clients"][name].get(url)
            assert read.status_code == status.HTTP_200_OK
            assert read.data["customer_name"] == "John Carter"
            assert read.data["start_date"] == "2026-11-02"

    @pytest.mark.parametrize("name", ["member", "guest", "outsider"])
    def test_only_project_admins_edit(self, setup, name):
        response = setup["clients"][name].patch(
            _detail_url(setup["workspace"], setup["project"]), {"status": "on hold"}, format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not ProjectDetail.objects.filter(project=setup["project"]).exists()

    def test_outsider_cannot_read(self, setup):
        response = setup["clients"]["outsider"].get(_detail_url(setup["workspace"], setup["project"]))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_partial_update_keeps_other_fields(self, setup):
        url = _detail_url(setup["workspace"], setup["project"])
        setup["clients"]["admin"].patch(url, VALID_DETAILS, format="json")
        response = setup["clients"]["admin"].patch(
            url, {"status": "completed", "actual_end_date": "2026-12-20", "progress": 100}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        detail = ProjectDetail.objects.get(project=setup["project"])
        assert detail.status == "completed"
        assert str(detail.actual_end_date) == "2026-12-20"
        assert detail.progress == 100
        assert detail.customer_name == "John Carter"

    def test_required_fields_cannot_be_cleared(self, setup):
        url = _detail_url(setup["workspace"], setup["project"])
        setup["clients"]["admin"].patch(url, VALID_DETAILS, format="json")
        response = setup["clients"]["admin"].patch(url, {"status": "", "start_date": None}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert {"status", "start_date"} <= set(response.data)
        assert ProjectDetail.objects.get(project=setup["project"]).status == "initiated"

    def test_end_dates_are_checked_against_the_saved_start(self, setup):
        url = _detail_url(setup["workspace"], setup["project"])
        setup["clients"]["admin"].patch(url, VALID_DETAILS, format="json")
        response = setup["clients"]["admin"].patch(url, {"actual_end_date": "2026-10-01"}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "actual_end_date" in response.data

    @pytest.mark.parametrize(
        "payload",
        [
            {"estimated_hours": -1},
            {"estimated_hours": "NaN"},
            {"estimated_hours": True},
            {"progress": 0},
            {"start_date": "02/11/2026"},
            {"customer_name": 42},
            {"related_to": "x" * 256},
        ],
    )
    def test_invalid_values(self, setup, payload):
        response = setup["clients"]["admin"].patch(
            _detail_url(setup["workspace"], setup["project"]), payload, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert set(payload) <= set(response.data)

    def test_archived_project_cannot_be_edited(self, setup):
        from django.utils import timezone

        setup["project"].archived_at = timezone.now()
        setup["project"].save()
        response = setup["clients"]["admin"].patch(
            _detail_url(setup["workspace"], setup["project"]), {"status": "on hold"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_options_list_the_picklists(self, setup):
        response = setup["clients"]["guest"].get(f"/api/workspaces/{setup['workspace'].slug}/project-detail-options/")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["project_type"] == ["Time & Material (Hourly)", "Dedicated Developer", "Fix contract"]
        assert "waiting for feedback" in response.data["status"]
        assert response.data["progress"][0] == 10
