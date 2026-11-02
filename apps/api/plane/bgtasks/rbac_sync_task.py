# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import Workspace
from plane.utils.exception_logger import log_exception
from plane.utils.rbac import sync_project_access


@shared_task
def sync_project_access_task(workspace_id):
    """Project memberships follow role-based access again after roles, teams, shares or the switch changed."""
    try:
        sync_project_access(workspace_id)
    except Exception as e:
        log_exception(e)


@shared_task
def sync_all_project_access():
    """Hourly: shares that expired since lose their memberships."""
    for workspace_id in Workspace.objects.filter(is_rbac_enabled=True).values_list("id", flat=True):
        sync_project_access_task(workspace_id)
