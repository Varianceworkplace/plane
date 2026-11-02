# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Project milestones (as in Plane Cloud).

  * Off by default; a project admin turns them on (Project.is_milestone_enabled). Turning them off
    hides them but keeps milestones and their links.
  * Project admins and members view, create, edit and delete milestones and link work items.
  * A work item belongs to at most one milestone; titles are unique within a project.
  * Progress = share of linked work items in a Completed or Cancelled state.
  * Linking, moving and unlinking are recorded in the work item's activity.
  * Besides the title (Workplace's "Phase/Release/Milestone Name") a milestone carries the rest of the Workplace
    form: start, end ("target") and actual completion dates, type, status and who it's assigned to. "Assigned to"
    is required for new milestones and must be a project admin or member; "Related to" is the project itself.
"""

# Python imports
import time
import uuid

# Django imports
from django.db import transaction
from django.db.models import Count, F, Q
from django.db.models.functions import Lower
from django.utils.dateparse import parse_date

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    MILESTONE_STATUSES,
    MILESTONE_TYPES,
    Issue,
    IssueActivity,
    Milestone,
    MilestoneWorkItem,
    Project,
    ProjectMember,
    WorkspaceMember,
)
from plane.utils.content_validator import validate_html_content
from plane.utils.rbac import SECRET_NETWORK, rbac_profile

DONE_GROUPS = ("completed", "cancelled")
MILESTONE_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
MAX_LINK_BATCH = 500
DATE_FIELDS = ("start_date", "target_date", "actual_completion_date")
# field -> allowed values, for the fields that are picklists
CHOICE_FIELDS = {"milestone_type": MILESTONE_TYPES, "status": MILESTONE_STATUSES}


# ---------------------------------------------------------------- helpers


def get_project(slug, project_id):
    return Project.objects.filter(pk=project_id, workspace__slug=slug).first()


# links that count toward progress
LIVE_LINKS = Q(
    milestone_work_items__deleted_at__isnull=True,
    milestone_work_items__issue__deleted_at__isnull=True,
    milestone_work_items__issue__is_draft=False,
)


def milestones_with_progress(project_id):
    return Milestone.objects.filter(project_id=project_id).annotate(
        total_items=Count("milestone_work_items", filter=LIVE_LINKS, distinct=True),
        completed_items=Count(
            "milestone_work_items",
            filter=LIVE_LINKS & Q(milestone_work_items__issue__state__group__in=DONE_GROUPS),
            distinct=True,
        ),
    )


def serialize_milestone(milestone):
    total = getattr(milestone, "total_items", 0) or 0
    completed = getattr(milestone, "completed_items", 0) or 0
    return {
        "id": str(milestone.id),
        "project_id": str(milestone.project_id),
        "title": milestone.title,
        "description_html": milestone.description_html,
        "start_date": milestone.start_date,
        "target_date": milestone.target_date,
        "actual_completion_date": milestone.actual_completion_date,
        "milestone_type": milestone.milestone_type,
        "status": milestone.status,
        "assigned_to_id": str(milestone.assigned_to_id) if milestone.assigned_to_id else None,
        "total_items": total,
        "completed_items": completed,
        "progress": round(completed * 100 / total) if total else 0,
        "created_at": milestone.created_at,
        "updated_at": milestone.updated_at,
    }


def sorted_milestones(queryset):
    # earliest target date first; milestones without a date last
    return queryset.order_by(F("target_date").asc(nulls_last=True), "created_at")


def serialize_work_item(issue, identifier):
    return {
        "id": str(issue.id),
        "name": issue.name,
        "sequence_id": issue.sequence_id,
        "project_identifier": identifier,
        "priority": issue.priority,
        "start_date": issue.start_date,
        "target_date": issue.target_date,
        "state": (
            {
                "id": str(issue.state.id),
                "name": issue.state.name,
                "group": issue.state.group,
                "color": issue.state.color,
            }
            if issue.state
            else None
        ),
        "assignee_ids": [str(a.id) for a in issue.assignees.all()],
    }


def clean_payload(data, project_id, instance=None):
    """Returns (cleaned, errors) for the milestone fields present in `data` (all required ones on create)."""
    cleaned, errors = {}, {}
    if "title" in data or instance is None:
        title = (data.get("title") or "").strip() if isinstance(data.get("title") or "", str) else ""
        if not title:
            errors["title"] = "Title is required."
        elif len(title) > 255:
            errors["title"] = "Title can't be longer than 255 characters."
        else:
            duplicate = Milestone.objects.filter(project_id=project_id).annotate(lower_title=Lower("title"))
            if instance is not None:
                duplicate = duplicate.exclude(pk=instance.pk)
            if duplicate.filter(lower_title=title.lower()).exists():
                errors["title"] = "A milestone with this title already exists in this project."
            else:
                cleaned["title"] = title
    if "description_html" in data:
        value = data.get("description_html") or "<p></p>"
        is_valid, error, clean_html = validate_html_content(value)
        if not is_valid:
            errors["description_html"] = error or "Invalid description."
        else:
            cleaned["description_html"] = clean_html if clean_html is not None else value
    for field in DATE_FIELDS:
        if field in data:
            value = data.get(field)
            if value in (None, ""):
                cleaned[field] = None
            else:
                parsed = parse_date(str(value)) if isinstance(value, str) else None
                if not parsed:
                    errors[field] = "Use a date in YYYY-MM-DD format."
                else:
                    cleaned[field] = parsed
    for field, allowed in CHOICE_FIELDS.items():
        if field in data:
            value = data.get(field) or ""
            if value != "" and value not in allowed:
                errors[field] = "Pick one of the listed options."
            else:
                cleaned[field] = value
    if "assigned_to_id" in data or instance is None:
        value = data.get("assigned_to_id")
        try:
            user_id = uuid.UUID(str(value)) if value else None
        except ValueError:
            user_id = None
        if not value:
            errors["assigned_to_id"] = "Pick the person the milestone is assigned to."
        elif (
            not user_id
            or not ProjectMember.objects.filter(
                project_id=project_id, member_id=user_id, is_active=True, role__in=[r.value for r in MILESTONE_ROLES]
            ).exists()
        ):
            errors["assigned_to_id"] = "Pick an admin or member of this project."
        else:
            cleaned["assigned_to_id"] = user_id

    # the dates have to make sense together, including the ones already saved
    def merged(field):
        return cleaned[field] if field in cleaned else getattr(instance, field, None)

    start_date = merged("start_date")
    if start_date and "start_date" not in errors:
        for field, message in (
            ("target_date", "The end date can't be before the start date."),
            ("actual_completion_date", "The actual completion date can't be before the start date."),
        ):
            end_date = merged(field)
            if end_date and field not in errors and end_date < start_date:
                errors[field] = message
    return cleaned, errors


def record_activity(issue, user, old_milestone, new_milestone):
    """Adds the move to the work item's activity (field "milestone")."""
    if (old_milestone and new_milestone and old_milestone.id == new_milestone.id) or (
        not old_milestone and not new_milestone
    ):
        return
    IssueActivity.objects.create(
        issue_id=issue.id,
        project_id=issue.project_id,
        workspace_id=issue.workspace_id,
        actor=user,
        verb="updated",
        field="milestone",
        old_value=old_milestone.title if old_milestone else "",
        new_value=new_milestone.title if new_milestone else "",
        old_identifier=old_milestone.id if old_milestone else None,
        new_identifier=new_milestone.id if new_milestone else None,
        comment="updated the milestone",
        epoch=time.time(),
    )


def set_work_item_milestone(issue, milestone, user):
    """Links `issue` to `milestone` (None = remove). Returns True when something changed."""
    link = MilestoneWorkItem.objects.filter(issue_id=issue.id).select_related("milestone").first()
    old = link.milestone if link else None
    if (old.id if old else None) == (milestone.id if milestone else None):
        return False
    if link:
        link.delete(soft=False)
    if milestone:
        MilestoneWorkItem.objects.create(milestone=milestone, issue_id=issue.id, project_id=issue.project_id)
    record_activity(issue, user, old, milestone)
    return True


def disabled_response():
    return Response({"error": "Milestones are turned off for this project."}, status=status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------- milestones


class MilestoneOptionsEndpoint(BaseAPIView):
    """The picklist values, so the app shows the same options the server accepts."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        return Response(CHOICE_FIELDS, status=status.HTTP_200_OK)


class MilestoneEndpoint(BaseAPIView):
    # role-based access (plane.utils.work_item_visibility): the Milestones permissions of the project
    rbac_project_module = "milestones"

    @allow_permission(MILESTONE_ROLES)
    def get(self, request, slug, project_id):
        milestones = sorted_milestones(milestones_with_progress(project_id).filter(workspace__slug=slug))
        search = (request.GET.get("search") or "").strip()
        if search:
            milestones = milestones.filter(title__icontains=search)
        return Response([serialize_milestone(m) for m in milestones], status=status.HTTP_200_OK)

    @allow_permission(MILESTONE_ROLES)
    def post(self, request, slug, project_id):
        project = get_project(slug, project_id)
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_milestone_enabled:
            return disabled_response()
        data, errors = clean_payload(request.data, project_id)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        milestone = Milestone.objects.create(project=project, **data)
        milestone = milestones_with_progress(project_id).get(pk=milestone.pk)
        return Response(serialize_milestone(milestone), status=status.HTTP_201_CREATED)


def workspace_milestones(request, slug):
    """Every milestone the user can see across the workspace's projects (the "Project Milestones" page).

    Those are the projects with milestones on where the user is an admin or member, or any role for a workspace
    admin (the same people the project milestone endpoints let in). Archived projects are left out.

    With role-based access on it's the person's Milestones "view" that decides, member or not: View = All sees every
    project's milestones, also of projects they can't open. Private projects stay with the people who can see them.
    """
    memberships = ProjectMember.objects.filter(
        member=request.user, workspace__slug=slug, is_active=True, project__deleted_at__isnull=True
    )
    if not WorkspaceMember.objects.filter(
        member=request.user, workspace__slug=slug, is_active=True, role=ROLE.ADMIN.value
    ).exists():
        memberships = memberships.filter(role__in=[role.value for role in MILESTONE_ROLES])
    reach = Q(pk__in=memberships.values("project_id"))
    profile = rbac_profile(request, slug)
    if profile is not None:
        reach |= ~Q(network=SECRET_NETWORK) | profile.project_q("view")
    project_ids = (
        Project.objects.filter(workspace__slug=slug, is_milestone_enabled=True, archived_at__isnull=True)
        .filter(reach)
        .values("id")
    )
    # role-based access: only the projects where the person's roles let them see milestones
    allowed = profile.module_project_ids("milestones", "view") if profile is not None else None
    if allowed is not None:
        project_ids = project_ids.filter(pk__in=allowed)
    return Milestone.objects.filter(project_id__in=project_ids).annotate(
        project_name=F("project__name"),
        total_items=Count("milestone_work_items", filter=LIVE_LINKS, distinct=True),
        completed_items=Count(
            "milestone_work_items",
            filter=LIVE_LINKS & Q(milestone_work_items__issue__state__group__in=DONE_GROUPS),
            distinct=True,
        ),
    )


def linked_work_items(milestone):
    """The milestone's work items, as far as the person may see them (the Issue managers filter per request)."""
    return (
        Issue.objects.filter(
            milestone_links__milestone=milestone, milestone_links__deleted_at__isnull=True, is_draft=False
        )
        .select_related("state")
        .prefetch_related("assignees")
        .order_by("sequence_id")
    )


class WorkspaceMilestoneEndpoint(BaseAPIView):
    """The "Project Milestones" page: see workspace_milestones."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        milestones = workspace_milestones(request, slug)
        # the project's name too: the app only knows the projects the person can open
        return Response(
            [{**serialize_milestone(m), "project_name": m.project_name} for m in sorted_milestones(milestones)],
            status=status.HTTP_200_OK,
        )


class WorkspaceMilestoneDetailEndpoint(BaseAPIView):
    """One milestone of the "Project Milestones" page, read-only, for everyone that page shows it to.

    That includes people who aren't members of its project, whom the project's own milestone pages don't let in.
    The linked work items are only the ones the person may see; the progress counts cover all of them.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, pk):
        milestone = workspace_milestones(request, slug).filter(pk=pk).select_related("project").first()
        if not milestone:
            return Response({"error": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)
        identifier = milestone.project.identifier
        return Response(
            {
                **serialize_milestone(milestone),
                "project_name": milestone.project_name,
                "work_items": [serialize_work_item(i, identifier) for i in linked_work_items(milestone)],
            },
            status=status.HTTP_200_OK,
        )


class MilestoneDetailEndpoint(BaseAPIView):
    # role-based access (plane.utils.work_item_visibility): the Milestones permissions of the project
    rbac_project_module = "milestones"

    @allow_permission(MILESTONE_ROLES)
    def get(self, request, slug, project_id, pk):
        milestone = milestones_with_progress(project_id).filter(workspace__slug=slug, pk=pk).first()
        if not milestone:
            return Response({"error": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_milestone(milestone), status=status.HTTP_200_OK)

    @allow_permission(MILESTONE_ROLES)
    def patch(self, request, slug, project_id, pk):
        project = get_project(slug, project_id)
        milestone = Milestone.objects.filter(project_id=project_id, workspace__slug=slug, pk=pk).first()
        if not project or not milestone:
            return Response({"error": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_milestone_enabled:
            return disabled_response()
        data, errors = clean_payload(request.data, project_id, instance=milestone)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        for key, value in data.items():
            setattr(milestone, key, value)
        milestone.save()
        milestone = milestones_with_progress(project_id).get(pk=milestone.pk)
        return Response(serialize_milestone(milestone), status=status.HTTP_200_OK)

    @allow_permission(MILESTONE_ROLES)
    def delete(self, request, slug, project_id, pk):
        project = get_project(slug, project_id)
        milestone = Milestone.objects.filter(project_id=project_id, workspace__slug=slug, pk=pk).first()
        if not project or not milestone:
            return Response({"error": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_milestone_enabled:
            return disabled_response()
        with transaction.atomic():
            # work items are unlinked (not deleted); their activity records the removal
            for link in MilestoneWorkItem.objects.filter(milestone=milestone).select_related("issue"):
                record_activity(link.issue, request.user, milestone, None)
                link.delete(soft=False)
            milestone.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MilestoneWorkItemEndpoint(BaseAPIView):
    """Work items linked to a milestone; POST {"add": [...], "remove": [...]} links / unlinks."""

    # role-based access (plane.utils.work_item_visibility): the Milestones permissions of the project
    rbac_project_module = "milestones"
    rbac_module_actions = {"GET": "view", "POST": "edit"}

    @allow_permission(MILESTONE_ROLES)
    def get(self, request, slug, project_id, pk):
        milestone = Milestone.objects.filter(project_id=project_id, workspace__slug=slug, pk=pk).first()
        if not milestone:
            return Response({"error": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)
        identifier = milestone.project.identifier
        issues = linked_work_items(milestone)
        return Response([serialize_work_item(i, identifier) for i in issues], status=status.HTTP_200_OK)

    @allow_permission(MILESTONE_ROLES)
    def post(self, request, slug, project_id, pk):
        project = get_project(slug, project_id)
        milestone = Milestone.objects.filter(project_id=project_id, workspace__slug=slug, pk=pk).first()
        if not project or not milestone:
            return Response({"error": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_milestone_enabled:
            return disabled_response()
        add = request.data.get("add") or []
        remove = request.data.get("remove") or []
        if not isinstance(add, list) or not isinstance(remove, list) or len(add) + len(remove) > MAX_LINK_BATCH:
            return Response({"error": "Send lists of work item ids."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # only this project's work items; drafts, archived and intake items can't be linked
            for issue in Issue.issue_objects.filter(project_id=project_id, pk__in=add):
                set_work_item_milestone(issue, milestone, request.user)
            for issue in Issue.objects.filter(
                project_id=project_id, pk__in=remove, milestone_links__milestone=milestone
            ):
                set_work_item_milestone(issue, None, request.user)
        milestone = milestones_with_progress(project_id).get(pk=milestone.pk)
        return Response(serialize_milestone(milestone), status=status.HTTP_200_OK)


class MilestoneAvailableWorkItemEndpoint(BaseAPIView):
    """Work items of the project that are not in any milestone yet (for "Link work items")."""

    # role-based access (plane.utils.work_item_visibility): the Milestones permissions of the project
    rbac_project_module = "milestones"
    rbac_module_actions = {"GET": "view"}

    @allow_permission(MILESTONE_ROLES)
    def get(self, request, slug, project_id, pk):
        milestone = Milestone.objects.filter(project_id=project_id, workspace__slug=slug, pk=pk).first()
        if not milestone:
            return Response({"error": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)
        issues = (
            Issue.issue_objects.filter(project_id=project_id, milestone_links__isnull=True)
            .select_related("state")
            .prefetch_related("assignees")
        )
        search = (request.GET.get("search") or "").strip()
        if search:
            query = Q(name__icontains=search)
            if search.isdigit():
                query |= Q(sequence_id=int(search))
            issues = issues.filter(query)
        identifier = milestone.project.identifier
        return Response(
            [serialize_work_item(i, identifier) for i in issues.order_by("-sequence_id")[:100]],
            status=status.HTTP_200_OK,
        )


class WorkItemMilestoneEndpoint(BaseAPIView):
    """The milestone of one work item (work item sidebar)."""

    # role-based access: seeing a work item's milestone needs Milestones "view" in its project
    rbac_project_module = "milestones"
    rbac_module_actions = {"GET": "view"}

    # role-based access (plane.utils.work_item_visibility): changing this is editing the work item
    rbac_work_item_actions = {"POST": "edit", "PUT": "edit", "PATCH": "edit", "DELETE": "edit"}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        link = (
            MilestoneWorkItem.objects.filter(issue_id=issue_id, project_id=project_id, workspace__slug=slug)
            .select_related("milestone")
            .first()
        )
        if not link:
            return Response({"milestone": None}, status=status.HTTP_200_OK)
        milestone = milestones_with_progress(project_id).get(pk=link.milestone_id)
        return Response({"milestone": serialize_milestone(milestone)}, status=status.HTTP_200_OK)

    @allow_permission(MILESTONE_ROLES)
    def put(self, request, slug, project_id, issue_id):
        project = get_project(slug, project_id)
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not project.is_milestone_enabled:
            return disabled_response()
        issue = Issue.objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()
        if not issue:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        milestone_id = request.data.get("milestone_id")
        milestone = None
        if milestone_id:
            milestone = Milestone.objects.filter(project_id=project_id, pk=milestone_id).first()
            if not milestone:
                return Response({"milestone_id": "Milestone not found."}, status=status.HTTP_400_BAD_REQUEST)
            if issue.is_draft or issue.archived_at:
                return Response(
                    {"error": "Draft and archived work items can't be added to a milestone."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        with transaction.atomic():
            set_work_item_milestone(issue, milestone, request.user)
        if not milestone:
            return Response({"milestone": None}, status=status.HTTP_200_OK)
        milestone = milestones_with_progress(project_id).get(pk=milestone.pk)
        return Response({"milestone": serialize_milestone(milestone)}, status=status.HTTP_200_OK)
