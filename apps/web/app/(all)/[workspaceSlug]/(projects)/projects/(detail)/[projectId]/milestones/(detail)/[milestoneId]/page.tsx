/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { AddOutline, ChevronDownOutline } from "@makeplane/propel/icons";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
// components
import { MilestoneDetail } from "@/components/milestones/detail/milestone-detail";
import { MilestoneProgressIcon, useMilestone, useProjectMilestones } from "@/components/milestones/helpers";
import { MilestonesPageShell } from "@/components/milestones/milestones-page-shell";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";

function MilestoneDetailPage() {
  const { workspaceSlug, projectId, milestoneId } = useParams();
  const router = useAppRouter();
  const slug = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";
  const mid = milestoneId?.toString() ?? "";
  const [linkOpen, setLinkOpen] = useState(false);
  const { milestone } = useMilestone(slug, pid, mid);
  const { milestones } = useProjectMilestones(slug, pid);

  // the milestone name in the breadcrumb switches to another milestone
  const switcher = (
    <Breadcrumbs.Item
      component={
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-body-sm-medium text-primary hover:bg-layer-transparent-hover"
              >
                {milestone && <MilestoneProgressIcon milestone={milestone} size={14} />}
                <span className="max-w-60 truncate">{milestone?.title ?? "…"}</span>
                <ChevronDownOutline className="size-3 text-tertiary" />
              </button>
            }
          />
          <MenuContent side="bottom" align="start">
            {(milestones ?? []).map((item) => (
              <MenuItem
                key={item.id}
                label={item.title}
                icon={<MilestoneProgressIcon milestone={item} size={14} />}
                onClick={() => router.push(`/${slug}/projects/${pid}/milestones/${item.id}`)}
              />
            ))}
          </MenuContent>
        </Menu>
      }
      isLast
    />
  );

  return (
    <MilestonesPageShell
      workspaceSlug={slug}
      projectId={pid}
      title={milestone?.title ?? "Milestone"}
      crumb={switcher}
      actions={
        <Button
          variant="primary"
          size="md"
          stretch="auto"
          label="Link work items"
          icon={<Icon icon={AddOutline} />}
          onClick={() => setLinkOpen(true)}
        />
      }
    >
      {(canEdit) => (
        <MilestoneDetail
          workspaceSlug={slug}
          projectId={pid}
          milestoneId={mid}
          canEdit={canEdit}
          linkOpen={linkOpen}
          onLinkOpenChange={setLinkOpen}
        />
      )}
    </MilestonesPageShell>
  );
}

export default observer(MilestoneDetailPage);
