/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Tab, Tabs, TabsList } from "@makeplane/propel/components/tabs";
import { ChevronLeftOutline, ChevronRightOutline } from "@makeplane/propel/icons";
import { STATE_GROUPS } from "@plane/constants";
import { Loader } from "@plane/blocks/skeleton";
import { cn } from "@plane/utils";
// components
import { formatWorklogDuration, getWorklogUserName, pad } from "@/components/worklogs/helpers";
// local imports
import type { TChartRow, TReportChart } from "./analytics-charts";
import { ReportChartGrid, shortLabel } from "./analytics-charts";
import {
  PRODUCTIVITY_EMPTY,
  PRODUCTIVITY_HINT,
  buildProductivityRows,
  hasProductivity,
  milestoneItems,
} from "./analytics-insights";
import { EMPTY_WORKLOG_REPORT_FILTERS, fromReportDate, useWorklogAnalytics, worklogReportService } from "./helpers";
import { WorklogReportFilters } from "./report-filters";
import { useReportPdfExport } from "./report-pdf-export";
import type { TReportExportFormat } from "./report-parts";
import { OwnTimeNotice, ReportExportMenu, Stat } from "./report-parts";
import { WorklogReportRecords } from "./report-records";
import type { TWorklogAnalytics, TWorklogReportFilters } from "./types";

// most rows a bar chart shows; the records table lists everything
const MAX_ROWS = 15;

const toHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

const QUARTERS = [
  { value: 1, label: "Q1", months: "Jan – Mar" },
  { value: 2, label: "Q2", months: "Apr – Jun" },
  { value: 3, label: "Q3", months: "Jul – Sep" },
  { value: 4, label: "Q4", months: "Oct – Dec" },
];

const TASK_SERIES = [
  { key: "completed", label: "Completed", color: STATE_GROUPS.completed.color },
  { key: "created", label: "Created", color: STATE_GROUPS.unstarted.color },
];
const TICKET_SERIES = [
  { key: "raised", label: "Raised", color: STATE_GROUPS.started.color },
  { key: "resolved", label: "Resolved", color: STATE_GROUPS.completed.color },
];
const HOURS_SERIES = [{ key: "worked", label: "Hours" }];
const EXPECTED_SERIES = [
  { key: "expected", label: "Expected" },
  { key: "worked", label: "Worked" },
];
const NO_TICKETS_FOR_PROJECTS = "Tickets aren't part of projects. Clear the project filter to see them.";

/** "2026-10-01": month buckets read "Oct" on the axis ("Oct 2026" across years) and "October 2026" on hover. */
const monthLabels = (key: string, withYear: boolean) => {
  const date = fromReportDate(key);
  if (!date) return { name: key, title: key };
  return {
    name: withYear ? `${MONTH.format(date)} ${date.getFullYear()}` : MONTH.format(date),
    title: MONTH_YEAR.format(date),
  };
};

const quarterLabels = (key: string) => {
  const date = fromReportDate(key);
  if (!date) return { name: key, title: key };
  const quarter = QUARTERS[Math.floor(date.getMonth() / 3)];
  return { name: quarter.label, title: `${quarter.label} ${date.getFullYear()} (${quarter.months})` };
};

/** One row per bucket with every series the trend charts draw. */
const bucketRows = (analytics: TWorklogAnalytics, label: (key: string) => { name: string; title: string }) =>
  analytics.series.map<TChartRow>((bucket) => ({
    key: bucket.key,
    ...label(bucket.key),
    worked: toHours(bucket.worked_duration),
    completed: bucket.tasks_completed,
    created: bucket.tasks_created,
    raised: bucket.tickets_created,
    resolved: bucket.tickets_resolved,
    projects: bucket.projects_completed,
  }));

