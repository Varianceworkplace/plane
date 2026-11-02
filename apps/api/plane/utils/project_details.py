# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Project details: the vTiger-style "Creating New Project" fields of a project.

  * The app's create project form sends them as `project_details`; the server then checks every required field
    (and that the project has a lead, the form's "Assigned To"). Creates without them, such as the public API,
    work as before.
  * Afterwards project admins edit them through the project details endpoint; a required field can't be cleared.
  * Picklists only accept the values listed in db/models/project_detail.py.
"""

# Python imports
from datetime import date
from decimal import Decimal, InvalidOperation

# Module imports
from plane.db.models import PROGRESS_VALUES, PROJECT_DETAIL_CHOICES, ProjectDetail

TEXT_FIELDS = {
    "related_to": 255,
    "customer_name": 255,
    "user_manual_url": 2000,
    "salesforce_org_id": 2000,
    "project_url": 2000,
}
DATE_FIELDS = ("start_date", "target_end_date", "actual_end_date")
# the red stars of the Workplace form ("Project Name" and "Assigned To" are the project's own name and lead)
REQUIRED_FIELDS = ("start_date", "target_end_date", "project_type", "status", "customer_name", "user_manual_url")
REQUIRED_ERROR = "This field is required."
LEAD_REQUIRED_ERROR = "Pick the person the project is assigned to."
MAX_ESTIMATED_HOURS = Decimal("1000000")


def serialize_project_detail(detail):
    if not detail:
        detail = ProjectDetail()
    return {
        **{field: getattr(detail, field) for field in PROJECT_DETAIL_CHOICES},
        **{field: getattr(detail, field) for field in TEXT_FIELDS},
        **{field: getattr(detail, field).isoformat() if getattr(detail, field) else None for field in DATE_FIELDS},
        "estimated_hours": float(detail.estimated_hours) if detail.estimated_hours is not None else None,
        "progress": detail.progress,
    }


def _parse_date(value):
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return False
    return False


def parse_project_detail_payload(data, current=None, require_all=False):
    """Returns (cleaned, errors) for the fields present in `data`.

    `current` is the saved ProjectDetail (when editing), used for the checks that span fields. With `require_all`
    every required field must be present and filled in; otherwise a required field that is sent must not be empty.
    """
    if not isinstance(data, dict):
        return {}, {"project_details": "Must be an object."}
    cleaned, errors = {}, {}
    for field, allowed in PROJECT_DETAIL_CHOICES.items():
        if field in data:
            value = data.get(field) or ""
            if value != "" and value not in allowed:
                errors[field] = "Pick one of the listed options."
            else:
                cleaned[field] = value
    for field, limit in TEXT_FIELDS.items():
        if field in data:
            value = data.get(field)
            value = "" if value is None else value
            if not isinstance(value, str):
                errors[field] = "Must be text."
            elif len(value.strip()) > limit:
                errors[field] = f"Keep it under {limit} characters."
            else:
                cleaned[field] = value.strip()
    for field in DATE_FIELDS:
        if field in data:
            value = data.get(field)
            if value in (None, ""):
                cleaned[field] = None
            else:
                parsed = _parse_date(value)
                if parsed is False:
                    errors[field] = "Enter a date as YYYY-MM-DD."
                else:
                    cleaned[field] = parsed
    if "estimated_hours" in data:
        value = data.get("estimated_hours")
        if value in (None, ""):
            cleaned["estimated_hours"] = None
        else:
            try:
                hours = None if isinstance(value, bool) else Decimal(str(value).strip())
            except InvalidOperation:
                hours = None
            if hours is None or not hours.is_finite() or hours < 0 or hours >= MAX_ESTIMATED_HOURS:
                errors["estimated_hours"] = "Enter the hours as a number, e.g. 120 or 37.5."
            else:
                cleaned["estimated_hours"] = hours.quantize(Decimal("0.01"))
    if "progress" in data:
        value = data.get("progress")
        if value is not None and (isinstance(value, bool) or value not in PROGRESS_VALUES):
            errors["progress"] = "Pick a progress between 10% and 100%."
        else:
            cleaned["progress"] = value

    for field in REQUIRED_FIELDS:
        if field in errors:
            continue
        if field in cleaned:
            if cleaned[field] in (None, ""):
                errors[field] = REQUIRED_ERROR
        elif require_all:
            errors[field] = REQUIRED_ERROR

    # the dates have to make sense together, including the ones already saved
    def merged(field):
        if field in cleaned:
            return cleaned[field]
        return getattr(current, field, None) if current else None

    start_date = merged("start_date")
    if start_date and "start_date" not in errors:
        for field, message in (
            ("target_end_date", "The target end date can't be before the start date."),
            ("actual_end_date", "The actual end date can't be before the start date."),
        ):
            end_date = merged(field)
            if end_date and field not in errors and end_date < start_date:
                errors[field] = message
    return cleaned, errors
