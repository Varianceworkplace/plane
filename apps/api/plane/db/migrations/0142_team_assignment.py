# Groups become teams: a project task or a project can now be assigned to a team (Access control › Teams), and
# every group's assignments move to one. 0143 then removes groups.
#
# Each live group moves to the smallest team that already has all of its people (several: the first by name); a
# group no team covers becomes a new team of the same people without a lead, so nobody gets a PM's rights over them.

from django.db import migrations, models
import django.db.models.deletion


def team_name(Team, workspace_id, name):
    """The group's name, or with "(group)" after it when a team already has it."""
    taken = set(Team.objects.filter(workspace_id=workspace_id, deleted_at__isnull=True).values_list("name", flat=True))
    candidate, n = name, 1
    while candidate in taken:
        candidate = f"{name} (group)" if n == 1 else f"{name} (group {n})"
        n += 1
    return candidate


def groups_to_teams(apps, schema_editor):
    MemberGroup = apps.get_model("db", "MemberGroup")
    MemberGroupMember = apps.get_model("db", "MemberGroupMember")
    Team = apps.get_model("db", "Team")
    TeamMember = apps.get_model("db", "TeamMember")
    Issue = apps.get_model("db", "Issue")
    ProjectDetail = apps.get_model("db", "ProjectDetail")

    for group in MemberGroup.objects.filter(deleted_at__isnull=True).order_by("created_at"):
        people = set(
            MemberGroupMember.objects.filter(group_id=group.pk, deleted_at__isnull=True).values_list(
                "member_id", flat=True
            )
        )
        team = None
        if people:
            candidates = []
            for candidate in Team.objects.filter(workspace_id=group.workspace_id, deleted_at__isnull=True):
                team_people = set(
                    TeamMember.objects.filter(team_id=candidate.pk, deleted_at__isnull=True).values_list(
                        "member_id", flat=True
                    )
                )
                if people <= team_people:
                    candidates.append((len(team_people), candidate.name, candidate))
            if candidates:
                team = sorted(candidates, key=lambda row: (row[0], row[1]))[0][2]
        if team is None:
            team = Team.objects.create(
                workspace_id=group.workspace_id,
                name=team_name(Team, group.workspace_id, group.name),
                description=group.description or "",
                created_by_id=group.created_by_id,
                updated_by_id=group.created_by_id,
            )
            TeamMember.objects.bulk_create(
                [
                    TeamMember(
                        workspace_id=group.workspace_id,
                        team_id=team.pk,
                        member_id=member_id,
                        is_lead=False,
                        created_by_id=group.created_by_id,
                    )
                    for member_id in people
                ]
            )
        Issue.objects.filter(assignee_group_id=group.pk).update(assignee_team_id=team.pk)
        ProjectDetail.objects.filter(assigned_group_id=group.pk).update(assigned_team_id=team.pk)


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0141_project_detail_assigned_group"),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="assignee_team",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assigned_issues",
                to="db.team",
            ),
        ),
        migrations.AddField(
            model_name="projectdetail",
            name="assigned_team",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assigned_project_details",
                to="db.team",
            ),
        ),
        # the group's assignments are kept as they were if this is reversed (0143's reverse brings groups back empty)
        migrations.RunPython(groups_to_teams, migrations.RunPython.noop),
    ]
