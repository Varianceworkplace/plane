/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { Badge } from "@makeplane/propel/components/badge";
import { ChevronRightOutline } from "@makeplane/propel/icons";
import { cn } from "@plane/utils";
// components
import {
  daysUntil,
  holidayDay,
  holidayFullDate,
  holidayMonth,
  monthBand,
  useHolidays,
  whenText,
} from "@/components/holidays/helpers";

/** Home: the next company holiday, with a link to the whole list (sidebar › Holidays). */
export const NextHolidayCard = observer(function NextHolidayCard({ workspaceSlug }: { workspaceSlug: string }) {
  const { list } = useHolidays(workspaceSlug);
  const next = list?.next;
  if (!list || !next) return null;
  return (
    <Link
      href={`/${workspaceSlug}/holidays/`}
      className="group mb-6 flex items-center gap-4 rounded-lg border-[0.5px] border-subtle bg-layer-1 px-4 py-3 hover:bg-layer-1-hover"
    >
      <div
        aria-hidden
        className="flex w-12 shrink-0 flex-col overflow-hidden rounded-md border-[0.5px] border-subtle text-center"
      >
        <span className={cn("py-0.5 text-caption-sm-medium tracking-wide", monthBand(next.date))}>
          {holidayMonth(next.date)}
        </span>
        <span className="bg-surface-1 py-0.5 text-body-md-medium text-primary">{holidayDay(next.date)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-caption-md-regular text-tertiary">Next holiday</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body-sm-medium text-primary">{next.name}</span>
          {next.kind === "optional" && <Badge variant="neutral" size="sm" label="Optional" />}
        </span>
        <span className="text-caption-md-regular text-secondary">
          {holidayFullDate(next.date)} ·{" "}
          <span className="text-accent-primary">{whenText(daysUntil(list.today, next.date))}</span>
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-body-xs-medium text-secondary group-hover:text-primary">
        All holidays
        <ChevronRightOutline className="size-3.5" />
      </span>
    </Link>
  );
});
