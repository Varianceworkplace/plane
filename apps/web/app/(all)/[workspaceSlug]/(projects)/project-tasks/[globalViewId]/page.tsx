/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { PageHead } from "@/components/core/page-title";
import { ProjectTasksLayoutRoot } from "@/components/project-tasks/project-tasks-layout-root";

function ProjectTasksViewPage() {
  return (
    <>
      <PageHead title="Project Tasks" />
      <ProjectTasksLayoutRoot />
    </>
  );
}

export default observer(ProjectTasksViewPage);
