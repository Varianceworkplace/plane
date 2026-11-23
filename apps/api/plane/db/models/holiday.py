# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models

# Module imports
from .base import BaseModel


class HolidayKind(models.TextChoices):
    """A holiday is a day off for everyone. An optional holiday is one employees may choose to take: it stays a working
    day in Attendance."""

    HOLIDAY = "holiday", "Holiday"
    OPTIONAL = "optional", "Optional holiday"


class Holiday(BaseModel):
    """The company's holiday list (sidebar › Holidays), one per date. Everyone sees it; workspace admins and HR keep it
    (plane.app.views.holiday). Attendance marks these days instead of counting them absent."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="holidays")
    date = models.DateField(db_index=True)
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=16, choices=HolidayKind.choices, default=HolidayKind.HOLIDAY)
    description = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Holiday"
        verbose_name_plural = "Holidays"
        db_table = "holidays"
        ordering = ("date",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "date"],
                condition=models.Q(deleted_at__isnull=True),
                name="holiday_unique_date_per_workspace_when_deleted_at_null",
            ),
        ]

    def __str__(self):
        return f"{self.workspace_id} {self.date} {self.name}"
