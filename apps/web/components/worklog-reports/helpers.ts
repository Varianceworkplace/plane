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
  TWorklogReportEntry,
  TWorklogReportFilters,
  TWorklogReportGroupBy,
  TWorklogReportProject,
  TWorklogReportType,
  TWorklogReportUser,
} from "./types";

export const worklogReportService = new WorklogReportService();

export const WORKLOG_REPORT_TYPES: { key: TWorklogReportType; label: string }[] = [
  { key: "project-wise", label: "Project-wise" },
  { key: "user-wise", label: "User-wise" },
  { key: "monthly", label: "Monthly" },
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
  groupBy?: TWorklogReportGroupBy
) => {
  const { data, error, isLoading } = useSWR(
    enabled && workspaceSlug
      ? ["WORKLOG_REPORT_DETAIL", workspaceSlug, JSON.stringify(filters), page, perPage, groupBy ?? ""]
      : null,
    () => worklogReportService.worklogs(workspaceSlug, filters, page, perPage, groupBy),
    { revalidateOnFocus: false, keepPreviousData: true }
  );
  return { detail: data, error, isLoading };
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
