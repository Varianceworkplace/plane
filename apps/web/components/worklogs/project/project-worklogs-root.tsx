/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Tab, Tabs, TabsList } from "@makeplane/propel/components/tabs";
import { ChevronDownOutline, ChevronLeftOutline, ChevronRightOutline } from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { getFileURL, renderFormattedDate } from "@plane/utils";
// components
import {
  EMPTY_WORKLOG_REPORT_FILTERS,
  hasWorklogReportFilters,
  useWorklogReport,
  useWorklogReportDetail,
  worklogReportService,
} from "@/components/worklog-reports/helpers";
import { WorklogReportFilters } from "@/components/worklog-reports/report-filters";
import { OwnTimeNotice, ReportExportMenu } from "@/components/worklog-reports/report-parts";
import type { TWorklogReportEntry, TWorklogReportFilters } from "@/components/worklog-reports/types";
// local imports
import { formatWorklogDuration, formatWorklogSpan, getWorklogUserName } from "../helpers";

const PAGE_SIZE = 50;

type TView = "work_item" | "all";

type Props = { workspaceSlug: string; projectId: string };

/** Consecutive entries of the same work item (the API sends them work item by work item). */
const groupByWorkItem = (entries: TWorklogReportEntry[]) => {
  const groups: {
    issue: TWorklogReportEntry["issue"];
    project: TWorklogReportEntry["project"];
    entries: TWorklogReportEntry[];
  }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last?.issue.id === entry.issue.id) last.entries.push(entry);
    else groups.push({ issue: entry.issue, project: entry.project, entries: [entry] });
  }
  return groups;
};

function WorkItemLink({
  workspaceSlug,
  entry,
}: {
  workspaceSlug: string;
  entry: Pick<TWorklogReportEntry, "issue" | "project">;
}) {
  return (
    <Link
      href={`/${workspaceSlug}/browse/${entry.project.identifier}-${entry.issue.sequence_id}/`}
      className="flex min-w-0 items-center gap-2 hover:underline"
      title={entry.issue.name}
    >
      <span className="shrink-0 text-caption-md-regular text-tertiary">
        {entry.project.identifier}-{entry.issue.sequence_id}
      </span>
      <span className="truncate">{entry.issue.name}</span>
    </Link>
  );
}

/** The cells every entry row has, whatever the view. */
function EntryCells({ worklog }: { worklog: TWorklogReportEntry }) {
  return (
    <>
      <td className="px-3 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar
            size="xs"
            src={getFileURL(worklog.logged_by.avatar_url ?? "")}
            alt={getWorklogUserName(worklog.logged_by)}
          />
          <span className="truncate">{getWorklogUserName(worklog.logged_by)}</span>
        </span>
      </td>
      <td className="px-3 py-3 text-secondary">
        {worklog.started_at && worklog.ended_at ? formatWorklogSpan(worklog.started_at, worklog.ended_at) : "—"}
      </td>
      <td className="px-3 py-3 break-words whitespace-pre-wrap text-secondary">
        {worklog.description || <span className="text-placeholder">No description</span>}
      </td>
      <td className="px-3 py-3 text-right font-medium">{formatWorklogDuration(worklog.duration)}</td>
    </>
  );
}

const ROW_CLASSNAME =
  "border-t-[0.5px] border-subtle align-top text-body-xs-regular text-primary hover:bg-layer-transparent-hover";

/**
 * Every worklog entry of one project (the project's Worklogs tab), work item by work item or all together.
 * Admins of the project or workspace see everyone's time; members see their own (the rules of the worklog
 * reports API it reads from).
 */
