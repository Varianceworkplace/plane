# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for time tracking (plane.app.views.worklog).

Rules under test:
  * time can be logged only when the project has time tracking turned on
  * project admins and members can log time; guests and non-members cannot
  * an entry needs its start and end (date and time) and a note; the time defaults to the gap, never more
  * a worklog can be changed by the member who logged it, a project admin or a workspace admin
  * only workspace admins can list / download all worklogs (Settings > Worklogs)
  * ticket work items stay unreachable
  * start / stop timer: one per member, stop freezes the end time, saving needs a note
  * Discard on the save dialog resumes the timer from the time it had; the stopped time doesn't count
  * timers can't be deleted: a stopped timer is saved with a note, or Discard takes the Stop back
"""

import io
from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueWorkLog,
    IssueWorkLogTimer,
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
        last_name="Test",
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


def _project(workspace, owner, name, identifier, enabled=True):
    project = Project.objects.create(
        name=name,
        identifier=identifier,
        workspace=workspace,
        created_by=owner,
        is_time_tracking_enabled=enabled,
    )
    state = State.objects.create(name="Todo", project=project, workspace=workspace, group="backlog", default=True)
    issue = Issue.objects.create(name=f"{name} task", workspace=workspace, project=project, state=state)
    return project, issue


@pytest.fixture
def setup(db, workspace, create_user):
    people = {
        "admin": create_user,  # workspace admin
        "member": _user(workspace, "Hiral"),
        "other": _user(workspace, "Vijay"),
        "guest": _user(workspace, "Guest", role=5),
        "outsider": _user(workspace, "Outsider"),
    }
    project, issue = _project(workspace, create_user, "Power Layout", "POWER")
    off_project, off_issue = _project(workspace, create_user, "No Tracking", "NOTRK", enabled=False)
    for proj in (project, off_project):
        ProjectMember.objects.create(project=proj, member=people["admin"], role=20, is_active=True)
        ProjectMember.objects.create(project=proj, member=people["member"], role=15, is_active=True)
        ProjectMember.objects.create(project=proj, member=people["other"], role=15, is_active=True)
        ProjectMember.objects.create(project=proj, member=people["guest"], role=5, is_active=True)
    _assign([issue, off_issue], people.values())
    return {
        "workspace": workspace,
        "people": people,
        "clients": {name: _client(user) for name, user in people.items()},
        "project": project,
        "issue": issue,
        "off_project": off_project,
        "off_issue": off_issue,
    }


def _url(setup, project=None, issue=None, worklog_id=None):
    project = project or setup["project"]
    issue = issue or setup["issue"]
    url = f"/api/workspaces/{setup['workspace'].slug}/projects/{project.id}/issues/{issue.id}/worklogs/"
    return f"{url}{worklog_id}/" if worklog_id else url


def _times(minutes, days_ago=0):
    """started_at / ended_at for `minutes` of work that finished an hour (plus `days_ago`) ago."""
    ended = timezone.now() - timedelta(days=days_ago, hours=1)
    return {"started_at": (ended - timedelta(minutes=minutes)).isoformat(), "ended_at": ended.isoformat()}


def _log(setup, who="member", duration=90, description="create zip", **extra):
    payload = {"duration": duration, "description": description, **_times(duration), **extra}
    response = setup["clients"][who].post(_url(setup), payload, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    return response.json()


# ---------------------------------------------------------------- logging time


@pytest.mark.contract
def test_member_logs_time(setup):
    worklog = _log(setup)
    assert worklog["duration"] == 90
    assert worklog["description"] == "create zip"
    assert worklog["logged_by"]["id"] == str(setup["people"]["member"].id)
    assert worklog["issue"]["id"] == str(setup["issue"].id)
    assert worklog["project"]["identifier"] == "POWER"
    assert worklog["started_at"] and worklog["ended_at"]

    response = setup["clients"]["guest"].get(_url(setup))
    assert response.status_code == status.HTTP_200_OK
    assert [w["id"] for w in response.json()] == [worklog["id"]]


@pytest.mark.contract
def test_cannot_log_when_time_tracking_is_off(setup):
    response = setup["clients"]["member"].post(
        _url(setup, setup["off_project"], setup["off_issue"]), {"duration": 30}, format="json"
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert not IssueWorkLog.objects.filter(issue=setup["off_issue"]).exists()


@pytest.mark.contract
@pytest.mark.parametrize("duration", [0, -5, "abc", None, 999 * 60 + 60])
def test_invalid_duration_is_rejected(setup, duration):
    response = setup["clients"]["member"].post(_url(setup), {"duration": duration}, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "duration" in response.json()


@pytest.mark.contract
def test_time_defaults_to_the_gap_between_start_and_end(setup):
    times = _times(210)
    response = setup["clients"]["member"].post(_url(setup), {"description": "Design review", **times}, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    worklog = response.json()
    assert worklog["duration"] == 210
    stored = IssueWorkLog.objects.get(pk=worklog["id"])
    assert stored.ended_at - stored.started_at == timedelta(minutes=210)


@pytest.mark.contract
def test_multi_day_entry_can_log_less_than_the_span(setup):
    # Oct 27 09:00 -> Oct 31 18:00 is 105h; only 45h 5m was actual work
    ended = (timezone.now() - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
    started = (ended - timedelta(days=4)).replace(hour=9)
    worklog = _log(setup, duration=45 * 60 + 5, started_at=started.isoformat(), ended_at=ended.isoformat())
    assert worklog["duration"] == 2705


@pytest.mark.contract
@pytest.mark.parametrize(
    "change, field",
    [
        ({"started_at": None}, "started_at"),
        ({"ended_at": None}, "ended_at"),
        ({"started_at": "2026-03-10T09:00:00"}, "started_at"),  # no timezone offset
        ({"started_at": "yesterday"}, "started_at"),
        ({"description": "   "}, "description"),
        ({"description": None}, "description"),
        ({"duration": 91}, "duration"),  # more than the 90 minute span
    ],
)
def test_start_end_and_note_are_required(setup, change, field):
    payload = {"duration": 90, "description": "work", **_times(90), **change}
    response = setup["clients"]["member"].post(_url(setup), payload, format="json")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert field in response.json()
    assert not IssueWorkLog.objects.filter(issue=setup["issue"]).exists()


@pytest.mark.contract
def test_end_must_be_after_start_and_not_in_the_future(setup):
    client = setup["clients"]["member"]
    now = timezone.now()
    backwards = {"description": "x", "started_at": now.isoformat(), "ended_at": (now - timedelta(hours=1)).isoformat()}
    response = client.post(_url(setup), backwards, format="json")
    assert response.status_code == 400 and "ended_at" in response.json()

    future = {
        "description": "x",
        "started_at": now.isoformat(),
        "ended_at": (now + timedelta(hours=2)).isoformat(),
    }
    response = client.post(_url(setup), future, format="json")
    assert response.status_code == 400 and "ended_at" in response.json()


@pytest.mark.contract
def test_edit_start_and_end(setup):
    worklog = _log(setup, duration=60)
    client = setup["clients"]["member"]
    times = _times(150, days_ago=2)
    response = client.patch(_url(setup, worklog_id=worklog["id"]), {**times, "duration": 120}, format="json")
    assert response.status_code == status.HTTP_200_OK, response.content
    stored = IssueWorkLog.objects.get(pk=worklog["id"])
    assert stored.duration == 120
    assert stored.ended_at - stored.started_at == timedelta(minutes=150)  # a break: end stays where it was set

    # the kept total can't exceed a shorter new span
    response = client.patch(_url(setup, worklog_id=worklog["id"]), _times(30), format="json")
    assert response.status_code == 400 and "duration" in response.json()
    # and the note can't be blanked
    response = client.patch(_url(setup, worklog_id=worklog["id"]), {"description": ""}, format="json")
    assert response.status_code == 400 and "description" in response.json()


@pytest.mark.contract
@pytest.mark.parametrize("who", ["guest", "outsider"])
def test_guests_and_non_members_cannot_log(setup, who):
    response = setup["clients"][who].post(_url(setup), {"duration": 30}, format="json")
    assert response.status_code == status.HTTP_403_FORBIDDEN


# ---------------------------------------------------------------- edit / delete


@pytest.mark.contract
def test_owner_can_edit_and_delete_own_worklog(setup):
    worklog = _log(setup)
    client = setup["clients"]["member"]
    response = client.patch(_url(setup, worklog_id=worklog["id"]), {"duration": 135}, format="json")
    assert response.status_code == status.HTTP_200_OK
    assert response.json()["duration"] == 135
    assert response.json()["description"] == "create zip"

    response = client.delete(_url(setup, worklog_id=worklog["id"]))
    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert client.get(_url(setup)).json() == []


@pytest.mark.contract
def test_other_member_cannot_change_someone_elses_worklog(setup):
    worklog = _log(setup)
    client = setup["clients"]["other"]
    assert client.patch(_url(setup, worklog_id=worklog["id"]), {"duration": 5}, format="json").status_code == 403
    assert client.delete(_url(setup, worklog_id=worklog["id"])).status_code == 403
    assert IssueWorkLog.objects.get(pk=worklog["id"]).duration == 90


@pytest.mark.contract
def test_admin_can_change_any_worklog(setup):
    worklog = _log(setup)
    client = setup["clients"]["admin"]
    assert client.patch(_url(setup, worklog_id=worklog["id"]), {"duration": 60}, format="json").status_code == 200
    assert client.delete(_url(setup, worklog_id=worklog["id"])).status_code == 204


# ---------------------------------------------------------------- workspace worklogs (settings)


def _ws_url(setup, suffix=""):
    return f"/api/workspaces/{setup['workspace'].slug}/worklogs/{suffix}"


@pytest.mark.contract
def test_only_workspace_admin_sees_all_worklogs(setup):
    _log(setup)
    assert setup["clients"]["member"].get(_ws_url(setup)).status_code == status.HTTP_403_FORBIDDEN
    assert setup["clients"]["member"].get(_ws_url(setup, "download/")).status_code == status.HTTP_403_FORBIDDEN

    response = setup["clients"]["admin"].get(_ws_url(setup))
    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["total_count"] == 1
    assert body["total_duration"] == 90


@pytest.mark.contract
def test_workspace_worklog_filters(setup):
    mine = _log(setup, "member", 90)
    _log(setup, "other", 30)
    old = IssueWorkLog.objects.get(pk=mine["id"])
    old.started_at -= timedelta(days=40)
    old.ended_at -= timedelta(days=40)
    old.save(update_fields=["started_at", "ended_at"])

    client = setup["clients"]["admin"]
    by_user = client.get(_ws_url(setup), {"logged_by": str(setup["people"]["member"].id)}).json()
    assert [w["id"] for w in by_user["results"]] == [mine["id"]]

    start = (timezone.now() - timedelta(days=7)).isoformat()
    recent = client.get(_ws_url(setup), {"start": start}).json()
    assert recent["total_count"] == 1
    assert recent["total_duration"] == 30

    other_project = client.get(_ws_url(setup), {"project": str(setup["off_project"].id)}).json()
    assert other_project["total_count"] == 0


@pytest.mark.contract
def test_download_csv_and_xlsx(setup):
    logged = _log(setup, "member", 630, "=HYPERLINK(evil)")
    client = setup["clients"]["admin"]

    response = client.get(_ws_url(setup, "download/"), {"type": "csv"})
    assert response.status_code == status.HTTP_200_OK
    assert response["Content-Type"].startswith("text/csv")
    text = response.content.decode()
    assert "Timesheet No.,Project,Work item ID,Work item,Logged by,Email,Date,Start time,End time,Time" in text
    assert f"{logged['timesheet_no']},Power Layout," in text
    assert "POWER-" in text and "10h 30m" in text and "10.5" in text
    assert "'=HYPERLINK(evil)" in text  # formula injection neutralised

    response = client.get(_ws_url(setup, "download/"), {"type": "xlsx"})
    assert response.status_code == status.HTTP_200_OK
    sheet = load_workbook(io.BytesIO(response.content)).active
    rows = list(sheet.iter_rows(values_only=True))
    assert rows[0][:2] == ("Timesheet No.", "Project")
    assert rows[1][0] == logged["timesheet_no"]
    assert rows[1][1] == "Power Layout" and rows[1][10] == 630
    assert rows[1][7] and rows[1][8]  # start / end times

    assert client.get(_ws_url(setup, "download/"), {"type": "pdf"}).status_code == 400


# ---------------------------------------------------------------- project flag and ticket isolation


@pytest.mark.contract
def test_project_list_exposes_time_tracking_flag(setup):
    response = setup["clients"]["admin"].get(f"/api/workspaces/{setup['workspace'].slug}/projects/")
    assert response.status_code == status.HTTP_200_OK
    projects = {p["identifier"]: p for p in response.json()}
    assert projects["POWER"]["is_time_tracking_enabled"] is True
    assert projects["NOTRK"]["is_time_tracking_enabled"] is False


@pytest.mark.contract
def test_ticket_work_items_are_unreachable(setup):
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
    assert ticket.status_code == status.HTTP_201_CREATED, ticket.content
    ticket_issue = Issue.all_objects.get(pk=ticket.json()["issue_id"])
    ticket_project = Project.all_objects.get(pk=ticket_issue.project_id)
    ticket_project.is_time_tracking_enabled = True
    ticket_project.save(update_fields=["is_time_tracking_enabled"])

    url = _url(setup, ticket_project, ticket_issue)
    assert client.post(url, {"duration": 30}, format="json").status_code == status.HTTP_404_NOT_FOUND
    assert client.get(url).status_code == status.HTTP_404_NOT_FOUND
    assert not IssueWorkLog.objects.filter(issue_id=ticket_issue.id).exists()


# ---------------------------------------------------------------- start / stop timer


def _timer_url(setup, suffix=""):
    return f"/api/workspaces/{setup['workspace'].slug}/worklog-timer/{suffix}"


def _start_url(setup, project=None, issue=None):
    project = project or setup["project"]
    issue = issue or setup["issue"]
    return f"/api/workspaces/{setup['workspace'].slug}/projects/{project.id}/issues/{issue.id}/worklog-timer/"


@pytest.mark.contract
def test_timer_start_stop_save_creates_worklog_with_times(setup):
    client = setup["clients"]["member"]
    assert client.get(_timer_url(setup)).json() == {"timer": None}

    response = client.post(_start_url(setup))
    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert response.json()["is_running"] is True
    assert response.json()["issue"]["id"] == str(setup["issue"].id)

    # pretend the member worked 1h 25m 40s
    timer = IssueWorkLogTimer.objects.get(user=setup["people"]["member"])
    timer.started_at = timezone.now() - timedelta(hours=1, minutes=25, seconds=40)
    timer.save(update_fields=["started_at"])

    stopped = client.post(_timer_url(setup, "stop/"))
    assert stopped.status_code == status.HTTP_200_OK
    body = stopped.json()
    assert body["is_running"] is False and body["stopped_at"]
    assert abs(body["duration"] - (85 + 40 / 60)) < 0.05  # 85m 40s, to the second (not rounded to minutes)

    # stopping again keeps the first end time
    assert client.post(_timer_url(setup, "stop/")).json()["stopped_at"] == body["stopped_at"]

    assert client.post(_timer_url(setup, "save/"), {"description": "  "}, format="json").status_code == 400

    # how the task is left is required too: On Hold or Completed
    missing = client.post(_timer_url(setup, "save/"), {"description": "Fixed language files"}, format="json")
    assert missing.status_code == 400 and "status" in missing.json()
    saved = client.post(
        _timer_url(setup, "save/"), {"description": "Fixed language files", "status": "on_hold"}, format="json"
    )
    assert saved.status_code == status.HTTP_201_CREATED, saved.content
    worklog = saved.json()
    assert abs(worklog["duration"] - (85 + 40 / 60)) < 0.05
    assert worklog["description"] == "Fixed language files"
    assert worklog["started_at"] and worklog["ended_at"]
    assert client.get(_timer_url(setup)).json() == {"timer": None}

    stored = IssueWorkLog.objects.get(pk=worklog["id"])
    # the end time is the moment Stop was pressed, not when the note was saved
    assert abs((stored.ended_at - stored.started_at).total_seconds() - (85 * 60 + 40)) < 5


@pytest.mark.contract
def test_only_one_timer_per_member(setup):
    client = setup["clients"]["member"]
    assert client.post(_start_url(setup)).status_code == 201
    second_issue = Issue.objects.create(
        name="Second", workspace=setup["workspace"], project=setup["project"], state=setup["issue"].state
    )
    _assign([second_issue], [setup["people"]["member"], setup["people"]["other"]])
    response = client.post(_start_url(setup, issue=second_issue))
    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["timer"]["issue"]["id"] == str(setup["issue"].id)

    # someone else can still run their own timer
    assert setup["clients"]["other"].post(_start_url(setup, issue=second_issue)).status_code == 201


@pytest.mark.contract
def test_timers_cant_be_deleted(setup):
    """There's no Delete timer: a stopped timer is saved with a note, or Discard takes the Stop back."""
    client = setup["clients"]["member"]
    started = client.post(_start_url(setup)).json()
    client.post(_timer_url(setup, "stop/"))
    response = client.delete(_timer_url(setup) + f"?id={started['id']}")
    assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    timer = client.get(_timer_url(setup)).json()["timer"]
    assert timer["id"] == started["id"] and timer["is_running"] is False
    assert not IssueWorkLog.objects.filter(issue=setup["issue"]).exists()


