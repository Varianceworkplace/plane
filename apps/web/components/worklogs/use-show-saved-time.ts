/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useSWRConfig } from "swr";
// plane imports
import type { TIssue } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// local imports
import { refreshWorkItemTime } from "./helpers";

/** Every list store (BaseIssuesStore) updates a work item in the store alone with `shouldSync` false. */
export type TLocalIssueUpdate = {
  issueUpdate?: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssue>,
    shouldSync?: boolean
  ) => Promise<void>;
};

/** Whether a list's work item ids (one list, lists per group, or per sub-group) include this work item. */
const listIncludes = (grouped: unknown, issueId: string): boolean => {
  if (Array.isArray(grouped)) return grouped.includes(issueId);
  if (grouped && typeof grouped === "object") return Object.values(grouped).some((ids) => listIncludes(ids, issueId));
  return false;
};

/**
 * After a timer is saved as a time log (from a list row, the work item's detail view or the top bar): the work item's
 * time, and its new status (On Hold / Completed) wherever it shows.
 */
export const useShowSavedTime = (workspaceSlug: string) => {
  const { mutate } = useSWRConfig();
  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  const { getStateById, fetchProjectStates } = useProjectState();
  const { rootIssueStore } = useIssueDetail();

  return (projectId: string, issueId: string, issueStateId?: string) => {
    void refreshWorkItemTime(mutate, projectId, issueId);
    const issue = rootIssueStore.issues.getIssueById(issueId);
    // not loaded on this page: it's fetched fresh when opened
    if (!issueStateId || !issue || issue.state_id === issueStateId) return;
    // On Hold may be new to the project
    if (!getStateById(issueStateId)) void fetchProjectStates(workspaceSlug, projectId);
    // in the list on screen: through the list's store, without syncing (the server already moved it), so it regroups
    const layoutStore = issues as unknown as TLocalIssueUpdate & { groupedIssueIds?: unknown };
    if (typeof layoutStore.issueUpdate === "function" && listIncludes(layoutStore.groupedIssueIds, issueId)) {
      void layoutStore.issueUpdate(workspaceSlug, projectId, issueId, { state_id: issueStateId }, false);
    } else rootIssueStore.issues.updateIssue(issueId, { state_id: issueStateId });
  };
};
