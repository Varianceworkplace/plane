/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useSWRConfig } from "swr";
// plane imports
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { WarningTriangleOutline, CalendarOutline, CloseOutline, EditOutline } from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { StateGroupIcon } from "@plane/blocks/icons";
import { setToast } from "@plane/blocks/toast";
import type { TStateGroups } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
// components
import { TicketRichTextField as RichTextField } from "@/components/tickets/rich-text-field";
// local imports
import {
  MilestoneProgressIcon,
  isDueAfterMilestone,
  milestoneService,
  parseTargetDate,
  projectMilestonesKey,
  useMilestone,
  useMilestoneWorkItems,
  useWorkspaceMilestone,
  workItemMilestoneKey,
} from "../helpers";
import { MilestoneDetailsGrid } from "../milestone-fields";
import { MilestoneFormModal } from "../milestone-modals";
import type { TMilestone } from "../types";
import { LinkWorkItemsModal } from "./link-work-items-modal";

type Props = {
  workspaceSlug: string;
  projectId: string;
  milestoneId: string;
  canEdit: boolean;
  linkOpen: boolean;
  onLinkOpenChange: (open: boolean) => void;
  /**
   * Opened from the Project Milestones page by someone who isn't in its project: read-only, from the workspace
   * endpoint, with only the linked project tasks they may see (`projectId` is then unused).
   */
  readOnly?: boolean;
};

