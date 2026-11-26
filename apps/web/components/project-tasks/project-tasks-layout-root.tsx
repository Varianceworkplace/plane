/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import {
  EIssueFilterType,
  EUserPermissions,
  EUserPermissionsLevel,
  ISSUE_DISPLAY_FILTERS_BY_PAGE,
} from "@plane/constants";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
// components
import { BaseListRoot } from "@/components/issues/issue-layouts/list/base-list-root";
import { ProjectIssueQuickActions } from "@/components/issues/issue-layouts/quick-action-dropdowns";
import { WorkspaceSpreadsheetRoot } from "@/components/issues/issue-layouts/spreadsheet/roots/workspace-root";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { WorkspaceLevelWorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/workspace-level";
import { WorkItemFiltersRow } from "@/components/work-item-filters/filters-row";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
import { useWorkspaceIssueProperties } from "@/hooks/use-workspace-issue-properties";

/**
 * Sidebar › Project Tasks: every project task the person may see, across projects, in Variance's own list (the rows
 * of Projects › Project Tasks: time, timer, status, priority, dates, assignee, labels, actions) or spreadsheet, newest
 * first. It is the workspace work items store on its own static view ("all", plane STATIC_VIEW_TYPES), so its
 * filters and layout are kept apart from Views › All work items.
 */
export const ProjectTasksLayoutRoot = observer(function ProjectTasksLayoutRoot() {
  const { workspaceSlug: routeSlug, globalViewId: routeViewId } = useParams();
  const workspaceSlug = routeSlug?.toString();
  const viewId = routeViewId?.toString();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  // Project Tasks always opens in List; Table can be picked while on the page
  const [openedInList, setOpenedInList] = useState(false);
  // store hooks
  const {
    issuesFilter: { filters, fetchFilters, updateFilters, updateFilterExpression },
    issues: { clear, fetchIssues, fetchNextIssues },
  } = useIssues(EIssuesStoreType.GLOBAL);
  const { allowPermissions } = useUserPermissions();
  useWorkspaceIssueProperties(workspaceSlug);

  const workItemFilters = viewId ? filters?.[viewId] : undefined;
  const layout =
    workItemFilters?.displayFilters?.layout === EIssueLayoutTypes.SPREADSHEET
      ? EIssueLayoutTypes.SPREADSHEET
      : EIssueLayoutTypes.LIST;

  // filters first; the list then loads its own pages, the spreadsheet is loaded here
  const { isLoading: filtersLoading } = useSWR(
    workspaceSlug && viewId ? `PROJECT_TASKS_FILTERS_${workspaceSlug}_${viewId}` : null,
    async () => {
      if (!workspaceSlug || !viewId) return;
      await fetchFilters(workspaceSlug, viewId);
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );
  // each time the page opens: List, whatever was picked last time (nothing is drawn until then)
  useEffect(() => {
    if (openedInList || !workspaceSlug || !viewId || !workItemFilters) return;
    if (workItemFilters.displayFilters?.layout === EIssueLayoutTypes.LIST) {
      setOpenedInList(true);
      return;
    }
    void updateFilters(
      workspaceSlug,
      undefined,
      EIssueFilterType.DISPLAY_FILTERS,
      { layout: EIssueLayoutTypes.LIST },
      viewId
    ).finally(() => setOpenedInList(true));
  }, [openedInList, workspaceSlug, viewId, workItemFilters, updateFilters]);
  const { isLoading: spreadsheetLoading } = useSWR(
    openedInList && workspaceSlug && viewId && workItemFilters && layout === EIssueLayoutTypes.SPREADSHEET
      ? `PROJECT_TASKS_SPREADSHEET_${workspaceSlug}_${viewId}`
      : null,
    async () => {
      if (!workspaceSlug || !viewId) return;
      clear();
      setLoading(true);
      await fetchIssues(workspaceSlug, viewId, "init-loader", { canGroup: false, perPageCount: 100 });
      setLoading(false);
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const initialWorkItemFilters = useMemo(
    () =>
      workItemFilters
        ? {
            displayFilters: workItemFilters.displayFilters,
            displayProperties: workItemFilters.displayProperties,
            kanbanFilters: workItemFilters.kanbanFilters,
            richFilters: workItemFilters.richFilters ?? {},
          }
        : undefined,
    [workItemFilters]
  );

  const routeFilters: { [key: string]: string } = {};
  searchParams.forEach((value: string, key: string) => {
    routeFilters[key] = value;
  });

  const fetchNextPages = useCallback(() => {
    if (workspaceSlug && viewId) void fetchNextIssues(workspaceSlug, viewId);
  }, [fetchNextIssues, workspaceSlug, viewId]);

  const canEditPropertiesBasedOnProject = (projectId: string) =>
    !!workspaceSlug &&
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug,
      projectId
    );

  if (!workspaceSlug || !viewId || filtersLoading || !workItemFilters || !openedInList) return null;

  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.GLOBAL}>
      <WorkspaceLevelWorkItemFiltersHOC
        entityId={viewId}
        entityType={EIssuesStoreType.GLOBAL}
        filtersToShowByLayout={ISSUE_DISPLAY_FILTERS_BY_PAGE.my_issues.filters}
        initialWorkItemFilters={initialWorkItemFilters}
        updateFilters={updateFilterExpression.bind(updateFilterExpression, workspaceSlug, viewId)}
        workspaceSlug={workspaceSlug}
      >
        {({ filter }) => (
          <div className="h-full overflow-hidden bg-surface-1">
            <div className="flex h-full w-full flex-col border-b border-strong">
              {filter && <WorkItemFiltersRow filter={filter} />}
              {layout === EIssueLayoutTypes.SPREADSHEET ? (
                <WorkspaceSpreadsheetRoot
                  isDefaultView
                  isLoading={loading}
                  toggleLoading={setLoading}
                  workspaceSlug={workspaceSlug}
                  globalViewId={viewId}
                  routeFilters={routeFilters}
                  fetchNextPages={fetchNextPages}
                  globalViewsLoading={false}
                  issuesLoading={spreadsheetLoading}
                />
              ) : (
                <div className="relative h-full w-full overflow-auto">
                  <BaseListRoot
                    QuickActions={ProjectIssueQuickActions}
                    canEditPropertiesBasedOnProject={canEditPropertiesBasedOnProject}
                    viewId={viewId}
                  />
                </div>
              )}
            </div>
            {/* the same detail panel as Projects › Project Tasks */}
            <IssuePeekOverview storeType={EIssuesStoreType.GLOBAL} />
          </div>
        )}
      </WorkspaceLevelWorkItemFiltersHOC>
    </IssuesStoreContext.Provider>
  );
});