@pytest.mark.contract
def test_discard_on_the_save_dialog_resumes_the_timer(setup):
    client = setup["clients"]["member"]
    client.post(_start_url(setup))
    # started 15 minutes ago, Stop pressed after 10, then the dialog stood open for 5
    started_at = timezone.now() - timedelta(minutes=15)
    IssueWorkLogTimer.objects.filter(user=setup["people"]["member"]).update(
        started_at=started_at, stopped_at=timezone.now() - timedelta(minutes=5)
    )
    assert abs(client.get(_timer_url(setup)).json()["timer"]["duration"] - 10) < 0.05

    response = client.post(_timer_url(setup, "resume/"))
    assert response.status_code == status.HTTP_200_OK, response.content
    assert response.json()["reason"] is None
    timer = response.json()["timer"]
    assert timer["is_running"] is True and timer["stopped_at"] is None
    # on from the 10 minutes: not from zero, and the 5 stopped minutes don't count
    assert abs(timer["elapsed_seconds"] - 10 * 60) < 5 and abs(timer["duration"] - 10) < 0.1
    assert abs(timer["paused_seconds"] - 5 * 60) < 5

    # resuming a running timer changes nothing
    assert client.post(_timer_url(setup, "resume/")).json()["timer"]["paused_seconds"] == timer["paused_seconds"]

    # a second Stop (2 minutes ago) and Discard adds to the pause: 15 - 5 - 2 = 8 minutes worked
    IssueWorkLogTimer.objects.filter(user=setup["people"]["member"]).update(
        stopped_at=timezone.now() - timedelta(minutes=2)
    )
    client.post(_timer_url(setup, "resume/"))
    saved = client.post(
        _timer_url(setup, "save/"), {"description": "Picked it back up", "status": "on_hold"}, format="json"
    )
    assert saved.status_code == status.HTTP_201_CREATED, saved.content
    assert saved.json()["duration"] == 8
    stored = IssueWorkLog.objects.get(pk=saved.json()["id"])
    # the real start time is kept; the pauses only make the time logged shorter than start to end
    assert abs((stored.started_at - started_at).total_seconds()) < 1
    assert abs((stored.ended_at - stored.started_at).total_seconds() - 15 * 60) < 5


