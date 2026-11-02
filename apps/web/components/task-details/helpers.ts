/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// services
import { TaskDetailService } from "@/services/task-detail.service";
// local imports
import type { TTaskDetail, TTaskDetailField } from "./types";

export const taskDetailService = new TaskDetailService();

export const EMPTY_TASK_DETAIL: TTaskDetail = {
  task_type: "",
  project_phase: "",
  technology: "",
  requested_by_id: null,
  not_in_project_plan: false,
  git_url: "",
  create_code_review: null,
  build_version: "",
  user_manual_url: "",
  bug_type: "",
  severity: "",
  environment: "",
  progress: null,
  code_review_comments: "",
  code_review_url: "",
  description_url: "",
};

/** In the order of the Workplace "Creating New Project Task" form. Required ones match its red stars. */
export const TASK_DETAIL_FIELDS: TTaskDetailField[] = [
  { key: "task_type", label: "Type", kind: "select", required: true },
  { key: "project_phase", label: "Project phase", kind: "select" },
  { key: "technology", label: "Technology / Framework", kind: "select" },
  { key: "requested_by_id", label: "Requested by", kind: "member" },
  { key: "not_in_project_plan", label: "Not included in project plan", kind: "checkbox" },
  {
    key: "git_url",
    label: "GIT URL",
    kind: "text",
    required: true,
    placeholder: "Repository or merge request link, or NA",
  },
  { key: "create_code_review", label: "Create code review task", kind: "yes-no", required: true },
  { key: "build_version", label: "Build version", kind: "text", placeholder: "e.g. 1.4.4" },
  { key: "user_manual_url", label: "User manual URL", kind: "text", placeholder: "https://" },
  { key: "bug_type", label: "Bug type", kind: "select" },
  { key: "severity", label: "Severity", kind: "select" },
  { key: "environment", label: "Environment", kind: "select" },
  { key: "progress", label: "Progress", kind: "progress" },
  {
    key: "code_review_comments",
    label: "Code review comments",
    kind: "textarea",
    placeholder: "Notes from the review",
  },
  { key: "code_review_url", label: "Code review URL", kind: "text", placeholder: "https://" },
  { key: "description_url", label: "Description URL", kind: "text", placeholder: "Spec, design or document link" },
];

/** A required field counts as answered once it holds something other than its empty value. */
export const isTaskDetailValueSet = (value: TTaskDetail[keyof TTaskDetail]) =>
  typeof value === "string" ? value.trim() !== "" : value !== null && value !== undefined;

export const taskDetailKey = (issueId: string) => `ISSUE_TASK_DETAIL_${issueId}`;

/** The picklists hardly ever change: fetch them once per session. */
export const useTaskDetailOptions = (workspaceSlug: string, enabled = true) => {
  const { data } = useSWR(
    enabled && workspaceSlug ? `TASK_DETAIL_OPTIONS_${workspaceSlug}` : null,
    () => taskDetailService.options(workspaceSlug),
    { revalidateOnFocus: false, revalidateIfStale: false }
  );
  return data;
};

export const useTaskDetail = (workspaceSlug: string, projectId: string, issueId: string, enabled = true) => {
  const { data, mutate, isLoading } = useSWR(
    enabled && workspaceSlug && projectId && issueId ? taskDetailKey(issueId) : null,
    () => taskDetailService.retrieve(workspaceSlug, projectId, issueId),
    { revalidateOnFocus: false }
  );
  return { taskDetail: data, mutate, isLoading };
};
