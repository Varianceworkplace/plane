# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Time Sheet: whose time entries a person sees (plane.app.views.worklog.timesheet).

The workspace is the plan's example (see plane/tests/unit/utils/test_rbac_engine.py), with role-based access on:
PM A leads Team A (A1, A2), PM B leads Team B (B1). HR may view every worklog, PMs their teams', Employees their
own. Here A2 is a Senior and A1 a Junior in Team A.

  * everyone sees their own time; a person they may not see is refused (403), not just left out;
  * PMs see the people in the teams they lead; seniors see the juniors of their own team, never another team's;
  * HR and workspace admins see everyone's; Reports follow the same rule.
"""

from datetime import datetime, timedelta, timezone

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import IssueWorkLog, TeamMember
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import AccessProfile, sync_project_access

DAY = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)


@pytest.fixture
def setup(org):  # noqa: F811
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)
    team_a, _ = org["teams"]
    TeamMember.objects.filter(team=team_a, member=org["people"]["a2"]).update(level="senior")
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    people, issues = org["people"], org["issues"]
    # one entry each, on a work item of theirs
    for who, issue, minutes, day in (
        ("a1", "shared_a1", 60, 0),
        ("a1", "b_a1", 30, 1),
        ("a2", "a_a2", 90, 0),
        ("b1", "b_b1", 45, 0),
        ("pm_a", "a_a2", 15, 2),
        ("pm_b", "b_b1", 20, 2),
    ):
        issue = issues[issue]
        IssueWorkLog.objects.create(
            workspace=org["workspace"],
            project=issue.project,
            issue=issue,
            logged_by=people[who],
            duration=minutes,
            started_at=DAY + timedelta(days=day),
            ended_at=DAY + timedelta(days=day, minutes=minutes),
            description=f"{who} work",
        )
    return {**org, "clients": clients}


def _timesheet(setup, who, **params):
    return setup["clients"][who].get(f"/api/workspaces/{setup['workspace'].slug}/timesheet/", params)


def _loggers(response):
    assert response.status_code == status.HTTP_200_OK, response.content
    return sorted({row["logged_by"]["display_name"] for row in response.json()["results"]})


def _id(setup, who):
    return str(setup["people"][who].id)


def _names(setup, *who):
    return sorted(setup["people"][name].display_name for name in who)


@pytest.mark.contract
class TestOwnTime:
    def test_everyone_starts_on_their_own_time(self, setup):
        for who in ("a1", "a2", "b1", "pm_a", "hr"):
            response = _timesheet(setup, who)
            expected = _names(setup, who) if who != "hr" else []
            assert _loggers(response) == expected, who
            assert response.json()["person"] == _id(setup, who)
        body = _timesheet(setup, "a1").json()
        assert (body["total_count"], body["total_duration"]) == (2, 90)
        entry = body["results"][0]
        assert {"work_date", "started_at", "ended_at", "duration", "issue", "project", "logged_by"} <= set(entry)

    def test_a_junior_sees_nobody_else(self, setup):
        a1 = _id(setup, "a1")
        for other in ("a2", "pm_a", "b1", "hr"):
            response = _timesheet(setup, "a1", person=_id(setup, other))
            assert response.status_code == status.HTTP_403_FORBIDDEN, other
        assert _loggers(_timesheet(setup, "a1", person="all")) == _names(setup, "a1")
        body = _timesheet(setup, "a1").json()
        assert [person["id"] for person in body["people"]] == [a1]
        assert body["can_view_others"] is False


@pytest.mark.contract
class TestSeniority:
    def test_a_senior_sees_the_juniors_of_their_team_only(self, setup):
        assert _loggers(_timesheet(setup, "a2", person=_id(setup, "a1"))) == _names(setup, "a1")
        assert _loggers(_timesheet(setup, "a2", person="all")) == _names(setup, "a1", "a2")
        # not the team's lead, not another team
        for other in ("pm_a", "b1", "pm_b"):
            assert _timesheet(setup, "a2", person=_id(setup, other)).status_code == 403, other
        people = {person["id"] for person in _timesheet(setup, "a2").json()["people"]}
        assert people == {_id(setup, "a1"), _id(setup, "a2")}

    def test_the_levels_go_junior_mid_senior(self, setup):
        team_a, _ = setup["teams"]
        TeamMember.objects.filter(team=team_a, member=setup["people"]["a1"]).update(level="mid")
        assert _timesheet(setup, "a2", person=_id(setup, "a1")).status_code == 200  # Senior > Mid-level
        assert _timesheet(setup, "a1", person=_id(setup, "a2")).status_code == 403
        TeamMember.objects.filter(team=team_a, member=setup["people"]["a2"]).update(level="mid")
        # the same level: neither sees the other
        assert _timesheet(setup, "a2", person=_id(setup, "a1")).status_code == 403
        assert _timesheet(setup, "a1", person=_id(setup, "a2")).status_code == 403

    def test_the_level_counts_team_by_team(self, setup):
        _, team_b = setup["teams"]
        # A1: Junior in Team A, Senior in Team B
        TeamMember.objects.create(
            workspace=setup["workspace"], team=team_b, member=setup["people"]["a1"], level="senior"
        )
        assert _loggers(_timesheet(setup, "a1", person=_id(setup, "b1"))) == _names(setup, "b1")
        assert _timesheet(setup, "a1", person=_id(setup, "a2")).status_code == 403
        assert _timesheet(setup, "a1", person=_id(setup, "pm_b")).status_code == 403

    def test_leaving_the_team_ends_it(self, setup):
        team_a, _ = setup["teams"]
        TeamMember.objects.filter(team=team_a, member=setup["people"]["a1"]).delete(soft=False)
        assert _timesheet(setup, "a2", person=_id(setup, "a1")).status_code == 403

    def test_the_engine_lists_the_juniors(self, setup):
        profile = AccessProfile.load(setup["people"]["a2"], setup["workspace"].id)
        assert profile.junior_member_ids == {setup["people"]["a1"].id}
        lead = AccessProfile.load(setup["people"]["pm_a"], setup["workspace"].id)
        assert lead.junior_member_ids == {setup["people"]["a1"].id, setup["people"]["a2"].id}
        assert AccessProfile.load(setup["people"]["a1"], setup["workspace"].id).junior_member_ids == set()


@pytest.mark.contract
class TestManagersAndHR:
    def test_a_pm_sees_their_team_not_another(self, setup):
        assert _loggers(_timesheet(setup, "pm_a", person="all")) == _names(setup, "a1", "a2", "pm_a")
        assert _timesheet(setup, "pm_a", person=_id(setup, "a1")).status_code == 200
        for other in ("b1", "pm_b", "hr"):
            assert _timesheet(setup, "pm_a", person=_id(setup, other)).status_code == 403, other
        assert _loggers(_timesheet(setup, "pm_b", person="all")) == _names(setup, "b1", "pm_b")

    def test_a_pm_doesnt_see_people_outside_their_teams_even_in_their_projects(self, setup):
        # the loner (in no team) logs time in Shared, a project Team A owns
        issue = setup["issues"]["shared_loner"]
        IssueWorkLog.objects.create(
            workspace=setup["workspace"],
            project=issue.project,
            issue=issue,
            logged_by=setup["people"]["loner"],
            duration=25,
            started_at=DAY,
            ended_at=DAY + timedelta(minutes=25),
        )
        assert _timesheet(setup, "pm_a", person=_id(setup, "loner")).status_code == 403
        assert setup["people"]["loner"].display_name not in _loggers(_timesheet(setup, "pm_a", person="all"))
        reports = setup["clients"]["pm_a"].get(f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/").json()
        assert setup["people"]["loner"].display_name not in [user["display_name"] for user in reports["users"]]
        # HR still does
        assert _timesheet(setup, "hr", person=_id(setup, "loner")).status_code == 200

    def test_hr_and_workspace_admins_see_everyone(self, setup):
        everyone = _names(setup, "a1", "a2", "b1", "pm_a", "pm_b")
        assert _loggers(_timesheet(setup, "hr", person="all")) == everyone
        assert _loggers(_timesheet(setup, "admin", person="all")) == everyone
        assert _timesheet(setup, "hr", person=_id(setup, "b1")).status_code == 200
        body = _timesheet(setup, "hr").json()
        assert body["can_view_others"] is True and len(body["people"]) == len(setup["people"])

    def test_reports_follow_the_same_rule(self, setup):
        base = f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/"
        for who, expected in (("a2", ("a1", "a2")), ("a1", ("a1",)), ("pm_a", ("a1", "a2", "pm_a"))):
            body = setup["clients"][who].get(base).json()
            assert sorted(user["display_name"] for user in body["users"]) == _names(setup, *expected), who
        assert setup["clients"]["a2"].get(base).json()["scope"]["can_view_others"] is True
        assert setup["clients"]["a1"].get(base).json()["scope"]["can_view_others"] is False


@pytest.mark.contract
class TestFilters:
    def test_dates_projects_and_search(self, setup):
        a1 = {"person": _id(setup, "a1")}
        assert _timesheet(setup, "a1", from_date="2026-11-11", to_date="2026-11-11").json()["total_count"] == 1
        assert _timesheet(setup, "a1", project=str(setup["projects"]["shared"].id)).json()["total_duration"] == 60
        assert _timesheet(setup, "a1", search="Beta").json()["total_count"] == 1
        assert _timesheet(setup, "a1", from_date="2026-11-12", to_date="2026-11-10").status_code == 400
        assert _timesheet(setup, "a1", from_date="10/11/2026").status_code == 400
        assert _timesheet(setup, "a1", person="nobody").status_code == 400
        assert _timesheet(setup, "a2", per_page=1, **a1).json()["results"][0]["duration"] == 30  # newest first


@pytest.mark.contract
class TestLevelsInTeams:
    def test_access_managers_set_levels(self, setup):
        team_a, _ = setup["teams"]
        url = f"/api/workspaces/{setup['workspace'].slug}/access-control/teams/{team_a.id}/"
        members = [
            {"member_id": _id(setup, "pm_a"), "is_lead": True},
            {"member_id": _id(setup, "a1"), "is_lead": False, "level": "mid"},
            {"member_id": _id(setup, "a2"), "is_lead": False},
        ]
        response = setup["clients"]["hr"].patch(url, {"members": members}, format="json")
        assert response.status_code == status.HTTP_200_OK, response.content
        levels = {row["member_id"]: row["level"] for row in response.json()["members"]}
        assert levels == {_id(setup, "pm_a"): "junior", _id(setup, "a1"): "mid", _id(setup, "a2"): "junior"}
        bad = [{"member_id": _id(setup, "a1"), "is_lead": False, "level": "principal"}]
        assert setup["clients"]["hr"].patch(url, {"members": bad}, format="json").status_code == 400
        # PMs don't manage teams
        assert setup["clients"]["pm_a"].patch(url, {"members": members}, format="json").status_code == 403
        overview = setup["clients"]["hr"].get(f"/api/workspaces/{setup['workspace'].slug}/access-control/").json()
        assert [level["key"] for level in overview["team_levels"]] == ["junior", "mid", "senior"]


@pytest.mark.contract
class TestWithoutRoleBasedAccess:
    def test_members_see_their_own_and_admins_everyones(self, setup):
        setup["workspace"].is_rbac_enabled = False
        setup["workspace"].save(update_fields=["is_rbac_enabled"])
        assert _loggers(_timesheet(setup, "a2", person="all")) == _names(setup, "a2")
        assert _timesheet(setup, "a2", person=_id(setup, "a1")).status_code == 403
        assert _timesheet(setup, "admin", person=_id(setup, "b1")).status_code == 200


def _export(setup, who, **params):
    return setup["clients"][who].get(f"/api/workspaces/{setup['workspace'].slug}/timesheet/download/", params)


def _csv_rows(response):
    import csv
    import io

    assert response.status_code == status.HTTP_200_OK, response.content
    return list(csv.reader(io.StringIO(response.content.decode())))


@pytest.mark.contract
class TestExport:
    def test_my_entries_as_csv(self, setup):
        response = _export(setup, "a1")
        assert "timesheet-mine" in response["Content-Disposition"]
        rows = _csv_rows(response)
        assert rows[0][:5] == ["Timesheet No.", "Date Start", "Date End", "Time Start", "Time End"]
        entries = rows[1:-1]
        assert len(entries) == 2 and {row[11] for row in entries} == {setup["people"]["a1"].display_name}
        assert rows[-1][0] == "Total" and rows[-1][6] == "1.5"  # 90 minutes
        newest = entries[0]
        assert newest[0].startswith("TIME-BILLING-")
        assert (newest[1], newest[3], newest[4], newest[5]) == ("2026-11-11", "09:00 AM", "09:30 AM", "30m")

    def test_only_the_rows_picked(self, setup):
        mine = list(IssueWorkLog.objects.filter(logged_by=setup["people"]["a1"]).values_list("id", flat=True))
        rows = _csv_rows(_export(setup, "a1", ids=str(mine[0])))
        assert len(rows) == 3  # header, the entry, the total
        # someone else's entries can't be picked by id
        theirs = IssueWorkLog.objects.filter(logged_by=setup["people"]["b1"]).values_list("id", flat=True)
        rows = _csv_rows(_export(setup, "a1", person="all", ids=",".join(str(pk) for pk in theirs)))
        assert len(rows) == 2

    def test_whose_entries_follow_the_page(self, setup):
        assert _export(setup, "a1", person=_id(setup, "a2")).status_code == status.HTTP_403_FORBIDDEN
        assert _export(setup, "a2", person=_id(setup, "b1")).status_code == status.HTTP_403_FORBIDDEN
        rows = _csv_rows(_export(setup, "a2", person=_id(setup, "a1")))
        assert {row[11] for row in rows[1:-1]} == {setup["people"]["a1"].display_name}
        assert "timesheet-" in _export(setup, "a2", person=_id(setup, "a1"))["Content-Disposition"]
        rows = _csv_rows(_export(setup, "a2", person="all"))
        assert sorted({row[11] for row in rows[1:-1]}) == _names(setup, "a1", "a2")
        rows = _csv_rows(_export(setup, "hr", person="all"))
        assert len(rows[1:-1]) == 6

    def test_excel(self, setup):
        import io

        from openpyxl import load_workbook

        response = _export(setup, "pm_a", person="all", type="xlsx")
        assert response.status_code == status.HTTP_200_OK
        assert response["Content-Disposition"].endswith('.xlsx"')
        sheet = load_workbook(io.BytesIO(response.content))["Time Sheet"]
        assert sheet.cell(1, 1).value == "Timesheet No." and sheet.cell(1, 1).font.bold
        assert sheet.cell(1, 2).value == "Date Start"
        assert sheet.max_row == 1 + 4 + 1  # A1's two entries, A2's, PM A's, and the total
        assert _export(setup, "a1", type="pdf").status_code == status.HTTP_400_BAD_REQUEST

    def test_formulas_are_neutralised(self, setup):
        IssueWorkLog.objects.filter(logged_by=setup["people"]["a1"]).update(description="=HYPERLINK(1)")
        rows = _csv_rows(_export(setup, "a1"))
        assert all(not row[13].startswith("=") for row in rows[1:-1])


@pytest.mark.contract
class TestTimezone:
    def test_dates_and_times_follow_the_browsers_timezone(self, setup):
        # A1's entries start at 09:00 UTC: 14:30 in India
        rows = _csv_rows(_export(setup, "a1", tz="Asia/Kolkata"))
        assert rows[1][3] == "02:30 PM"
        rows = _csv_rows(_export(setup, "a1"))
        assert rows[1][3] == "09:00 AM"  # the profile's (UTC)
        # an unknown name falls back to the profile's
        assert _csv_rows(_export(setup, "a1", tz="Mars/Base"))[1][3] == "09:00 AM"
        # the date follows too: 09:00 UTC on Nov 11 is still Nov 10 in Honolulu (UTC-10)
        body = _timesheet(setup, "a1", tz="Pacific/Honolulu").json()
        assert body["results"][0]["work_date"] == "2026-11-10"
        assert _timesheet(setup, "a1", tz="Pacific/Honolulu", from_date="2026-11-11").json()["total_count"] == 0