@pytest.mark.contract
def test_discard_removes_a_timer_that_cant_run_on(setup):
    client = setup["clients"]["member"]
    client.post(_start_url(setup))
    client.post(_timer_url(setup, "stop/"))
    ProjectMember.objects.filter(project=setup["project"], member=setup["people"]["member"]).update(is_active=False)

    blocked = client.post(_timer_url(setup, "save/"), {"description": "work", "status": "completed"}, format="json")
    assert blocked.status_code == status.HTTP_403_FORBIDDEN
    assert blocked.json()["error"] == "You are no longer a member of this project. Discard the timer instead."

    response = client.post(_timer_url(setup, "resume/"))
    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"timer": None, "reason": "You are no longer a member of this project."}
    assert client.get(_timer_url(setup)).json() == {"timer": None}
    assert not IssueWorkLog.objects.filter(issue=setup["issue"]).exists()


@pytest.mark.contract
def test_saving_a_time_log_puts_the_task_on_hold_or_completes_it(setup):
    """As Workplace's Notes: the time log says how the task is left; the project's statuses are used."""
    client, issue, project = setup["clients"]["member"], setup["issue"], setup["project"]
    completed = State.objects.create(
        name="Completed", project=project, workspace=setup["workspace"], group="completed", sequence=45000
    )

    client.post(_start_url(setup))
    client.post(_timer_url(setup, "stop/"))
    refused = client.post(_timer_url(setup, "save/"), {"description": "work", "status": "done"}, format="json")
    assert refused.status_code == 400 and refused.json() == {"status": "Pick a status: On Hold or Completed."}
    assert IssueWorkLogTimer.objects.filter(user=setup["people"]["member"]).exists()  # nothing saved

    # On Hold: the project gets the status when it has none, and the task goes there
    saved = client.post(_timer_url(setup, "save/"), {"description": "Half done", "status": "on_hold"}, format="json")
    assert saved.status_code == 201, saved.content
    on_hold = State.objects.get(project=project, name="On Hold")
    assert on_hold.group == "started"
    issue.refresh_from_db()
    assert issue.state_id == on_hold.id and issue.completed_at is None
    assert saved.json()["issue_state_id"] == str(on_hold.id)

    # Completed: the project's Completed status, with the completion date set
    client.post(_start_url(setup))
    client.post(_timer_url(setup, "stop/"))
    saved = client.post(_timer_url(setup, "save/"), {"description": "All done", "status": "completed"}, format="json")
    assert saved.status_code == 201, saved.content
    issue.refresh_from_db()
    assert issue.state_id == completed.id and issue.completed_at is not None
    # and On Hold isn't added twice
    client.post(_start_url(setup))
    client.post(_timer_url(setup, "save/"), {"description": "Reopened", "status": "on_hold"}, format="json")
    assert State.objects.filter(project=project, name="On Hold").count() == 1
    assert IssueWorkLog.objects.filter(issue=issue).count() == 3


