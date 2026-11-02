/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { milestoneService } from "@/components/milestones/helpers";
import { toNumber, worklogService } from "@/components/worklogs/helpers";
// local imports
import { EMPTY_TASK_DETAIL, TASK_DETAIL_FIELDS, isTaskDetailValueSet, taskDetailService } from "./helpers";
import type { TTaskDetail } from "./types";

/**
 * What the create / edit work item form collects for a project with task details on. Kept in the
 * issue modal context's `issuePropertyValues` (the slot Plane reserves for extra work item fields).
 */
export type TTaskDetailsFormValues = {
  detail: TTaskDetail;
  expected_hours: string;
  expected_minutes: string;
  overdue_reason: string;
  /** "Project milestone name"; undefined until picked or loaded, so an untouched form changes nothing */
  milestone_id?: string | null;
  /** set once the form was filled from an existing work item, so it isn't overwritten again */
  loaded_for?: string;
};

export type TTaskDetailsFormErrors = Partial<
  Record<
    keyof TTaskDetail | "expected_time" | "assignee_ids" | "start_date" | "target_date" | "priority" | "milestone_id",
    string
  >
>;

export const EMPTY_TASK_DETAILS_FORM: TTaskDetailsFormValues = {
  // a new task starts in Phase-1, as on the Workplace form
  detail: { ...EMPTY_TASK_DETAIL, project_phase: "Phase-1" },
  expected_hours: "",
  expected_minutes: "",
  overdue_reason: "",
};

export const readTaskDetailsForm = (values: Record<string, unknown>): TTaskDetailsFormValues => ({
  ...EMPTY_TASK_DETAILS_FORM,
  ...(values as Partial<TTaskDetailsFormValues>),
});

/** Expected time in minutes; null when empty, NaN when not a valid time. */
export const expectedMinutes = (values: TTaskDetailsFormValues): number | null => {
  if (!values.expected_hours.trim() && !values.expected_minutes.trim()) return null;
  const hours = toNumber(values.expected_hours);
  const minutes = toNumber(values.expected_minutes);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59 || hours > 999)
    return Number.NaN;
  return hours * 60 + minutes;
};

type TWorkItemFields = {
  assigneeIds: string[] | undefined;
  // or a group instead of the person
  assigneeGroupId: string | null | undefined;
  priority: string | null | undefined;
  startDate: string | null | undefined;
  targetDate: string | null | undefined;
};

/**
 * The Workplace form's required fields. Returns field errors for this section and the labels of
 * missing Plane fields (assignee, dates) for the toast.
 */
export const validateTaskDetailsForm = (
  values: TTaskDetailsFormValues,
  workItem: TWorkItemFields,
  needsExpectedTime: boolean
): { errors: TTaskDetailsFormErrors; missing: string[] } => {
  const errors: TTaskDetailsFormErrors = {};
  const missing: string[] = [];
  for (const field of TASK_DETAIL_FIELDS) {
    if (field.required && !isTaskDetailValueSet(values.detail[field.key])) {
      errors[field.key] = `${field.label} is required.`;
      missing.push(field.label);
    }
  }
  if (needsExpectedTime) {
    const minutes = expectedMinutes(values);
    if (minutes === null || minutes === 0) {
      errors.expected_time = "Expected time is required.";
      missing.push("Expected time");
    } else if (Number.isNaN(minutes)) {
      errors.expected_time = "Enter whole hours (up to 999) and minutes (0–59).";
      missing.push("Expected time");
    }
  }
  if (!workItem.priority || workItem.priority === "none") {
    errors.priority = "Pick a priority.";
    missing.push("Priority");
  }
  if ((workItem.assigneeIds ?? []).length !== 1 && !workItem.assigneeGroupId) {
    errors.assignee_ids = "Pick the person or group this task is assigned to.";
    missing.push("Assigned to");
  }
  if (!workItem.startDate) {
    errors.start_date = "Start date is required.";
    missing.push("Start date");
  }
  if (!workItem.targetDate) {
    errors.target_date = "End date is required.";
    missing.push("End date");
  }
  return { errors, missing };
};

/** Saves the section for a work item that was just created or edited. */
export const saveTaskDetailsForm = async (
  workspaceSlug: string,
  projectId: string,
  issueId: string,
  values: TTaskDetailsFormValues,
  withExpectedTime: boolean,
  withMilestone: boolean
) => {
  await taskDetailService.update(workspaceSlug, projectId, issueId, values.detail);
  // the server leaves the link alone when it doesn't change
  if (withMilestone && values.milestone_id !== undefined)
    await milestoneService.setWorkItemMilestone(workspaceSlug, projectId, issueId, values.milestone_id || null);
  const minutes = expectedMinutes(values);
  if (withExpectedTime && minutes && !Number.isNaN(minutes)) {
    await worklogService.updateTimeEstimate(workspaceSlug, projectId, issueId, {
      expected_duration: minutes,
      overdue_reason: values.overdue_reason.trim(),
    });
  }
};
