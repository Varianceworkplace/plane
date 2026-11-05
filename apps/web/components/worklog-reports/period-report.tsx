/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { STATE_GROUPS } from "@plane/constants";
import { Loader } from "@plane/blocks/skeleton";
import { cn } from "@plane/utils";
// components
import { formatWorklogDuration, getWorklogUserName } from "@/components/worklogs/helpers";
// local imports
import type { TChartRow, TReportChart } from "./analytics-charts";
import { ReportChartGrid, shortLabel } from "./analytics-charts";
import {
  PRODUCTIVITY_EMPTY,
  PRODUCTIVITY_HINT,
  buildProductivityRows,
  completionSlices,
  hasProductivity,
  statusSlices,
} from "./analytics-insights";
import {
  WEEKDAY_LABELS,
  formatBucketLabel,
  formatShortDate,
  getDefaultPeriodFilters,
  useWorklogAnalytics,
  worklogReportService,
} from "./helpers";
import { WorklogReportFilters } from "./report-filters";
import { useReportPdfExport } from "./report-pdf-export";
import type { TReportExportFormat } from "./report-parts";
import { OwnTimeNotice, ReportExportMenu, Stat } from "./report-parts";
import { WorklogReportRecords } from "./report-records";
import type { TWorklogAnalytics, TWorklogReportFilters } from "./types";

type TPeriod = "day" | "week";

// most rows a bar chart shows; the records table lists everything
const MAX_ROWS = 15;

const toHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

const TASK_SERIES = [
  { key: "completed", label: "Completed", color: STATE_GROUPS.completed.color },
  { key: "created", label: "Created", color: STATE_GROUPS.unstarted.color },
];

const TICKET_SERIES = [
  { key: "raised", label: "Raised", color: STATE_GROUPS.started.color },
  { key: "resolved", label: "Resolved", color: STATE_GROUPS.completed.color },
];

const NO_TICKETS_FOR_PROJECTS = "Tickets aren't part of projects. Clear the project filter to see them.";

/** One row per day or week, carrying every series the period charts draw. */
const periodRows = (analytics: TWorklogAnalytics, period: TPeriod): TChartRow[] =>
  analytics.series.map((bucket) => ({
    key: bucket.key,
    name: formatShortDate(bucket.start),
    title: formatBucketLabel(bucket.start, bucket.end, period),
    worked: toHours(bucket.worked_duration),
    completed: bucket.tasks_completed,
    created: bucket.tasks_created,
    raised: bucket.tickets_created,
    resolved: bucket.tickets_resolved,
  }));

const employeeHourRows = (analytics: TWorklogAnalytics): TChartRow[] =>
  analytics.employees
    .filter((person) => person.worked_duration > 0)
    .slice(0, MAX_ROWS)
    .map((person) => ({
      key: person.id,
      name: shortLabel(getWorklogUserName(person)),
      title: getWorklogUserName(person),
      worked: toHours(person.worked_duration),
    }));

const projectHourRows = (analytics: TWorklogAnalytics): TChartRow[] =>
  analytics.projects
    .filter((project) => project.worked_duration > 0)
    .slice(0, MAX_ROWS)
    .map((project) => ({
      key: project.id,
      name: project.identifier || project.name,
      worked: toHours(project.worked_duration),
    }));

