# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

# Module imports
from .project import ProjectBaseModel

# Longest single entry a member can log (in minutes)
MAX_WORKLOG_DURATION = 999 * 60 + 59


class IssueWorkLog(ProjectBaseModel):
    """Time a member spent on a work item. `duration` is stored in minutes."""

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_worklogs")
    logged_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="user_worklogs")
    duration = models.PositiveIntegerField(validators=[MinValueValidator(1), MaxValueValidator(MAX_WORKLOG_DURATION)])
    description = models.TextField(blank=True, default="")
    # Set when the entry comes from the start / stop timer (empty for manual entries)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Issue Work Log"
        verbose_name_plural = "Issue Work Logs"
        db_table = "issue_worklogs"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue_id} {self.logged_by_id} {self.duration}m"


class IssueWorkLogTimer(ProjectBaseModel):
    """A member's running timer on a work item. One per member per workspace.

    `stopped_at` is set when the member presses Stop; the timer becomes an IssueWorkLog
    once they save the note (or is discarded).
    """

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="worklog_timers")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="worklog_timers")
    started_at = models.DateTimeField()
    stopped_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Issue Work Log Timer"
        verbose_name_plural = "Issue Work Log Timers"
        db_table = "issue_worklog_timers"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user"],
                condition=models.Q(deleted_at__isnull=True),
                name="worklog_timer_unique_user_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.issue_id} {self.user_id} {self.started_at}"
