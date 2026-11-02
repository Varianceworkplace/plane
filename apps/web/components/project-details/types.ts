/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** The Workplace "Creating New Project" fields of a project that Plane has no field for. */
export type TProjectDetail = {
  /** YYYY-MM-DD */
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  estimated_hours: number | null;
  project_type: string;
  status: string;
  related_to: string;
  customer_name: string;
  user_manual_url: string;
  salesforce_org_id: string;
  project_url: string;
  /** percent, in steps of 10 */
  progress: number | null;
};

/** Picklist values, served by the API so both sides accept the same ones. */
export type TProjectDetailOptions = {
  project_type: string[];
  status: string[];
  progress: number[];
};

/** What the form edits: like TProjectDetail, but the hours are kept as typed. */
export type TProjectDetailFormValues = Omit<TProjectDetail, "estimated_hours"> & { estimated_hours: string };

export type TProjectDetailFormKey = keyof TProjectDetailFormValues | "project_lead";

export type TProjectDetailFormErrors = Partial<Record<TProjectDetailFormKey, string>>;
