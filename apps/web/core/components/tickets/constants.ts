/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Field layout copied from the vTiger CRM 6.5 Ticket form (two-column grid, row by row).

export type TTicketFieldKind =
  | "text"
  | "textarea"
  | "richtext"
  | "status"
  | "priority"
  | "member"
  | "choice"
  | "readonly-creator";

export type TTicketFieldDef = {
  key: string;
  label: string;
  kind: TTicketFieldKind;
  required?: boolean;
  options?: "categories" | "tool_categories" | "trial_tested";
  maxLength?: number;
};

export type TTicketSection = {
  title: string;
  rows: (TTicketFieldDef | null)[][];
  fullWidth?: boolean;
};

export const TICKET_SECTIONS: TTicketSection[] = [
  {
    title: "Ticket Information",
    rows: [
      [
        { key: "name", label: "Title", kind: "text", required: true, maxLength: 255 },
        { key: "organization_name", label: "Organization Name", kind: "text", maxLength: 255 },
      ],
      [
        { key: "assignee_id", label: "Assigned To", kind: "member", required: true },
        { key: "priority", label: "Priority", kind: "priority" },
      ],
      [
        { key: "state_id", label: "Status", kind: "status", required: true },
        { key: "category", label: "Category", kind: "choice", options: "categories" },
      ],
      [
        { key: "created_by", label: "Creator", kind: "readonly-creator" },
        { key: "manager_id", label: "Manager", kind: "member", required: true },
      ],
    ],
  },
  {
    title: "Asset Requirement",
    rows: [
      [
        { key: "project_client_name", label: "Project Name / Client Name", kind: "text", maxLength: 255 },
        { key: "asset_name", label: "Asset name(Software/Hardware)", kind: "text", maxLength: 255 },
      ],
      [
        { key: "tool_website_url", label: "Tool Website URL", kind: "text", maxLength: 1000 },
        { key: "tool_category", label: "Tool Category", kind: "choice", options: "tool_categories" },
      ],
      [
        { key: "project_or_client", label: "Project or Client", kind: "text", maxLength: 255 },
        { key: "problem_resolved", label: "What Problem Resolved ?", kind: "textarea" },
      ],
      [
        { key: "current_handling", label: "How is the team currently handling this task witho", kind: "textarea" },
        { key: "process_inefficiency", label: "Why is the current process inefficient?", kind: "textarea" },
      ],
      [
        { key: "important_features", label: "Which features of this tool are most important for", kind: "textarea" },
        { key: "hours_saved", label: "Estimated hours saved per week/month?", kind: "textarea" },
      ],
      [
        { key: "business_impact", label: "Expected business impact", kind: "textarea" },
        { key: "measurable_outcome", label: "What measurable outcome do you expect?", kind: "textarea" },
      ],
      [
        { key: "roi_timeline", label: "Estimated ROI timeline", kind: "textarea" },
        { key: "not_approved_impact", label: "What happens if this tool is NOT approved?", kind: "textarea" },
      ],
      [
        { key: "cost", label: "Monthly / Yearly Cost", kind: "textarea" },
        { key: "licenses_required", label: "Number of licenses required", kind: "text", maxLength: 255 },
      ],
      [
        {
          key: "trial_tested",
          label: "Have you tested the free trial/demo?",
          kind: "choice",
          options: "trial_tested",
        },
        { key: "asset_months", label: "Asset months requirement", kind: "text", maxLength: 255 },
      ],
    ],
  },
  {
    title: "Description Details",
    fullWidth: true,
    rows: [[{ key: "description_html", label: "Description", kind: "richtext" }]],
  },
  {
    title: "Ticket Resolution",
    fullWidth: true,
    rows: [[{ key: "solution_html", label: "Solution", kind: "richtext" }]],
  },
];

// Summary card on the detail page (same order as the CRM)
export const TICKET_SUMMARY_FIELDS = [
  "name",
  "organization_name",
  "assignee",
  "priority",
  "state",
  "ticket_number",
  "created_by",
  "description_html",
] as const;

export const TICKET_LIST_COLUMNS = [
  { key: "title", label: "Title", searchKey: "title" },
  { key: "organization_name", label: "Organization Name", searchKey: "organization_name" },
  { key: "status", label: "Status", searchKey: "status" },
  { key: "priority", label: "Priority", searchKey: "priority" },
  { key: "assigned_to", label: "Assigned To", searchKey: "assigned_to" },
] as const;

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export const EMPTY_VALUE = "--";
