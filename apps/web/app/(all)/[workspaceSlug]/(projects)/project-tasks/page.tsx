/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Navigate } from "react-router";
// local imports
import type { Route } from "./+types/page";

// Project Tasks opens on every task the person may see (the static view "all", see ProjectTasksLayoutRoot)
export default function ProjectTasksPage({ params }: Route.ComponentProps) {
  return <Navigate to={`/${params.workspaceSlug}/project-tasks/all/`} replace />;
}
