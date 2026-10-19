# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.ticket.base import (
    TicketAttachmentEndpoint,
    TicketBulkCommentEndpoint,
    TicketBulkUpdateEndpoint,
    TicketCommentDetailEndpoint,
    TicketCommentEndpoint,
    TicketDetailEndpoint,
    TicketExportEndpoint,
    TicketHistoryEndpoint,
    TicketListCreateEndpoint,
    TicketMetaEndpoint,
)

# No route accepts DELETE: tickets, comments and documents cannot be deleted.
urlpatterns = [
    path("workspaces/<str:slug>/tickets/", TicketListCreateEndpoint.as_view(), name="tickets"),
    path("workspaces/<str:slug>/tickets/meta/", TicketMetaEndpoint.as_view(), name="ticket-meta"),
    path("workspaces/<str:slug>/tickets/export/", TicketExportEndpoint.as_view(), name="ticket-export"),
    path("workspaces/<str:slug>/tickets/bulk-update/", TicketBulkUpdateEndpoint.as_view(), name="ticket-bulk-update"),
    path(
        "workspaces/<str:slug>/tickets/bulk-comment/", TicketBulkCommentEndpoint.as_view(), name="ticket-bulk-comment"
    ),
    path("workspaces/<str:slug>/tickets/<uuid:ticket_id>/", TicketDetailEndpoint.as_view(), name="ticket-detail"),
    path(
        "workspaces/<str:slug>/tickets/<uuid:ticket_id>/comments/",
        TicketCommentEndpoint.as_view(),
        name="ticket-comments",
    ),
    path(
        "workspaces/<str:slug>/tickets/<uuid:ticket_id>/comments/<uuid:comment_id>/",
        TicketCommentDetailEndpoint.as_view(),
        name="ticket-comment-detail",
    ),
    path(
        "workspaces/<str:slug>/tickets/<uuid:ticket_id>/history/",
        TicketHistoryEndpoint.as_view(),
        name="ticket-history",
    ),
    path(
        "workspaces/<str:slug>/tickets/<uuid:ticket_id>/attachments/",
        TicketAttachmentEndpoint.as_view(),
        name="ticket-attachments",
    ),
    path(
        "workspaces/<str:slug>/tickets/<uuid:ticket_id>/attachments/<uuid:attachment_id>/",
        TicketAttachmentEndpoint.as_view(),
        name="ticket-attachment-detail",
    ),
]
