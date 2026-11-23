/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { HolidaysHeader } from "./header";

// open to every workspace member: everyone sees the holiday list (admins and HR also change it)
export default function HolidaysLayout() {
  return (
    <>
      <AppHeader header={<HolidaysHeader />} />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
