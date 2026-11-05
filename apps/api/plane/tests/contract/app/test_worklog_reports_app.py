# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for worklog reports (plane.app.views.worklog.report).

Rules under test:
  * workspace admins see every worklog, project admins see their projects, members see only their own time
  * workspace guests can't open reports; time in projects a member isn't part of stays hidden
  * filters: project, user, task status, from / to date (in the user's timezone, both inclusive)
  * the date-wise drill-down returns day totals and worklogs with task, description and start / end times
  * CSV / Excel export with totals, ticket work items stay out
"""

import csv
import io
from datetime import datetime, timedelta, timezone as dt_timezone
from uuid import uuid4

import pytest
from openpyxl import load_workbook
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueWorkLog, Project, ProjectMember, State, User, WorkspaceMember

UTC = dt_timezone.utc


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


def _project(workspace, owner, name, identifier, **extra):
    project = Project.objects.create(
        name=name, identifier=identifier, workspace=workspace, created_by=owner, is_time_tracking_enabled=True, **extra
    )
    todo = State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    done = State.objects.create(name="Done", project=project, workspace=workspace, group="completed")
    open_issue = Issue.objects.create(name=f"{name} open task", workspace=workspace, project=project, state=todo)
    done_issue = Issue.objects.create(name=f"{name} done task", workspace=workspace, project=project, state=done)
    return project, open_issue, done_issue


def _log(issue, user, minutes, day, hour=9, description="work", timer=True):
    """A worklog on `day` (date) at `hour` UTC. Timer entries carry start / end; manual ones only created_at."""
    start = datetime(day.year, day.month, day.day, hour, tzinfo=UTC)
    worklog = IssueWorkLog.objects.create(
        project=issue.project,
        issue=issue,
        logged_by=user,
        duration=minutes,
        description=description,
        started_at=start if timer else None,
        ended_at=start + timedelta(minutes=minutes) if timer else None,
    )
    if not timer:
        IssueWorkLog.objects.filter(pk=worklog.pk).update(created_at=start)
    return worklog


DAY1 = datetime(2026, 3, 10).date()
DAY2 = datetime(2026, 3, 11).date()
DAY3 = datetime(2026, 3, 20).date()


@pytest.fixture
def setup(db, workspace, create_user):
    people = {
        "ws_admin": create_user,
        "lead": _user(workspace, "Lead"),  # admin of Alpha only
        "hiral": _user(workspace, "Hiral"),
        "vijay": _user(workspace, "Vijay"),
        "outsider": _user(workspace, "Outsider"),  # member of no project
        "guest": _user(workspace, "Guest", role=5),
    }
    alpha, alpha_open, alpha_done = _project(workspace, create_user, "Alpha", "ALPHA")
    beta, beta_open, _ = _project(workspace, create_user, "Beta", "BETA")
    ProjectMember.objects.create(project=alpha, member=people["lead"], role=20, is_active=True)
    for proj in (alpha, beta):
        ProjectMember.objects.create(project=proj, member=people["hiral"], role=15, is_active=True)
        ProjectMember.objects.create(project=proj, member=people["vijay"], role=15, is_active=True)
        ProjectMember.objects.create(project=proj, member=people["guest"], role=5, is_active=True)

    _log(alpha_open, people["hiral"], 120, DAY1, description="Build charts")
    _log(alpha_done, people["hiral"], 60, DAY2, timer=False, description="Review")
    _log(alpha_open, people["vijay"], 30, DAY1)
    _log(beta_open, people["hiral"], 45, DAY3)
    _log(beta_open, people["vijay"], 90, DAY3)
    return {
        "workspace": workspace,
        "people": people,
        "clients": {name: _client(user) for name, user in people.items()},
        "alpha": alpha,
        "beta": beta,
        "alpha_open": alpha_open,
    }


def _url(setup, suffix=""):
    return f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/{suffix}"


def _get(setup, who, suffix="", **params):
    response = setup["clients"][who].get(_url(setup, suffix), params)
    assert response.status_code == status.HTTP_200_OK, response.content
    return response.json()


def _uid(setup, name):
    return str(setup["people"][name].id)


def _durations(summary):
    """{display_name: {project identifier: minutes}}"""
    identifiers = {p["id"]: p["identifier"] for p in summary["projects"]}
    return {
        u["display_name"]: {identifiers[p["id"]]: p["total_duration"] for p in u["projects"]} for u in summary["users"]
    }


# ---------------------------------------------------------------- permissions


@pytest.mark.contract
@pytest.mark.parametrize("suffix", ["", "worklogs/", "download/"])
def test_workspace_guest_cannot_open_reports(setup, suffix):
    assert setup["clients"]["guest"].get(_url(setup, suffix)).status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
def test_workspace_admin_sees_everything(setup):
    summary = _get(setup, "ws_admin")
    assert summary["total_duration"] == 345
    assert summary["total_count"] == 5
    assert _durations(summary) == {"hiral": {"ALPHA": 180, "BETA": 45}, "vijay": {"ALPHA": 30, "BETA": 90}}
    # sorted by most time first
    assert [u["display_name"] for u in summary["users"]] == ["hiral", "vijay"]
    assert [(p["identifier"], p["total_duration"]) for p in summary["projects"]] == [("ALPHA", 210), ("BETA", 135)]
    assert summary["scope"]["is_workspace_admin"] is True
    assert summary["scope"]["can_view_others"] is True


@pytest.mark.contract
def test_project_admin_sees_only_their_projects(setup):
    summary = _get(setup, "lead")
    assert _durations(summary) == {"hiral": {"ALPHA": 180}, "vijay": {"ALPHA": 30}}
    assert summary["scope"] == {
        "is_workspace_admin": False,
        "can_view_others": True,
        "admin_project_ids": [str(setup["alpha"].id)],
    }
    # asking for another project returns nothing rather than leaking it
    assert _get(setup, "lead", project=str(setup["beta"].id))["total_count"] == 0


@pytest.mark.contract
def test_member_sees_only_their_own_time(setup):
    summary = _get(setup, "hiral")
    assert _durations(summary) == {"hiral": {"ALPHA": 180, "BETA": 45}}
    assert summary["scope"]["can_view_others"] is False

    # filtering on someone else doesn't reveal their time
    assert _get(setup, "hiral", logged_by=_uid(setup, "vijay"))["total_count"] == 0
    detail = _get(setup, "hiral", "worklogs/", logged_by=_uid(setup, "vijay"))
    assert detail["results"] == [] and detail["total_duration"] == 0


@pytest.mark.contract
def test_non_project_member_sees_nothing(setup):
    summary = _get(setup, "outsider")
    assert summary["users"] == [] and summary["total_duration"] == 0


@pytest.mark.contract
def test_removed_member_loses_access(setup):
    ProjectMember.objects.filter(project=setup["beta"], member=setup["people"]["hiral"]).update(is_active=False)
    assert _durations(_get(setup, "hiral")) == {"hiral": {"ALPHA": 180}}


# ---------------------------------------------------------------- filters


@pytest.mark.contract
def test_filter_by_project_and_user(setup):
    summary = _get(setup, "ws_admin", project=str(setup["alpha"].id))
    assert _durations(summary) == {"hiral": {"ALPHA": 180}, "vijay": {"ALPHA": 30}}

    both = f"{setup['alpha'].id},{setup['beta'].id}"
    summary = _get(setup, "ws_admin", project=both, logged_by=_uid(setup, "vijay"))
    assert _durations(summary) == {"vijay": {"ALPHA": 30, "BETA": 90}}


@pytest.mark.contract
def test_filter_by_task_status(setup):
    completed = _get(setup, "ws_admin", state_group="completed")
    assert _durations(completed) == {"hiral": {"ALPHA": 60}}

    pending = _get(setup, "ws_admin", state_group="backlog,unstarted,started")
    assert pending["total_duration"] == 285

    done_state = State.objects.get(project=setup["alpha"], name="Done")
    assert _get(setup, "ws_admin", state=str(done_state.id))["total_duration"] == 60

    response = setup["clients"]["ws_admin"].get(_url(setup), {"state_group": "triage"})
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
def test_filter_by_date_range_is_inclusive(setup):
    # DAY1 only: both timer entries started that day
    day1 = _get(setup, "ws_admin", from_date=DAY1.isoformat(), to_date=DAY1.isoformat())
    assert _durations(day1) == {"hiral": {"ALPHA": 120}, "vijay": {"ALPHA": 30}}

    # the manual entry on DAY2 is dated by when it was logged
    day2_onwards = _get(setup, "ws_admin", from_date=DAY2.isoformat())
    assert day2_onwards["total_duration"] == 60 + 45 + 90

    until_day2 = _get(setup, "ws_admin", to_date=DAY2.isoformat())
    assert until_day2["total_duration"] == 120 + 60 + 30


@pytest.mark.contract
def test_dates_follow_the_users_timezone(setup):
    admin = setup["people"]["ws_admin"]
    admin.user_timezone = "Asia/Kolkata"  # UTC+5:30
    admin.save(update_fields=["user_timezone"])
    # 20:00 UTC on DAY1 is already DAY2 in India
    _log(setup["alpha_open"], setup["people"]["vijay"], 15, DAY1, hour=20)

    day2 = _get(setup, "ws_admin", "worklogs/", from_date=DAY2.isoformat(), to_date=DAY2.isoformat())
    assert {d["date"]: d["total_duration"] for d in day2["days"]} == {DAY2.isoformat(): 60 + 15}


@pytest.mark.contract
@pytest.mark.parametrize(
    "params",
    [
        {"from_date": "10-03-2026"},
        {"to_date": "2026-13-01"},
        {"from_date": "2026-03-20", "to_date": "2026-03-10"},
        {"from_date": "2020-01-01", "to_date": "2026-01-01"},
    ],
)
def test_invalid_dates_are_rejected(setup, params):
    response = setup["clients"]["ws_admin"].get(_url(setup), params)
    assert response.status_code == status.HTTP_400_BAD_REQUEST


# ---------------------------------------------------------------- date-wise drill-down


@pytest.mark.contract
def test_detail_lists_worklogs_date_wise(setup):
    detail = _get(setup, "ws_admin", "worklogs/", logged_by=_uid(setup, "hiral"))
    assert detail["total_count"] == 3
    assert detail["total_duration"] == 225
    assert detail["days"] == [
        {"date": DAY3.isoformat(), "total_duration": 45, "worklog_count": 1},
        {"date": DAY2.isoformat(), "total_duration": 60, "worklog_count": 1},
        {"date": DAY1.isoformat(), "total_duration": 120, "worklog_count": 1},
    ]
    # newest first
    assert [w["work_date"] for w in detail["results"]] == [DAY3.isoformat(), DAY2.isoformat(), DAY1.isoformat()]

    timer_entry = detail["results"][2]
    assert timer_entry["issue"]["name"] == "Alpha open task"
    assert timer_entry["description"] == "Build charts"
    assert timer_entry["duration"] == 120
    assert timer_entry["started_at"] and timer_entry["ended_at"]
    assert timer_entry["state"]["group"] == "unstarted"

    manual_entry = detail["results"][1]
    assert manual_entry["started_at"] is None and manual_entry["ended_at"] is None
    assert manual_entry["state"]["name"] == "Done"


@pytest.mark.contract
def test_detail_is_paginated(setup):
    page1 = _get(setup, "ws_admin", "worklogs/", per_page=2)
    page2 = _get(setup, "ws_admin", "worklogs/", per_page=2, page=2)
    page3 = _get(setup, "ws_admin", "worklogs/", per_page=2, page=3)
    assert len(page1["results"]) == 2 and len(page2["results"]) == 2 and len(page3["results"]) == 1
    ids = [w["id"] for page in (page1, page2, page3) for w in page["results"]]
    assert len(set(ids)) == 5
    assert page1["total_count"] == 5 and page1["total_duration"] == 345


# ---------------------------------------------------------------- export


def _csv(response):
    return list(csv.reader(io.StringIO(response.content.decode())))


@pytest.mark.contract
def test_download_summary_csv(setup):
    response = setup["clients"]["ws_admin"].get(_url(setup, "download/"), {"type": "csv"})
    assert response.status_code == status.HTTP_200_OK
    assert response["Content-Type"].startswith("text/csv")
    rows = _csv(response)
    assert rows[0] == ["User", "Email", "Alpha", "Beta", "Total hours", "Total time"]
    assert rows[1][0] == "hiral" and rows[1][2:] == ["3.0", "0.75", "3.75", "3h 45m"]
    assert rows[2][0] == "vijay" and rows[2][2:] == ["0.5", "1.5", "2.0", "2h"]
    assert rows[-1] == ["Total", "", "3.5", "2.25", "5.75", "5h 45m"]


@pytest.mark.contract
def test_download_worklogs_csv_respects_filters_and_scope(setup):
    _log(setup["alpha_open"], setup["people"]["hiral"], 15, DAY3, description="=HYPERLINK(evil)")
    response = setup["clients"]["hiral"].get(
        _url(setup, "download/"), {"type": "csv", "view": "worklogs", "project": str(setup["alpha"].id)}
    )
    assert response.status_code == status.HTTP_200_OK
    rows = _csv(response)
    assert rows[0][:5] == ["Date", "Project", "Work item ID", "Work item", "Status"]
    body = rows[1:-1]
    assert {r[5] for r in body} == {"hiral"}  # only their own time
    assert {r[1] for r in body} == {"Alpha"}
    assert body[0][0] == DAY3.isoformat() and body[0][11] == "'=HYPERLINK(evil)"
    assert rows[-1][0] == "Total" and rows[-1][9] == "3h 15m" and rows[-1][10] == "3.25"


@pytest.mark.contract
def test_download_xlsx_has_summary_and_worklogs(setup):
    response = setup["clients"]["ws_admin"].get(_url(setup, "download/"), {"type": "xlsx"})
    assert response.status_code == status.HTTP_200_OK
    workbook = load_workbook(io.BytesIO(response.content))
    # the report's own sheet first and its worklogs last, with the report analytics in between
    assert workbook.sheetnames[0] == "Summary" and workbook.sheetnames[-1] == "Worklogs"
    assert {"Overview", "Employees", "Projects", "Status"} <= set(workbook.sheetnames)
    summary = list(workbook["Summary"].iter_rows(values_only=True))
    assert summary[-1][0] == "Total" and summary[-1][4] == 5.75
    worklogs = list(workbook["Worklogs"].iter_rows(values_only=True))
    assert len(worklogs) == 1 + 5 + 1
    assert worklogs[-1][0] == "Total" and worklogs[-1][10] == 5.75


@pytest.mark.contract
@pytest.mark.parametrize("params", [{"type": "pdf"}, {"type": "csv", "view": "everything"}])
def test_download_rejects_unknown_options(setup, params):
    response = setup["clients"]["ws_admin"].get(_url(setup, "download/"), params)
    assert response.status_code == status.HTTP_400_BAD_REQUEST


# ---------------------------------------------------------------- ticket isolation


@pytest.mark.contract
def test_ticket_worklogs_are_excluded(setup):
    workspace = setup["workspace"]
    ticket_project, ticket_issue, _ = _project(
        workspace, setup["people"]["ws_admin"], "Helpdesk", "TKT", is_ticket_project=True
    )
    ProjectMember.objects.create(project=ticket_project, member=setup["people"]["hiral"], role=20, is_active=True)
    _log(ticket_issue, setup["people"]["hiral"], 600, DAY1)

    assert _get(setup, "ws_admin")["total_duration"] == 345
    assert _get(setup, "ws_admin", "worklogs/", project=str(ticket_project.id))["total_count"] == 0


# ---------------------------------------------------------------- monthly


APRIL = datetime(2026, 4, 2).date()
MAY = datetime(2026, 5, 15).date()


def _monthly_setup(setup):
    """Adds April and May time to the March fixture."""
    _log(setup["alpha_open"], setup["people"]["hiral"], 300, APRIL)
    _log(setup["alpha_open"], setup["people"]["vijay"], 60, MAY)
    return _get(setup, "ws_admin", "monthly/")


def _months(node):
    return node["months"]


@pytest.mark.contract
def test_monthly_breaks_down_user_project_and_work_item(setup):
    monthly = _monthly_setup(setup)
    assert monthly["months"] == ["2026-03", "2026-04", "2026-05"]
    assert monthly["month_totals"] == {"2026-03": 345, "2026-04": 300, "2026-05": 60}
    assert monthly["total_duration"] == 705 and monthly["total_count"] == 7

    hiral, vijay = monthly["users"]
    assert hiral["display_name"] == "hiral" and vijay["display_name"] == "vijay"
    assert _months(hiral) == {"2026-03": 225, "2026-04": 300}
    assert [(p["identifier"], p["total_duration"]) for p in hiral["projects"]] == [("ALPHA", 480), ("BETA", 45)]

    alpha = hiral["projects"][0]
    assert _months(alpha) == {"2026-03": 180, "2026-04": 300}
    assert [(i["name"], i["months"]) for i in alpha["issues"]] == [
        ("Alpha open task", {"2026-03": 120, "2026-04": 300}),
        ("Alpha done task", {"2026-03": 60}),
    ]
    assert alpha["issues"][0]["sequence_id"] == setup["alpha_open"].sequence_id
    assert _months(vijay) == {"2026-03": 120, "2026-05": 60}


@pytest.mark.contract
def test_monthly_columns_follow_the_date_filter(setup):
    _monthly_setup(setup)
    # empty months inside the range still get a column
    monthly = _get(setup, "ws_admin", "monthly/", from_date="2026-01-15", to_date="2026-04-30")
    assert monthly["months"] == ["2026-01", "2026-02", "2026-03", "2026-04"]
    assert monthly["month_totals"] == {"2026-03": 345, "2026-04": 300}

    # an open end stops at the last month with time
    monthly = _get(setup, "ws_admin", "monthly/", from_date="2026-04-01")
    assert monthly["months"] == ["2026-04", "2026-05"]

    # crossing a year
    monthly = _get(setup, "outsider", "monthly/", from_date="2025-11-03", to_date="2026-02-01")
    assert monthly["months"] == ["2025-11", "2025-12", "2026-01", "2026-02"] and monthly["users"] == []


@pytest.mark.contract
def test_monthly_uses_the_users_timezone(setup):
    admin = setup["people"]["ws_admin"]
    admin.user_timezone = "Asia/Kolkata"
    admin.save(update_fields=["user_timezone"])
    # Mar 31 20:00 UTC is Apr 1 in India
    _log(setup["alpha_open"], setup["people"]["vijay"], 15, datetime(2026, 3, 31).date(), hour=20)
    monthly = _get(setup, "ws_admin", "monthly/")
    assert monthly["month_totals"] == {"2026-03": 345, "2026-04": 15}


@pytest.mark.contract
def test_monthly_respects_scope_and_filters(setup):
    _monthly_setup(setup)
    mine = _get(setup, "hiral", "monthly/")
    assert [u["display_name"] for u in mine["users"]] == ["hiral"]
    assert mine["scope"]["can_view_others"] is False

    lead = _get(setup, "lead", "monthly/")
    assert {p["identifier"] for u in lead["users"] for p in u["projects"]} == {"ALPHA"}

    done = _get(setup, "ws_admin", "monthly/", state_group="completed")
    assert done["month_totals"] == {"2026-03": 60}

    assert setup["clients"]["guest"].get(_url(setup, "monthly/")).status_code == status.HTTP_403_FORBIDDEN
    assert setup["clients"]["ws_admin"].get(_url(setup, "monthly/"), {"to_date": "bad"}).status_code == 400


@pytest.mark.contract
def test_detail_can_narrow_to_one_work_item(setup):
    detail = _get(setup, "ws_admin", "worklogs/", issue=str(setup["alpha_open"].id))
    assert detail["total_count"] == 2
    assert {w["issue"]["id"] for w in detail["results"]} == {str(setup["alpha_open"].id)}


@pytest.mark.contract
def test_download_monthly_csv_and_xlsx(setup):
    _monthly_setup(setup)
    client = setup["clients"]["ws_admin"]
    response = client.get(_url(setup, "download/"), {"type": "csv", "view": "monthly"})
    assert response.status_code == status.HTTP_200_OK
    rows = _csv(response)
    assert rows[0] == [
        "User",
        "Project",
        "Work item ID",
        "Work item",
        "Mar 2026",
        "Apr 2026",
        "May 2026",
        "Total hours",
    ]
    assert rows[1] == [
        "hiral",
        "Alpha",
        f"ALPHA-{setup['alpha_open'].sequence_id}",
        "Alpha open task",
        "2.0",
        "5.0",
        "0.0",
        "7.0",
    ]
    subtotal = next(r for r in rows if r[:2] == ["hiral", "Total"])
    assert subtotal[4:] == ["3.75", "5.0", "0.0", "8.75"]
    assert rows[-1] == ["Total", "", "", "", "5.75", "5.0", "1.0", "11.75"]

    response = client.get(_url(setup, "download/"), {"type": "xlsx", "view": "monthly"})
    workbook = load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames[0] == "Monthly" and workbook.sheetnames[-1] == "Worklogs"
    assert {"Overview", "Trend", "Employees"} <= set(workbook.sheetnames)
    monthly = list(workbook["Monthly"].iter_rows(values_only=True))
    assert monthly[-1][-1] == 11.75
    assert workbook["Monthly"]["B" + str(len(monthly) - 1)].font.bold  # vijay's subtotal row


# ---------------------------------------------------------------- work item by work item


@pytest.mark.contract
def test_detail_grouped_by_work_item(setup):
    alpha_done = Issue.objects.get(name="Alpha done task")
    alpha_open = setup["alpha_open"]
    detail = _get(setup, "ws_admin", "worklogs/", project=str(setup["alpha"].id), group_by="work_item")
    # one work item after the other (by identifier), newest first within each
    assert [w["issue"]["id"] for w in detail["results"]] == [str(alpha_open.id)] * 2 + [str(alpha_done.id)]
    assert {w["id"]: (w["total_duration"], w["worklog_count"]) for w in detail["work_items"]} == {
        str(alpha_open.id): (150, 2),
        str(alpha_done.id): (60, 1),
    }
    # the totals cover every page, also when a work item is split across pages
    page1 = _get(setup, "ws_admin", "worklogs/", project=str(setup["alpha"].id), group_by="work_item", per_page=1)
    assert len(page1["results"]) == 1 and len(page1["work_items"]) == 2

    # without grouping: newest first, and no per work item totals
    plain = _get(setup, "ws_admin", "worklogs/", project=str(setup["alpha"].id))
    assert "work_items" not in plain
    assert plain["results"][0]["issue"]["id"] == str(alpha_done.id)

    response = setup["clients"]["ws_admin"].get(_url(setup, "worklogs/"), {"group_by": "user"})
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
def test_download_follows_the_work_item_grouping(setup):
    response = setup["clients"]["ws_admin"].get(
        _url(setup, "download/"), {"type": "csv", "view": "worklogs", "group_by": "work_item"}
    )
    rows = _csv(response)[1:-1]
    open_id, done_id = (
        f"ALPHA-{setup['alpha_open'].sequence_id}",
        f"ALPHA-{Issue.objects.get(name='Alpha done task').sequence_id}",
    )
    assert [r[2] for r in rows][:3] == [open_id, open_id, done_id]
    assert [r[2] for r in rows][3:] == ["BETA-1", "BETA-1"]
