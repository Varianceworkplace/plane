# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Attendance (Reports › Attendance): every employee's worked hours day by day, in one grid, from their time entries.

Each day of each employee is one of:
  * present          - a working day (Monday to Friday) with time logged: the hours
  * absent           - a working day that is over, with no time logged
  * week_off         - Saturday or Sunday
  * week_off_worked  - Saturday or Sunday with time logged: the hours
  * holiday          - a day on the company's holiday list (sidebar › Holidays), also on a weekend
  * holiday_worked   - a holiday with time logged: the hours
  * today            - today, not over yet, nothing logged so far (not counted as absent)
  * upcoming         - a day after today
  * not_joined       - before they joined the workspace
  * inactive         - they're disabled or removed and logged nothing that day (not counted as absent)

An optional holiday stays a working day (it's in `days` with its name, so the column can say so).

Days are the company's: the workspace's time zone (Workspace settings › General), or India time while that's still
the default UTC, so everyone sees the same days. A time entry counts on the day it started (timer entries) or was
logged (manual ones), as on the Time Sheet.

Who appears, as on the Time Sheet: HR and workspace admins see everyone, Project Managers the people in the teams
they lead, the levels above see the levels below in their team, everyone sees themselves. ?logged_by=, ?team=
(departments) and ?pm= narrow it as on the other reports. ?from_date=&to_date= (YYYY-MM-DD, both inclusive) default to
this month so far.
"""

# Python imports
import csv
import io
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

# Django imports
from django.db.models import Count, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.http import HttpResponse
from django.utils import timezone

# Third party imports
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import HolidayKind, Workspace, WorkspaceMember
from plane.utils.csv_utils import sanitize_csv_row
from plane.utils.holidays import holidays_between

from .base import format_duration, serialize_user
from .report import (
    ReportBaseEndpoint,
    ReportFilterError,
    _parse_date,
    report_people,
    report_scope,
    serialize_scope,
    visible_worklogs,
)

# Saturday and Sunday (date.weekday())
WEEK_OFF_DAYS = {5, 6}
# the company's days while the workspace's time zone is still the default UTC
DEFAULT_TIMEZONE = "Asia/Kolkata"
# a readable grid on screen; files may cover a year
MAX_SCREEN_DAYS = 62
MAX_EXPORT_DAYS = 366


def _now():
    """The moment the report is read (tests set it)."""
    return timezone.now()


def attendance_timezone(workspace):
    name = workspace.timezone if workspace.timezone and workspace.timezone != "UTC" else DEFAULT_TIMEZONE
    try:
        return ZoneInfo(name), name
    except Exception:
        return ZoneInfo(DEFAULT_TIMEZONE), DEFAULT_TIMEZONE


def attendance_range(request, today, max_days):
    """(from_date, to_date) from the request, this month so far by default. Raises ReportFilterError."""
    from_date = _parse_date(request.GET.get("from_date"), "from_date") or today.replace(day=1)
    to_date = _parse_date(request.GET.get("to_date"), "to_date") or today
    if from_date > to_date:
        raise ReportFilterError({"to_date": "The end date must be on or after the start date."})
    if (to_date - from_date).days + 1 > max_days:
        raise ReportFilterError(
            {"to_date": f"Pick at most {max_days} days here (about {max_days // 31} months); export a longer range."}
        )
    return from_date, to_date


def visible_people(request, slug, scope):
    """The people the viewer may see (None = everyone in the workspace), narrowed by ?logged_by= ?team= ?pm=."""
    profile = scope.get("rbac")
    if profile is not None:
        visible = profile.worklog_people_ids()
    else:
        visible = None if scope["is_workspace_admin"] else {request.user.id}
    narrowed = report_people(request, slug)
    if visible is None:
        return narrowed
    return visible if narrowed is None else visible & narrowed


def build_attendance(request, slug, max_days=MAX_SCREEN_DAYS):
    workspace = Workspace.objects.get(slug=slug)
    tz, tz_name = attendance_timezone(workspace)
    today = _now().astimezone(tz).date()
    from_date, to_date = attendance_range(request, today, max_days)
    scope = report_scope(request.user, slug, request)

    members = WorkspaceMember.objects.filter(workspace=workspace, member__is_bot=False).select_related("member")
    people = visible_people(request, slug, scope)
    if people is not None:
        members = members.filter(member_id__in=people)
    members = list(members)

    # minutes per person per day, in the company's days
    start = datetime.combine(from_date, time.min, tzinfo=tz)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=tz)
    worked = {
        (row["logged_by_id"], row["work_date"]): row
        for row in visible_worklogs(request.user, slug, scope)
        .filter(logged_by_id__in=[m.member_id for m in members])
        .annotate(work_at=Coalesce("started_at", "created_at"))
        .filter(work_at__gte=start, work_at__lt=end)
        .annotate(work_date=TruncDate("work_at", tzinfo=tz))
        .order_by()
        .values("logged_by_id", "work_date")
        .annotate(minutes=Sum("duration"), entries=Count("id"))
    }

    days = [from_date + timedelta(days=n) for n in range((to_date - from_date).days + 1)]
    holidays = holidays_between(workspace.id, from_date, to_date)
    # days off for everyone; an optional holiday stays a working day
    days_off = {day for day, holiday in holidays.items() if holiday.kind == HolidayKind.HOLIDAY}
    day_totals = {day: {"minutes": 0, "present": 0, "absent": 0} for day in days}
    employees = []
    for membership in members:
        active = membership.is_active and membership.member.is_active
        joined = membership.created_at.astimezone(tz).date()
        if not active and not any((membership.member_id, day) in worked for day in days):
            continue  # left before this range
        cells, summary = (
            {},
            {
                "working_days": 0,
                "present": 0,
                "absent": 0,
                "week_off": 0,
                "week_off_worked": 0,
                "holidays": 0,
                "holiday_worked": 0,
                "total_minutes": 0,
                "days_worked": 0,
            },
        )
        for day in days:
            row = worked.get((membership.member_id, day))
            minutes = (row["minutes"] or 0) if row else 0
            holiday = day in days_off
            week_off = day.weekday() in WEEK_OFF_DAYS
            if minutes:
                state = "holiday_worked" if holiday else "week_off_worked" if week_off else "present"
            elif day < joined:
                state = "not_joined"
            elif holiday:
                state = "holiday"  # known ahead, like weekends
            elif week_off:
                state = "week_off"  # known ahead: future weekends too
            elif day > today:
                state = "upcoming"
            elif not active:
                state = "inactive"
            elif day == today:
                state = "today"
            else:
                state = "absent"
            cells[day.isoformat()] = {"status": state, "minutes": minutes, "entries": row["entries"] if row else 0}

            if holiday:
                summary["holidays"] += 1
            elif week_off:
                summary["week_off"] += 1
            if state in ("present", "absent"):
                summary["working_days"] += 1
            if state == "present":
                summary["present"] += 1
                day_totals[day]["present"] += 1
            elif state == "absent":
                summary["absent"] += 1
                day_totals[day]["absent"] += 1
            elif state == "week_off_worked":
                summary["week_off_worked"] += 1
            elif state == "holiday_worked":
                summary["holiday_worked"] += 1
            if minutes:
                summary["days_worked"] += 1
                summary["total_minutes"] += minutes
                day_totals[day]["minutes"] += minutes
        summary["average_minutes"] = summary["total_minutes"] / summary["days_worked"] if summary["days_worked"] else 0
        employees.append(
            {
                **serialize_user(membership.member),
                "email": membership.member.email,
                "is_active": active,
                "joined_on": joined.isoformat(),
                "days": cells,
                "summary": summary,
            }
        )

    employees.sort(key=lambda e: (not e["is_active"], (e["display_name"] or "").lower()))
    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "today": today.isoformat(),
        "timezone": tz_name,
        "days": [
            {
                "date": day.isoformat(),
                "weekday": day.isoweekday(),
                "is_week_off": day.weekday() in WEEK_OFF_DAYS,
                "is_holiday": day in days_off,
                "holiday": ({"name": holidays[day].name, "kind": holidays[day].kind} if day in holidays else None),
                "is_upcoming": day > today,
                "total_minutes": day_totals[day]["minutes"],
                "present": day_totals[day]["present"],
                "absent": day_totals[day]["absent"],
            }
            for day in days
        ],
        "employees": employees,
        "totals": {
            "employees": len(employees),
            "total_minutes": sum(e["summary"]["total_minutes"] for e in employees),
            "present": sum(e["summary"]["present"] for e in employees),
            "absent": sum(e["summary"]["absent"] for e in employees),
            "working_days": sum(
                1 for day in days if day.weekday() not in WEEK_OFF_DAYS and day not in days_off and day < today
            ),
            "holidays": len(days_off),
        },
        "scope": serialize_scope(scope),
    }


class AttendanceReportEndpoint(ReportBaseEndpoint):
    """The attendance grid for the screen (at most MAX_SCREEN_DAYS days)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        try:
            return Response(build_attendance(request, slug), status=status.HTTP_200_OK)
        except ReportFilterError as error:
            return Response(error.args[0], status=status.HTTP_400_BAD_REQUEST)


def cell_text(cell):
    if cell["minutes"]:
        return format_duration(cell["minutes"])
    return {"absent": "A", "week_off": "WO", "holiday": "H", "not_joined": "—", "inactive": "—", "today": "—"}.get(
        cell["status"], ""
    )


SUMMARY_HEADERS = [
    "Present",
    "Absent",
    "Week Off",
    "Worked on Week Off",
    "Holidays",
    "Worked on Holiday",
    "Total time",
    "Total hours",
    "Avg / day",
]


def day_heading(day):
    """The column heading: "Mon 09 Nov", with the holiday's name on a holiday."""
    heading = date.fromisoformat(day["date"]).strftime("%a %d %b")
    holiday = day.get("holiday")
    if not holiday:
        return heading
    optional = ", optional" if holiday["kind"] == HolidayKind.OPTIONAL else ""
    return f"{heading} ({holiday['name']}{optional})"


def attendance_rows(report):
    """Header, one row per employee, the day totals; and the status of each employee cell (for colours)."""
    days = [date.fromisoformat(day["date"]) for day in report["days"]]
    header = ["Employee", "Email", *[day_heading(day) for day in report["days"]], *SUMMARY_HEADERS]
    rows, statuses = [header], []
    for employee in report["employees"]:
        summary = employee["summary"]
        cells = [employee["days"][day.isoformat()] for day in days]
        rows.append(
            [
                employee["display_name"],
                employee.get("email") or "",
                *[cell_text(cell) for cell in cells],
                summary["present"],
                summary["absent"],
                summary["week_off"],
                summary["week_off_worked"],
                summary["holidays"],
                summary["holiday_worked"],
                format_duration(summary["total_minutes"]),
                round(summary["total_minutes"] / 60, 2),
                format_duration(summary["average_minutes"]),
            ]
        )
        statuses.append([cell["status"] for cell in cells])
    rows.append(
        [
            "Total hours",
            "",
            *[format_duration(day["total_minutes"]) if day["total_minutes"] else "" for day in report["days"]],
            report["totals"]["present"],
            report["totals"]["absent"],
            "",
            "",
            "",
            "",
            format_duration(report["totals"]["total_minutes"]),
            round(report["totals"]["total_minutes"] / 60, 2),
            "",
        ]
    )
    rows.append(["Present", "", *[day["present"] or "" for day in report["days"]], *[""] * len(SUMMARY_HEADERS)])
    return rows, statuses


FILLS = {
    "absent": PatternFill("solid", fgColor="FDE2E1"),
    "week_off": PatternFill("solid", fgColor="EEEEEE"),
    "week_off_worked": PatternFill("solid", fgColor="E3ECFB"),
    "holiday": PatternFill("solid", fgColor="FFF1C2"),
    "holiday_worked": PatternFill("solid", fgColor="E3ECFB"),
    "present": PatternFill("solid", fgColor="E6F4EA"),
}


class AttendanceReportDownloadEndpoint(BaseAPIView):
    """?type=csv|xlsx: the same grid as the screen, for up to a year. Excel colours Absent, Week Off, Holiday and
    worked days."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        file_format = request.GET.get("type", "xlsx")
        if file_format not in ("csv", "xlsx"):
            return Response({"error": "Type must be csv or xlsx."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            report = build_attendance(request, slug, max_days=MAX_EXPORT_DAYS)
        except ReportFilterError as error:
            return Response(error.args[0], status=status.HTTP_400_BAD_REQUEST)
        rows, statuses = attendance_rows(report)
        filename = f"{slug}-attendance-{report['from_date']}-to-{report['to_date']}"

        if file_format == "csv":
            response = HttpResponse(content_type="text/csv")
            response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
            writer = csv.writer(response)
            for row in rows:
                writer.writerow(sanitize_csv_row(row))
            return response

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Attendance"
        sheet.append([f"Attendance {report['from_date']} to {report['to_date']} ({report['timezone']})"])
        sheet.append(["A = Absent, WO = Week Off, H = Holiday; hours on a day = time logged that day"])
        for row in rows:
            sheet.append(sanitize_csv_row(row))
        first_row = 3  # the header
        day_count = len(report["days"])
        for cell in sheet[first_row]:
            cell.font = Font(bold=True)
            cell.alignment = Alignment(horizontal="center", wrap_text=True)
        for index, day in enumerate(report["days"]):
            if day["is_holiday"]:
                sheet.cell(row=first_row, column=3 + index).fill = FILLS["holiday"]
        for offset, row_statuses in enumerate(statuses, start=1):
            for index, state in enumerate(row_statuses):
                fill = FILLS.get(state)
                cell = sheet.cell(row=first_row + offset, column=3 + index)
                cell.alignment = Alignment(horizontal="center")
                if fill:
                    cell.fill = fill
        for row_index in (sheet.max_row - 1, sheet.max_row):
            for cell in sheet[row_index]:
                cell.font = Font(bold=True)
        sheet.column_dimensions["A"].width = 26
        sheet.column_dimensions["B"].width = 30
        for column in range(3, 3 + day_count):
            sheet.column_dimensions[get_column_letter(column)].width = 11
        for column in range(3 + day_count, 3 + day_count + len(SUMMARY_HEADERS)):
            sheet.column_dimensions[get_column_letter(column)].width = 13
        sheet.freeze_panes = sheet.cell(row=first_row + 1, column=3)

        buffer = io.BytesIO()
        workbook.save(buffer)
        response = HttpResponse(
            buffer.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}.xlsx"'
        return response


__all__ = ["AttendanceReportDownloadEndpoint", "AttendanceReportEndpoint"]
