/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useSWRConfig } from "swr";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { TIssue } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// local imports
import { refreshWorkItemTime, useWorklogTimer } from "./helpers";
import { WorklogTimerControl } from "./timer-control";

/** Every list store (BaseIssuesStore) updates a work item in the store alone with `shouldSync` false. */
type TLocalIssueUpdate = {
  issueUpdate?: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssue>,
    shouldSync?: boolean
  ) => Promise<void>;
};

/** Start / Stop timer inside a row of the work item list. */
export const ListRowWorklogTimer = observer(function ListRowWorklogTimer(props: { issue: TIssue }) {
  const { issue } = props;
  const { workspaceSlug: routeSlug } = useParams();
  const workspaceSlug = typeof routeSlug === "string" ? routeSlug : "";
  const containerRef = useRef<HTMLDivElement>(null);
  // store hooks
  const { getProjectById } = useProject();
  const { allowPermissions } = useUserPermissions();
  const { timer } = useWorklogTimer(workspaceSlug);
  const { mutate } = useSWRConfig();
  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  const { getStateById, fetchProjectStates } = useProjectState();
  const { rootIssueStore } = useIssueDetail();

  const projectId = issue.project_id ?? "";
  const project = projectId ? getProjectById(projectId) : undefined;
  const canStart =
    !!project?.is_time_tracking_enabled &&
    !issue.archived_at &&
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug,
      projectId
    );
  const hasTimerHere = timer?.issue.id === issue.id;
  if (!workspaceSlug || !projectId || (!canStart && !hasTimerHere)) return null;

  return (
    // oxlint-disable-next-line jsx_a11y/click-events-have-key-events, jsx_a11y/no-static-element-interactions
    <div
      ref={containerRef}
      className="flex flex-shrink-0 items-center"
      onClick={(e) => {
        // the row is a link: don't open the work item. Clicks from the Save dialog (a portal) only
        // need to stop bubbling; clicks on the controls themselves must also not follow the link.
        e.stopPropagation();
        if (containerRef.current?.contains(e.target as Node)) e.preventDefault();
      }}
    >
      <WorklogTimerControl
        compact
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issue.id}
        canStart={canStart}
        onSaved={(issueStateId) => {
          void refreshWorkItemTime(mutate, projectId, issue.id);
          if (!issueStateId || issueStateId === issue.state_id) return;
          // saving the time log put the task On Hold or Completed: show it (On Hold may be new to the project)
          if (!getStateById(issueStateId)) void fetchProjectStates(workspaceSlug, projectId);
          // the layout's store, without syncing (the server already moved it), so grouped lists regroup too
          const layoutStore = issues as unknown as TLocalIssueUpdate;
          if (typeof layoutStore.issueUpdate === "function") {
            void layoutStore.issueUpdate(workspaceSlug, projectId, issue.id, { state_id: issueStateId }, false);
          } else rootIssueStore.issues.updateIssue(issue.id, { state_id: issueStateId });
        }}
      />
    </div>
  );
});
