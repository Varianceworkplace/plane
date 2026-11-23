# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Holidays (plane/app/views/holiday/base.py) and how Attendance shows them (plane/app/views/worklog/attendance.py).

Everyone sees the holiday list; workspace admins and HR keep it. In Attendance a holiday is H, never Absent; an
optional holiday stays a working day. The workspace is the plan's example (plane/tests/unit/utils/test_rbac_engine.py);
today is Monday 23 November 2026 (India time).
"""

import io
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl import Workbook, load_workbook
from rest_framework.test import APIClient

from plane.db.models import Holiday, IssueWorkLog, WorkspaceMember
from plane.tests.unit.utils.test_rbac_engine import org  # noqa: F401  (the example workspace fixture)
from plane.utils.holidays import parse_date, parse_kind
from plane.utils.rbac import sync_project_access

IST = ZoneInfo("Asia/Kolkata")
NOW = datetime(2026, 11, 23, 12, 0, tzinfo=IST)


@pytest.fixture
def setup(org, monkeypatch):  # noqa: F811
    monkeypatch.setattr("plane.app.views.worklog.attendance._now", lambda: NOW)
    org["workspace"].is_rbac_enabled = True
    org["workspace"].save(update_fields=["is_rbac_enabled"])
    sync_project_access(org["workspace"].id)
    WorkspaceMember.objects.filter(workspace=org["workspace"]).update(created_at=datetime(2026, 10, 1, tzinfo=IST))
    clients = {}
    for name, user in org["people"].items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[name] = client
    return {**org, "clients": clients}


def _url(setup, tail=""):
    return f"/api/workspaces/{setup['workspace'].slug}/holidays/{tail}"


def _holiday(setup, day, name, kind="holiday"):
    return Holiday.objects.create(workspace=setup["workspace"], date=day, name=name, kind=kind)


def _list(setup, who="a1", query=""):
    response = setup["clients"][who].get(_url(setup) + query)
    assert response.status_code == 200, response.content
    return response.json()


def _upload(setup, who, name, content):
    upload = SimpleUploadedFile(name, content)
    return setup["clients"][who].post(_url(setup, "import/"), {"file": upload}, format="multipart")


@pytest.mark.contract
class TestTheList:
    def test_everyone_sees_it_a_year_at_a_time(self, setup):
        _holiday(setup, date(2026, 1, 26), "Republic Day")
        _holiday(setup, date(2026, 12, 25), "Christmas")
        _holiday(setup, date(2027, 1, 26), "Republic Day")
        for who in ("a1", "b1", "loner", "pm_a", "hr", "admin"):
            body = _list(setup, who)
            assert body["year"] == 2026 and body["today"] == "2026-11-23"
            assert [h["name"] for h in body["holidays"]] == ["Republic Day", "Christmas"]
            assert body["next"]["name"] == "Christmas" and body["years"] == [2026, 2027]
        assert [h["date"] for h in _list(setup, query="?year=2027")["holidays"]] == ["2027-01-26"]

    def test_only_admins_and_hr_may_change_it(self, setup):
        assert _list(setup, "a1")["can_manage"] is False
        assert _list(setup, "pm_a")["can_manage"] is False
        assert _list(setup, "hr")["can_manage"] is True
        assert _list(setup, "admin")["can_manage"] is True
        new = {"date": "2026-12-25", "name": "Christmas"}
        assert setup["clients"]["a1"].post(_url(setup), new, format="json").status_code == 403
        assert setup["clients"]["pm_a"].post(_url(setup), new, format="json").status_code == 403
        assert not Holiday.objects.exists()

    def test_a_bad_year(self, setup):
        assert setup["clients"]["a1"].get(_url(setup) + "?year=twenty").status_code == 400


@pytest.mark.contract
class TestKeepingIt:
    def test_add_change_and_delete(self, setup):
        hr = setup["clients"]["hr"]
        response = hr.post(_url(setup), {"date": "2026-11-09", "name": "  Diwali  ", "kind": "holiday"}, format="json")
        assert response.status_code == 201 and response.json()["name"] == "Diwali"
        pk = response.json()["id"]

        response = hr.patch(_url(setup, f"{pk}/"), {"date": "2026-11-08", "kind": "optional"}, format="json")
        body = response.json()
        assert response.status_code == 200
        assert (body["date"], body["kind"], body["name"]) == ("2026-11-08", "optional", "Diwali")

        assert setup["clients"]["a1"].delete(_url(setup, f"{pk}/")).status_code == 403
        assert setup["clients"]["admin"].delete(_url(setup, f"{pk}/")).status_code == 204
        assert not Holiday.objects.exists()

    def test_one_holiday_a_day(self, setup):
        _holiday(setup, date(2026, 11, 9), "Diwali")
        other = _holiday(setup, date(2026, 11, 10), "New Year")
        hr = setup["clients"]["hr"]
        response = hr.post(_url(setup), {"date": "2026-11-09", "name": "Lakshmi Puja"}, format="json")
        assert response.status_code == 400 and "Diwali" in response.json()["error"]
        response = hr.patch(_url(setup, f"{other.id}/"), {"date": "2026-11-09"}, format="json")
        assert response.status_code == 400
        # a deleted holiday frees its day
        Holiday.objects.get(name="Diwali").delete()
        assert hr.post(_url(setup), {"date": "2026-11-09", "name": "Lakshmi Puja"}, format="json").status_code == 201

    @pytest.mark.parametrize(
        "data",
        [
            {"name": "Diwali"},
            {"date": "09-11-2026", "name": "Diwali"},
            {"date": "2026-11-09", "name": "   "},
            {"date": "2026-11-09", "name": "x" * 101},
            {"date": "2026-11-09", "name": "Diwali", "kind": "bank"},
            {"date": "1999-11-09", "name": "Diwali"},
        ],
    )
    def test_what_isnt_accepted(self, setup, data):
        assert setup["clients"]["hr"].post(_url(setup), data, format="json").status_code == 400

    def test_another_workspaces_holiday_isnt_reachable(self, setup):
        from plane.db.models import Workspace

        other = Workspace.objects.create(name="Other", slug="other-ws", owner=setup["people"]["admin"])
        holiday = Holiday.objects.create(workspace=other, date=date(2026, 1, 1), name="New Year")
        response = setup["clients"]["hr"].delete(_url(setup, f"{holiday.id}/"))
        assert response.status_code == 404 and Holiday.objects.filter(id=holiday.id).exists()


@pytest.mark.contract
class TestCopyAndImport:
    def test_copy_last_year(self, setup):
        _holiday(setup, date(2025, 1, 14), "Uttarayan")
        _holiday(setup, date(2025, 10, 21), "Diwali", kind="optional")
        _holiday(setup, date(2025, 12, 25), "Christmas")
        _holiday(setup, date(2026, 12, 25), "Christmas Day")  # already there
        response = setup["clients"]["hr"].post(
            _url(setup, "copy/"), {"from_year": 2025, "to_year": 2026}, format="json"
        )
        assert response.status_code == 201 and response.json()["created"] == 2 and response.json()["skipped"] == 1
        copied = {h.date: (h.name, h.kind) for h in Holiday.objects.filter(date__year=2026)}
        assert copied == {
            date(2026, 1, 14): ("Uttarayan", "holiday"),
            date(2026, 10, 21): ("Diwali", "optional"),
            date(2026, 12, 25): ("Christmas Day", "holiday"),
        }
        assert (
            setup["clients"]["a1"].post(_url(setup, "copy/"), {"from_year": 2025, "to_year": 2027}).status_code == 403
        )
        empty = setup["clients"]["hr"].post(_url(setup, "copy/"), {"from_year": 2024, "to_year": 2027}, format="json")
        assert empty.status_code == 400

    def test_import_a_csv(self, setup):
        _holiday(setup, date(2026, 12, 25), "Christmas")
        content = (
            "Holiday,Date,Day,Type\n"
            "Uttarayan,14-01-2026,Wednesday,Holiday\n"
            "Republic Day,26 Jan 2026,Monday,\n"
            "Janmashthami,04/09/2026,Friday,Optional holiday\n"
            "Christmas,2026-12-25,Friday,\n"
            ",,,\n"
        ).encode()
        response = _upload(setup, "hr", "holidays.csv", content)
        assert response.status_code == 201, response.content
        assert response.json()["created"] == 3 and response.json()["skipped"] == 1
        saved = {h.date: (h.name, h.kind) for h in Holiday.objects.all()}
        assert saved[date(2026, 1, 14)] == ("Uttarayan", "holiday")
        assert saved[date(2026, 9, 4)] == ("Janmashthami", "optional")
        assert saved[date(2026, 12, 25)] == ("Christmas", "holiday")

    def test_import_an_excel_file(self, setup):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["Holidays 2026"])
        sheet.append(["Date", "Holiday Name", "Floater"])
        sheet.append([datetime(2026, 8, 15), "Independence Day", "No"])
        sheet.append([datetime(2026, 8, 28), "Rakshabandhan", "Yes"])
        buffer = io.BytesIO()
        workbook.save(buffer)
        response = _upload(setup, "admin", "Holiday list.xlsx", buffer.getvalue())
        assert response.status_code == 201, response.content
        assert {h.name: h.kind for h in Holiday.objects.all()} == {
            "Independence Day": "holiday",
            "Rakshabandhan": "optional",
        }

    def test_nothing_is_added_while_a_row_has_a_problem(self, setup):
        content = b"Date,Holiday\n2026-01-14,Uttarayan\nsoon,Diwali\n2026-03-04,\n2026-01-14,Again\n"
        response = _upload(setup, "hr", "holidays.csv", content)
        assert response.status_code == 400
        assert [row["row"] for row in response.json()["rows"]] == [3, 4, 5]
        assert not Holiday.objects.exists()

    def test_files_it_cant_use(self, setup):
        assert _upload(setup, "hr", "holidays.txt", b"Date,Holiday\n").status_code == 400
        assert _upload(setup, "hr", "holidays.csv", b"When,What\n2026-01-14,Uttarayan\n").status_code == 400
        assert _upload(setup, "a1", "holidays.csv", b"Date,Holiday\n2026-01-14,Uttarayan\n").status_code == 403

    @pytest.mark.parametrize(
        "text",
        [
            "2026-01-14",
            "14-01-2026",
            "14/01/2026",
            "14 Jan 2026",
            "14-Jan-2026",
            "Wednesday, 14 January 2026",
            "14th Jan 2026",
            "Jan 14, 2026",
        ],
    )
    def test_date_formats(self, text):
        assert parse_date(text) == date(2026, 1, 14)

    def test_types(self):
        assert parse_kind("") == "holiday" and parse_kind("Public Holiday") == "holiday"
        assert parse_kind("Restricted holiday") == "optional" and parse_kind("Floater") == "optional"
        assert parse_kind("Bank") is None


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


def _attendance(setup, query="from_date=2026-11-01&to_date=2026-11-23"):
    response = setup["clients"]["hr"].get(
        f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/attendance/?{query}"
    )
    assert response.status_code == 200, response.content
    return response.json()


def _row(report, setup, who):
    return next(e for e in report["employees"] if e["id"] == str(setup["people"][who].id))


@pytest.mark.contract
class TestAttendance:
    def test_a_holiday_is_not_an_absence(self, setup):
        _holiday(setup, date(2026, 11, 9), "Diwali")
        _holiday(setup, date(2026, 11, 10), "New Year")
        _log(setup, "a1", "shared_a1", datetime(2026, 11, 10, 10, 0, tzinfo=IST), 90)  # worked on New Year
        report = _attendance(setup)

        a1 = _row(report, setup, "a1")
        assert a1["days"]["2026-11-09"]["status"] == "holiday"
        assert a1["days"]["2026-11-10"] == {"status": "holiday_worked", "minutes": 90, "entries": 1}
        assert a1["days"]["2026-11-11"]["status"] == "absent"
        # 15 weekdays from 2 to 20 Nov, two of them holidays
        assert a1["summary"]["absent"] == 13 and a1["summary"]["present"] == 0
        assert a1["summary"]["holidays"] == 2 and a1["summary"]["holiday_worked"] == 1
        assert a1["summary"]["total_minutes"] == 90 and a1["summary"]["days_worked"] == 1
        assert _row(report, setup, "a2")["summary"]["absent"] == 13

        diwali = next(day for day in report["days"] if day["date"] == "2026-11-09")
        assert diwali["is_holiday"] is True and diwali["holiday"] == {"name": "Diwali", "kind": "holiday"}
        assert diwali["absent"] == 0
        assert report["totals"]["working_days"] == 13 and report["totals"]["holidays"] == 2

    def test_an_optional_holiday_stays_a_working_day(self, setup):
        _holiday(setup, date(2026, 11, 11), "Bhai Duj", kind="optional")
        report = _attendance(setup)
        assert _row(report, setup, "a1")["days"]["2026-11-11"]["status"] == "absent"
        day = next(day for day in report["days"] if day["date"] == "2026-11-11")
        assert day["is_holiday"] is False and day["holiday"] == {"name": "Bhai Duj", "kind": "optional"}
        assert report["totals"]["holidays"] == 0

    def test_on_a_weekend_before_joining_and_ahead(self, setup):
        _holiday(setup, date(2026, 11, 14), "Weekend festival")  # a Saturday
        _holiday(setup, date(2026, 11, 3), "Early holiday")
        _holiday(setup, date(2026, 11, 26), "Coming up")
        WorkspaceMember.objects.filter(workspace=setup["workspace"], member=setup["people"]["a2"]).update(
            created_at=datetime(2026, 11, 5, 9, 0, tzinfo=IST)
        )
        report = _attendance(setup, "from_date=2026-11-01&to_date=2026-11-30")
        a1, a2 = _row(report, setup, "a1"), _row(report, setup, "a2")
        assert a1["days"]["2026-11-14"]["status"] == "holiday"
        assert a1["summary"]["week_off"] == 8 and a1["summary"]["holidays"] == 3
        assert a2["days"]["2026-11-03"]["status"] == "not_joined"
        assert a1["days"]["2026-11-26"]["status"] == "holiday"

    def test_the_files_mark_holidays(self, setup):
        _holiday(setup, date(2026, 11, 9), "Diwali")
        _holiday(setup, date(2026, 11, 11), "Bhai Duj", kind="optional")
        response = setup["clients"]["hr"].get(
            f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/attendance/download/"
            "?from_date=2026-11-01&to_date=2026-11-23&type=xlsx"
        )
        assert response.status_code == 200
        sheet = load_workbook(io.BytesIO(response.content)).active
        assert "H = Holiday" in sheet["A2"].value
        header = [cell.value for cell in sheet[3]]
        assert "Mon 09 Nov (Diwali)" in header and "Wed 11 Nov (Bhai Duj, optional)" in header
        assert "Holidays" in header and "Worked on Holiday" in header
        diwali = header.index("Mon 09 Nov (Diwali)")
        a1 = next(row for row in sheet.iter_rows(min_row=4) if row[0].value == setup["people"]["a1"].display_name)
        assert a1[diwali].value == "H" and a1[diwali].fill.fgColor.rgb.endswith("FFF1C2")
        assert a1[header.index("Holidays")].value == 1

        csv_response = setup["clients"]["hr"].get(
            f"/api/workspaces/{setup['workspace'].slug}/worklog-reports/attendance/download/"
            "?from_date=2026-11-01&to_date=2026-11-23&type=csv"
        )
        assert "Mon 09 Nov (Diwali)" in csv_response.content.decode()
