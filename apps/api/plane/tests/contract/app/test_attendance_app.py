# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reports › Attendance (plane/app/views/worklog/attendance.py): everyone's hours day by day.

The workspace is the plan's example (plane/tests/unit/utils/test_rbac_engine.py): HR, PM A leading Team A (A1, A2),
PM B leading Team B (B1). Today is Monday 23 November 2026 (India time); 1 November was a Sunday.
"""

import io
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from openpyxl import load_workbook
from rest_framework.test import APIClient

from plane.db.models import IssueWorkLog, WorkspaceMember
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.rbac import sync_project_access

IST = ZoneInfo("Asia/Kolkata")
NOW = datetime(2026, 11, 23, 12, 0, tzinfo=IST)


@pytest.fixture
def setup(org, monkeypatch):  # noqa: F811
    # today is Monday 23 November for the report
    monkeypatch.setattr("plane.app.views.worklog.attendance._now", lambda: NOW)
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)
    # everyone joined in October
    WorkspaceMember.objects.filter(workspace=org["workspace"]).update(created_at=datetime(2026, 10, 1, tzinfo=IST))
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return {**org, "clients": clients}


def _log(setup, who, issue_key, start, minutes):
    issue = setup["issues"][issue_key]
    IssueWorkLog.objects.create(
        workspace=setup["workspace"],
        project=issue.project,
        issue=issue,
        logged_by=setup["people"][who],
        duration=minutes,
        started_at=start,
        ended_at=start + timedelta(minutes=minutes),
    )


def _report(setup, who="hr", query="from_date=2026-11-01&to_date=2026-11-23"):
    response = setup["clients"][who].get(
        f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/attendance/?{query}"
    )
    assert response.status_code == 200, response.content
    return response.json()


def _row(report, setup, who):
    user_id = str(setup["people"][who].id)
    return next(e for e in report["employees"] if e["id"] == user_id)


@pytest.mark.contract
class TestDays:
    def test_present_absent_week_off_and_today(self, setup):
        _log(setup, "a1", "shared_a1", datetime(2026, 11, 2, 10, 0, tzinfo=IST), 120)  # Monday
        _log(setup, "a1", "a_a2", datetime(2026, 11, 2, 15, 0, tzinfo=IST), 30)  # same day, another task
        _log(setup, "a1", "shared_a1", datetime(2026, 11, 7, 11, 0, tzinfo=IST), 60)  # Saturday
        report = _report(setup)
        assert report["timezone"] == "Asia/Kolkata" and report["today"] == "2026-11-23"
        assert len(report["days"]) == 23
        assert report["days"][0]["is_week_off"] is True  # Sunday 1 Nov

        a1 = _row(report, setup, "a1")["days"]
        assert a1["2026-11-01"]["status"] == "week_off"
        assert a1["2026-11-02"] == {"status": "present", "minutes": 150, "entries": 2}
        assert a1["2026-11-03"]["status"] == "absent"
        assert a1["2026-11-07"] == {"status": "week_off_worked", "minutes": 60, "entries": 1}
        assert a1["2026-11-23"]["status"] == "today"  # not over yet: not absent

        summary = _row(report, setup, "a1")["summary"]
        # the 15 weekdays from 2 to 20 Nov are over; today (Monday 23rd) isn't counted yet
        assert summary["present"] == 1 and summary["absent"] == 14
        assert summary["week_off"] == 7 and summary["week_off_worked"] == 1
        assert summary["total_minutes"] == 210 and summary["days_worked"] == 2
        assert summary["average_minutes"] == 105

        assert report["days"][1]["total_minutes"] == 150 and report["days"][1]["present"] == 1

    def test_days_are_the_companys(self, setup):
        # 20:00 UTC on 4 Nov is 01:30 on 5 Nov in India
        _log(setup, "a2", "a_a2", datetime(2026, 11, 4, 20, 0, tzinfo=ZoneInfo("UTC")), 45)
        days = _row(_report(setup), setup, "a2")["days"]
        assert days["2026-11-04"]["status"] == "absent"
        assert days["2026-11-05"]["minutes"] == 45

    def test_before_joining_is_not_absent(self, setup):
        WorkspaceMember.objects.filter(workspace=setup["workspace"], member=setup["people"]["a2"]).update(
            created_at=datetime(2026, 11, 10, 9, 0, tzinfo=IST)
        )
        days = _row(_report(setup), setup, "a2")["days"]
        assert days["2026-11-09"]["status"] == "not_joined"
        assert days["2026-11-10"]["status"] == "absent"

    def test_disabled_people(self, setup):
        WorkspaceMember.objects.filter(workspace=setup["workspace"], member=setup["people"]["b1"]).update(
            is_active=False
        )
        assert str(setup["people"]["b1"].id) not in {e["id"] for e in _report(setup)["employees"]}
        # with time in the range they're listed, and their other days aren't absences
        _log(setup, "b1", "b_b1", datetime(2026, 11, 3, 10, 0, tzinfo=IST), 30)
        b1 = _row(_report(setup), setup, "b1")
        assert b1["is_active"] is False
        assert b1["days"]["2026-11-03"]["status"] == "present"
        assert b1["days"]["2026-11-04"]["status"] == "inactive" and b1["summary"]["absent"] == 0

    def test_a_range_into_the_future(self, setup):
        days = _row(_report(setup, query="from_date=2026-11-23&to_date=2026-11-30"), setup, "a1")["days"]
        assert days["2026-11-24"]["status"] == "upcoming"
        assert days["2026-11-28"]["status"] == "week_off"


@pytest.mark.contract
class TestWhoAndFilters:
    def test_hr_sees_everyone_pms_their_teams_employees_themselves(self, setup):
        names = lambda report: {e["id"] for e in report["employees"]}  # noqa: E731
        everyone = names(_report(setup, "hr"))
        assert {str(p.id) for p in setup["people"].values()} <= everyone
        people = setup["people"]
        assert names(_report(setup, "pm_a")) == {str(people[k].id) for k in ("pm_a", "a1", "a2")}
        assert names(_report(setup, "a1")) == {str(people["a1"].id)}

    def test_department_filter_and_this_month_by_default(self, setup):
        team_a, _ = setup["teams"]
        report = _report(setup, query=f"team={team_a.id}")
        assert report["from_date"] == "2026-11-01" and report["to_date"] == "2026-11-23"
        assert {e["id"] for e in report["employees"]} == {str(setup["people"][k].id) for k in ("pm_a", "a1", "a2")}

    def test_ranges(self, setup):
        url = f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/attendance/"
        too_long = setup["clients"]["hr"].get(f"{url}?from_date=2026-01-01&to_date=2026-11-23")
        assert too_long.status_code == 400 and "62 days" in too_long.json()["to_date"]
        backwards = setup["clients"]["hr"].get(f"{url}?from_date=2026-11-20&to_date=2026-11-01")
        assert backwards.status_code == 400
        # files cover longer ranges
        file = setup["clients"]["hr"].get(f"{url}download/?type=csv&from_date=2026-01-01&to_date=2026-11-23")
        assert file.status_code == 200


@pytest.mark.contract
def test_the_files(setup):
    _log(setup, "a1", "shared_a1", datetime(2026, 11, 2, 10, 0, tzinfo=IST), 90)
    url = (
        f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/attendance/download/"
        "?from_date=2026-11-01&to_date=2026-11-23"
    )
    csv_file = setup["clients"]["hr"].get(url + "&type=csv")
    assert csv_file.status_code == 200 and "attachment" in csv_file["Content-Disposition"]
    text = csv_file.content.decode()
    assert "Sun 01 Nov" in text and "Mon 02 Nov" in text
    line = next(row for row in text.splitlines() if row.startswith(setup["people"]["a1"].display_name))
    assert "1h 30m" in line and ",A," in line and ",WO," in line

    excel = setup["clients"]["hr"].get(url + "&type=xlsx")
    assert excel.status_code == 200
    sheet = load_workbook(io.BytesIO(excel.content))["Attendance"]
    header = [cell.value for cell in sheet[3]]
    assert header[0] == "Employee" and header[2] == "Sun 01 Nov" and "Total hours" in header
    a1_row = next(row for row in sheet.iter_rows(min_row=4) if row[0].value == setup["people"]["a1"].display_name)
    assert a1_row[3].value == "1h 30m" and a1_row[3].fill.fgColor.rgb.endswith("E6F4EA")
    assert a1_row[4].value == "A" and a1_row[4].fill.fgColor.rgb.endswith("FDE2E1")
    assert a1_row[2].value == "WO"
    assert sheet.freeze_panes == "C4"
