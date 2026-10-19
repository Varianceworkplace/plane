# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.worklog.base import (
    IssueWorkLogDetailEndpoint,
    IssueWorkLogEndpoint,
    IssueWorkLogTimerStartEndpoint,
    WorkspaceWorkLogDownloadEndpoint,
    WorkspaceWorkLogEndpoint,
    WorkspaceWorkLogTimerEndpoint,
    WorkspaceWorkLogTimerSaveEndpoint,
    WorkspaceWorkLogTimerStopEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/worklogs/",
        IssueWorkLogEndpoint.as_view(),
        name="issue-worklogs",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/worklogs/<uuid:pk>/",
        IssueWorkLogDetailEndpoint.as_view(),
        name="issue-worklog-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/worklog-timer/",
        IssueWorkLogTimerStartEndpoint.as_view(),
        name="issue-worklog-timer-start",
    ),
    path("workspaces/<str:slug>/worklog-timer/", WorkspaceWorkLogTimerEndpoint.as_view(), name="worklog-timer"),
    path(
        "workspaces/<str:slug>/worklog-timer/stop/",
        WorkspaceWorkLogTimerStopEndpoint.as_view(),
        name="worklog-timer-stop",
    ),
    path(
        "workspaces/<str:slug>/worklog-timer/save/",
        WorkspaceWorkLogTimerSaveEndpoint.as_view(),
        name="worklog-timer-save",
    ),
    path("workspaces/<str:slug>/worklogs/", WorkspaceWorkLogEndpoint.as_view(), name="workspace-worklogs"),
    path(
        "workspaces/<str:slug>/worklogs/download/",
        WorkspaceWorkLogDownloadEndpoint.as_view(),
        name="workspace-worklogs-download",
    ),
]
