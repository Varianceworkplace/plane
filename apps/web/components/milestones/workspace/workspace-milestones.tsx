/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import {
  AddOutline,
  DeleteOutline,
  EditOutline,
  MoreHorizontalOutline,
  SearchOutline,
  StateOutline,
} from "@makeplane/propel/icons";
import { Logo } from "@plane/blocks/emoji-icon-picker";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import type { ProjectOption } from "@plane/blocks/property-select";
import { ProjectSelect } from "@plane/blocks/property-select";
import { Select } from "@plane/blocks/select";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { renderFormattedDate } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { MilestoneProgressIcon, useMilestoneOptions, useWorkspaceMilestones } from "../helpers";
import { MilestoneAssignee, MilestoneStatusBadge } from "../milestone-fields";
import { DeleteMilestoneModal, MilestoneFormModal } from "../milestone-modals";
import type { TMilestone } from "../types";

type Props = {
  workspaceSlug: string;
};

type TStatusOption = { id: string; label: string };

const dateCell = (value: string | null) =>
  value ? renderFormattedDate(value) : <span className="text-placeholder">—</span>;

const HEAD_CLASSNAME = "px-3 py-2 text-left text-caption-md-medium whitespace-nowrap text-tertiary";
const CELL_CLASSNAME = "px-3 py-2.5 align-middle";

/**
 * Every project's milestones in one place (sidebar › Project Milestones): the projects with milestones turned on
 * where the user is an admin or member; with role-based access on, every project their roles let them see
 * milestones of. Adding one here also picks its project ("Related to").
 */
