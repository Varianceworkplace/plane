# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.holiday.base import (
    HolidayCopyEndpoint,
    HolidayDetailEndpoint,
    HolidayEndpoint,
    HolidayImportEndpoint,
)

urlpatterns = [
    path("workspaces/<str:slug>/holidays/", HolidayEndpoint.as_view(), name="holidays"),
    path("workspaces/<str:slug>/holidays/copy/", HolidayCopyEndpoint.as_view(), name="holidays-copy"),
    path("workspaces/<str:slug>/holidays/import/", HolidayImportEndpoint.as_view(), name="holidays-import"),
    path("workspaces/<str:slug>/holidays/<uuid:pk>/", HolidayDetailEndpoint.as_view(), name="holiday-detail"),
]
