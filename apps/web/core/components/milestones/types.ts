/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TMilestone = {
  id: string;
  project_id: string;
  title: string;
  description_html: string;
  /** YYYY-MM-DD */
  target_date: string | null;
  total_items: number;
  completed_items: number;
  /** 0-100, share of linked work items in a Completed or Cancelled state */
  progress: number;
  created_at: string;
  updated_at: string;
};

export type TMilestonePayload = {
  title?: string;
  description_html?: string;
  target_date?: string | null;
};

export type TMilestoneWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_identifier: string;
  priority: string | null;
  start_date: string | null;
  target_date: string | null;
  state: { id: string; name: string; group: string; color: string } | null;
  assignee_ids: string[];
};
