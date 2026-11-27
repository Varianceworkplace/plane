/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// icons
import { Circle } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel, SPACE_BASE_PATH, SPACE_BASE_URL } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@makeplane/propel/elements/button";
import { NewTabOutline, WorkItemsOutline } from "@makeplane/propel/icons";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { EIssuesStoreType } from "@plane/types";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { CountChip } from "@/components/common/count-chip";
// constants
import { HeaderFilters } from "@/components/issues/filters";
import { WorkItemDateFilter } from "@/components/issues/work-item-date-filter";
import { WorkItemSearchBox } from "@/components/issues/work-item-search-box";
// helpers
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web imports
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { useProjectCrumbProps } from "@/components/breadcrumbs/use-project-crumb-props";

export const IssuesHeader = observer(function IssuesHeader() {
  // router
  const { workspaceSlug, projectId } = useParams();
  const projectCrumb = useProjectCrumbProps(workspaceSlug?.toString(), projectId?.toString());
  // store hooks
  const {
    issues: { getGroupIssueCount },
    issuesFilter: { searchQuery, updateSearchQuery, dateFilter, updateDateFilter },
  } = useIssues(EIssuesStoreType.PROJECT);
  // i18n
  const { t } = useTranslation();

  const { currentProjectDetails, loader } = useProject();

  const { toggleCreateIssueModal } = useCommandPalette();
  const { allowPermissions, canCreateWorkItem } = useUserPermissions();
  const { isMobile } = usePlatformOS();

  const SPACE_APP_URL =
    (SPACE_BASE_URL.trim() === "" && typeof window !== "undefined" ? window.location.origin : SPACE_BASE_URL) +
    SPACE_BASE_PATH;
  const publishedURL = `${SPACE_APP_URL}/issues/${currentProjectDetails?.anchor}`;

  const issuesCount = getGroupIssueCount(undefined, undefined, false);
  // the search box: a name, or a task number such as ACMEWEB-6
  const activeSearch = projectId ? (searchQuery[projectId.toString()] ?? "") : "";
  const handleSearch = useCallback(
    (query: string) => {
      if (workspaceSlug && projectId) updateSearchQuery(workspaceSlug.toString(), projectId.toString(), query);
    },
    [workspaceSlug, projectId, updateSearchQuery]
  );
  const canUserCreateIssue =
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT) &&
    canCreateWorkItem(projectId?.toString());

  return (
    <Header>
      <Header.LeftItem>
        <div className="flex items-center gap-2.5">
          <Breadcrumbs isLoading={loader === "init-loader"} className="flex-grow-0">
            <CommonProjectBreadcrumbs
              workspaceSlug={workspaceSlug?.toString()}
              projectId={projectId?.toString()}
              {...projectCrumb}
            />
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label="Project Tasks"
                  href={`/${workspaceSlug}/projects/${projectId}/issues/`}
                  icon={<WorkItemsOutline className="h-4 w-4 text-tertiary" />}
                  isLast
                />
              }
              isLast
            />
          </Breadcrumbs>
          {issuesCount && issuesCount > 0 ? (
            <Tooltip
              label={
                activeSearch
                  ? `${issuesCount} ${issuesCount > 1 ? "project tasks match" : "project task matches"} "${activeSearch}"`
                  : `There are ${issuesCount} ${issuesCount > 1 ? "project tasks" : "project task"} in this project`
              }
              layout="stacked"
              side="bottom"
              disabled={isMobile}
            >
              <CountChip count={issuesCount} />
            </Tooltip>
          ) : null}
        </div>
        {currentProjectDetails?.anchor ? (
          <a
            href={publishedURL}
            className="group flex items-center gap-1.5 rounded-sm bg-accent-primary/10 px-2.5 py-1 text-11 font-medium text-accent-primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Circle className="h-1.5 w-1.5 fill-accent-primary" strokeWidth={2} />
            {t("workspace_projects.network.public.title")}
            <NewTabOutline className="hidden h-3 w-3 group-hover:block" />
          </a>
        ) : (
          <></>
        )}
      </Header.LeftItem>
      <Header.RightItem>
        <WorkItemSearchBox key={projectId?.toString()} value={activeSearch} onSearch={handleSearch} />
        <WorkItemDateFilter
          value={projectId ? dateFilter[projectId.toString()] : undefined}
          onChange={(filter) => {
            if (workspaceSlug && projectId) updateDateFilter(workspaceSlug.toString(), projectId.toString(), filter);
          }}
        />
        <div className="hidden gap-2 md:flex">
          <HeaderFilters
            projectId={projectId}
            currentProjectDetails={currentProjectDetails}
            workspaceSlug={workspaceSlug}
            canUserCreateIssue={canUserCreateIssue}
          />
        </div>
        {canUserCreateIssue && (
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            type="button"
            onClick={() => {
              toggleCreateIssueModal(true, EIssuesStoreType.PROJECT);
            }}
          >
            <div className="block sm:hidden">{t("issue.label", { count: 1 })}</div>
            {/* "Add" until the header is wide: it also carries the search box and the date filter */}
            <div className="hidden sm:block @6xl:hidden">{t("common.add")}</div>
            <div className="hidden @6xl:block">{t("issue.add.label")}</div>
          </Button>
        )}
      </Header.RightItem>
    </Header>
  );
});