export const MilestoneDetail = observer(function MilestoneDetail(props: Props) {
  const { workspaceSlug, projectId, milestoneId, linkOpen, onLinkOpenChange, readOnly = false } = props;
  const canEdit = props.canEdit && !readOnly;
  // one of the two sources fetches; the other gets no project / milestone id and stays idle
  const fromWorkspace = useWorkspaceMilestone(workspaceSlug, readOnly ? milestoneId : "");
  const fromProject = useMilestone(workspaceSlug, readOnly ? "" : projectId, milestoneId);
  const projectItems = useMilestoneWorkItems(workspaceSlug, readOnly ? "" : projectId, milestoneId);
  const { mutate: mutateMilestone } = fromProject;
  const { mutate: mutateItems } = projectItems;
  const milestone = readOnly ? fromWorkspace.milestone : fromProject.milestone;
  const error = readOnly ? fromWorkspace.error : fromProject.error;
  const workItems = readOnly ? fromWorkspace.milestone?.work_items : projectItems.workItems;
  const isLoading = readOnly ? fromWorkspace.isLoading : projectItems.isLoading;
  // linked project tasks this person can't see are counted in the progress but not listed
  const hiddenItems = readOnly && milestone && workItems ? milestone.total_items - workItems.length : 0;
  const { mutate } = useSWRConfig();
  const [editOpen, setEditOpen] = useState(false);

  const refresh = async (changedIssueIds: string[] = []) => {
    await Promise.all([mutateMilestone(), mutateItems(), mutate(projectMilestonesKey(projectId))]);
    changedIssueIds.forEach((id) => void mutate(workItemMilestoneKey(id)));
  };

  const unlink = async (issueId: string) => {
    try {
      await milestoneService.linkWorkItems(workspaceSlug, projectId, milestoneId, { remove: [issueId] });
      await refresh([issueId]);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      setToast({ type: "error", title: "Project task not removed", message: data.error ?? "Please try again." });
    }
  };

  if (error) return <p className="px-page-x py-10 text-body-sm-regular text-tertiary">Milestone not found.</p>;
  if (!milestone) return <div className="m-page-x h-24 animate-pulse rounded-md bg-layer-1" />;

  const targetDate = parseTargetDate(milestone.target_date);

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-page-x py-6">
      {/* summary */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <MilestoneProgressIcon milestone={milestone} size={20} />
          <h3 className="min-w-0 flex-1 truncate text-h4-medium text-primary">{milestone.title}</h3>
          {canEdit && (
            <IconButton
              variant="ghost"
              size="sm"
              icon={<Icon icon={EditOutline} />}
              aria-label="Edit milestone"
              onClick={() => setEditOpen(true)}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-xs-regular text-secondary">
          <span>
            <span className="font-medium text-primary">{milestone.progress}%</span> complete ·{" "}
            {milestone.completed_items} of {milestone.total_items} project tasks done
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarOutline className="size-3.5 text-tertiary" />
            {targetDate ? `Ends ${renderFormattedDate(targetDate)}` : "No end date"}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-layer-1">
          <div className="h-full rounded-full bg-success-primary" style={{ width: `${milestone.progress}%` }} />
        </div>
        <MilestoneDetailsGrid milestone={milestone} />
        {milestone.description_html && milestone.description_html !== "<p></p>" && (
          <RichTextField
            id={`milestone-description-view-${milestone.id}-${milestone.updated_at}`}
            workspaceSlug={workspaceSlug}
            value={milestone.description_html}
            editable={false}
          />
        )}
      </div>

      {/* linked work items */}
      <section className="rounded-lg border-[0.5px] border-subtle">
        <h4 className="border-b-[0.5px] border-subtle px-4 py-3 text-body-sm-medium text-primary">
          Project tasks <span className="text-tertiary">{workItems?.length ?? ""}</span>
          {hiddenItems > 0 && (
            <span className="ml-2 text-caption-md-regular text-tertiary">
              {hiddenItems} more {hiddenItems === 1 ? "isn't" : "aren't"} shown: only project tasks you can see are
              listed
            </span>
          )}
        </h4>
        {isLoading && !workItems ? (
          <div className="m-4 h-10 animate-pulse rounded-md bg-layer-1" />
        ) : !workItems?.length ? (
          <div className="flex flex-col items-center py-10">
            <EmptyStateCompact
              title={hiddenItems > 0 ? "No project tasks you can see" : "No project tasks in this milestone"}
              description={
                readOnly
                  ? "Its progress above still counts every linked project task."
                  : "Link project tasks to track their progress toward the target date."
              }
              assetKey="work-item"
              assetClassName="size-16"
              align="center"
              actions={canEdit ? [{ label: "Link project tasks", onClick: () => onLinkOpenChange(true) }] : undefined}
            />
          </div>
        ) : (
          workItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 border-b-[0.5px] border-subtle px-4 py-2.5 last:border-b-0 hover:bg-layer-transparent-hover"
            >
              {item.state && (
                <Tooltip label={item.state.name}>
                  <span className="flex">
                    <StateGroupIcon stateGroup={item.state.group as TStateGroups} color={item.state.color} size="sm" />
                  </span>
                </Tooltip>
              )}
              <span className="w-20 flex-shrink-0 text-caption-md-regular text-tertiary">
                {item.project_identifier}-{item.sequence_id}
              </span>
              {readOnly ? (
                <span className="min-w-0 flex-1 truncate text-body-xs-regular text-primary">{item.name}</span>
              ) : (
                <Link
                  href={`/${workspaceSlug}/browse/${item.project_identifier}-${item.sequence_id}/`}
                  className="min-w-0 flex-1 truncate text-body-xs-regular text-primary hover:underline"
                >
                  {item.name}
                </Link>
              )}
              <DueDate dueDate={item.target_date} milestone={milestone} />
              {canEdit && (
                <Tooltip label="Remove from milestone">
                  <span className="flex">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={CloseOutline} />}
                      aria-label={`Remove ${item.name} from milestone`}
                      onClick={() => void unlink(item.id)}
                    />
                  </span>
                </Tooltip>
              )}
            </div>
          ))
        )}
      </section>

      {!readOnly && (
        <>
          <MilestoneFormModal
            open={editOpen}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            milestone={milestone}
            onClose={(saved) => {
              setEditOpen(false);
              if (saved) void refresh();
            }}
          />
          <LinkWorkItemsModal
            open={linkOpen}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            milestoneId={milestoneId}
            onClose={(linked) => {
              onLinkOpenChange(false);
              if (linked) void refresh();
            }}
          />
        </>
      )}
    </div>
  );
});

function DueDate(props: { dueDate: string | null; milestone: TMilestone }) {
  const { dueDate, milestone } = props;
  const late = isDueAfterMilestone(dueDate, milestone);
  return (
    <span className="flex w-32 flex-shrink-0 items-center justify-end gap-1.5 text-caption-md-regular text-secondary">
      {late && (
        <Tooltip label="Due date is after the milestone's end date">
          <span className="flex text-warning-primary">
            <WarningTriangleOutline className="size-3.5" />
          </span>
        </Tooltip>
      )}
      {dueDate ? renderFormattedDate(dueDate) : <span className="text-placeholder">No due date</span>}
    </span>
  );
}
