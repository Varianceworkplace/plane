/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { setToast } from "@plane/blocks/toast";
import { STATE_GROUPS } from "@plane/constants";
import { renderFormattedDate } from "@plane/utils";
// components
import { formatWorklogDuration, getWorklogUserName } from "@/components/worklogs/helpers";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
// local imports
import type { TReportChart } from "./analytics-charts";
import { toReportDate, useWorklogReportOptions, worklogReportService } from "./helpers";
import type { TReportPdf, TReportPdfTable } from "./report-pdf";
import type { TWorklogReportFilters } from "./types";

// the most recent worklogs listed in a PDF; Excel carries all of them
const RECORD_LIMIT = 100;

const RECORD_COLUMNS: TReportPdfTable["columns"] = [
  { label: "Date", flex: 1.1 },
  { label: "Employee", flex: 1.5 },
  { label: "Project", flex: 1.3 },
  { label: "Task", flex: 2.4 },
  { label: "Status", flex: 1 },
  { label: "Hours", flex: 0.8, align: "right" },
  { label: "Work description", flex: 2.4 },
];

export type TReportPdfInput = {
  title: string;
  cards: TReportPdf["cards"];
  charts: TReportChart[];
  tables?: TReportPdfTable[];
  /** list the worklogs behind the report (default) */
  withRecords?: boolean;
};

const saveFile = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const describePeriod = (filters: TWorklogReportFilters) => {
  const from = (filters.from_date && renderFormattedDate(filters.from_date)) || null;
  const to = (filters.to_date && renderFormattedDate(filters.to_date)) || null;
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "All time";
};

/** Long names like "first.last" wrap after the dot instead of being hyphenated mid-word. */
const wrapAtDots = (text: string) => text.replaceAll(".", ".\u200B");

/** "Projects: Alpha, Beta", or nothing when the filter is empty. */
const named = (label: string, names: (string | undefined)[]) =>
  names.length ? [`${label}: ${names.map((name) => name ?? "Unknown").join(", ")}`] : [];

const pick = (ids: string[] | undefined, list: { id: string; name: string }[] | undefined) =>
  (ids ?? []).map((id) => list?.find((item) => item.id === id)?.name);

/** Exports the report on screen as a PDF: the given cards, charts and tables, plus its worklogs. */
export const useReportPdfExport = (workspaceSlug: string, filters: TWorklogReportFilters) => {
  const { getProjectById } = useProject();
  const {
    workspace: { getWorkspaceMemberDetails },
  } = useMember();
  const options = useWorklogReportOptions(workspaceSlug);

  const describeFilters = () => {
    return [
      ...named(
        "Projects",
        filters.project.map((id) => getProjectById(id)?.name)
      ),
      ...named(
        "Users",
        filters.logged_by.map((id) => {
          const member = getWorkspaceMemberDetails(id)?.member;
          return member ? getWorklogUserName(member) : undefined;
        })
      ),
      ...named("Departments", pick(filters.team, options?.departments)),
      ...named(
        "Project managers",
        pick(
          filters.pm,
          options?.project_managers.map((pm) => ({ id: pm.id, name: pm.display_name }))
        )
      ),
      ...named("Groups", pick(filters.group, options?.groups)),
      ...named(
        "Task status",
        filters.state_group.map((group) => STATE_GROUPS[group]?.label)
      ),
      ...(filters.issue?.length ? [`${filters.issue.length} work items`] : []),
    ];
  };

  return async (input: TReportPdfInput) => {
    try {
      const tables = [...(input.tables ?? [])];
      if (input.withRecords !== false) {
        const detail = await worklogReportService.worklogs(workspaceSlug, filters, 1, RECORD_LIMIT, undefined, {
          ordering: "-work_date",
        });
        tables.push({
          title: "Detailed records",
          columns: RECORD_COLUMNS,
          rows: detail.results.map((entry) => [
            (entry.work_date && renderFormattedDate(entry.work_date)) || "",
            wrapAtDots(getWorklogUserName(entry.logged_by)),
            entry.project.identifier,
            `${entry.project.identifier}-${entry.issue.sequence_id} ${entry.issue.name}`,
            entry.state?.name ?? "",
            formatWorklogDuration(entry.duration),
            entry.description,
          ]),
          note:
            detail.total_count > detail.results.length
              ? `The ${detail.results.length} most recent of ${detail.total_count} worklogs. Export to Excel for all of them.`
              : undefined,
        });
      }
      const [{ pdf }, { ReportPdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./report-pdf"),
      ]);
      const report: TReportPdf = {
        title: input.title,
        period: describePeriod(filters),
        filters: describeFilters(),
        cards: input.cards,
        charts: input.charts,
        tables,
      };
      const blob = await pdf(<ReportPdfDocument report={report} />).toBlob();
      const name = input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      saveFile(blob, `${workspaceSlug}-${name}-${toReportDate(new Date())}.pdf`);
    } catch {
      setToast({
        type: "error",
        title: "PDF not created",
        message: "Something went wrong while building it. Try again.",
      });
    }
  };
};
