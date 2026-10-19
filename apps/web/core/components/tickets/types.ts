/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TTicketUser = {
  id: string;
  display_name: string;
  name: string;
  avatar_url?: string | null;
};

export type TTicketStatus = {
  id: string;
  name: string;
  color: string;
  group: string;
  default?: boolean;
};

export type TTicketPriority = "low" | "medium" | "high" | "urgent" | "none";

export type TTicketTextField =
  | "organization_name"
  | "project_client_name"
  | "asset_name"
  | "tool_website_url"
  | "project_or_client"
  | "problem_resolved"
  | "current_handling"
  | "process_inefficiency"
  | "important_features"
  | "hours_saved"
  | "business_impact"
  | "measurable_outcome"
  | "roi_timeline"
  | "not_approved_impact"
  | "cost"
  | "licenses_required"
  | "asset_months";

export type TTicketChoiceField = "category" | "tool_category" | "trial_tested";

export type TTicket = {
  id: string;
  issue_id: string;
  ticket_number: string;
  sequence_id: number;
  name: string;
  state: TTicketStatus | null;
  priority: TTicketPriority;
  priority_label: string | null;
  assignee: TTicketUser | null;
  created_by: TTicketUser | null;
  updated_by?: TTicketUser | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  manager?: TTicketUser | null;
  description_html?: string;
  solution_html?: string;
} & Partial<Record<TTicketTextField, string>> &
  Partial<Record<TTicketChoiceField, string | null>>;

export type TTicketPayload = Partial<
  {
    name: string;
    assignee_id: string | null;
    manager_id: string | null;
    state_id: string | null;
    priority: TTicketPriority | null;
    description_html: string;
    solution_html: string;
  } & Record<TTicketTextField, string> &
    Record<TTicketChoiceField, string | null>
>;

export type TTicketMeta = {
  statuses: TTicketStatus[];
  priorities: { value: TTicketPriority; label: string }[];
  categories: string[];
  tool_categories: string[];
  trial_tested: string[];
  filters: { key: string; label: string }[];
  members: TTicketUser[];
  current_user: TTicketUser;
  field_labels: Record<string, string>;
};

export type TTicketListParams = {
  filter?: string;
  title?: string;
  organization_name?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
  search?: string;
  alphabet?: string;
  order_by?: string;
  page?: number;
  per_page?: number;
};

export type TTicketListResponse = {
  results: TTicket[];
  total: number;
  page: number;
  per_page: number;
};

export type TTicketComment = {
  id: string;
  parent_id: string | null;
  comment_html: string;
  actor: TTicketUser | null;
  created_at: string;
  edited_at: string | null;
  can_edit: boolean;
};

export type TTicketHistory = {
  id: string;
  verb: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: TTicketUser | null;
  created_at: string;
};

export type TTicketAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  created_by: TTicketUser | null;
  created_at: string;
};
