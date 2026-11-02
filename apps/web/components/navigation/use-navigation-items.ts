/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useCallback } from "react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import {
  CyclesOutline,
  IntakeOutline,
  MilestoneOutline,
  TimeTrackingOutline,
  ModuleOutline,
  ViewsOutline,
  WorkItemsOutline,
} from "@makeplane/propel/icons";
import type { EUserProjectRoles, IPartialProject } from "@plane/types";
import { RBAC_PROJECT_PAGE_MODULES } from "@/components/access-control/types";
import type { TNavigationItem } from "@/components/navigation/tab-navigation-root";
import { useUserPermissions } from "@/hooks/store/user";

type UseNavigationItemsProps = {
  workspaceSlug: string;
  projectId: string;
  project?: IPartialProject;
  allowPermissions: (
    access: EUserPermissions[] | EUserProjectRoles[],
    level: EUserPermissionsLevel,
    workspaceSlug: string,
    projectId: string
  ) => boolean;
};

export const useNavigationItems = ({
  workspaceSlug,
  projectId,
  project,
  allowPermissions,
}: UseNavigationItemsProps): TNavigationItem[] => {
  const { canInProject, workspaceAccess } = useUserPermissions();
  const access = workspaceAccess[workspaceSlug];
  // Base navigation items
  const baseNavigation = useCallback(
    // oxlint-disable-next-line no-shadow
    (workspaceSlug: string, projectId: string): TNavigationItem[] => [
      {
        i18n_key: "sidebar.work_items",
        key: "work_items",
        name: "Project tasks",
        href: `/${workspaceSlug}/projects/${projectId}/issues`,
        icon: WorkItemsOutline,
        access: [EUserPermissions.ADMIN, EUserPermissions.MEMBER, EUserPermissions.GUEST],
        shouldRender: true,
        sortOrder: 1,
      },
      {
        i18n_key: "sidebar.cycles",
        key: "cycles",
        name: "Cycles",
        href: `/${workspaceSlug}/projects/${projectId}/cycles`,
        icon: CyclesOutline,
        access: [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        shouldRender: !!project?.cycle_view,
        sortOrder: 2,
      },
      {
        i18n_key: "sidebar.modules",
        key: "modules",
        name: "Modules",
        href: `/${workspaceSlug}/projects/${projectId}/modules`,
        icon: ModuleOutline,
        access: [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        shouldRender: !!project?.module_view,
        sortOrder: 3,
      },
      {
        i18n_key: "sidebar.views",
        key: "views",
        name: "Views",
        href: `/${workspaceSlug}/projects/${projectId}/views`,
        icon: ViewsOutline,
        access: [EUserPermissions.ADMIN, EUserPermissions.MEMBER, EUserPermissions.GUEST],
        shouldRender: !!project?.issue_views_view,
        sortOrder: 4,
      },
      {
        i18n_key: "sidebar.intake",
        key: "intake",
        name: "Intake",
        href: `/${workspaceSlug}/projects/${projectId}/intake`,
        icon: IntakeOutline,
        access: [EUserPermissions.ADMIN, EUserPermissions.MEMBER, EUserPermissions.GUEST],
        shouldRender: !!project?.inbox_view,
        sortOrder: 6,
      },
      {
        i18n_key: "sidebar.milestones",
        key: "milestones",
        name: "Milestones",
        href: `/${workspaceSlug}/projects/${projectId}/milestones`,
        icon: MilestoneOutline,
        access: [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        shouldRender: !!project?.is_milestone_enabled,
        sortOrder: 7,
      },
      {
        i18n_key: "sidebar.worklogs",
        key: "worklogs",
        name: "Worklogs",
        href: `/${workspaceSlug}/projects/${projectId}/worklogs`,
        icon: TimeTrackingOutline,
        access: [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        shouldRender: !!project?.is_time_tracking_enabled,
        sortOrder: 8,
      },
    ],
    [project]
  );

  // Combine, filter, and sort navigation items
  const navigationItems = useMemo(() => {
    const navItems = baseNavigation(workspaceSlug, projectId);

    // Filter by permissions and shouldRender
    const filteredItems = navItems.filter((item) => {
      if (!item.shouldRender) return false;
      const hasAccess = allowPermissions(item.access, EUserPermissionsLevel.PROJECT, workspaceSlug, project?.id ?? "");
      const module = RBAC_PROJECT_PAGE_MODULES[item.key];
      return hasAccess && (!module || canInProject(module, "view", projectId, workspaceSlug));
    });

    // Sort by sortOrder
    // oxlint-disable-next-line unicorn/no-array-sort
    return filteredItems.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    // `access`: recompute once the person's role-based access has loaded or changed
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, projectId, baseNavigation, allowPermissions, project?.id, canInProject, access]);

  return navigationItems;
};
