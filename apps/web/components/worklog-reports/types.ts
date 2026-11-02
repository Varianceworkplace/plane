/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TStateGroups } from "@plane/types";
// local imports
import type { TWorklog, TWorklogUser } from "@/components/worklogs/types";

export type TWorklogReportType = "project-wise" | "user-wise" | "monthly";

export type TWorklogReportFilters = {
  project: string[];
  logged_by: string[];
  state_group: TStateGroups[];
  /** work items; set by drill-downs */
  issue?: string[];
  /** YYYY-MM-DD, inclusive */
  from_date?: string;
  /** YYYY-MM-DD, inclusive */
  to_date?: string;
};

export type TWorklogReportTotals = {
  /** minutes */
  total_duration: number;
  worklog_count: number;
};

export type TWorklogReportUser = TWorklogUser &
  TWorklogReportTotals & {
    /** The user's time per project, most first */
    projects: (TWorklogReportTotals & { id: string })[];
  };

export type TWorklogReportProject = TWorklogReportTotals & {
  id: string;
  name: string;
  identifier: string;
};

export type TWorklogReportScope = {
  is_workspace_admin: boolean;
  /** false for members who only see their own time */
  can_view_others: boolean;
  admin_project_ids: string[];
};

export type TWorklogReportSummary = {
  total_duration: number;
  total_count: number;
  users: TWorklogReportUser[];
  projects: TWorklogReportProject[];
  scope: TWorklogReportScope;
};

export type TWorklogReportEntry = TWorklog & {
  /** YYYY-MM-DD in the user's timezone */
  work_date: string | null;
  state: { id: string; name: string; group: TStateGroups; color: string } | null;
};

export type TWorklogReportDay = TWorklogReportTotals & { date: string };

export type TWorklogReportDetail = {
  results: TWorklogReportEntry[];
  days: TWorklogReportDay[];
  total_count: number;
  total_duration: number;
  page: number;
  per_page: number;
  /** with `group_by=work_item`: each work item's totals across every page */
  work_items?: (TWorklogReportTotals & { id: string })[];
};

/** `work_item` lists worklogs work item by work item instead of newest first */
export type TWorklogReportGroupBy = "work_item";

/** What a drill-down shows: one user (optionally in one project / work item) under the report's filters. */
export type TWorklogReportSelection = {
  user: { id: string; name: string };
  project?: { id: string; name: string };
  issue?: { id: string; name: string };
  /** narrows the report's dates, e.g. to one month */
  range?: { from_date?: string; to_date?: string };
};

/** Minutes per month, keyed "YYYY-MM" (months without time are left out) */
export type TWorklogMonthMinutes = Record<string, number>;

export type TWorklogMonthlyNode = TWorklogReportTotals & { months: TWorklogMonthMinutes };

export type TWorklogMonthlyIssue = TWorklogMonthlyNode & { id: string; name: string; sequence_id: number };

export type TWorklogMonthlyProject = TWorklogMonthlyNode & {
  id: string;
  name: string;
  identifier: string;
  issues: TWorklogMonthlyIssue[];
};

export type TWorklogMonthlyUser = TWorklogUser & TWorklogMonthlyNode & { projects: TWorklogMonthlyProject[] };

export type TWorklogMonthlyReport = {
  /** every month in the range, oldest first */
  months: string[];
  month_totals: TWorklogMonthMinutes;
  total_duration: number;
  total_count: number;
  users: TWorklogMonthlyUser[];
  scope: TWorklogReportScope;
};
