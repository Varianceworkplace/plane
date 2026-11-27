# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The lists every page load asks for, made cheap without changing what they hold.

* states/ (WorkspaceStatesEndpoint): the states of the person's projects, each state's "order" worked out within
  its project as the project's own list does; an ETag, and a 304 with no body while nothing that decides the list
  has changed;
* projects/ (ProjectViewSet.list): members see their projects and the public ones, guests only theirs; the pending
  intake count isn't multiplied by the project's memberships;
* projects/details/: each project's member ids as text, newest member first, active people only.
"""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Intake, IntakeIssue, Issue, Project, ProjectMember, State, User, WorkspaceMember


def _user(workspace, name, role=15, is_bot=False):
    uid = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{name}-{uid}@plane.so", username=f"{name}_{uid}", display_name=name, is_bot=is_bot
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _project(workspace, owner, identifier, network=2):
    return Project.objects.create(
        name=identifier.title(), identifier=identifier, workspace=workspace, created_by=owner, network=network
    )


def _states(project, *rows):
    return [
        State.objects.create(
            name=name, group=group, sequence=sequence, project=project, workspace=project.workspace, color="#000"
        )
        for name, group, sequence in rows
    ]


@pytest.fixture
def setup(db, workspace, create_user):
    member = _user(workspace, "member")
    mine = _project(workspace, create_user, "MINE", network=0)  # private, they're in it
    other = _project(workspace, create_user, "OTHER", network=0)  # private, they're not
    public = _project(workspace, create_user, "PUBLIC")  # public, they're not in it
    ProjectMember.objects.create(project=mine, member=member, role=15, is_active=True)
    for project in (mine, other, public):
        ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    states = {
        "mine": _states(mine, ("Todo", "unstarted", 10), ("Doing", "started", 20), ("Review", "started", 30)),
        "other": _states(other, ("Todo", "unstarted", 10)),
    }
    return {
        "workspace": workspace,
        "admin": create_user,
        "member": member,
        "projects": {"mine": mine, "other": other, "public": public},
        "states": states,
    }


def _get(setup, who, path, **headers):
    return _client(setup[who]).get(f"/api/workspaces/{setup['workspace'].slug}/{path}", **headers)


@pytest.mark.contract
class TestStates:
    def test_the_states_of_my_projects(self, setup):
        mine = setup["projects"]["mine"]
        triage = State.objects.create(
            name="Triage", group="triage", is_triage=True, project=mine, workspace=mine.workspace, color="#000"
        )
        response = _get(setup, "member", "states/")
        assert response.status_code == status.HTTP_200_OK
        rows = {row["id"]: row for row in response.json()}
        assert set(rows) == {str(state.id) for state in setup["states"]["mine"]}
        assert str(triage.id) not in rows
        doing, review = setup["states"]["mine"][1:]
        # its place among the project's states of its group, as the project's own state list gives it
        assert (rows[str(doing.id)]["order"], rows[str(review.id)]["order"]) == (0.5, 1.0)
        assert set(rows[str(doing.id)]) == {
            "id",
            "project_id",
            "workspace_id",
            "name",
            "color",
            "group",
            "default",
            "description",
            "sequence",
            "order",
        }
        project_list = _get(setup, "member", f"projects/{mine.id}/states/").json()
        assert {row["id"]: row["order"] for row in project_list} == {key: row["order"] for key, row in rows.items()}
        # an archived project's states drop out
        Project.objects.filter(pk=mine.pk).update(archived_at="2026-11-01T00:00:00Z")
        assert _get(setup, "member", "states/").json() == []

    def test_unchanged_states_answer_304(self, setup):
        first = _get(setup, "member", "states/")
        etag = first["ETag"]
        assert first["Cache-Control"] == "private, no-cache"
        for sent in (etag, f"W/{etag}", f'"something-else", {etag}'):
            again = _get(setup, "member", "states/", HTTP_IF_NONE_MATCH=sent)
            assert again.status_code == status.HTTP_304_NOT_MODIFIED, sent
            assert again.content == b"" and again["ETag"] == etag
        assert _get(setup, "member", "states/", HTTP_IF_NONE_MATCH='"stale"').status_code == status.HTTP_200_OK
        # another person has their own tag
        assert _get(setup, "admin", "states/", HTTP_IF_NONE_MATCH=etag).status_code == status.HTTP_200_OK

    def test_a_change_gives_a_new_tag(self, setup):
        def tag():
            return _get(setup, "member", "states/")["ETag"]

        seen = [tag()]
        todo = setup["states"]["mine"][0]
        todo.name = "To do"
        todo.save()
        seen.append(tag())
        _states(setup["projects"]["mine"], ("Done", "completed", 40))
        seen.append(tag())
        todo.delete()
        seen.append(tag())
        # joining a project brings its states
        ProjectMember.objects.create(project=setup["projects"]["other"], member=setup["member"], role=15)
        seen.append(tag())
        assert len(set(seen)) == len(seen)
        response = _get(setup, "member", "states/", HTTP_IF_NONE_MATCH=seen[-1])
        assert response.status_code == status.HTTP_304_NOT_MODIFIED


@pytest.mark.contract
class TestProjectList:
    def test_members_see_their_projects_and_the_public_ones(self, setup):
        names = {row["identifier"] for row in _get(setup, "member", "projects/").json()}
        assert names == {"MINE", "PUBLIC"}
        guest = _user(setup["workspace"], "guest", role=5)
        ProjectMember.objects.create(project=setup["projects"]["mine"], member=guest, role=5, is_active=True)
        assert {row["identifier"] for row in _get({**setup, "guest": guest}, "guest", "projects/").json()} == {"MINE"}
        # an inactive membership doesn't count
        ProjectMember.objects.filter(member=setup["member"]).update(is_active=False)
        assert {row["identifier"] for row in _get(setup, "member", "projects/").json()} == {"PUBLIC"}
        assert {row["identifier"] for row in _get(setup, "admin", "projects/").json()} == {"MINE", "OTHER", "PUBLIC"}

    def test_the_pending_intake_count_isnt_multiplied(self, setup):
        public = setup["projects"]["public"]
        for index in range(3):
            ProjectMember.objects.create(project=public, member=_user(setup["workspace"], f"p{index}"), role=15)
        ProjectMember.objects.create(project=public, member=setup["member"], role=15, is_active=True)
        intake = Intake.objects.create(name="Intake", project=public, workspace=public.workspace)
        for name, pending in (("one", True), ("two", True), ("taken", False)):
            issue = Issue.objects.create(name=name, project=public, workspace=public.workspace)
            IntakeIssue.objects.create(
                intake=intake, issue=issue, project=public, workspace=public.workspace, status=-2 if pending else 1
            )
        for who in ("member", "admin"):
            rows = {row["identifier"]: row for row in _get(setup, who, "projects/").json()}
            assert rows["PUBLIC"]["intake_count"] == 2, who


@pytest.mark.contract
class TestProjectDetails:
    def test_member_ids_newest_first(self, setup):
        mine = setup["projects"]["mine"]
        later = _user(setup["workspace"], "later")
        ProjectMember.objects.create(project=mine, member=later, role=15, is_active=True)
        gone = _user(setup["workspace"], "gone")
        ProjectMember.objects.create(project=mine, member=gone, role=15, is_active=False)
        bot = _user(setup["workspace"], "bot", is_bot=True)
        ProjectMember.objects.create(project=mine, member=bot, role=15, is_active=True)
        rows = {row["identifier"]: row for row in _get(setup, "admin", "projects/details/").json()}
        assert rows["MINE"]["members"] == [str(later.id), str(setup["admin"].id), str(setup["member"].id)]
        assert rows["PUBLIC"]["members"] == [str(setup["admin"].id)]
        empty = _project(setup["workspace"], setup["admin"], "EMPTY")
        ProjectMember.objects.create(project=empty, member=setup["admin"], role=20, is_active=False)
        rows = {row["identifier"]: row for row in _get(setup, "admin", "projects/details/").json()}
        assert "EMPTY" not in rows or rows["EMPTY"]["members"] == []