@pytest.mark.contract
def test_projects_statuses_get_on_hold_and_completed(setup):
    """Migration 0146: Done becomes Completed and On Hold is added; customised projects are left alone."""
    import importlib

    from django.apps import apps as django_apps

    migration = importlib.import_module("plane.db.migrations.0146_on_hold_completed_states")
    plain, custom = setup["project"], setup["off_project"]
    done = State.objects.create(name="Done", project=plain, workspace=setup["workspace"], group="completed")
    # a project that already has both keeps its own
    State.objects.create(name="Completed", project=custom, workspace=setup["workspace"], group="completed")
    State.objects.create(name="On Hold", project=custom, workspace=setup["workspace"], group="unstarted")

    migration.forwards(django_apps, None)
    migration.forwards(django_apps, None)  # twice changes nothing more

    done.refresh_from_db()
    assert done.name == "Completed" and done.group == "completed"
    assert State.objects.filter(project=plain, name="On Hold", group="started").count() == 1
    assert State.objects.filter(project=custom, name="On Hold").values_list("group", flat=True)[0] == "unstarted"
    assert State.objects.filter(project=custom, name__in=["Completed", "On Hold"]).count() == 2


@pytest.mark.contract
def test_a_short_timer_keeps_its_seconds(setup):
    """6 seconds of work is 6 seconds (0.1 minute), not a minute; editing the note keeps them."""
    client = setup["clients"]["member"]
    client.post(_start_url(setup))
    now = timezone.now()
    IssueWorkLogTimer.objects.filter(user=setup["people"]["member"]).update(
        started_at=now - timedelta(seconds=6), stopped_at=now
    )
    timer = client.get(_timer_url(setup)).json()["timer"]
    assert timer["duration"] == 0.1
    saved = client.post(_timer_url(setup, "save/"), {"description": "Quick fix", "status": "on_hold"}, format="json")
    assert saved.status_code == 201, saved.content
    assert saved.json()["duration"] == 0.1
    stored = IssueWorkLog.objects.get(pk=saved.json()["id"])
    assert round(stored.duration * 60) == 6

    # changing only the note keeps the seconds and the exact start and end
    response = client.patch(_url(setup, worklog_id=stored.id), {"description": "Quick fix, tested"}, format="json")
    assert response.status_code == 200, response.content
    again = IssueWorkLog.objects.get(pk=stored.id)
    assert round(again.duration * 60) == 6 and again.started_at == stored.started_at
    # and the Time Sheet adds seconds up
    sheet = client.get(f"/api/workspaces/{setup['workspace'].slug}/timesheet/").json()
    assert round(sheet["total_duration"] * 60) == 6


