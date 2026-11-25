/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import useSWR from "swr";
// components
import { myActiveProjectsKey, useWorklogTimer, worklogService } from "@/components/worklogs/helpers";
// hooks
import { useProject } from "@/hooks/store/use-project";

/**
 * Sidebar › Projects: loads the projects the person is working on (an ongoing task of theirs, latest timer activity
 * first) into the project store, which lists them on top. Reloaded when their timer starts, stops or is saved, after
 * time is logged, and when the window regains focus (tasks assigned or finished elsewhere).
 */
export const useSidebarWorkingProjects = (workspaceSlug: string) => {
  const { timer } = useWorklogTimer(workspaceSlug, !!workspaceSlug);
  const { setWorkingProjectIds } = useProject();
  const timerState = timer ? `${timer.id}-${timer.is_running ? "running" : "stopped"}` : "none";
  const { data } = useSWR(
    workspaceSlug ? myActiveProjectsKey(workspaceSlug, timerState) : null,
    () => worklogService.myActiveProjects(workspaceSlug),
    { revalidateOnFocus: true, keepPreviousData: true }
  );

  useEffect(() => {
    if (data) setWorkingProjectIds(data.map((project) => project.project_id));
  }, [data, setWorkingProjectIds]);
};
