# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Holidays (sidebar › Holidays): the company's holiday list, a year at a time.

Every workspace member sees it. Workspace admins and HR (people whose roles grant Role management, as for the People
tab) add, change and delete holidays, copy last year's list, or import one from a CSV / Excel file.

A date has at most one holiday. A holiday is a day off for everyone, so Attendance shows it as H rather than Absent;
an optional holiday stays a working day there (plane.app.views.worklog.attendance).
"""

# Python imports
from datetime import date

# Django imports
from django.db import IntegrityError, transaction

# Third party imports
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.app.views.rbac.base import can_manage_access, forbidden
from plane.app.views.worklog import attendance
from plane.db.models import Holiday, HolidayKind, Workspace
from plane.utils.holidays import NAME_MAX_LENGTH, read_holiday_file, serialize_holiday

MIN_YEAR, MAX_YEAR = 2000, 2100
DESCRIPTION_MAX_LENGTH = 500
MEMBERS = [ROLE.ADMIN, ROLE.MEMBER]


class HolidayError(Exception):
    pass


def company_today(workspace):
    """Today in the company's time zone, as Attendance counts days."""
    tz, _ = attendance.attendance_timezone(workspace)
    return attendance._now().astimezone(tz).date()


def _bad(message, **extra):
    return Response({"error": message, **extra}, status=status.HTTP_400_BAD_REQUEST)


def _year(value, default=None):
    if value in (None, ""):
        if default is None:
            raise HolidayError("Pick a year.")
        return default
    try:
        year = int(value)
    except (TypeError, ValueError):
        raise HolidayError("Pick a year.")
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise HolidayError(f"Pick a year from {MIN_YEAR} to {MAX_YEAR}.")
    return year


def _taken(workspace, day, exclude_id=None):
    """The message when another holiday is already on that day, else None."""
    existing = Holiday.objects.filter(workspace=workspace, date=day).exclude(id=exclude_id).first()
    if existing is None:
        return None
    return f"{day:%a %d %b %Y} already has a holiday: {existing.name}. Change that one instead."


def _clean(data, holiday=None):
    """The fields to save from the request, checked. Raises HolidayError."""
    fields = {}
    if holiday is None or "date" in data:
        try:
            day = date.fromisoformat(str(data.get("date") or ""))
        except ValueError:
            raise HolidayError("Pick the holiday's date.")
        if not MIN_YEAR <= day.year <= MAX_YEAR:
            raise HolidayError(f"Pick a date from {MIN_YEAR} to {MAX_YEAR}.")
        fields["date"] = day
    if holiday is None or "name" in data:
        name = " ".join(str(data.get("name") or "").split())
        if not name:
            raise HolidayError("Give the holiday a name.")
        if len(name) > NAME_MAX_LENGTH:
            raise HolidayError(f"Keep the name under {NAME_MAX_LENGTH} characters.")
        fields["name"] = name
    if holiday is None or "kind" in data:
        kind = data.get("kind") or HolidayKind.HOLIDAY
        if kind not in HolidayKind.values:
            raise HolidayError("The type must be Holiday or Optional holiday.")
        fields["kind"] = kind
    if "description" in data:
        description = str(data.get("description") or "").strip()
        if len(description) > DESCRIPTION_MAX_LENGTH:
            raise HolidayError(f"Keep the note under {DESCRIPTION_MAX_LENGTH} characters.")
        fields["description"] = description
    return fields


def _managed_workspace(request, slug):
    """The workspace, if the person may change its holiday list (workspace admins and HR)."""
    workspace = Workspace.objects.get(slug=slug)
    return workspace if can_manage_access(request.user, workspace) else None


