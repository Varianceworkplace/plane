# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project names are unique in a workspace whatever their case (plane.utils.project_names).

* creating or renaming a project to a name another project has, in any case or with spaces around it, is refused
  with PROJECT_NAME_ALREADY_EXIST (the public API: 409, as for an exact repeat);
* archived projects keep their names, deleted ones free them, the helpdesk's ticket projects count;
* another workspace's names don't count; a project may change the case of its own name;
* saving a project under its unchanged name works even where an older project's name differs only in case.
"""

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import APIToken, Project, ProjectMember, Workspace, WorkspaceMember
from plane.utils.project_names import project_name_taken


def _url(workspace, project=None):
    base = f"/api/workspaces/{workspace.slug}/projects/"
    return f"{base}{project.id}/" if project else base


def _create(client, workspace, name, identifier):
    return client.post(_url(workspace), {"name": name, "identifier": identifier}, format="json")


def _refused(response):
    assert response.status_code == status.HTTP_400_BAD_REQUEST, response.content
    assert "PROJECT_NAME_ALREADY_EXIST" in response.json().get("name", [])


@pytest.mark.contract
class TestCreating:
    @pytest.mark.parametrize("name", ["variance crm", "VARIANCE CRM", "VaRiAnCe CrM", "  Variance CRM  "])
    def test_the_same_name_in_any_case_is_refused(self, session_client, workspace, name):
        Project.objects.create(name="Variance CRM", identifier="VCRM", workspace=workspace)
        _refused(_create(session_client, workspace, name, "VCRM2"))
        assert Project.objects.filter(workspace=workspace).count() == 1

    def test_a_different_name_is_fine(self, session_client, workspace):
        Project.objects.create(name="Variance CRM", identifier="VCRM", workspace=workspace)
        response = _create(session_client, workspace, "Variance CRM 2", "VCRM2")
        assert response.status_code == status.HTTP_201_CREATED, response.content

    def test_archived_deleted_and_ticket_projects(self, session_client, workspace):
        Project.objects.create(name="Old", identifier="OLD", workspace=workspace, archived_at=timezone.now())
        _refused(_create(session_client, workspace, "old", "OLD2"))
        gone = Project.objects.create(name="Gone", identifier="GONE", workspace=workspace)
        gone.delete()
        assert _create(session_client, workspace, "GONE", "GONE2").status_code == status.HTTP_201_CREATED
        Project.all_objects.create(name="Helpdesk", identifier="HELP", workspace=workspace, is_ticket_project=True)
        _refused(_create(session_client, workspace, "helpdesk", "HELP2"))

    def test_another_workspaces_names_dont_count(self, session_client, workspace, create_user):
        other = Workspace.objects.create(name="Other", owner=create_user, slug="other-names")
        Project.objects.create(name="Shared Name", identifier="SN", workspace=other)
        assert _create(session_client, workspace, "shared name", "SN").status_code == status.HTTP_201_CREATED
        assert project_name_taken(other.id, "SHARED NAME") and not project_name_taken(other.id, "")


@pytest.mark.contract
class TestRenaming:
    @pytest.fixture
    def projects(self, workspace, create_user):
        alpha = Project.objects.create(name="Alpha", identifier="ALPHA", workspace=workspace)
        beta = Project.objects.create(name="Beta", identifier="BETA", workspace=workspace)
        for project in (alpha, beta):
            ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
        return alpha, beta

    def test_to_another_projects_name_in_any_case(self, session_client, workspace, projects):
        alpha, beta = projects
        _refused(session_client.patch(_url(workspace, beta), {"name": "ALPHA"}, format="json"))
        _refused(session_client.patch(_url(workspace, beta), {"name": " alpha "}, format="json"))
        beta.refresh_from_db()
        assert beta.name == "Beta"

    def test_changing_the_case_of_its_own_name(self, session_client, workspace, projects):
        alpha, _ = projects
        response = session_client.patch(_url(workspace, alpha), {"name": "ALPHA"}, format="json")
        assert response.status_code == status.HTTP_200_OK, response.content
        alpha.refresh_from_db()
        assert alpha.name == "ALPHA"

    def test_an_older_near_duplicate_can_still_be_saved(self, session_client, workspace, create_user):
        Project.objects.create(name="Legacy", identifier="LEG1", workspace=workspace)
        older = Project.objects.create(name="LEGACY", identifier="LEG2", workspace=workspace)
        ProjectMember.objects.create(project=older, member=create_user, role=20, is_active=True)
        response = session_client.patch(
            _url(workspace, older), {"name": "LEGACY", "description": "still saves"}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        # but it can't take the other one's spelling
        _refused(session_client.patch(_url(workspace, older), {"name": "legacy"}, format="json"))


@pytest.mark.contract
class TestPublicApi:
    def test_the_same_rule_and_its_409(self, workspace, create_user):
        Project.objects.create(name="Variance CRM", identifier="VCRM", workspace=workspace)
        token = APIToken.objects.create(user=create_user, workspace=workspace, label="names")
        api = APIClient()
        api.credentials(HTTP_X_API_KEY=token.token)
        base = f"/api/v1/workspaces/{workspace.slug}/projects/"
        response = api.post(base, {"name": "variance crm", "identifier": "VCRM2"}, format="json")
        assert response.status_code == status.HTTP_409_CONFLICT, response.content
        assert response.json() == {"name": "The project name is already taken"}
        created = api.post(base, {"name": "Other", "identifier": "OTHER"}, format="json")
        assert created.status_code == status.HTTP_201_CREATED, created.content
        project_id = created.json()["id"]
        renamed = api.patch(f"{base}{project_id}/", {"name": "VARIANCE CRM"}, format="json")
        assert renamed.status_code == status.HTTP_409_CONFLICT, renamed.content
        assert api.patch(f"{base}{project_id}/", {"name": "OTHER"}, format="json").status_code == status.HTTP_200_OK
        assert WorkspaceMember.objects.filter(workspace=workspace, member=create_user).exists()
