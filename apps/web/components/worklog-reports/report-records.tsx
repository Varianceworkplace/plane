/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { debounce } from "lodash-es";
// plane imports
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { ChevronDownOutline, ChevronLeftOutline, ChevronRightOutline, SearchOutline } from "@makeplane/propel/icons";
import { StateGroupIcon } from "@plane/blocks/icons";
import { Loader } from "@plane/blocks/skeleton";
import { cn, renderFormattedDate } from "@plane/utils";
// components
import { formatWorklogDuration, getWorklogUserName } from "@/components/worklogs/helpers";
// local imports
import { useWorklogReportDetail } from "./helpers";
import { HEAD_CELL, ROW_CLASSNAME, Section, TABLE_CLASSNAME, UserCell } from "./report-parts";
import type { TWorklogReportFilters, TWorklogReportListOptions, TWorklogReportSortKey } from "./types";

const PAGE_SIZE = 25;

const COLUMNS: { key: TWorklogReportSortKey | null; label: string; className?: string }[] = [
  { key: "user", label: "Employee" },
  { key: "project", label: "Project" },
  { key: "task", label: "Task" },
  { key: "status", label: "Status" },
  { key: "work_date", label: "Work date" },
  { key: "duration", label: "Hours", className: "text-right" },
  { key: null, label: "Assigned to" },
  { key: null, label: "Work description" },
];

/** Every worklog behind the report, with search, sortable columns and pages. */
export function WorklogReportRecords(props: { workspaceSlug: string; filters: TWorklogReportFilters }) {
  const { workspaceSlug, filters } = props;
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [ordering, setOrdering] = useState<TWorklogReportListOptions["ordering"]>("-work_date");
  const [page, setPage] = useState(1);

  const applySearch = useMemo(() => debounce((value: string) => setSearch(value.trim()), 300), []);
  useEffect(() => () => applySearch.cancel(), [applySearch]);
  // a new filter, search or sort starts again on page 1
  useEffect(() => setPage(1), [filters, search, ordering]);

  const { detail, isLoading } = useWorklogReportDetail(workspaceSlug, filters, page, PAGE_SIZE, true, undefined, {
    search,
    ordering,
  });

  const total = detail?.total_count ?? 0;
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  const sortBy = (key: TWorklogReportSortKey) => setOrdering((current) => (current === key ? `-${key}` : key));

  return (
    <Section
      title="Detailed records"
      hint={detail ? `${total} worklogs, ${formatWorklogDuration(detail.total_duration)}` : undefined}
      action={
        <div className="w-64">
          <InputGroup size="md">
            <SearchOutline aria-hidden="true" className="ml-2 size-3.5 shrink-0 text-placeholder" />
            <Input
              size="md"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                applySearch(event.target.value);
              }}
              placeholder="Search tasks, people, projects, notes"
              aria-label="Search worklogs"
            />
          </InputGroup>
        </div>
      }
    >
      {!detail && isLoading ? (
        <Loader className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Loader.Item key={index} height="36px" width="100%" />
          ))}
        </Loader>
      ) : (
        <div className={cn("flex flex-col gap-3 transition-opacity", isLoading && "opacity-60")}>
          <div className={TABLE_CLASSNAME}>
            <table className="w-full min-w-[960px] table-fixed text-left">
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[20%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[7%]" />
                <col className="w-[12%]" />
                <col className="w-[19%]" />
              </colgroup>
              <thead className="bg-layer-1 text-body-xs-medium text-secondary">
                <tr>
                  {COLUMNS.map((column) => {
                    const active = column.key && ordering?.replace("-", "") === column.key;
                    return (
                      <th
                        key={column.label}
                        scope="col"
                        className={cn(HEAD_CELL, column.className)}
                        aria-sort={
                          active
                            ? ordering?.startsWith("-")
                              ? "descending"
                              : "ascending"
                            : column.key
                              ? "none"
                              : undefined
                        }
                      >
                        {column.key ? (
                          <button
                            type="button"
                            onClick={() => sortBy(column.key as TWorklogReportSortKey)}
                            className={cn(
                              "inline-flex items-center gap-1 hover:text-primary",
                              column.className?.includes("text-right") && "flex-row-reverse",
                              active && "text-primary"
                            )}
                          >
                            {column.label}
                            <ChevronDownOutline
                              aria-hidden="true"
                              className={cn(
                                "size-3 transition-transform",
                                !active && "opacity-0",
                                active && !ordering?.startsWith("-") && "rotate-180"
                              )}
                            />
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {detail?.results.map((entry) => (
                  <tr key={entry.id} className={cn(ROW_CLASSNAME, "cursor-default align-top")}>
                    <td className="px-3 py-2.5">
                      <UserCell user={entry.logged_by} />
                    </td>
                    <td className="truncate px-3 py-2.5 text-secondary" title={entry.project.name}>
                      {entry.project.identifier} <span className="text-primary">{entry.project.name}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="line-clamp-2" title={entry.issue.name}>
                        <span className="text-tertiary">
                          {entry.project.identifier}-{entry.issue.sequence_id}{" "}
                        </span>
                        {entry.issue.name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {entry.state ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <StateGroupIcon
                            stateGroup={entry.state.group}
                            color={entry.state.color}
                            className="size-3.5"
                          />
                          <span className="truncate">{entry.state.name}</span>
                        </span>
                      ) : (
                        <span className="text-placeholder">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {entry.work_date ? renderFormattedDate(entry.work_date) : "–"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap tabular-nums">
                      {formatWorklogDuration(entry.duration)}
                    </td>
                    <td className="truncate px-3 py-2.5 text-secondary">
                      {entry.assignees?.length ? entry.assignees.map(getWorklogUserName).join(", ") : "–"}
                    </td>
                    <td className="px-3 py-2.5 text-secondary">
                      <span className="line-clamp-2" title={entry.description}>
                        {entry.description || "–"}
                      </span>
                    </td>
                  </tr>
                ))}
                {!detail?.results.length && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className="px-3 py-8 text-center text-body-xs-regular text-placeholder"
                    >
                      {search ? `No worklogs match "${search}".` : "No worklogs for these filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              />
              <IconButton
                variant="ghost"
                size="sm"
                icon={<Icon icon={ChevronRightOutline} />}
                aria-label="Next page"
                disabled={to >= total}
                onClick={() => setPage((current) => current + 1)}
              />
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
