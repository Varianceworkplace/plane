/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkspace } from "@/hooks/store/use-workspace";

/** The same project name whatever its case or the spaces around it, as the server compares them. */
export const isSameProjectName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Whether another project of the workspace that the person can see already has this name (ignoring case and the
 * spaces around it), so the project forms can say so as it's typed. The server checks every project when saving,
 * also the ones the person can't see.
 */
export const useProjectNameTaken = () => {
  const { projectMap } = useProject();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  return useCallback(
    (name: string | undefined, exceptProjectId?: string) => {
      if (!name?.trim() || !workspaceId) return false;
      return Object.values(projectMap).some((project) => {
        const projectWorkspaceId = typeof project.workspace === "string" ? project.workspace : project.workspace?.id;
        return (
          projectWorkspaceId === workspaceId && project.id !== exceptProjectId && isSameProjectName(project.name, name)
        );
      });
    },
    [projectMap, workspaceId]
  );
};
