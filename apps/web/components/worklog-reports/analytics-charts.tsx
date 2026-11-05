/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTheme } from "next-themes";
// plane imports
import { LinearProgress } from "@makeplane/propel/components/linear-progress";
import { Card } from "@plane/blocks/card";
import { BarChart } from "@plane/blocks/charts/bar-chart";
import { LineChart } from "@plane/blocks/charts/line-chart";
import { PieChart } from "@plane/blocks/charts/pie-chart";
import { CHART_COLOR_PALETTES } from "@plane/constants";
import type { TBarItem, TLineItem } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { generateExtendedColors } from "@/components/chart/utils";
import { formatWorklogDuration } from "@/components/worklogs/helpers";

/** hours: the values are hours (shown as "1h 30m"); count: plain numbers; percent: 0-100 */
export type TChartValueFormat = "hours" | "count" | "percent";

/** `name` labels the axis; a string `title` key, when set, is what the tooltip shows instead. */
export type TChartRow = { key: string; name: string; [series: string]: string | number };

/** Axis labels collide when long: cut to `max` characters (the full text goes in the row's `title`). */
export const shortLabel = (text: string, max = 14) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The hovered row's full title, or the axis label. */
const tooltipTitle = (label: string, payload: unknown) =>
  String(((payload as { payload?: TChartRow }[] | undefined)?.[0]?.payload?.title ?? label) || "");

export type TChartSeries = { key: string; label: string; color?: string };

export const formatChartValue = (value: number, format: TChartValueFormat) => {
  if (format === "hours") return formatWorklogDuration(value * 60);
  if (format === "percent") return `${Math.round(value)}%`;
  return `${value}`;
};

const Y_LABEL: Record<TChartValueFormat, string> = { hours: "Hours", count: "Count", percent: "%" };

/** Theme palette colors for series without their own color. */
const useSeriesColors = (series: TChartSeries[]) => {
  const { resolvedTheme } = useTheme();
  return useMemo(() => {
    const palette = CHART_COLOR_PALETTES[0]?.[resolvedTheme === "dark" ? "dark" : "light"] ?? [];
    const colors = generateExtendedColors(palette, series.length);
    return series.map((item, index) => item.color ?? colors[index] ?? palette[0]);
  }, [series, resolvedTheme]);
};

type TTooltipItem = { dataKey?: string; value?: number; color?: string; stroke?: string; fill?: string };

function ChartTooltip(props: {
  label: string;
  items: TTooltipItem[];
  labels: Record<string, string>;
  format: TChartValueFormat;
  showTotal: boolean;
  hint?: string;
}) {
  const { label, items, labels, format, showTotal, hint } = props;
  const total = items.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
  return (
    <Card className="flex w-[15rem] flex-col" spacing="sm">
      <p className="truncate border-b border-subtle pb-2 text-11 font-medium text-primary">{label}</p>
      {items.map((item) => (
        <div key={item.dataKey} className="flex items-center justify-between gap-2 text-11">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-xs"
              style={{ backgroundColor: item.color ?? item.stroke ?? item.fill }}
            />
            <span className="truncate text-tertiary">{labels[item.dataKey as string] ?? item.dataKey}</span>
          </span>
          <span className="shrink-0 font-medium text-secondary">{formatChartValue(Number(item.value), format)}</span>
        </div>
      ))}
      {showTotal && items.length > 1 && (
        <div className="flex items-center justify-between border-t border-subtle pt-2 text-11 font-medium">
          <span className="text-tertiary">Total</span>
          <span className="text-primary">{formatChartValue(total, format)}</span>
        </div>
      )}
      {hint && <p className="text-11 text-placeholder">{hint}</p>}
    </Card>
  );
}

