/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
// plane imports
import { STATE_GROUPS } from "@plane/constants";
import type { TStateGroups } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
// components
import { getWorklogUserName } from "@/components/worklogs/helpers";
// local imports
import type { TChartRow, TDonutSlice, TProgressItem, TReportChart } from "./analytics-charts";
import { ReportChartGrid, shortLabel } from "./analytics-charts";
import type { TWorklogAnalytics } from "./types";

// most rows a bar chart shows; the tables below list everything
const MAX_ROWS = 15;
// people drawn as their own stack segment in "hours by project", the rest add up as "Others"
const MAX_PEOPLE = 8;

const toHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export const COMPLETION_SERIES = [
  { key: "completed", label: "Completed", color: STATE_GROUPS.completed.color },
  { key: "pending", label: "Pending", color: STATE_GROUPS.started.color },
];

const STATUS_ORDER: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

export const statusSlices = (groups: Record<TStateGroups, number>): TDonutSlice[] =>
  STATUS_ORDER.map((group) => ({
    key: group,
    label: STATE_GROUPS[group].label,
    value: groups[group] ?? 0,
    color: STATE_GROUPS[group].color,
  }));

export const completionSlices = (completed: number, pending: number): TDonutSlice[] => [
  { key: "completed", label: "Completed", value: completed, color: STATE_GROUPS.completed.color },
  { key: "pending", label: "Pending", value: pending, color: STATE_GROUPS.started.color },
];

export const milestoneItems = (milestones: TWorklogAnalytics["milestones"]): TProgressItem[] =>
  milestones.map((milestone) => {
    const due = milestone.target_date ? `due ${renderFormattedDate(milestone.target_date)}` : "no end date";
    return {
      key: milestone.id,
      title: milestone.title,
      subtitle: `${milestone.project_name} · ${milestone.is_overdue ? "overdue, " : ""}${due}`,
      progress: milestone.progress,
      detail: milestone.total_items
        ? `${milestone.completed_items}/${milestone.total_items}`
        : milestone.status || undefined,
      tone: milestone.is_completed ? "success" : milestone.is_overdue ? "danger" : "brand",
    };
  });

/** Productivity per person who logged time, best first. */
export const buildProductivityRows = (employees: TWorklogAnalytics["employees"]): TChartRow[] =>
  employees
    .filter((person) => person.productivity !== null)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a filtered copy
    .sort((a, b) => (b.productivity ?? 0) - (a.productivity ?? 0))
    .slice(0, MAX_ROWS)
    .map((person) => ({
      key: person.id,
      name: shortLabel(getWorklogUserName(person)),
      title: getWorklogUserName(person),
      productivity: person.productivity ?? 0,
    }));

/** True when there's a non-zero productivity to draw. */
export const hasProductivity = (rows: TChartRow[]) => rows.some((row) => Number(row.productivity) > 0);

export const PRODUCTIVITY_HINT = "Expected hours of completed work against hours logged";
export const PRODUCTIVITY_EMPTY = "No completed work items with expected time in this period.";

const projectName = (project: TWorklogAnalytics["projects"][number]) => project.identifier || project.name;

/** Task completion, people's hours, status split and milestones per project. */
export const projectWiseCharts = (
  analytics: TWorklogAnalytics,
  onSelectProject?: (id: string) => void
): TReportChart[] => {
  const completionRows = analytics.projects
    .filter((project) => project.tasks_total > 0)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a filtered copy
    .sort((a, b) => b.tasks_total - a.tasks_total)
    .slice(0, MAX_ROWS)
    .map<TChartRow>((project) => ({
      key: project.id,
      name: projectName(project),
      title: project.name,
      completed: project.tasks_completed,
      pending: project.tasks_pending,
    }));

  const names = new Map(analytics.employees.map((person) => [person.id, getWorklogUserName(person)]));
  const totals = new Map<string, number>();
  for (const project of analytics.projects)
    for (const person of project.people) totals.set(person.id, (totals.get(person.id) ?? 0) + person.worked_duration);
  const top = [...totals.entries()]
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a spread copy
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PEOPLE)
    .map(([id]) => id);
  const hasOthers = totals.size > top.length;
  const peopleRows = analytics.projects
    .filter((project) => project.worked_duration > 0)
    .slice(0, MAX_ROWS)
    .map((project) => {
      const row: TChartRow = { key: project.id, name: projectName(project), title: project.name };
      let others = 0;
      for (const person of project.people) {
        if (top.includes(person.id)) row[person.id] = toHours(person.worked_duration);
        else others += person.worked_duration;
      }
      if (hasOthers) row.others = toHours(others);
      return row;
    });
  const peopleSeries = top.map((id) => ({ key: id, label: names.get(id) ?? "Someone" }));
  if (hasOthers) peopleSeries.push({ key: "others", label: "Others" });

  const statuses = statusSlices(analytics.status_groups);
  const statusTotal = statuses.reduce((sum, slice) => sum + slice.value, 0);

  return [
    {
      key: "completion",
      kind: "bar",
      title: "Task completion by project",
      hint: "Completed and pending work items in the period",
      isEmpty: !completionRows.length,
      emptyText: "No work items for these filters.",
      rows: completionRows,
      series: COMPLETION_SERIES,
      format: "count",
      xAxisLabel: "Projects",
      onSelect: onSelectProject,
      selectHint: "Click to see this project",
    },
    {
      key: "status",
      kind: "donut",
      title: "Task status distribution",
      hint: "Current status of the period's work items",
      isEmpty: !statusTotal,
      emptyText: "No work items for these filters.",
      slices: statuses,
      format: "count",
      centerText: `${statusTotal}`,
    },
    {
      key: "people",
      kind: "bar",
      wide: true,
      title: "Employee hours by project",
      hint: "Who worked on each project",
      isEmpty: !peopleRows.length,
      emptyText: "No time logged for these filters.",
      rows: peopleRows,
      series: peopleSeries,
      format: "hours",
      xAxisLabel: "Projects",
      onSelect: onSelectProject,
      selectHint: "Click to see this project",
    },
    {
      key: "milestones",
      kind: "progress",
      wide: true,
      title: "Milestone progress",
      hint: "Share of each milestone's work items that are done",
      isEmpty: !analytics.milestones.length,
      emptyText: "No milestones for these filters.",
      items: milestoneItems(analytics.milestones),
    },
  ];
};

