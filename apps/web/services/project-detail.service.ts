/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type { TProjectDetail, TProjectDetailOptions } from "@/components/project-details/types";
// services
import { APIService } from "@/services/api.service";

export class ProjectDetailService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async options(workspaceSlug: string): Promise<TProjectDetailOptions> {
    return this.get(`/api/workspaces/${workspaceSlug}/project-detail-options/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async retrieve(workspaceSlug: string, projectId: string): Promise<TProjectDetail> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/project-detail/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(workspaceSlug: string, projectId: string, data: Partial<TProjectDetail>): Promise<TProjectDetail> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/project-detail/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
