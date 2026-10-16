# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Helpdesk ticket endpoints (vTiger CRM 6.5 "Tickets" module).

Access rules (enforced here, never by role):
  * view / comment : current assignee or creator   (as observed in the reference CRM)
  * edit           : current assignee only
  * delete         : nobody; no endpoint exposes it
Workspace / project admins get no implicit access. Tickets live in a hidden
per-workspace project and are invisible to every generic Plane endpoint
(see plane.utils.ticket_isolation and the Issue / Project default managers).
"""

# Python imports
import csv
import uuid

# Django imports
from django.conf import settings
from django.db import connection, transaction
from django.db.models import Case, CharField, OuterRef, Q, Value, When
from django.db.models.functions import Coalesce, Concat, Lower
from django.http import HttpResponse, HttpResponseRedirect
from django.utils import timezone
from django.utils.html import strip_tags

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.ticket import TICKET_CHOICE_FIELDS, TICKET_TEXT_FIELDS, TicketWriteSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    FileAsset,
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueComment,
    Project,
    ProjectIdentifier,
    State,
    Ticket,
    TicketCategory,
    TicketToolCategory,
    TicketTrialTested,
    TICKET_PRIORITIES,
    TICKET_STATUSES,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename
from plane.utils.uuid import convert_uuid_to_integer

TICKET_NUMBER_PREFIX = "TT"
TICKET_PROJECT_NAME = "Tickets"
TICKET_PROJECT_IDENTIFIER = "TICKETS"
DEFAULT_PER_PAGE = 20
WORKSPACE_ROLES = [ROLE.ADMIN, ROLE.MEMBER]

PRIORITY_LABELS = dict(TICKET_PRIORITIES)

# Field labels used in the history ("Updates") feed, in form order
FIELD_LABELS = {
    "name": "Title",
    "organization_name": "Organization Name",
    "assignee": "Assigned To",
    "priority": "Priority",
    "state": "Status",
    "category": "Category",
    "manager": "Manager",
    "project_client_name": "Project Name / Client Name",
    "asset_name": "Asset name(Software/Hardware)",
    "tool_website_url": "Tool Website URL",
    "tool_category": "Tool Category",
    "project_or_client": "Project or Client",
    "problem_resolved": "What Problem Resolved ?",
    "current_handling": "How is the team currently handling this task witho",
    "process_inefficiency": "Why is the current process inefficient?",
    "important_features": "Which features of this tool are most important for",
    "hours_saved": "Estimated hours saved per week/month?",
    "business_impact": "Expected business impact",
    "measurable_outcome": "What measurable outcome do you expect?",
    "roi_timeline": "Estimated ROI timeline",
    "not_approved_impact": "What happens if this tool is NOT approved?",
    "cost": "Monthly / Yearly Cost",
    "licenses_required": "Number of licenses required",
    "trial_tested": "Have you tested the free trial/demo?",
    "asset_months": "Asset months requirement",
    "description": "Description",
    "solution": "Solution",
}

# List view saved filters ("All Tickets" dropdown)
TICKET_FILTERS = [
    {"key": "all", "label": "All Tickets"},
    {"key": "open", "label": "Open Tickets"},  # Status is not Closed
    {"key": "high_priority", "label": "High Priority Tickets"},  # Priority is High
]

SORT_FIELDS = {
    "title": "issue__name",
    "organization_name": "organization_name",
    "status": "issue__state__name",
    "priority": "priority_rank",
    "assigned_to": "assignee_name",
    "ticket_number": "issue__sequence_id",
    "created_at": "created_at",
    "updated_at": "issue__updated_at",
}


# ---------------------------------------------------------------- helpers


def user_name(user):
    if not user:
        return None
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.display_name or user.email


def user_dict(user):
    if not user:
        return None
    return {
        "id": str(user.id),
        "display_name": user.display_name,
        "name": user_name(user),
        "avatar_url": user.avatar_url,
    }


def ticket_number(issue):
    return f"{TICKET_NUMBER_PREFIX}{issue.sequence_id}"


def html_to_text(value):
    return strip_tags(value or "").strip()


def get_or_create_ticket_project(workspace, user):
    project = Project.ticket_projects.filter(workspace=workspace).first()
    if project:
        return project

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [convert_uuid_to_integer(workspace.id)])
        project = Project.ticket_projects.filter(workspace=workspace).first()
        if project:
            return project

        taken_identifiers = set(
            Project.all_objects.filter(workspace=workspace, deleted_at__isnull=True).values_list("identifier", flat=True)
        ) | set(ProjectIdentifier.objects.filter(workspace=workspace).values_list("name", flat=True))
        taken_names = set(
            Project.all_objects.filter(workspace=workspace, deleted_at__isnull=True).values_list("name", flat=True)
        )
        identifier, name, suffix = TICKET_PROJECT_IDENTIFIER, TICKET_PROJECT_NAME, 1
        while identifier in taken_identifiers or name in taken_names:
            identifier = f"{TICKET_PROJECT_IDENTIFIER[:10]}{suffix}"
            name = f"{TICKET_PROJECT_NAME} {suffix}"
            suffix += 1

        project = Project(
            workspace=workspace,
            name=name,
            identifier=identifier,
            network=0,
            is_ticket_project=True,
            page_view=False,
        )
        project.save(created_by_id=user.id)
        ProjectIdentifier.objects.create(name=identifier, project=project, workspace=workspace)

        default_state = None
        for index, item in enumerate(TICKET_STATUSES):
            state = State(
                name=item["name"],
                color=item["color"],
                group=item["group"],
                default=item["default"],
                sequence=(index + 1) * 15000,
                project=project,
            )
            state.save(created_by_id=user.id)
            if item["default"]:
                default_state = state
        project.default_state = default_state
        project.save(update_fields=["default_state"], disable_auto_set_user=True)
        return project


def ticket_queryset(slug):
    return (
        Ticket.objects.filter(
            workspace__slug=slug,
            project__is_ticket_project=True,
            issue__deleted_at__isnull=True,
        )
        .select_related(
            "issue",
            "issue__state",
            "issue__created_by",
            "issue__updated_by",
            "manager",
            "project",
        )
        .annotate(
            assignee_name=Coalesce(
                IssueAssignee.objects.filter(issue_id=OuterRef("issue_id"), deleted_at__isnull=True)
                .annotate(full=Concat("assignee__first_name", Value(" "), "assignee__last_name"))
                .values("full")[:1],
                Value(""),
                output_field=CharField(),
            ),
            priority_rank=Case(
                When(issue__priority="urgent", then=Value("4")),
                When(issue__priority="high", then=Value("3")),
                When(issue__priority="medium", then=Value("2")),
                When(issue__priority="low", then=Value("1")),
                default=Value("0"),
                output_field=CharField(),
            ),
        )
    )


def assignee_filter(user):
    return Q(
        issue__issue_assignee__assignee=user,
        issue__issue_assignee__deleted_at__isnull=True,
    )


def visible_tickets(slug, user):
    """Tickets the user may view: currently assigned to them, or created by them."""
    return ticket_queryset(slug).filter(assignee_filter(user) | Q(issue__created_by=user)).distinct()


def current_assignee(issue):
    row = (
        IssueAssignee.objects.filter(issue=issue, deleted_at__isnull=True).select_related("assignee").first()
    )
    return row.assignee if row else None


def can_view(ticket, user):
    return ticket.issue.created_by_id == user.id or can_edit(ticket, user)


def can_edit(ticket, user):
    return IssueAssignee.objects.filter(issue_id=ticket.issue_id, assignee=user, deleted_at__isnull=True).exists()


def get_visible_ticket(slug, ticket_id, user):
    """Returns the ticket or None. Callers answer 404 so restricted tickets are not disclosed."""
    try:
        ticket_id = uuid.UUID(str(ticket_id))
    except ValueError:
        return None
    return visible_tickets(slug, user).filter(id=ticket_id).first()


def is_active_member(workspace, user_id):
    return WorkspaceMember.objects.filter(
        workspace=workspace,
        member_id=user_id,
        is_active=True,
        member__is_bot=False,
        role__in=[role.value for role in WORKSPACE_ROLES],
    ).exists()


def serialize_ticket(ticket, user, detail=False):
    issue = ticket.issue
    assignee = current_assignee(issue)
    data = {
        "id": str(ticket.id),
        "issue_id": str(issue.id),
        "ticket_number": ticket_number(issue),
        "sequence_id": issue.sequence_id,
        "name": issue.name,
        "organization_name": ticket.organization_name,
        "state": (
            {
                "id": str(issue.state.id),
                "name": issue.state.name,
                "color": issue.state.color,
                "group": issue.state.group,
            }
            if issue.state
            else None
        ),
        "priority": issue.priority,
        "priority_label": PRIORITY_LABELS.get(issue.priority),
        "assignee": user_dict(assignee),
        "created_by": user_dict(issue.created_by),
        "created_at": issue.created_at,
        "updated_at": issue.updated_at,
        "can_edit": bool(assignee and assignee.id == user.id),
    }
    if detail:
        data.update(
            {
                "manager": user_dict(ticket.manager),
                "category": ticket.category,
                "tool_category": ticket.tool_category,
                "trial_tested": ticket.trial_tested,
                "description_html": issue.description_html,
                "solution_html": ticket.solution_html,
                "updated_by": user_dict(issue.updated_by),
            }
        )
        for field in TICKET_TEXT_FIELDS:
            data[field] = getattr(ticket, field)
    return data


def snapshot(ticket):
    """Display values used to compute the history feed."""
    issue = ticket.issue
    values = {
        "name": issue.name,
        "assignee": user_name(current_assignee(issue)),
        "priority": PRIORITY_LABELS.get(issue.priority),
        "state": issue.state.name if issue.state else None,
        "manager": user_name(ticket.manager),
        "description": html_to_text(issue.description_html),
        "solution": html_to_text(ticket.solution_html),
    }
    for field in list(TICKET_TEXT_FIELDS) + list(TICKET_CHOICE_FIELDS):
        values[field] = getattr(ticket, field)
    return {key: (value if value not in ("", None) else None) for key, value in values.items()}


def record_history(ticket, actor, before, after, verb="updated"):
    epoch = int(timezone.now().timestamp())
    rows = []
    if verb == "created":
        rows.append(
            IssueActivity(
                issue_id=ticket.issue_id,
                project_id=ticket.project_id,
                workspace_id=ticket.workspace_id,
                actor=actor,
                verb="created",
                field=None,
                comment="created the ticket",
                epoch=epoch,
            )
        )
    else:
        for field, label in FIELD_LABELS.items():
            old, new = before.get(field), after.get(field)
            if old == new:
                continue
            rows.append(
                IssueActivity(
                    issue_id=ticket.issue_id,
                    project_id=ticket.project_id,
                    workspace_id=ticket.workspace_id,
                    actor=actor,
                    verb="updated",
                    field=label,
                    old_value=old,
                    new_value=new,
                    comment=f"updated {label}",
                    epoch=epoch,
                )
            )
    if rows:
        IssueActivity.objects.bulk_create(rows)


def apply_changes(ticket, data, workspace, user):
    """Validates referenced ids and applies validated data. Returns error dict or None."""
    issue = ticket.issue
    project = ticket.project

    if "state_id" in data:
        state = State.objects.filter(id=data["state_id"], project=project).first()
        if not state:
            return {"state_id": ["Select a valid Status."]}
        issue.state = state
    if "manager_id" in data:
        if not is_active_member(workspace, data["manager_id"]):
            return {"manager_id": ["Manager must be an active workspace member."]}
        ticket.manager_id = data["manager_id"]
    new_assignee_id = data.get("assignee_id")
    if new_assignee_id and not is_active_member(workspace, new_assignee_id):
        return {"assignee_id": ["Assigned To must be an active workspace member."]}

    if "name" in data:
        issue.name = data["name"]
    if "priority" in data:
        issue.priority = data["priority"] or "none"
    if "description_html" in data:
        issue.description_html = data["description_html"]
    if "solution_html" in data:
        ticket.solution_html = data["solution_html"]
    for field in list(TICKET_TEXT_FIELDS) + list(TICKET_CHOICE_FIELDS):
        if field in data:
            setattr(ticket, field, data[field])

    issue.updated_by = user
    issue.save(disable_auto_set_user=True)
    ticket.updated_by = user
    ticket.save(disable_auto_set_user=True)

    if new_assignee_id:
        current = IssueAssignee.objects.filter(issue=issue, deleted_at__isnull=True)
        if not current.filter(assignee_id=new_assignee_id).exists():
            current.update(deleted_at=timezone.now())
            IssueAssignee(
                issue=issue,
                assignee_id=new_assignee_id,
                project_id=project.id,
                workspace_id=workspace.id,
            ).save(created_by_id=user.id)
    return None


# ---------------------------------------------------------------- endpoints


class TicketBaseEndpoint(BaseAPIView):
    ticket_endpoint = True
    http_method_names = ["get", "post", "patch", "head", "options"]


class TicketMetaEndpoint(TicketBaseEndpoint):
    """Dropdown options, filters and members for the ticket screens."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        project = get_or_create_ticket_project(workspace, request.user)
        states = State.objects.filter(project=project).order_by("sequence")
        members = (
            WorkspaceMember.objects.filter(
                workspace=workspace,
                is_active=True,
                member__is_bot=False,
                role__in=[role.value for role in WORKSPACE_ROLES],
            )
            .select_related("member")
            .order_by(Lower("member__first_name"), Lower("member__last_name"))
        )
        return Response(
            {
                "statuses": [
                    {"id": str(s.id), "name": s.name, "color": s.color, "group": s.group, "default": s.default}
                    for s in states
                ],
                "priorities": [{"value": value, "label": label} for value, label in TICKET_PRIORITIES],
                "categories": TicketCategory.values,
                "tool_categories": TicketToolCategory.values,
                "trial_tested": TicketTrialTested.values,
                "filters": TICKET_FILTERS,
                "members": [user_dict(m.member) for m in members],
                "current_user": user_dict(request.user),
                "field_labels": FIELD_LABELS,
            },
            status=status.HTTP_200_OK,
        )


