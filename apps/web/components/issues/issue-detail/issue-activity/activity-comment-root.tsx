/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
// plane imports
import type { TActivityFilters } from "@plane/constants";
import {
  BASE_ACTIVITY_FILTER_TYPES,
  E_SORT_ORDER,
  EActivityFilterType,
  filterActivityOnSelectedFilters,
} from "@plane/constants";
import type { TCommentsOperations, TIssueActivityComment } from "@plane/types";
// components
import { CommentCard } from "@/components/comments/card/root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import type { TWorklog } from "@/components/worklogs/types";
// local imports
import { IssueActivityItem } from "./activity/activity-list";
import { IssueActivityLoader } from "./loader";

type TIssueActivityCommentRoot = {
  workspaceSlug: string;
  projectId: string;
  isIntakeIssue: boolean;
  issueId: string;
  selectedFilters: TActivityFilters[];
  activityOperations: TCommentsOperations;
  showAccessSpecifier?: boolean;
  disabled?: boolean;
  sortOrder: E_SORT_ORDER;
  /** Worklogs merged into the feed by time */
  worklogs?: TWorklog[];
  renderWorklog?: (worklog: TWorklog, ends: "top" | "bottom" | undefined) => ReactNode;
  /** Hide the "created the work item" style entries (they otherwise pass every filter) */
  hideDefaultActivity?: boolean;
  /** Shown when nothing matches */
  emptyState?: ReactNode;
};

type TFeedEntry = { type: "activity"; activity: TIssueActivityComment } | { type: "worklog"; worklog: TWorklog };

/** Merges worklogs into the (already sorted) activity list, keeping the activity order untouched. */
const mergeWorklogs = (
  activities: TIssueActivityComment[],
  worklogs: TWorklog[],
  sortOrder: E_SORT_ORDER
): TFeedEntry[] => {
  const asc = sortOrder === E_SORT_ORDER.ASC;
  // oxlint-disable-next-line unicorn/no-array-sort
  const sortedLogs = [...worklogs].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return asc ? diff : -diff;
  });
  const comesFirst = (log: TWorklog, activity: TIssueActivityComment) => {
    if (!activity.created_at) return false;
    const diff = new Date(log.created_at).getTime() - new Date(activity.created_at).getTime();
    return asc ? diff < 0 : diff > 0;
  };
  const feed: TFeedEntry[] = [];
  let logIndex = 0;
  activities.forEach((activity) => {
    while (logIndex < sortedLogs.length && comesFirst(sortedLogs[logIndex], activity)) {
      feed.push({ type: "worklog", worklog: sortedLogs[logIndex++] });
    }
    feed.push({ type: "activity", activity });
  });
  while (logIndex < sortedLogs.length) feed.push({ type: "worklog", worklog: sortedLogs[logIndex++] });
  return feed;
};

export const IssueActivityCommentRoot = observer(function IssueActivityCommentRoot(props: TIssueActivityCommentRoot) {
  const {
    workspaceSlug,
    isIntakeIssue,
    issueId,
    selectedFilters,
    activityOperations,
    showAccessSpecifier,
    projectId,
    disabled,
    sortOrder,
    worklogs = [],
    renderWorklog,
    hideDefaultActivity = false,
    emptyState = null,
  } = props;
  // store hooks
  const {
    activity: { getActivityAndCommentsByIssueId },
    comment: { getCommentById },
  } = useIssueDetail();
  // derived values
  const activityAndComments = getActivityAndCommentsByIssueId(issueId, sortOrder);

  if (!activityAndComments) return <IssueActivityLoader />;

  if (activityAndComments.length <= 0) return null;

  const filteredActivityAndComments = filterActivityOnSelectedFilters(activityAndComments, selectedFilters).filter(
    (activity) => !hideDefaultActivity || activity.activity_type !== EActivityFilterType.DEFAULT
  );
  const feed = mergeWorklogs(filteredActivityAndComments, renderWorklog ? worklogs : [], sortOrder);
  if (feed.length === 0) return <>{emptyState}</>;

  return (
    <div>
      {feed.map((entry, index) => {
        const ends = index === 0 ? "top" : index === feed.length - 1 ? "bottom" : undefined;
        if (entry.type === "worklog")
          return <div key={`worklog-${entry.worklog.id}`}>{renderWorklog?.(entry.worklog, ends)}</div>;
        const activityComment = entry.activity;
        const comment = getCommentById(activityComment.id);
        return activityComment.activity_type === "COMMENT" ? (
          <CommentCard
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            entityId={issueId}
            comment={comment}
            activityOperations={activityOperations}
            ends={ends}
            showAccessSpecifier={!!showAccessSpecifier}
            showCopyLinkOption={!isIntakeIssue}
            disabled={disabled}
            projectId={projectId}
            enableReplies
          />
        ) : BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
          <IssueActivityItem key={activityComment.id} activityId={activityComment.id} ends={ends} />
        ) : null;
      })}
    </div>
  );
});
