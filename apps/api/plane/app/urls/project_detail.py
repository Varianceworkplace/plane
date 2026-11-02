# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.project_detail.base import ProjectDetailEndpoint, ProjectDetailOptionsEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/project-detail-options/",
        ProjectDetailOptionsEndpoint.as_view(),
        name="project-detail-options",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-detail/",
        ProjectDetailEndpoint.as_view(),
        name="project-detail",
    ),
]
