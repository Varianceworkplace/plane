/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import {
  CalendarOutline,
  DeleteOutline,
  EditOutline,
  MoreHorizontalOutline,
  SearchOutline,
} from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { DateSelect } from "@plane/blocks/property-select";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useUserProfile } from "@/hooks/store/user";
// local imports
import {
  MilestoneProgressIcon,
  milestoneService,
  parseTargetDate,
  toTargetDate,
  useProjectMilestones,
} from "../helpers";
import { DeleteMilestoneModal, MilestoneFormModal } from "../milestone-modals";
import type { TMilestone } from "../types";

type Props = {
  workspaceSlug: string;
  projectId: string;
  canEdit: boolean;
  /** "Add milestone" in the page header */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
};

export const MilestonesList = observer(function MilestonesList(props: Props) {
  const { workspaceSlug, projectId, canEdit, createOpen, onCreateOpenChange } = props;
  const { milestones, mutate, isLoading } = useProjectMilestones(workspaceSlug, projectId);
  const { data: userProfile } = useUserProfile();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TMilestone | null>(null);
  const [deleting, setDeleting] = useState<TMilestone | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (milestones ?? []).filter((m) => !query || m.title.toLowerCase().includes(query));
  }, [milestones, search]);

  const updateDate = async (milestone: TMilestone, date: Date | null) => {
    try {
      await milestoneService.update(workspaceSlug, projectId, milestone.id, { target_date: toTargetDate(date) });
      await mutate();
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      setToast({ type: "error", title: "Target date not changed", message: data.error ?? "Please try again." });
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* toolbar */}
      <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-subtle px-page-x py-2.5">
        <span className="text-body-sm-medium text-primary">
          Milestones <span className="text-tertiary">{milestones?.length ?? ""}</span>
        </span>
        <div className="w-60">
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
            title={search ? "No milestones match your search" : "No milestones yet"}
            description={
              search
                ? "Try a different name."
                : "Set shared target dates and group work items under them, like a beta release or a launch."
            }
            assetKey={search ? "search-compact" : "project"}
            assetClassName="size-20"
            align="center"
            actions={
              !search && canEdit ? [{ label: "Add milestone", onClick: () => onCreateOpenChange(true) }] : undefined
            }
          />
        </div>
      ) : (
        <div className="flex flex-col">
          {filtered.map((milestone) => (
            <div
              key={milestone.id}
              className="group flex items-center gap-3 border-b-[0.5px] border-subtle px-page-x py-2.5 hover:bg-layer-transparent-hover"
            >
              <MilestoneProgressIcon milestone={milestone} />
              <Link
                href={`/${workspaceSlug}/projects/${projectId}/milestones/${milestone.id}`}
                className="min-w-0 flex-1 truncate text-body-sm-medium text-primary hover:underline"
              >
                {milestone.title}
              </Link>
              <span
                className="w-28 flex-shrink-0 text-right text-caption-md-regular text-secondary tabular-nums"
                title={`${milestone.completed_items} of ${milestone.total_items} work items done`}
              >
                {milestone.progress}% · {milestone.completed_items}/{milestone.total_items}
              </span>
              <div className="flex w-40 flex-shrink-0 justify-end">
                <DateSelect
                  variant="pill-md"
                  value={parseTargetDate(milestone.target_date)}
                  onChange={(date) => void updateDate(milestone, date)}
                  placeholder="Target date"
                  icon={<CalendarOutline />}
                  clearable
                  disabled={!canEdit}
                  weekStartsOn={userProfile?.start_of_the_week}
                />
              </div>
              {canEdit ? (
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
                    <MenuItem label="Edit" icon={<Icon icon={EditOutline} />} onClick={() => setEditing(milestone)} />
                    <MenuItem
                      label="Delete"
                      icon={<Icon icon={DeleteOutline} />}
                      onClick={() => setDeleting(milestone)}
                    />
                  </MenuContent>
                </Menu>
              ) : (
                <span className="w-7" />
              )}
            </div>
          ))}
        </div>
      )}

      <MilestoneFormModal
        open={createOpen || !!editing}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        milestone={editing}
        onClose={(saved) => {
          onCreateOpenChange(false);
          setEditing(null);
          if (saved) void mutate();
        }}
      />
      <DeleteMilestoneModal
        open={!!deleting}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        milestone={deleting}
        onClose={(deleted) => {
          setDeleting(null);
          if (deleted) void mutate();
        }}
      />
    </div>
  );
});
