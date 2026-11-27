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
// local imports
import type { TWorkItemTimeEstimate } from "./types";

export const worklogService = new WorklogService();

/** Minutes, to the second: 90 -> "1h 30m", 60 -> "1h", 15 -> "15m", 0.1 -> "6s", 1.1 -> "1m 6s" (timers save
 * exactly what they ran; seconds show only when there are any). */
export const formatWorklogDuration = (minutes: number | null | undefined): string => {
  const total = Math.max(0, Math.round((minutes ?? 0) * 60));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (mins || (hours && secs)) parts.push(`${mins}m`);
  if (secs) parts.push(`${secs}s`);
  return parts.join(" ") || "0m";
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

/** A list row's expected vs worked time (null: neither an estimate nor logged time). */
export const rowTimeEstimateKey = (issueId: string) => `ROW_TIME_ESTIMATE_${issueId}`;

/** Sidebar › Projects order; the timer's state is part of the key, so starting, stopping or saving it reloads it. */
export const MY_ACTIVE_PROJECTS_KEY = "MY_ACTIVE_PROJECTS_";
export const myActiveProjectsKey = (workspaceSlug: string, timerState: string) =>
  `${MY_ACTIVE_PROJECTS_KEY}${workspaceSlug}_${timerState}`;

/** After time is logged, changed or removed: refresh the work item's worklogs, its totals and its list row. */
export const refreshWorkItemTime = (mutate: ScopedMutator, issueId: string) =>
  Promise.all([
    mutate(issueWorklogsKey(issueId)),
    mutate(issueTimeEstimateKey(issueId)),
    mutate(rowTimeEstimateKey(issueId)),
    // logging time on a project moves it up the sidebar
    mutate((key) => typeof key === "string" && key.startsWith(MY_ACTIVE_PROJECTS_KEY)),
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

// ------------------------------------------------------------ list rows: one request for the rows on screen

/** work items per request (their ids fit comfortably in the address) */
const ROW_BATCH_SIZE = 100;
/** how long to gather the rows that render together before asking */
const ROW_BATCH_WAIT_MS = 30;

type TRowWaiter = { resolve: (estimate: TWorkItemTimeEstimate | null) => void; reject: (error: unknown) => void };
/** workspace -> work item -> the rows waiting for it */
const queuedRows = new Map<string, Map<string, TRowWaiter[]>>();
let rowBatchTimer: ReturnType<typeof setTimeout> | undefined;

const askForQueuedRows = () => {
  rowBatchTimer = undefined;
  const queued = [...queuedRows.entries()];
  queuedRows.clear();
  queued.forEach(([workspaceSlug, waiting]) => {
    const issueIds = [...waiting.keys()];
    for (let start = 0; start < issueIds.length; start += ROW_BATCH_SIZE) {
      const batch = issueIds.slice(start, start + ROW_BATCH_SIZE);
      worklogService.timeEstimatesFor(workspaceSlug, batch).then(
        (found) => batch.forEach((id) => waiting.get(id)?.forEach((row) => row.resolve(found[id] ?? null))),
        (error: unknown) => batch.forEach((id) => waiting.get(id)?.forEach((row) => row.reject(error)))
      );
    }
  });
};

/** One work item's row totals, asked for together with every other row that renders within a moment of it. */
const loadRowTimeEstimate = (workspaceSlug: string, issueId: string) =>
  new Promise<TWorkItemTimeEstimate | null>((resolve, reject) => {
    const waiting = queuedRows.get(workspaceSlug) ?? new Map<string, TRowWaiter[]>();
    queuedRows.set(workspaceSlug, waiting);
    waiting.set(issueId, [...(waiting.get(issueId) ?? []), { resolve, reject }]);
    rowBatchTimer ??= setTimeout(askForQueuedRows, ROW_BATCH_WAIT_MS);
  });

/**
 * A list row's expected vs worked time. The rows on screen are fetched in one request (across projects), instead of
 * one request per project with every work item of it; a row seen in the last minute isn't asked for again.
 */
export const useRowTimeEstimate = (workspaceSlug: string, issueId: string, enabled = true) => {
  const { data } = useSWR(
    enabled && workspaceSlug && issueId ? rowTimeEstimateKey(issueId) : null,
    () => loadRowTimeEstimate(workspaceSlug, issueId),
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  return data ?? undefined;
};
