/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useSWRConfig } from "swr";
// plane imports
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { WarningTriangleOutline, CalendarOutline, CloseOutline } from "@makeplane/propel/icons";
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
  workItemMilestoneKey,
} from "../helpers";
import type { TMilestone } from "../types";
import { LinkWorkItemsModal } from "./link-work-items-modal";

type Props = {
  workspaceSlug: string;
  projectId: string;
  milestoneId: string;
  canEdit: boolean;
  linkOpen: boolean;
  onLinkOpenChange: (open: boolean) => void;
};

export const MilestoneDetail = observer(function MilestoneDetail(props: Props) {
  const { workspaceSlug, projectId, milestoneId, canEdit, linkOpen, onLinkOpenChange } = props;
  const { milestone, mutate: mutateMilestone, error } = useMilestone(workspaceSlug, projectId, milestoneId);
  const { workItems, mutate: mutateItems, isLoading } = useMilestoneWorkItems(workspaceSlug, projectId, milestoneId);
  const { mutate } = useSWRConfig();

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
      setToast({ type: "error", title: "Work item not removed", message: data.error ?? "Please try again." });
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
          <h3 className="text-h4-medium text-primary">{milestone.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-xs-regular text-secondary">
          <span>
            <span className="font-medium text-primary">{milestone.progress}%</span> complete ·{" "}
            {milestone.completed_items} of {milestone.total_items} work items done
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarOutline className="size-3.5 text-tertiary" />
            {targetDate ? `Target ${renderFormattedDate(targetDate)}` : "No target date"}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-layer-1">
          <div className="h-full rounded-full bg-success-primary" style={{ width: `${milestone.progress}%` }} />
        </div>
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
          Work items <span className="text-tertiary">{workItems?.length ?? ""}</span>
        </h4>
        {isLoading && !workItems ? (
          <div className="m-4 h-10 animate-pulse rounded-md bg-layer-1" />
        ) : !workItems?.length ? (
          <div className="flex flex-col items-center py-10">
            <EmptyStateCompact
              title="No work items in this milestone"
              description="Link work items to track their progress toward the target date."
              assetKey="work-item"
              assetClassName="size-16"
              align="center"
              actions={canEdit ? [{ label: "Link work items", onClick: () => onLinkOpenChange(true) }] : undefined}
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
              <Link
                href={`/${workspaceSlug}/browse/${item.project_identifier}-${item.sequence_id}/`}
                className="min-w-0 flex-1 truncate text-body-xs-regular text-primary hover:underline"
              >
                {item.name}
              </Link>
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
    </div>
  );
});

function DueDate(props: { dueDate: string | null; milestone: TMilestone }) {
  const { dueDate, milestone } = props;
  const late = isDueAfterMilestone(dueDate, milestone);
  return (
    <span className="flex w-32 flex-shrink-0 items-center justify-end gap-1.5 text-caption-md-regular text-secondary">
      {late && (
        <Tooltip label="Due date is after the milestone's target date">
          <span className="flex text-warning-primary">
            <WarningTriangleOutline className="size-3.5" />
          </span>
        </Tooltip>
      )}
      {dueDate ? renderFormattedDate(dueDate) : <span className="text-placeholder">No due date</span>}
    </span>
  );
}
