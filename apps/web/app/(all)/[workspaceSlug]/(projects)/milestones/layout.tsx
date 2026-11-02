/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { RbacModuleGuard } from "@/components/access-control/module-guard";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { WorkspaceMilestonesHeader } from "./header";

export default function WorkspaceMilestonesLayout() {
  return (
    <>
      <AppHeader header={<WorkspaceMilestonesHeader />} />
      <ContentWrapper>
        <RbacModuleGuard module="milestones">
          <Outlet />
        </RbacModuleGuard>
      </ContentWrapper>
    </>
  );
}
