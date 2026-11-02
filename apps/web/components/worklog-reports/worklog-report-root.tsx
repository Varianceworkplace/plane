/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { Loader } from "@plane/blocks/skeleton";
import { cn } from "@plane/utils";
// components
import { formatWorklogDuration, getWorklogUserName } from "@/components/worklogs/helpers";
// local imports
import {
  EMPTY_WORKLOG_REPORT_FILTERS,
  buildProjectChartData,
  buildUserChartData,
  formatShare,
  hasWorklogReportFilters,
  minutesToHours,
  useWorklogReport,
  worklogReportService,
} from "./helpers";
import { WorklogReportChart } from "./report-chart";
import { WorklogReportFilters } from "./report-filters";
import {
  HEAD_CELL,
  OwnTimeNotice,
  ROW_CLASSNAME,
  ReportExportMenu,
  Section,
  Stat,
  TABLE_CLASSNAME,
  UserCell,
} from "./report-parts";
import type {
  TWorklogReportFilters,
  TWorklogReportSelection,
  TWorklogReportSummary,
  TWorklogReportType,
} from "./types";
import { WorklogReportDetailModal } from "./worklog-detail-modal";

type Props = { workspaceSlug: string; reportType: Exclude<TWorklogReportType, "monthly"> };

// ------------------------------------------------------------ project-wise

type ReportBodyProps = {
  summary: TWorklogReportSummary;
  filters: TWorklogReportFilters;
  onFiltersChange: (filters: TWorklogReportFilters) => void;
  onSelect: (selection: TWorklogReportSelection) => void;
};

