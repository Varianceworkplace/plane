/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { SearchOutline } from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { Loader } from "@plane/blocks/skeleton";
import { cn } from "@plane/utils";
// components
import { formatWorklogDuration, getWorklogUserName } from "@/components/worklogs/helpers";
// local imports
import {
  fromReportDate,
  getDefaultAttendanceFilters,
  minutesToHours,
  toReportDate,
  useAttendanceReport,
  worklogReportService,
} from "./helpers";
import { useReportPdfExport } from "./report-pdf-export";
import type { TReportPdfTable } from "./report-pdf";
import { WorklogReportFilters } from "./report-filters";
import type { TReportExportFormat } from "./report-parts";
import { HEAD_CELL, OwnTimeNotice, ReportExportMenu, Section, Stat, UserCell } from "./report-parts";
import type {
  TAttendanceCell,
  TAttendanceDay,
  TAttendanceEmployee,
  TWorklogReportFilters,
  TWorklogReportSelection,
} from "./types";
import { WorklogReportDetailModal } from "./worklog-detail-modal";

type Props = { workspaceSlug: string };

const STATUS_TEXT: Record<TAttendanceCell["status"], string> = {
  present: "Present",
  absent: "Absent",
  week_off: "Week Off",
  week_off_worked: "Worked on Week Off",
  holiday: "Holiday",
  holiday_worked: "Worked on a holiday",
  today: "Today (not over yet)",
  upcoming: "Upcoming",
  not_joined: "Before they joined",
  inactive: "Disabled",
};

const dayLabel = (day: TAttendanceDay) => fromReportDate(day.date)?.toLocaleDateString(undefined, { weekday: "short" });
const dayNumber = (day: TAttendanceDay) => day.date.slice(8, 10);
const fullDate = (value: string) =>
  fromReportDate(value)?.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) ?? value;

/** "Diwali" / "Bhai Duj (optional holiday)" */
const holidayText = (day: TAttendanceDay) =>
  day.holiday ? `${day.holiday.name}${day.holiday.kind === "optional" ? " (optional holiday)" : ""}` : "";

/** The short text for a cell: hours worked, A (Absent), WO (Week Off), H (Holiday) or — (not counted). */
export const attendanceCellText = (cell: TAttendanceCell) => {
  if (cell.minutes) return formatWorklogDuration(cell.minutes);
  if (cell.status === "absent") return "A";
  if (cell.status === "week_off") return "WO";
  if (cell.status === "holiday") return "H";
  if (cell.status === "upcoming") return "";
  return "—";
};

const CELL_CLASS: Record<TAttendanceCell["status"], string> = {
  present: "text-primary",
  absent: "bg-danger-subtle font-medium text-danger-primary",
  week_off: "bg-layer-1 text-placeholder",
  week_off_worked: "bg-accent-subtle text-accent-primary",
  holiday: "bg-label-yellow-bg font-medium text-label-yellow-text",
  holiday_worked: "bg-accent-subtle text-accent-primary",
  today: "text-placeholder",
  upcoming: "text-placeholder",
  not_joined: "text-placeholder",
  inactive: "text-placeholder",
};

const monthRange = (offset: number, today = new Date()) => {
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const last = offset === 0 ? today : new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  return { from_date: toReportDate(first), to_date: toReportDate(last) };
};

/** ". Holidays: Mon 09: Diwali, Tue 10: New Year" for a PDF week, or nothing. */
const weekHolidays = (week: TAttendanceDay[]) => {
  const names = week
    .filter((day) => day.holiday)
    .map((day) => `${dayLabel(day)} ${dayNumber(day)}: ${holidayText(day)}`);
  return names.length ? `. Holidays: ${names.join(", ")}` : "";
};

