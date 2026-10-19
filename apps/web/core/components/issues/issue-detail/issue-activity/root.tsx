/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import uniq from "lodash-es/uniq";
import { observer } from "mobx-react";
// plane package imports
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { Tab, Tabs, TabsList } from "@makeplane/propel/components/tabs";
import { AddOutline } from "@makeplane/propel/icons";
import type { TActivityFilters } from "@plane/constants";
import {
  E_SORT_ORDER,
  EActivityFilterType,
  EUserPermissions,
  EUserPermissionsLevel,
  defaultActivityFilters,
} from "@plane/constants";
import { useLocalStorage } from "@plane/hooks";
// i18n
import { useTranslation } from "@plane/i18n";
//types
import type { TFileSignedURLResponse, TIssueComment } from "@plane/types";
// components
import { CommentCreate } from "@/components/comments/comment-create";
import { useIssueWorklogs } from "@/components/worklogs/helpers";
import { DeleteWorklogModal, LogWorkModal } from "@/components/worklogs/log-work-modal";
import type { TWorklog } from "@/components/worklogs/types";
import { WorklogActivityItem } from "@/components/worklogs/worklog-activity-item";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// local imports
import { IssueActivityCommentRoot } from "./activity-comment-root";
import { useWorkItemCommentOperations } from "./helper";
import { ActivitySortRoot } from "./sort-root";
import { ActivityFilterRoot } from "./filter-root";

type TIssueActivity = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
  isIntakeIssue?: boolean;
};

type TActivityTab = "all" | "activity" | "comments" | "updates" | "worklogs" | "transition" | "history";

type TActivityTabConfig = {
  key: TActivityTab;
  label: string;
  /** activity types shown; `null` = use the filter menu selection */
  filters: TActivityFilters[] | null;
  showWorklogs: boolean;
  showCommentBox: boolean;
  /** hide "created the work item" style entries */
  hideDefault: boolean;
  emptyText: string;
};

const { ACTIVITY, ASSIGNEE, COMMENT, STATE } = EActivityFilterType;

// Tabs as in Plane Cloud's work item activity
const ACTIVITY_TABS: TActivityTabConfig[] = [
  {
    key: "all",
    label: "All",
    filters: null,
    showWorklogs: true,
    showCommentBox: true,
    hideDefault: false,
    emptyText: "No activity yet",
  },
  {
    key: "activity",
    label: "Activity",
    filters: [ACTIVITY, STATE, ASSIGNEE],
    showWorklogs: false,
    showCommentBox: false,
    hideDefault: false,
    emptyText: "No activity yet",
  },
  {
    key: "comments",
    label: "Comments",
    filters: [COMMENT],
    showWorklogs: false,
    showCommentBox: true,
    hideDefault: true,
    emptyText: "No comments yet",
  },
  {
    key: "updates",
    label: "Updates",
    filters: [ACTIVITY, ASSIGNEE],
    showWorklogs: false,
    showCommentBox: false,
    hideDefault: true,
    emptyText: "No updates yet",
  },
  {
    key: "worklogs",
    label: "Worklogs",
    filters: [],
    showWorklogs: true,
    showCommentBox: false,
    hideDefault: true,
    emptyText: "No worklogs yet",
  },
  {
    key: "transition",
    label: "Transition",
    filters: [STATE],
    showWorklogs: false,
    showCommentBox: false,
    hideDefault: true,
    emptyText: "No state transitions yet",
  },
  {
    key: "history",
    label: "History",
    filters: [ACTIVITY, STATE, ASSIGNEE],
    showWorklogs: true,
    showCommentBox: false,
    hideDefault: false,
    emptyText: "No history yet",
  },
];

export type TActivityOperations = {
  createComment: (data: Partial<TIssueComment>) => Promise<TIssueComment>;
  updateComment: (commentId: string, data: Partial<TIssueComment>) => Promise<void>;
  removeComment: (commentId: string) => Promise<void>;
  uploadCommentAsset: (blockId: string, file: File, commentId?: string) => Promise<TFileSignedURLResponse>;
};

