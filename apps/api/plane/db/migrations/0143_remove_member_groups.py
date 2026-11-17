# Groups are gone: their task and project assignments moved to teams in 0142. The "Groups" permissions of every role
# and team go with them.

from django.db import migrations, models


def drop_group_permissions(apps, schema_editor):
    apps.get_model("db", "RolePermission").objects.filter(module="groups").delete()
    apps.get_model("db", "TeamPermission").objects.filter(module="groups").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0142_team_assignment"),
    ]

    operations = [
        # reversing doesn't bring the permissions back; the groups come back empty
        migrations.RunPython(drop_group_permissions, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="issue",
            name="assignee_group",
        ),
        migrations.RemoveField(
            model_name="projectdetail",
            name="assigned_group",
        ),
        migrations.RemoveField(
            model_name="membergroupmember",
            name="group",
        ),
        migrations.RemoveField(
            model_name="membergroupmember",
            name="created_by",
        ),
        migrations.RemoveField(
            model_name="membergroupmember",
            name="member",
        ),
        migrations.RemoveField(
            model_name="membergroupmember",
            name="updated_by",
        ),
        migrations.RemoveField(
            model_name="membergroupmember",
            name="workspace",
        ),
        migrations.AlterField(
            model_name="rolepermission",
            name="module",
            field=models.CharField(
                choices=[
                    ("projects", "Projects"),
                    ("work_items", "Work items"),
                    ("milestones", "Milestones"),
                    ("worklogs", "Worklogs and reports"),
                    ("members", "Employees and members"),
                    ("tickets", "Tickets"),
                    ("analytics", "Analytics and dashboards"),
                    ("teams", "Teams"),
                    ("role_management", "Role management"),
                ],
                max_length=50,
            ),
        ),
        migrations.AlterField(
            model_name="teampermission",
            name="module",
            field=models.CharField(
                choices=[
                    ("projects", "Projects"),
                    ("work_items", "Work items"),
                    ("milestones", "Milestones"),
                    ("worklogs", "Worklogs and reports"),
                    ("members", "Employees and members"),
                    ("tickets", "Tickets"),
                    ("analytics", "Analytics and dashboards"),
                    ("teams", "Teams"),
                    ("role_management", "Role management"),
                ],
                max_length=50,
            ),
        ),
        migrations.DeleteModel(
            name="MemberGroup",
        ),
        migrations.DeleteModel(
            name="MemberGroupMember",
        ),
    ]