class HolidayEndpoint(BaseAPIView):
    """GET ?year=: that year's holidays (this year by default), with the next holiday from today on.
    POST {date, name, kind, description}: add one (admins and HR)."""

    @allow_permission(MEMBERS, level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        today = company_today(workspace)
        try:
            year = _year(request.GET.get("year"), default=today.year)
        except HolidayError as error:
            return _bad(str(error))
        holidays = Holiday.objects.filter(workspace=workspace)
        upcoming = holidays.filter(date__gte=today).order_by("date").first()
        years = sorted({day.year for day in holidays.values_list("date", flat=True)})
        return Response(
            {
                "year": year,
                "today": today.isoformat(),
                "years": years,
                "can_manage": can_manage_access(request.user, workspace),
                "holidays": [serialize_holiday(holiday) for holiday in holidays.filter(date__year=year)],
                "next": serialize_holiday(upcoming) if upcoming else None,
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(MEMBERS, level="WORKSPACE")
    def post(self, request, slug):
        workspace = _managed_workspace(request, slug)
        if workspace is None:
            return forbidden()
        try:
            fields = _clean(request.data)
        except HolidayError as error:
            return _bad(str(error))
        taken = _taken(workspace, fields["date"])
        if taken:
            return _bad(taken)
        try:
            with transaction.atomic():
                holiday = Holiday.objects.create(workspace=workspace, **fields)
        except IntegrityError:
            return _bad(_taken(workspace, fields["date"]) or "That day already has a holiday.")
        return Response(serialize_holiday(holiday), status=status.HTTP_201_CREATED)


class HolidayDetailEndpoint(BaseAPIView):
    """PATCH: change a holiday; DELETE: remove it (admins and HR)."""

    def _holiday(self, request, slug, pk):
        workspace = _managed_workspace(request, slug)
        if workspace is None:
            return None, forbidden()
        holiday = Holiday.objects.filter(workspace=workspace, id=pk).first()
        if holiday is None:
            return None, Response({"error": "This holiday isn't on the list any more."}, status=404)
        return holiday, None

    @allow_permission(MEMBERS, level="WORKSPACE")
    def patch(self, request, slug, pk):
        holiday, refused = self._holiday(request, slug, pk)
        if refused:
            return refused
        try:
            fields = _clean(request.data, holiday=holiday)
        except HolidayError as error:
            return _bad(str(error))
        if "date" in fields:
            taken = _taken(holiday.workspace, fields["date"], exclude_id=holiday.id)
            if taken:
                return _bad(taken)
        for field, value in fields.items():
            setattr(holiday, field, value)
        try:
            with transaction.atomic():
                holiday.save()
        except IntegrityError:
            return _bad("That day already has a holiday.")
        return Response(serialize_holiday(holiday), status=status.HTTP_200_OK)

    @allow_permission(MEMBERS, level="WORKSPACE")
    def delete(self, request, slug, pk):
        holiday, refused = self._holiday(request, slug, pk)
        if refused:
            return refused
        holiday.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HolidayCopyEndpoint(BaseAPIView):
    """POST {from_year, to_year}: last year's holidays on the same day and month of another year, to adjust the
    festivals whose dates move. Days that already have a holiday keep theirs (admins and HR)."""

    @allow_permission(MEMBERS, level="WORKSPACE")
    def post(self, request, slug):
        workspace = _managed_workspace(request, slug)
        if workspace is None:
            return forbidden()
        try:
            from_year = _year(request.data.get("from_year"))
            to_year = _year(request.data.get("to_year"))
        except HolidayError as error:
            return _bad(str(error))
        if from_year == to_year:
            return _bad("Pick two different years.")
        source = list(Holiday.objects.filter(workspace=workspace, date__year=from_year))
        if not source:
            return _bad(f"There are no holidays in {from_year} to copy.")

        taken = set(Holiday.objects.filter(workspace=workspace, date__year=to_year).values_list("date", flat=True))
        new, skipped = [], 0
        for holiday in source:
            try:
                day = holiday.date.replace(year=to_year)
            except ValueError:  # 29 February
                skipped += 1
                continue
            if day in taken:
                skipped += 1
                continue
            taken.add(day)
            new.append(
                Holiday(
                    workspace=workspace,
                    date=day,
                    name=holiday.name,
                    kind=holiday.kind,
                    description=holiday.description,
                    created_by=request.user,
                )
            )
        try:
            with transaction.atomic():
                Holiday.objects.bulk_create(new)
        except IntegrityError:
            return _bad("The list changed while copying. Try again.")
        message = f"Copied {len(new)} holiday{'' if len(new) == 1 else 's'} to {to_year}."
        if skipped:
            message += f" {skipped} skipped: that day already had a holiday, or it was 29 February."
        return Response(
            {"created": len(new), "skipped": skipped, "message": message + " Check the festival dates."},
            status=status.HTTP_201_CREATED,
        )


class HolidayImportEndpoint(BaseAPIView):
    """POST a CSV / Excel file (multipart "file"): its holidays are added; days already on the list keep theirs.
    Nothing is added while any row has a problem (admins and HR)."""

    parser_classes = (MultiPartParser, FormParser)

    @allow_permission(MEMBERS, level="WORKSPACE")
    def post(self, request, slug):
        workspace = _managed_workspace(request, slug)
        if workspace is None:
            return forbidden()
        upload = request.FILES.get("file")
        if upload is None:
            return _bad("Choose a .csv or .xlsx file.")
        try:
            holidays, errors = read_holiday_file(upload)
        except ValueError as error:
            return _bad(str(error))
        if errors:
            return _bad("Nothing was added. Fix these rows and import the file again.", rows=errors)
        if not holidays:
            return _bad("The file has no holidays under its header row.")
        out_of_range = next((h for h in holidays if not MIN_YEAR <= h["date"].year <= MAX_YEAR), None)
        if out_of_range:
            return _bad(f"{out_of_range['date']:%d %b %Y} is outside {MIN_YEAR} to {MAX_YEAR}. Nothing was added.")

        taken = set(
            Holiday.objects.filter(workspace=workspace, date__in=[h["date"] for h in holidays]).values_list(
                "date", flat=True
            )
        )
        new = [
            Holiday(workspace=workspace, created_by=request.user, **holiday)
            for holiday in holidays
            if holiday["date"] not in taken
        ]
        try:
            with transaction.atomic():
                Holiday.objects.bulk_create(new)
        except IntegrityError:
            return _bad("The list changed while importing. Try again.")
        message = f"Added {len(new)} holiday{'' if len(new) == 1 else 's'}."
        if taken:
            message += f" {len(taken)} already on the list kept as they were."
        return Response(
            {
                "created": len(new),
                "skipped": len(taken),
                "years": sorted({h.date.year for h in new}),
                "message": message,
            },
            status=status.HTTP_201_CREATED,
        )


__all__ = ["HolidayCopyEndpoint", "HolidayDetailEndpoint", "HolidayEndpoint", "HolidayImportEndpoint"]
