/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EIssueFilterType, ISSUE_DISPLAY_FILTERS_BY_PAGE } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@makeplane/propel/elements/button";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { WorkItemsOutline } from "@makeplane/propel/icons";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { CountChip } from "@/components/common/count-chip";
import { DisplayFiltersSelection, FiltersDropdown, LayoutSelection } from "@/components/issues/issue-layouts/filters";
import { WorkItemDateFilter } from "@/components/issues/work-item-date-filter";
import { WorkItemSearchBox } from "@/components/issues/work-item-search-box";
import { WorkItemFiltersToggle } from "@/components/work-item-filters/filters-toggle";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useIssues } from "@/hooks/store/use-issues";
import { usePlatformOS } from "@/hooks/use-platform-os";

// across projects there are no shared statuses to lay out as a board, calendar or timeline
const LAYOUTS = [EIssueLayoutTypes.LIST, EIssueLayoutTypes.SPREADSHEET];

/** The top bar of Projects › Project Tasks, for every project: layout, filters, display, add. */
export const ProjectTasksHeader = observer(function ProjectTasksHeader() {
  const { workspaceSlug: routeSlug, globalViewId: routeViewId } = useParams();
  const workspaceSlug = routeSlug?.toString();
  const viewId = routeViewId?.toString();
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const { toggleCreateIssueModal } = useCommandPalette();
  const {
    issuesFilter: { filters, updateFilters, searchQuery, updateSearchQuery, dateFilter, updateDateFilter },
    issues: { getGroupIssueCount },
  } = useIssues(EIssuesStoreType.GLOBAL);

  const issueFilters = viewId ? filters?.[viewId] : undefined;
  const activeLayout =
    issueFilters?.displayFilters?.layout === EIssueLayoutTypes.SPREADSHEET
      ? EIssueLayoutTypes.SPREADSHEET
      : EIssueLayoutTypes.LIST;
  const issuesCount = getGroupIssueCount(undefined, undefined, false);
  const activeSearch = viewId ? (searchQuery[viewId] ?? "") : "";
  const handleSearch = useCallback(
    (query: string) => {
      if (workspaceSlug && viewId) updateSearchQuery(workspaceSlug, viewId, query);
    },
    [workspaceSlug, viewId, updateSearchQuery]
  );
  const layoutOptions = useMemo(
    () => ISSUE_DISPLAY_FILTERS_BY_PAGE.my_issues.layoutOptions[activeLayout],
    [activeLayout]
  );

  const handleDisplayFilters = useCallback(
    (updated: Partial<IIssueDisplayFilterOptions>) => {
      if (workspaceSlug && viewId)
        void updateFilters(workspaceSlug, undefined, EIssueFilterType.DISPLAY_FILTERS, updated, viewId);
    },
    [workspaceSlug, viewId, updateFilters]
  );
  const handleDisplayProperties = useCallback(
    (property: Partial<IIssueDisplayProperties>) => {
      if (workspaceSlug && viewId)
        void updateFilters(workspaceSlug, undefined, EIssueFilterType.DISPLAY_PROPERTIES, property, viewId);
    },
    [workspaceSlug, viewId, updateFilters]
  );

  return (
    <Header>
      <Header.LeftItem>
        <div className="flex items-center gap-2.5">
          <Breadcrumbs className="flex-grow-0">
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label="Project Tasks"
                  href={workspaceSlug ? `/${workspaceSlug}/project-tasks/` : undefined}
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
                  : `There are ${issuesCount} ${issuesCount > 1 ? "project tasks" : "project task"} you can see`
              }
              layout="stacked"
              side="bottom"
              disabled={isMobile}
            >
              <CountChip count={issuesCount} />
            </Tooltip>
          ) : null}
        </div>
      </Header.LeftItem>
      <Header.RightItem>
        <WorkItemSearchBox key={viewId} value={activeSearch} onSearch={handleSearch} />
        <WorkItemDateFilter
          value={viewId ? dateFilter[viewId] : undefined}
          onChange={(filter) => {
            if (workspaceSlug && viewId) updateDateFilter(workspaceSlug, viewId, filter);
          }}
        />
        <div className="hidden items-center gap-2 md:flex">
          <LayoutSelection
            layouts={LAYOUTS}
            onChange={(layout) => handleDisplayFilters({ layout })}
            selectedLayout={activeLayout}
          />
          {viewId && <WorkItemFiltersToggle entityType={EIssuesStoreType.GLOBAL} entityId={viewId} />}
          <FiltersDropdown title={t("common.display")} placement="bottom-end">
            <DisplayFiltersSelection
              layoutDisplayFiltersOptions={layoutOptions}
              displayFilters={issueFilters?.displayFilters ?? {}}
              handleDisplayFiltersUpdate={handleDisplayFilters}
              displayProperties={issueFilters?.displayProperties ?? {}}
              handleDisplayPropertiesUpdate={handleDisplayProperties}
            />
          </FiltersDropdown>
        </div>
        <Button variant="primary" size="md" stretch="auto" type="button" onClick={() => toggleCreateIssueModal(true)}>
          <div className="block sm:hidden">{t("issue.label", { count: 1 })}</div>
          <div className="hidden sm:block">{t("issue.add.label")}</div>
        </Button>
      </Header.RightItem>
    </Header>
  );
});
