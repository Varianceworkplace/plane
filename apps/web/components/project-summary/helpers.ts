/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// services
import { ProjectSummaryService } from "@/services/project-summary.service";

export const projectSummaryService = new ProjectSummaryService();

export const projectSummaryKey = (projectId: string) => `PROJECT_SUMMARY_${projectId}`;

// refetched on focus, on every visit and once a minute, so the numbers follow changes made elsewhere
const REFRESH_INTERVAL = 60_000;

export const useProjectSummary = (workspaceSlug: string, projectId: string) => {
  const { data, error, isLoading } = useSWR(
    workspaceSlug && projectId ? projectSummaryKey(projectId) : null,
    () => projectSummaryService.retrieve(workspaceSlug, projectId),
    { refreshInterval: REFRESH_INTERVAL, keepPreviousData: true }
  );
  return { summary: data, error, isLoading };
};

/** Share of `part` in `total` as a whole percentage, capped at 100. */
export const percentOf = (part: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((part * 100) / total)) : 0;
