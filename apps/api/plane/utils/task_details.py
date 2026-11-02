# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import Project

SINGLE_ASSIGNEE_ERROR = "Work items in this project have one assignee. Pick a single person."

# Projects people create start with the Project Task fields and time tracking turned on (a create request can
# still turn them off). Projects the server creates for itself, such as the helpdesk one, keep the model default.
NEW_PROJECT_FEATURES = {"is_task_details_enabled": True, "is_time_tracking_enabled": True}


def has_too_many_assignees(project_id, assignee_ids):
    """True when a project with task details turned on would get more than one assignee."""
    return len(assignee_ids or []) > 1 and Project.objects.filter(pk=project_id, is_task_details_enabled=True).exists()
