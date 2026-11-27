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

/** Up to this many bars share the chart's width; past it each bar gets BAR_SLOT pixels and the chart scrolls sideways
 * in its box (CHART_BOX_CLASSNAME), rather than 200 projects squeezed into a few pixels each. */
const FIT_BARS = 12;
const BAR_SLOT = 112;

/** characters a label line holds under its bar, and the lines it may take (the rest ends in …; hover shows it all) */
const LABEL_LINE_CHARS = 16;
const LABEL_LINES = 3;

/** A bar's label as at most LABEL_LINES lines of LABEL_LINE_CHARS, broken between words; too long → … at the end. */
export const wrapChartLabel = (text: string, max = LABEL_LINE_CHARS, maxLines = LABEL_LINES) => {
  const lines: string[] = [];
  let current = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    let rest = word;
    // a word longer than a line is cut across lines
    while (rest.length > max) {
      if (current) lines.push(current);
      current = "";
      lines.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    if (!rest) continue;
    if (!current) current = rest;
    else if (`${current} ${rest}`.length <= max) current = `${current} ${rest}`;
    else {
      lines.push(current);
      current = rest;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, max - 1).trimEnd()}…`;
  return kept;
};

/** The x labels: names (projects, people) on up to three lines under their bar, the whole name on hover. */
function WrappedXAxisTick(props: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const { x = 0, y = 0, payload } = props;
  const text = String(payload?.value ?? "");
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{text}</title>
      <text y={0} textAnchor="middle" className="fill-tertiary text-12">
        {wrapChartLabel(text).map((line, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- the lines of one label, in order
          <tspan key={index} x={0} dy={index === 0 ? 16 : 14}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

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
    <div style={{ minWidth: data.length > FIT_BARS ? data.length * BAR_SLOT : undefined }}>
      <BarChart
        className="h-[320px] w-full"
        margin={{ top: 20, right: 16, bottom: 60, left: 10 }}
        data={data}
        bars={bars}
        // every bar keeps its label (three lines fit its slot); the axis title sits below them
        xAxis={{ key: "name", label: xAxisLabel, interval: 0, dy: 58 }}
        customTicks={{ x: WrappedXAxisTick as React.ComponentType<unknown> }}
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
    </div>
  );
}
