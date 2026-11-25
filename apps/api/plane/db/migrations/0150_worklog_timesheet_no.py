# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations, models

PREFIX = "TIME-BILLING-"


def number_existing_entries(apps, schema_editor):
    """Every existing time sheet entry gets a Timesheet No., oldest first, after any number already in use; the
    counter continues from the last one."""
    IssueWorkLog = apps.get_model("db", "IssueWorkLog")
    TimesheetNumberCounter = apps.get_model("db", "TimesheetNumberCounter")
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT COALESCE(MAX(CAST(SUBSTRING(timesheet_no FROM '[0-9]+$') AS BIGINT)), 0) FROM issue_worklogs "
            "WHERE timesheet_no ~ '[0-9]+$'"
        )
        used = cursor.fetchone()[0]
    counter, _ = TimesheetNumberCounter.objects.get_or_create(pk=1)
    used = max(used, counter.last_number)
    ids = list(IssueWorkLog.objects.filter(timesheet_no="").order_by("created_at", "id").values_list("id", flat=True))
    IssueWorkLog.objects.bulk_update(
        [IssueWorkLog(id=pk, timesheet_no=f"{PREFIX}{used + n}") for n, pk in enumerate(ids, start=1)],
        ["timesheet_no"],
        batch_size=1000,
    )
    counter.last_number = used + len(ids)
    counter.save(update_fields=["last_number"])


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0149_holidays"),
    ]

    operations = [
        migrations.CreateModel(
            name="TimesheetNumberCounter",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, primary_key=True, serialize=False)),
                ("last_number", models.BigIntegerField(default=0)),
            ],
            options={
                "verbose_name": "Timesheet Number Counter",
                "db_table": "timesheet_number_counter",
            },
        ),
        migrations.AddField(
            model_name="issueworklog",
            name="timesheet_no",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
        migrations.RunPython(number_existing_entries, migrations.RunPython.noop),
    ]
