# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Report analytics: the numbers behind the report charts (daily, weekly, monthly, quarterly and yearly reports, and
the extra charts on the project-wise and user-wise reports).

  * Same filters as the other reports (see report.py), plus ?period=day|week|month|quarter|year, which splits the
    date range into days, weeks (Monday to Sunday), months, quarters (Q1 = January to March) or years. Without
    dates a period report covers the last 14 days, 8 weeks, 6 months, 4 quarters or 2 years; without a period there
    are no time series, just totals for the date range (or for all time).
  * Dates are in the requesting user's timezone.
  * Who sees what:
      - worked time follows the Worklogs permission, as in the other reports
      - work items and tickets follow the Analytics permission (all / team / member / own); with role-based access
        off, workspace admins see everything, project admins their projects and members their own work items
      - milestones: the projects whose milestones the person may see (the Project Milestones page)
  * Work items in a date range: those created by its end and not completed before its start. "Completed" means
    completed within the range (the work item's completion date), the rest of them are pending. Cancelled work items
    only show in the status split.
  * Productivity: expected time of the work items someone completed in the range, against the time they logged in it.
  * Departments are the workspace's teams: their members' numbers added up.
  * Projects count as completed (status Completed or Delivered in their project details) in the period their actual
    end date falls in; milestones by their
    actual completion date (or their end date, when marked completed without one).
  * Tickets aren't part of projects, so a project filter leaves them out.
"""

# Python imports
from datetime import date, datetime, time, timedelta

# Django imports
from django.db.models import Count, DateField, Exists, OuterRef, Q, Sum
from django.db.models.functions import ExtractIsoWeekDay, Trunc
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.milestone.base import workspace_milestones
from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueTimeEstimate,
    MemberGroup,
    Project,
    ProjectDetail,
    ProjectMember,
    TeamMember,
    User,
)
from plane.db.models.workspace import Team
from plane.utils.work_item_visibility import all_work_items

from .base import _uuid_list, serialize_user
from .report import (
    REPORT_STATE_GROUPS,
    ReportBaseEndpoint,
    _parse_date,
    report_people,
    serialize_scope,
    user_timezone,
)

PERIODS = ["day", "week", "month", "quarter", "year"]
OPEN_GROUPS = ["backlog", "unstarted", "started"]
COMPLETED_PROJECT_STATUSES = ["completed", "delivered"]


# ------------------------------------------------------------------ periods


def bucket_start(day, period):
    if period == "day":
        return day
    if period == "week":
        return day - timedelta(days=day.weekday())
    if period == "month":
        return day.replace(day=1)
    if period == "quarter":
        return date(day.year, 3 * ((day.month - 1) // 3) + 1, 1)
    return date(day.year, 1, 1)


def next_bucket(start, period):
    if period == "day":
        return start + timedelta(days=1)
    if period == "week":
        return start + timedelta(days=7)
    months = {"month": 1, "quarter": 3, "year": 12}[period]
    month = start.month - 1 + months
    return date(start.year + month // 12, month % 12 + 1, 1)


def default_start(end, period):
    """The start of the last 14 days, 8 weeks, 6 months, 4 quarters or 2 years up to `end`."""
    if period == "day":
        return end - timedelta(days=13)
    start = bucket_start(end, period)
    for _ in range({"week": 7, "month": 5, "quarter": 3, "year": 1}[period]):
        start = bucket_start(start - timedelta(days=1), period)
    return start


def period_buckets(start, end, period):
    buckets, current = [], bucket_start(start, period)
    while current <= end:
        following = next_bucket(current, period)
        buckets.append({"key": current.isoformat(), "start": current, "end": following - timedelta(days=1)})
        current = following
    return buckets


def bucketed(queryset, field, period, tz, **aggregates):
    """{bucket start (date): {aggregate: value}} for `field` truncated to the period in the user's timezone."""
    rows = (
        queryset.order_by()
        .annotate(bucket=Trunc(field, period, output_field=DateField(), tzinfo=tz))
        .values("bucket")
        .annotate(**aggregates)
    )
    return {row["bucket"]: row for row in rows}


# ------------------------------------------------------------------ who sees which work items and tickets


def own_work_item_q(user_id):
    assignees = IssueAssignee.all_objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
    return Exists(assignees.filter(assignee_id=user_id)) | (~Exists(assignees) & Q(created_by_id=user_id))


def work_item_reach(user, scope):
    profile = scope.get("rbac")
    if profile is not None:
        return profile.work_item_q("view", module="analytics")
    if scope["is_workspace_admin"]:
        return Q()
    return Q(project_id__in=scope["admin_project_ids"]) | (
        Q(project_id__in=scope["member_project_ids"]) & own_work_item_q(user.id)
    )


def ticket_reach(user, scope):
    """Admins and HR (Analytics: All) see every ticket, project managers their team's, everyone else their own:
    the tickets they raised or are assigned to."""
    profile = scope.get("rbac")
    if profile is None:
        people = None if scope["is_workspace_admin"] else {user.id}
    else:
        scopes = profile.scopes("analytics", "view")
        if "all" in scopes:
            people = None
        elif not scopes:
            return Q(pk__in=[])
        else:
            people = {user.id}
            if "team" in scopes:
                people |= profile.led_member_ids
            if "member" in scopes:
                people |= set(
                    ProjectMember.objects.filter(
                        project_id__in=profile.member_project_ids, is_active=True, member__isnull=False
                    ).values_list("member_id", flat=True)
                )
    if people is None:
        return Q()
    return Q(created_by_id__in=people) | Exists(
        IssueAssignee.all_objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True, assignee_id__in=people)
    )