/** The days split Monday to Sunday, for the PDF (a whole month doesn't fit across a page). */
const weeksOf = (days: TAttendanceDay[]) => {
  const weeks: TAttendanceDay[][] = [];
  for (const day of days) {
    if (!weeks.length || day.weekday === 1) weeks.push([]);
    weeks[weeks.length - 1].push(day);
  }
  return weeks;
};

function Legend() {
  const items: [string, string, string][] = [
    ["7h 30m", "text-primary", "Hours worked"],
    ["A", "bg-danger-subtle text-danger-primary", "Absent: a working day with no time logged"],
    ["WO", "bg-layer-1 text-placeholder", "Week Off (Saturday, Sunday)"],
    ["H", "bg-label-yellow-bg text-label-yellow-text", "Holiday (from the Holidays list)"],
    ["2h", "bg-accent-subtle text-accent-primary", "Worked on a Week Off or holiday"],
    ["—", "text-placeholder", "Not counted: today, before joining, or disabled"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-caption-md-regular text-tertiary">
      {items.map(([sample, className, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex h-5 min-w-8 items-center justify-center rounded-sm border-[0.5px] border-subtle px-1 text-caption-md-medium",
              className
            )}
          >
            {sample}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}

export const AttendanceReport = observer(function AttendanceReport({ workspaceSlug }: Props) {
  const [filters, setFilters] = useState<TWorklogReportFilters>(() => getDefaultAttendanceFilters());
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<TWorklogReportSelection | null>(null);
  const { attendance, error, isLoading } = useAttendanceReport(workspaceSlug, filters);

  const days = useMemo(() => attendance?.days ?? [], [attendance]);
  const holidayDays = useMemo(() => days.filter((day) => day.holiday), [days]);
  const employees = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (attendance?.employees ?? []).filter(
      (employee) =>
        !query ||
        `${getWorklogUserName(employee)} ${employee.email} ${employee.display_name}`.toLowerCase().includes(query)
    );
  }, [attendance, search]);
  const totals = attendance?.totals;
  const daysWorked = (attendance?.employees ?? []).reduce((sum, e) => sum + e.summary.days_worked, 0);

  const openDay = (employee: TAttendanceEmployee, date: string) =>
    setSelection({
      user: { id: employee.id, name: getWorklogUserName(employee) },
      range: { from_date: date, to_date: date },
    });

  const exportPdf = useReportPdfExport(workspaceSlug, filters);
  const download = (format: TReportExportFormat) => {
    if (format !== "pdf") {
      window.open(worklogReportService.attendanceDownloadUrl(workspaceSlug, filters, format), "_self");
      return;
    }
    if (!attendance) return;
    const summaryTable: TReportPdfTable = {
      title: "Summary",
      columns: [
        { label: "Employee", flex: 2.4 },
        { label: "Present", align: "right" },
        { label: "Absent", align: "right" },
        { label: "Week Off", align: "right" },
        { label: "Worked on WO", align: "right" },
        { label: "Holidays", align: "right" },
        { label: "Total", align: "right", flex: 1.2 },
        { label: "Avg / day", align: "right", flex: 1.2 },
      ],
      rows: attendance.employees.map((employee) => [
        getWorklogUserName(employee),
        employee.summary.present,
        employee.summary.absent,
        employee.summary.week_off,
        employee.summary.week_off_worked,
        employee.summary.holidays,
        formatWorklogDuration(employee.summary.total_minutes),
        formatWorklogDuration(employee.summary.average_minutes),
      ]),
    };
    const weekTables: TReportPdfTable[] = weeksOf(attendance.days).map((week) => ({
      title: `Week of ${fullDate(week[0].date)}`,
      columns: [
        { label: "Employee", flex: 2.4 },
        ...week.map((day) => ({ label: `${dayLabel(day)} ${dayNumber(day)}`, align: "right" as const })),
        { label: "Week", align: "right" as const, flex: 1.2 },
      ],
      rows: attendance.employees.map((employee) => [
        getWorklogUserName(employee),
        ...week.map((day) => attendanceCellText(employee.days[day.date])),
        formatWorklogDuration(week.reduce((sum, day) => sum + employee.days[day.date].minutes, 0)),
      ]),
      note: `A = Absent, WO = Week Off, H = Holiday, — = not counted (today, before joining, or disabled)${weekHolidays(week)}`,
    }));
    void exportPdf({
      title: "Attendance report",
      cards: [
        { label: "Employees", value: attendance.totals.employees },
        { label: "Total time", value: formatWorklogDuration(attendance.totals.total_minutes) },
        { label: "Present days", value: attendance.totals.present },
        { label: "Absent days", value: attendance.totals.absent },
      ],
      charts: [],
      tables: [summaryTable, ...weekTables],
      withRecords: false,
    });
  };

  return (
    <div className="flex w-full flex-col gap-5 px-page-x py-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <WorklogReportFilters
            filters={filters}
            onChange={setFilters}
            projectMode="hidden"
            showStatus={false}
            scope={attendance?.scope}
          />
          <Button
            stretch="auto"
            variant="ghost"
            size="sm"
            label="This month"
            onClick={() => setFilters({ ...filters, ...monthRange(0) })}
          />
          <Button
            stretch="auto"
            variant="ghost"
            size="sm"
            label="Last month"
            onClick={() => setFilters({ ...filters, ...monthRange(-1) })}
          />
        </div>
        <ReportExportMenu
          disabled={!attendance?.employees.length}
          formats={["xlsx", "csv", "pdf"]}
          onExport={download}
        />
      </div>
      {attendance && !attendance.scope.can_view_others && <OwnTimeNotice />}
      {error && (
        <p className="text-body-xs-regular text-danger-primary">
          {Object.values(error)[0] ?? "Couldn't load the report. Try again."}
        </p>
      )}

      {!attendance && isLoading ? (
        <Loader className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Loader.Item height="72px" width="100%" />
            <Loader.Item height="72px" width="100%" />
            <Loader.Item height="72px" width="100%" />
          </div>
          <Loader.Item height="320px" width="100%" />
        </Loader>
      ) : !attendance?.employees.length ? (
        <div className="flex flex-col items-center rounded-lg border-[0.5px] border-subtle py-12">
          <EmptyStateCompact
            title="No one to show"
            description="Try a different date range, department, project manager or users."
            assetKey="worklog"
            assetClassName="size-20"
            align="center"
          />
        </div>
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", isLoading && "opacity-60")}>
          <div className="flex flex-wrap gap-3">
            <Stat label="Employees" value={totals?.employees ?? 0} />
            <Stat label="Working days so far" value={totals?.working_days ?? 0} />
            <Stat label="Holidays" value={totals?.holidays ?? 0} />
            <Stat label="Total time" value={formatWorklogDuration(totals?.total_minutes ?? 0)} />
            <Stat label="Total hours" value={minutesToHours(totals?.total_minutes ?? 0)} />
            <Stat label="Present days" value={totals?.present ?? 0} />
            <Stat label="Absent days" value={totals?.absent ?? 0} />
            <Stat
              label="Average per day worked"
              value={formatWorklogDuration(daysWorked ? (totals?.total_minutes ?? 0) / daysWorked : 0)}
            />
          </div>

          <Section
            title="Attendance"
            hint={`${fullDate(attendance.from_date)} – ${fullDate(attendance.to_date)} · days in ${attendance.timezone} · click hours to see the entries`}
            action={
              <div className="w-56">
                <InputGroup size="md">
                  <span className="flex items-center pl-2 text-tertiary">
                    <SearchOutline className="size-3.5" />
                  </span>
                  <Input
                    size="md"
                    aria-label="Search employees"
                    placeholder="Search employees"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </InputGroup>
              </div>
            }
          >
            {holidayDays.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-label-yellow-bg px-3 py-2 text-body-xs-regular text-label-yellow-text">
                <span className="font-medium">Holidays in this period:</span>
                {holidayDays.map((day, index) => (
                  <span key={day.date}>
                    {fullDate(day.date)} {holidayText(day)}
                    {index < holidayDays.length - 1 && " ·"}
                  </span>
                ))}
              </p>
            )}
            <Legend />
            <div className="overflow-hidden rounded-lg border-[0.5px] border-subtle">
              {/* one scroll area, with visible scrollbars (the app hides them unless asked) */}
              <div className="vertical-scrollbar horizontal-scrollbar scrollbar-md max-h-[70vh] overflow-auto">
                <table
                  className="border-separate border-spacing-0 text-left text-body-xs-regular"
                  style={{ minWidth: 260 + days.length * 64 + 6 * 84 }}
                >
                  <caption className="sr-only">
                    Attendance of each employee by day, with their present, absent, week off and holiday days and hours
                  </caption>
                  <thead className="sticky top-0 z-[2] bg-layer-1">
                    <tr className="text-caption-md-medium text-secondary">
                      <th
                        className={cn(
                          HEAD_CELL,
                          "sticky left-0 z-[3] w-[220px] min-w-[200px] border-r-[0.5px] border-subtle bg-layer-1 shadow-[4px_0_6px_-4px_rgba(0,0,0,0.15)]"
                        )}
                      >
                        Employee
                      </th>
                      {days.map((day) => (
                        <th
                          key={day.date}
                          scope="col"
                          className={cn(
                            "max-w-[72px] min-w-[64px] px-1 py-2 text-center align-top font-medium",
                            day.is_week_off && "text-placeholder",
                            day.is_holiday && "bg-label-yellow-bg text-label-yellow-text"
                          )}
                          title={day.holiday ? `${fullDate(day.date)} · ${holidayText(day)}` : fullDate(day.date)}
                        >
                          <span className="block">{dayLabel(day)}</span>
                          <span className="block text-body-xs-medium text-primary">{dayNumber(day)}</span>
                          {day.holiday && (
                            <span
                              className={cn(
                                "mx-auto block max-w-[64px] truncate text-caption-sm-regular",
                                day.is_holiday ? "text-label-yellow-text" : "text-tertiary"
                              )}
                            >
                              {day.holiday.name}
                            </span>
                          )}
                        </th>
                      ))}
                      {["Present", "Absent", "Week Off", "Holidays", "Total", "Avg / day"].map((label) => (
                        <th key={label} scope="col" className={cn(HEAD_CELL, "text-right whitespace-nowrap")}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((employee) => (
                      <tr key={employee.id} className="hover:bg-layer-transparent-hover">
                        <th
                          scope="row"
                          className="font-normal sticky left-0 z-[1] border-t-[0.5px] border-r-[0.5px] border-subtle bg-surface-1 px-3 py-2 text-left shadow-[4px_0_6px_-4px_rgba(0,0,0,0.15)]"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <UserCell user={employee} />
                            {!employee.is_active && (
                              <span className="shrink-0 text-caption-md-regular text-tertiary">(disabled)</span>
                            )}
                          </span>
                        </th>
                        {days.map((day) => {
                          const cell = employee.days[day.date];
                          const text = attendanceCellText(cell);
                          const label = `${fullDate(day.date)}${day.holiday ? ` (${holidayText(day)})` : ""}: ${STATUS_TEXT[cell.status]}${cell.minutes ? `, ${formatWorklogDuration(cell.minutes)}` : ""}`;
                          return (
                            <td
                              key={day.date}
                              className={cn(
                                "border-t-[0.5px] border-l-[0.5px] border-subtle px-1 py-2 text-center whitespace-nowrap",
                                CELL_CLASS[cell.status]
                              )}
                              title={label}
                            >
                              {cell.minutes ? (
                                <button
                                  type="button"
                                  className="hover:underline"
                                  aria-label={`${getWorklogUserName(employee)}, ${label}`}
                                  onClick={() => openDay(employee, day.date)}
                                >
                                  {text}
                                </button>
                              ) : (
                                <span aria-label={label}>{text}</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="border-t-[0.5px] border-l-[0.5px] border-subtle px-3 py-2 text-right">
                          {employee.summary.present}
                        </td>
                        <td
                          className={cn(
                            "border-t-[0.5px] border-subtle px-3 py-2 text-right",
                            employee.summary.absent > 0 && "font-medium text-danger-primary"
                          )}
                        >
                          {employee.summary.absent}
                        </td>
                        <td className="border-t-[0.5px] border-subtle px-3 py-2 text-right">
                          {employee.summary.week_off}
                          {employee.summary.week_off_worked > 0 && (
                            <span className="text-accent-primary"> ({employee.summary.week_off_worked} worked)</span>
                          )}
                        </td>
                        <td className="border-t-[0.5px] border-subtle px-3 py-2 text-right">
                          {employee.summary.holidays}
                          {employee.summary.holiday_worked > 0 && (
                            <span className="text-accent-primary"> ({employee.summary.holiday_worked} worked)</span>
                          )}
                        </td>
                        <td className="border-t-[0.5px] border-subtle px-3 py-2 text-right font-medium whitespace-nowrap">
                          {formatWorklogDuration(employee.summary.total_minutes)}
                        </td>
                        <td className="border-t-[0.5px] border-subtle px-3 py-2 text-right whitespace-nowrap">
                          {formatWorklogDuration(employee.summary.average_minutes)}
                        </td>
                      </tr>
                    ))}
                    {employees.length === 0 && (
                      <tr>
                        <td colSpan={days.length + 7} className="px-4 py-6 text-center text-tertiary">
                          No employee matches “{search}”.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-layer-1 text-body-xs-medium text-primary">
                    <tr>
                      <th
                        scope="row"
                        className="sticky left-0 z-[1] border-t-[0.5px] border-r-[0.5px] border-subtle bg-layer-1 px-3 py-2.5 text-left shadow-[4px_0_6px_-4px_rgba(0,0,0,0.15)]"
                      >
                        Total hours
                      </th>
                      {days.map((day) => (
                        <td
                          key={day.date}
                          className="border-t-[0.5px] border-subtle px-1 py-2.5 text-center whitespace-nowrap"
                        >
                          {day.total_minutes ? formatWorklogDuration(day.total_minutes) : ""}
                        </td>
                      ))}
                      <td className="border-t-[0.5px] border-subtle px-3 py-2.5 text-right">{totals?.present}</td>
                      <td className="border-t-[0.5px] border-subtle px-3 py-2.5 text-right">{totals?.absent}</td>
                      <td className="border-t-[0.5px] border-subtle" />
                      <td className="border-t-[0.5px] border-subtle" />
                      <td className="border-t-[0.5px] border-subtle px-3 py-2.5 text-right whitespace-nowrap">
                        {formatWorklogDuration(totals?.total_minutes ?? 0)}
                      </td>
                      <td className="border-t-[0.5px] border-subtle" />
                    </tr>
                    <tr className="text-secondary">
                      <th
                        scope="row"
                        className="sticky left-0 z-[1] border-r-[0.5px] border-subtle bg-layer-1 px-3 py-2 text-left font-medium shadow-[4px_0_6px_-4px_rgba(0,0,0,0.15)]"
                      >
                        Present that day
                      </th>
                      {days.map((day) => (
                        <td key={day.date} className="px-1 py-2 text-center">
                          {day.is_week_off || day.is_holiday
                            ? day.present || ""
                            : day.is_upcoming
                              ? ""
                              : `${day.present}/${day.present + day.absent}`}
                        </td>
                      ))}
                      <td colSpan={6} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </Section>
        </div>
      )}

      <WorklogReportDetailModal
        workspaceSlug={workspaceSlug}
        filters={filters}
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  );
});