@pytest.mark.unit
def test_durations_show_seconds():
    from plane.app.views.worklog.base import format_duration

    assert format_duration(0.1) == "6s"
    assert format_duration(1 + 6 / 60) == "1m 6s"
    assert format_duration(90) == "1h 30m"
    assert format_duration(60) == "1h"
    assert format_duration(60 + 6 / 60) == "1h 0m 6s"
    assert format_duration(15) == "15m"
    assert format_duration(0) == "0m"


@pytest.mark.contract
def test_timer_rules(setup):
    # guests and projects without time tracking cannot start a timer
    assert setup["clients"]["guest"].post(_start_url(setup)).status_code == status.HTTP_403_FORBIDDEN
    response = setup["clients"]["member"].post(_start_url(setup, setup["off_project"], setup["off_issue"]))
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    # nothing to stop, resume or save
    assert setup["clients"]["member"].post(_timer_url(setup, "stop/")).status_code == 404
    assert setup["clients"]["member"].post(_timer_url(setup, "resume/")).status_code == 404
    assert (
        setup["clients"]["member"].post(_timer_url(setup, "save/"), {"description": "x"}, format="json").status_code
        == 404
    )


@pytest.mark.contract
def test_editing_timer_entry_moves_end_time(setup):
    client = setup["clients"]["member"]
    client.post(_start_url(setup))
    worklog = client.post(
        _timer_url(setup, "save/"), {"description": "work", "status": "on_hold"}, format="json"
    ).json()
    response = client.patch(_url(setup, worklog_id=worklog["id"]), {"duration": 120}, format="json")
    assert response.status_code == 200
    stored = IssueWorkLog.objects.get(pk=worklog["id"])
    assert stored.ended_at - stored.started_at == timedelta(minutes=120)


