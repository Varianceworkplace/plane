/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { PageHead } from "@/components/core/page-title";
import { MilestoneDetail } from "@/components/milestones/detail/milestone-detail";
import { useWorkspaceMilestone } from "@/components/milestones/helpers";
// local imports
import type { Route } from "./+types/page";

/** A milestone opened from Project Milestones by someone who isn't in its project: read-only. */
function WorkspaceMilestoneDetailPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, milestoneId } = params;
  const { milestone } = useWorkspaceMilestone(workspaceSlug, milestoneId);
  return (
    <>
      <PageHead title={milestone?.title ?? "Milestone"} />
      <MilestoneDetail
        workspaceSlug={workspaceSlug}
        projectId={milestone?.project_id ?? ""}
        milestoneId={milestoneId}
        canEdit={false}
        linkOpen={false}
        onLinkOpenChange={() => {}}
        readOnly
      />
    </>
  );
}

export default observer(WorkspaceMilestoneDetailPage);
