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
  start_date: string | null;
  /** "End date" on the form */
  target_date: string | null;
  actual_completion_date: string | null;
  /** "" when not set */
  milestone_type: string;
  status: string;
  /** required for new milestones; older ones may have nobody */
  assigned_to_id: string | null;
  total_items: number;
  completed_items: number;
  /** 0-100, share of linked work items in a Completed or Cancelled state */
  progress: number;
  created_at: string;
  updated_at: string;
  /** the workspace list only: for projects the person can't open */
  project_name?: string;
};

export type TMilestonePayload = {
  title?: string;
  description_html?: string;
  start_date?: string | null;
  target_date?: string | null;
  actual_completion_date?: string | null;
  milestone_type?: string;
  status?: string;
  assigned_to_id?: string | null;
};

/** Picklist values, served by the API so both sides accept the same ones. */
export type TMilestoneOptions = {
  milestone_type: string[];
  status: string[];
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

/** One milestone of the Project Milestones page, read-only: also for people who aren't in its project. */
export type TWorkspaceMilestone = TMilestone & {
  project_name: string;
  /** only the linked project tasks the person may see; the counts cover all of them */
  work_items: TMilestoneWorkItem[];
};
