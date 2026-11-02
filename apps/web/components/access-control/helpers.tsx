/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// plane imports
import { setToast } from "@plane/blocks/toast";
// services
import { AccessControlService } from "@/services/access-control.service";
// local imports
import type { TRbacAction, TRbacScope } from "./types";

export const accessControlService = new AccessControlService();

export const ACTION_LABELS: Record<TRbacAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
};

/** What each scope reaches, as the role editor and Check access explain it. */
export const SCOPE_LABELS: Record<TRbacScope, { label: string; description: string }> = {
  own: { label: "Own", description: "Only their own: assigned to them, or created or logged by them" },
  member: { label: "Member", description: "In the projects they are a member of" },
  team: {
    label: "Team",
    description: "In the projects of the teams they lead or that are shared with them, and their team members' work",
  },
  all: { label: "All", description: "Everything in the workspace" },
};

/** Plane's own workspace roles. */
export const WORKSPACE_ROLE_LABELS: Record<number, string> = { 20: "Admin", 15: "Member", 5: "Guest" };

/** module -> action -> scope (unset = not allowed for a role, the roles decide for a team), from permission rows. */
export type TPermissionMatrix<S extends string = TRbacScope> = Record<string, Partial<Record<TRbacAction, S>>>;

type TPermissionRow<S extends string> = { module: string; action: TRbacAction; scope: S };

export const toMatrix = <S extends string = TRbacScope>(permissions: TPermissionRow<S>[]): TPermissionMatrix<S> => {
  const matrix: TPermissionMatrix<S> = {};
  for (const { module, action, scope } of permissions) {
    matrix[module] = { ...matrix[module], [action]: scope };
  }
  return matrix;
};

export const fromMatrix = <S extends string = TRbacScope>(matrix: TPermissionMatrix<S>): TPermissionRow<S>[] =>
  Object.entries(matrix).flatMap(([module, actions]) =>
    Object.entries(actions)
      .filter(([, scope]) => !!scope)
      .map(([action, scope]) => ({ module, action: action as TRbacAction, scope: scope as S }))
  );

/** A failed save: the server's first message, or a fallback. */
export const toastError = (title: string, error: unknown) => {
  const data = (error ?? {}) as Record<string, unknown>;
  const first = Object.values(data)[0];
  setToast({
    type: "error",
    title,
    message: typeof first === "string" ? first : "Something went wrong. Please try again.",
  });
};

export const accessKeys = {
  overview: (slug: string) => `ACCESS_CONTROL_${slug}`,
  roles: (slug: string) => `ACCESS_ROLES_${slug}`,
  teams: (slug: string) => `ACCESS_TEAMS_${slug}`,
  members: (slug: string) => `ACCESS_MEMBERS_${slug}`,
  project: (projectId: string) => `PROJECT_ACCESS_${projectId}`,
  preview: (slug: string) => `ACCESS_PREVIEW_${slug}`,
  joinRequests: (slug: string) => `ACCESS_JOIN_REQUESTS_${slug}`,
};

export const useAccessControl = (workspaceSlug: string) => {
  const { data, error, mutate, isLoading } = useSWR(workspaceSlug ? accessKeys.overview(workspaceSlug) : null, () =>
    accessControlService.overview(workspaceSlug)
  );
  return { overview: data, error, mutate, isLoading };
};

export const useRoles = (workspaceSlug: string, enabled = true) => {
  const { data, mutate } = useSWR(enabled && workspaceSlug ? accessKeys.roles(workspaceSlug) : null, () =>
    accessControlService.roles(workspaceSlug)
  );
  return { roles: data, mutate };
};

export const useTeams = (workspaceSlug: string, enabled = true) => {
  const { data, mutate } = useSWR(enabled && workspaceSlug ? accessKeys.teams(workspaceSlug) : null, () =>
    accessControlService.teams(workspaceSlug)
  );
  return { teams: data, mutate };
};

export const useAccessMembers = (workspaceSlug: string, enabled = true) => {
  const { data, mutate } = useSWR(enabled && workspaceSlug ? accessKeys.members(workspaceSlug) : null, () =>
    accessControlService.members(workspaceSlug)
  );
  return { members: data, mutate };
};

export const useRolloutPreview = (workspaceSlug: string) => {
  const { data, mutate, isLoading } = useSWR(workspaceSlug ? accessKeys.preview(workspaceSlug) : null, () =>
    accessControlService.preview(workspaceSlug)
  );
  return { preview: data, mutate, isLoading };
};

/** My PMs, my requests to join projects, and the ones I decide as a PM. Pass "" when they aren't needed. */
export const useProjectJoinRequests = (workspaceSlug: string) => {
  const { data, mutate, isLoading } = useSWR(workspaceSlug ? accessKeys.joinRequests(workspaceSlug) : null, () =>
    accessControlService.joinRequests(workspaceSlug)
  );
  return { joinRequests: data, mutate, isLoading };
};
