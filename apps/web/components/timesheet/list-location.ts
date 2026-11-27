/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// The Time Sheet list's filters and page as last seen (its URL query), so "Time Sheet" in an entry's breadcrumb
// goes back to the same list. Kept for the browser tab's session only.
let lastListQuery = "";

export const rememberTimesheetListQuery = (query: string) => {
  lastListQuery = query;
};

export const timesheetListHref = (workspaceSlug: string) =>
  `/${workspaceSlug}/timesheet${lastListQuery ? `?${lastListQuery}` : ""}`;

export const timesheetEntryHref = (workspaceSlug: string, entryId: string) => `/${workspaceSlug}/timesheet/${entryId}`;
