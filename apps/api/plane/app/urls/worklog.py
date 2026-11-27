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
from plane.app.views.worklog.active_projects import MyActiveProjectsEndpoint
from plane.app.views.worklog.estimate import (
    IssueTimeEstimateEndpoint,
    ProjectTimeEstimatesEndpoint,
    WorkspaceTimeEstimatesEndpoint,
)
from plane.app.views.worklog.timesheet import TimesheetDownloadEndpoint, TimesheetEndpoint, TimesheetEntryEndpoint
from plane.app.views.worklog.analytics import WorkLogReportAnalyticsEndpoint, WorkLogReportOptionsEndpoint
from plane.app.views.worklog.attendance import AttendanceReportDownloadEndpoint, AttendanceReportEndpoint
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
    # the list rows on screen, across projects, in one request (?issues=<id>,<id>…)
    path(
        "workspaces/<str:slug>/time-estimates/",
        WorkspaceTimeEstimatesEndpoint.as_view(),
        name="workspace-time-estimates",
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
    # sidebar › Projects: the projects the person is working on, by their latest timer activity
    path(
        "workspaces/<str:slug>/my-active-projects/",
        MyActiveProjectsEndpoint.as_view(),
        name="my-active-projects",
    ),
    path(
        "workspaces/<str:slug>/worklogs/download/",
        WorkspaceWorkLogDownloadEndpoint.as_view(),
        name="workspace-worklogs-download",
    ),
    # Time Sheet: time entries one by one (own, team members' as a PM, and the levels below in the same team)
    path("workspaces/<str:slug>/timesheet/", TimesheetEndpoint.as_view(), name="timesheet"),
    # Export Entry: the rows picked, or every entry the filters show (csv / xlsx)
    path("workspaces/<str:slug>/timesheet/download/", TimesheetDownloadEndpoint.as_view(), name="timesheet-download"),
    # one entry, every detail of it (an entry the list would show the viewer; any other is 404)
    path("workspaces/<str:slug>/timesheet/<uuid:pk>/", TimesheetEntryEndpoint.as_view(), name="timesheet-entry"),
    path("workspaces/<str:slug>/worklog-reports/", WorkLogReportEndpoint.as_view(), name="worklog-reports"),
    path(
        "workspaces/<str:slug>/worklog-reports/analytics/",
        WorkLogReportAnalyticsEndpoint.as_view(),
        name="worklog-report-analytics",
    ),
    path(
        "workspaces/<str:slug>/worklog-reports/options/",
        WorkLogReportOptionsEndpoint.as_view(),
        name="worklog-report-options",
    ),
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
    # Attendance: everyone's hours day by day, with Absent and Week Off (and its CSV / Excel)
    path(
        "workspaces/<str:slug>/worklog-reports/attendance/",
        AttendanceReportEndpoint.as_view(),
        name="worklog-report-attendance",
    ),
    path(
        "workspaces/<str:slug>/worklog-reports/attendance/download/",
        AttendanceReportDownloadEndpoint.as_view(),
        name="worklog-report-attendance-download",
    ),
]
