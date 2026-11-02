# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .project import ProjectBaseModel

# Picklist values match the vTiger CRM 6.5 "Project Tasks" form used by the team (Workplace).
TASK_TYPES = [
    "Development",
    "HR Activity",
    "Project Management",
    "Bug",
    "Content Writing",
    "Release Note",
    "Communication",
    "Deployment",
    "Enhancement",
    "Marketing Work",
    "Testing",
    "Designing",
    "Estimation",
    "Other Task",
    "Code Review",
    "Code Review Bugs",
    "Code Restructuring",
    "Documentation",
    "CR(Change Request)",
    "Interview",
    "Feasibility",
    "Analysis",
    "CR (Billable)",
    "Learning and Training",
    "Support",
    "Not In Figma",
    "In-Person Meeting",
    "Sales Activity",
]
PROJECT_PHASES = [f"Phase-{n}" for n in range(1, 11)]
TECHNOLOGIES = [
    "PHP",
    "ASP.NET",
    "API",
    "MobileApps-Android",
    "Mobile Apps - Ios",
    "ASP.NET MVC",
    "Classic ASP",
    "Database",
    "Front End",
    "Back End",
    "Angular JS",
    "Node JS",
    "Selenium",
    "Python",
    "Unity",
    "Angular",
    "MEAN Stack",
    "Mobile Apps",
    "General",
    "SalesForce",
    "ReactJs",
    "React Native",
    "SuiteCRM",
]
BUG_TYPES = [
    "Functionality",
    "UI",
    "Performance",
    "Responsive",
    "Language",
    "RTL",
    "Compatibility",
    "Security",
    "White Labeling",
]
SEVERITIES = ["Critical", "Blocker", "Major", "Moderate", "Minor"]
ENVIRONMENTS = ["Development", "Staging", "QA", "Production", "Stag. and Prod."]
PROGRESS_VALUES = list(range(10, 101, 10))

# field -> allowed values, for the fields that are picklists
TASK_DETAIL_CHOICES = {
    "task_type": TASK_TYPES,
    "project_phase": PROJECT_PHASES,
    "technology": TECHNOLOGIES,
    "bug_type": BUG_TYPES,
    "severity": SEVERITIES,
    "environment": ENVIRONMENTS,
}


class IssueTaskDetail(ProjectBaseModel):
    """The extra "Project Task" fields of a work item, for projects with task details turned on.

    Plane fields cover the rest of the form: name, priority, state, project ("Related to"), assignee, milestone,
    parent ("Project Task Name"), start / due date, description, completion date and expected time.
    """

    issue = models.OneToOneField("db.Issue", on_delete=models.CASCADE, related_name="task_detail")
    task_type = models.CharField(max_length=64, blank=True, default="")
    project_phase = models.CharField(max_length=32, blank=True, default="")
    technology = models.CharField(max_length=64, blank=True, default="")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requested_task_details",
    )
    not_in_project_plan = models.BooleanField(default=False)
    git_url = models.TextField(blank=True, default="")
    # null until someone answers
    create_code_review = models.BooleanField(null=True, blank=True)
    build_version = models.CharField(max_length=255, blank=True, default="")
    user_manual_url = models.TextField(blank=True, default="")
    bug_type = models.CharField(max_length=32, blank=True, default="")
    severity = models.CharField(max_length=32, blank=True, default="")
    environment = models.CharField(max_length=32, blank=True, default="")
    # percent in steps of 10
    progress = models.PositiveSmallIntegerField(null=True, blank=True)
    code_review_comments = models.TextField(blank=True, default="")
    code_review_url = models.TextField(blank=True, default="")
    description_url = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Issue Task Detail"
        verbose_name_plural = "Issue Task Details"
        db_table = "issue_task_details"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue_id} {self.task_type}"
