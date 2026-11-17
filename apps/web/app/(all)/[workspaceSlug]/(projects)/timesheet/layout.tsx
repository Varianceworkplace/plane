/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { TimesheetHeader } from "./header";

// open to every workspace member: everyone sees at least their own time (the server decides whose else)
export default function TimesheetLayout() {
  return (
    <>
      <AppHeader header={<TimesheetHeader />} />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
