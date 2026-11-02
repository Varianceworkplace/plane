/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { unset, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TUserPermissions, TUserPermissionsLevel } from "@plane/constants";
import {
  EUserPermissions,
  EUserPermissionsLevel,
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS,
} from "@plane/constants";
import type {
  EUserProjectRoles,
  IUserProjectsRole,
  IWorkspaceMemberMe,
  TIssue,
  TProjectMembership,
} from "@plane/types";
import { EUserWorkspaceRoles } from "@plane/types";
// plane web imports
import type { TMyAccess, TRbacAction } from "@/components/access-control/types";
import { AccessControlService } from "@/services/access-control.service";
import { WorkspaceService } from "@/services/workspace.service";
import type { RootStore } from "@/store/root.store";
// services
import projectMemberService from "@/services/project/project-member.service";
import userService from "@/services/user.service";

// derived services
const workspaceService = new WorkspaceService();
const accessControlService = new AccessControlService();

type ETempUserRole = TUserPermissions | EUserWorkspaceRoles | EUserProjectRoles; // TODO: Remove this once we have migrated user permissions to enums to plane constants package

export interface IBaseUserPermissionStore {
  loader: boolean;
  // observables
  workspaceUserInfo: Record<string, IWorkspaceMemberMe>; // workspaceSlug -> IWorkspaceMemberMe
  projectUserInfo: Record<string, Record<string, TProjectMembership>>; // workspaceSlug -> projectId -> TProjectMembership
  workspaceProjectsPermissions: Record<string, IUserProjectsRole>; // workspaceSlug -> IUserProjectsRole
  // computed helpers
  workspaceInfoBySlug: (workspaceSlug: string) => IWorkspaceMemberMe | undefined;
  getWorkspaceRoleByWorkspaceSlug: (workspaceSlug: string) => TUserPermissions | EUserWorkspaceRoles | undefined;
  getProjectRolesByWorkspaceSlug: (workspaceSlug: string) => IUserProjectsRole;
  getProjectRoleByWorkspaceSlugAndProjectId: (
    workspaceSlug: string,
    projectId?: string
  ) => EUserPermissions | undefined;
  fetchWorkspaceLevelProjectEntities: (workspaceSlug: string, projectId: string) => void;
  allowPermissions: (
    allowPermissions: ETempUserRole[],
    level: TUserPermissionsLevel,
    workspaceSlug?: string,
    projectId?: string,
    onPermissionAllowed?: () => boolean
  ) => boolean;
  // actions
  fetchUserWorkspaceInfo: (workspaceSlug: string) => Promise<IWorkspaceMemberMe>;
  leaveWorkspace: (workspaceSlug: string) => Promise<void>;
  fetchUserProjectInfo: (workspaceSlug: string, projectId: string) => Promise<TProjectMembership>;
  fetchUserProjectPermissions: (workspaceSlug: string) => Promise<IUserProjectsRole>;
  joinProject: (workspaceSlug: string, projectId: string) => Promise<void>;
  leaveProject: (workspaceSlug: string, projectId: string) => Promise<void>;
  hasPageAccess: (workspaceSlug: string, key: string) => boolean;
  // role-based access (RBAC plan step 7): hides what a person can't do; the API still checks everything.
  // Each one allows everything while role-based access is off in the workspace, or not loaded yet.
  workspaceAccess: Record<string, TMyAccess>; // workspaceSlug -> the person's own access
  fetchWorkspaceAccess: (workspaceSlug: string) => Promise<TMyAccess | undefined>;
  canManageAccess: (workspaceSlug?: string) => boolean;
  canAccess: (module: string, rbacAction: TRbacAction, workspaceSlug?: string) => boolean;
  canOnProject: (
    rbacAction: "view" | "edit" | "delete",
    projectId: string | undefined,
    workspaceSlug?: string
  ) => boolean;
  canInProject: (
    module: string,
    rbacAction: TRbacAction,
    projectId: string | undefined,
    workspaceSlug?: string
  ) => boolean;
  canCreateWorkItem: (projectId: string | undefined | null, workspaceSlug?: string) => boolean;
  canChangeMemberRole: (memberId: string, workspaceSlug?: string) => boolean;
  canOnWorkItem: (
    rbacAction: TRbacAction,
    issue: Pick<TIssue, "project_id" | "assignee_ids" | "assignee_group_id" | "created_by"> | undefined,
    workspaceSlug?: string
  ) => boolean;
}

