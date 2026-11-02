/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { MilestoneOutline } from "@makeplane/propel/icons";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { MilestoneProgressIcon, useWorkspaceMilestone } from "@/components/milestones/helpers";

export const WorkspaceMilestonesHeader = observer(function WorkspaceMilestonesHeader() {
  const { workspaceSlug, milestoneId } = useParams();
  // on a milestone's read-only page: its title as the last crumb
  const { milestone } = useWorkspaceMilestone(workspaceSlug?.toString() ?? "", milestoneId?.toString() ?? "");

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                href={`/${workspaceSlug?.toString()}/milestones`}
                label="Project Milestones"
                icon={<MilestoneOutline className="size-4 text-secondary" />}
              />
            }
            isLast={!milestoneId}
          />
          {milestoneId && (
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label={milestone?.title ?? "…"}
                  icon={milestone ? <MilestoneProgressIcon milestone={milestone} size={14} /> : undefined}
                  isLast
                />
              }
              isLast
            />
          )}
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
});
