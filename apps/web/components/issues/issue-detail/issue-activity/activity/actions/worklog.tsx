/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { TimeTrackingOutline } from "@makeplane/propel/icons";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";

type TIssueWorklogActivity = { activityId: string; ends: "top" | "bottom" | undefined };

/**
 * A time entry deleted from the task (its Worklogs tab or the Time Sheet): what it was, in the words the server
 * recorded ("TIME-BILLING-336989 · 1h 30m on 26-11-2026, 10:30 AM – 12:00 PM, logged by …"), and who deleted it.
 */
export const IssueWorklogActivity = observer(function IssueWorklogActivity(props: TIssueWorklogActivity) {
  const { activityId, ends } = props;
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const activity = getActivityById(activityId);
  if (!activity) return <></>;

  return (
    <IssueActivityBlockComponent
      icon={<TimeTrackingOutline width={14} height={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      deleted the time entry <span className="font-medium text-primary">{activity.old_value}</span>.
    </IssueActivityBlockComponent>
  );
});