export const WorkspaceMilestones = observer(function WorkspaceMilestones(props: Props) {
  const { workspaceSlug } = props;
  const { milestones, mutate, isLoading } = useWorkspaceMilestones(workspaceSlug);
  const { getProjectById } = useProject();
  const { allowPermissions, canAccess, canInProject } = useUserPermissions();
  const canCreate = canAccess("milestones", "create", workspaceSlug);
  // what the person may do with one milestone: the project's milestone pages need an admin or member there
  // (as on those pages); others only see it in this list
  const rowAccess = (projectId: string) => {
    const isMember = allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug,
      projectId
    );
    return {
      canOpen: isMember && canInProject("milestones", "view", projectId, workspaceSlug),
      canEdit: isMember && canInProject("milestones", "edit", projectId, workspaceSlug),
      canDelete: isMember && canInProject("milestones", "delete", projectId, workspaceSlug),
    };
  };
  const options = useMilestoneOptions(workspaceSlug);
  // states
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TMilestone | null>(null);
  const [deleting, setDeleting] = useState<TMilestone | null>(null);

  // only the projects that have milestones on the page; the ones the person can't open come by name only
  const projectOptions = useMemo<ProjectOption[]>(() => {
    const names = new Map((milestones ?? []).map((milestone) => [milestone.project_id, milestone.project_name ?? ""]));
    return [...names].map(([id, name]) => {
      const project = getProjectById(id);
      return project
        ? { id: project.id, name: project.name, identifier: project.identifier, logo_props: project.logo_props }
        : { id, name };
    });
  }, [milestones, getProjectById]);
  const getProjects = useCallback(
    async ({ search: query }: { search?: string }) => {
      const text = query?.trim().toLowerCase();
      const results = projectOptions.filter(
        (project) => !text || `${project.name} ${project.identifier ?? ""}`.toLowerCase().includes(text)
      );
      return { results, next_page_results: false };
    },
    [projectOptions]
  );
  const statusOptions = useMemo<TStatusOption[]>(
    () => (options?.status ?? []).map((status) => ({ id: status, label: status })),
    [options]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (milestones ?? []).filter(
      (milestone) =>
        (!query || milestone.title.toLowerCase().includes(query)) &&
        (!projectFilter.length || projectFilter.includes(milestone.project_id)) &&
        (!statusFilter.length || statusFilter.includes(milestone.status))
    );
  }, [milestones, search, projectFilter, statusFilter]);
  const hasFilters = !!search.trim() || projectFilter.length > 0 || statusFilter.length > 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b-[0.5px] border-subtle px-page-x py-2.5">
        <span className="mr-auto text-body-sm-medium text-primary">
          Milestones <span className="text-tertiary">{milestones?.length ?? ""}</span>
        </span>
        <div className="w-52">
          <InputGroup size="md">
            <span className="flex items-center pl-2 text-tertiary">
              <SearchOutline className="size-3.5" />
            </span>
            <Input
              size="md"
              aria-label="Search milestones"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>
        <ProjectSelect
          multiple
          variant="pill-md"
          getValues={getProjects}
          value={projectOptions.filter((project) => projectFilter.includes(project.id))}
          onChange={setProjectFilter}
          placeholder="Projects"
          searchPlaceholder="Search projects"
        />
        <Select<TStatusOption>
          multiple
          getValues={() => statusOptions}
          value={statusOptions.filter((status) => statusFilter.includes(status.id))}
          onChange={setStatusFilter}
          getOptionValue={(status) => status.id}
          getOptionLabel={(status) => status.label}
          showSearch={false}
          pinSelected={false}
        >
          <Select.Trigger<TStatusOption>
            variant="pill-md"
            prependIcon={() => <StateOutline aria-hidden="true" className="size-3 text-secondary" />}
          >
            {(selected) =>
              selected.length === 0
                ? "Status"
                : selected.length === 1
                  ? selected[0].label
                  : `${selected.length} statuses`
            }
          </Select.Trigger>
        </Select>
        {canCreate && (
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label="Add milestone"
            icon={<Icon icon={AddOutline} />}
            onClick={() => setCreateOpen(true)}
          />
        )}
      </div>

      {/* rows */}
      {isLoading && !milestones ? (
        <div className="flex flex-col gap-2 px-page-x py-4">
          {Array.from({ length: 3 }).map((_, index) => (
            // oxlint-disable-next-line react/no-array-index-key
            <div key={index} className="h-10 animate-pulse rounded-md bg-layer-1" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center px-page-x py-16">
          <EmptyStateCompact
            title={hasFilters ? "No milestones match these filters" : "No milestones yet"}
            description={
              hasFilters
                ? "Try a different name, project or status."
                : "Milestones of every project you can see show up here. Turn milestones on in a project's Settings › Features, then add one."
            }
            assetKey={hasFilters ? "search-compact" : "project"}
            assetClassName="size-20"
            align="center"
            actions={
              hasFilters || !canCreate ? undefined : [{ label: "Add milestone", onClick: () => setCreateOpen(true) }]
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-body-xs-regular text-primary">
            <thead>
              <tr className="border-b-[0.5px] border-subtle">
                <th className={`${HEAD_CLASSNAME} pl-page-x`}>Phase / Release / Milestone</th>
                <th className={HEAD_CLASSNAME}>Related to</th>
                <th className={HEAD_CLASSNAME}>Status</th>
                <th className={HEAD_CLASSNAME}>Assigned to</th>
                <th className={HEAD_CLASSNAME}>Start date</th>
                <th className={HEAD_CLASSNAME}>End date</th>
                <th className={`${HEAD_CLASSNAME} text-right`}>Progress</th>
                <th className="w-10 pr-page-x" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((milestone) => {
                const project = getProjectById(milestone.project_id);
                const { canOpen, canEdit, canDelete } = rowAccess(milestone.project_id);
                return (
                  <tr key={milestone.id} className="border-b-[0.5px] border-subtle hover:bg-layer-transparent-hover">
                    <td className={`${CELL_CLASSNAME} pl-page-x`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <MilestoneProgressIcon milestone={milestone} />
                        {/* the project's own page for its members; a read-only page for everyone else */}
                        <Link
                          href={
                            canOpen
                              ? `/${workspaceSlug}/projects/${milestone.project_id}/milestones/${milestone.id}`
                              : `/${workspaceSlug}/milestones/${milestone.id}`
                          }
                          className="truncate text-body-sm-medium hover:underline"
                        >
                          {milestone.title}
                        </Link>
                      </span>
                    </td>
                    <td className={CELL_CLASSNAME}>
                      <span className="flex min-w-0 items-center gap-1.5">
                        {project?.logo_props && <Logo logo={project.logo_props} size={14} />}
                        <span className="truncate">{project?.name ?? (milestone.project_name || "—")}</span>
                      </span>
                    </td>
                    <td className={CELL_CLASSNAME}>
                      {milestone.status ? (
                        <MilestoneStatusBadge status={milestone.status} />
                      ) : (
                        <span className="text-placeholder">—</span>
                      )}
                    </td>
                    <td className={CELL_CLASSNAME}>
                      <MilestoneAssignee userId={milestone.assigned_to_id} />
                    </td>
                    <td className={`${CELL_CLASSNAME} whitespace-nowrap text-secondary`}>
                      {dateCell(milestone.start_date)}
                    </td>
                    <td className={`${CELL_CLASSNAME} whitespace-nowrap text-secondary`}>
                      {dateCell(milestone.target_date)}
                    </td>
                    <td
                      className={`${CELL_CLASSNAME} text-right whitespace-nowrap text-secondary tabular-nums`}
                      title={`${milestone.completed_items} of ${milestone.total_items} project tasks done`}
                    >
                      {milestone.progress}% · {milestone.completed_items}/{milestone.total_items}
                    </td>
                    <td className={`${CELL_CLASSNAME} pr-page-x`}>
                      {(canEdit || canDelete) && (
                        <Menu>
                          <MenuTrigger
                            render={
                              <IconButton
                                variant="ghost"
                                size="sm"
                                icon={<Icon icon={MoreHorizontalOutline} />}
                                aria-label={`${milestone.title} options`}
                              />
                            }
                          />
                          <MenuContent side="bottom" align="end">
                            {canEdit && (
                              <MenuItem
                                label="Edit"
                                icon={<Icon icon={EditOutline} />}
                                onClick={() => setEditing(milestone)}
                              />
                            )}
                            {canDelete && (
                              <MenuItem
                                label="Delete"
                                icon={<Icon icon={DeleteOutline} />}
                                onClick={() => setDeleting(milestone)}
                              />
                            )}
                          </MenuContent>
                        </Menu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MilestoneFormModal
        open={createOpen || !!editing}
        workspaceSlug={workspaceSlug}
        projectId={editing?.project_id ?? ""}
        milestone={editing}
        onClose={(saved) => {
          setCreateOpen(false);
          setEditing(null);
          if (saved) void mutate();
        }}
      />
      <DeleteMilestoneModal
        open={!!deleting}
        workspaceSlug={workspaceSlug}
        projectId={deleting?.project_id ?? ""}
        milestone={deleting}
        onClose={(deleted) => {
          setDeleting(null);
          if (deleted) void mutate();
        }}
      />
    </div>
  );
});
