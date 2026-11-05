/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// components
import { pad } from "@/components/worklogs/helpers";
// services
import { WorklogReportService } from "@/services/worklog-report.service";
// local imports
import type {
  TWorklogAnalyticsPeriod,
  TWorklogReportEntry,
  TWorklogReportFilters,
  TWorklogReportGroupBy,
  TWorklogReportListOptions,
  TWorklogReportProject,
  TWorklogReportType,
  TWorklogReportUser,
} from "./types";

export const worklogReportService = new WorklogReportService();

export const WORKLOG_REPORT_TYPES: { key: TWorklogReportType; label: string }[] = [
  { key: "project-wise", label: "Project-wise" },
  { key: "user-wise", label: "User-wise" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "yearly", label: "Yearly" },
];

export const isWorklogReportType = (value: string | undefined): value is TWorklogReportType =>
  WORKLOG_REPORT_TYPES.some((type) => type.key === value);

export const EMPTY_WORKLOG_REPORT_FILTERS: TWorklogReportFilters = { project: [], logged_by: [], state_group: [] };

/** Local calendar day as YYYY-MM-DD (not UTC, so late-evening picks keep their day). */
export const toReportDate = (date: Date | null | undefined) =>
  date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : undefined;

/** "2026-03-10" -> local Date at midnight */
export const fromReportDate = (value: string | undefined) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/** The last six months, this one included: the monthly report's starting range. */
export const getDefaultMonthlyFilters = (today = new Date()): TWorklogReportFilters => ({
  ...EMPTY_WORKLOG_REPORT_FILTERS,
  from_date: toReportDate(new Date(today.getFullYear(), today.getMonth() - 5, 1)),
  to_date: toReportDate(today),
});

/** Daily: the last 14 days; weekly: the last 8 weeks, Monday to Sunday (this week included). */
export const getDefaultPeriodFilters = (period: "day" | "week", today = new Date()): TWorklogReportFilters => {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (period === "day") start.setDate(start.getDate() - 13);
  else start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * 7);
  return { ...EMPTY_WORKLOG_REPORT_FILTERS, from_date: toReportDate(start), to_date: toReportDate(today) };
};

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

/** A period bucket on a chart axis: "Mon, Oct 26" for a day, "Oct 26 – Nov 1" for a week. */
export const formatBucketLabel = (start: string, end: string, period: "day" | "week") => {
  const from = fromReportDate(start);
  const to = fromReportDate(end);
  if (!from || !to) return start;
  if (period === "day") return `${WEEKDAY.format(from)}, ${SHORT_DATE.format(from)}`;
  return `${SHORT_DATE.format(from)} – ${SHORT_DATE.format(to)}`;
};

/** "2026-10-26" -> "Oct 26" */
export const formatShortDate = (value: string) => {
  const date = fromReportDate(value);
  return date ? SHORT_DATE.format(date) : value;
};

/** Monday (1) to Sunday (7) as "Mon" ... "Sun" */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "2026-10" -> "Oct 2026" */
export const formatReportMonth = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

/** First and last day of a "YYYY-MM" month, kept inside the report's own dates. */
export const getMonthRange = (key: string, filters: Pick<TWorklogReportFilters, "from_date" | "to_date">) => {
  const [year, month] = key.split("-").map(Number);
  const first = toReportDate(new Date(year, month - 1, 1)) as string;
  const last = toReportDate(new Date(year, month, 0)) as string;
  // YYYY-MM-DD strings sort like the dates they name
  return {
    from_date: filters.from_date && filters.from_date > first ? filters.from_date : first,
    to_date: filters.to_date && filters.to_date < last ? filters.to_date : last,
  };
};

/** 90 -> 1.5 */
export const minutesToHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export const hasWorklogReportFilters = (filters: TWorklogReportFilters) =>
  filters.project.length > 0 ||
  filters.logged_by.length > 0 ||
  filters.state_group.length > 0 ||
  !!filters.team?.length ||
  !!filters.pm?.length ||
  !!filters.group?.length ||
  !!filters.from_date ||
  !!filters.to_date;