const sum = (rows: TChartRow[], key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

const expectedRows = (people: { id: string; name: string; expected: number; worked: number }[]): TChartRow[] =>
  people
    .filter((person) => person.expected > 0 || person.worked > 0)
    .slice(0, MAX_ROWS)
    .map((person) => ({
      key: person.id,
      name: shortLabel(person.name),
      title: person.name,
      expected: toHours(person.expected),
      worked: toHours(person.worked),
    }));

const milestoneHint = (analytics: TWorklogAnalytics) =>
  analytics.summary.milestones
    ? `${analytics.summary.milestones_completed} of ${analytics.summary.milestones} completed`
    : "Milestones in the period";

function ReportLoader() {
  return (
    <Loader className="flex flex-col gap-4">
      <div className="flex gap-3">
        <Loader.Item height="72px" width="100%" />
        <Loader.Item height="72px" width="100%" />
        <Loader.Item height="72px" width="100%" />
      </div>
      <Loader.Item height="320px" width="100%" />
    </Loader>
  );
}

// ------------------------------------------------------------ monthly report: trends and performance

/** The monthly report's extra charts: trends and performance over its months. */
export const monthlyCharts = (analytics: TWorklogAnalytics): TReportChart[] => {
  const years = new Set(analytics.series.map((bucket) => bucket.key.slice(0, 4)));
  const rows = bucketRows(analytics, (key) => monthLabels(key, years.size > 1));
  const people = expectedRows(
    analytics.employees.map((person) => ({
      id: person.id,
      name: getWorklogUserName(person),
      expected: person.expected_duration,
      worked: person.worked_duration,
    }))
  );
  const progress = analytics.projects
    .filter((project) => project.tasks_total > 0)
    .slice(0, MAX_ROWS)
    .map<TChartRow>((project) => ({
      key: project.id,
      name: project.identifier || project.name,
      title: project.name,
      progress: Math.round((project.tasks_completed * 100) / project.tasks_total),
    }));
  return [
    {
      key: "hours",
      kind: "line",
      wide: true,
      title: "Monthly working hours trend",
      hint: "Time logged each month",
      isEmpty: !sum(rows, "worked"),
      emptyText: "No time logged in these months.",
      rows,
      series: HOURS_SERIES,
      format: "hours",
      xAxisLabel: "Months",
    },
    {
      key: "completion",
      kind: "bar",
      title: "Monthly task completion",
      hint: "Work items completed and created each month",
      isEmpty: !sum(rows, "completed") && !sum(rows, "created"),
      emptyText: "No work items completed or created in these months.",
      rows,
      series: TASK_SERIES,
      format: "count",
      xAxisLabel: "Months",
      grouped: true,
    },
    {
      key: "tickets",
      kind: "line",
      title: "Ticket resolution trend",
      hint: "Tickets raised and resolved each month",
      isEmpty: !analytics.tickets || (!sum(rows, "raised") && !sum(rows, "resolved")),
      emptyText: analytics.tickets ? "No tickets raised or resolved in these months." : NO_TICKETS_FOR_PROJECTS,
      rows,
      series: TICKET_SERIES,
      format: "count",
      xAxisLabel: "Months",
    },
    {
      key: "people",
      kind: "bar",
      wide: true,
      title: "Employee performance comparison",
      hint: "Expected time of assigned work items against time logged",
      isEmpty: !people.length,
      emptyText: "No expected or logged time in these months.",
      rows: people,
      series: EXPECTED_SERIES,
      format: "hours",
      xAxisLabel: "Employees",
      grouped: true,
    },
    {
      key: "progress",
      kind: "bar",
      title: "Project-wise progress",
      hint: "Share of each project's work items completed in these months",
      isEmpty: !progress.some((row) => Number(row.progress) > 0),
      emptyText: "No work items completed in these months.",
      rows: progress,
      series: [{ key: "progress", label: "Completed", color: STATE_GROUPS.completed.color }],
      format: "percent",
      xAxisLabel: "Projects",
    },
    {
      key: "milestones",
      kind: "progress",
      title: "Milestone completion",
      hint: milestoneHint(analytics),
      isEmpty: !analytics.milestones.length,
      emptyText: "No milestones in these months.",
      items: milestoneItems(analytics.milestones),
    },
  ];
};

/** The quarterly report's charts: the quarter month by month, and its year quarter by quarter. */
export const quarterlyCharts = (
  analytics: TWorklogAnalytics,
  yearly: TWorklogAnalytics | undefined,
  year: number
): TReportChart[] => {
  const months = bucketRows(analytics, (key) => monthLabels(key, false));
  const quarters = yearly ? bucketRows(yearly, quarterLabels) : [];
  const productivity = buildProductivityRows(analytics.employees);
  const projectQuarters = (yearly?.projects ?? [])
    .filter((project) => project.worked_duration > 0)
    .slice(0, MAX_ROWS)
    .map((project) => {
      const row: TChartRow = { key: project.id, name: project.identifier || project.name, title: project.name };
      project.series.forEach((bucket, index) => {
        row[`q${index + 1}`] = toHours(bucket.worked_duration);
      });
      return row;
    });
  return [
    {
      key: "quarters",
      kind: "bar",
      title: "Quarterly working hours",
      hint: `Time logged in each quarter of ${year}`,
      isEmpty: !sum(quarters, "worked"),
      emptyText: `No time logged in ${year}.`,
      rows: quarters,
      series: HOURS_SERIES,
      format: "hours",
      xAxisLabel: "Quarters",
    },
    {
      key: "months",
      kind: "bar",
      title: "Monthly task completion within the quarter",
      hint: "Work items completed and created each month",
      isEmpty: !sum(months, "completed") && !sum(months, "created"),
      emptyText: "No work items completed or created in this quarter.",
      rows: months,
      series: TASK_SERIES,
      format: "count",
      xAxisLabel: "Months",
      grouped: true,
    },
    {
      key: "projects",
      kind: "bar",
      wide: true,
      title: "Quarter-wise project performance",
      hint: `Hours logged on each project, quarter by quarter, in ${year}`,
      isEmpty: !projectQuarters.length,
      emptyText: `No time logged on projects in ${year}.`,
      rows: projectQuarters,
      series: QUARTERS.map((item) => ({ key: `q${item.value}`, label: item.label })),
      format: "hours",
      xAxisLabel: "Projects",
    },
    {
      key: "productivity",
      kind: "bar",
      wide: true,
      title: "Quarterly employee productivity",
      hint: PRODUCTIVITY_HINT,
      isEmpty: !hasProductivity(productivity),
      emptyText: PRODUCTIVITY_EMPTY,
      rows: productivity,
      series: [{ key: "productivity", label: "Productivity" }],
      format: "percent",
      xAxisLabel: "Employees",
    },
    {
      key: "milestones",
      kind: "progress",
      title: "Milestone achievement",
      hint: milestoneHint(analytics),
      isEmpty: !analytics.milestones.length,
      emptyText: "No milestones in this quarter.",
      items: milestoneItems(analytics.milestones),
    },
    {
      key: "tickets",
      kind: "line",
      title: "Ticket resolution trend",
      hint: `Tickets raised and resolved in each quarter of ${year}`,
      isEmpty: !yearly?.tickets || (!sum(quarters, "raised") && !sum(quarters, "resolved")),
      emptyText: yearly && !yearly.tickets ? NO_TICKETS_FOR_PROJECTS : `No tickets raised or resolved in ${year}.`,
      rows: quarters,
      series: TICKET_SERIES,
      format: "count",
      xAxisLabel: "Quarters",
    },
  ];
};

/** The yearly report's charts, January to December. */
export const yearlyCharts = (analytics: TWorklogAnalytics, year: number): TReportChart[] => {
  const months = bucketRows(analytics, (key) => monthLabels(key, false));
  const productivity = buildProductivityRows(analytics.employees);
  const departments = expectedRows(
    analytics.departments.map((team) => ({
      id: team.id,
      name: team.name,
      expected: team.expected_duration,
      worked: team.worked_duration,
    }))
  );
  return [
    {
      key: "completion",
      kind: "line",
      wide: true,
      title: "Task completion, January to December",
      hint: `Work items completed and created each month of ${year}`,
      isEmpty: !sum(months, "completed") && !sum(months, "created"),
      emptyText: `No work items completed or created in ${year}.`,
      rows: months,
      series: TASK_SERIES,
      format: "count",
      xAxisLabel: "Months",
    },
    {
      key: "hours",
      kind: "line",
      title: "Monthly working hours trend",
      hint: "Time logged each month",
      isEmpty: !sum(months, "worked"),
      emptyText: `No time logged in ${year}.`,
      rows: months,
      series: HOURS_SERIES,
      format: "hours",
      xAxisLabel: "Months",
    },
    {
      key: "projects",
      kind: "bar",
      title: "Project completion growth",
      hint: "Projects finished each month (their actual end date)",
      isEmpty: !sum(months, "projects"),
      emptyText: `No projects completed in ${year}.`,
      rows: months,
      series: [{ key: "projects", label: "Projects completed", color: STATE_GROUPS.completed.color }],
      format: "count",
      xAxisLabel: "Months",
    },
    {
      key: "productivity",
      kind: "bar",
      wide: true,
      title: "Employee-wise annual productivity",
      hint: PRODUCTIVITY_HINT,
      isEmpty: !hasProductivity(productivity),
      emptyText: PRODUCTIVITY_EMPTY,
      rows: productivity,
      series: [{ key: "productivity", label: "Productivity" }],
      format: "percent",
      xAxisLabel: "Employees",
    },
    {
      key: "departments",
      kind: "bar",
      wide: true,
      title: "Department-wise performance",
      hint: "Expected time of each department's work items against time logged",
      isEmpty: !departments.length,
      emptyText: "No departments (teams) with work in this year.",
      rows: departments,
      series: EXPECTED_SERIES,
      format: "hours",
      xAxisLabel: "Departments",
      grouped: true,
    },
    {
      key: "tickets",
      kind: "line",
      title: "Annual ticket resolution",
      hint: "Tickets raised and resolved each month",
      isEmpty: !analytics.tickets || (!sum(months, "raised") && !sum(months, "resolved")),
      emptyText: analytics.tickets ? `No tickets raised or resolved in ${year}.` : NO_TICKETS_FOR_PROJECTS,
      rows: months,
      series: TICKET_SERIES,
      format: "count",
      xAxisLabel: "Months",
    },
    {
      key: "milestones",
      kind: "progress",
      title: "Milestone achievement",
      hint: milestoneHint(analytics),
      isEmpty: !analytics.milestones.length,
      emptyText: `No milestones in ${year}.`,
      items: milestoneItems(analytics.milestones),
    },
  ];
};

// ------------------------------------------------------------ quarterly and yearly reports

const yearRange = (year: number) => ({ from_date: `${year}-01-01`, to_date: `${year}-12-31` });

const quarterRange = (year: number, quarter: number) => {
  const firstMonth = quarter * 3 - 2;
  const lastDay = new Date(year, quarter * 3, 0).getDate();
  return { from_date: `${year}-${pad(firstMonth)}-01`, to_date: `${year}-${pad(quarter * 3)}-${pad(lastDay)}` };
};

function YearPicker(props: { year: number; onChange: (year: number) => void }) {
  const { year, onChange } = props;
  const thisYear = new Date().getFullYear();
  return (
    <div className="flex items-center gap-1 rounded-md border-[0.5px] border-subtle px-1">
      <IconButton
        variant="ghost"
        size="sm"
        icon={<Icon icon={ChevronLeftOutline} />}
        aria-label="Previous year"
        onClick={() => onChange(year - 1)}
      />
      <span className="min-w-12 text-center text-body-sm-medium text-primary tabular-nums">{year}</span>
      <IconButton
        variant="ghost"
        size="sm"
        icon={<Icon icon={ChevronRightOutline} />}
        aria-label="Next year"
        disabled={year >= thisYear}
        onClick={() => onChange(year + 1)}
      />
    </div>
  );
}

/** Filters (without dates), the period picker and export, above a quarterly or yearly report. */
function LongPeriodToolbar(props: {
  filters: TWorklogReportFilters;
  onChange: (filters: TWorklogReportFilters) => void;
  analytics: TWorklogAnalytics | undefined;
  picker: ReactNode;
  onExport: (format: TReportExportFormat) => void;
}) {
  const { filters, onChange, analytics, picker, onExport } = props;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">{picker}</div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WorklogReportFilters
          filters={filters}
          onChange={onChange}
          projectMode="multiple"
          scope={analytics?.scope}
          showDates={false}
        />
        <ReportExportMenu
          disabled={!analytics?.summary.worklog_count && !analytics?.summary.tasks_total}
          formats={["csv", "xlsx", "pdf"]}
          onExport={onExport}
        />
      </div>
      {analytics && !analytics.scope.can_view_others && <OwnTimeNotice />}
    </>
  );
}

