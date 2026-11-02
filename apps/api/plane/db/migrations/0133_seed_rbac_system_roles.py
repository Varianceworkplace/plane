# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations

from plane.db.models.rbac import seed_system_roles


def create_system_roles(apps, schema_editor):
    """Gives every existing workspace the built-in HR, Project Manager and Employee roles. Nobody is assigned one."""
    Workspace = apps.get_model("db", "Workspace")
    Role = apps.get_model("db", "Role")
    RolePermission = apps.get_model("db", "RolePermission")
    for workspace_id in Workspace.objects.filter(deleted_at__isnull=True).values_list("id", flat=True):
        seed_system_roles(Role, RolePermission, workspace_id)


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0132_rbac_foundations"),
    ]

    # the roles go away with their tables when 0132 is reversed
    operations = [migrations.RunPython(create_system_roles, migrations.RunPython.noop)]