/** Task completion, completed vs pending, productivity and expected vs worked hours per person. */
export const userWiseCharts = (analytics: TWorklogAnalytics): TReportChart[] => {
  const people = analytics.employees.map((person) => ({ ...person, name: getWorklogUserName(person) }));
  const completionRows = people
    .filter((person) => person.tasks_assigned > 0)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a filtered copy
    .sort((a, b) => b.tasks_assigned - a.tasks_assigned)
    .slice(0, MAX_ROWS)
    .map<TChartRow>((person) => ({
      key: person.id,
      name: shortLabel(person.name),
      title: person.name,
      completed: person.tasks_completed,
      pending: person.tasks_pending,
    }));
  const hoursRows = people
    .filter((person) => person.expected_duration > 0 || person.worked_duration > 0)
    .slice(0, MAX_ROWS)
    .map<TChartRow>((person) => ({
      key: person.id,
      name: shortLabel(person.name),
      title: person.name,
      expected: toHours(person.expected_duration),
      worked: toHours(person.worked_duration),
    }));
  const productivityRows = buildProductivityRows(analytics.employees);
  const { tasks_completed: completed, tasks_pending: pending } = analytics.summary;

  return [
    {
      key: "completion",
      kind: "bar",
      title: "Task completion by employee",
      hint: "Completed and pending work items assigned to each person",
      isEmpty: !completionRows.length,
      emptyText: "No assigned work items for these filters.",
      rows: completionRows,
      series: COMPLETION_SERIES,
      format: "count",
      xAxisLabel: "Employees",
    },
    {
      key: "completed-pending",
      kind: "donut",
      title: "Completed vs pending tasks",
      hint: "All work items in the period",
      isEmpty: !completed && !pending,
      emptyText: "No work items for these filters.",
      slices: completionSlices(completed, pending),
      format: "count",
      centerText: `${completed + pending}`,
    },
    {
      key: "expected-worked",
      kind: "bar",
      wide: true,
      title: "Expected vs actual hours",
      hint: "Expected time of assigned work items and time logged",
      isEmpty: !hoursRows.length,
      emptyText: "No expected or logged time for these filters.",
      rows: hoursRows,
      series: [
        { key: "expected", label: "Expected" },
        { key: "worked", label: "Worked" },
      ],
      format: "hours",
      xAxisLabel: "Employees",
      grouped: true,
    },
    {
      key: "productivity",
      kind: "bar",
      wide: true,
      title: "Productivity by employee",
      hint: PRODUCTIVITY_HINT,
      isEmpty: !hasProductivity(productivityRows),
      emptyText: PRODUCTIVITY_EMPTY,
      rows: productivityRows,
      series: [{ key: "productivity", label: "Productivity" }],
      format: "percent",
      xAxisLabel: "Employees",
    },
  ];
};

export function ProjectWiseInsights(props: { analytics: TWorklogAnalytics; onSelectProject: (id: string) => void }) {
  const { analytics, onSelectProject } = props;
  const charts = useMemo(() => projectWiseCharts(analytics, onSelectProject), [analytics, onSelectProject]);
  return <ReportChartGrid charts={charts} />;
}

export function UserWiseInsights(props: { analytics: TWorklogAnalytics }) {
  const charts = useMemo(() => userWiseCharts(props.analytics), [props.analytics]);
  return <ReportChartGrid charts={charts} />;
}
