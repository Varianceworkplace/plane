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
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { issueWorklogsKey, useWorklogTimer } from "./helpers";
import { WorklogTimerControl } from "./timer-control";

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
        onSaved={() => void mutate(issueWorklogsKey(issue.id))}
      />
    </div>
  );
});
