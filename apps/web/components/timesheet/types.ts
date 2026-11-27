/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWorklogReportEntry } from "@/components/worklog-reports/types";
import type { TWorklogUser } from "@/components/worklogs/types";

/** GET timesheet/: the time entries of the person picked (or everyone the viewer may see), newest first. */
export type TTimesheet = {
  results: TWorklogReportEntry[];
  total_count: number;
  /** minutes */
  total_duration: number;
  page: number;
  per_page: number;
  /** the person shown: an id, or "all" */
  person: string;
  /** whom the viewer may see: themselves first */
  people: TWorklogUser[];
  can_view_others: boolean;
};

/** GET timesheet/<id>/: one entry, its date in the browser's timezone. */
export type TTimesheetEntry = TWorklogReportEntry;

export type TTimesheetQuery = {
  /** a person's id, "all", or empty for the signed-in person */
  person?: string;
  project?: string;
  /** YYYY-MM-DD, both inclusive */
  from_date?: string;
  to_date?: string;
  search?: string;
  page?: number;
  per_page?: number;
};