/** Report state shared by the quarterly and yearly reports: filters other than dates, and the chosen range. */
const useLongPeriodFilters = (range: { from_date: string; to_date: string }) => {
  const [filters, setFilters] = useState<TWorklogReportFilters>(EMPTY_WORKLOG_REPORT_FILTERS);
  // the period picker owns the dates, so clearing the filters keeps the chosen period
  const ranged = useMemo(() => ({ ...filters, ...range }), [filters, range]);
  const onChange = (next: TWorklogReportFilters) => setFilters({ ...next, from_date: undefined, to_date: undefined });
  return { filters: ranged, onChange };
};

/** A period report's body: its cards, charts and the worklogs behind them. */
function LongPeriodBody(props: {
  workspaceSlug: string;
  filters: TWorklogReportFilters;
  analytics: TWorklogAnalytics;
  isLoading: boolean;
  cards: { label: string; value: string | number }[];
  charts: TReportChart[];
}) {
  const { workspaceSlug, filters, analytics, isLoading, cards, charts } = props;
  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", isLoading && "opacity-60")}>
      <div
        className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", cards.length > 5 ? "xl:grid-cols-6" : "xl:grid-cols-5")}
      >
        {cards.map((card) => (
          <Stat key={card.label} label={card.label} value={card.value} />
        ))}
      </div>
      <ReportChartGrid charts={charts} />
      {analytics.summary.worklog_count > 0 && <WorklogReportRecords workspaceSlug={workspaceSlug} filters={filters} />}
    </div>
  );
}

