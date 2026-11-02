/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TWorklogUser = {
  id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
};

export type TWorklog = {
  id: string;
  /** minutes */
  duration: number;
  description: string;
  logged_by: TWorklogUser;
  issue: { id: string; name: string; sequence_id: number };
  project: { id: string; name: string; identifier: string };
  /** set for entries recorded with the start / stop timer */
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The signed-in member's start / stop timer (one per workspace). */
export type TWorklogTimer = {
  id: string;
  issue: { id: string; name: string; sequence_id: number };
  project: { id: string; name: string; identifier: string };
  started_at: string;
  /** set once Stop is pressed; the timer then waits for its note */
  stopped_at: string | null;
  is_running: boolean;
  /** time on the timer, less any time it stood stopped before a Discard */
  elapsed_seconds: number;
  /** time it stood stopped before a Discard; it never counts */
  paused_seconds: number;
  /** minutes that will be logged */
  duration: number;
  server_now: string;
};

/** Expected vs worked time on a work item. Minutes throughout. */
export type TWorkItemTimeEstimate = {
  /** null until someone sets it */
  expected_duration: number | null;
  worked_duration: number;
  worklog_count: number;
  /** minutes past the expected time, 0 while within it */
  over_by: number;
  /** why the work went past the expected time */
  overdue_reason: string;
};

export type TWorkItemTimeEstimatePayload = {
  /** null clears the estimate */
  expected_duration?: number | null;
  overdue_reason?: string;
};

export type TWorklogPayload = {
  duration?: number;
  description?: string;
  /** ISO datetimes: when the work started and finished */
  started_at?: string;
  ended_at?: string;
};
