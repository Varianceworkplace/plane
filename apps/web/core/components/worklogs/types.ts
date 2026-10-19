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
  elapsed_seconds: number;
  /** minutes that will be logged */
  duration: number;
  server_now: string;
};

export type TWorklogPayload = {
  duration?: number;
  description?: string;
};

export type TWorkspaceWorklogFilters = {
  logged_by: string[];
  project: string[];
  /** ISO datetime, inclusive */
  start?: string;
  /** ISO datetime, exclusive */
  end?: string;
};

export type TWorkspaceWorklogResponse = {
  results: TWorklog[];
  total_count: number;
  total_duration: number;
  page: number;
  per_page: number;
};
