/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// plane imports
import { setToast } from "@plane/blocks/toast";
// services
import { ProjectDetailService } from "@/services/project-detail.service";
// local imports
import type {
  TProjectDetail,
  TProjectDetailFormErrors,
  TProjectDetailFormKey,
  TProjectDetailFormValues,
} from "./types";

export const projectDetailService = new ProjectDetailService();

export const EMPTY_PROJECT_DETAIL_FORM: TProjectDetailFormValues = {
  start_date: null,
  target_end_date: null,
  actual_end_date: null,
  estimated_hours: "",
  project_type: "",
  status: "",
  related_to: "",
  customer_name: "",
  user_manual_url: "",
  salesforce_org_id: "",
  project_url: "",
  progress: null,
};

/** Labels as on the Workplace "Creating New Project" form. */
export const PROJECT_DETAIL_LABELS: Record<TProjectDetailFormKey, string> = {
  project_lead: "Assigned to",
  start_date: "Start date",
  target_end_date: "Target end date",
  actual_end_date: "Actual end date",
  estimated_hours: "Estimated hours",
  project_type: "Type",
  status: "Status",
  related_to: "Related to",
  customer_name: "Customer name",
  user_manual_url: "User manual URL",
  salesforce_org_id: "Org ID (for Salesforce)",
  project_url: "Project URL",
  progress: "Progress",
};

/** The form's red stars, in the order they appear. "Project name" is checked by the name field itself. */
export const REQUIRED_PROJECT_DETAIL_FIELDS: TProjectDetailFormKey[] = [
  "project_lead",
  "start_date",
  "target_end_date",
  "project_type",
  "status",
  "customer_name",
  "user_manual_url",
];

const HOURS_PATTERN = /^\d+(\.\d{1,2})?$/;

export const toProjectDetailForm = (detail: TProjectDetail): TProjectDetailFormValues => ({
  ...detail,
  estimated_hours: detail.estimated_hours === null ? "" : String(detail.estimated_hours),
});

export const toProjectDetailPayload = (values: TProjectDetailFormValues): TProjectDetail => ({
  ...values,
  related_to: values.related_to.trim(),
  customer_name: values.customer_name.trim(),
  user_manual_url: values.user_manual_url.trim(),
  salesforce_org_id: values.salesforce_org_id.trim(),
  project_url: values.project_url.trim(),
  estimated_hours: values.estimated_hours.trim() === "" ? null : Number(values.estimated_hours),
});

/** Field -> message for what Save can't accept: empty required fields, end dates before the start, bad hours. */
export const validateProjectDetailForm = (
  values: TProjectDetailFormValues,
  projectLead: string | null | undefined
): TProjectDetailFormErrors => {
  const errors: TProjectDetailFormErrors = {};
  for (const key of REQUIRED_PROJECT_DETAIL_FIELDS) {
    const value = key === "project_lead" ? projectLead : values[key];
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === ""))
      errors[key] = `${PROJECT_DETAIL_LABELS[key]} is required`;
  }
  // dates are YYYY-MM-DD, so they compare as text
  if (values.start_date && values.target_end_date && values.target_end_date < values.start_date)
    errors.target_end_date = "Can't be before the start date";
  if (values.start_date && values.actual_end_date && values.actual_end_date < values.start_date)
    errors.actual_end_date = "Can't be before the start date";
  if (values.estimated_hours.trim() !== "" && !HOURS_PATTERN.test(values.estimated_hours.trim()))
    errors.estimated_hours = "Enter hours as a number, e.g. 120 or 37.5";
  return errors;
};

/** Toast naming every field Save flagged, then scroll to the first one. */
export const showProjectDetailErrors = (errors: TProjectDetailFormErrors) => {
  const keys = Object.keys(errors) as TProjectDetailFormKey[];
  if (!keys.length) return;
  const missing = keys.filter((key) => /is required/i.test(errors[key] ?? ""));
  const labels = (missing.length ? missing : keys).map((key) => PROJECT_DETAIL_LABELS[key]);
  setToast({
    type: "error",
    title: missing.length
      ? missing.length === 1
        ? "1 required field is empty"
        : `${missing.length} required fields are empty`
      : "Some fields need a fix",
    message: `${missing.length ? "Please fill in" : "Check"}: ${labels.join(", ")}. They're marked in red.`,
  });
  // bring the first one into view once the red outlines have rendered
  window.requestAnimationFrame(() =>
    document.querySelector("[data-project-detail-error]")?.scrollIntoView({ behavior: "smooth", block: "center" })
  );
};

/** The picklists hardly ever change: fetch them once per session. */
export const useProjectDetailOptions = (workspaceSlug: string) => {
  const { data } = useSWR(
    workspaceSlug ? `PROJECT_DETAIL_OPTIONS_${workspaceSlug}` : null,
    () => projectDetailService.options(workspaceSlug),
    { revalidateOnFocus: false, revalidateIfStale: false }
  );
  return data;
};

export const useProjectDetail = (workspaceSlug: string, projectId: string) => {
  const { data, mutate, isLoading } = useSWR(
    workspaceSlug && projectId ? `PROJECT_DETAIL_${projectId}` : null,
    () => projectDetailService.retrieve(workspaceSlug, projectId),
    { revalidateOnFocus: false }
  );
  return { projectDetail: data, mutate, isLoading };
};
