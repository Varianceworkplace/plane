/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { Button } from "@makeplane/propel/components/button";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import {
  CalendarOutline,
  ChevronDownOutline,
  ChevronLeftOutline,
  ChevronRightOutline,
  CloseOutline,
  ExportOutline,
  SearchOutline,
} from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { DateSelect, ProjectSelect } from "@plane/blocks/property-select";
import type { ProjectOption } from "@plane/blocks/property-select";
import { Select } from "@plane/blocks/select";
import { getFileURL, renderFormattedDate, renderFormattedTime } from "@plane/utils";
// components
import { fromReportDate, toReportDate } from "@/components/worklog-reports/helpers";
import { formatWorklogDuration } from "@/components/worklogs/helpers";
import type { TWorklogUser } from "@/components/worklogs/types";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
// services
import { TimesheetService } from "@/services/timesheet.service";
// local imports
import type { TTimesheetQuery } from "./types";

const timesheetService = new TimesheetService();
const PER_PAGE = 50;
const EVERYONE = "all";

type TPersonOption = { id: string; label: string; user?: TWorklogUser };

/** The end time, with its date when the work ran into another day. */
const formatEnd = (startedAt: string | null, endedAt: string | null) => {
  if (!endedAt) return "—";
  const time = renderFormattedTime(endedAt, "12-hour");
  const endDay = renderFormattedDate(endedAt, "dd-MM-yyyy");
  return startedAt && renderFormattedDate(startedAt, "dd-MM-yyyy") !== endDay ? `${endDay} ${time}` : time;
};

