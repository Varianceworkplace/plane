# Time entries keep seconds: a timer saves exactly what it ran (6 seconds is 0.1 minute, not 1 minute).
# Existing entries are unchanged (whole minutes stay whole).

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0146_on_hold_completed_states"),
    ]

    operations = [
        migrations.AlterField(
            model_name="issueworklog",
            name="duration",
            field=models.FloatField(
                validators=[
                    django.core.validators.MinValueValidator(0.016666666666666666),
                    django.core.validators.MaxValueValidator(59999),
                ]
            ),
        ),
    ]
