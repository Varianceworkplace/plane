/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type { TProjectSummary } from "@/components/project-summary/types";
// services
import { APIService } from "@/services/api.service";

export class ProjectSummaryService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async retrieve(workspaceSlug: string, projectId: string): Promise<TProjectSummary> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/summary/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
