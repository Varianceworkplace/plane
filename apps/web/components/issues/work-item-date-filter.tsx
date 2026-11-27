/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { endOfMonth, endOfWeek, startOfMonth, startOfWeek, subMonths } from "date-fns";
// plane imports
import { CalendarOutline } from "@makeplane/propel/icons";
import { DateRangeSelect } from "@plane/blocks/property-select";
import type { TWorkItemDateField, TWorkItemDateFilter } from "@plane/types";
import { cn, getDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { FiltersDropdown } from "@/components/issues/issue-layouts/filters";

const DATE_FIELDS: { key: TWorkItemDateField; label: string }[] = [
  { key: "start_date", label: "Start date" },
  { key: "due_date", label: "Due date" },
  { key: "created_on", label: "Created on" },
  { key: "updated_on", label: "Updated on" },
];

/** quick ranges, the week starting on Monday */
const QUICK_RANGES: { label: string; range: () => [Date, Date] }[] = [
  { label: "Today", range: () => [new Date(), new Date()] },
  {
    label: "This week",
    range: () => [startOfWeek(new Date(), { weekStartsOn: 1 }), endOfWeek(new Date(), { weekStartsOn: 1 })],
  },
  { label: "This month", range: () => [startOfMonth(new Date()), endOfMonth(new Date())] },
  {
    label: "Last month",
    range: () => [startOfMonth(subMonths(new Date(), 1)), endOfMonth(subMonths(new Date(), 1))],
  },
];

type TWorkItemDateFilterProps = {
  /** the filter the list shows now (kept in its filter store) */
  value: TWorkItemDateFilter | undefined;
  /** the new filter; undefined clears it */
  onChange: (filter: TWorkItemDateFilter | undefined) => void;
};

/**
 * The date filter of a work item list (Projects › Project Tasks, a project's task list): the tasks whose start date,
 * due date, creation or last change falls on one day or within a range. A dot on the button shows when it's on.
 */
export function WorkItemDateFilter(props: TWorkItemDateFilterProps) {
  const { value, onChange } = props;
  const field = value?.field ?? "start_date";
  const from = getDate(value?.from) ?? null;
  const to = getDate(value?.to) ?? null;
  const isActive = !!(value?.from || value?.to);

  const update = (next: Partial<TWorkItemDateFilter>) => onChange({ field, from: value?.from, to: value?.to, ...next });
  const pickRange = (start: Date | null, end: Date | null) =>
    update({ from: renderFormattedPayloadDate(start) ?? undefined, to: renderFormattedPayloadDate(end) ?? undefined });

  return (
    <FiltersDropdown
      title="Date"
      placement="bottom-end"
      menuButton={
        // a calendar icon, and the word "Date" once the header has room; a dot while a date is picked
        <span
          aria-label={isActive ? "Date filter (on)" : "Date filter"}
          className="relative inline-flex h-7 items-center gap-1.5 rounded-md border border-strong bg-layer-2 px-2 text-13 font-medium text-secondary shadow-raised-100 transition-colors hover:bg-layer-transparent-hover"
        >
          <CalendarOutline className="size-3.5" />
          <span className="hidden @6xl:inline">Date</span>
          {isActive && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent-primary" />}
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <div>
          <p className="text-11 font-medium text-tertiary">Filter by</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Date to filter by">
            {DATE_FIELDS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={field === option.key}
                onClick={() => update({ field: option.key })}
                className={cn(
                  "rounded-md border px-2 py-1 text-11 font-medium transition-colors",
                  field === option.key
                    ? "border-accent-strong bg-accent-primary/10 text-accent-primary"
                    : "border-subtle text-secondary hover:bg-layer-transparent-hover"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-11 font-medium text-tertiary">Day or range</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {QUICK_RANGES.map((quick) => (
              <button
                key={quick.label}
                type="button"
                onClick={() => pickRange(...quick.range())}
                className="rounded-md border border-subtle px-2 py-1 text-11 font-medium text-secondary transition-colors hover:bg-layer-transparent-hover"
              >
                {quick.label}
              </button>
            ))}
          </div>
          <div className="mt-2">
            <DateRangeSelect
              variant="pill-md"
              value={{ from, to }}
              onChange={(range) => pickRange(range.from, range.to)}
              placeholder="Pick a day or range"
              icon={<CalendarOutline />}
              mergeDates
              clearable
            />
          </div>
          <p className="mt-1.5 text-11 text-tertiary">Click a day twice for one day, or two days for a range.</p>
        </div>
        {isActive && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="self-start text-11 font-medium text-accent-primary hover:underline"
          >
            Clear date filter
          </button>
        )}
      </div>
    </FiltersDropdown>
  );
}