const personName = (user: TWorklogUser) =>
  `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.display_name;

/**
 * Time Sheet: the signed-in person's time entries, and the entries of the people they may see. The server decides
 * whom (their own; a PM's team; the levels below theirs in their teams; everyone for HR and admins) and refuses
 * anyone else, so the person picker only lists who it allows.
 */
export const TimesheetRoot = observer(function TimesheetRoot(props: { workspaceSlug: string }) {
  const { workspaceSlug } = props;
  const { data: currentUser } = useUser();
  const { workspaceProjectIds, getProjectById } = useProject();
  const [query, setQuery] = useState<TTimesheetQuery>({ page: 1 });
  const [search, setSearch] = useState("");
  // the rows picked on this page, for Export Entry (none picked: every entry the filters show)
  const [selected, setSelected] = useState<string[]>([]);

  const swrKey = `TIMESHEET_${workspaceSlug}_${JSON.stringify(query)}`;
  useEffect(() => setSelected([]), [swrKey]);
  const { data, error, isLoading } = useSWR(
    workspaceSlug ? swrKey : null,
    () => timesheetService.list(workspaceSlug, { ...query, per_page: PER_PAGE }),
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const update = (patch: TTimesheetQuery) => setQuery((previous) => ({ ...previous, ...patch, page: patch.page ?? 1 }));

  // ------------------------------------------------------------ options
  const personOptions = useMemo<TPersonOption[]>(() => {
    const people = data?.people ?? [];
    return [
      ...people.map((user) => ({
        id: user.id,
        label: user.id === currentUser?.id ? `${personName(user)} (me)` : personName(user),
        user,
      })),
      ...(data?.can_view_others ? [{ id: EVERYONE, label: "Everyone I can see" }] : []),
    ];
  }, [data?.people, data?.can_view_others, currentUser?.id]);
  const selectedPerson = personOptions.find((option) => option.id === (data?.person ?? currentUser?.id)) ?? null;

  const projectOptions = useMemo<ProjectOption[]>(
    () =>
      (workspaceProjectIds ?? [])
        .map((id) => getProjectById(id))
        .filter((project): project is NonNullable<typeof project> => !!project && !project.archived_at)
        .map((project) => ({
          id: project.id,
          name: project.name,
          identifier: project.identifier,
          logo_props: project.logo_props,
        })),
    [workspaceProjectIds, getProjectById]
  );
  const getProjects = async ({ search: term }: { search?: string }) => {
    const value = term?.trim().toLowerCase();
    return {
      results: projectOptions.filter(
        (project) => !value || `${project.name} ${project.identifier ?? ""}`.toLowerCase().includes(value)
      ),
      next_page_results: false,
    };
  };

  const fromDate = fromReportDate(query.from_date);
  const toDate = fromReportDate(query.to_date);
  const hasFilters = !!(query.project || query.from_date || query.to_date || query.search);
  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total_count / PER_PAGE)) : 1;
  const showPerson = data?.person === EVERYONE;
  const columns = showPerson ? 9 : 8;
  const pageIds = data?.results.map((entry) => entry.id) ?? [];
  const allPicked = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const toggle = (id: string) =>
    setSelected((previous) => (previous.includes(id) ? previous.filter((other) => other !== id) : [...previous, id]));
  const exportEntries = (type: "csv" | "xlsx") =>
    window.open(timesheetService.downloadUrl(workspaceSlug, query, type, selected), "_self");
  const exportScope = selected.length
    ? `${selected.length} selected ${selected.length === 1 ? "entry" : "entries"}`
    : `All ${data?.total_count ?? 0} ${data?.total_count === 1 ? "entry" : "entries"} shown by the filters`;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-page-x py-6">
      <div className="flex flex-wrap items-center gap-2">
        {data?.can_view_others && (
          <div className="w-60 rounded-md border-[0.5px] border-subtle">
            <Select<TPersonOption>
              getValues={() => personOptions}
              value={selectedPerson}
              onChange={(id) => update({ person: id === currentUser?.id ? undefined : id })}
              // names the picker for screen readers: "Whose time, <person>"
              placeholder="Whose time"
              getOptionValue={(option) => option.id}
              getOptionLabel={(option) => option.label}
              showSearch={personOptions.length > 8}
              pinSelected={false}
            >
              <Select.Trigger<TPersonOption> variant="select-md" className="w-full" aria-label="Whose time">
                <span className="truncate text-left">{selectedPerson?.label ?? "Me"}</span>
              </Select.Trigger>
            </Select>
          </div>
        )}
        <ProjectSelect
          variant="pill-md"
          getValues={getProjects}
          value={projectOptions.find((project) => project.id === query.project) ?? null}
          onChange={(id) => update({ project: id && id !== query.project ? id : undefined })}
          placeholder="All projects"
          searchPlaceholder="Search projects"
        />
        <DateSelect
          variant="pill-md"
          value={fromDate}
          onChange={(date) => update({ from_date: toReportDate(date) })}
          maxDate={toDate ?? undefined}
          placeholder="From date"
          icon={<CalendarOutline />}
          clearable
        />
        <DateSelect
          variant="pill-md"
          value={toDate}
          onChange={(date) => update({ to_date: toReportDate(date) })}
          minDate={fromDate ?? undefined}
          placeholder="To date"
          icon={<CalendarOutline />}
          clearable
        />
        <form
          className="w-56"
          onSubmit={(e) => {
            e.preventDefault();
            update({ search: search.trim() || undefined });
          }}
        >
          <InputGroup size="md">
            <SearchOutline className="ml-2 size-3.5 text-placeholder" />
            <Input
              size="md"
              placeholder="Search tasks, projects, notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => update({ search: search.trim() || undefined })}
            />
          </InputGroup>
        </form>
        {hasFilters && (
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={CloseOutline} />}
            aria-label="Clear filters"
            onClick={() => {
              setSearch("");
              setQuery((previous) => ({ person: previous.person, page: 1 }));
            }}
          />
        )}
        {data && (
          <span className="ml-auto text-body-xs-medium text-secondary">
            {data.total_count} {data.total_count === 1 ? "entry" : "entries"} ·{" "}
            {formatWorklogDuration(data.total_duration)}
          </span>
        )}
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                label={selected.length ? `Actions (${selected.length})` : "Actions"}
                icon={<Icon icon={ChevronDownOutline} />}
                iconPosition="end"
                disabled={!data?.total_count}
              />
            }
          />
          <MenuContent side="bottom" align="end">
            <p className="max-w-60 px-2 py-1.5 text-caption-md-regular text-tertiary">Export Entry: {exportScope}</p>
            <MenuItem label="Export to CSV" icon={<Icon icon={ExportOutline} />} onClick={() => exportEntries("csv")} />
            <MenuItem
              label="Export to Excel"
              icon={<Icon icon={ExportOutline} />}
              onClick={() => exportEntries("xlsx")}
            />
          </MenuContent>
        </Menu>
      </div>

      {error ? (
        <p className="rounded-md bg-layer-1 px-3 py-2 text-body-xs-regular text-danger-primary">
          {(error as { error?: string })?.error ?? "The time sheet couldn't be loaded."}
        </p>
      ) : !isLoading && data && data.results.length === 0 ? (
        <div className="flex justify-center rounded-lg border-[0.5px] border-subtle py-12">
          <EmptyStateCompact
            title={hasFilters ? "No time entries match these filters" : "No time logged yet"}
            description="Time logged on project tasks (the timer or Log time) shows up here."
            assetKey="project"
            assetClassName="size-16"
            align="center"
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
          <table className="w-full min-w-[900px] table-fixed text-left">
            <colgroup>
              <col className="w-10" />
              <col className="w-[11%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className={showPerson ? "w-[24%]" : "w-[30%]"} />
              <col className="w-[13%]" />
              {showPerson && <col className="w-[12%]" />}
              <col className={showPerson ? "w-[16%]" : "w-[22%]"} />
            </colgroup>
            <thead className="bg-layer-1">
              <tr className="text-body-xs-medium text-secondary">
                <th className="px-3 py-2.5">
                  <Checkbox
                    checked={allPicked}
                    indeterminate={!allPicked && selected.length > 0}
                    disabled={!pageIds.length}
                    aria-label="Select all entries on this page"
                    onCheckedChange={() => setSelected(allPicked ? [] : pageIds)}
                  />
                </th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Start</th>
                <th className="px-3 py-2.5 font-medium">End</th>
                <th className="px-3 py-2.5 text-right font-medium">Duration</th>
                <th className="px-3 py-2.5 font-medium">Project task</th>
                <th className="px-3 py-2.5 font-medium">Project</th>
                {showPerson && <th className="px-3 py-2.5 font-medium">Submitted for</th>}
                <th className="px-3 py-2.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data
                ? Array.from({ length: 6 }).map((_, index) => (
                    // oxlint-disable-next-line react/no-array-index-key
                    <tr key={index} className="border-t-[0.5px] border-subtle">
                      <td colSpan={columns} className="px-3 py-3">
                        <div className="h-4 w-full animate-pulse rounded-sm bg-layer-1" />
                      </td>
                    </tr>
                  ))
                : data?.results.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-t-[0.5px] border-subtle align-top text-body-xs-regular text-primary hover:bg-layer-transparent-hover"
                    >
                      <td className="px-3 py-2.5">
                        <Checkbox
                          checked={selected.includes(entry.id)}
                          aria-label={`Select the entry of ${entry.work_date ?? ""} on ${entry.project.identifier}-${entry.issue.sequence_id}`}
                          onCheckedChange={() => toggle(entry.id)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        {entry.work_date ? renderFormattedDate(entry.work_date, "dd-MM-yyyy") : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-secondary">
                        {entry.started_at ? renderFormattedTime(entry.started_at, "12-hour") : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-secondary">{formatEnd(entry.started_at, entry.ended_at)}</td>
                      <td className="px-3 py-2.5 text-right font-medium">{formatWorklogDuration(entry.duration)}</td>
                      <td className="px-3 py-2.5">
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
                      </td>
                      <td className="truncate px-3 py-2.5 text-secondary" title={entry.project.name}>
                        {entry.project.name}
                      </td>
                      {showPerson && (
                        <td className="px-3 py-2.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Avatar
                              size="xs"
                              alt={entry.logged_by.display_name}
                              fallback={entry.logged_by.display_name?.[0]?.toUpperCase()}
                              src={getFileURL(entry.logged_by.avatar_url ?? "")}
                            />
                            <span className="truncate">{personName(entry.logged_by)}</span>
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-2.5 break-words whitespace-pre-wrap text-secondary">
                        {entry.description || <span className="text-placeholder">—</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {data && pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-body-xs-regular text-secondary">
          <span>
            {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, data.total_count)} of {data.total_count}
          </span>
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={ChevronLeftOutline} />}
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => update({ page: page - 1 })}
          />
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={ChevronRightOutline} />}
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => update({ page: page + 1 })}
          />
        </div>
      )}
    </div>
  );
});
