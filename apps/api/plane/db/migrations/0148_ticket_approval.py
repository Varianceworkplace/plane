# Tickets wait for the Manager's approval before the assignee sees them. Existing tickets count as approved
# (the field's default), so none disappear.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0147_worklog_duration_seconds"),
    ]

    operations = [
        migrations.AddField(
            model_name="ticket",
            name="approval_decided_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="ticket",
            name="approval_decided_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="decided_ticket_approvals",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="ticket",
            name="approval_note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="ticket",
            name="approval_status",
            field=models.CharField(
                choices=[("pending", "Waiting for approval"), ("approved", "Approved"), ("rejected", "Rejected")],
                db_index=True,
                default="approved",
                max_length=16,
            ),
        ),
    ]
