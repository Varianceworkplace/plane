/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** A group of workspace members a project task can be assigned to instead of one person. */
export type TMemberGroup = {
  id: string;
  name: string;
  description: string;
  member_ids: string[];
  // live project tasks assigned to the group
  task_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
};

export type TMemberGroupList = {
  // the Groups settings page, and adding groups (the list itself is open to every member)
  can_view: boolean;
  can_create: boolean;
  groups: TMemberGroup[];
};

export type TMemberGroupPayload = {
  name: string;
  description: string;
  member_ids: string[];
};