# ---------------------------------------------------------------- Timesheet No.


def _number(value):
    assert value.startswith("TIME-BILLING-"), value
    return int(value.removeprefix("TIME-BILLING-"))


@pytest.mark.contract
def test_each_new_entry_gets_the_next_timesheet_no(setup):
    first, second = _log(setup), _log(setup, who="other")
    assert _number(second["timesheet_no"]) == _number(first["timesheet_no"]) + 1
    assert IssueWorkLog.objects.get(pk=first["id"]).timesheet_no == first["timesheet_no"]


@pytest.mark.contract
def test_saved_timer_gets_a_timesheet_no(setup):
    client = setup["clients"]["member"]
    before = _number(_log(setup)["timesheet_no"])
    assert client.post(_start_url(setup)).status_code == status.HTTP_201_CREATED
    timer = IssueWorkLogTimer.objects.get(user=setup["people"]["member"])
    timer.started_at = timezone.now() - timedelta(minutes=30)
    timer.save(update_fields=["started_at"])
    client.post(_timer_url(setup, "stop/"))
    saved = client.post(_timer_url(setup, "save/"), {"description": "Timed work", "status": "on_hold"}, format="json")
    assert saved.status_code == status.HTTP_201_CREATED, saved.content
    assert _number(saved.json()["timesheet_no"]) == before + 1


