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
// components
import { MilestonesList } from "@/components/milestones/list/milestones-list";
import { MilestonesPageShell } from "@/components/milestones/milestones-page-shell";

function ProjectMilestonesPage() {
  const { workspaceSlug, projectId } = useParams();
  const [createOpen, setCreateOpen] = useState(false);
  const slug = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";

  return (
    <MilestonesPageShell
      workspaceSlug={slug}
      projectId={pid}
      title="Milestones"
      actions={
        <Button variant="primary" size="md" stretch="auto" label="Add milestone" onClick={() => setCreateOpen(true)} />
      }
    >
      {(canEdit) => (
        <MilestonesList
          workspaceSlug={slug}
          projectId={pid}
          canEdit={canEdit}
          createOpen={createOpen}
          onCreateOpenChange={setCreateOpen}
        />
      )}
    </MilestonesPageShell>
  );
}

export default observer(ProjectMilestonesPage);
