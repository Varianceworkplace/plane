/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { ChevronDownOutline, ChevronRightOutline } from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { Loader } from "@plane/blocks/skeleton";
import { cn } from "@plane/utils";
// components
import { formatWorklogDuration, getWorklogUserName } from "@/components/worklogs/helpers";
// local imports
import {
  formatReportMonth,
  getDefaultMonthlyFilters,
  getMonthRange,
  hasWorklogReportFilters,
  minutesToHours,
  useWorklogAnalytics,
  useWorklogMonthlyReport,
  worklogReportService,
} from "./helpers";
import { ReportChartGrid } from "./analytics-charts";
import { monthlyCharts } from "./long-period-report";
import { useReportPdfExport } from "./report-pdf-export";
import { WorklogReportRecords } from "./report-records";
import { WorklogReportChart } from "./report-chart";
import { WorklogReportFilters } from "./report-filters";
import type { TReportExportFormat } from "./report-parts";
import { HEAD_CELL, OwnTimeNotice, ReportExportMenu, Section, Stat, TABLE_CLASSNAME, UserCell } from "./report-parts";
import type {
  TWorklogMonthMinutes,
  TWorklogMonthlyProject,
  TWorklogMonthlyUser,
  TWorklogReportFilters,
  TWorklogReportSelection,
} from "./types";
import { WorklogReportDetailModal } from "./worklog-detail-modal";

type Props = { workspaceSlug: string };

const CELL = "px-3 py-2 text-right whitespace-nowrap";

/** Copy of `set` with `key` added or removed. */
const toggle = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

const projectKey = (user: TWorklogMonthlyUser, project: TWorklogMonthlyProject) => `${user.id}:${project.id}`;

type MonthCellsProps = {
  months: string[];
  minutes: TWorklogMonthMinutes;
  total: number;
  /** opens the worklogs behind a month; omitted for the totals row */
  onOpen?: (month: string | null) => void;
};

/** One row's month columns plus its total; non-empty cells open the worklogs behind them. */
function MonthCells({ months, minutes, total, onOpen }: MonthCellsProps) {
  return (
    <>
      {months.map((month) => {
        const value = minutes[month];
        return (
          <td key={month} className={CELL}>
            {!value ? (
              <span className="text-placeholder">—</span>
            ) : onOpen ? (
              <button type="button" className="hover:underline" onClick={() => onOpen(month)}>
                {formatWorklogDuration(value)}
              </button>
            ) : (
              formatWorklogDuration(value)
            )}
          </td>
        );
      })}
      <td className={cn(CELL, "font-medium")}>
        {onOpen ? (
          <button type="button" className="hover:underline" onClick={() => onOpen(null)}>
            {formatWorklogDuration(total)}
          </button>
        ) : (
          formatWorklogDuration(total)
        )}
      </td>
    </>
  );
}

