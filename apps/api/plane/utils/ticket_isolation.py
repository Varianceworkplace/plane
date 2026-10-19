# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Third party imports
from rest_framework.exceptions import NotFound

# URL kwargs that may carry the id of a project, work item, comment or asset
ISOLATED_KWARGS = (
    "pk",
    "project_id",
    "issue_id",
    "work_item_id",
    "comment_id",
    "asset_id",
    "parent_id",
    "related_issue_id",
)


def _uuid_values(kwargs):
    values = set()
    for key in ISOLATED_KWARGS:
        value = kwargs.get(key)
        if value is None:
            continue
        try:
            values.add(uuid.UUID(str(value)))
        except ValueError:
            continue
    return values


def references_ticket_data(kwargs):
    """True when a URL points at the ticket project or at anything stored inside it."""
    from plane.db.models import FileAsset, Issue, IssueComment, Project

    values = _uuid_values(kwargs)
    if not values:
        return False

    ticket_projects = Project.ticket_projects.all()
    if kwargs.get("slug"):
        ticket_projects = ticket_projects.filter(workspace__slug=kwargs["slug"])
    ticket_project_ids = set(ticket_projects.values_list("id", flat=True))
    if not ticket_project_ids:
        return False
    if values & ticket_project_ids:
        return True

    return (
        Issue.all_objects.filter(id__in=values, project_id__in=ticket_project_ids).exists()
        or IssueComment.all_objects.filter(id__in=values, project_id__in=ticket_project_ids).exists()
        or FileAsset.all_objects.filter(id__in=values, project_id__in=ticket_project_ids).exists()
    )


class TicketIsolationMixin:
    """
    Keeps helpdesk tickets out of every generic endpoint. Only views that set
    `ticket_endpoint = True` (plane.app.views.ticket) may touch ticket data.
    """

    ticket_endpoint = False

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not self.ticket_endpoint and references_ticket_data(kwargs):
            raise NotFound()
