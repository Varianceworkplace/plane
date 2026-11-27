# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Project names are unique in a workspace whatever their case: "Variance CRM", "variance crm" and " VARIANCE CRM " are
the same name (spaces around it don't count either).

Checked wherever a project is created or renamed: the app (ProjectSerializer.validate_name) and the public API. The
database's own constraint only stops exact repeats. Archived projects keep their names; deleted ones free them; the
helpdesk's ticket projects count, as the database constraint counts them.
"""

from django.db.models.functions import Trim


def project_name_taken(workspace_id, name, exclude_project_id=None):
    """Whether another project of the workspace already has this name, ignoring case and surrounding spaces."""
    from plane.db.models import Project

    wanted = (name or "").strip()
    if not wanted:
        return False
    projects = (
        Project.all_objects.filter(workspace_id=workspace_id, deleted_at__isnull=True)
        .alias(trimmed_name=Trim("name"))
        .filter(trimmed_name__iexact=wanted)
    )
    if exclude_project_id:
        projects = projects.exclude(pk=exclude_project_id)
    return projects.exists()
