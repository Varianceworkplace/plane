# A person's "Show in List" / "Hide from List" choice for a project in their sidebar Projects list. Null = not chosen.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0143_remove_member_groups"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectuserproperty",
            name="show_in_list",
            field=models.BooleanField(blank=True, null=True),
        ),
    ]
