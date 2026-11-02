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
    WorkspaceWorkLogTimerResumeEndpoint,
    WorkspaceWorkLogTimerSaveEndpoint,
    WorkspaceWorkLogTimerStopEndpoint,
)
from plane.app.views.worklog.estimate import IssueTimeEstimateEndpoint, ProjectTimeEstimatesEndpoint
from plane.app.views.worklog.report import (
    WorkLogReportDetailEndpoint,
    WorkLogReportDownloadEndpoint,
    WorkLogReportEndpoint,
    WorkLogReportMonthlyEndpoint,
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
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/time-estimate/",
        IssueTimeEstimateEndpoint.as_view(),
        name="issue-time-estimate",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/time-estimates/",
        ProjectTimeEstimatesEndpoint.as_view(),
        name="project-time-estimates",
    ),
    path("workspaces/<str:slug>/worklog-timer/", WorkspaceWorkLogTimerEndpoint.as_view(), name="worklog-timer"),
    path(
        "workspaces/<str:slug>/worklog-timer/stop/",
        WorkspaceWorkLogTimerStopEndpoint.as_view(),
        name="worklog-timer-stop",
    ),
    path(
        "workspaces/<str:slug>/worklog-timer/resume/",
        WorkspaceWorkLogTimerResumeEndpoint.as_view(),
        name="worklog-timer-resume",
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
    path("workspaces/<str:slug>/worklog-reports/", WorkLogReportEndpoint.as_view(), name="worklog-reports"),
    path(
        "workspaces/<str:slug>/worklog-reports/monthly/",
        WorkLogReportMonthlyEndpoint.as_view(),
        name="worklog-report-monthly",
    ),
    path(
        "workspaces/<str:slug>/worklog-reports/worklogs/",
        WorkLogReportDetailEndpoint.as_view(),
        name="worklog-report-worklogs",
    ),
    path(
        "workspaces/<str:slug>/worklog-reports/download/",
        WorkLogReportDownloadEndpoint.as_view(),
        name="worklog-report-download",
    ),
]
