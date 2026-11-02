/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type {
  TAccessControl,
  TAccessGrant,
  TAccessMember,
  TCheckAccess,
  TGrantPayload,
  TMyAccess,
  TProjectAccess,
  TProjectJoinRequest,
  TProjectJoinRequests,
  TRole,
  TRolePayload,
  TRolloutPreview,
  TTeam,
  TTeamPayload,
} from "@/components/access-control/types";
// services
import { APIService } from "@/services/api.service";

export class AccessControlService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/access-control/`;
  }

  // oxlint-disable-next-line typescript/no-explicit-any
  private unwrap<T>(promise: Promise<{ data: any }>): Promise<T> {
    return promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  overview(workspaceSlug: string): Promise<TAccessControl> {
    return this.unwrap(this.get(this.base(workspaceSlug)));
  }

  me(workspaceSlug: string): Promise<TMyAccess> {
    return this.unwrap(this.get(`${this.base(workspaceSlug)}me/`));
  }

  preview(workspaceSlug: string): Promise<TRolloutPreview> {
    return this.unwrap(this.get(`${this.base(workspaceSlug)}preview/`));
  }

  setEnabled(workspaceSlug: string, enabled: boolean): Promise<{ is_rbac_enabled: boolean }> {
    return this.unwrap(this.patch(this.base(workspaceSlug), { is_rbac_enabled: enabled }));
  }

  roles(workspaceSlug: string): Promise<TRole[]> {
    return this.unwrap(this.get(`${this.base(workspaceSlug)}roles/`));
  }

  createRole(workspaceSlug: string, data: TRolePayload): Promise<TRole> {
    return this.unwrap(this.post(`${this.base(workspaceSlug)}roles/`, data));
  }

  updateRole(workspaceSlug: string, roleId: string, data: TRolePayload): Promise<TRole> {
    return this.unwrap(this.patch(`${this.base(workspaceSlug)}roles/${roleId}/`, data));
  }

  deleteRole(workspaceSlug: string, roleId: string): Promise<void> {
    return this.unwrap<void>(this.delete(`${this.base(workspaceSlug)}roles/${roleId}/`));
  }

  members(workspaceSlug: string): Promise<TAccessMember[]> {
    return this.unwrap(this.get(`${this.base(workspaceSlug)}members/`));
  }

  setMemberRoles(workspaceSlug: string, memberId: string, roleIds: string[]): Promise<{ role_ids: string[] }> {
    return this.unwrap(this.put(`${this.base(workspaceSlug)}members/${memberId}/roles/`, { role_ids: roleIds }));
  }

  checkAccess(workspaceSlug: string, memberId: string): Promise<TCheckAccess> {
    return this.unwrap(this.get(`${this.base(workspaceSlug)}members/${memberId}/check/`));
  }

  teams(workspaceSlug: string): Promise<TTeam[]> {
    return this.unwrap(this.get(`${this.base(workspaceSlug)}teams/`));
  }

  createTeam(workspaceSlug: string, data: TTeamPayload): Promise<TTeam> {
    return this.unwrap(this.post(`${this.base(workspaceSlug)}teams/`, data));
  }

  updateTeam(workspaceSlug: string, teamId: string, data: TTeamPayload): Promise<TTeam> {
    return this.unwrap(this.patch(`${this.base(workspaceSlug)}teams/${teamId}/`, data));
  }

  deleteTeam(workspaceSlug: string, teamId: string): Promise<void> {
    return this.unwrap<void>(this.delete(`${this.base(workspaceSlug)}teams/${teamId}/`));
  }

  projectAccess(workspaceSlug: string, projectId: string): Promise<TProjectAccess> {
    return this.unwrap(this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/access/`));
  }

  shareProject(workspaceSlug: string, projectId: string, data: TGrantPayload): Promise<TAccessGrant> {
    return this.unwrap(this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/access/`, data));
  }

  removeShare(workspaceSlug: string, projectId: string, grantId: string): Promise<void> {
    return this.unwrap<void>(this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/access/${grantId}/`));
  }

  joinRequests(workspaceSlug: string): Promise<TProjectJoinRequests> {
    return this.unwrap(this.get(`/api/workspaces/${workspaceSlug}/project-join-requests/`));
  }

  requestToJoin(workspaceSlug: string, projectId: string): Promise<TProjectJoinRequest> {
    return this.unwrap(this.post(`/api/workspaces/${workspaceSlug}/project-join-requests/`, { project_id: projectId }));
  }

  decideJoinRequest(
    workspaceSlug: string,
    requestId: string,
    status: "approved" | "rejected"
  ): Promise<TProjectJoinRequest> {
    return this.unwrap(this.patch(`/api/workspaces/${workspaceSlug}/project-join-requests/${requestId}/`, { status }));
  }
}
