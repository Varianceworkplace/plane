# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction

# Module imports
from .project import ProjectBaseModel

# Longest single entry a member can log (in minutes)
MAX_WORKLOG_DURATION = 999 * 60 + 59

# Every time sheet entry has a number, as Workplace's "Time Control No." (TIME-BILLING-336717). Entries brought over
# from Workplace keep theirs; the counter is moved past the highest number in use (migration 0150, the import).
TIMESHEET_NO_PREFIX = "TIME-BILLING-"


class TimesheetNumberCounter(models.Model):
    """The last Timesheet No. handed out (one row). Taking a number locks the row, so two entries saved at the same
    moment never get the same number, and a save that fails gives its number back."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    last_number = models.BigIntegerField(default=0)

    class Meta:
        verbose_name = "Timesheet Number Counter"
        db_table = "timesheet_number_counter"


def next_timesheet_no():
    with transaction.atomic():
        counter, _ = TimesheetNumberCounter.objects.select_for_update().get_or_create(pk=1)
        counter.last_number += 1
        counter.save(update_fields=["last_number"])
        return f"{TIMESHEET_NO_PREFIX}{counter.last_number}"


class IssueWorkLog(ProjectBaseModel):
    """Time a member spent on a work item. `duration` is stored in minutes, to the second: a timer saves exactly what
    it ran (6 seconds = 0.1), time logged by hand is whole minutes."""

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_worklogs")
    logged_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="user_worklogs")
    duration = models.FloatField(validators=[MinValueValidator(1 / 60), MaxValueValidator(MAX_WORKLOG_DURATION)])
    description = models.TextField(blank=True, default="")
    # Set when the entry comes from the start / stop timer (empty for manual entries)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    # "Timesheet No.", given when the entry is created; never changed afterwards
    timesheet_no = models.CharField(max_length=32, blank=True, default="", db_index=True)

    class Meta:
        verbose_name = "Issue Work Log"
        verbose_name_plural = "Issue Work Logs"
        db_table = "issue_worklogs"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue_id} {self.logged_by_id} {self.duration}m"

    def save(self, *args, **kwargs):
        if self._state.adding and not self.timesheet_no:
            self.timesheet_no = next_timesheet_no()
        super().save(*args, **kwargs)


class IssueWorkLogTimer(ProjectBaseModel):
    """A member's running timer on a work item. One per member per workspace.

    `stopped_at` is set when the member presses Stop; the timer becomes an IssueWorkLog
    once they save the note. Discard takes the Stop back: the timer runs on, and the time it
    stood stopped goes to `paused_seconds`, which never counts.
    """

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="worklog_timers")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="worklog_timers")
    started_at = models.DateTimeField()
    stopped_at = models.DateTimeField(null=True, blank=True)
    paused_seconds = models.PositiveIntegerField(default=0)

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


class IssueTimeEstimate(ProjectBaseModel):
    """How long a work item is expected to take (minutes), set by its team; compared with the time logged.

    `overdue_reason` explains why the logged time went past the estimate.
    """

    issue = models.OneToOneField("db.Issue", on_delete=models.CASCADE, related_name="time_estimate")
    expected_duration = models.PositiveIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(MAX_WORKLOG_DURATION)]
    )
    overdue_reason = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Issue Time Estimate"
        verbose_name_plural = "Issue Time Estimates"
        db_table = "issue_time_estimates"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue_id} {self.expected_duration}m"
