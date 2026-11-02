# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .project import ProjectBaseModel

# Picklist values of the vTiger CRM "Project Milestones" form used by the team (Workplace)
MILESTONE_TYPES = ["administrative", "operative", "other"]
MILESTONE_STATUSES = ["Not Started", "In Progress", "On Hold", "Completed", "Cancelled"]


class Milestone(ProjectBaseModel):
    """A checkpoint in a project (e.g. a release) that work items are grouped under."""

    # "Phase/Release/Milestone Name"; "Related to" is the project
    title = models.CharField(max_length=255)
    description_html = models.TextField(blank=True, default="<p></p>")
    start_date = models.DateField(null=True, blank=True)
    # "End Date"
    target_date = models.DateField(null=True, blank=True)
    actual_completion_date = models.DateField(null=True, blank=True)
    milestone_type = models.CharField(max_length=32, blank=True, default="")
    status = models.CharField(max_length=32, blank=True, default="")
    # required for new milestones; older ones may have nobody yet
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_milestones",
    )

    class Meta:
        verbose_name = "Milestone"
        verbose_name_plural = "Milestones"
        db_table = "milestones"
        ordering = ("target_date", "created_at")

    def __str__(self):
        return f"{self.project_id} {self.title}"


class MilestoneWorkItem(ProjectBaseModel):
    """Links a work item to a milestone. A work item belongs to at most one milestone."""

    milestone = models.ForeignKey(Milestone, on_delete=models.CASCADE, related_name="milestone_work_items")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="milestone_links")

    class Meta:
        verbose_name = "Milestone Work Item"
        verbose_name_plural = "Milestone Work Items"
        db_table = "milestone_work_items"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["issue"],
                condition=models.Q(deleted_at__isnull=True),
                name="milestone_work_item_unique_issue_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.milestone_id} {self.issue_id}"