def assigned_to(people):
    return Exists(
        IssueAssignee.all_objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True, assignee_id__in=people)
    )


# ------------------------------------------------------------------ the report


class AnalyticsReport:
    def __init__(self, request, slug, scope, worklogs, period, start, end):
        self.request, self.slug, self.scope = request, slug, scope
        self.user = request.user
        self.period, self.start, self.end = period, start, end
        self.tz = user_timezone(request.user)
        self.buckets = period_buckets(start, end, period) if period and start and end else []
        self.start_at = datetime.combine(start, time.min, tzinfo=self.tz) if start else None
        self.end_at = datetime.combine(end + timedelta(days=1), time.min, tzinfo=self.tz) if end else None
        self.projects = _uuid_list(request.GET.get("project"))
        self.people = report_people(request, slug)
        self.state_groups = [g for g in (request.GET.get("state_group") or "").split(",") if g in REPORT_STATE_GROUPS]

        self.worklogs = worklogs
        if self.start_at:
            self.worklogs = self.worklogs.filter(work_at__gte=self.start_at)
        if self.end_at:
            self.worklogs = self.worklogs.filter(work_at__lt=self.end_at)

        # every work item the person's Analytics permission reaches, filtered like the worklogs
        with all_work_items():
            items = Issue.issue_objects.filter(workspace__slug=slug)
        items = items.filter(work_item_reach(self.user, scope))
        if self.projects:
            items = items.filter(project_id__in=self.projects)
        if self.state_groups:
            items = items.filter(state__group__in=self.state_groups)
        if self.people is not None:
            items = items.filter(assigned_to(self.people))
        if self.end_at:
            items = items.filter(created_at__lt=self.end_at)
        if self.start_at:
            items = items.exclude(completed_at__lt=self.start_at, state__group="completed")
        self.items = items
        self.active = items.exclude(state__group="cancelled")
        # completed within the range
        self.completed = {"state__group": "completed"}
        if self.start_at:
            self.completed["completed_at__gte"] = self.start_at
        if self.end_at:
            self.completed["completed_at__lt"] = self.end_at
        self.completed_q = Q(**self.completed)

    # ---------------------------------------------------------- pieces

    def work_item_totals(self):
        totals = self.active.aggregate(
            total=Count("id", distinct=True), completed=Count("id", distinct=True, filter=self.completed_q)
        )
        created = self.items
        if self.start_at:
            created = created.filter(created_at__gte=self.start_at)
        return {
            "tasks_total": totals["total"],
            "tasks_completed": totals["completed"],
            "tasks_pending": totals["total"] - totals["completed"],
            "tasks_created": created.count(),
        }

    def status_groups(self):
        rows = self.items.order_by().values("state__group").annotate(count=Count("id", distinct=True))
        result = {group: 0 for group in REPORT_STATE_GROUPS}
        for row in rows:
            if row["state__group"] in result:
                result[row["state__group"]] = row["count"]
        return result

    def priorities(self):
        rows = self.active.order_by().values("priority").annotate(count=Count("id", distinct=True))
        result = {key: 0 for key in ("urgent", "high", "medium", "low", "none")}
        for row in rows:
            result[row["priority"] or "none"] = row["count"]
        return result

    def employees(self):
        worked = {
            row["logged_by_id"]: row
            for row in self.worklogs.order_by()
            .values("logged_by_id")
            .annotate(worked=Sum("duration"), entries=Count("id"))
        }
        assignments = IssueAssignee.objects.filter(issue_id__in=self.active.values("id"))
        if self.people is not None:
            assignments = assignments.filter(assignee_id__in=self.people)
        completed_q = Q(**{f"issue__{key}": value for key, value in self.completed.items()})
        tasks = {
            row["assignee_id"]: row
            for row in assignments.order_by()
            .values("assignee_id")
            .annotate(
                assigned=Count("issue_id", distinct=True),
                completed=Count("issue_id", distinct=True, filter=completed_q),
                expected=Sum("issue__time_estimate__expected_duration"),
                completed_expected=Sum("issue__time_estimate__expected_duration", filter=completed_q),
            )
        }
        rows = []
        for person in User.objects.filter(id__in={*worked, *tasks}):
            log = worked.get(person.id, {})
            task = tasks.get(person.id, {})
            worked_duration = log.get("worked") or 0
            completed_expected = task.get("completed_expected") or 0
            rows.append(
                {
                    **serialize_user(person),
                    "worked_duration": worked_duration,
                    "worklog_count": log.get("entries", 0),
                    "expected_duration": task.get("expected") or 0,
                    "tasks_assigned": task.get("assigned", 0),
                    "tasks_completed": task.get("completed", 0),
                    "tasks_pending": task.get("assigned", 0) - task.get("completed", 0),
                    "completed_expected_duration": completed_expected,
                    "productivity": round(completed_expected * 100 / worked_duration) if worked_duration else None,
                }
            )
        rows.sort(key=lambda r: (-r["worked_duration"], -r["tasks_assigned"], (r["display_name"] or "").lower()))
        return rows

    def projects_breakdown(self):
        worked = {}
        for row in (
            self.worklogs.order_by()
            .values("project_id", "logged_by_id")
            .annotate(worked=Sum("duration"), entries=Count("id"))
        ):
            project = worked.setdefault(row["project_id"], {"worked": 0, "entries": 0, "people": {}})
            project["worked"] += row["worked"]
            project["entries"] += row["entries"]
            project["people"][row["logged_by_id"]] = row["worked"]
        tasks = {}
        for row in (
            self.items.order_by().values("project_id", "state__group").annotate(count=Count("id", distinct=True))
        ):
            groups = tasks.setdefault(row["project_id"], {group: 0 for group in REPORT_STATE_GROUPS})
            if row["state__group"] in groups:
                groups[row["state__group"]] = row["count"]
        completed = {
            row["project_id"]: row["count"]
            for row in self.active.filter(self.completed_q)
            .order_by()
            .values("project_id")
            .annotate(count=Count("id", distinct=True))
        }
        project_ids = {*worked, *tasks}
        per_bucket = self.project_buckets()
        projects = Project.all_objects.filter(id__in=project_ids).only("id", "name", "identifier")
        rows = []
        for project in projects:
            log = worked.get(project.id, {"worked": 0, "entries": 0, "people": {}})
            groups = tasks.get(project.id, {group: 0 for group in REPORT_STATE_GROUPS})
            total = sum(count for group, count in groups.items() if group != "cancelled")
            done = completed.get(project.id, 0)
            rows.append(
                {
                    "id": str(project.id),
                    "name": project.name,
                    "identifier": project.identifier,
                    "worked_duration": log["worked"],
                    "worklog_count": log["entries"],
                    "employees": len(log["people"]),
                    "people": [
                        {"id": str(person_id), "worked_duration": minutes}
                        for person_id, minutes in sorted(log["people"].items(), key=lambda item: -item[1])
                    ],
                    "tasks_total": total,
                    "tasks_completed": done,
                    "tasks_pending": total - done,
                    "status_groups": groups,
                    "series": [
                        {
                            "key": bucket["key"],
                            "worked_duration": per_bucket.get(project.id, {}).get(bucket["start"], {}).get("worked", 0),
                            "tasks_completed": per_bucket.get(project.id, {}).get(bucket["start"], {}).get("done", 0),
                        }
                        for bucket in self.buckets
                    ],
                }
            )
        rows.sort(key=lambda r: (-r["worked_duration"], -r["tasks_total"], r["name"].lower()))
        return rows

    def project_buckets(self):
        """{project id: {bucket start: {"worked": minutes, "done": completed work items}}} for the period charts."""
        result = {}
        if not self.buckets:
            return result
        trunc = {"output_field": DateField(), "tzinfo": self.tz}
        for row in (
            self.worklogs.order_by()
            .annotate(bucket=Trunc("work_at", self.period, **trunc))
            .values("project_id", "bucket")
            .annotate(worked=Sum("duration"))
        ):
            result.setdefault(row["project_id"], {}).setdefault(row["bucket"], {})["worked"] = row["worked"]
        for row in (
            self.active.filter(self.completed_q)
            .order_by()
            .annotate(bucket=Trunc("completed_at", self.period, **trunc))
            .values("project_id", "bucket")
            .annotate(done=Count("id", distinct=True))
        ):
            result.setdefault(row["project_id"], {}).setdefault(row["bucket"], {})["done"] = row["done"]
        return result

    def departments(self, employees):
        """Each team with people in the report: its members' numbers added up."""
        people = {row["id"]: row for row in employees}
        keys = ("worked_duration", "expected_duration", "tasks_assigned", "tasks_completed", "tasks_pending")
        teams = {}
        for team_id, name, member_id in TeamMember.objects.filter(
            workspace__slug=self.slug, team__deleted_at__isnull=True
        ).values_list("team_id", "team__name", "member_id"):
            person = people.get(str(member_id))
            if person is None:
                continue
            team = teams.setdefault(
                team_id,
                {
                    "id": str(team_id),
                    "name": name,
                    "employees": 0,
                    "completed_expected_duration": 0,
                    **dict.fromkeys(keys, 0),
                },
            )
            team["employees"] += 1
            team["completed_expected_duration"] += person["completed_expected_duration"]
            for key in keys:
                team[key] += person[key]
        for team in teams.values():
            worked = team["worked_duration"]
            team["productivity"] = round(team["completed_expected_duration"] * 100 / worked) if worked else None
        return sorted(teams.values(), key=lambda team: (-team["worked_duration"], team["name"].lower()))

    def completed_project_dates(self):
        """Actual end dates in the range of the completed projects the person may see (under the project filter)."""
        if not (self.start and self.end):
            return []
        profile = self.scope.get("rbac")
        projects = Project.objects.filter(workspace__slug=self.slug)
        if profile is not None:
            projects = projects.filter(profile.project_q("view"))
        elif not self.scope["is_workspace_admin"]:
            projects = projects.filter(pk__in=self.scope["admin_project_ids"] | self.scope["member_project_ids"])
        if self.projects:
            projects = projects.filter(pk__in=self.projects)
        return list(
            ProjectDetail.objects.filter(
                project__in=projects,
                status__in=COMPLETED_PROJECT_STATUSES,
                actual_end_date__range=(self.start, self.end),
            ).values_list("actual_end_date", flat=True)
        )

    def milestones(self):
        milestones = workspace_milestones(self.request, self.slug)
        if self.projects:
            milestones = milestones.filter(project_id__in=self.projects)
        if self.start and self.end:
            # the ones whose span overlaps the range, or that were due or finished in it
            milestones = milestones.filter(
                Q(target_date__range=(self.start, self.end))
                | Q(actual_completion_date__range=(self.start, self.end))
                | Q(start_date__lte=self.end, target_date__gte=self.start)
            )
        today = timezone.now().astimezone(self.tz).date()
        rows = []
        for milestone in milestones.order_by("target_date", "created_at"):
            total, done = milestone.total_items or 0, milestone.completed_items or 0
            is_completed = milestone.status == "Completed" or (total > 0 and done == total)
            rows.append(
                {
                    "id": str(milestone.id),
                    "title": milestone.title,
                    "project_id": str(milestone.project_id),
                    "project_name": milestone.project_name,
                    "status": milestone.status,
                    "start_date": milestone.start_date,
                    "target_date": milestone.target_date,
                    "actual_completion_date": milestone.actual_completion_date,
                    "total_items": total,
                    "completed_items": done,
                    "progress": round(done * 100 / total) if total else (100 if is_completed else 0),
                    "is_completed": is_completed,
                    "is_overdue": bool(not is_completed and milestone.target_date and milestone.target_date < today),
                }
            )
        return rows

    def tickets(self):
        """(summary, created, resolved): the tickets raised and resolved in the range, or (None, None, None)."""
        if self.projects:
            return None, None, None
        tickets = Issue.ticket_objects.filter(workspace__slug=self.slug).filter(ticket_reach(self.user, self.scope))
        if self.people is not None:
            tickets = tickets.filter(Q(created_by_id__in=self.people) | assigned_to(self.people))
        created = tickets
        resolved = tickets.filter(state__group="completed", completed_at__isnull=False)
        if self.start_at:
            created = created.filter(created_at__gte=self.start_at)
            resolved = resolved.filter(completed_at__gte=self.start_at)
        if self.end_at:
            created = created.filter(created_at__lt=self.end_at)
            resolved = resolved.filter(completed_at__lt=self.end_at)
        resolution_hours = [
            (done - opened).total_seconds() / 3600
            for opened, done in resolved.values_list("created_at", "completed_at")
            if done >= opened
        ]
        statuses = {
            row["state__name"]: row["count"]
            for row in created.order_by().values("state__name").annotate(count=Count("id", distinct=True))
        }
        summary = {
            "created": created.count(),
            "resolved": len(resolution_hours),
            "open": tickets.filter(state__group__in=OPEN_GROUPS).count(),
            "average_resolution_hours": round(sum(resolution_hours) / len(resolution_hours), 1)
            if resolution_hours
            else None,
            "statuses": statuses,
        }
        return summary, created, resolved

    def series(self, tickets_created_qs, tickets_resolved_qs, milestones, project_dates):
        if not self.buckets:
            return []
        finished = {}
        for day in project_dates:
            key = bucket_start(day, self.period)
            finished[key] = finished.get(key, 0) + 1
        achieved = {}
        for milestone in milestones:
            day = milestone["actual_completion_date"] or (
                milestone["target_date"] if milestone["is_completed"] else None
            )
            if milestone["is_completed"] and day and self.start <= day <= self.end:
                key = bucket_start(day, self.period)
                achieved[key] = achieved.get(key, 0) + 1
        hours = bucketed(self.worklogs, "work_at", self.period, self.tz, worked=Sum("duration"), entries=Count("id"))
        done = bucketed(
            self.active.filter(self.completed_q), "completed_at", self.period, self.tz, count=Count("id", distinct=True)
        )
        created_items = self.items
        if self.start_at:
            created_items = created_items.filter(created_at__gte=self.start_at)
        created = bucketed(created_items, "created_at", self.period, self.tz, count=Count("id", distinct=True))
        employees = bucketed(
            self.worklogs, "work_at", self.period, self.tz, people=Count("logged_by_id", distinct=True)
        )
        tickets_created = tickets_resolved = {}
        if tickets_created_qs is not None:
            tickets_created = bucketed(
                tickets_created_qs, "created_at", self.period, self.tz, count=Count("id", distinct=True)
            )
            tickets_resolved = bucketed(
                tickets_resolved_qs, "completed_at", self.period, self.tz, count=Count("id", distinct=True)
            )
        rows = []
        for bucket in self.buckets:
            key = bucket["start"]
            rows.append(
                {
                    "key": bucket["key"],
                    "start": bucket["start"],
                    "end": bucket["end"],
                    "worked_duration": (hours.get(key) or {}).get("worked") or 0,
                    "worklog_count": (hours.get(key) or {}).get("entries") or 0,
                    "employees": (employees.get(key) or {}).get("people") or 0,
                    "tasks_completed": (done.get(key) or {}).get("count") or 0,
                    "tasks_created": (created.get(key) or {}).get("count") or 0,
                    "tickets_created": (tickets_created.get(key) or {}).get("count") or 0,
                    "tickets_resolved": (tickets_resolved.get(key) or {}).get("count") or 0,
                    "projects_completed": finished.get(key, 0),
                    "milestones_completed": achieved.get(key, 0),
                }
            )
        return rows

    def weekdays(self):
        """Worked time per day of the week, Monday (1) to Sunday (7)."""
        rows = (
            self.worklogs.order_by()
            .annotate(weekday=ExtractIsoWeekDay("work_at", tzinfo=self.tz))
            .values("weekday")
            .annotate(worked=Sum("duration"), entries=Count("id"))
        )
        by_day = {row["weekday"]: row for row in rows}
        return [
            {
                "weekday": day,
                "worked_duration": (by_day.get(day) or {}).get("worked") or 0,
                "worklog_count": (by_day.get(day) or {}).get("entries") or 0,
            }
            for day in range(1, 8)
        ]

    def build(self):
        employees = self.employees()
        projects = self.projects_breakdown()
        tickets, tickets_created, tickets_resolved = self.tickets()
        milestones = self.milestones()
        project_dates = self.completed_project_dates()
        totals = self.worklogs.aggregate(worked=Sum("duration"), entries=Count("id"))
        expected = IssueTimeEstimate.objects.filter(issue_id__in=self.active.values("id")).aggregate(
            total=Sum("expected_duration")
        )["total"]
        return {
            "period": self.period,
            "from_date": self.start,
            "to_date": self.end,
            "summary": {
                "worked_duration": totals["worked"] or 0,
                "worklog_count": totals["entries"],
                "expected_duration": expected or 0,
                "employees": len(employees),
                "active_employees": sum(1 for row in employees if row["worked_duration"]),
                "projects": len(projects),
                "projects_completed": len(project_dates),
                "milestones": len(milestones),
                "milestones_completed": sum(1 for row in milestones if row["is_completed"]),
                **self.work_item_totals(),
            },
            "series": self.series(tickets_created, tickets_resolved, milestones, project_dates),
            "weekdays": self.weekdays(),
            "status_groups": self.status_groups(),
            "priorities": self.priorities(),
            "employees": employees,
            "projects": projects,
            "departments": self.departments(employees),
            "milestones": milestones,
            "tickets": tickets,
            "scope": serialize_scope(self.scope),
        }