/**
 * @description This store is used to handle permission layer for the currently logged user.
 * It manages workspace and project level permissions, roles and access control.
 */
export class BaseUserPermissionStore implements IBaseUserPermissionStore {
  loader: boolean = false;
  // constants
  workspaceUserInfo: Record<string, IWorkspaceMemberMe> = {};
  projectUserInfo: Record<string, Record<string, TProjectMembership>> = {};
  workspaceProjectsPermissions: Record<string, IUserProjectsRole> = {};
  workspaceAccess: Record<string, TMyAccess> = {};
  // observables

  constructor(protected store: RootStore) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      workspaceUserInfo: observable,
      projectUserInfo: observable,
      workspaceProjectsPermissions: observable,
      workspaceAccess: observable,
      // computed
      // actions
      fetchUserWorkspaceInfo: action,
      leaveWorkspace: action,
      fetchUserProjectInfo: action,
      fetchUserProjectPermissions: action,
      joinProject: action,
      leaveProject: action,
      fetchWorkspaceAccess: action,
    });
  }

  // computed helpers
  /**
   * @description Returns the current workspace information
   * @param { string } workspaceSlug
   * @returns { IWorkspaceMemberMe | undefined }
   */
  workspaceInfoBySlug = computedFn((workspaceSlug: string): IWorkspaceMemberMe | undefined => {
    if (!workspaceSlug) return undefined;
    return this.workspaceUserInfo[workspaceSlug] || undefined;
  });

  /**
   * @description Returns the workspace role by slug
   * @param { string } workspaceSlug
   * @returns { TUserPermissions | EUserWorkspaceRoles | undefined }
   */
  getWorkspaceRoleByWorkspaceSlug = computedFn(
    (workspaceSlug: string): TUserPermissions | EUserWorkspaceRoles | undefined => {
      if (!workspaceSlug) return undefined;
      return this.workspaceUserInfo[workspaceSlug]?.role as TUserPermissions | EUserWorkspaceRoles | undefined;
    }
  );

  /**
   * @description Returns the project membership permission
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @returns { EUserPermissions | undefined }
   */
  protected getProjectRole = computedFn((workspaceSlug: string, projectId?: string): EUserPermissions | undefined => {
    if (!workspaceSlug || !projectId) return undefined;
    const projectRole = this.workspaceProjectsPermissions?.[workspaceSlug]?.[projectId];
    if (!projectRole) return undefined;
    const workspaceRole = this.workspaceUserInfo?.[workspaceSlug]?.role;
    if (workspaceRole === EUserWorkspaceRoles.ADMIN) return EUserPermissions.ADMIN;
    else return projectRole;
  });

  /**
   * @description Returns the project permissions by workspace slug
   * @param { string } workspaceSlug
   * @returns { IUserProjectsRole }
   */
  getProjectRolesByWorkspaceSlug = computedFn((workspaceSlug: string): IUserProjectsRole => {
    const projectPermissions = this.workspaceProjectsPermissions[workspaceSlug] || {};
    return Object.keys(projectPermissions).reduce((acc, projectId) => {
      const projectRole = this.getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId);
      if (projectRole) {
        acc[projectId] = projectRole;
      }
      return acc;
    }, {} as IUserProjectsRole);
  });

  /**
   * @description Returns the current project permissions
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @returns { EUserPermissions | undefined }
   */
  getProjectRoleByWorkspaceSlugAndProjectId = computedFn(
    (workspaceSlug: string, projectId?: string): EUserPermissions | undefined =>
      this.getProjectRole(workspaceSlug, projectId)
  );

  /**
   * @description Fetches project-level entities that are not automatically loaded by the project wrapper.
   * This is used when joining a project to ensure all necessary workspace-level project data is available.
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @returns { Promise<void> }
   */
  fetchWorkspaceLevelProjectEntities = (workspaceSlug: string, projectId: string): void => {
    void this.store.projectRoot.project.fetchProjectDetails(workspaceSlug, projectId);
  };

  /**
   * @description Returns whether the user has the permission to access a page
   * @param { string } page
   * @returns { boolean }
   */
  hasPageAccess = computedFn((workspaceSlug: string, key: string): boolean => {
    if (!workspaceSlug || !key) return false;
    const settings = WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS.find((item) => item.key === key);
    if (settings) {
      return this.allowPermissions(settings.access, EUserPermissionsLevel.WORKSPACE, workspaceSlug);
    }
    return false;
  });

  // action helpers
  /**
   * @description Returns whether the user has the permission to perform an action
   * @param { TUserPermissions[] } allowPermissions
   * @param { TUserPermissionsLevel } level
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @param { () => boolean } onPermissionAllowed
   * @returns { boolean }
   */
  allowPermissions = (
    allowPermissions: ETempUserRole[],
    level: TUserPermissionsLevel,
    workspaceSlug?: string,
    projectId?: string,
    onPermissionAllowed?: () => boolean
  ): boolean => {
    const { workspaceSlug: currentWorkspaceSlug, projectId: currentProjectId } = this.store.router;
    if (!workspaceSlug) workspaceSlug = currentWorkspaceSlug;
    if (!projectId) projectId = currentProjectId;

    let currentUserRole: TUserPermissions | undefined = undefined;

    if (level === EUserPermissionsLevel.WORKSPACE) {
      currentUserRole = (workspaceSlug && this.getWorkspaceRoleByWorkspaceSlug(workspaceSlug)) as
        | EUserPermissions
        | undefined;
    }

    if (level === EUserPermissionsLevel.PROJECT) {
      currentUserRole = (workspaceSlug &&
        projectId &&
        this.getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId)) as EUserPermissions | undefined;
    }

    if (typeof currentUserRole === "string") {
      currentUserRole = parseInt(currentUserRole);
    }

    if (currentUserRole && typeof currentUserRole === "number" && allowPermissions.includes(currentUserRole)) {
      if (onPermissionAllowed) {
        return onPermissionAllowed();
      } else {
        return true;
      }
    }

    return false;
  };

  // role-based access
  /** The person's access where role-based access is on and they aren't a workspace admin; else undefined. */
  private rbacAccess = (workspaceSlug?: string): TMyAccess | undefined => {
    const slug = workspaceSlug || this.store.router.workspaceSlug;
    const access = slug ? this.workspaceAccess[slug] : undefined;
    if (!access?.is_rbac_enabled || access.is_admin || !access.permissions) return undefined;
    return access;
  };

  private scopes = (access: TMyAccess, module: string, rbacAction: TRbacAction) =>
    access.permissions?.[module]?.[rbacAction] ?? [];

  fetchWorkspaceAccess = async (workspaceSlug: string): Promise<TMyAccess | undefined> => {
    try {
      const response = await accessControlService.me(workspaceSlug);
      runInAction(() => set(this.workspaceAccess, [workspaceSlug], response));
      return response;
    } catch (error) {
      console.error("Error fetching the user's access", error);
      return undefined;
    }
  };

  canManageAccess = (workspaceSlug?: string): boolean => {
    const slug = workspaceSlug || this.store.router.workspaceSlug;
    const access = slug ? this.workspaceAccess[slug] : undefined;
    if (access) return access.can_manage_access;
    return this.allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, slug);
  };

  /** Allowed somewhere: for workspace pages and for buttons that aren't about one record. */
  canAccess = (module: string, rbacAction: TRbacAction, workspaceSlug?: string): boolean => {
    const access = this.rbacAccess(workspaceSlug);
    return !access || this.scopes(access, module, rbacAction).length > 0;
  };

  canOnProject = (rbacAction: "view" | "edit" | "delete", projectId: string | undefined, workspaceSlug?: string) => {
    const access = this.rbacAccess(workspaceSlug);
    if (!access || !projectId) return true;
    const ids = access.projects?.[rbacAction];
    return ids === null || !!ids?.includes(projectId);
  };

  /** Milestones, worklogs, members, ... in one project; other modules by their permission alone. */
  canInProject = (module: string, rbacAction: TRbacAction, projectId: string | undefined, workspaceSlug?: string) => {
    const access = this.rbacAccess(workspaceSlug);
    if (!access) return true;
    const ids = access.modules?.[module]?.[rbacAction];
    if (ids === undefined || !projectId) return this.scopes(access, module, rbacAction).length > 0;
    return ids === null || ids.includes(projectId);
  };

  canCreateWorkItem = (projectId: string | undefined | null, workspaceSlug?: string) => {
    const access = this.rbacAccess(workspaceSlug);
    if (!access) return true;
    const ids = access.work_items?.create_project_ids;
    if (!projectId) return this.scopes(access, "work_items", "create").length > 0;
    return ids === null || !!ids?.includes(projectId);
  };

  /** Workspace settings › Members: workspace admins, and with role-based access on whoever Employees and members ›
   * Edit reaches (between Member and Guest only; the server's rule in views/workspace/member.py). */
  canChangeMemberRole = (memberId: string, workspaceSlug?: string) => {
    const slug = workspaceSlug || this.store.router.workspaceSlug;
    if (this.allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, slug)) return true;
    const ids = this.rbacAccess(slug)?.member_ids?.edit;
    return ids === null || !!ids?.includes(memberId);
  };

  /** The server's rule (plane.utils.rbac.AccessProfile.work_item_q) for one work item. */
  canOnWorkItem = (
    rbacAction: TRbacAction,
    issue: Pick<TIssue, "project_id" | "assignee_ids" | "assignee_group_id" | "created_by"> | undefined,
    workspaceSlug?: string
  ) => {
    const access = this.rbacAccess(workspaceSlug);
    if (!access || !issue) return true;
    const scopes = this.scopes(access, "work_items", rbacAction);
    if (scopes.includes("all")) return true;
    if (!scopes.length || !access.work_items) return false;
    const { member_project_ids, team_project_ids, led_member_ids, teamed_member_ids, group_ids, led_group_ids } =
      access.work_items;
    const me = this.store.user.data?.id;
    const assignees = issue.assignee_ids ?? [];
    const projectId = issue.project_id ?? "";
    const groupId = issue.assignee_group_id ?? "";
    // own: assigned to me, or unassigned and created by me; a task of my group I may only see
    if (me && (assignees.includes(me) || (!assignees.length && issue.created_by === me))) return true;
    if (rbacAction === "view" && groupId && group_ids?.includes(groupId)) return true;
    if (scopes.includes("member") && member_project_ids.includes(projectId)) return true;
    if (scopes.includes("team")) {
      if (assignees.some((id) => led_member_ids.includes(id))) return true;
      if (groupId && led_group_ids?.includes(groupId)) return true;
      // in my team projects, the work items no team claims
      if (team_project_ids[rbacAction]?.includes(projectId) && !assignees.some((id) => teamed_member_ids.includes(id)))
        return true;
    }
    return false;
  };

  // actions
  /**
   * @description Fetches the user's workspace information
   * @param { string } workspaceSlug
   * @returns { Promise<IWorkspaceMemberMe | undefined> }
   */
  fetchUserWorkspaceInfo = async (workspaceSlug: string): Promise<IWorkspaceMemberMe> => {
    try {
      this.loader = true;
      const response = await workspaceService.workspaceMemberMe(workspaceSlug);
      if (response) {
        runInAction(() => {
          set(this.workspaceUserInfo, [workspaceSlug], response);
          this.loader = false;
        });
      }
      return response;
    } catch (error) {
      console.error("Error fetching user workspace information", error);
      this.loader = false;
      throw error;
    }
  };

  /**
   * @description Leaves a workspace
   * @param { string } workspaceSlug
   * @returns { Promise<void | undefined> }
   */
  leaveWorkspace = async (workspaceSlug: string): Promise<void> => {
    try {
      await userService.leaveWorkspace(workspaceSlug);
      runInAction(() => {
        unset(this.workspaceUserInfo, workspaceSlug);
        unset(this.projectUserInfo, workspaceSlug);
        unset(this.workspaceProjectsPermissions, workspaceSlug);
      });
    } catch (error) {
      console.error("Error user leaving the workspace", error);
      throw error;
    }
  };

  /**
   * @description Fetches the user's project information
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @returns { Promise<TProjectMembership | undefined> }
   */
  fetchUserProjectInfo = async (workspaceSlug: string, projectId: string): Promise<TProjectMembership> => {
    try {
      const response = await projectMemberService.projectMemberMe(workspaceSlug, projectId);
      if (response) {
        runInAction(() => {
          set(this.projectUserInfo, [workspaceSlug, projectId], response);
          set(this.workspaceProjectsPermissions, [workspaceSlug, projectId], response.role);
        });
      }
      return response;
    } catch (error) {
      console.error("Error fetching user project information", error);
      throw error;
    }
  };

  /**
   * @description Fetches the user's project permissions
   * @param { string } workspaceSlug
   * @returns { Promise<IUserProjectsRole | undefined> }
   */
  fetchUserProjectPermissions = async (workspaceSlug: string): Promise<IUserProjectsRole> => {
    try {
      const response = await workspaceService.getWorkspaceUserProjectsRole(workspaceSlug);
      runInAction(() => {
        set(this.workspaceProjectsPermissions, [workspaceSlug], response);
      });
      return response;
    } catch (error) {
      console.error("Error fetching user project permissions", error);
      throw error;
    }
  };

  /**
   * @description Joins a project
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @returns { Promise<void> }
   */
  joinProject = async (workspaceSlug: string, projectId: string): Promise<void> => {
    try {
      const response = await userService.joinProject(workspaceSlug, [projectId]);
      const projectMemberRole = this.getWorkspaceRoleByWorkspaceSlug(workspaceSlug) ?? EUserPermissions.MEMBER;
      if (response) {
        runInAction(() => {
          set(this.workspaceProjectsPermissions, [workspaceSlug, projectId], projectMemberRole);
        });
        void this.fetchWorkspaceLevelProjectEntities(workspaceSlug, projectId);
      }
    } catch (error) {
      console.error("Error user joining the project", error);
      throw error;
    }
  };

  /**
   * @description Leaves a project
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @returns { Promise<void> }
   */
  leaveProject = async (workspaceSlug: string, projectId: string): Promise<void> => {
    try {
      await userService.leaveProject(workspaceSlug, projectId);
      runInAction(() => {
        unset(this.workspaceProjectsPermissions, [workspaceSlug, projectId]);
        unset(this.projectUserInfo, [workspaceSlug, projectId]);
        unset(this.store.projectRoot.project.projectMap, [projectId]);
      });
    } catch (error) {
      console.error("Error user leaving the project", error);
      throw error;
    }
  };
}

// Aliases so consumers can keep using UserPermissionStore / IUserPermissionStore
export type IUserPermissionStore = IBaseUserPermissionStore;
export { BaseUserPermissionStore as UserPermissionStore };
