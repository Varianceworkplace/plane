/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type { TMilestone, TMilestonePayload, TMilestoneWorkItem } from "@/components/milestones/types";
// services
import { APIService } from "@/services/api.service";

export class MilestoneService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/milestones/`;
  }

  // oxlint-disable-next-line typescript/no-explicit-any
  private unwrap<T>(promise: Promise<{ data: any }>): Promise<T> {
    return promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  list(workspaceSlug: string, projectId: string): Promise<TMilestone[]> {
    return this.unwrap(this.get(this.base(workspaceSlug, projectId)));
  }

  retrieve(workspaceSlug: string, projectId: string, milestoneId: string): Promise<TMilestone> {
    return this.unwrap(this.get(`${this.base(workspaceSlug, projectId)}${milestoneId}/`));
  }

  create(workspaceSlug: string, projectId: string, data: TMilestonePayload): Promise<TMilestone> {
    return this.unwrap(this.post(this.base(workspaceSlug, projectId), data));
  }

  update(workspaceSlug: string, projectId: string, milestoneId: string, data: TMilestonePayload): Promise<TMilestone> {
    return this.unwrap(this.patch(`${this.base(workspaceSlug, projectId)}${milestoneId}/`, data));
  }

  remove(workspaceSlug: string, projectId: string, milestoneId: string): Promise<void> {
    return this.unwrap<void>(this.delete(`${this.base(workspaceSlug, projectId)}${milestoneId}/`));
  }

  workItems(workspaceSlug: string, projectId: string, milestoneId: string): Promise<TMilestoneWorkItem[]> {
    return this.unwrap(this.get(`${this.base(workspaceSlug, projectId)}${milestoneId}/work-items/`));
  }

  availableWorkItems(
    workspaceSlug: string,
    projectId: string,
    milestoneId: string,
    search: string
  ): Promise<TMilestoneWorkItem[]> {
    return this.unwrap(
      this.get(`${this.base(workspaceSlug, projectId)}${milestoneId}/available-work-items/`, { params: { search } })
    );
  }

  linkWorkItems(
    workspaceSlug: string,
    projectId: string,
    milestoneId: string,
    data: { add?: string[]; remove?: string[] }
  ): Promise<TMilestone> {
    return this.unwrap(this.post(`${this.base(workspaceSlug, projectId)}${milestoneId}/work-items/`, data));
  }

  workItemMilestone(workspaceSlug: string, projectId: string, issueId: string): Promise<TMilestone | null> {
    return this.unwrap<{ milestone: TMilestone | null }>(
      this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/milestone/`)
    ).then((data) => data?.milestone ?? null);
  }

  setWorkItemMilestone(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    milestoneId: string | null
  ): Promise<TMilestone | null> {
    return this.unwrap<{ milestone: TMilestone | null }>(
      this.put(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/milestone/`, {
        milestone_id: milestoneId,
      })
    ).then((data) => data?.milestone ?? null);
  }
}