/** A titled card around one chart, with a message instead of the chart when there's nothing to draw. */
export function ChartCard(props: {
  title: string;
  hint?: string;
  isEmpty?: boolean;
  emptyText?: string;
  className?: string;
  children: ReactNode;
}) {
  const { title, hint, isEmpty, emptyText = "No data for these filters.", className, children } = props;
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-3 rounded-lg border-[0.5px] border-subtle bg-layer-1 p-4", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-body-sm-semibold text-primary">{title}</h3>
        {hint && <span className="text-body-xs-regular text-tertiary">{hint}</span>}
      </div>
      {isEmpty ? (
        <div className="grid h-[260px] place-items-center text-center text-body-xs-regular text-placeholder">
          {emptyText}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/** Bars per row: one series draws plain bars, several stack (or stand side by side when `grouped`). */
export function ReportBarChart(props: {
  data: TChartRow[];
  series: TChartSeries[];
  format: TChartValueFormat;
  xAxisLabel: string;
  grouped?: boolean;
  onSelect?: (key: string) => void;
  selectHint?: string;
}) {
  const { data, series, format, xAxisLabel, grouped = false, onSelect, selectHint } = props;
  const colors = useSeriesColors(series);

  const bars = useMemo<TBarItem<string>[]>(() => {
    const keys = series.map((s) => s.key);
    const filled = (row: TChartRow) => keys.filter((key) => Number(row[key]) > 0);
    return series.map((item, index) => ({
      key: item.key,
      label: item.label,
      stackId: grouped ? item.key : "stack",
      fill: colors[index],
      textClassName: "",
      showPercentage: false,
      // round only the outer ends of a stack; grouped bars each round their top
      showTopBorderRadius: (barKey: string, payload: TChartRow) => grouped || filled(payload).at(-1) === barKey,
      showBottomBorderRadius: (barKey: string, payload: TChartRow) => !grouped && filled(payload)[0] === barKey,
      onClick: onSelect ? (payload: TChartRow) => payload?.key && onSelect(payload.key) : undefined,
    }));
  }, [series, colors, grouped, onSelect]);

  const labels = useMemo(() => Object.fromEntries(series.map((s) => [s.key, s.label])), [series]);
  const perRow = grouped ? series.length : 1;

  return (
    <BarChart
      className="h-[280px] w-full"
      margin={{ top: 16, right: 16, bottom: 30, left: 10 }}
      data={data}
      bars={bars}
      xAxis={{ key: "name", label: xAxisLabel }}
      yAxis={{ key: series[0]?.key ?? "value", label: Y_LABEL[format], allowDecimals: format === "hours", dx: -20 }}
      barSize={Math.max(8, Math.round((data.length * perRow > 12 ? 16 : 28) / Math.sqrt(perRow)))}
      legend={series.length > 1 ? { align: "left", verticalAlign: "bottom", layout: "horizontal" } : undefined}
      customTooltipContent={({ active, label, payload }) => {
        const items = ((payload ?? []) as TTooltipItem[]).filter((item) => item.dataKey && Number(item.value) > 0);
        if (!active || !items.length) return null;
        return (
          <ChartTooltip
            label={tooltipTitle(label, payload)}
            items={items}
            labels={labels}
            format={format}
            showTotal={!grouped}
            hint={onSelect ? selectHint : undefined}
          />
        );
      }}
    />
  );
}

/** One line per series over the period buckets. */
export function ReportLineChart(props: {
  data: TChartRow[];
  series: TChartSeries[];
  format: TChartValueFormat;
  xAxisLabel: string;
}) {
  const { data, series, format, xAxisLabel } = props;
  const colors = useSeriesColors(series);
  const lines = useMemo<TLineItem<string>[]>(
    () =>
      series.map((item, index) => ({
        key: item.key,
        label: item.label,
        dashedLine: false,
        fill: colors[index],
        stroke: colors[index],
        showDot: true,
        smoothCurves: true,
      })),
    [series, colors]
  );
  const labels = useMemo(() => Object.fromEntries(series.map((s) => [s.key, s.label])), [series]);

  return (
    <LineChart
      className="h-[280px] w-full"
      margin={{ top: 16, right: 16, bottom: 30, left: 10 }}
      data={data}
      lines={lines}
      xAxis={{ key: "name", label: xAxisLabel }}
      yAxis={{ key: series[0]?.key ?? "value", label: Y_LABEL[format], allowDecimals: format === "hours", dx: -20 }}
      legend={series.length > 1 ? { align: "left", verticalAlign: "bottom", layout: "horizontal" } : undefined}
      customTooltipContent={({ active, label, payload }) => {
        const items = (payload ?? []) as TTooltipItem[];
        if (!active || !items.length) return null;
        return (
          <ChartTooltip
            label={tooltipTitle(label, payload)}
            items={items}
            labels={labels}
            format={format}
            showTotal={false}
          />
        );
      }}
    />
  );
}

export type TDonutSlice = { key: string; label: string; value: number; color: string };

/** Share of each slice, with the total in the middle and a legend beside it. */
export function ReportDonutChart(props: { slices: TDonutSlice[]; format: TChartValueFormat; centerText: string }) {
  const { slices, format, centerText } = props;
  const visible = slices.filter((slice) => slice.value > 0);
  const total = visible.reduce((sum, slice) => sum + slice.value, 0);
  return (
    // stacked on narrow screens (chart above the legend), side by side from sm up
    <div className="grid grid-cols-1 items-center gap-4 sm:h-[260px] sm:grid-cols-2">
      <PieChart
        className="h-[200px] w-full sm:h-full"
        dataKey="value"
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        data={visible.map((slice) => ({ key: slice.key, name: slice.label, value: slice.value }))}
        cells={visible.map((slice) => ({ key: slice.key, fill: slice.color }))}
        innerRadius="58%"
        outerRadius="88%"
        paddingAngle={visible.length > 1 ? 3 : 0}
        cornerRadius={4}
        showTooltip
        tooltipLabel={(payload: { name?: string }) => payload?.name ?? ""}
        showLabel={false}
        centerLabel={{ text: centerText, fill: "var(--text-color-primary)", className: "text-h5-semibold" }}
      />
      <ul className="flex flex-col gap-2.5">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center justify-between gap-3 text-body-xs-regular">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-xs" style={{ backgroundColor: slice.color }} />
              <span className="truncate text-secondary">{slice.label}</span>
            </span>
            <span className="shrink-0 text-primary tabular-nums">
              {formatChartValue(slice.value, format)}
              <span className="ml-1.5 text-tertiary">
                {total ? `${Math.round((slice.value * 100) / total)}%` : "0%"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type TProgressItem = {
  key: string;
  title: string;
  subtitle?: string;
  progress: number;
  /** right-hand detail, e.g. "3 of 4 done" */
  detail?: string;
  tone?: "brand" | "success" | "warning" | "danger";
};

/** Labelled progress bars, e.g. milestone progress. */
export function ReportProgressList(props: { items: TProgressItem[] }) {
  return (
    <ul className="vertical-scrollbar scrollbar-sm flex max-h-[280px] flex-col gap-4 overflow-y-auto pr-1">
      {props.items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body-xs-medium text-primary">{item.title}</span>
              {item.subtitle && <span className="truncate text-body-xs-regular text-tertiary">{item.subtitle}</span>}
            </span>
            <span className="shrink-0 text-body-xs-medium text-primary tabular-nums">
              {item.progress}%{item.detail && <span className="font-normal ml-1.5 text-tertiary">{item.detail}</span>}
            </span>
          </div>
          <LinearProgress
            value={item.progress}
            size="sm"
            variant={item.tone ?? "brand"}
            showValue={false}
            aria-label={`${item.title}: ${item.progress}%`}
          />
        </li>
      ))}
    </ul>
  );
}

/** One chart of a report, described once and drawn both on the page and in the PDF export. */
export type TReportChart = {
  key: string;
  title: string;
  hint?: string;
  /** takes the full width of the grid */
  wide?: boolean;
  isEmpty: boolean;
  emptyText: string;
} & (
  | {
      kind: "bar";
      rows: TChartRow[];
      series: TChartSeries[];
      format: TChartValueFormat;
      xAxisLabel: string;
      grouped?: boolean;
      onSelect?: (key: string) => void;
      selectHint?: string;
    }
  | { kind: "line"; rows: TChartRow[]; series: TChartSeries[]; format: TChartValueFormat; xAxisLabel: string }
  | { kind: "donut"; slices: TDonutSlice[]; format: TChartValueFormat; centerText: string }
  | { kind: "progress"; items: TProgressItem[] }
);

function ReportChartBody({ chart }: { chart: TReportChart }) {
  switch (chart.kind) {
    case "bar":
      return (
        <ReportBarChart
          data={chart.rows}
          series={chart.series}
          format={chart.format}
          xAxisLabel={chart.xAxisLabel}
          grouped={chart.grouped}
          onSelect={chart.onSelect}
          selectHint={chart.selectHint}
        />
      );
    case "line":
      return (
        <ReportLineChart data={chart.rows} series={chart.series} format={chart.format} xAxisLabel={chart.xAxisLabel} />
      );
    case "donut":
      return <ReportDonutChart slices={chart.slices} format={chart.format} centerText={chart.centerText} />;
    case "progress":
      return <ReportProgressList items={chart.items} />;
  }
}

/** A report's charts, two per row on wide screens (wide charts span both). */
export function ReportChartGrid(props: { charts: TReportChart[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {props.charts.map((chart) => (
        <ChartCard
          key={chart.key}
          className={chart.wide ? "xl:col-span-2" : undefined}
          title={chart.title}
          hint={chart.hint}
          isEmpty={chart.isEmpty}
          emptyText={chart.emptyText}
        >
          <ReportChartBody chart={chart} />
        </ChartCard>
      ))}
    </div>
  );
}
