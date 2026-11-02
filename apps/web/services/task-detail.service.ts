/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type { TTaskDetail, TTaskDetailOptions } from "@/components/task-details/types";
// services
import { APIService } from "@/services/api.service";

export class TaskDetailService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string, projectId: string, issueId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/task-detail/`;
  }

  async options(workspaceSlug: string): Promise<TTaskDetailOptions> {
    return this.get(`/api/workspaces/${workspaceSlug}/task-detail-options/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async retrieve(workspaceSlug: string, projectId: string, issueId: string): Promise<TTaskDetail> {
    return this.get(this.base(workspaceSlug, projectId, issueId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TTaskDetail>
  ): Promise<TTaskDetail> {
    return this.patch(this.base(workspaceSlug, projectId, issueId), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
