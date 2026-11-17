# Seniority inside a team (Junior / Mid-level / Senior): people see the timesheets of the levels below theirs.
# Everyone starts as Junior, so nobody sees more until HR sets a level.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0144_project_list_choice"),
    ]

    operations = [
        migrations.AddField(
            model_name="teammember",
            name="level",
            field=models.CharField(
                choices=[("junior", "Junior"), ("mid", "Mid-level"), ("senior", "Senior")],
                default="junior",
                max_length=10,
            ),
        ),
    ]