def build_analytics(request, slug, scope, worklogs, period):
    """The analytics over the request's dates; with a period and no dates, over the period's default span."""
    start = _parse_date(request.GET.get("from_date"), "from_date")
    end = _parse_date(request.GET.get("to_date"), "to_date")
    if period and not (start and end):
        end = end or timezone.now().astimezone(user_timezone(request.user)).date()
        start = start or default_start(end, period)
    return AnalyticsReport(request, slug, scope, worklogs, period, start, end).build()


def _hours(minutes):
    return round((minutes or 0) / 60, 2)


def analytics_sheets(data):
    """The report analytics as spreadsheet tables (title -> rows, header first), for Excel and CSV export."""
    summary, tickets = data["summary"], data["tickets"]
    overview = [
        ["Metric", "Value"],
        ["From", data["from_date"].isoformat() if data["from_date"] else "All time"],
        ["To", data["to_date"].isoformat() if data["to_date"] else ""],
        ["Total working hours", _hours(summary["worked_duration"])],
        ["Worklog entries", summary["worklog_count"]],
        ["Expected hours", _hours(summary["expected_duration"])],
        ["Employees", summary["employees"]],
        ["Active employees", summary["active_employees"]],
        ["Projects", summary["projects"]],
        ["Tasks in the period", summary["tasks_total"]],
        ["Tasks completed", summary["tasks_completed"]],
        ["Tasks pending", summary["tasks_pending"]],
        ["Tasks created", summary["tasks_created"]],
        ["Projects completed", summary["projects_completed"]],
        ["Milestones", summary["milestones"]],
        ["Milestones completed", summary["milestones_completed"]],
    ]
    if tickets:
        overview += [
            ["Tickets raised", tickets["created"]],
            ["Tickets resolved", tickets["resolved"]],
            ["Tickets open", tickets["open"]],
            ["Average resolution (hours)", tickets["average_resolution_hours"] or ""],
        ]
    sheets = {"Overview": overview}
    if data["series"]:
        sheets["Trend"] = [
            [
                "Period start",
                "Period end",
                "Hours",
                "Worklog entries",
                "Employees",
                "Tasks completed",
                "Tasks created",
                "Tickets raised",
                "Tickets resolved",
                "Projects completed",
                "Milestones completed",
            ],
            *[
                [
                    row["start"].isoformat(),
                    row["end"].isoformat(),
                    _hours(row["worked_duration"]),
                    row["worklog_count"],
                    row["employees"],
                    row["tasks_completed"],
                    row["tasks_created"],
                    row["tickets_created"],
                    row["tickets_resolved"],
                    row["projects_completed"],
                    row["milestones_completed"],
                ]
                for row in data["series"]
            ],
        ]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    sheets["Weekdays"] = [
        ["Day", "Hours", "Worklog entries"],
        *[[days[row["weekday"] - 1], _hours(row["worked_duration"]), row["worklog_count"]] for row in data["weekdays"]],
    ]
    sheets["Employees"] = [
        ["Employee", "Hours worked", "Expected hours", "Tasks assigned", "Completed", "Pending", "Productivity %"],
        *[
            [
                row["display_name"],
                _hours(row["worked_duration"]),
                _hours(row["expected_duration"]),
                row["tasks_assigned"],
                row["tasks_completed"],
                row["tasks_pending"],
                "" if row["productivity"] is None else row["productivity"],
            ]
            for row in data["employees"]
        ],
    ]
    groups = REPORT_STATE_GROUPS
    sheets["Projects"] = [
        ["ID", "Project", "Hours", "Employees", "Worklog entries", "Tasks", "Completed", "Pending"]
        + [f"Status: {group}" for group in groups],
        *[
            [
                row["identifier"],
                row["name"],
                _hours(row["worked_duration"]),
                row["employees"],
                row["worklog_count"],
                row["tasks_total"],
                row["tasks_completed"],
                row["tasks_pending"],
                *[row["status_groups"].get(group, 0) for group in groups],
            ]
            for row in data["projects"]
        ],
    ]
    sheets["Departments"] = [
        ["Department", "Employees", "Hours worked", "Expected hours", "Tasks assigned", "Completed", "Pending"]
        + ["Productivity %"],
        *[
            [
                row["name"],
                row["employees"],
                _hours(row["worked_duration"]),
                _hours(row["expected_duration"]),
                row["tasks_assigned"],
                row["tasks_completed"],
                row["tasks_pending"],
                "" if row["productivity"] is None else row["productivity"],
            ]
            for row in data["departments"]
        ],
    ]
    sheets["Status"] = [["Status", "Work items"], *[[group, count] for group, count in data["status_groups"].items()]]
    sheets["Milestones"] = [
        ["Milestone", "Project", "Status", "Start", "End", "Completed on", "Done items", "Total items", "Progress %"],
        *[
            [
                row["title"],
                row["project_name"],
                row["status"],
                row["start_date"].isoformat() if row["start_date"] else "",
                row["target_date"].isoformat() if row["target_date"] else "",
                row["actual_completion_date"].isoformat() if row["actual_completion_date"] else "",
                row["completed_items"],
                row["total_items"],
                row["progress"],
            ]
            for row in data["milestones"]
        ],
    ]
    if tickets:
        sheets["Tickets"] = [
            ["Status", "Tickets raised"],
            *[[name, count] for name, count in tickets["statuses"].items()],
        ]
    return sheets


