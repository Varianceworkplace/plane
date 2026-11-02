# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.member_group.base import MemberGroupDetailEndpoint, MemberGroupEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/groups/",
        MemberGroupEndpoint.as_view(),
        name="member-groups",
    ),
    path(
        "workspaces/<str:slug>/groups/<uuid:pk>/",
        MemberGroupDetailEndpoint.as_view(),
        name="member-group-detail",
    ),
]