const sum = (rows: TChartRow[], key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

/** The daily report's charts. */
export const dailyCharts = (analytics: TWorklogAnalytics): TReportChart[] => {
  const rows = periodRows(analytics, "day");
  const people = employeeHourRows(analytics);
  const statuses = statusSlices(analytics.status_groups);
  const statusTotal = statuses.reduce((total, slice) => total + slice.value, 0);
  return [
    {
      key: "hours",
      kind: "bar",
      title: "Daily working hours",
      hint: "Time logged each day",
      isEmpty: !sum(rows, "worked"),
      emptyText: "No time logged in this period.",
      rows,
      series: [{ key: "worked", label: "Hours" }],
      format: "hours",
      xAxisLabel: "Days",
    },
    {
      key: "status",
      kind: "donut",
      title: "Task status distribution",
      hint: "Current status of the period's work items",
      isEmpty: !statusTotal,
      emptyText: "No work items for these filters.",
      slices: statuses,
      format: "count",
      centerText: `${statusTotal}`,
    },
    {
      key: "completion",
      kind: "bar",
      title: "Daily task completion",
      hint: "Work items completed and created each day",
      isEmpty: !sum(rows, "completed") && !sum(rows, "created"),
      emptyText: "No work items completed or created in this period.",
      rows,
      series: TASK_SERIES,
      format: "count",
      xAxisLabel: "Days",
      grouped: true,
    },
    {
      key: "tickets",
      kind: "bar",
      title: "Daily ticket activity",
      hint: "Tickets raised and resolved each day",
      isEmpty: !analytics.tickets || (!sum(rows, "raised") && !sum(rows, "resolved")),
      emptyText: analytics.tickets ? "No tickets raised or resolved in this period." : NO_TICKETS_FOR_PROJECTS,
      rows,
      series: TICKET_SERIES,
      format: "count",
      xAxisLabel: "Days",
      grouped: true,
    },
    {
      key: "people",
      kind: "bar",
      wide: true,
      title: "Employee working hours",
      hint: "Time each person logged in the period",
      isEmpty: !people.length,
      emptyText: "No time logged in this period.",
      rows: people,
      series: [{ key: "worked", label: "Hours" }],
      format: "hours",
      xAxisLabel: "Employees",
    },
  ];
};

/** The weekly report's charts. */
export const weeklyCharts = (analytics: TWorklogAnalytics): TReportChart[] => {
  const rows = periodRows(analytics, "week");
  const weekdays = analytics.weekdays.map<TChartRow>((day) => ({
    key: `${day.weekday}`,
    name: WEEKDAY_LABELS[day.weekday - 1],
    worked: toHours(day.worked_duration),
  }));
  const productivity = buildProductivityRows(analytics.employees);
  const projects = projectHourRows(analytics);
  const { tasks_completed: completed, tasks_pending: pending } = analytics.summary;
  return [
    {
      key: "weekdays",
      kind: "bar",
      title: "Hours by day of the week",
      hint: "Time logged on each weekday, Monday to Sunday",
      isEmpty: !sum(weekdays, "worked"),
      emptyText: "No time logged in this period.",
      rows: weekdays,
      series: [{ key: "worked", label: "Hours" }],
      format: "hours",
      xAxisLabel: "Days",
    },
    {
      key: "completed-pending",
      kind: "donut",
      title: "Completed vs pending tasks",
      hint: "All work items in the period",
      isEmpty: !completed && !pending,
      emptyText: "No work items for these filters.",
      slices: completionSlices(completed, pending),
      format: "count",
      centerText: `${completed + pending}`,
    },
    {
      key: "trend",
      kind: "line",
      wide: true,
      title: "Weekly task completion trend",
      hint: "Work items completed and created each week",
      isEmpty: !sum(rows, "completed") && !sum(rows, "created"),
      emptyText: "No work items completed or created in this period.",
      rows,
      series: TASK_SERIES,
      format: "count",
      xAxisLabel: "Weeks",
    },
    {
      key: "productivity",
      kind: "bar",
      wide: true,
      title: "Productivity by employee",
      hint: PRODUCTIVITY_HINT,
      isEmpty: !hasProductivity(productivity),
      emptyText: PRODUCTIVITY_EMPTY,
      rows: productivity,
      series: [{ key: "productivity", label: "Productivity" }],
      format: "percent",
      xAxisLabel: "Employees",
    },
    {
      key: "projects",
      kind: "bar",
      wide: true,
      title: "Hours by project",
      hint: "Time logged on each project in the period",
      isEmpty: !projects.length,
      emptyText: "No time logged in this period.",
      rows: projects,
      series: [{ key: "worked", label: "Hours" }],
      format: "hours",
      xAxisLabel: "Projects",
    },
  ];
};

type Props = { workspaceSlug: string; period: TPeriod };

/** The daily and weekly reports: period charts, cards and every worklog behind them. */
export const PeriodWorklogReport = observer(function PeriodWorklogReport({ workspaceSlug, period }: Props) {
  const [filters, setFilters] = useState<TWorklogReportFilters>(() => getDefaultPeriodFilters(period));
  const { analytics, isLoading } = useWorklogAnalytics(workspaceSlug, filters, period);
  const charts = useMemo(
    () => (analytics ? (period === "day" ? dailyCharts(analytics) : weeklyCharts(analytics)) : []),
    [analytics, period]
  );

  // clearing both dates goes back to the default range, so the charts and the records cover the same days
  const changeFilters = (next: TWorklogReportFilters) => {
    if (next.from_date || next.to_date) return setFilters(next);
    const { from_date, to_date } = getDefaultPeriodFilters(period);
    setFilters({ ...next, from_date, to_date });
  };

  const summary = analytics?.summary;
  const cards = summary
    ? [
        { label: "Total working hours", value: formatWorklogDuration(summary.worked_duration) },
        ...(period === "day"
          ? [
              { label: "Tasks completed", value: summary.tasks_completed },
              { label: "Tasks pending", value: summary.tasks_pending },
              { label: "Total employees", value: summary.employees },
              { label: "Worklog entries", value: summary.worklog_count },
            ]
          : [
              { label: "Tasks completed", value: summary.tasks_completed },
              { label: "Tasks assigned", value: summary.tasks_total },
              { label: "Active employees", value: summary.active_employees },
              { label: "Projects", value: summary.projects },
            ]),
      ]
    : [];

  const exportPdf = useReportPdfExport(workspaceSlug, filters);
  const download = (format: TReportExportFormat) => {
    if (format === "pdf") {
      void exportPdf({ title: period === "day" ? "Daily report" : "Weekly report", cards, charts });
      return;
    }
    window.open(
      worklogReportService.downloadUrl(workspaceSlug, filters, format, "analytics", undefined, period),
      "_self"
    );
  };

  return (
    <div className="flex w-full flex-col gap-5 px-page-x py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WorklogReportFilters
          filters={filters}
          onChange={changeFilters}
          projectMode="multiple"
          scope={analytics?.scope}
        />
        <ReportExportMenu
          disabled={!summary?.worklog_count && !summary?.tasks_total}
          formats={["csv", "xlsx", "pdf"]}
          onExport={download}
        />
      </div>
      {analytics && !analytics.scope.can_view_others && <OwnTimeNotice />}

      {!analytics && isLoading ? (
        <Loader className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Loader.Item height="72px" width="100%" />
            <Loader.Item height="72px" width="100%" />
            <Loader.Item height="72px" width="100%" />
          </div>
          <Loader.Item height="320px" width="100%" />
        </Loader>
      ) : (
        analytics &&
        summary && (
          <div className={cn("flex flex-col gap-6 transition-opacity", isLoading && "opacity-60")}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {cards.map((card) => (
                <Stat key={card.label} label={card.label} value={card.value} />
              ))}
            </div>
            <ReportChartGrid charts={charts} />
            {summary.worklog_count > 0 && <WorklogReportRecords workspaceSlug={workspaceSlug} filters={filters} />}
          </div>
        )
      )}
    </div>
  );
});
