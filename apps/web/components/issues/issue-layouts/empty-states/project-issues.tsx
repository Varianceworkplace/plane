/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/blocks/empty-state";
import { EIssuesStoreType, EUserProjectRoles } from "@plane/types";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useWorkItemFilterInstance } from "@/hooks/store/work-item-filters/use-work-item-filter-instance";

export const ProjectEmptyState = observer(function ProjectEmptyState() {
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  // plane imports
  const { t } = useTranslation();
  // store hooks
  const { toggleCreateIssueModal } = useCommandPalette();
  const { allowPermissions, canCreateWorkItem } = useUserPermissions();
  const {
    issuesFilter: { searchQuery, updateSearchQuery, dateFilter, updateDateFilter },
  } = useIssues(EIssuesStoreType.PROJECT);
  // derived values
  // the header's search box found nothing: say so, and offer to clear it (not to create a first task)
  const activeSearch = projectId ? (searchQuery[projectId] ?? "") : "";
  const activeDate = projectId ? dateFilter[projectId] : undefined;
  const isDateActive = !!(activeDate?.from || activeDate?.to);
  const projectWorkItemFilter = useWorkItemFilterInstance(EIssuesStoreType.PROJECT, projectId);

  const canPerformEmptyStateActions =
    allowPermissions([EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER], EUserPermissionsLevel.PROJECT) &&
    canCreateWorkItem(projectId);

  return (
    <div className="relative h-full w-full overflow-y-auto">
      {activeSearch || isDateActive || projectWorkItemFilter?.hasActiveFilters ? (
        <EmptyStateDetailed
          assetKey="search"
          title={t("common_empty_state.search.title")}
          description={t("common_empty_state.search.description")}
          actions={[
            ...(activeSearch
              ? [
                  {
                    label: "Clear search",
                    onClick: () => {
                      if (workspaceSlug && projectId) updateSearchQuery(workspaceSlug, projectId, "");
                    },
                    variant: "secondary" as const,
                  },
                ]
              : []),
            ...(isDateActive
              ? [
                  {
                    label: "Clear date filter",
                    onClick: () => {
                      if (workspaceSlug && projectId) updateDateFilter(workspaceSlug, projectId, undefined);
                    },
                    variant: "secondary" as const,
                  },
                ]
              : []),
            ...(projectWorkItemFilter?.hasActiveFilters
              ? [
                  {
                    label: t("project_issues.empty_state.issues_empty_filter.secondary_button.text"),
                    onClick: projectWorkItemFilter?.clearFilters,
                    disabled: !canPerformEmptyStateActions || !projectWorkItemFilter,
                    variant: "secondary" as const,
                  },
                ]
              : []),
          ]}
        />
      ) : (
        <EmptyStateDetailed
          assetKey="work-item"
          title={t("project_empty_state.work_items.title")}
          description={t("project_empty_state.work_items.description")}
          actions={[
            {
              label: t("project_empty_state.work_items.cta_primary"),
              onClick: () => {
                toggleCreateIssueModal(true, EIssuesStoreType.PROJECT);
              },
              disabled: !canPerformEmptyStateActions,
              variant: "primary",
            },
          ]}
        />
      )}
    </div>
  );
});