def filtered_tickets(request, slug):
    queryset = visible_tickets(slug, request.user)
    params = request.query_params

    view = params.get("filter", "all")
    if view == "open":
        queryset = queryset.exclude(issue__state__name="Closed")
    elif view == "high_priority":
        queryset = queryset.filter(issue__priority="high")

    # Column search row
    if params.get("title"):
        queryset = queryset.filter(issue__name__icontains=params["title"])
    if params.get("organization_name"):
        queryset = queryset.filter(organization_name__icontains=params["organization_name"])
    if params.get("status"):
        queryset = queryset.filter(issue__state__name__icontains=params["status"])
    if params.get("priority"):
        values = [v for v, label in TICKET_PRIORITIES if params["priority"].lower() in label.lower()]
        queryset = queryset.filter(issue__priority__in=values)
    if params.get("assigned_to"):
        queryset = queryset.filter(assignee_name__icontains=params["assigned_to"])
    # Global keyword search (title or ticket number)
    if params.get("search"):
        term = params["search"].strip()
        number = term.upper().removeprefix(TICKET_NUMBER_PREFIX)
        condition = Q(issue__name__icontains=term)
        if number.isdigit():
            condition |= Q(issue__sequence_id=int(number))
        queryset = queryset.filter(condition)
    # A-Z bar: title starts with letter
    letter = params.get("alphabet")
    if letter and len(letter) == 1 and letter.isalpha():
        queryset = queryset.filter(issue__name__istartswith=letter)

    order_by = params.get("order_by", "-created_at")
    field = SORT_FIELDS.get(order_by.lstrip("-"), "created_at")
    queryset = queryset.order_by(f"-{field}" if order_by.startswith("-") else field, "-created_at")
    return queryset


