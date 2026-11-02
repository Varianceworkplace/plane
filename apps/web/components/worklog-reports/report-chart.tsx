/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { useTheme } from "next-themes";
// plane imports
import { Card } from "@plane/blocks/card";
import { BarChart } from "@plane/blocks/charts/bar-chart";
import { CHART_COLOR_PALETTES } from "@plane/constants";
import type { TBarItem } from "@plane/types";
// components
import { generateExtendedColors } from "@/components/chart/utils";
import { formatWorklogDuration } from "@/components/worklogs/helpers";

export type TReportChartRow = { key: string; name: string; [series: string]: string | number };

export type TReportChartSeries = { key: string; label: string };

type Props = {
  data: TReportChartRow[];
  /** One series draws plain bars; several stack per row. */
  series: TReportChartSeries[];
  xAxisLabel: string;
  /** Called with the clicked row's key */
  onSelect?: (key: string) => void;
};

/** Hours per row as a bar chart; bars open the drill-down when `onSelect` is set. */
export function WorklogReportChart(props: Props) {
  const { data, series, xAxisLabel, onSelect } = props;
  const { resolvedTheme } = useTheme();

  const bars = useMemo<TBarItem<string>[]>(() => {
    const palette = CHART_COLOR_PALETTES[0]?.[resolvedTheme === "dark" ? "dark" : "light"] ?? [];
    const colors = generateExtendedColors(palette, series.length);
    const keys = series.map((s) => s.key);
    // round only the outer ends of each stack
    const filled = (row: TReportChartRow) => keys.filter((key) => Number(row[key]) > 0);
    const firstFilled = (row: TReportChartRow) => filled(row)[0];
    const lastFilled = (row: TReportChartRow) => filled(row).at(-1);
    return series.map((item, index) => ({
      key: item.key,
      label: item.label,
      stackId: "hours",
      fill: colors[index] ?? palette[0],
      textClassName: "",
      showPercentage: false,
      showTopBorderRadius: (barKey: string, payload: TReportChartRow) => lastFilled(payload) === barKey,
      showBottomBorderRadius: (barKey: string, payload: TReportChartRow) => firstFilled(payload) === barKey,
      onClick: onSelect ? (payload: TReportChartRow) => payload?.key && onSelect(payload.key) : undefined,
    }));
  }, [series, resolvedTheme, onSelect]);

  const labels = useMemo(() => Object.fromEntries(series.map((s) => [s.key, s.label])), [series]);

  return (
    <BarChart
      className="h-[320px] w-full"
      margin={{ top: 20, right: 16, bottom: 30, left: 10 }}
      data={data}
      bars={bars}
      xAxis={{ key: "name", label: xAxisLabel }}
      yAxis={{ key: "hours", label: "Hours", allowDecimals: true, dx: -20 }}
      barSize={data.length > 12 ? 16 : 32}
      legend={series.length > 1 ? { align: "left", verticalAlign: "bottom", layout: "horizontal" } : undefined}
      customTooltipContent={({ active, label, payload }) => {
        const items = ((payload ?? []) as { dataKey?: string; value?: number; color?: string }[]).filter(
          (item) => item.dataKey && Number(item.value) > 0
        );
        if (!active || !items.length) return null;
        const total = items.reduce((sum, item) => sum + Number(item.value), 0);
        return (
          <Card className="flex w-[14rem] flex-col" spacing="sm">
            <p className="truncate border-b border-subtle pb-2 text-11 font-medium text-primary">{label}</p>
            {items.map((item) => (
              <div key={item.dataKey} className="flex items-center justify-between gap-2 text-11">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-xs" style={{ backgroundColor: item.color }} />
                  <span className="truncate text-tertiary">{labels[item.dataKey as string]}</span>
                </span>
                <span className="shrink-0 font-medium text-secondary">
                  {formatWorklogDuration(Number(item.value) * 60)}
                </span>
              </div>
            ))}
            {items.length > 1 && (
              <div className="flex items-center justify-between border-t border-subtle pt-2 text-11 font-medium">
                <span className="text-tertiary">Total</span>
                <span className="text-primary">{formatWorklogDuration(total * 60)}</span>
              </div>
            )}
            {onSelect && <p className="text-11 text-placeholder">Click to see worklogs</p>}
          </Card>
        );
      }}
    />
  );
}
