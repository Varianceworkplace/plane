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
import { EIssuesStoreType, EUserWorkspaceRoles } from "@plane/types";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";

export const GlobalViewEmptyState = observer(function GlobalViewEmptyState() {
  // plane imports
  const { t } = useTranslation();
  // store hooks
  const { workspaceProjectIds } = useProject();
  const { toggleCreateIssueModal, toggleCreateProjectModal } = useCommandPalette();
  const { allowPermissions, canAccess } = useUserPermissions();
  const { workspaceSlug, globalViewId } = useParams();
  const {
    issuesFilter: { searchQuery, updateSearchQuery, dateFilter, updateDateFilter },
  } = useIssues(EIssuesStoreType.GLOBAL);
  // the Project Tasks search box found nothing: say so, and offer to clear it
  const viewId = globalViewId?.toString();
  const activeSearch = viewId ? (searchQuery[viewId] ?? "") : "";
  const activeDate = viewId ? dateFilter[viewId] : undefined;
  const isDateActive = !!(activeDate?.from || activeDate?.to);
  // derived values
  const hasMemberLevelPermission = allowPermissions(
    [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  if (workspaceProjectIds?.length === 0) {
    return (
      <EmptyStateDetailed
        title={t("workspace_projects.empty_state.no_projects.title")}
        description={t("workspace_projects.empty_state.no_projects.description")}
        assetKey="project"
        assetClassName="size-40"
        actions={[
          {
            label: t("workspace_projects.empty_state.no_projects.primary_button.text"),
            onClick: () => {
              toggleCreateProjectModal(true);
            },
            // with role-based access, creating projects follows the role (Employees can't)
            disabled: !hasMemberLevelPermission || !canAccess("projects", "create"),
            variant: "primary",
          },
        ]}
      />
    );
  }

  if (activeSearch || isDateActive) {
    return (
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
                    if (workspaceSlug && viewId) updateSearchQuery(workspaceSlug.toString(), viewId, "");
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
                    if (workspaceSlug && viewId) updateDateFilter(workspaceSlug.toString(), viewId, undefined);
                  },
                  variant: "secondary" as const,
                },
              ]
            : []),
        ]}
      />
    );
  }

  return (
    <EmptyStateDetailed
      title={t(`workspace_empty_state.views.title`)}
      description={t(`workspace_empty_state.views.description`)}
      assetKey="project"
      assetClassName="size-40"
      actions={[
        {
          label: t(`workspace_empty_state.views.cta_primary`),
          onClick: () => {
            toggleCreateIssueModal(true, EIssuesStoreType.PROJECT);
          },
          disabled: !hasMemberLevelPermission,
          variant: "primary",
        },
      ]}
    />
  );
});
