/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import useSWR from "swr";
// local imports
import { accessControlService, accessKeys } from "./helpers";

/**
 * The workspace's teams, for the "Assigned to" of projects and tasks (every member may list them). Empty slug = idle.
 */
export const useTeamOptions = (workspaceSlug: string | undefined) => {
  const { data, mutate, isLoading } = useSWR(
    workspaceSlug ? accessKeys.teamOptions(workspaceSlug) : null,
    () => accessControlService.teamOptions(workspaceSlug ?? ""),
    { revalidateOnFocus: false }
  );
  const getTeam = useCallback(
    (teamId: string | null | undefined) => (teamId ? data?.find((team) => team.id === teamId) : undefined),
    [data]
  );
  return { teams: data, getTeam, mutate, isLoading };
};

/** A work item's fields when its Assigned to becomes these people: it leaves its team, if it had one. */
export const assigneesUpdate = (assigneeIds: string[], currentTeamId?: string | null) => ({
  assignee_ids: assigneeIds,
  ...(currentTeamId ? { assignee_team_id: null } : {}),
});

/** A work item's fields when its Assigned to becomes a team (or none): the people go. */
export const assigneeTeamUpdate = (teamId: string | null) =>
  teamId ? { assignee_team_id: teamId, assignee_ids: [] } : { assignee_team_id: null };