export const QuarterlyWorklogReport = observer(function QuarterlyWorklogReport(props: { workspaceSlug: string }) {
  const { workspaceSlug } = props;
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(today.getMonth() / 3) + 1);
  const range = useMemo(() => quarterRange(year, quarter), [year, quarter]);
  const { filters, onChange } = useLongPeriodFilters(range);
  const yearFilters = useMemo(() => ({ ...filters, ...yearRange(year) }), [filters, year]);
  // the quarter month by month, and the whole year quarter by quarter
  const { analytics, isLoading } = useWorklogAnalytics(workspaceSlug, filters, "month");
  const { analytics: yearly } = useWorklogAnalytics(workspaceSlug, yearFilters, "quarter");
  const charts = useMemo(() => (analytics ? quarterlyCharts(analytics, yearly, year) : []), [analytics, yearly, year]);
  const summary = analytics?.summary;
  const cards = summary
    ? [
        { label: "Total working hours", value: formatWorklogDuration(summary.worked_duration) },
        { label: "Tasks completed", value: summary.tasks_completed },
        { label: "Tasks pending", value: summary.tasks_pending },
        { label: "Active employees", value: summary.active_employees },
        { label: "Milestones completed", value: `${summary.milestones_completed} / ${summary.milestones}` },
      ]
    : [];

  const exportPdf = useReportPdfExport(workspaceSlug, filters);
  const download = (format: TReportExportFormat) => {
    if (format === "pdf") {
      void exportPdf({ title: `Quarterly report, Q${quarter} ${year}`, cards, charts });
      return;
    }
    window.open(
      worklogReportService.downloadUrl(workspaceSlug, filters, format, "analytics", undefined, "month"),
      "_self"
    );
  };

  return (
    <div className="flex w-full flex-col gap-5 px-page-x py-5">
      <LongPeriodToolbar
        filters={filters}
        onChange={onChange}
        analytics={analytics}
        onExport={download}
        picker={
          <>
            <YearPicker year={year} onChange={setYear} />
            <Tabs variant="contained" value={`${quarter}`} onValueChange={(value) => setQuarter(Number(value))}>
              <TabsList>
                {QUARTERS.map((item) => (
                  <Tab key={item.value} value={`${item.value}`} label={`${item.label} · ${item.months}`} />
                ))}
              </TabsList>
            </Tabs>
          </>
        }
      />
      {!analytics && isLoading ? (
        <ReportLoader />
      ) : (
        analytics && (
          <LongPeriodBody
            workspaceSlug={workspaceSlug}
            filters={filters}
            analytics={analytics}
            isLoading={isLoading}
            cards={cards}
            charts={charts}
          />
        )
      )}
    </div>
  );
});

