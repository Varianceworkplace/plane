/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { TimesheetEntryDetail, useTimesheetEntry } from "@/components/timesheet/timesheet-entry-detail";

/** Time Sheet › an entry (a row of the Time Sheet list opens it). */
export default function TimesheetEntryPage() {
  const { workspaceSlug, entryId } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const id = entryId?.toString();
  const { data: entry } = useTimesheetEntry(slug, id);

  return (
    <>
      <PageHead title={entry?.timesheet_no ? `${entry.timesheet_no} - Time Sheet` : "Time Sheet"} />
      {id && <TimesheetEntryDetail workspaceSlug={slug} entryId={id} />}
    </>
  );
}
