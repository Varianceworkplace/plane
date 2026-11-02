# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Role-based access, step 3: work items through the API (plane.utils.work_item_visibility + plane.utils.rbac).

The workspace is the plan's example (see plane/tests/unit/utils/test_rbac_engine.py): PM A leads Team A (A1, A2),
PM B leads Team B (B1), both teams own the "Shared" project. With RBAC on:
  * lists and direct links follow the roles: a PM sees their team's work items, an employee only their own;
  * editing, deleting and creating are checked against the role, in the app and the public API, also in bulk;
  * with RBAC off nothing changes (only the assignee sees an assigned work item).
"""

import io
import zipfile

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.bgtasks.export_task import issue_export_task
from plane.db.models import ExporterHistory, Issue, ProjectMember
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)


@pytest.fixture
def rbac(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    # HR works in the shared project too (opening projects without being a member comes with step 4)
    ProjectMember.objects.create(
        workspace=org["workspace"], project=org["projects"]["shared"], member=org["people"]["hr"], role=15
    )
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return {**org, "clients": clients}


def _url(setup, project="shared"):
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{setup['projects'][project].id}/issues/"


def _listed(setup, who, project="shared"):
    response = setup["clients"][who].get(_url(setup, project))
    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()
    rows = body["results"] if isinstance(body, dict) else body
    if isinstance(rows, dict):  # grouped results
        rows = [issue for group in rows.values() for issue in group.get("results", [])]
    return {issue["name"] for issue in rows}


def _detail(setup, who, key):
    issue = setup["issues"][key]
    return setup["clients"][who].get(f"{_url(setup, _project_of(setup, issue))}{issue.id}/")


def _project_of(setup, issue):
    return next(key for key, project in setup["projects"].items() if project.id == issue.project_id)


def _issue_url(setup, key):
    issue = setup["issues"][key]
    return f"{_url(setup, _project_of(setup, issue))}{issue.id}/"


SHARED = {"Shared - A1", "Shared - B1", "Shared - unassigned", "Shared - loner"}


@pytest.mark.contract
class TestWhoSeesWhat:
    @pytest.mark.parametrize(
        "who, names",
        [
            ("hr", SHARED),
            ("pm_a", {"Shared - A1", "Shared - unassigned", "Shared - loner"}),
            ("pm_b", {"Shared - B1", "Shared - unassigned", "Shared - loner"}),
            ("a1", {"Shared - A1", "Shared - unassigned"}),
            ("b1", {"Shared - B1"}),
            ("loner", set()),  # no role: nothing, not even their own, until one is given
        ],
    )
    def test_lists_follow_the_roles(self, rbac, who, names):
        assert _listed(rbac, who) == names

    def test_direct_links_to_hidden_work_items_are_not_found(self, rbac):
        assert _detail(rbac, "pm_b", "shared_b1").status_code == status.HTTP_200_OK
        assert _detail(rbac, "pm_a", "shared_b1").status_code == status.HTTP_404_NOT_FOUND
        assert _detail(rbac, "a1", "shared_b1").status_code == status.HTTP_404_NOT_FOUND
        # PM A follows their team member into Team B's project
        assert _detail(rbac, "pm_b", "b_a1").status_code == status.HTTP_404_NOT_FOUND

    def test_with_rbac_off_only_the_assignee_sees_an_assigned_work_item(self, rbac):
        rbac["workspace"].is_rbac_enabled = False
        rbac["workspace"].save(update_fields=["is_rbac_enabled"])
        assert "Shared - A1" not in _listed(rbac, "pm_a")
        assert _detail(rbac, "pm_a", "shared_a1").status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
class TestChanges:
    def test_employees_edit_their_own_work_items(self, rbac):
        a1 = rbac["clients"]["a1"]
        assert a1.patch(_issue_url(rbac, "shared_a1"), {"priority": "high"}, format="json").status_code == 204
        assert a1.patch(_issue_url(rbac, "shared_new"), {"priority": "low"}, format="json").status_code == 204
        assert a1.patch(_issue_url(rbac, "shared_b1"), {"priority": "low"}, format="json").status_code == 404

    def test_pms_edit_their_teams_work_items(self, rbac):
        response = rbac["clients"]["pm_a"].patch(_issue_url(rbac, "shared_a1"), {"priority": "urgent"}, format="json")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert Issue.all_objects.get(pk=rbac["issues"]["shared_a1"].pk).priority == "urgent"

    def test_employees_cannot_delete_but_pms_can(self, rbac):
        response = rbac["clients"]["a1"].delete(_issue_url(rbac, "shared_a1"))
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Issue.objects.filter(pk=rbac["issues"]["shared_a1"].pk).exists()
        response = rbac["clients"]["pm_a"].delete(_issue_url(rbac, "shared_a1"))
        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_bulk_delete_needs_every_work_item_in_scope(self, rbac):
        url = f"/api/workspaces/{rbac['workspace'].slug}/projects/{rbac['projects']['shared'].id}/bulk-delete-issues/"
        ids = [str(rbac["issues"]["shared_a1"].id), str(rbac["issues"]["shared_b1"].id)]
        response = rbac["clients"]["pm_a"].delete(url, {"issue_ids": ids}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Issue.objects.filter(pk__in=ids).count() == 2

    def test_creating_follows_the_role(self, rbac):
        a1 = rbac["clients"]["a1"]
        response = a1.post(_url(rbac, "a"), {"name": "New from A1"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        # take "create" away from employees: refused, nothing created
        rbac["roles"]["employee"].permissions.filter(module="work_items", action="create").delete(soft=False)
        response = a1.post(_url(rbac, "a"), {"name": "Not allowed"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Issue.objects.filter(name="Not allowed").exists()

    def test_public_api_follows_the_roles(self, rbac):
        slug, shared = rbac["workspace"].slug, rbac["projects"]["shared"].id
        base = f"/api/v1/workspaces/{slug}/projects/{shared}/work-items/"
        a1 = rbac["clients"]["a1"]
        assert a1.get(f"{base}{rbac['issues']['shared_b1'].id}/").status_code == status.HTTP_404_NOT_FOUND
        assert a1.delete(f"{base}{rbac['issues']['shared_a1'].id}/").status_code == status.HTTP_403_FORBIDDEN
        assert Issue.objects.filter(pk=rbac["issues"]["shared_a1"].pk).exists()


@pytest.mark.contract
def test_exports_follow_the_roles(rbac, mocker):
    exporter = ExporterHistory.objects.create(
        workspace=rbac["workspace"],
        project=[rbac["projects"]["shared"].id],
        provider="csv",
        initiated_by=rbac["people"]["pm_a"],
    )
    upload = mocker.patch("plane.bgtasks.export_task.upload_to_s3")
    issue_export_task(
        provider="csv",
        workspace_id=rbac["workspace"].id,
        project_ids=[str(rbac["projects"]["shared"].id)],
        token_id=exporter.token,
        multiple=False,
        slug=rbac["workspace"].slug,
    )
    with zipfile.ZipFile(io.BytesIO(upload.call_args[0][0].getvalue())) as archive:
        content = "".join(archive.read(name).decode() for name in archive.namelist())
    assert "Shared - A1" in content and "Shared - loner" in content
    assert "Shared - B1" not in content
