/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TStateGroups } from "@plane/types";
// local imports
import type { TWorklog, TWorklogUser } from "@/components/worklogs/types";

export type TWorklogReportType = "project-wise" | "user-wise" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

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
  /** departments (teams): their members */
  team?: string[];
  /** project managers: the members of the teams they lead */
  pm?: string[];
  /** member groups: their members */
  group?: string[];
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
  /** the work item's assignees */
  assignees?: TWorklogUser[];
};

export type TWorklogReportSortKey = "work_date" | "duration" | "user" | "project" | "task" | "status";

/** Search and sort for the worklog list; ordering is a sort key, prefixed with - for descending */
export type TWorklogReportListOptions = {
  search?: string;
  ordering?: TWorklogReportSortKey | `-${TWorklogReportSortKey}`;
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

// ------------------------------------------------------------------ analytics (charts)

export type TWorklogAnalyticsPeriod = "day" | "week" | "month" | "quarter" | "year";

export type TWorklogAnalyticsBucket = {
  /** start of the day / week / month / quarter / year, YYYY-MM-DD */
  key: string;
  start: string;
  end: string;
  worked_duration: number;
  worklog_count: number;
  employees: number;
  tasks_completed: number;
  tasks_created: number;
  tickets_created: number;
  tickets_resolved: number;
  /** projects whose actual end date falls in the bucket */
  projects_completed: number;
  milestones_completed: number;
};

export type TWorklogAnalyticsEmployee = TWorklogUser & {
  worked_duration: number;
  worklog_count: number;
  expected_duration: number;
  tasks_assigned: number;
  tasks_completed: number;
  tasks_pending: number;
  completed_expected_duration: number;
  /** expected time of the work items completed in the range against the time logged in it; null without time */
  productivity: number | null;
};

export type TWorklogAnalyticsProject = {
  id: string;
  name: string;
  identifier: string;
  worked_duration: number;
  worklog_count: number;
  employees: number;
  people: { id: string; worked_duration: number }[];
  tasks_total: number;
  tasks_completed: number;
  tasks_pending: number;
  status_groups: Record<TStateGroups, number>;
  /** per period bucket, with a period */
  series: { key: string; worked_duration: number; tasks_completed: number }[];
};

/** A team (department): its members' numbers added up */
export type TWorklogAnalyticsDepartment = {
  id: string;
  name: string;
  employees: number;
  worked_duration: number;
  expected_duration: number;
  tasks_assigned: number;
  tasks_completed: number;
  tasks_pending: number;
  completed_expected_duration: number;
  productivity: number | null;
};

export type TWorklogAnalyticsMilestone = {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  status: string;
  start_date: string | null;
  target_date: string | null;
  actual_completion_date: string | null;
  total_items: number;
  completed_items: number;
  progress: number;
  is_completed: boolean;
  is_overdue: boolean;
};

export type TWorklogAnalytics = {
  period: TWorklogAnalyticsPeriod | null;
  from_date: string | null;
  to_date: string | null;
  summary: {
    worked_duration: number;
    worklog_count: number;
    expected_duration: number;
    employees: number;
    active_employees: number;
    projects: number;
    tasks_total: number;
    tasks_completed: number;
    tasks_pending: number;
    tasks_created: number;
    projects_completed: number;
    milestones: number;
    milestones_completed: number;
  };
  series: TWorklogAnalyticsBucket[];
  /** worked time Monday (1) to Sunday (7) */
  weekdays: { weekday: number; worked_duration: number; worklog_count: number }[];
  status_groups: Record<TStateGroups, number>;
  priorities: Record<"urgent" | "high" | "medium" | "low" | "none", number>;
  employees: TWorklogAnalyticsEmployee[];
  projects: TWorklogAnalyticsProject[];
  departments: TWorklogAnalyticsDepartment[];
  milestones: TWorklogAnalyticsMilestone[];
  /** null under a project filter: tickets aren't part of projects */
  tickets: {
    created: number;
    resolved: number;
    open: number;
    average_resolution_hours: number | null;
    statuses: Record<string, number>;
  } | null;
  scope: TWorklogReportScope;
};

export type TWorklogReportOptions = {
  departments: { id: string; name: string }[];
  project_managers: (TWorklogUser & { team_ids: string[] })[];
  groups: { id: string; name: string }[];
};