export const ProjectWorklogsRoot = observer(function ProjectWorklogsRoot(props: Props) {
  const { workspaceSlug, projectId } = props;
  const [filters, setFilters] = useState<TWorklogReportFilters>(EMPTY_WORKLOG_REPORT_FILTERS);
  const [view, setView] = useState<TView>("work_item");
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // the project is fixed; it only joins the filters when asking the API
  const projectFilters = useMemo(() => ({ ...filters, project: [projectId] }), [filters, projectId]);
  const groupBy = view === "work_item" ? "work_item" : undefined;
  const { summary } = useWorklogReport(workspaceSlug, projectFilters);
  const { detail, isLoading } = useWorklogReportDetail(workspaceSlug, projectFilters, page, PAGE_SIZE, true, groupBy);

  const groups = useMemo(() => (view === "work_item" ? groupByWorkItem(detail?.results ?? []) : []), [detail, view]);
  const workItemTotals = useMemo(() => new Map(detail?.work_items?.map((item) => [item.id, item]) ?? []), [detail]);

  const hasFilters = hasWorklogReportFilters(filters);
  const total = detail?.total_count ?? 0;
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);
  const columns = view === "work_item" ? 5 : 6;

  const download = (format: "csv" | "xlsx") => {
    window.open(worklogReportService.downloadUrl(workspaceSlug, projectFilters, format, "worklogs", groupBy), "_self");
  };
  const toggleGroup = (issueId: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });

  return (
    <div className="flex w-full flex-col gap-4 px-page-x py-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            variant="contained"
            value={view}
            onValueChange={(value) => {
              setView(value as TView);
              setPage(1);
            }}
          >
            <TabsList>
              <Tab value="work_item" label="By project task" />
              <Tab value="all" label="All entries" />
            </TabsList>
          </Tabs>
          <WorklogReportFilters
            filters={filters}
            onChange={(next) => {
              setFilters(next);
              setPage(1);
            }}
            projectMode="hidden"
            scope={summary?.scope}
          />
        </div>
        <ReportExportMenu disabled={!total} onExport={download} />
      </div>
      {summary && !summary.scope.can_view_others && <OwnTimeNotice />}

      {/* table */}
      {!isLoading && detail && total === 0 ? (
        <div className="flex flex-col items-center rounded-lg border-[0.5px] border-subtle py-12">
          <EmptyStateCompact
            title={hasFilters ? "No worklogs match these filters" : "No time logged in this project yet"}
            description={
              hasFilters
                ? "Try different users, statuses or dates."
                : "Entries appear here once members log work on this project's tasks."
            }
            assetKey="worklog"
            assetClassName="size-20"
            align="center"
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border-[0.5px] border-subtle">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] table-fixed text-left">
              {view === "work_item" ? (
                <colgroup>
                  <col className="w-[13%]" />
                  <col className="w-[18%]" />
                  <col className="w-[27%]" />
                  <col className="w-[32%]" />
                  <col className="w-[10%]" />
                </colgroup>
              ) : (
                <colgroup>
                  <col className="w-[11%]" />
                  <col className="w-[24%]" />
                  <col className="w-[15%]" />
                  <col className="w-[20%]" />
                  <col className="w-[22%]" />
                  <col className="w-[8%]" />
                </colgroup>
              )}
              <thead className="bg-layer-1">
                <tr className="text-body-xs-medium text-secondary">
                  <th className="px-3 py-3 font-medium">Date</th>
                  {view === "all" && <th className="px-3 py-3 font-medium">Project task</th>}
                  <th className="px-3 py-3 font-medium">Logged by</th>
                  <th className="px-3 py-3 font-medium">Start – End</th>
                  <th className="px-3 py-3 font-medium">Work description</th>
                  <th className="px-3 py-3 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && !detail
                  ? Array.from({ length: 4 }).map((_, index) => (
                      // oxlint-disable-next-line react/no-array-index-key
                      <tr key={index} className="border-t-[0.5px] border-subtle">
                        <td colSpan={columns} className="px-3 py-3">
                          <div className="h-4 w-full animate-pulse rounded-sm bg-layer-1" />
                        </td>
                      </tr>
                    ))
                  : view === "work_item"
                    ? groups.map((group) => {
                        const totals = workItemTotals.get(group.issue.id);
                        const isOpen = !collapsed.has(group.issue.id);
                        const Chevron = isOpen ? ChevronDownOutline : ChevronRightOutline;
                        const count = totals?.worklog_count ?? group.entries.length;
                        return (
                          <Fragment key={group.issue.id}>
                            <tr className="border-t-[0.5px] border-subtle bg-layer-1/60 text-body-xs-medium text-primary">
                              <td colSpan={columns - 1} className="px-3 py-2.5">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <button
                                    type="button"
                                    className="grid size-5 shrink-0 place-items-center rounded-sm text-tertiary hover:bg-layer-transparent-hover"
                                    aria-expanded={isOpen}
                                    aria-label={`${isOpen ? "Hide" : "Show"} entries of ${group.issue.name}`}
                                    onClick={() => toggleGroup(group.issue.id)}
                                  >
                                    <Chevron className="size-3.5" />
                                  </button>
                                  <WorkItemLink workspaceSlug={workspaceSlug} entry={group} />
                                  <span className="font-normal shrink-0 text-tertiary">
                                    · {count} {count === 1 ? "entry" : "entries"}
                                  </span>
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                {formatWorklogDuration(
                                  totals?.total_duration ?? group.entries.reduce((sum, e) => sum + e.duration, 0)
                                )}
                              </td>
                            </tr>
                            {isOpen &&
                              group.entries.map((worklog) => (
                                <tr key={worklog.id} className={ROW_CLASSNAME}>
                                  <td className="py-3 pr-3 pl-10 whitespace-nowrap">
                                    {renderFormattedDate(worklog.work_date ?? new Date(worklog.created_at))}
                                  </td>
                                  <EntryCells worklog={worklog} />
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })
                    : detail?.results.map((worklog) => (
                        <tr key={worklog.id} className={ROW_CLASSNAME}>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {renderFormattedDate(worklog.work_date ?? new Date(worklog.created_at))}
                          </td>
                          <td className="px-3 py-3">
                            <WorkItemLink workspaceSlug={workspaceSlug} entry={worklog} />
                          </td>
                          <EntryCells worklog={worklog} />
                        </tr>
                      ))}
              </tbody>
              {!!detail?.results.length && (
                <tfoot className="bg-layer-1">
                  <tr className="border-t-[0.5px] border-subtle text-body-xs-medium text-primary">
                    <td className="px-3 py-3" colSpan={columns - 1}>
                      Total time ({detail.total_count} {detail.total_count === 1 ? "entry" : "entries"}
                      {view === "work_item" && detail.work_items
                        ? `, ${detail.work_items.length} ${detail.work_items.length === 1 ? "project task" : "project tasks"}`
                        : ""}
                      )
                    </td>
                    <td className="px-3 py-3 text-right">{formatWorklogDuration(detail.total_duration)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-body-xs-regular text-secondary">
          <span>
            {from}–{to} of {total}
          </span>
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={ChevronLeftOutline} />}
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          />
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={ChevronRightOutline} />}
            aria-label="Next page"
            disabled={to >= total}
            onClick={() => setPage((p) => p + 1)}
          />
        </div>
      )}
    </div>
  );
});
