/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { observer } from "mobx-react";
// plane imports
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { CalendarOutline, CloseOutline, StateOutline } from "@makeplane/propel/icons";
import { StateGroupIcon } from "@plane/blocks/icons";
import type { MemberOption, ProjectOption } from "@plane/blocks/property-select";
import { DateSelect, MemberSelect, ProjectSelect } from "@plane/blocks/property-select";
import { Select } from "@plane/blocks/select";
import { EUserPermissions, STATE_GROUPS } from "@plane/constants";
import type { TStateGroups } from "@plane/types";
import { getFileURL } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUserProfile } from "@/hooks/store/user";
// local imports
import { EMPTY_WORKLOG_REPORT_FILTERS, fromReportDate, hasWorklogReportFilters, toReportDate } from "./helpers";
import type { TWorklogReportFilters, TWorklogReportScope } from "./types";

type StateGroupOption = (typeof STATE_GROUPS)[TStateGroups];
const STATE_GROUP_OPTIONS = Object.values(STATE_GROUPS);

type Props = {
  filters: TWorklogReportFilters;
  onChange: (filters: TWorklogReportFilters) => void;
  /** Project-wise reports look at one project at a time; a project's own Worklogs page has no picker */
  projectMode: "single" | "multiple" | "hidden";
  scope: TWorklogReportScope | undefined;
};

export const WorklogReportFilters = observer(function WorklogReportFilters(props: Props) {
  const { filters, onChange, projectMode, scope } = props;
  // store hooks
  const {
    workspace: { workspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();
  const { workspaceProjectIds, getProjectById } = useProject();
  const { data: userProfile } = useUserProfile();
  // derived values
  const update = (patch: Partial<TWorklogReportFilters>) => onChange({ ...filters, ...patch });
  const canViewOthers = !!scope?.can_view_others;

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
  // Only projects the report can show something for: all of them for workspace admins, otherwise
  // the ones the user administers or works in (guests log no time).
  const projectOptions = useMemo<ProjectOption[]>(
    () =>
      (workspaceProjectIds ?? [])
        .map((id) => getProjectById(id))
        .filter((project): project is NonNullable<typeof project> => !!project && !project.archived_at)
        .filter(
          (project) =>
            !!scope?.is_workspace_admin ||
            project.member_role === EUserPermissions.ADMIN ||
            project.member_role === EUserPermissions.MEMBER
        )
        .map((project) => ({
          id: project.id,
          name: project.name,
          identifier: project.identifier,
          logo_props: project.logo_props,
        })),
    [workspaceProjectIds, getProjectById, scope?.is_workspace_admin]
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

  const fromDate = fromReportDate(filters.from_date);
  const toDate = fromReportDate(filters.to_date);
  const selectedStateGroups = STATE_GROUP_OPTIONS.filter((group) => filters.state_group.includes(group.key));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {projectMode === "hidden" ? null : projectMode === "single" ? (
        <ProjectSelect
          variant="pill-md"
          getValues={getProjects}
          value={projectOptions.find((p) => p.id === filters.project[0]) ?? null}
          onChange={(id) => update({ project: id && id !== filters.project[0] ? [id] : [] })}
          placeholder="All projects"
          searchPlaceholder="Search projects"
        />
      ) : (
        <ProjectSelect
          multiple
          variant="pill-md"
          getValues={getProjects}
          value={projectOptions.filter((p) => filters.project.includes(p.id))}
          onChange={(ids) => update({ project: ids })}
          placeholder="Projects"
          searchPlaceholder="Search projects"
        />
      )}
      {canViewOthers && (
        <MemberSelect
          multiple
          variant="pill-md"
          getValues={getMembers}
          value={memberOptions.filter((m) => filters.logged_by.includes(m.id))}
          onChange={(ids) => update({ logged_by: ids })}
          placeholder="Users"
          searchPlaceholder="Search users"
          showLabel
        />
      )}
      <Select<StateGroupOption>
        multiple
        getValues={() => STATE_GROUP_OPTIONS}
        value={selectedStateGroups}
        onChange={(keys) => update({ state_group: keys as TStateGroups[] })}
        getOptionValue={(group) => group.key}
        getOptionLabel={(group) => group.label}
        getOptionIcon={(group) => <StateGroupIcon stateGroup={group.key} color={group.color} className="size-4" />}
        showSearch={false}
        pinSelected={false}
      >
        <Select.Trigger<StateGroupOption>
          variant="pill-md"
          prependIcon={(groups) =>
            groups.length === 1 ? (
              <StateGroupIcon stateGroup={groups[0].key} color={groups[0].color} />
            ) : (
              <StateOutline aria-hidden="true" className="size-3 text-secondary" />
            )
          }
        >
          {(groups) =>
            groups.length === 0 ? "Task status" : groups.length === 1 ? groups[0].label : `${groups.length} statuses`
          }
        </Select.Trigger>
      </Select>
      <DateSelect
        variant="pill-md"
        value={fromDate}
        onChange={(date) => update({ from_date: toReportDate(date) })}
        maxDate={toDate ?? undefined}
        placeholder="From date"
        icon={<CalendarOutline />}
        clearable
        weekStartsOn={userProfile?.start_of_the_week}
      />
      <DateSelect
        variant="pill-md"
        value={toDate}
        onChange={(date) => update({ to_date: toReportDate(date) })}
        minDate={fromDate ?? undefined}
        placeholder="To date"
        icon={<CalendarOutline />}
        clearable
        weekStartsOn={userProfile?.start_of_the_week}
      />
      {hasWorklogReportFilters(filters) && (
        <IconButton
          variant="ghost"
          size="sm"
          icon={<Icon icon={CloseOutline} />}
          aria-label="Clear filters"
          onClick={() => onChange(EMPTY_WORKLOG_REPORT_FILTERS)}
        />
      )}
    </div>
  );
});