function Toggle({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  const Chevron = open ? ChevronDownOutline : ChevronRightOutline;
  return (
    <button
      type="button"
      className="grid size-5 shrink-0 place-items-center rounded-sm text-tertiary hover:bg-layer-transparent-hover"
      aria-expanded={open}
      aria-label={label}
      onClick={onClick}
    >
      <Chevron className="size-3.5" />
    </button>
  );
}

export const MonthlyWorklogReport = observer(function MonthlyWorklogReport({ workspaceSlug }: Props) {
  const [filters, setFilters] = useState<TWorklogReportFilters>(() => getDefaultMonthlyFilters());
  const [selection, setSelection] = useState<TWorklogReportSelection | null>(null);
  // users start expanded down to their projects; work items open per project
  const [collapsedUsers, setCollapsedUsers] = useState<Set<string>>(new Set());
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const { monthly, isLoading } = useWorklogMonthlyReport(workspaceSlug, filters);
  // trends and performance over the same months
  const { analytics } = useWorklogAnalytics(workspaceSlug, filters, "month");
  const insightCharts = useMemo(() => (analytics ? monthlyCharts(analytics) : []), [analytics]);

  const months = useMemo(() => monthly?.months ?? [], [monthly]);
  const series = useMemo(
    () => (monthly?.users ?? []).map((user) => ({ key: user.id, label: getWorklogUserName(user) })),
    [monthly]
  );
  const chartData = useMemo(
    () =>
      months.map((month) => ({
        key: month,
        name: formatReportMonth(month),
        ...Object.fromEntries((monthly?.users ?? []).map((user) => [user.id, minutesToHours(user.months[month] ?? 0)])),
      })),
    [months, monthly]
  );

  const allProjectKeys = (monthly?.users ?? []).flatMap((user) => user.projects.map((p) => projectKey(user, p)));
  const fullyExpanded =
    !collapsedUsers.size && allProjectKeys.length > 0 && openProjects.size === allProjectKeys.length;

  /** `month` null opens the whole range */
  const open = (
    user: TWorklogMonthlyUser,
    month: string | null,
    project?: TWorklogMonthlyProject,
    issue?: { id: string; name: string }
  ) =>
    setSelection({
      user: { id: user.id, name: getWorklogUserName(user) },
      project: project ? { id: project.id, name: project.name } : undefined,
      issue,
      range: month ? getMonthRange(month, filters) : undefined,
    });

  const exportPdf = useReportPdfExport(workspaceSlug, filters);
  const download = (format: TReportExportFormat) => {
    if (format !== "pdf") {
      window.open(worklogReportService.downloadUrl(workspaceSlug, filters, format, "monthly"), "_self");
      return;
    }
    if (!monthly) return;
    void exportPdf({
      title: "Monthly report",
      cards: [
        { label: "Total time", value: formatWorklogDuration(monthly.total_duration) },
        { label: "Total hours", value: minutesToHours(monthly.total_duration) },
        {
          label: "Average per month",
          value: formatWorklogDuration(months.length ? monthly.total_duration / months.length : 0),
        },
        { label: "Entries", value: monthly.total_count },
        { label: "Users", value: monthly.users.length },
      ],
      charts: [
        {
          key: "hours-by-month",
          kind: "bar",
          title: "Hours by month",
          isEmpty: !monthly.total_count,
          emptyText: "No time logged in these months.",
          rows: chartData,
          series,
          format: "hours",
          xAxisLabel: "Months",
        },
        ...insightCharts,
      ],
      tables: [
        {
          title: "Month-wise breakdown",
          columns: [
            { label: "User", flex: 2 },
            ...months.map((month) => ({ label: formatReportMonth(month), align: "right" as const })),
            { label: "Total", align: "right" },
          ],
          rows: [
            ...monthly.users.map((user) => [
              getWorklogUserName(user),
              ...months.map((month) => formatWorklogDuration(user.months[month] ?? 0)),
              formatWorklogDuration(user.total_duration),
            ]),
            [
              "Total",
              ...months.map((month) => formatWorklogDuration(monthly.month_totals[month] ?? 0)),
              formatWorklogDuration(monthly.total_duration),
            ],
          ],
        },
      ],
    });
  };

  return (
    <div className="flex w-full flex-col gap-5 px-page-x py-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WorklogReportFilters filters={filters} onChange={setFilters} projectMode="multiple" scope={monthly?.scope} />
        <ReportExportMenu disabled={!monthly?.total_count} formats={["csv", "xlsx", "pdf"]} onExport={download} />
      </div>
      {monthly && !monthly.scope.can_view_others && <OwnTimeNotice />}

      {!monthly && isLoading ? (
        <Loader className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Loader.Item height="72px" width="100%" />
            <Loader.Item height="72px" width="100%" />
            <Loader.Item height="72px" width="100%" />
          </div>
          <Loader.Item height="320px" width="100%" />
        </Loader>
      ) : !monthly?.total_count ? (
        <div className="flex flex-col items-center rounded-lg border-[0.5px] border-subtle py-12">
          <EmptyStateCompact
            title={hasWorklogReportFilters(filters) ? "No time logged in these months" : "No time logged yet"}
            description={
              hasWorklogReportFilters(filters)
                ? "Try a wider date range or different projects, users or statuses."
                : "Hours appear here once members log work on project tasks."
            }
            assetKey="worklog"
            assetClassName="size-20"
            align="center"
          />
        </div>
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", isLoading && "opacity-60")}>
          <div className="flex flex-wrap gap-3">
            <Stat label="Total time" value={formatWorklogDuration(monthly.total_duration)} />
            <Stat label="Total hours" value={minutesToHours(monthly.total_duration)} />
            <Stat
              label="Average per month"
              value={formatWorklogDuration(months.length ? monthly.total_duration / months.length : 0)}
            />
            <Stat label="Entries" value={monthly.total_count} />
            <Stat label="Users" value={monthly.users.length} />
          </div>

          <Section title="Hours by month" hint="Click a month to look at it on its own">
            <div className={cn(TABLE_CLASSNAME, "px-2 pt-4")}>
              <WorklogReportChart
                data={chartData}
                series={series}
                xAxisLabel="Months"
                onSelect={(month) => setFilters({ ...filters, ...getMonthRange(month, filters) })}
              />
            </div>
          </Section>

          <ReportChartGrid charts={insightCharts} />

          <Section
            title="Month-wise breakdown"
            hint="Click a time to see its worklogs"
            action={
              <Button
                stretch="auto"
                variant="ghost"
                size="sm"
                label={fullyExpanded ? "Collapse all" : "Expand all"}
                onClick={() => {
                  if (fullyExpanded) {
                    setCollapsedUsers(new Set(monthly.users.map((user) => user.id)));
                    setOpenProjects(new Set());
                  } else {
                    setCollapsedUsers(new Set());
                    setOpenProjects(new Set(allProjectKeys));
                  }
                }}
              />
            }
          >
            <div className={TABLE_CLASSNAME}>
              <div className="overflow-x-auto">
                <table className="w-full text-left" style={{ minWidth: 380 + months.length * 96 }}>
                  <thead className="bg-layer-1">
                    <tr className="text-body-xs-medium text-secondary">
                      <th className={cn(HEAD_CELL, "sticky left-0 z-[1] w-[320px] min-w-[260px] bg-layer-1")}>
                        User / Project / Project task
                      </th>
                      {months.map((month) => (
                        <th key={month} className={cn(HEAD_CELL, "text-right whitespace-nowrap")}>
                          {formatReportMonth(month)}
                        </th>
                      ))}
                      <th className={cn(HEAD_CELL, "text-right")}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.users.map((user) => {
                      const userOpen = !collapsedUsers.has(user.id);
                      return (
                        <Fragment key={user.id}>
                          <tr className="border-t-[0.5px] border-subtle bg-layer-1/40 text-body-xs-medium text-primary">
                            <td className="sticky left-0 z-[1] bg-surface-1 px-3 py-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <Toggle
                                  open={userOpen}
                                  label={`${userOpen ? "Hide" : "Show"} ${getWorklogUserName(user)}'s projects`}
                                  onClick={() => setCollapsedUsers((set) => toggle(set, user.id))}
                                />
                                <UserCell user={user} />
                              </span>
                            </td>
                            <MonthCells
                              months={months}
                              minutes={user.months}
                              total={user.total_duration}
                              onOpen={(month) => open(user, month)}
                            />
                          </tr>
                          {userOpen &&
                            user.projects.map((project) => {
                              const key = projectKey(user, project);
                              const projectOpen = openProjects.has(key);
                              return (
                                <Fragment key={key}>
                                  <tr className="border-t-[0.5px] border-subtle text-body-xs-regular text-primary hover:bg-layer-transparent-hover">
                                    <td className="sticky left-0 z-[1] bg-surface-1 py-2 pr-3 pl-9">
                                      <span className="flex min-w-0 items-center gap-1.5">
                                        <Toggle
                                          open={projectOpen}
                                          label={`${projectOpen ? "Hide" : "Show"} project tasks in ${project.name}`}
                                          onClick={() => setOpenProjects((set) => toggle(set, key))}
                                        />
                                        <span className="shrink-0 text-caption-md-regular text-tertiary">
                                          {project.identifier}
                                        </span>
                                        <span className="truncate font-medium" title={project.name}>
                                          {project.name}
                                        </span>
                                      </span>
                                    </td>
                                    <MonthCells
                                      months={months}
                                      minutes={project.months}
                                      total={project.total_duration}
                                      onOpen={(month) => open(user, month, project)}
                                    />
                                  </tr>
                                  {projectOpen &&
                                    project.issues.map((issue) => (
                                      <tr
                                        key={issue.id}
                                        className="border-t-[0.5px] border-subtle text-body-xs-regular text-secondary hover:bg-layer-transparent-hover"
                                      >
                                        <td className="sticky left-0 z-[1] bg-surface-1 py-2 pr-3 pl-[4.25rem]">
                                          <Link
                                            href={`/${workspaceSlug}/browse/${project.identifier}-${issue.sequence_id}/`}
                                            className="flex min-w-0 items-center gap-2 hover:underline"
                                            title={issue.name}
                                          >
                                            <span className="shrink-0 text-caption-md-regular text-tertiary">
                                              {project.identifier}-{issue.sequence_id}
                                            </span>
                                            <span className="truncate">{issue.name}</span>
                                          </Link>
                                        </td>
                                        <MonthCells
                                          months={months}
                                          minutes={issue.months}
                                          total={issue.total_duration}
                                          onOpen={(month) =>
                                            open(user, month, project, { id: issue.id, name: issue.name })
                                          }
                                        />
                                      </tr>
                                    ))}
                                </Fragment>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-layer-1">
                    <tr className="border-t-[0.5px] border-subtle text-body-xs-medium text-primary">
                      <td className="sticky left-0 z-[1] bg-layer-1 px-3 py-2.5">Total</td>
                      <MonthCells months={months} minutes={monthly.month_totals} total={monthly.total_duration} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </Section>

          <WorklogReportRecords workspaceSlug={workspaceSlug} filters={filters} />
        </div>
      )}

      <WorklogReportDetailModal
        workspaceSlug={workspaceSlug}
        filters={filters}
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  );
});
