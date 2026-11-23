/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// components
import { fromReportDate } from "@/components/worklog-reports/helpers";
// services
import { holidayService } from "@/services/holiday.service";
// local imports
import type { THoliday, THolidayList } from "./types";

export const HOLIDAY_KIND_LABEL: Record<THoliday["kind"], string> = {
  holiday: "Holiday",
  optional: "Optional holiday",
};

/** The month band of a date tile, a colour per month as on Keka's holiday calendar. */
const MONTH_BANDS = [
  "bg-label-indigo-bg text-label-indigo-text",
  "bg-label-purple-bg text-label-purple-text",
  "bg-label-orange-bg text-label-orange-text",
  "bg-label-emerald-bg text-label-emerald-text",
  "bg-label-yellow-bg text-label-yellow-text",
  "bg-label-crimson-bg text-label-crimson-text",
  "bg-label-indigo-bg text-label-indigo-text",
  "bg-label-pink-bg text-label-pink-text",
  "bg-label-emerald-bg text-label-emerald-text",
  "bg-label-crimson-bg text-label-crimson-text",
  "bg-label-orange-bg text-label-orange-text",
  "bg-label-purple-bg text-label-purple-text",
];

export const monthBand = (date: string) => MONTH_BANDS[Number(date.slice(5, 7)) - 1] ?? MONTH_BANDS[0];

const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  fromReportDate(date)?.toLocaleDateString(undefined, options) ?? date;

/** "JAN" */
export const holidayMonth = (date: string) => format(date, { month: "short" }).toUpperCase();
/** "14" */
export const holidayDay = (date: string) => date.slice(8, 10);
/** "Wednesday" */
export const holidayWeekday = (date: string) => format(date, { weekday: "long" });
/** "Wed, 14 Jan 2026" */
export const holidayFullDate = (date: string) =>
  format(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Whole days from today to the date (both YYYY-MM-DD). */
export const daysUntil = (today: string, date: string) => {
  const from = fromReportDate(today);
  const to = fromReportDate(date);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
};

export const whenText = (days: number) => (days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`);

export const holidaysKey = (workspaceSlug: string, year?: number) => `HOLIDAYS_${workspaceSlug}_${year ?? "current"}`;

/** A year of the holiday list; this year (the company's) without one. */
export const useHolidays = (workspaceSlug: string | undefined, year?: number) => {
  const { data, error, isLoading, mutate } = useSWR<THolidayList>(
    workspaceSlug ? holidaysKey(workspaceSlug, year) : null,
    workspaceSlug ? () => holidayService.list(workspaceSlug, year) : null,
    { revalidateOnFocus: false, keepPreviousData: true }
  );
  return { list: data, error, isLoading, mutate };
};

/** The holidays in two columns, the first half on the left, as on Keka's calendar. */
export const twoColumns = <T>(items: T[]): [T[], T[]] => {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
};

/** A sample file for the import, with the columns it reads. */
export const SAMPLE_IMPORT_CSV = [
  "Date,Holiday,Type",
  "2027-01-14,Uttarayan,Holiday",
  "2027-01-26,Republic Day,Holiday",
  "2027-08-15,Independence Day,Holiday",
  "2027-09-04,Janmashtami,Optional",
].join("\n");
