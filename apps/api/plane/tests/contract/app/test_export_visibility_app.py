# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Exports only contain what the person who asked for them can see (plane.bgtasks export tasks).

Rules under test:
  * the work item export runs as the person who started it: work items hidden from them in the app are left out
  * the analytics export counts only their projects and, within them, the work items visible to them
  * nobody to run as (left the workspace, or no person sent) means no file / no email rather than everything
  * admins and members still get everything they can see
"""

import io
import zipfile
from uuid import uuid4

import pytest

from plane.bgtasks.analytic_plot_export import analytic_export_task
from plane.bgtasks.export_task import issue_export_task
from plane.db.models import (
    ExporterHistory,
    Issue,
    IssueAssignee,
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


def _issue(project, name, assignee=None, created_by=None):
    issue = Issue.objects.create(
        name=name,
        workspace=project.workspace,
        project=project,
        state=State.objects.filter(project=project).first(),
        priority="high",
        created_by=created_by,
    )
    if assignee:
        IssueAssignee.objects.create(issue=issue, assignee=assignee, project=project)
    return issue


@pytest.fixture
def setup(db, workspace, create_user):
    people = {"admin": create_user, "alice": _user(workspace, "Alice"), "bob": _user(workspace, "Bob")}
    shared = Project.objects.create(name="Shared", identifier="SHARED", workspace=workspace, created_by=create_user)
    private = Project.objects.create(name="Private", identifier="PRIV", workspace=workspace, created_by=create_user)
    for project in (shared, private):
        State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    for name in ("admin", "alice", "bob"):
        ProjectMember.objects.create(project=shared, member=people[name], role=20 if name == "admin" else 15)
    # only Bob is in the private project
    ProjectMember.objects.create(project=private, member=people["bob"], role=15)
    _issue(shared, "Alice task", assignee=people["alice"])
    _issue(shared, "Bob task", assignee=people["bob"])
    _issue(private, "Private task", assignee=people["bob"])
    return {"workspace": workspace, "people": people, "shared": shared, "private": private}


def _run_issue_export(setup, user, mocker):
    """Runs the work item export as `user` and returns (exporter, names in the file or None)."""
    exporter = ExporterHistory.objects.create(
        workspace=setup["workspace"],
        project=[setup["shared"].id, setup["private"].id],
        provider="csv",
        initiated_by=user,
    )
    upload = mocker.patch("plane.bgtasks.export_task.upload_to_s3")
    issue_export_task(
        provider="csv",
        workspace_id=setup["workspace"].id,
        project_ids=[str(setup["shared"].id), str(setup["private"].id)],
        token_id=exporter.token,
        multiple=False,
        slug=setup["workspace"].slug,
    )
    exporter.refresh_from_db()
    if not upload.called:
        return exporter, None
    zip_buffer = upload.call_args[0][0]
    with zipfile.ZipFile(io.BytesIO(zip_buffer.getvalue())) as archive:
        content = "".join(archive.read(name).decode() for name in archive.namelist())
    return exporter, {name for name in ("Alice task", "Bob task", "Private task") if name in content}


def _run_analytics_export(setup, user_id, mocker):
    """Runs the analytics export (work items per priority) and returns the total count, or None if no email."""
    send = mocker.patch("plane.bgtasks.analytic_plot_export.send_export_email")
    analytic_export_task(
        email="someone@plane.so",
        data={"x_axis": "priority", "y_axis": "issue_count"},
        slug=setup["workspace"].slug,
        user_id=user_id,
    )
    if not send.called:
        return None
    rows = send.call_args[0][3]
    return sum(row[1] for row in rows if isinstance(row[1], int))


@pytest.mark.contract
class TestWorkItemExport:
    def test_leaves_out_work_items_hidden_from_the_exporter(self, setup, mocker):
        exporter, names = _run_issue_export(setup, setup["people"]["alice"], mocker)
        # Bob's task is private to Bob; the private project isn't Alice's at all
        assert names == {"Alice task"}
        assert exporter.status != "failed"

    def test_member_of_both_projects_gets_what_they_see(self, setup, mocker):
        _, names = _run_issue_export(setup, setup["people"]["bob"], mocker)
        assert names == {"Bob task", "Private task"}

    def test_no_file_when_the_exporter_left_the_workspace(self, setup, mocker):
        WorkspaceMember.objects.filter(member=setup["people"]["alice"]).update(is_active=False)
        exporter, names = _run_issue_export(setup, setup["people"]["alice"], mocker)
        assert names is None
        assert exporter.status == "failed"
        assert "no longer a member" in exporter.reason


@pytest.mark.contract
class TestAnalyticsExport:
    def test_counts_only_the_requesters_visible_work_items(self, setup, mocker):
        # Alice: her own task only (Bob's is private to him, the private project isn't hers)
        assert _run_analytics_export(setup, str(setup["people"]["alice"].id), mocker) == 1

    def test_counts_every_project_the_requester_is_in(self, setup, mocker):
        assert _run_analytics_export(setup, str(setup["people"]["bob"].id), mocker) == 2

    def test_private_project_left_out_even_for_admins_outside_it(self, setup, mocker):
        # A workspace admin sees unassigned work items everywhere, but the export only covers projects they're in:
        # the unassigned one in the shared project counts, the one in the private project doesn't. (The assigned
        # tasks are private to their assignees.)
        _issue(setup["shared"], "Shared backlog")
        _issue(setup["private"], "Private backlog")
        assert _run_analytics_export(setup, str(setup["people"]["admin"].id), mocker) == 1

    @pytest.mark.parametrize("who", ["nobody", "left", "unknown"])
    def test_no_email_without_a_member_to_run_as(self, setup, mocker, who):
        user_id = {
            "nobody": None,
            "left": str(setup["people"]["alice"].id),
            "unknown": str(uuid4()),
        }[who]
        if who == "left":
            WorkspaceMember.objects.filter(member=setup["people"]["alice"]).update(is_active=False)
        assert _run_analytics_export(setup, user_id, mocker) is None