class WorkLogReportAnalyticsEndpoint(ReportBaseEndpoint):
    """Totals, time series and breakdowns for the report charts (see the module docstring)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        scope, worklogs, error = self.report(request, slug)
        if error:
            return error
        period = request.GET.get("period") or None
        if period is not None and period not in PERIODS:
            return Response({"period": f"Use one of: {', '.join(PERIODS)}."}, status=status.HTTP_400_BAD_REQUEST)
        # the dates were validated by report()
        return Response(build_analytics(request, slug, scope, worklogs, period), status=status.HTTP_200_OK)


class WorkLogReportOptionsEndpoint(ReportBaseEndpoint):
    """The departments (teams), project managers (team leads) and member groups the report filters offer."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        teams = Team.objects.filter(workspace__slug=slug).order_by("name")
        leads = TeamMember.objects.filter(workspace__slug=slug, is_lead=True).select_related("member")
        managers = {}
        for lead in leads:
            managers.setdefault(lead.member_id, {**serialize_user(lead.member), "team_ids": []})["team_ids"].append(
                str(lead.team_id)
            )
        groups = MemberGroup.objects.filter(workspace__slug=slug).order_by("name")
        return Response(
            {
                "departments": [{"id": str(team.id), "name": team.name} for team in teams],
                "project_managers": sorted(managers.values(), key=lambda m: (m["display_name"] or "").lower()),
                "groups": [{"id": str(group.id), "name": group.name} for group in groups],
            },
            status=status.HTTP_200_OK,
        )


__all__ = ["WorkLogReportAnalyticsEndpoint", "WorkLogReportOptionsEndpoint", "analytics_sheets", "build_analytics"]
