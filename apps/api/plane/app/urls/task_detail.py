# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.task_detail.base import IssueTaskDetailEndpoint, TaskDetailOptionsEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/task-detail-options/",
        TaskDetailOptionsEndpoint.as_view(),
        name="task-detail-options",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/task-detail/",
        IssueTaskDetailEndpoint.as_view(),
        name="issue-task-detail",
    ),
]
