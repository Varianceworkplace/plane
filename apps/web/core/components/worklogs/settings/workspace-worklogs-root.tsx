/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Menu, MenuContent, MenuItem } from "@makeplane/propel/components/menu";
import { SplitButton } from "@makeplane/propel/components/split-button";
import { CalendarOutline, ChevronLeftOutline, ChevronRightOutline, CloseOutline } from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import type { DateRangeValue, MemberOption, ProjectOption } from "@plane/blocks/property-select";
import { DateRangeSelect, MemberSelect, ProjectSelect } from "@plane/blocks/property-select";
import { useTranslation } from "@plane/i18n";
import { getFileURL, renderFormattedDate, renderFormattedTime } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUserProfile } from "@/hooks/store/user";
// local imports
import { formatWorklogDuration, getWorklogUserName, worklogService } from "../helpers";
import type { TWorkspaceWorklogFilters } from "../types";

const PAGE_SIZE = 50;

type Props = { workspaceSlug: string };

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const WorkspaceWorklogsRoot = observer(function WorkspaceWorklogsRoot(props: Props) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  // store hooks
  const {
    workspace: { workspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();
  const { workspaceProjectIds, getProjectById } = useProject();
  const { data: userProfile } = useUserProfile();
  // state
  const [userIds, setUserIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });
  const [page, setPage] = useState(1);

  // ------------------------------------------------------------ options
  const memberOptions = useMemo<MemberOption[]>(
    () =>
      (workspaceMemberIds ?? [])
        .map((id) => getWorkspaceMemberDetails(id)?.member)
        .filter((member): member is NonNullable<typeof member> => !!member)
        .map((member) => ({
          id: member.id,
          display_name: member.display_name,
          name: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() || member.display_name,
          avatar_url: getFileURL(member.avatar_url ?? ""),
        })),
    [workspaceMemberIds, getWorkspaceMemberDetails]
  );
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

  const getMembers = useCallback(
    async ({ search }: { search?: string }) => {
      const query = search?.trim().toLowerCase();
      const results = memberOptions.filter(
        (m) => !query || `${m.name ?? ""} ${m.display_name}`.toLowerCase().includes(query)
      );
      return { results, next_page_results: false };
    },
    [memberOptions]
  );
  const getProjects = useCallback(
    async ({ search }: { search?: string }) => {
      const query = search?.trim().toLowerCase();
      const results = projectOptions.filter(
        (p) => !query || `${p.name} ${p.identifier ?? ""}`.toLowerCase().includes(query)
      );
      return { results, next_page_results: false };
    },
    [projectOptions]
  );

  // ------------------------------------------------------------ data
  const filters: TWorkspaceWorklogFilters = useMemo(
    () => ({
      logged_by: userIds,
      project: projectIds,
      start: range.from ? startOfDay(range.from).toISOString() : undefined,
      end: range.to ? addDays(range.to, 1).toISOString() : undefined,
    }),
    [userIds, projectIds, range]
  );
  const { data, isLoading } = useSWR(
    workspaceSlug ? ["WORKSPACE_WORKLOGS", workspaceSlug, JSON.stringify(filters), page] : null,
    () => worklogService.workspaceWorklogs(workspaceSlug, filters, page, PAGE_SIZE),
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const hasFilters = userIds.length > 0 || projectIds.length > 0 || !!range.from;
  const resetPage = () => setPage(1);
  const total = data?.total_count ?? 0;
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  const download = (format: "csv" | "xlsx") => {
    window.open(worklogService.downloadUrl(workspaceSlug, filters, format), "_self");
  };

  return (
    <div className="flex w-full flex-col gap-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MemberSelect
            multiple
            variant="pill-md"
            getValues={getMembers}
            value={memberOptions.filter((m) => userIds.includes(m.id))}
            onChange={(ids) => {
              setUserIds(ids);
              resetPage();
            }}
            placeholder="Users"
            searchPlaceholder="Search users"
            showLabel
          />
          <ProjectSelect
            multiple
            variant="pill-md"
            getValues={getProjects}
            value={projectOptions.filter((p) => projectIds.includes(p.id))}
            onChange={(ids) => {
              setProjectIds(ids);
              resetPage();
            }}
            placeholder="Projects"
            searchPlaceholder="Search projects"
          />
          <DateRangeSelect
            variant="pill-md"
            value={range}
            onChange={(value) => {
              setRange(value);
              resetPage();
            }}
            placeholder="Date range"
            icon={<CalendarOutline />}
            mergeDates
            weekStartsOn={userProfile?.start_of_the_week}
          />
          {hasFilters && (
            <IconButton
              variant="ghost"
              size="sm"
              icon={<Icon icon={CloseOutline} />}
              aria-label="Clear filters"
              onClick={() => {
                setUserIds([]);
                setProjectIds([]);
                setRange({ from: null, to: null });
                resetPage();
              }}
            />
          )}
        </div>
        <Menu>
          <SplitButton
            variant="primary"
            size="md"
            label="Download"
            menuLabel="Choose download format"
            disabled={!total}
            onClick={() => download("csv")}
          />
          <MenuContent side="bottom" align="end">
            <MenuItem label="Download as CSV" onClick={() => download("csv")} />
            <MenuItem label="Download as Excel" onClick={() => download("xlsx")} />
          </MenuContent>
        </Menu>
      </div>

      {/* table */}
      {!isLoading && total === 0 ? (
        <div className="flex flex-col items-center rounded-lg border-[0.5px] border-subtle py-12">
          <EmptyStateCompact
            title={hasFilters ? "No worklogs match these filters" : t("settings_empty_state.worklogs.title")}
            description={
              hasFilters ? "Try different users, projects or dates." : t("settings_empty_state.worklogs.description")
            }
            assetKey="worklog"
            assetClassName="size-20"
            align="center"
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border-[0.5px] border-subtle">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-fixed text-left">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[30%]" />
                <col className="w-[26%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="bg-layer-1">
                <tr className="text-body-xs-medium text-secondary">
                  <th className="px-3 py-3 font-medium">Project</th>
                  <th className="px-3 py-3 font-medium">Work item</th>
                  <th className="px-3 py-3 font-medium">Logged</th>
                  <th className="px-3 py-3 font-medium">Start – End</th>
                  <th className="px-3 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && !data
                  ? Array.from({ length: 4 }).map((_, index) => (
                      // oxlint-disable-next-line react/no-array-index-key
                      <tr key={index} className="border-t-[0.5px] border-subtle">
                        <td colSpan={5} className="px-3 py-3">
                          <div className="h-4 w-full animate-pulse rounded-sm bg-layer-1" />
                        </td>
                      </tr>
                    ))
                  : data?.results.map((worklog) => (
                      <tr
                        key={worklog.id}
                        className="border-t-[0.5px] border-subtle text-body-xs-regular text-primary hover:bg-layer-transparent-hover"
                      >
                        <td className="truncate px-3 py-3" title={worklog.project.name}>
                          {worklog.project.name}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/${workspaceSlug}/browse/${worklog.project.identifier}-${worklog.issue.sequence_id}/`}
                            className="flex min-w-0 items-center gap-2 hover:underline"
                            title={worklog.issue.name}
                          >
                            <span className="shrink-0 text-caption-md-regular text-tertiary">
                              {worklog.project.identifier}-{worklog.issue.sequence_id}
                            </span>
                            <span className="truncate">{worklog.issue.name}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar
                              size="xs"
                              src={getFileURL(worklog.logged_by.avatar_url ?? "")}
                              alt={getWorklogUserName(worklog.logged_by)}
                            />
                            <span className="truncate">
                              {getWorklogUserName(worklog.logged_by)} on{" "}
                              {renderFormattedDate(worklog.started_at ?? worklog.created_at)}
                            </span>
                          </span>
                        </td>
                        <td className="truncate px-3 py-3 text-secondary">
                          {worklog.started_at && worklog.ended_at
                            ? `${renderFormattedTime(worklog.started_at, "12-hour")} – ${renderFormattedTime(worklog.ended_at, "12-hour")}`
                            : "—"}
                        </td>
                        <td className="px-3 py-3 font-medium">{formatWorklogDuration(worklog.duration)}</td>
                      </tr>
                    ))}
              </tbody>
              {!!data?.results.length && (
                <tfoot className="bg-layer-1">
                  <tr className="border-t-[0.5px] border-subtle text-body-xs-medium text-primary">
                    <td className="px-3 py-3" colSpan={4}>
                      Total time
                    </td>
                    <td className="px-3 py-3">{formatWorklogDuration(data.total_duration)}</td>
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
