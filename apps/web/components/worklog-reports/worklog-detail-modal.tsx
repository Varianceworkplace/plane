/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
// plane imports
import { Dialog, DialogClose, DialogCloseGroup, DialogContent, DialogTitle } from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Menu, MenuContent, MenuItem } from "@makeplane/propel/components/menu";
import { SplitButton } from "@makeplane/propel/components/split-button";
import { ChevronLeftOutline, ChevronRightOutline, CloseOutline } from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { StateGroupIcon } from "@plane/blocks/icons";
import { renderFormattedDate } from "@plane/utils";
// components
import { formatWorklogDuration, formatWorklogSpan } from "@/components/worklogs/helpers";
// local imports
import { groupEntriesByDate, useWorklogReportDetail, worklogReportService } from "./helpers";
import type { TWorklogReportFilters, TWorklogReportSelection } from "./types";

const PAGE_SIZE = 50;

type Props = {
  workspaceSlug: string;
  /** The report's filters; the selection narrows them to one user (and project) */
  filters: TWorklogReportFilters;
  selection: TWorklogReportSelection | null;
  onClose: () => void;
};

const describeRange = (filters: TWorklogReportFilters) => {
  const from = renderFormattedDate(filters.from_date);
  const to = renderFormattedDate(filters.to_date);
  if (from && to) return from === to ? from : `${from} – ${to}`;
  if (from) return `Since ${from}`;
  if (to) return `Until ${to}`;
  return "All time";
};

