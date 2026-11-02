# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models
from django.utils.html import strip_tags

# Module imports
from .project import ProjectBaseModel

# Values match the vTiger CRM 6.5 HelpDesk configuration ("Tickets" module).
# Tool Category spelling is corrected ("Software", "Furniture Requirement").
TICKET_STATUSES = [
    {"name": "Open", "group": "unstarted", "color": "#3F76FF", "default": True},
    {"name": "In Progress", "group": "started", "color": "#F59E0B", "default": False},
    {"name": "Wait For Response", "group": "started", "color": "#A855F7", "default": False},
    {"name": "Approved", "group": "started", "color": "#16A34A", "default": False},
    {"name": "Reject", "group": "cancelled", "color": "#DC2626", "default": False},
    {"name": "Completed", "group": "completed", "color": "#0D9488", "default": False},
    {"name": "Closed", "group": "completed", "color": "#60646C", "default": False},
]

# vTiger priority label -> Plane Issue.priority value
TICKET_PRIORITIES = [
    ("low", "Low"),
    ("medium", "Normal"),
    ("high", "High"),
    ("urgent", "Urgent"),
]


class TicketCategory(models.TextChoices):
    BIG_PROBLEM = "Big Problem", "Big Problem"
    SMALL_PROBLEM = "Small Problem", "Small Problem"
    OTHER_PROBLEM = "Other Problem", "Other Problem"
    PENALTY = "Penalty", "Penalty"
    EXPENSE = "Expense", "Expense"


class TicketToolCategory(models.TextChoices):
    AI_TOOLS = "AI Tools", "AI Tools"
    HARDWARE = "Hardware Requirement", "Hardware Requirement"
    SOFTWARE = "Software Requirement", "Software Requirement"
    FURNITURE = "Furniture Requirement", "Furniture Requirement"
    OTHERS = "Others", "Others"


class TicketTrialTested(models.TextChoices):
    YES = "Yes", "Yes"
    NO = "No", "No"
    NA = "NA", "NA"


class Ticket(ProjectBaseModel):
    """
    Helpdesk ticket. Title, description, status, priority, assignee, creator,
    number, comments, attachments and history live on the linked Issue, which
    belongs to the workspace's hidden ticket project (Project.is_ticket_project).
    """

    issue = models.OneToOneField("db.Issue", on_delete=models.CASCADE, related_name="ticket")
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="managed_tickets",
    )
    organization_name = models.CharField(max_length=255, blank=True, default="")
    category = models.CharField(max_length=50, choices=TicketCategory.choices, null=True, blank=True)

    # Asset Requirement block
    project_client_name = models.CharField(max_length=255, blank=True, default="")
    asset_name = models.CharField(max_length=255, blank=True, default="")
    tool_website_url = models.CharField(max_length=1000, blank=True, default="")
    tool_category = models.CharField(max_length=50, choices=TicketToolCategory.choices, null=True, blank=True)
    project_or_client = models.CharField(max_length=255, blank=True, default="")
    problem_resolved = models.TextField(blank=True, default="")
    current_handling = models.TextField(blank=True, default="")
    process_inefficiency = models.TextField(blank=True, default="")
    important_features = models.TextField(blank=True, default="")
    hours_saved = models.TextField(blank=True, default="")
    business_impact = models.TextField(blank=True, default="")
    measurable_outcome = models.TextField(blank=True, default="")
    roi_timeline = models.TextField(blank=True, default="")
    not_approved_impact = models.TextField(blank=True, default="")
    cost = models.TextField(blank=True, default="")
    licenses_required = models.CharField(max_length=255, blank=True, default="")
    trial_tested = models.CharField(max_length=10, choices=TicketTrialTested.choices, null=True, blank=True)
    asset_months = models.CharField(max_length=255, blank=True, default="")

    # Ticket Resolution block
    solution_html = models.TextField(blank=True, default="<p></p>")
    solution_stripped = models.TextField(blank=True, null=True)

    class Meta:
        verbose_name = "Ticket"
        verbose_name_plural = "Tickets"
        db_table = "tickets"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["manager"], name="ticket_manager_idx"),
            models.Index(fields=["category"], name="ticket_category_idx"),
            models.Index(fields=["tool_category"], name="ticket_tool_category_idx"),
        ]

    def save(self, *args, **kwargs):
        self.solution_stripped = strip_tags(self.solution_html) if self.solution_html else ""
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Ticket <{self.issue_id}>"
