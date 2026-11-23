/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { PageHead } from "@/components/core/page-title";
import { HolidaysRoot } from "@/components/holidays/holidays-root";
// local imports
import type { Route } from "./+types/page";

function HolidaysPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  return (
    <>
      <PageHead title="Holidays" />
      <HolidaysRoot workspaceSlug={workspaceSlug} />
    </>
  );
}

export default observer(HolidaysPage);
