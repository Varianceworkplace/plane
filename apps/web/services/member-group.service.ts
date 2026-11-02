/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type { TMemberGroup, TMemberGroupList, TMemberGroupPayload } from "@/components/member-groups/types";
// services
import { APIService } from "@/services/api.service";

export class MemberGroupService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/groups/`;
  }

  // oxlint-disable-next-line typescript/no-explicit-any
  private unwrap<T>(promise: Promise<{ data: any }>): Promise<T> {
    return promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  list(workspaceSlug: string): Promise<TMemberGroupList> {
    return this.unwrap(this.get(this.base(workspaceSlug)));
  }

  create(workspaceSlug: string, data: TMemberGroupPayload): Promise<TMemberGroup> {
    return this.unwrap(this.post(this.base(workspaceSlug), data));
  }

  update(workspaceSlug: string, groupId: string, data: Partial<TMemberGroupPayload>): Promise<TMemberGroup> {
    return this.unwrap(this.patch(`${this.base(workspaceSlug)}${groupId}/`, data));
  }

  remove(workspaceSlug: string, groupId: string): Promise<void> {
    return this.unwrap(this.delete(`${this.base(workspaceSlug)}${groupId}/`));
  }
}
