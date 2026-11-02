/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { cn, getFileURL, renderFormattedDate } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
// local imports
import type { TMilestone } from "./types";

/** Avatar and name of the person a milestone is assigned to. */
export const MilestoneAssignee = observer(function MilestoneAssignee(props: {
  userId: string | null;
  className?: string;
}) {
  const { userId, className } = props;
  const { getUserDetails } = useMember();
  const user = userId ? getUserDetails(userId) : undefined;
  if (!user) return <span className={cn("text-placeholder", className)}>Unassigned</span>;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <Avatar size="xs" src={getFileURL(user.avatar_url ?? "")} alt={user.display_name} />
      <span className="truncate">{user.display_name}</span>
    </span>
  );
});

/** The milestone status as a small pill; nothing when it isn't set. */
export function MilestoneStatusBadge(props: { status: string }) {
  const { status } = props;
  if (!status) return null;
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-sm border-[0.5px] border-subtle bg-layer-1 px-1.5 py-0.5 text-caption-sm-medium text-secondary">
      {status}
    </span>
  );
}

function Detail(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption-md-regular text-tertiary">{props.label}</span>
      <span className="min-w-0 text-body-xs-regular text-primary">{props.children}</span>
    </div>
  );
}

const dateOrDash = (value: string | null) =>
  value ? renderFormattedDate(value) : <span className="text-placeholder">—</span>;

/** The Workplace fields of a milestone, read-only (milestone page). */
export const MilestoneDetailsGrid = observer(function MilestoneDetailsGrid(props: { milestone: TMilestone }) {
  const { milestone } = props;
  const { getProjectById } = useProject();
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border-[0.5px] border-subtle p-4 sm:grid-cols-4">
      <Detail label="Related to">
        {getProjectById(milestone.project_id)?.name ?? (milestone.project_name || "—")}
      </Detail>
      <Detail label="Assigned to">
        <MilestoneAssignee userId={milestone.assigned_to_id} />
      </Detail>
      <Detail label="Type">
        {milestone.milestone_type ? (
          <span className="capitalize">{milestone.milestone_type}</span>
        ) : (
          <span className="text-placeholder">—</span>
        )}
      </Detail>
      <Detail label="Milestone status">
        {milestone.status ? (
          <MilestoneStatusBadge status={milestone.status} />
        ) : (
          <span className="text-placeholder">—</span>
        )}
      </Detail>
      <Detail label="Start date">{dateOrDash(milestone.start_date)}</Detail>
      <Detail label="End date">{dateOrDash(milestone.target_date)}</Detail>
      <Detail label="Actual completion date">{dateOrDash(milestone.actual_completion_date)}</Detail>
    </div>
  );
});