export function WorklogReportDetailModal(props: Props) {
  const { workspaceSlug, filters, selection, onClose } = props;
  const [page, setPage] = useState(1);

  const detailFilters = useMemo<TWorklogReportFilters>(
    () => ({
      ...filters,
      logged_by: selection ? [selection.user.id] : filters.logged_by,
      project: selection?.project ? [selection.project.id] : filters.project,
      issue: selection?.issue ? [selection.issue.id] : filters.issue,
      ...selection?.range,
    }),
    [filters, selection]
  );
  // a new selection starts on the first page
  useEffect(() => setPage(1), [detailFilters]);

  const { detail, isLoading } = useWorklogReportDetail(workspaceSlug, detailFilters, page, PAGE_SIZE, !!selection);
  const dayTotals = useMemo(() => new Map(detail?.days.map((day) => [day.date, day]) ?? []), [detail]);
  const groups = useMemo(() => groupEntriesByDate(detail?.results ?? []), [detail]);

  const total = detail?.total_count ?? 0;
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  const download = (format: "csv" | "xlsx") => {
    window.open(worklogReportService.downloadUrl(workspaceSlug, detailFilters, format, "worklogs"), "_self");
  };

  return (
    <Dialog open={!!selection} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="xl">
        <DialogCloseGroup>
          <IconButton
            size="sm"
            variant="tertiary"
            icon={<Icon icon={CloseOutline} />}
            aria-label="Close"
            render={<DialogClose />}
          />
        </DialogCloseGroup>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pr-14">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle>
              {selection?.user.name}
              {selection?.project ? ` · ${selection.project.name}` : ""}
              {selection?.issue ? ` · ${selection.issue.name}` : ""}
            </DialogTitle>
            <p className="text-body-xs-regular text-tertiary">
              {describeRange(detailFilters)}
              {detail && (
                <>
                  {" · "}
                  <span className="font-medium text-primary">{formatWorklogDuration(detail.total_duration)}</span> in{" "}
                  {detail.total_count} {detail.total_count === 1 ? "entry" : "entries"} over {detail.days.length}{" "}
                  {detail.days.length === 1 ? "day" : "days"}
                </>
              )}
            </p>
          </div>
          <Menu>
            <SplitButton
              variant="secondary"
              size="md"
              label="Export"
              menuLabel="Choose export format"
              disabled={!total}
              onClick={() => download("csv")}
            />
            <MenuContent side="bottom" align="end">
              <MenuItem label="Export as CSV" onClick={() => download("csv")} />
              <MenuItem label="Export as Excel" onClick={() => download("xlsx")} />
            </MenuContent>
          </Menu>
        </div>

        <div className="flex max-h-[65vh] min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4">
          {!isLoading && detail && total === 0 ? (
            <div className="flex flex-col items-center py-10">
              <EmptyStateCompact
                title="No worklogs"
                description="Nothing was logged for these filters."
                assetKey="worklog"
                assetClassName="size-20"
                align="center"
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border-[0.5px] border-subtle">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] table-fixed text-left">
                  <colgroup>
                    <col className="w-[30%]" />
                    <col className="w-[14%]" />
                    <col className="w-[30%]" />
                    <col className="w-[16%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <thead className="bg-layer-1">
                    <tr className="text-body-xs-medium text-secondary">
                      <th className="px-3 py-2.5 font-medium">Task</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Work description</th>
                      <th className="px-3 py-2.5 font-medium">Start – End</th>
                      <th className="px-3 py-2.5 text-right font-medium">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && !detail
                      ? Array.from({ length: 4 }).map((_, index) => (
                          // oxlint-disable-next-line react/no-array-index-key
                          <tr key={index} className="border-t-[0.5px] border-subtle">
                            <td colSpan={5} className="px-3 py-3">
                              <div className="h-4 w-full animate-pulse rounded-sm bg-layer-1" />
                            </td>
                          </tr>
                        ))
                      : groups.map((group) => {
                          const day = dayTotals.get(group.date);
                          return (
                            <Fragment key={group.date}>
                              <tr className="border-t-[0.5px] border-subtle bg-layer-1/60 text-body-xs-medium text-primary">
                                <td colSpan={4} className="px-3 py-2">
                                  {renderFormattedDate(group.date, "EEE, MMM dd, yyyy")}
                                  {day && (
                                    <span className="font-normal ml-2 text-tertiary">
                                      {day.worklog_count} {day.worklog_count === 1 ? "entry" : "entries"}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {day ? formatWorklogDuration(day.total_duration) : ""}
                                </td>
                              </tr>
                              {group.entries.map((entry) => (
                                <tr
                                  key={entry.id}
                                  className="border-t-[0.5px] border-subtle align-top text-body-xs-regular text-primary hover:bg-layer-transparent-hover"
                                >
                                  <td className="px-3 py-2.5">
                                    <Link
                                      href={`/${workspaceSlug}/browse/${entry.project.identifier}-${entry.issue.sequence_id}/`}
                                      className="flex min-w-0 items-center gap-2 hover:underline"
                                      title={`${entry.project.name}: ${entry.issue.name}`}
                                    >
                                      <span className="shrink-0 text-caption-md-regular text-tertiary">
                                        {entry.project.identifier}-{entry.issue.sequence_id}
                                      </span>
                                      <span className="truncate">{entry.issue.name}</span>
                                    </Link>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    {entry.state ? (
                                      <span className="flex min-w-0 items-center gap-1.5">
                                        <StateGroupIcon
                                          stateGroup={entry.state.group}
                                          color={entry.state.color}
                                          className="size-3.5 shrink-0"
                                        />
                                        <span className="truncate">{entry.state.name}</span>
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 break-words whitespace-pre-wrap text-secondary">
                                    {entry.description || <span className="text-placeholder">No description</span>}
                                  </td>
                                  <td className="truncate px-3 py-2.5 text-secondary">
                                    {entry.started_at && entry.ended_at
                                      ? formatWorklogSpan(entry.started_at, entry.ended_at)
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-medium">
                                    {formatWorklogDuration(entry.duration)}
                                  </td>
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                  </tbody>
                  {!!detail?.results.length && (
                    <tfoot className="bg-layer-1">
                      <tr className="border-t-[0.5px] border-subtle text-body-xs-medium text-primary">
                        <td className="px-3 py-2.5" colSpan={4}>
                          Total time
                        </td>
                        <td className="px-3 py-2.5 text-right">{formatWorklogDuration(detail.total_duration)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

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
      </DialogContent>
    </Dialog>
  );
}
