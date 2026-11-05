# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for report analytics (plane.app.views.worklog.analytics).

Rules under test:
  * periods: days, Monday-to-Sunday weeks, months, calendar quarters and years, with defaults when there are no dates
  * work items in a range: created by its end and not completed before its start; completed = completed in the range;
    cancelled ones only count in the status split
  * per person: assigned, completed, pending, expected and worked time, productivity; per project: hours and statuses
  * worked time per day of the week; ticket activity (left out under a project filter)
  * department (team), project manager and member group filters narrow every report to their people
  * worked time follows the Worklogs permission; work items and tickets follow the Analytics permission
"""

import csv
import io
from datetime import datetime, timedelta, timezone as dt_timezone

import pytest
from openpyxl import load_workbook
from rest_framework import status

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueTimeEstimate,
    IssueWorkLog,
    MemberGroup,
    MemberGroupMember,
    Milestone,
    Project,
    ProjectDetail,
    ProjectMember,
    State,
    TeamMember,
)
from plane.db.models.workspace import Team
from plane.tests.contract.app.test_worklog_reports_app import _client, _log, _user
from plane.tests.unit.utils.test_rbac_engine import _issue, org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import sync_project_access

UTC = dt_timezone.utc


def _at(day, hour=9):
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC)


def _d(text):
    return datetime.fromisoformat(text).date()


@pytest.fixture
def setup(db, workspace, create_user):
    people = {
        "ws_admin": create_user,
        "hiral": _user(workspace, "Hiral"),
        "vijay": _user(workspace, "Vijay"),
    }
    alpha = Project.objects.create(
        name="Alpha", identifier="ALPHA", workspace=workspace, created_by=create_user, is_time_tracking_enabled=True
    )
    ProjectMember.objects.create(project=alpha, member=create_user, role=20, is_active=True)
    for who in ("hiral", "vijay"):
        ProjectMember.objects.create(project=alpha, member=people[who], role=15, is_active=True)
    states = {
        group: State.objects.create(name=group.title(), project=alpha, workspace=workspace, group=group)
        for group in ("unstarted", "completed", "cancelled")
    }

    def task(name, who, group, created, completed=None, expected=None):
        issue = Issue.objects.create(
            name=name, workspace=workspace, project=alpha, state=states[group], created_by=create_user
        )
        IssueAssignee.objects.create(issue=issue, assignee=people[who], project=alpha, workspace=workspace)
        Issue.all_objects.filter(pk=issue.pk).update(
            created_at=_at(_d(created)), completed_at=_at(_d(completed)) if completed else None
        )
        if expected:
            IssueTimeEstimate.objects.create(
                issue=issue, project=alpha, workspace=workspace, expected_duration=expected
            )
        return Issue.all_objects.get(pk=issue.pk)

    tasks = {
        "t1": task("Done in March", "hiral", "completed", "2026-03-01", completed="2026-03-10", expected=120),
        "t2": task("Open since March", "hiral", "unstarted", "2026-03-05", expected=60),
        "t3": task("Done in February", "vijay", "completed", "2026-02-01", completed="2026-02-20"),
        "t4": task("Cancelled", "vijay", "cancelled", "2026-03-02"),
        "t5": task("Done in April", "vijay", "completed", "2026-03-03", completed="2026-04-02", expected=30),
    }
    _log(tasks["t1"], people["hiral"], 90, _d("2026-03-09"))  # Monday
    _log(tasks["t2"], people["hiral"], 30, _d("2026-03-11"))  # Wednesday
    _log(tasks["t5"], people["vijay"], 45, _d("2026-03-12"))  # Thursday

    # helpdesk: a ticket Vijay raised on 5 March and that was resolved a day later
    desk = Project.objects.create(
        name="Helpdesk", identifier="TT", workspace=workspace, created_by=create_user, is_ticket_project=True
    )
    resolved = State.objects.create(name="Completed", project=desk, workspace=workspace, group="completed")
    ticket = Issue.ticket_objects.create(
        name="Laptop", workspace=workspace, project=desk, state=resolved, created_by=people["vijay"]
    )
    # saving outside a request records no author, so set it (and the dates) directly
    Issue.all_objects.filter(pk=ticket.pk).update(
        created_by=people["vijay"], created_at=_at(_d("2026-03-05")), completed_at=_at(_d("2026-03-06"))
    )
    return {
        "workspace": workspace,
        "people": people,
        "alpha": alpha,
        "tasks": tasks,
        "clients": {name: _client(user) for name, user in people.items()},
    }


MARCH = {"from_date": "2026-03-01", "to_date": "2026-03-31"}


def _analytics(setup, who, **params):
    response = setup["clients"][who].get(
        f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/analytics/", params
    )
    assert response.status_code == status.HTTP_200_OK, response.content
    return response.json()


def _people(data):
    return {row["display_name"]: row for row in data["employees"]}


@pytest.mark.contract
class TestPeriods:
    def test_weeks_run_monday_to_sunday(self, setup):
        data = _analytics(setup, "ws_admin", period="week", **MARCH)
        assert [row["key"] for row in data["series"]] == [
            "2026-02-23",
            "2026-03-02",
            "2026-03-09",
            "2026-03-16",
            "2026-03-23",
            "2026-03-30",
        ]
        week = next(row for row in data["series"] if row["key"] == "2026-03-09")
        assert (week["worked_duration"], week["tasks_completed"], week["employees"]) == (165, 1, 2)
        assert sum(row["worked_duration"] for row in data["series"]) == 165

    @pytest.mark.parametrize(
        "period, keys",
        [
            ("day", 31),
            ("month", ["2026-03-01"]),
            ("quarter", ["2026-01-01"]),
            ("year", ["2026-01-01"]),
        ],
    )
    def test_days_months_quarters_and_years(self, setup, period, keys):
        series = _analytics(setup, "ws_admin", period=period, **MARCH)["series"]
        if isinstance(keys, int):
            assert len(series) == keys and series[0]["key"] == "2026-03-01" and series[-1]["key"] == "2026-03-31"
        else:
            assert [row["key"] for row in series] == keys

    def test_quarters_follow_the_calendar(self, setup):
        series = _analytics(setup, "ws_admin", period="quarter", from_date="2026-01-01", to_date="2026-12-31")["series"]
        assert [row["key"] for row in series] == ["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]
        assert [row["tasks_completed"] for row in series] == [2, 1, 0, 0]  # 20 Feb and 10 March in Q1, 2 April in Q2

    def test_without_dates_a_period_covers_its_default_span(self, setup):
        assert len(_analytics(setup, "ws_admin", period="day")["series"]) == 14
        assert len(_analytics(setup, "ws_admin", period="week")["series"]) == 8
        assert len(_analytics(setup, "ws_admin", period="month")["series"]) == 6
        assert len(_analytics(setup, "ws_admin", period="quarter")["series"]) == 4

    def test_without_a_period_there_are_no_series(self, setup):
        assert _analytics(setup, "ws_admin", **MARCH)["series"] == []

    def test_unknown_period_is_rejected(self, setup):
        url = f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/analytics/"
        assert setup["clients"]["ws_admin"].get(url, {"period": "decade"}).status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
class TestNumbers:
    def test_work_items_in_the_range(self, setup):
        summary = _analytics(setup, "ws_admin", **MARCH)["summary"]
        # t3 was done before March; t4 is cancelled; t5 was done after March, so it was still pending in it
        assert (summary["tasks_total"], summary["tasks_completed"], summary["tasks_pending"]) == (3, 1, 2)
        assert summary["tasks_created"] == 4
        assert (summary["worked_duration"], summary["worklog_count"]) == (165, 3)
        assert summary["expected_duration"] == 210

    def test_status_split_counts_cancelled_items(self, setup):
        groups = _analytics(setup, "ws_admin", **MARCH)["status_groups"]
        assert groups == {"backlog": 0, "unstarted": 1, "started": 0, "completed": 2, "cancelled": 1}

    def test_people_with_expected_worked_and_productivity(self, setup):
        people = _people(_analytics(setup, "ws_admin", **MARCH))
        hiral, vijay = people["hiral"], people["vijay"]
        assert (hiral["tasks_assigned"], hiral["tasks_completed"], hiral["tasks_pending"]) == (2, 1, 1)
        assert (hiral["expected_duration"], hiral["worked_duration"], hiral["productivity"]) == (180, 120, 100)
        assert (vijay["tasks_assigned"], vijay["tasks_completed"], vijay["expected_duration"]) == (1, 0, 30)
        assert (vijay["worked_duration"], vijay["productivity"]) == (45, 0)

    def test_projects_breakdown(self, setup):
        (alpha,) = _analytics(setup, "ws_admin", **MARCH)["projects"]
        assert (alpha["worked_duration"], alpha["employees"], alpha["worklog_count"]) == (165, 2, 3)
        assert (alpha["tasks_total"], alpha["tasks_completed"], alpha["tasks_pending"]) == (3, 1, 2)
        assert [person["worked_duration"] for person in alpha["people"]] == [120, 45]

    def test_worked_time_per_weekday(self, setup):
        weekdays = _analytics(setup, "ws_admin", **MARCH)["weekdays"]
        assert [day["worked_duration"] for day in weekdays] == [90, 0, 30, 45, 0, 0, 0]

    def test_tickets_raised_and_resolved(self, setup):
        data = _analytics(setup, "ws_admin", period="day", **MARCH)
        assert {key: data["tickets"][key] for key in ("created", "resolved", "average_resolution_hours")} == {
            "created": 1,
            "resolved": 1,
            "average_resolution_hours": 24.0,
        }
        by_day = {row["key"]: row for row in data["series"]}
        assert (by_day["2026-03-05"]["tickets_created"], by_day["2026-03-06"]["tickets_resolved"]) == (1, 1)

    def test_a_project_filter_leaves_tickets_out(self, setup):
        assert _analytics(setup, "ws_admin", project=str(setup["alpha"].id), **MARCH)["tickets"] is None


@pytest.mark.contract
class TestPeopleFilters:
    def test_department_project_manager_and_group(self, setup):
        workspace, people = setup["workspace"], setup["people"]
        team = Team.objects.create(name="Delivery", workspace=workspace)
        TeamMember.objects.create(workspace=workspace, team=team, member=people["ws_admin"], is_lead=True)
        TeamMember.objects.create(workspace=workspace, team=team, member=people["hiral"])
        group = MemberGroup.objects.create(workspace=workspace, name="QA")
        MemberGroupMember.objects.create(workspace=workspace, group=group, member=people["vijay"])

        assert set(_people(_analytics(setup, "ws_admin", team=str(team.id), **MARCH))) == {"hiral"}
        assert set(_people(_analytics(setup, "ws_admin", pm=str(people["ws_admin"].id), **MARCH))) == {"hiral"}
        by_group = _analytics(setup, "ws_admin", group=str(group.id), **MARCH)
        assert set(_people(by_group)) == {"vijay"}
        assert by_group["summary"]["worked_duration"] == 45
        # the existing reports take the same filters
        summary = setup["clients"]["ws_admin"].get(
            f"/api/workspaces/{workspace.slug}/worklog-reports/", {"team": str(team.id), **MARCH}
        )
        assert [user["display_name"] for user in summary.json()["users"]] == ["hiral"]

    def test_options_list_departments_managers_and_groups(self, setup):
        workspace, people = setup["workspace"], setup["people"]
        team = Team.objects.create(name="Delivery", workspace=workspace)
        TeamMember.objects.create(workspace=workspace, team=team, member=people["hiral"], is_lead=True)
        MemberGroup.objects.create(workspace=workspace, name="QA")
        options = setup["clients"]["vijay"].get(f"/api/workspaces/{workspace.slug}/worklog-reports/options/").json()
        assert [team["name"] for team in options["departments"]] == ["Delivery"]
        assert [manager["display_name"] for manager in options["project_managers"]] == ["hiral"]
        assert [group["name"] for group in options["groups"]] == ["QA"]


@pytest.mark.contract
class TestWhoSeesWhat:
    def test_members_see_their_own_work_items_time_and_tickets(self, setup):
        hiral = _analytics(setup, "hiral", **MARCH)
        assert set(_people(hiral)) == {"hiral"}
        assert (hiral["summary"]["tasks_total"], hiral["summary"]["worked_duration"]) == (2, 120)
        assert hiral["tickets"]["created"] == 0
        assert _analytics(setup, "vijay", **MARCH)["tickets"]["created"] == 1  # the one he raised


@pytest.mark.contract
class TestLongerPeriods:
    def test_departments_add_up_their_members(self, setup):
        workspace, people = setup["workspace"], setup["people"]
        team = Team.objects.create(name="Delivery", workspace=workspace)
        TeamMember.objects.create(workspace=workspace, team=team, member=people["hiral"])
        (delivery,) = _analytics(setup, "ws_admin", **MARCH)["departments"]
        assert delivery["name"] == "Delivery" and delivery["employees"] == 1
        assert (delivery["worked_duration"], delivery["tasks_assigned"], delivery["tasks_completed"]) == (120, 2, 1)
        assert (delivery["expected_duration"], delivery["productivity"]) == (180, 100)

    def test_each_project_has_its_own_trend(self, setup):
        data = _analytics(setup, "ws_admin", period="quarter", from_date="2026-01-01", to_date="2026-12-31")
        (alpha,) = data["projects"]
        assert [row["key"] for row in alpha["series"]] == ["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]
        assert [row["worked_duration"] for row in alpha["series"]] == [165, 0, 0, 0]
        assert [row["tasks_completed"] for row in alpha["series"]] == [2, 1, 0, 0]

    def test_projects_and_milestones_completed_per_period(self, setup):
        alpha, workspace = setup["alpha"], setup["workspace"]
        Project.objects.filter(pk=alpha.pk).update(is_milestone_enabled=True)
        ProjectDetail.objects.create(
            project=alpha, workspace=workspace, status="completed", actual_end_date=_d("2026-03-20")
        )
        # an end date alone doesn't make a project completed
        beta = Project.objects.create(name="Beta", identifier="BETA", workspace=workspace)
        ProjectMember.objects.create(project=beta, member=setup["people"]["ws_admin"], role=20, is_active=True)
        ProjectDetail.objects.create(
            project=beta, workspace=workspace, status="in progress", actual_end_date=_d("2026-03-21")
        )
        Milestone.objects.create(
            project=alpha,
            workspace=workspace,
            title="Beta",
            status="Completed",
            actual_completion_date=_d("2026-03-15"),
        )
        Milestone.objects.create(project=alpha, workspace=workspace, title="Launch", target_date=_d("2026-03-30"))
        data = _analytics(setup, "ws_admin", period="month", **MARCH)
        (march,) = data["series"]
        assert (march["projects_completed"], march["milestones_completed"]) == (1, 1)
        summary = data["summary"]
        assert (summary["projects_completed"], summary["milestones"], summary["milestones_completed"]) == (1, 2, 1)


def _records(setup, **params):
    response = setup["clients"]["ws_admin"].get(
        f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/worklogs/", {**MARCH, **params}
    )
    return response


@pytest.mark.contract
class TestRecords:
    def test_search_matches_task_person_and_notes(self, setup):
        by_task = _records(setup, search="open since").json()
        assert [row["issue"]["name"] for row in by_task["results"]] == ["Open since March"]
        assert by_task["total_count"] == 1
        assert _records(setup, search="vijay").json()["total_count"] == 1

    def test_sorting_by_hours_both_ways(self, setup):
        ascending = [row["duration"] for row in _records(setup, ordering="duration").json()["results"]]
        descending = [row["duration"] for row in _records(setup, ordering="-duration").json()["results"]]
        assert ascending == [30, 45, 90]
        assert descending == [90, 45, 30]

    def test_rows_carry_the_work_items_assignees(self, setup):
        rows = _records(setup, ordering="duration").json()["results"]
        assert [[person["display_name"] for person in row["assignees"]] for row in rows] == [
            ["hiral"],
            ["vijay"],
            ["hiral"],
        ]

    def test_unknown_sort_is_rejected(self, setup):
        assert _records(setup, ordering="colour").status_code == status.HTTP_400_BAD_REQUEST


def _download(setup, **params):
    return setup["clients"]["ws_admin"].get(
        f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/download/", {**MARCH, **params}
    )


@pytest.mark.contract
class TestExport:
    def test_excel_has_a_sheet_per_table(self, setup):
        response = _download(setup, type="xlsx", view="analytics", period="week")
        assert response.status_code == status.HTTP_200_OK
        workbook = load_workbook(io.BytesIO(response.content))
        assert workbook.sheetnames == [
            "Overview",
            "Trend",
            "Weekdays",
            "Employees",
            "Projects",
            "Departments",
            "Status",
            "Milestones",
            "Tickets",
            "Worklogs",
        ]
        overview = {row[0]: row[1] for row in workbook["Overview"].iter_rows(values_only=True)}
        assert (overview["Total working hours"], overview["Tasks completed"], overview["Tickets raised"]) == (
            2.75,
            1,
            1,
        )
        trend = list(workbook["Trend"].iter_rows(values_only=True))
        assert len(trend) == 1 + 6  # header and the six weeks
        employees = {row[0]: row for row in workbook["Employees"].iter_rows(min_row=2, values_only=True)}
        assert employees["hiral"][1:] == (2, 3, 2, 1, 1, 100)

    def test_csv_lists_every_table(self, setup):
        response = _download(setup, type="csv", view="analytics", period="day")
        rows = list(csv.reader(io.StringIO(response.content.decode())))
        titles = [row[0] for row in rows if len(row) == 1]
        assert titles[:3] == ["Overview", "Trend", "Weekdays"] and "Milestones" in titles
        assert ["Total working hours", "2.75"] in rows

    def test_unknown_period_is_rejected(self, setup):
        assert _download(setup, type="xlsx", view="analytics", period="decade").status_code == 400


@pytest.fixture
def rbac(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)
    start = datetime.now(UTC) - timedelta(days=1)
    for who, key in (("a1", "shared_a1"), ("b1", "shared_b1"), ("loner", "shared_loner"), ("a2", "a_a2")):
        issue = org["issues"][key]
        IssueWorkLog.objects.create(
            workspace=org["workspace"],
            project_id=issue.project_id,
            issue=issue,
            logged_by=org["people"][who],
            duration=60,
            description=f"time of {who}",
            started_at=start,
            ended_at=start + timedelta(hours=1),
        )
    return {**org, "clients": {name: _client(user) for name, user in org["people"].items()}}


@pytest.mark.contract
class TestRoles:
    @pytest.mark.parametrize("who, worked", [("hr", 240), ("pm_a", 180), ("pm_b", 120), ("a1", 60)])
    def test_worked_time_follows_the_worklogs_permission(self, rbac, who, worked):
        assert _analytics(rbac, who)["summary"]["worked_duration"] == worked

    def test_work_items_follow_the_analytics_permission(self, rbac):
        # HR may only open their own work items, but Analytics: All still counts everyone's in reports
        rbac["roles"]["hr"].permissions.filter(module="work_items", action="view").update(scope="own")
        everyone = _analytics(rbac, "admin")["summary"]["tasks_total"]
        assert _analytics(rbac, "hr")["summary"]["tasks_total"] == everyone
        assert 0 < _analytics(rbac, "a1")["summary"]["tasks_total"] < everyone
