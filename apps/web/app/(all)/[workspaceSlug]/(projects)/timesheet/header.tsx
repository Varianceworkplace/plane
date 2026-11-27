/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ClockOutline } from "@makeplane/propel/icons";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { timesheetListHref } from "@/components/timesheet/list-location";
import { useTimesheetEntry } from "@/components/timesheet/timesheet-entry-detail";

/** Time Sheet, or Time Sheet › TIME-BILLING-336989 on an entry (back to the list as it was left). */
export const TimesheetHeader = observer(function TimesheetHeader() {
  const { workspaceSlug, entryId } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const id = entryId?.toString();
  // the entry page's own request: the cache answers it
  const { data: entry } = useTimesheetEntry(slug, id);

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label="Time Sheet"
                href={id ? timesheetListHref(slug) : undefined}
                icon={<ClockOutline className="size-4 text-secondary" />}
                isLast={!id}
              />
            }
            isLast={!id}
          />
          {id && (
            <Breadcrumbs.Item
              component={<BreadcrumbLink label={entry?.timesheet_no || "Time entry"} isLast />}
              isLast
            />
          )}
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
});
