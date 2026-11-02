/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useSWRConfig } from "swr";
// plane imports
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { MilestoneOutline, WarningTriangleOutline } from "@makeplane/propel/icons";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import {
  MilestoneProgressIcon,
  isDueAfterMilestone,
  milestoneKey,
  milestoneService,
  milestoneWorkItemsKey,
  projectMilestonesKey,
  useProjectMilestones,
  useWorkItemMilestone,
} from "./helpers";
import type { TMilestone } from "./types";

type TOption = { id: string; title: string; milestone: TMilestone | null };
const NONE: TOption = { id: "", title: "No milestone", milestone: null };

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  /** the work item's due date, for the "due after target date" warning */
  dueDate: string | null | undefined;
  disabled?: boolean;
};

/** "Milestone" property of a work item (sidebar). Picking another milestone moves the work item. */
export const WorkItemMilestoneSelect = observer(function WorkItemMilestoneSelect(props: Props) {
  const { workspaceSlug, projectId, issueId, dueDate, disabled = false } = props;
  const { allowPermissions } = useUserPermissions();
  const canEdit =
    !disabled &&
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug,
      projectId
    );
  const { milestone, mutate } = useWorkItemMilestone(workspaceSlug, projectId, issueId);
  const { milestones } = useProjectMilestones(workspaceSlug, projectId, canEdit);
  const { mutate: globalMutate } = useSWRConfig();
  const {
    activity: { fetchActivities },
  } = useIssueDetail();
  const [saving, setSaving] = useState(false);

  const options: TOption[] = [NONE, ...(milestones ?? []).map((m) => ({ id: m.id, title: m.title, milestone: m }))];
  const selected = milestone ? { id: milestone.id, title: milestone.title, milestone } : null;
  const late = isDueAfterMilestone(dueDate, milestone);

  const change = async (milestoneId: string) => {
    if (saving || (milestone?.id ?? "") === milestoneId) return;
    setSaving(true);
    const previous = milestone?.id;
    try {
      const updated = await milestoneService.setWorkItemMilestone(
        workspaceSlug,
        projectId,
        issueId,
        milestoneId || null
      );
      await mutate(updated, { revalidate: false });
      // show the "added to / moved / removed from milestone" entry in the activity feed
      void fetchActivities(workspaceSlug, projectId, issueId);
      void globalMutate(projectMilestonesKey(projectId));
      [previous, milestoneId].filter(Boolean).forEach((id) => {
        void globalMutate(milestoneKey(id as string));
        void globalMutate(milestoneWorkItemsKey(id as string));
      });
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      setToast({ type: "error", title: "Milestone not changed", message: data.error ?? "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full w-full grow items-center gap-1">
      <Select<TOption>
        getValues={() => options}
        value={selected}
        onChange={(id) => void change(id)}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => option.title}
        getOptionIcon={(option) =>
          option.milestone ? (
            <MilestoneProgressIcon milestone={option.milestone} size={14} />
          ) : (
            <MilestoneOutline className="size-3.5 text-tertiary" />
          )
        }
        showSearch
        searchPlaceholder="Search milestones"
        disabled={!canEdit || saving}
      >
        <Select.Trigger variant="select-ghost-md" className="w-full">
          <span className="flex min-w-0 grow items-center gap-1.5 truncate text-left">
            {milestone ? (
              <>
                <MilestoneProgressIcon milestone={milestone} size={14} />
                <span className="truncate">{milestone.title}</span>
              </>
            ) : (
              <span className="text-placeholder">No milestone</span>
            )}
          </span>
        </Select.Trigger>
      </Select>
      {late && (
        <Tooltip label="Due date is after the milestone's target date">
          <span className="flex flex-shrink-0 text-warning-primary">
            <WarningTriangleOutline className="size-3.5" />
          </span>
        </Tooltip>
      )}
    </div>
  );
});