export const IssueActivity = observer(function IssueActivity(props: TIssueActivity) {
  const { workspaceSlug, projectId, issueId, disabled = false, isIntakeIssue = false } = props;
  // i18n
  const { t } = useTranslation();
  // hooks
  const { setValue: setFilterValue, storedValue: selectedFilters } = useLocalStorage(
    "issue_activity_filters",
    defaultActivityFilters
  );
  const { setValue: setSortOrder, storedValue: sortOrder } = useLocalStorage("activity_sort_order", E_SORT_ORDER.ASC);
  const { setValue: setActiveTab, storedValue: storedTab } = useLocalStorage<TActivityTab>("issue_activity_tab", "all");
  // worklog modals
  const [worklogModal, setWorklogModal] = useState<{ open: boolean; worklog: TWorklog | null }>({
    open: false,
    worklog: null,
  });
  const [deleteWorklog, setDeleteWorklog] = useState<TWorklog | null>(null);

  const { getProjectById } = useProject();
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();

  // toggle filter
  const toggleFilter = (filter: TActivityFilters) => {
    if (!selectedFilters) return;
    let _filters = [];
    if (selectedFilters.includes(filter)) {
      if (selectedFilters.length === 1) return selectedFilters; // Ensure at least one filter is applied
      _filters = selectedFilters.filter((f) => f !== filter);
    } else {
      _filters = [...selectedFilters, filter];
    }

    setFilterValue(uniq(_filters));
  };

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === E_SORT_ORDER.ASC ? E_SORT_ORDER.DESC : E_SORT_ORDER.ASC);
  };

  // helper hooks
  const activityOperations = useWorkItemCommentOperations(workspaceSlug, projectId, issueId);

  const project = getProjectById(projectId);
  // time tracking
  const { worklogs, mutate: mutateWorklogs } = useIssueWorklogs(workspaceSlug, projectId, issueId, !isIntakeIssue);
  const isTimeTrackingEnabled = !!project?.is_time_tracking_enabled;
  const isProjectAdmin = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
  const canLogWork =
    isTimeTrackingEnabled &&
    !disabled &&
    !isIntakeIssue &&
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug,
      projectId
    );
  const canManageWorklog = (worklog: TWorklog) =>
    !disabled && (worklog.logged_by.id === currentUser?.id || isProjectAdmin || isWorkspaceAdmin);
  // tabs (no worklogs on intake work items)
  const tabs = isIntakeIssue ? ACTIVITY_TABS.filter((tab) => tab.key !== "worklogs") : ACTIVITY_TABS;
  const activeTab = tabs.find((tab) => tab.key === storedTab) ?? tabs[0];
  const showCommentBox = !disabled && activeTab.showCommentBox;

  const renderCommentCreationBox = useMemo(
    () => (
      <CommentCreate
        workspaceSlug={workspaceSlug}
        entityId={issueId}
        activityOperations={activityOperations}
        showToolbarInitially
        projectId={projectId}
      />
    ),
    [workspaceSlug, issueId, activityOperations, projectId]
  );
  if (!project) return <></>;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 overflow-x-auto" aria-label={t("common.activity")}>
          <Tabs
            variant="underline"
            value={activeTab.key}
            onValueChange={(value) => setActiveTab(value as TActivityTab)}
          >
            <TabsList>
              {tabs.map((tab) => (
                <Tab key={tab.key} value={tab.key} label={tab.label} />
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canLogWork && (
            <Button
              stretch="auto"
              variant="secondary"
              size="sm"
              label="Log work"
              icon={<Icon icon={AddOutline} />}
              onClick={() => setWorklogModal({ open: true, worklog: null })}
            />
          )}
          {activeTab.filters === null && (
            <ActivityFilterRoot
              selectedFilters={selectedFilters || defaultActivityFilters}
              toggleFilter={toggleFilter}
              isIntakeIssue={isIntakeIssue}
              projectId={projectId}
            />
          )}
          <ActivitySortRoot sortOrder={sortOrder || E_SORT_ORDER.ASC} toggleSort={toggleSortOrder} />
        </div>
      </div>

      {/* rendering activity */}
      <div className="space-y-3">
        <div className="min-h-[200px]">
          <div className="space-y-3">
            {showCommentBox && sortOrder === E_SORT_ORDER.DESC && renderCommentCreationBox}
            <IssueActivityCommentRoot
              projectId={projectId}
              workspaceSlug={workspaceSlug}
              isIntakeIssue={isIntakeIssue}
              issueId={issueId}
              selectedFilters={activeTab.filters ?? selectedFilters ?? defaultActivityFilters}
              hideDefaultActivity={activeTab.hideDefault}
              emptyState={<p className="py-6 text-center text-body-xs-regular text-tertiary">{activeTab.emptyText}</p>}
              activityOperations={activityOperations}
              showAccessSpecifier={!!project.anchor}
              disabled={disabled}
              sortOrder={sortOrder || E_SORT_ORDER.ASC}
              worklogs={activeTab.showWorklogs ? (worklogs ?? []) : []}
              renderWorklog={(worklog, ends) => (
                <WorklogActivityItem
                  workspaceSlug={workspaceSlug}
                  worklog={worklog}
                  ends={ends}
                  canManage={canManageWorklog(worklog)}
                  onEdit={(item) => setWorklogModal({ open: true, worklog: item })}
                  onDelete={(item) => setDeleteWorklog(item)}
                />
              )}
            />
            {showCommentBox && sortOrder === E_SORT_ORDER.ASC && renderCommentCreationBox}
          </div>
        </div>
      </div>

      <LogWorkModal
        open={worklogModal.open}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        worklog={worklogModal.worklog}
        onClose={(saved) => {
          setWorklogModal({ open: false, worklog: null });
          if (saved) void mutateWorklogs();
        }}
      />
      <DeleteWorklogModal
        open={!!deleteWorklog}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        worklog={deleteWorklog}
        onClose={(deleted) => {
          setDeleteWorklog(null);
          if (deleted) void mutateWorklogs();
        }}
      />
    </div>
  );
});
