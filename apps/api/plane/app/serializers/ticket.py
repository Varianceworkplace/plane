# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import TicketCategory, TicketToolCategory, TicketTrialTested, TICKET_PRIORITIES
from plane.utils.content_validator import validate_html_content

# Ticket-table text fields: name -> max length (None = unlimited text)
TICKET_TEXT_FIELDS = {
    "organization_name": 255,
    "project_client_name": 255,
    "asset_name": 255,
    "tool_website_url": 1000,
    "project_or_client": 255,
    "problem_resolved": None,
    "current_handling": None,
    "process_inefficiency": None,
    "important_features": None,
    "hours_saved": None,
    "business_impact": None,
    "measurable_outcome": None,
    "roi_timeline": None,
    "not_approved_impact": None,
    "cost": None,
    "licenses_required": 255,
    "asset_months": 255,
}

TICKET_CHOICE_FIELDS = {
    "category": TicketCategory.values,
    "tool_category": TicketToolCategory.values,
    "trial_tested": TicketTrialTested.values,
}


def _clean_html(value):
    if not value:
        return "<p></p>"
    is_valid, error, clean_html = validate_html_content(value)
    if not is_valid:
        raise serializers.ValidationError(error or "Invalid content")
    return clean_html if clean_html is not None else value


class TicketWriteSerializer(serializers.Serializer):
    """Validates ticket create / edit payloads. Required fields mirror the vTiger form."""

    name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    assignee_id = serializers.UUIDField(required=False, allow_null=True)
    state_id = serializers.UUIDField(required=False, allow_null=True)
    manager_id = serializers.UUIDField(required=False, allow_null=True)
    priority = serializers.ChoiceField(
        choices=[value for value, _ in TICKET_PRIORITIES] + ["none"], required=False, allow_null=True
    )
    description_html = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    solution_html = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)

    def __init__(self, *args, **kwargs):
        self.is_create = kwargs.pop("is_create", False)
        super().__init__(*args, **kwargs)
        for field, max_length in TICKET_TEXT_FIELDS.items():
            self.fields[field] = serializers.CharField(
                required=False, allow_blank=True, max_length=max_length, trim_whitespace=max_length is not None
            )
        for field, choices in TICKET_CHOICE_FIELDS.items():
            self.fields[field] = serializers.ChoiceField(
                choices=choices, required=False, allow_null=True, allow_blank=True
            )

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Title is required.")
        return value

    def validate_description_html(self, value):
        return _clean_html(value)

    def validate_solution_html(self, value):
        return _clean_html(value)

    def validate(self, attrs):
        required = {
            "name": "Title is required.",
            "assignee_id": "Assigned To is required.",
            "state_id": "Status is required.",
            "manager_id": "Manager is required.",
        }
        errors = {}
        for field, message in required.items():
            if self.is_create and field not in attrs:
                errors[field] = [message]
            elif field in attrs and attrs[field] in (None, ""):
                errors[field] = [message]
        if errors:
            raise serializers.ValidationError(errors)
        for field in TICKET_CHOICE_FIELDS:
            if attrs.get(field) == "":
                attrs[field] = None
        if attrs.get("priority") is None and "priority" in attrs:
            attrs["priority"] = "none"
        return attrs
