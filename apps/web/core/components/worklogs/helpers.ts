/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
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

export const getWorklogUserName = (user: { display_name: string; first_name?: string; last_name?: string }) =>
  user.display_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();

export const issueWorklogsKey = (issueId: string) => `ISSUE_WORKLOGS_${issueId}`;

export const worklogTimerKey = (workspaceSlug: string) => `WORKLOG_TIMER_${workspaceSlug}`;

const pad = (value: number) => String(value).padStart(2, "0");

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
