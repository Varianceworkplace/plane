/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { MilestoneOutline } from "@makeplane/propel/icons";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";

type TIssueMilestoneActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueMilestoneActivity = observer(function IssueMilestoneActivity(props: TIssueMilestoneActivity) {
  const { activityId, ends } = props;
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const activity = getActivityById(activityId);
  if (!activity) return <></>;
  const from = activity.old_value;
  const to = activity.new_value;

  return (
    <IssueActivityBlockComponent
      icon={<MilestoneOutline width={14} height={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      {from && to ? (
        <>
          moved this work item from the milestone <span className="font-medium text-primary">{from}</span> to{" "}
          <span className="font-medium text-primary">{to}</span>.
        </>
      ) : to ? (
        <>
          added this work item to the milestone <span className="font-medium text-primary">{to}</span>.
        </>
      ) : (
        <>
          removed this work item from the milestone <span className="font-medium text-primary">{from}</span>.
        </>
      )}
    </IssueActivityBlockComponent>
  );
});
