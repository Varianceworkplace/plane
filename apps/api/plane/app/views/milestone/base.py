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
"""

# Python imports
import time

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
from plane.db.models import Issue, IssueActivity, Milestone, MilestoneWorkItem, Project
from plane.utils.content_validator import validate_html_content

DONE_GROUPS = ("completed", "cancelled")
MILESTONE_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
MAX_LINK_BATCH = 500


# ---------------------------------------------------------------- helpers


def get_project(slug, project_id):
    return Project.objects.filter(pk=project_id, workspace__slug=slug).first()


def milestones_with_progress(project_id):
    live = Q(
        milestone_work_items__deleted_at__isnull=True,
        milestone_work_items__issue__deleted_at__isnull=True,
        milestone_work_items__issue__is_draft=False,
    )
    return Milestone.objects.filter(project_id=project_id).annotate(
        total_items=Count("milestone_work_items", filter=live, distinct=True),
        completed_items=Count(
            "milestone_work_items",
            filter=live & Q(milestone_work_items__issue__state__group__in=DONE_GROUPS),
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
        "target_date": milestone.target_date,
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
    """Returns (cleaned, errors) for title / description_html / target_date."""
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
    if "target_date" in data:
        value = data.get("target_date")
        if value in (None, ""):
            cleaned["target_date"] = None
        else:
            parsed = parse_date(str(value)) if isinstance(value, str) else None
            if not parsed:
                errors["target_date"] = "Use a date in YYYY-MM-DD format."
            else:
                cleaned["target_date"] = parsed
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


class MilestoneEndpoint(BaseAPIView):
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


class MilestoneDetailEndpoint(BaseAPIView):
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

    @allow_permission(MILESTONE_ROLES)
    def get(self, request, slug, project_id, pk):
        milestone = Milestone.objects.filter(project_id=project_id, workspace__slug=slug, pk=pk).first()
        if not milestone:
            return Response({"error": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)
        identifier = milestone.project.identifier
        issues = (
            Issue.objects.filter(
                milestone_links__milestone=milestone, milestone_links__deleted_at__isnull=True, is_draft=False
            )
            .select_related("state")
            .prefetch_related("assignees")
            .order_by("sequence_id")
        )
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