export const useWorklogReport = (workspaceSlug: string, filters: TWorklogReportFilters) => {
  const { data, error, isLoading } = useSWR(
    workspaceSlug ? ["WORKLOG_REPORT", workspaceSlug, JSON.stringify(filters)] : null,
    () => worklogReportService.summary(workspaceSlug, filters),
    { revalidateOnFocus: false, keepPreviousData: true }
  );
  return { summary: data, error, isLoading };
};

export const useWorklogMonthlyReport = (workspaceSlug: string, filters: TWorklogReportFilters) => {
  const { data, error, isLoading } = useSWR(
    workspaceSlug ? ["WORKLOG_REPORT_MONTHLY", workspaceSlug, JSON.stringify(filters)] : null,
    () => worklogReportService.monthly(workspaceSlug, filters),
    { revalidateOnFocus: false, keepPreviousData: true }
  );
  return { monthly: data, error, isLoading };
};

export const useWorklogReportDetail = (
  workspaceSlug: string,
  filters: TWorklogReportFilters,
  page: number,
  perPage: number,
  enabled = true,
  groupBy?: TWorklogReportGroupBy,
  list: TWorklogReportListOptions = {}
) => {
  const { data, error, isLoading } = useSWR(
    enabled && workspaceSlug
      ? [
          "WORKLOG_REPORT_DETAIL",
          workspaceSlug,
          JSON.stringify(filters),
          page,
          perPage,
          groupBy ?? "",
          list.search ?? "",
          list.ordering ?? "",
        ]
      : null,
    () => worklogReportService.worklogs(workspaceSlug, filters, page, perPage, groupBy, list),
    { revalidateOnFocus: false, keepPreviousData: true }
  );
  return { detail: data, error, isLoading };
};

export const useWorklogAnalytics = (
  workspaceSlug: string,
  filters: TWorklogReportFilters,
  period?: TWorklogAnalyticsPeriod
) => {
  const { data, error, isLoading } = useSWR(
    workspaceSlug ? ["WORKLOG_ANALYTICS", workspaceSlug, JSON.stringify(filters), period ?? ""] : null,
    () => worklogReportService.analytics(workspaceSlug, filters, period),
    { revalidateOnFocus: false, keepPreviousData: true }
  );
  return { analytics: data, error, isLoading };
};

export const useWorklogReportOptions = (workspaceSlug: string, enabled = true) => {
  const { data } = useSWR(
    enabled && workspaceSlug ? ["WORKLOG_REPORT_OPTIONS", workspaceSlug] : null,
    () => worklogReportService.options(workspaceSlug),
    { revalidateOnFocus: false }
  );
  return data;
};

/** Consecutive entries of the same day, keeping the server's order (newest first). */
export const groupEntriesByDate = (entries: TWorklogReportEntry[]) => {
  const groups: { date: string; entries: TWorklogReportEntry[] }[] = [];
  for (const entry of entries) {
    const date = entry.work_date ?? entry.created_at.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last?.date === date) last.entries.push(entry);
    else groups.push({ date, entries: [entry] });
  }
  return groups;
};

/** One chart row per user: `hours` for the plain chart and one key per project for the stacked one. */
export const buildUserChartData = (users: TWorklogReportUser[]) =>
  users.map((user) => ({
    key: user.id,
    name: user.display_name,
    hours: minutesToHours(user.total_duration),
    minutes: user.total_duration,
    ...Object.fromEntries(user.projects.map((project) => [project.id, minutesToHours(project.total_duration)])),
  }));

export const buildProjectChartData = (projects: TWorklogReportProject[]) =>
  projects.map((project) => ({
    key: project.id,
    name: project.identifier,
    fullName: project.name,
    hours: minutesToHours(project.total_duration),
    minutes: project.total_duration,
  }));

/** Share of the total, as a whole percentage ("—" when nothing was logged). */
export const formatShare = (minutes: number, total: number) =>
  total ? `${Math.round((minutes / total) * 100)}%` : "—";
