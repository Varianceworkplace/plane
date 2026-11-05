/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssuePriorities } from "@plane/constants";
import type { TWorklogUser } from "@/components/worklogs/types";

/** Durations are in minutes, like the rest of time tracking. */
export type TProjectSummaryMember = TWorklogUser & {
  expected_duration: number;
  worked_duration: number;
  work_items: number;
  completed_work_items: number;
  open_work_items: number;
};

export type TProjectSummary = {
  work_items: {
    total: number;
    open: number;
    completed: number;
    cancelled: number;
    overdue: number;
    due_soon: number;
    /** completed out of all but cancelled, 0-100 */
    progress: number;
  };
  priority: Record<TIssuePriorities, number>;
  time: {
    is_time_tracking_enabled: boolean;
    expected_duration: number;
    worked_duration: number;
  };
  team: TProjectSummaryMember[];
  due_soon_days: number;
};