export const YearlyWorklogReport = observer(function YearlyWorklogReport(props: { workspaceSlug: string }) {
  const { workspaceSlug } = props;
  const [year, setYear] = useState(new Date().getFullYear());
  const range = useMemo(() => yearRange(year), [year]);
  const { filters, onChange } = useLongPeriodFilters(range);
  const { analytics, isLoading } = useWorklogAnalytics(workspaceSlug, filters, "month");
  const charts = useMemo(() => (analytics ? yearlyCharts(analytics, year) : []), [analytics, year]);
  const summary = analytics?.summary;
  const cards = summary
    ? [
        { label: "Total working hours", value: formatWorklogDuration(summary.worked_duration) },
        { label: "Tasks completed", value: summary.tasks_completed },
        { label: "Tasks created", value: summary.tasks_created },
        { label: "Active employees", value: summary.active_employees },
        { label: "Projects completed", value: summary.projects_completed },
        { label: "Tickets resolved", value: analytics?.tickets?.resolved ?? "–" },
      ]
    : [];

  const exportPdf = useReportPdfExport(workspaceSlug, filters);
  const download = (format: TReportExportFormat) => {
    if (format === "pdf") {
      void exportPdf({ title: `Yearly report, ${year}`, cards, charts });
      return;
    }
    window.open(
      worklogReportService.downloadUrl(workspaceSlug, filters, format, "analytics", undefined, "month"),
      "_self"
    );
  };

  return (
    <div className="flex w-full flex-col gap-5 px-page-x py-5">
      <LongPeriodToolbar
        filters={filters}
        onChange={onChange}
        analytics={analytics}
        onExport={download}
        picker={<YearPicker year={year} onChange={setYear} />}
      />
      {!analytics && isLoading ? (
        <ReportLoader />
      ) : (
        analytics && (
          <LongPeriodBody
            workspaceSlug={workspaceSlug}
            filters={filters}
            analytics={analytics}
            isLoading={isLoading}
            cards={cards}
            charts={charts}
          />
        )
      )}
    </div>
  );
});
