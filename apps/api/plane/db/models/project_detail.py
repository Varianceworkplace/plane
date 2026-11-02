# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models

# Module imports
from .base import BaseModel

# Picklist values match the vTiger CRM "Projects" form used by the team (Workplace).
PROJECT_TYPES = ["Time & Material (Hourly)", "Dedicated Developer", "Fix contract"]
PROJECT_STATUSES = [
    "prospecting",
    "initiated",
    "in progress",
    "waiting for feedback",
    "on hold",
    "completed",
    "delivered",
    "archived",
]

# field -> allowed values, for the fields that are picklists
PROJECT_DETAIL_CHOICES = {
    "project_type": PROJECT_TYPES,
    "status": PROJECT_STATUSES,
}


class ProjectDetail(BaseModel):
    """The Workplace "Creating New Project" fields that Plane has no field for.

    Plane fields cover the rest of the form: name ("Project Name"), project lead ("Assigned To") and description.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="project_details")
    project = models.OneToOneField("db.Project", on_delete=models.CASCADE, related_name="project_detail")
    start_date = models.DateField(null=True, blank=True)
    target_end_date = models.DateField(null=True, blank=True)
    actual_end_date = models.DateField(null=True, blank=True)
    estimated_hours = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)
    project_type = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(max_length=32, blank=True, default="")
    # vTiger links an organization or contact here; Plane has neither, so it is the name as text
    related_to = models.CharField(max_length=255, blank=True, default="")
    customer_name = models.CharField(max_length=255, blank=True, default="")
    user_manual_url = models.TextField(blank=True, default="")
    salesforce_org_id = models.TextField(blank=True, default="")
    project_url = models.TextField(blank=True, default="")
    # percent in steps of 10
    progress = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        verbose_name = "Project Detail"
        verbose_name_plural = "Project Details"
        db_table = "project_details"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.project_id} {self.status}"