@pytest.mark.contract
def test_timesheet_no_cannot_be_changed(setup):
    worklog = _log(setup)
    payload = {"timesheet_no": "TIME-BILLING-1", "description": "edited"}
    response = setup["clients"]["member"].patch(_url(setup, worklog_id=worklog["id"]), payload, format="json")
    assert response.status_code == status.HTTP_200_OK, response.content
    assert IssueWorkLog.objects.get(pk=worklog["id"]).timesheet_no == worklog["timesheet_no"]


@pytest.mark.contract
def test_time_sheet_shows_searches_and_exports_the_timesheet_no(setup):
    worklog, other = _log(setup), _log(setup, description="another")
    client = setup["clients"]["member"]
    base = f"/api/workspaces/{setup['workspace'].slug}/timesheet/"
    rows = client.get(base).json()["results"]
    assert {row["timesheet_no"] for row in rows} == {worklog["timesheet_no"], other["timesheet_no"]}
    found = client.get(base, {"search": worklog["timesheet_no"]}).json()["results"]
    assert [row["id"] for row in found] == [worklog["id"]]
    download = client.get(f"{base}download/", {"type": "csv"})
    assert download.status_code == status.HTTP_200_OK
    lines = download.content.decode("utf-8-sig").splitlines()
    assert lines[0].startswith("Timesheet No.,")
    assert any(line.startswith(f"{worklog['timesheet_no']},") for line in lines[1:])


@pytest.mark.contract
def test_migration_numbers_existing_entries_after_the_highest(setup):
    from importlib import import_module

    from django.apps import apps
    from django.db import connection

    migration = import_module("plane.db.migrations.0150_worklog_timesheet_no")
    old, newer, imported = _log(setup), _log(setup), _log(setup)
    IssueWorkLog.objects.filter(pk__in=[old["id"], newer["id"]]).update(timesheet_no="")
    # an entry brought over from Workplace keeps its number; the others continue after it
    IssueWorkLog.objects.filter(pk=imported["id"]).update(timesheet_no="TIME-BILLING-900000")

    class SchemaEditor:
        pass

    editor = SchemaEditor()
    editor.connection = connection
    migration.number_existing_entries(apps, editor)
    assert IssueWorkLog.objects.get(pk=old["id"]).timesheet_no == "TIME-BILLING-900001"
    assert IssueWorkLog.objects.get(pk=newer["id"]).timesheet_no == "TIME-BILLING-900002"
    assert _log(setup)["timesheet_no"] == "TIME-BILLING-900003"


