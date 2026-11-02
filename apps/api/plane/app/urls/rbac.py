# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.rbac.base import (
    AccessControlEndpoint,
    AccessMembersEndpoint,
    CheckAccessEndpoint,
    MemberRolesEndpoint,
    MyAccessEndpoint,
    ProjectAccessEndpoint,
    ProjectAccessGrantDetailEndpoint,
    RoleDetailEndpoint,
    RoleListCreateEndpoint,
    RolloutPreviewEndpoint,
    TeamDetailEndpoint,
    TeamListCreateEndpoint,
)
from plane.app.views.rbac.join_request import ProjectJoinRequestDetailEndpoint, ProjectJoinRequestEndpoint

urlpatterns = [
    path("workspaces/<str:slug>/access-control/", AccessControlEndpoint.as_view(), name="access-control"),
    path("workspaces/<str:slug>/access-control/me/", MyAccessEndpoint.as_view(), name="access-me"),
    path(
        "workspaces/<str:slug>/access-control/preview/",
        RolloutPreviewEndpoint.as_view(),
        name="access-rollout-preview",
    ),
    path("workspaces/<str:slug>/access-control/roles/", RoleListCreateEndpoint.as_view(), name="access-roles"),
    path(
        "workspaces/<str:slug>/access-control/roles/<uuid:pk>/",
        RoleDetailEndpoint.as_view(),
        name="access-role-detail",
    ),
    path("workspaces/<str:slug>/access-control/members/", AccessMembersEndpoint.as_view(), name="access-members"),
    path(
        "workspaces/<str:slug>/access-control/members/<uuid:member_id>/roles/",
        MemberRolesEndpoint.as_view(),
        name="access-member-roles",
    ),
    path(
        "workspaces/<str:slug>/access-control/members/<uuid:member_id>/check/",
        CheckAccessEndpoint.as_view(),
        name="access-check",
    ),
    path("workspaces/<str:slug>/access-control/teams/", TeamListCreateEndpoint.as_view(), name="access-teams"),
    path(
        "workspaces/<str:slug>/access-control/teams/<uuid:pk>/",
        TeamDetailEndpoint.as_view(),
        name="access-team-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/access/",
        ProjectAccessEndpoint.as_view(),
        name="project-access",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/access/<uuid:pk>/",
        ProjectAccessGrantDetailEndpoint.as_view(),
        name="project-access-grant",
    ),
    path(
        "workspaces/<str:slug>/project-join-requests/",
        ProjectJoinRequestEndpoint.as_view(),
        name="project-join-requests",
    ),
    path(
        "workspaces/<str:slug>/project-join-requests/<uuid:pk>/",
        ProjectJoinRequestDetailEndpoint.as_view(),
        name="project-join-request-detail",
    ),
]
