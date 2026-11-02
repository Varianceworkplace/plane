/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import useSWR from "swr";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// services
import { MemberGroupService } from "@/services/member-group.service";

export const memberGroupService = new MemberGroupService();

export const memberGroupsKey = (workspaceSlug: string) => `MEMBER_GROUPS_${workspaceSlug}`;

/** The workspace's groups (every member may list them: the Assigned to dropdown offers them). Empty slug = idle. */
export const useMemberGroups = (workspaceSlug: string | undefined) => {
  const { data, mutate, isLoading } = useSWR(
    workspaceSlug ? memberGroupsKey(workspaceSlug) : null,
    () => memberGroupService.list(workspaceSlug ?? ""),
    { revalidateOnFocus: false }
  );
  const getGroup = useCallback(
    (groupId: string | null | undefined) => data?.groups.find((g) => g.id === groupId),
    [data]
  );
  return { data, groups: data?.groups, getGroup, mutate, isLoading };
};

/**
 * The Groups settings page: roles with Groups › View while role-based access is on (HR, Project Managers),
 * workspace admins otherwise. The server checks every change.
 */
export const useCanViewGroups = (workspaceSlug: string | undefined) => {
  const { workspaceAccess, canAccess, allowPermissions } = useUserPermissions();
  if (workspaceSlug && workspaceAccess[workspaceSlug]?.is_rbac_enabled)
    return canAccess("groups", "view", workspaceSlug);
  return allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
};

/** A work item's fields when its Assigned to becomes these people: it leaves its group, if it had one. */
export const assigneesUpdate = (assigneeIds: string[], currentGroupId?: string | null) => ({
  assignee_ids: assigneeIds,
  ...(currentGroupId ? { assignee_group_id: null } : {}),
});

/** A work item's fields when its Assigned to becomes a group (or none): the people go. */
export const assigneeGroupUpdate = (groupId: string | null) =>
  groupId ? { assignee_group_id: groupId, assignee_ids: [] } : { assignee_group_id: null };
