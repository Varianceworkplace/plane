/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { ProjectAccess } from "@/components/access-control/project-access";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import type { Route } from "./+types/page";
import { AccessProjectSettingsHeader } from "./header";

function AccessSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { currentProjectDetails } = useProject();
  const pageTitle = currentProjectDetails?.name ? `${currentProjectDetails.name} - Access` : undefined;

  return (
    <SettingsContentWrapper header={<AccessProjectSettingsHeader />} hugging>
      <PageHead title={pageTitle} />
      <SettingsHeading title="Access" description="Which teams own this project and who else it is shared with." />
      <ProjectAccess workspaceSlug={workspaceSlug} projectId={projectId} />
    </SettingsContentWrapper>
  );
}

export default observer(AccessSettingsPage);
