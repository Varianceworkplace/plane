/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// plane imports
import { cn } from "@plane/utils";
// services
import { MilestoneService } from "@/services/milestone.service";
// local imports
import type { TMilestone } from "./types";

export const milestoneService = new MilestoneService();

export const projectMilestonesKey = (projectId: string) => `PROJECT_MILESTONES_${projectId}`;
export const milestoneKey = (milestoneId: string) => `MILESTONE_${milestoneId}`;
export const milestoneWorkItemsKey = (milestoneId: string) => `MILESTONE_WORK_ITEMS_${milestoneId}`;
export const workItemMilestoneKey = (issueId: string) => `WORK_ITEM_MILESTONE_${issueId}`;

export const useProjectMilestones = (workspaceSlug: string, projectId: string, enabled = true) => {
  const { data, mutate, isLoading } = useSWR(
    enabled && workspaceSlug && projectId ? projectMilestonesKey(projectId) : null,
    () => milestoneService.list(workspaceSlug, projectId)
  );
  return { milestones: data, mutate, isLoading };
};

export const useMilestone = (workspaceSlug: string, projectId: string, milestoneId: string) => {
  const { data, mutate, isLoading, error } = useSWR(
    workspaceSlug && projectId && milestoneId ? milestoneKey(milestoneId) : null,
    () => milestoneService.retrieve(workspaceSlug, projectId, milestoneId)
  );
  return { milestone: data, mutate, isLoading, error };
};

export const useMilestoneWorkItems = (workspaceSlug: string, projectId: string, milestoneId: string) => {
  const { data, mutate, isLoading } = useSWR(
    workspaceSlug && projectId && milestoneId ? milestoneWorkItemsKey(milestoneId) : null,
    () => milestoneService.workItems(workspaceSlug, projectId, milestoneId)
  );
  return { workItems: data, mutate, isLoading };
};

export const useWorkItemMilestone = (workspaceSlug: string, projectId: string, issueId: string, enabled = true) => {
  const { data, mutate, isLoading } = useSWR(
    enabled && workspaceSlug && projectId && issueId ? workItemMilestoneKey(issueId) : null,
    () => milestoneService.workItemMilestone(workspaceSlug, projectId, issueId)
  );
  return { milestone: data ?? null, mutate, isLoading };
};

/** "2026-11-01" -> local Date (no timezone shift) */
export const parseTargetDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** local Date -> "2026-11-01" */
export const toTargetDate = (date: Date | null): string | null => {
  if (!date) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** A work item's due date falls after its milestone's target date. */
export const isDueAfterMilestone = (dueDate: string | null | undefined, milestone: TMilestone | null | undefined) =>
  !!dueDate && !!milestone?.target_date && dueDate.slice(0, 10) > milestone.target_date;

type ProgressIconProps = { milestone: Pick<TMilestone, "progress" | "total_items" | "completed_items">; size?: number };

/** Grey when nothing is done, amber while in progress, green with a check when every item is done. */
export function MilestoneProgressIcon(props: ProgressIconProps) {
  const { milestone, size = 16 } = props;
  const allDone = milestone.total_items > 0 && milestone.completed_items === milestone.total_items;
  const started = milestone.completed_items > 0 && !allDone;
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const color = allDone ? "text-success-primary" : started ? "text-warning-primary" : "text-placeholder";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn("flex-shrink-0", color)}
      aria-label={`${milestone.progress}% complete`}
      role="img"
    >
      {allDone ? (
        <>
          <circle cx="8" cy="8" r="7.5" fill="currentColor" />
          <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
          <circle
            cx="8"
            cy="8"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray={`${(circumference * milestone.progress) / 100} ${circumference}`}
            transform="rotate(-90 8 8)"
          />
        </>
      )}
    </svg>
  );
}
