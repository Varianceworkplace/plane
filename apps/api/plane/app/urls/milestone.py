# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.milestone.base import (
    MilestoneAvailableWorkItemEndpoint,
    MilestoneDetailEndpoint,
    MilestoneEndpoint,
    MilestoneWorkItemEndpoint,
    WorkItemMilestoneEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/milestones/",
        MilestoneEndpoint.as_view(),
        name="project-milestones",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/milestones/<uuid:pk>/",
        MilestoneDetailEndpoint.as_view(),
        name="project-milestone-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/milestones/<uuid:pk>/work-items/",
        MilestoneWorkItemEndpoint.as_view(),
        name="project-milestone-work-items",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/milestones/<uuid:pk>/available-work-items/",
        MilestoneAvailableWorkItemEndpoint.as_view(),
        name="project-milestone-available-work-items",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/milestone/",
        WorkItemMilestoneEndpoint.as_view(),
        name="work-item-milestone",
    ),
]