# ---------------------------------------------------------------- deleting: gone everywhere, kept in History


def _timesheet_ids(setup, who):
    response = setup["clients"][who].get(f"/api/workspaces/{setup['workspace'].slug}/timesheet/", {"person": "all"})
    return [row["id"] for row in response.json()["results"]]


def _timesheet_entry(setup, who, worklog_id):
    return setup["clients"][who].get(f"/api/workspaces/{setup['workspace'].slug}/timesheet/{worklog_id}/")


def _report_ids(setup, who):
    response = setup["clients"][who].get(f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/worklogs/")
    return [row["id"] for row in response.json()["results"]]


@pytest.mark.contract
def test_a_deleted_entry_leaves_every_list_and_history_keeps_it(setup):
    worklog = _log(setup)
    member = setup["clients"]["member"]
    assert worklog["id"] in _timesheet_ids(setup, "member") and worklog["id"] in _report_ids(setup, "admin")

    assert member.delete(_url(setup, worklog_id=worklog["id"])).status_code == status.HTTP_204_NO_CONTENT
    # one record: the task's worklogs, the Time Sheet (list and page) and Reports all lose it together
    assert member.get(_url(setup)).json() == []
    assert worklog["id"] not in _timesheet_ids(setup, "member")
    assert _timesheet_entry(setup, "member", worklog["id"]).status_code == status.HTTP_404_NOT_FOUND
    assert worklog["id"] not in _report_ids(setup, "admin")
    # only marked deleted, so it can be restored
    assert IssueWorkLog.all_objects.get(pk=worklog["id"]).deleted_at is not None

    history = IssueActivity.objects.get(issue=setup["issue"], field="worklog")
    assert (history.verb, history.actor_id, history.old_identifier) == (
        "deleted",
        setup["people"]["member"].id,
        IssueWorkLog.all_objects.get(pk=worklog["id"]).id,
    )
    assert history.old_value.startswith(f"{worklog['timesheet_no']} · 1h 30m on ")
    assert history.old_value.endswith("logged by Hiral Test")


@pytest.mark.contract
def test_an_admin_deleting_someone_elses_entry_is_recorded_as_the_admin(setup):
    worklog = _log(setup)
    response = setup["clients"]["admin"].delete(_url(setup, worklog_id=worklog["id"]))
    assert response.status_code == status.HTTP_204_NO_CONTENT
    history = IssueActivity.objects.get(issue=setup["issue"], field="worklog")
    assert history.actor_id == setup["people"]["admin"].id
    assert history.old_value.endswith("logged by Hiral Test")


@pytest.mark.contract
def test_a_refused_delete_records_nothing(setup):
    worklog = _log(setup)
    assert setup["clients"]["other"].delete(_url(setup, worklog_id=worklog["id"])).status_code == 403
    assert not IssueActivity.objects.filter(issue=setup["issue"], field="worklog").exists()


@pytest.mark.contract
def test_the_time_sheet_page_offers_edit_and_delete_by_the_same_rule(setup):
    worklog = _log(setup)
    assert _timesheet_entry(setup, "member", worklog["id"]).json()["can_manage"] is True
    assert _timesheet_entry(setup, "admin", worklog["id"]).json()["can_manage"] is True
    # another member doesn't see it at all
    assert _timesheet_entry(setup, "other", worklog["id"]).status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
def test_history_shows_the_times_as_the_deleting_browser_did(setup):
    from zoneinfo import ZoneInfo

    worklog = _log(setup)
    url = _url(setup, worklog_id=worklog["id"])
    assert setup["clients"]["member"].delete(f"{url}?tz=Asia/Kolkata").status_code == status.HTTP_204_NO_CONTENT
    entry = IssueWorkLog.all_objects.get(pk=worklog["id"])
    india = ZoneInfo("Asia/Kolkata")
    expected = f"{entry.started_at.astimezone(india):%I:%M %p} – {entry.ended_at.astimezone(india):%I:%M %p}"
    assert expected in IssueActivity.objects.get(issue=setup["issue"], field="worklog").old_value