class TicketListCreateEndpoint(TicketBaseEndpoint):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        queryset = filtered_tickets(request, slug)
        try:
            page = max(int(request.query_params.get("page", 1)), 1)
            per_page = min(max(int(request.query_params.get("per_page", DEFAULT_PER_PAGE)), 1), 100)
        except ValueError:
            page, per_page = 1, DEFAULT_PER_PAGE
        total = queryset.count()
        start = (page - 1) * per_page
        results = [serialize_ticket(t, request.user) for t in queryset[start : start + per_page]]
        return Response(
            {"results": results, "total": total, "page": page, "per_page": per_page},
            status=status.HTTP_200_OK,
        )

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        serializer = TicketWriteSerializer(data=request.data, is_create=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        data = serializer.validated_data
        workspace = Workspace.objects.get(slug=slug)
        project = get_or_create_ticket_project(workspace, request.user)

        state = State.objects.filter(id=data["state_id"], project=project).first()
        if not state:
            return Response({"state_id": ["Select a valid Status."]}, status=status.HTTP_400_BAD_REQUEST)
        for key in ("assignee_id", "manager_id"):
            if not is_active_member(workspace, data[key]):
                label = "Assigned To" if key == "assignee_id" else "Manager"
                return Response(
                    {key: [f"{label} must be an active workspace member."]}, status=status.HTTP_400_BAD_REQUEST
                )

        with transaction.atomic():
            issue = Issue(
                project=project,
                name=data["name"],
                state=state,
                priority=data.get("priority") or "none",
                description_html=data.get("description_html") or "<p></p>",
            )
            issue.save(created_by_id=request.user.id)
            IssueAssignee(
                issue=issue,
                assignee_id=data["assignee_id"],
                project_id=project.id,
                workspace_id=workspace.id,
            ).save(created_by_id=request.user.id)
            ticket = Ticket(
                issue=issue,
                project=project,
                manager_id=data["manager_id"],
                solution_html=data.get("solution_html") or "<p></p>",
            )
            for field in list(TICKET_TEXT_FIELDS) + list(TICKET_CHOICE_FIELDS):
                if field in data:
                    setattr(ticket, field, data[field])
            ticket.save(created_by_id=request.user.id)
            record_history(ticket, request.user, {}, {}, verb="created")

        ticket = ticket_queryset(slug).get(id=ticket.id)
        response = serialize_ticket(ticket, request.user, detail=True)
        # The creator keeps read access (creator rule), so the detail page can be opened.
        return Response(response, status=status.HTTP_201_CREATED)


class TicketDetailEndpoint(TicketBaseEndpoint):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug, ticket_id):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket:
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_ticket(ticket, request.user, detail=True), status=status.HTTP_200_OK)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def patch(self, request, slug, ticket_id):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket:
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        if not can_edit(ticket, request.user):
            return Response(
                {"error": "Only the assigned user can edit this ticket."}, status=status.HTTP_403_FORBIDDEN
            )
        serializer = TicketWriteSerializer(data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        workspace = Workspace.objects.get(slug=slug)
        with transaction.atomic():
            before = snapshot(ticket)
            errors = apply_changes(ticket, serializer.validated_data, workspace, request.user)
            if errors:
                transaction.set_rollback(True)
                return Response(errors, status=status.HTTP_400_BAD_REQUEST)
            ticket = ticket_queryset(slug).get(id=ticket.id)
            record_history(ticket, request.user, before, snapshot(ticket))

        # After a reassignment the former assignee may no longer see the ticket.
        if not can_view(ticket, request.user):
            return Response({"id": str(ticket.id), "visible": False}, status=status.HTTP_200_OK)
        return Response(serialize_ticket(ticket, request.user, detail=True), status=status.HTTP_200_OK)


class TicketBulkUpdateEndpoint(TicketBaseEndpoint):
    """List view Actions > Edit. Applies only to tickets the user is assigned to."""

    BULK_FIELDS = {"state_id", "priority", "assignee_id", "manager_id", "category", "tool_category", "trial_tested"}

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def patch(self, request, slug):
        ids = request.data.get("ticket_ids") or []
        changes = {k: v for k, v in (request.data.get("changes") or {}).items() if k in self.BULK_FIELDS}
        if not ids or not changes:
            return Response({"error": "Select tickets and at least one field."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = TicketWriteSerializer(data=changes, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        workspace = Workspace.objects.get(slug=slug)
        updated, skipped = [], []
        for ticket_id in ids:
            ticket = get_visible_ticket(slug, ticket_id, request.user)
            if not ticket or not can_edit(ticket, request.user):
                skipped.append(str(ticket_id))
                continue
            with transaction.atomic():
                before = snapshot(ticket)
                errors = apply_changes(ticket, serializer.validated_data, workspace, request.user)
                if errors:
                    transaction.set_rollback(True)
                    return Response(errors, status=status.HTTP_400_BAD_REQUEST)
                ticket = ticket_queryset(slug).get(id=ticket.id)
                record_history(ticket, request.user, before, snapshot(ticket))
            updated.append(str(ticket.id))
        return Response({"updated": updated, "skipped": skipped}, status=status.HTTP_200_OK)


class TicketBulkCommentEndpoint(TicketBaseEndpoint):
    """List view Actions > Add Comment."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        ids = request.data.get("ticket_ids") or []
        comment_html = (request.data.get("comment_html") or "").strip()
        if not ids or not html_to_text(comment_html):
            return Response({"error": "Select tickets and enter a comment."}, status=status.HTTP_400_BAD_REQUEST)
        added = 0
        for ticket_id in ids:
            ticket = get_visible_ticket(slug, ticket_id, request.user)
            if ticket:
                create_comment(ticket, request.user, comment_html)
                added += 1
        return Response({"added": added}, status=status.HTTP_200_OK)


class TicketExportEndpoint(TicketBaseEndpoint):
    """List view Actions > Export. CSV of the tickets the user can see, honouring current filters."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        queryset = filtered_tickets(request, slug)
        selected = request.query_params.get("ids")
        if selected:
            queryset = queryset.filter(id__in=[i for i in selected.split(",") if i])
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="tickets.csv"'
        writer = csv.writer(response)
        header = ["Ticket Number", *[label for key, label in FIELD_LABELS.items()], "Creator", "Created Time", "Modified Time"]
        writer.writerow(header)
        for ticket in queryset:
            values = snapshot(ticket)
            writer.writerow(
                [
                    ticket_number(ticket.issue),
                    *[values.get(key) or "" for key in FIELD_LABELS],
                    user_name(ticket.issue.created_by),
                    ticket.issue.created_at.isoformat(),
                    ticket.issue.updated_at.isoformat(),
                ]
            )
        return response


# ---------------------------------------------------------------- comments


def create_comment(ticket, user, comment_html, parent=None):
    is_valid, error, clean_html = validate_html_content_safe(comment_html)
    comment = IssueComment(
        issue_id=ticket.issue_id,
        project_id=ticket.project_id,
        workspace_id=ticket.workspace_id,
        comment_html=clean_html,
        actor=user,
        parent=parent,
    )
    comment.save(created_by_id=user.id)
    return comment


def validate_html_content_safe(value):
    from plane.utils.content_validator import validate_html_content

    is_valid, error, clean_html = validate_html_content(value)
    return is_valid, error, (clean_html if clean_html is not None else value)


def serialize_comment(comment, user):
    return {
        "id": str(comment.id),
        "parent_id": str(comment.parent_id) if comment.parent_id else None,
        "comment_html": comment.comment_html,
        "actor": user_dict(comment.actor),
        "created_at": comment.created_at,
        "edited_at": comment.edited_at,
        "can_edit": comment.actor_id == user.id,
    }


class TicketCommentEndpoint(TicketBaseEndpoint):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug, ticket_id):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket:
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        comments = (
            IssueComment.objects.filter(issue_id=ticket.issue_id, deleted_at__isnull=True)
            .select_related("actor")
            .order_by("created_at")
        )
        return Response([serialize_comment(c, request.user) for c in comments], status=status.HTTP_200_OK)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug, ticket_id):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket:
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        comment_html = request.data.get("comment_html") or ""
        if not html_to_text(comment_html):
            return Response({"comment_html": ["Comment cannot be empty."]}, status=status.HTTP_400_BAD_REQUEST)
        is_valid, error, _ = validate_html_content_safe(comment_html)
        if not is_valid:
            return Response({"comment_html": [error]}, status=status.HTTP_400_BAD_REQUEST)
        parent = None
        if request.data.get("parent_id"):
            parent = IssueComment.objects.filter(
                id=request.data["parent_id"], issue_id=ticket.issue_id, deleted_at__isnull=True
            ).first()
            if not parent:
                return Response({"parent_id": ["Invalid comment."]}, status=status.HTTP_400_BAD_REQUEST)
        comment = create_comment(ticket, request.user, comment_html, parent=parent)
        return Response(serialize_comment(comment, request.user), status=status.HTTP_201_CREATED)


class TicketCommentDetailEndpoint(TicketBaseEndpoint):
    """Authors may edit their own comments. Comments cannot be deleted."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def patch(self, request, slug, ticket_id, comment_id):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket:
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        comment = IssueComment.objects.filter(
            id=comment_id, issue_id=ticket.issue_id, deleted_at__isnull=True
        ).first()
        if not comment:
            return Response({"error": "Comment not found."}, status=status.HTTP_404_NOT_FOUND)
        if comment.actor_id != request.user.id:
            return Response({"error": "You can only edit your own comments."}, status=status.HTTP_403_FORBIDDEN)
        comment_html = request.data.get("comment_html") or ""
        is_valid, error, clean_html = validate_html_content_safe(comment_html)
        if not is_valid or not html_to_text(comment_html):
            return Response({"comment_html": [error or "Comment cannot be empty."]}, status=status.HTTP_400_BAD_REQUEST)
        comment.comment_html = clean_html
        comment.edited_at = timezone.now()
        comment.updated_by = request.user
        comment.save(disable_auto_set_user=True)
        return Response(serialize_comment(comment, request.user), status=status.HTTP_200_OK)


# ---------------------------------------------------------------- history


class TicketHistoryEndpoint(TicketBaseEndpoint):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug, ticket_id):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket:
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        activities = (
            IssueActivity.all_objects.filter(issue_id=ticket.issue_id, deleted_at__isnull=True)
            .select_related("actor")
            .order_by("-created_at")
        )
        return Response(
            [
                {
                    "id": str(a.id),
                    "verb": a.verb,
                    "field": a.field,
                    "old_value": a.old_value,
                    "new_value": a.new_value,
                    "actor": user_dict(a.actor),
                    "created_at": a.created_at,
                }
                for a in activities
            ],
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------- documents


def serialize_attachment(asset):
    return {
        "id": str(asset.id),
        "name": (asset.attributes or {}).get("name"),
        "type": (asset.attributes or {}).get("type"),
        "size": asset.size,
        "created_by": user_dict(asset.created_by),
        "created_at": asset.created_at,
    }


class TicketAttachmentEndpoint(TicketBaseEndpoint):
    """Documents: list / upload (assignee) / download (viewers). No delete."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug, ticket_id, attachment_id=None):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket:
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        assets = FileAsset.objects.filter(
            issue_id=ticket.issue_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            is_uploaded=True,
        ).select_related("created_by")
        if attachment_id:
            asset = assets.filter(id=attachment_id).first()
            if not asset:
                return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)
            storage = S3Storage(request=request)
            url = storage.generate_presigned_url(
                object_name=asset.asset.name,
                disposition="attachment",
                filename=(asset.attributes or {}).get("name"),
            )
            return HttpResponseRedirect(url)
        return Response([serialize_attachment(a) for a in assets.order_by("-created_at")], status=status.HTTP_200_OK)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug, ticket_id):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket:
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        if not can_edit(ticket, request.user):
            return Response(
                {"error": "Only the assigned user can add documents."}, status=status.HTTP_403_FORBIDDEN
            )
        name = sanitize_filename(request.data.get("name")) or "unnamed"
        file_type = request.data.get("type", False)
        try:
            size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        except (TypeError, ValueError):
            size = settings.FILE_SIZE_LIMIT
        if not file_type or file_type not in settings.ATTACHMENT_MIME_TYPES:
            return Response({"error": "Invalid file type."}, status=status.HTTP_400_BAD_REQUEST)
        size_limit = min(size, settings.FILE_SIZE_LIMIT)
        asset_key = f"{ticket.workspace_id}/{uuid.uuid4().hex}-{name}"
        asset = FileAsset(
            attributes={"name": name, "type": file_type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace_id=ticket.workspace_id,
            project_id=ticket.project_id,
            issue_id=ticket.issue_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
        )
        asset.save(created_by_id=request.user.id)
        storage = S3Storage(request=request)
        upload_data = storage.generate_presigned_post(object_name=asset_key, file_type=file_type, file_size=size_limit)
        return Response({"upload_data": upload_data, "asset_id": str(asset.id)}, status=status.HTTP_200_OK)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def patch(self, request, slug, ticket_id, attachment_id):
        ticket = get_visible_ticket(slug, ticket_id, request.user)
        if not ticket or not can_edit(ticket, request.user):
            return Response({"error": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)
        asset = FileAsset.objects.filter(
            id=attachment_id, issue_id=ticket.issue_id, created_by=request.user
        ).first()
        if not asset:
            return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)
        if not asset.is_uploaded:
            asset.is_uploaded = True
            asset.save(update_fields=["is_uploaded", "updated_at"], disable_auto_set_user=True)
            IssueActivity.objects.create(
                issue_id=ticket.issue_id,
                project_id=ticket.project_id,
                workspace_id=ticket.workspace_id,
                actor=request.user,
                verb="created",
                field="Document",
                new_value=(asset.attributes or {}).get("name"),
                comment="added a document",
                epoch=int(timezone.now().timestamp()),
            )
        return Response(serialize_attachment(asset), status=status.HTTP_200_OK)
