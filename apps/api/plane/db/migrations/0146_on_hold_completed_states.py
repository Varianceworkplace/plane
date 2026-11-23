# Every project's statuses close a task the way a timer's time log does (Save time log: On Hold or Completed), as in
# Workplace: "Done" becomes "Completed" and an "On Hold" status (in progress, paused) is added before it. Projects
# that already have them, or renamed Done, are left as they are. Reversible.

from django.db import migrations
from django.db.models import Count, Q
from django.utils import timezone

ON_HOLD = {"name": "On Hold", "slug": "on-hold", "color": "#F97316", "sequence": 40000, "group": "started"}


def forwards(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")
    now = timezone.now()
    for project_id, workspace_id in Project.objects.filter(
        is_ticket_project=False, deleted_at__isnull=True
    ).values_list("id", "workspace_id"):
        states = State.objects.filter(project_id=project_id, deleted_at__isnull=True)
        if not states.filter(name__iexact="Completed").exists():
            states.filter(group="completed", name__iexact="Done").update(
                name="Completed", slug="completed", updated_at=now
            )
        if not states.filter(name__iexact="On Hold").exists():
            State.objects.create(
                project_id=project_id,
                workspace_id=workspace_id,
                description="",
                created_at=now,
                updated_at=now,
                **ON_HOLD,
            )


def backwards(apps, schema_editor):
    State = apps.get_model("db", "State")
    now = timezone.now()
    for state in State.objects.filter(group="completed", name="Completed", deleted_at__isnull=True):
        if not State.objects.filter(project_id=state.project_id, name__iexact="Done", deleted_at__isnull=True).exists():
            State.objects.filter(pk=state.pk).update(name="Done", slug="done", updated_at=now)
    # On Hold goes only where no task is in it
    unused = (
        State.objects.filter(name="On Hold", group="started", deleted_at__isnull=True)
        .annotate(tasks=Count("state_issue", filter=Q(state_issue__deleted_at__isnull=True)))
        .filter(tasks=0)
    )
    State.objects.filter(pk__in=list(unused.values_list("pk", flat=True))).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0145_team_member_level"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
