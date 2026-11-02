/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import type { ScopedMutator } from "swr";
// plane imports
import { renderFormattedDate, renderFormattedTime } from "@plane/utils";
// services
import { WorklogService } from "@/services/worklog.service";

export const worklogService = new WorklogService();

/** 90 -> "1h 30m", 60 -> "1h", 15 -> "15m" */
export const formatWorklogDuration = (minutes: number | null | undefined): string => {
  const total = Math.max(0, Math.round(minutes ?? 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
};

/**
 * "Oct 27, 2026, 09:00 AM – 12:30 PM", or with both dates when the work ran over several days.
 * Dates are read in local time (the ISO string's own date is UTC).
 */
export const formatWorklogSpan = (startedAt: string, endedAt: string): string => {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const startDate = renderFormattedDate(start);
  const endDate = renderFormattedDate(end);
  const startTime = renderFormattedTime(start, "12-hour");
  const endTime = renderFormattedTime(end, "12-hour");
  return startDate === endDate
    ? `${startDate}, ${startTime} – ${endTime}`
    : `${startDate}, ${startTime} – ${endDate}, ${endTime}`;
};

export const getWorklogUserName = (user: { display_name: string; first_name?: string; last_name?: string }) =>
  user.display_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();

export const issueWorklogsKey = (issueId: string) => `ISSUE_WORKLOGS_${issueId}`;

export const issueTimeEstimateKey = (issueId: string) => `ISSUE_TIME_ESTIMATE_${issueId}`;

export const projectTimeEstimatesKey = (projectId: string) => `PROJECT_TIME_ESTIMATES_${projectId}`;

/** After time is logged, changed or removed: refresh the work item's worklogs and its project's totals. */
export const refreshWorkItemTime = (mutate: ScopedMutator, projectId: string, issueId: string) =>
  Promise.all([
    mutate(issueWorklogsKey(issueId)),
    mutate(issueTimeEstimateKey(issueId)),
    mutate(projectTimeEstimatesKey(projectId)),
  ]);

export const worklogTimerKey = (workspaceSlug: string) => `WORKLOG_TIMER_${workspaceSlug}`;

export const pad = (value: number) => String(value).padStart(2, "0");

/** An hours or minutes field as a number: "" -> 0, anything not numeric -> NaN */
export const toNumber = (value: string) => (value.trim() === "" ? 0 : Number(value));

/** 3725 -> "01:02:05" */
export const formatTimerClock = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
};

/** The member's own timer; re-checked on focus so other tabs stay in sync. */
export const useWorklogTimer = (workspaceSlug: string, enabled = true) => {
  const { data, mutate, isLoading } = useSWR(
    enabled && workspaceSlug ? worklogTimerKey(workspaceSlug) : null,
    () => worklogService.getTimer(workspaceSlug),
    { revalidateOnFocus: true }
  );
  return { timer: data ?? null, mutate, isLoading };
};

export const useIssueWorklogs = (workspaceSlug: string, projectId: string, issueId: string, enabled = true) => {
  const { data, error, mutate, isLoading } = useSWR(
    enabled && workspaceSlug && projectId && issueId ? issueWorklogsKey(issueId) : null,
    () => worklogService.list(workspaceSlug, projectId, issueId),
    { revalidateOnFocus: false }
  );
  return { worklogs: data, error, mutate, isLoading };
};

export const useIssueTimeEstimate = (workspaceSlug: string, projectId: string, issueId: string, enabled = true) => {
  const { data, mutate, isLoading } = useSWR(
    enabled && workspaceSlug && projectId && issueId ? issueTimeEstimateKey(issueId) : null,
    () => worklogService.getTimeEstimate(workspaceSlug, projectId, issueId),
    { revalidateOnFocus: false }
  );
  return { estimate: data, mutate, isLoading };
};

/** One request per project, shared by every list row of it. */
export const useProjectTimeEstimates = (workspaceSlug: string, projectId: string, enabled = true) => {
  const { data } = useSWR(
    enabled && workspaceSlug && projectId ? projectTimeEstimatesKey(projectId) : null,
    () => worklogService.projectTimeEstimates(workspaceSlug, projectId),
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );
  return data;
};