function ProjectWiseReport({ summary, filters, onFiltersChange, onSelect }: ReportBodyProps) {
  const project = filters.project.length === 1 ? summary.projects.find((p) => p.id === filters.project[0]) : undefined;

  const selectUser = useCallback(
    (userId: string) => {
      const user = summary.users.find((u) => u.id === userId);
      if (user)
        onSelect({
          user: { id: user.id, name: getWorklogUserName(user) },
          project: project ? { id: project.id, name: project.name } : undefined,
        });
    },
    [summary.users, project, onSelect]
  );
  const openProject = useCallback(
    (projectId: string) => onFiltersChange({ ...filters, project: [projectId] }),
    [filters, onFiltersChange]
  );

  // One project picked: who spent how long on it
  if (filters.project.length === 1) {
    return (
      <>
        <Section title={`Hours by user${project ? ` in ${project.name}` : ""}`} hint="Click a bar to see the worklogs">
          <div className={cn(TABLE_CLASSNAME, "px-2 pt-4")}>
            <WorklogReportChart
              data={buildUserChartData(summary.users)}
              series={[{ key: "hours", label: "Hours" }]}
              xAxisLabel="Users"
              onSelect={selectUser}
            />
          </div>
        </Section>
        <Section title="Users">
          <div className={TABLE_CLASSNAME}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] table-fixed text-left">
                <thead className="bg-layer-1">
                  <tr className="text-body-xs-medium text-secondary">
                    <th className={cn(HEAD_CELL, "w-[40%]")}>User</th>
                    <th className={cn(HEAD_CELL, "text-right")}>Entries</th>
                    <th className={cn(HEAD_CELL, "text-right")}>Time</th>
                    <th className={cn(HEAD_CELL, "text-right")}>Hours</th>
                    <th className={cn(HEAD_CELL, "text-right")}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.users.map((user) => (
                    <tr key={user.id} className={ROW_CLASSNAME} onClick={() => selectUser(user.id)}>
                      <td className="px-3 py-2.5">
                        <UserCell user={user} />
                      </td>
                      <td className="px-3 py-2.5 text-right">{user.worklog_count}</td>
                      <td className="px-3 py-2.5 text-right font-medium">
                        {formatWorklogDuration(user.total_duration)}
                      </td>
                      <td className="px-3 py-2.5 text-right">{minutesToHours(user.total_duration)}</td>
                      <td className="px-3 py-2.5 text-right text-secondary">
                        {formatShare(user.total_duration, summary.total_duration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-layer-1">
                  <tr className="border-t-[0.5px] border-subtle text-body-xs-medium text-primary">
                    <td className="px-3 py-2.5">Total</td>
                    <td className="px-3 py-2.5 text-right">{summary.total_count}</td>
                    <td className="px-3 py-2.5 text-right">{formatWorklogDuration(summary.total_duration)}</td>
                    <td className="px-3 py-2.5 text-right">{minutesToHours(summary.total_duration)}</td>
                    <td className="px-3 py-2.5 text-right">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </Section>
      </>
    );
  }

  // No project picked: compare projects, then drill into one
  const usersPerProject = new Map<string, number>();
  for (const user of summary.users)
    for (const p of user.projects) usersPerProject.set(p.id, (usersPerProject.get(p.id) ?? 0) + 1);

  return (
    <>
      <Section title="Hours by project" hint="Click a bar to see hours by user">
        <div className={cn(TABLE_CLASSNAME, "px-2 pt-4")}>
          <WorklogReportChart
            data={buildProjectChartData(summary.projects)}
            series={[{ key: "hours", label: "Hours" }]}
            xAxisLabel="Projects"
            onSelect={openProject}
          />
        </div>
      </Section>
      <Section title="Projects">
        <div className={TABLE_CLASSNAME}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed text-left">
              <thead className="bg-layer-1">
                <tr className="text-body-xs-medium text-secondary">
                  <th className={cn(HEAD_CELL, "w-[40%]")}>Project</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Users</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Entries</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Time</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Share</th>
                </tr>
              </thead>
              <tbody>
                {summary.projects.map((p) => (
                  <tr key={p.id} className={ROW_CLASSNAME} onClick={() => openProject(p.id)}>
                    <td className="px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-caption-md-regular text-tertiary">{p.identifier}</span>
                        <span className="truncate font-medium">{p.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{usersPerProject.get(p.id) ?? 0}</td>
                    <td className="px-3 py-2.5 text-right">{p.worklog_count}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{formatWorklogDuration(p.total_duration)}</td>
                    <td className="px-3 py-2.5 text-right text-secondary">
                      {formatShare(p.total_duration, summary.total_duration)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-layer-1">
                <tr className="border-t-[0.5px] border-subtle text-body-xs-medium text-primary">
                  <td className="px-3 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right">{summary.users.length}</td>
                  <td className="px-3 py-2.5 text-right">{summary.total_count}</td>
                  <td className="px-3 py-2.5 text-right">{formatWorklogDuration(summary.total_duration)}</td>
                  <td className="px-3 py-2.5 text-right">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------ user-wise

function UserWiseReport({ summary, onSelect }: ReportBodyProps) {
  const series = useMemo(() => summary.projects.map((p) => ({ key: p.id, label: p.name })), [summary.projects]);
  const select = useCallback(
    (userId: string, projectId?: string) => {
      const user = summary.users.find((u) => u.id === userId);
      const project = projectId ? summary.projects.find((p) => p.id === projectId) : undefined;
      if (user)
        onSelect({
          user: { id: user.id, name: getWorklogUserName(user) },
          project: project ? { id: project.id, name: project.name } : undefined,
        });
    },
    [summary.users, summary.projects, onSelect]
  );

  return (
    <>
      <Section title="Hours by user across projects" hint="Click a bar to see the worklogs">
        <div className={cn(TABLE_CLASSNAME, "px-2 pt-4")}>
          <WorklogReportChart
            data={buildUserChartData(summary.users)}
            series={series}
            xAxisLabel="Users"
            onSelect={(userId) => select(userId)}
          />
        </div>
      </Section>
      <Section title="Breakdown" hint="Click a cell to see that user's worklogs in the project">
        <div className={TABLE_CLASSNAME}>
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: 360 + summary.projects.length * 120 }}>
              <thead className="bg-layer-1">
                <tr className="text-body-xs-medium text-secondary">
                  <th className={cn(HEAD_CELL, "sticky left-0 w-[220px] bg-layer-1")}>User</th>
                  {summary.projects.map((p) => (
                    <th key={p.id} className={cn(HEAD_CELL, "text-right")} title={p.name}>
                      <span className="block truncate">{p.name}</span>
                    </th>
                  ))}
                  <th className={cn(HEAD_CELL, "text-right")}>Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.users.map((user) => {
                  const perProject = new Map(user.projects.map((p) => [p.id, p.total_duration]));
                  return (
                    <tr
                      key={user.id}
                      className="border-t-[0.5px] border-subtle text-body-xs-regular text-primary hover:bg-layer-transparent-hover"
                    >
                      <td className="sticky left-0 bg-surface-1 px-3 py-2.5">
                        <button
                          type="button"
                          className="w-full text-left hover:underline"
                          onClick={() => select(user.id)}
                        >
                          <UserCell user={user} />
                        </button>
                      </td>
                      {summary.projects.map((p) => {
                        const minutes = perProject.get(p.id);
                        return (
                          <td key={p.id} className="px-3 py-2.5 text-right">
                            {minutes ? (
                              <button
                                type="button"
                                className="hover:underline"
                                onClick={() => select(user.id, p.id)}
                                aria-label={`${getWorklogUserName(user)} in ${p.name}`}
                              >
                                {formatWorklogDuration(minutes)}
                              </button>
                            ) : (
                              <span className="text-placeholder">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-right font-medium">
                        {formatWorklogDuration(user.total_duration)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-layer-1">
                <tr className="border-t-[0.5px] border-subtle text-body-xs-medium text-primary">
                  <td className="sticky left-0 bg-layer-1 px-3 py-2.5">Total</td>
                  {summary.projects.map((p) => (
                    <td key={p.id} className="px-3 py-2.5 text-right">
                      {formatWorklogDuration(p.total_duration)}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right">{formatWorklogDuration(summary.total_duration)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------ root

export const WorklogReportRoot = observer(function WorklogReportRoot(props: Props) {
  const { workspaceSlug, reportType } = props;
  const [filters, setFilters] = useState<TWorklogReportFilters>(EMPTY_WORKLOG_REPORT_FILTERS);
  const [selection, setSelection] = useState<TWorklogReportSelection | null>(null);
  const { summary, isLoading } = useWorklogReport(workspaceSlug, filters);

  const download = (format: "csv" | "xlsx") => {
    window.open(worklogReportService.downloadUrl(workspaceSlug, filters, format, "summary"), "_self");
  };

  const ReportBody = reportType === "project-wise" ? ProjectWiseReport : UserWiseReport;

  return (
    <div className="flex w-full flex-col gap-5 px-page-x py-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WorklogReportFilters
          filters={filters}
          onChange={setFilters}
          projectMode={reportType === "project-wise" ? "single" : "multiple"}
          scope={summary?.scope}
        />
        <ReportExportMenu disabled={!summary?.total_count} onExport={download} />
      </div>
      {summary && !summary.scope.can_view_others && <OwnTimeNotice />}

      {!summary && isLoading ? (
        <Loader className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Loader.Item height="72px" width="100%" />
            <Loader.Item height="72px" width="100%" />
            <Loader.Item height="72px" width="100%" />
          </div>
          <Loader.Item height="320px" width="100%" />
        </Loader>
      ) : !summary?.total_count ? (
        <div className="flex flex-col items-center rounded-lg border-[0.5px] border-subtle py-12">
          <EmptyStateCompact
            title={hasWorklogReportFilters(filters) ? "No time logged for these filters" : "No time logged yet"}
            description={
              hasWorklogReportFilters(filters)
                ? "Try different projects, users, statuses or dates."
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
            <Stat label="Total time" value={formatWorklogDuration(summary.total_duration)} />
            <Stat label="Total hours" value={minutesToHours(summary.total_duration)} />
            <Stat label="Entries" value={summary.total_count} />
            <Stat label="Users" value={summary.users.length} />
            <Stat label="Projects" value={summary.projects.length} />
          </div>
          <ReportBody summary={summary} filters={filters} onFiltersChange={setFilters} onSelect={setSelection} />
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
