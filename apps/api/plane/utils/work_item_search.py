# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The search box of a work item list (Projects › Project Tasks, a project's task list): how people find a task.

What's typed (any case) is looked for in every field of a project task:

* the task: name, description, task number ("ACMEWEB-6", or the bare number "6"), project name and identifier,
  status ("Comp" finds the Completed ones), priority ("high"), estimate;
* its dates as the app shows them ("May 18, 2026", "May 18", "2026") or as 2026-05-18: start and due date;
* its people: assignees, who created it, who requested it (Project Task fields) — by name or display name;
* what it belongs to: labels, modules, cycle, milestone;
* the Project Task fields: type, phase, technology, bug type, severity, environment, build version and the links.

Next to it, the date filter keeps the tasks whose start date, due date, creation or last change falls on a day or within
a range (query params date_field, date_from, date_to; see filter_work_items_by_date).

Both only narrow a list: who may see a task is decided elsewhere, before or after them. Linked records (assignees,
labels, modules, cycles, milestones) are matched with EXISTS, so a task matching several ways is still listed once.
"""

import re
from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import CharField, Exists, F, Func, OuterRef, Q, Value
from django.db.models.functions import Concat, TruncDate

from plane.db.models import CycleIssue, IssueAssignee, IssueLabel, MilestoneWorkItem, ModuleIssue

# a task number as the app shows it: the project's identifier, a dash, the number
TASK_NUMBER = re.compile(r"^([A-Za-z0-9_]+)-(\d{1,9})$")
# dates as the app shows them ("Jul 07, 2026"); 'Mon' is English whatever the server's locale
DATE_AS_SHOWN = "Mon DD, YYYY"

# the Project Task fields (IssueTaskDetail) that hold text
TASK_DETAIL_TEXT_FIELDS = (
    "task_type",
    "project_phase",
    "technology",
    "bug_type",
    "severity",
    "environment",
    "build_version",
    "git_url",
    "user_manual_url",
    "code_review_url",
    "description_url",
    "code_review_comments",
)


def _date_as_shown(field):
    return Func(F(field), Value(DATE_AS_SHOWN), function="to_char", output_field=CharField())


def _person_q(prefix, full_name_alias, term):
    """A person (`prefix` = the path to a User) whose display name or full name ("Hiral Prajapati") contains `term`."""
    return (
        Q(**{f"{prefix}__display_name__icontains": term})
        | Q(**{f"{prefix}__first_name__icontains": term})
        | Q(**{f"{prefix}__last_name__icontains": term})
        | Q(**{f"{full_name_alias}__icontains": term})
    )


def _full_name(prefix):
    return Concat(f"{prefix}__first_name", Value(" "), f"{prefix}__last_name", output_field=CharField())


def search_work_items(queryset, term):
    """`queryset` (work items) narrowed to the ones `term` is found in; the whole queryset for an empty term."""
    term = (term or "").strip()
    if not term:
        return queryset

    queryset = queryset.alias(
        search_start_date=_date_as_shown("start_date"),
        search_due_date=_date_as_shown("target_date"),
        search_created_by=_full_name("created_by"),
        search_requested_by=_full_name("task_detail__requested_by"),
    )

    # the task's own fields
    query = (
        Q(name__icontains=term)
        | Q(description_stripped__icontains=term)
        | Q(project__name__icontains=term)
        | Q(project__identifier__icontains=term)
        | Q(state__name__icontains=term)
        | Q(priority__icontains=term)
        | Q(estimate_point__value__icontains=term)
        | Q(search_start_date__icontains=term)
        | Q(search_due_date__icontains=term)
        | Q(start_date__icontains=term)  # 2026-05-18
        | Q(target_date__icontains=term)
        | _person_q("created_by", "search_created_by", term)
        | _person_q("task_detail__requested_by", "search_requested_by", term)
    )
    for field in TASK_DETAIL_TEXT_FIELDS:
        query |= Q(**{f"task_detail__{field}__icontains": term})

    # the task number
    number = TASK_NUMBER.match(term)
    if number:
        query |= Q(project__identifier__iexact=number.group(1), sequence_id=int(number.group(2)))
    elif term.isdigit() and len(term) <= 9:
        query |= Q(sequence_id=int(term))

    # what it's linked to: assignees, labels, modules, cycle, milestone
    task = OuterRef("pk")
    assignees = IssueAssignee.objects.filter(issue=task).alias(search_assignee=_full_name("assignee"))
    query |= Q(Exists(assignees.filter(_person_q("assignee", "search_assignee", term))))
    query |= Q(Exists(IssueLabel.objects.filter(issue=task, label__name__icontains=term)))
    query |= Q(Exists(ModuleIssue.objects.filter(issue=task, module__name__icontains=term)))
    query |= Q(Exists(CycleIssue.objects.filter(issue=task, cycle__name__icontains=term)))
    query |= Q(Exists(MilestoneWorkItem.objects.filter(issue=task, milestone__title__icontains=term)))

    return queryset.filter(query)


# the date filter: what people pick → the field it reads
DATE_FIELDS = {
    "start_date": "start_date",
    "due_date": "target_date",
    "created_on": "created_at",
    "updated_on": "updated_at",
}


def _day(value):
    try:
        return date.fromisoformat(str(value or "").strip())
    except ValueError:
        return None


def _zone(name):
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def filter_work_items_by_date(queryset, field, date_from, date_to, timezone_name="UTC"):
    """The tasks whose `field` (start_date, due_date, created_on, updated_on) is on or between the two days (YYYY-MM-DD;
    either may be left out for an open range, the same day twice for one day). Creation and last change count by the
    day in `timezone_name`. Unknown fields and unreadable days are ignored: the list is then not narrowed by them."""
    column = DATE_FIELDS.get(str(field or ""))
    start, end = _day(date_from), _day(date_to)
    if not column or not (start or end):
        return queryset
    if start and end and start > end:
        start, end = end, start
    if column in ("created_at", "updated_at"):
        queryset = queryset.alias(search_on_day=TruncDate(column, tzinfo=_zone(timezone_name)))
        column = "search_on_day"
    if start:
        queryset = queryset.filter(**{f"{column}__gte": start})
    if end:
        queryset = queryset.filter(**{f"{column}__lte": end})
    return queryset


def apply_list_search(queryset, request):
    """A work item list narrowed by its search box (`search`) and its date filter (`date_field`, `date_from`,
    `date_to`), dates in the person's own time zone."""
    params = request.GET
    queryset = search_work_items(queryset, params.get("search"))
    return filter_work_items_by_date(
        queryset,
        params.get("date_field"),
        params.get("date_from"),
        params.get("date_to"),
        getattr(request.user, "user_timezone", None),
    )
