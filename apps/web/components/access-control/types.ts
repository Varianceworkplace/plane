/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TRbacAction = "view" | "create" | "edit" | "delete";
export type TRbacScope = "own" | "member" | "team" | "all";
/** A team's Lead permission replaces the leads' roles for that action, so it can also be "none" (not allowed). */
export type TTeamScope = TRbacScope | "none";

export type TAccessControl = {
  is_rbac_enabled: boolean;
  /** only workspace admins switch role-based access on or off */
  can_switch: boolean;
  modules: { key: string; label: string }[];
  actions: TRbacAction[];
  scopes: TRbacScope[];
};

/** project ids; null = every project */
export type TProjectIds = string[] | null;

/** The signed-in person's own access (GET access-control/me/); with role-based access off only the first two. */
export type TMyAccess = {
  is_rbac_enabled: boolean;
  can_manage_access: boolean;
  is_admin?: boolean;
  /** the names of the roles given to the person, e.g. ["Project Manager"] */
  role_names?: string[];
  permissions?: Record<string, Record<TRbacAction, TRbacScope[]>>;
  projects?: Record<"view" | "edit" | "delete", TProjectIds>;
  /** milestones, worklogs, members: where each action is allowed */
  modules?: Record<string, Record<TRbacAction, TProjectIds>>;
  /** the people whose workspace role I may change (Employees and members › Edit); null = everyone */
  member_ids?: { edit: string[] | null };
  work_items?: {
    create_project_ids: TProjectIds;
    member_project_ids: string[];
    team_project_ids: Record<TRbacAction, string[]>;
    /** people in the teams I lead (me included) */
    led_member_ids: string[];
    /** people in any team */
    teamed_member_ids: string[];
    // the groups I'm in (I see their tasks), and the ones with people of the teams I lead
    group_ids?: string[];
    led_group_ids?: string[];
  };
};

export type TJoinRequestUser = { id: string; display_name: string; name: string };

/** A request to join a project while role-based access is on; the person's PM approves or rejects it. */
export type TProjectJoinRequest = {
  id: string;
  project_id: string;
  project_name: string;
  member: TJoinRequestUser;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_by: TJoinRequestUser | null;
  decided_at: string | null;
  /** pending, and I'm the PM of the person who asked */
  can_decide: boolean;
};

/** GET project-join-requests/: my PMs, my own requests, and the ones I decide as a PM. */
export type TProjectJoinRequests = {
  is_rbac_enabled: boolean;
  pms: TJoinRequestUser[];
  requests: TProjectJoinRequest[];
};

/** What turning role-based access on changes, per person (GET access-control/preview/); nothing is changed. */
export type TRolloutPreview = {
  is_rbac_enabled: boolean;
  people: {
    member_id: string;
    workspace_role: number;
    is_workspace_admin: boolean;
    roles: string[];
    teams: { name: string; is_lead: boolean }[];
    work_items: { now: number; after: number };
    projects: { view: number; edit: number };
    /** project memberships the sync adds, and hand-made ones whose role it raises */
    memberships: { added: number; raised: number };
  }[];
  warnings: {
    without_role: string[];
    teams_without_lead: string[];
    projects_without_team: string[];
    seeing_fewer_work_items: string[];
  };
};

export type TRolePermission = { module: string; action: TRbacAction; scope: TRbacScope };

export type TRole = {
  id: string;
  name: string;
  description: string;
  /** "hr" / "pm" / "employee" for the built-in roles */
  key: string;
  is_system: boolean;
  holder_count: number;
  permissions: TRolePermission[];
};

export type TRolePayload = { name?: string; description?: string; permissions?: TRolePermission[] };

export type TTeamMember = { member_id: string; is_lead: boolean };

export type TTeamPermission = { module: string; action: TRbacAction; scope: TTeamScope };

export type TTeam = {
  id: string;
  name: string;
  description: string;
  members: TTeamMember[];
  project_ids: string[];
  /** what the team's leads may do instead of what their roles grant; not listed = their roles decide */
  lead_permissions: TTeamPermission[];
};

export type TTeamPayload = {
  name?: string;
  description?: string;
  members?: TTeamMember[];
  project_ids?: string[];
  lead_permissions?: TTeamPermission[];
};

export type TAccessMember = {
  member_id: string;
  /** Plane's workspace role: 20 admin, 15 member, 5 guest */
  workspace_role: number;
  role_ids: string[];
  teams: { team_id: string; is_lead: boolean }[];
};

export type TCheckAccess = {
  member_id: string;
  is_rbac_enabled: boolean;
  is_workspace_admin: boolean;
  roles: string[];
  teams: { name: string; is_lead: boolean }[];
  /** module -> action -> scopes */
  permissions: Record<string, Record<TRbacAction, TRbacScope[]>>;
  /** module -> action -> the teams whose Lead permissions it comes from, instead of the roles */
  team_permissions: Record<string, Partial<Record<TRbacAction, string[]>>>;
  projects: { view: string[]; edit: string[] };
};

export type TAccessGrant = {
  id: string;
  member_id: string | null;
  team_id: string | null;
  level: "view" | "manage";
  expires_at: string | null;
};

export type TProjectAccess = {
  is_rbac_enabled: boolean;
  can_share: boolean;
  teams: { id: string; name: string }[];
  grants: TAccessGrant[];
};

export type TGrantPayload = {
  member_id?: string;
  team_id?: string;
  level: "view" | "manage";
  expires_at?: string | null;
};

/** Workspace sidebar items role-based access hides when a person may not view their module: item key -> module. */
export const RBAC_SIDEBAR_MODULES: Record<string, string> = {
  analytics: "analytics",
  tickets: "tickets",
  reports: "worklogs",
  project_milestones: "milestones",
};

/** Project pages role-based access hides when a person may not view their module there: page key -> module. */
export const RBAC_PROJECT_PAGE_MODULES: Record<string, string> = { milestones: "milestones", worklogs: "worklogs" };
