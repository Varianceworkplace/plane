/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** The Workplace "Project Task" fields of a work item that Plane has no field for. */
export type TTaskDetail = {
  task_type: string;
  project_phase: string;
  technology: string;
  requested_by_id: string | null;
  not_in_project_plan: boolean;
  git_url: string;
  /** null until answered */
  create_code_review: boolean | null;
  build_version: string;
  user_manual_url: string;
  bug_type: string;
  severity: string;
  environment: string;
  /** percent, in steps of 10 */
  progress: number | null;
  code_review_comments: string;
  code_review_url: string;
  description_url: string;
};

/** Picklist values, served by the API so both sides accept the same ones. */
export type TTaskDetailOptions = {
  task_type: string[];
  project_phase: string[];
  technology: string[];
  bug_type: string[];
  severity: string[];
  environment: string[];
  progress: number[];
};

export type TTaskDetailPicklist = Exclude<keyof TTaskDetailOptions, "progress">;

export type TTaskDetailField =
  | { key: TTaskDetailPicklist; label: string; kind: "select"; required?: boolean }
  | { key: "requested_by_id"; label: string; kind: "member"; required?: boolean }
  | { key: "create_code_review"; label: string; kind: "yes-no"; required?: boolean }
  | { key: "not_in_project_plan"; label: string; kind: "checkbox"; required?: boolean }
  | { key: "progress"; label: string; kind: "progress"; required?: boolean }
  | {
      key: "git_url" | "build_version" | "user_manual_url" | "code_review_url" | "description_url";
      label: string;
      kind: "text";
      required?: boolean;
      placeholder?: string;
    }
  | { key: "code_review_comments"; label: string; kind: "textarea"; required?: boolean; placeholder?: string };
