/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// The report as a PDF: loaded only when someone exports one (see report-pdf-export.tsx).
import type { ReactNode } from "react";
import {
  Circle,
  Document,
  Font,
  Image,
  Line,
  Page,
  Path,
  Polyline,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
// plane imports
import { CHART_COLOR_PALETTES } from "@plane/constants";
// assets
import interBold from "@/app/assets/fonts/inter/bold.ttf?url";
import interMedium from "@/app/assets/fonts/inter/medium.ttf?url";
import interRegular from "@/app/assets/fonts/inter/regular.ttf?url";
import interSemibold from "@/app/assets/fonts/inter/semibold.ttf?url";
import VarianceLockupImage from "@/app/assets/logos/variance-lockup.png?url";
// components
import { generateExtendedColors } from "@/components/chart/utils";
// local imports
import type { TChartRow, TChartSeries, TChartValueFormat, TReportChart } from "./analytics-charts";
import { formatChartValue } from "./analytics-charts";

Font.register({
  family: "ReportInter",
  fonts: [
    { src: interRegular, fontWeight: "normal" },
    { src: interMedium, fontWeight: "medium" },
    { src: interSemibold, fontWeight: "semibold" },
    { src: interBold, fontWeight: "bold" },
  ],
});

export type TReportPdfTable = {
  title: string;
  columns: { label: string; align?: "right"; flex?: number }[];
  rows: (string | number)[][];
  note?: string;
};

export type TReportPdf = {
  title: string;
  /** the covered dates, e.g. "Oct 1, 2026 – Oct 31, 2026" */
  period: string;
  filters: string[];
  cards: { label: string; value: string | number }[];
  charts: TReportChart[];
  tables: TReportPdfTable[];
};

const COLORS = {
  text: "#1f2937",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  surface: "#f9fafb",
  track: "#eef0f3",
  brand: "#4083E9",
};
const PALETTE = CHART_COLOR_PALETTES[0]?.light ?? [COLORS.brand];

// A4 portrait, 32pt margins
const CONTENT_WIDTH = 595 - 64;
const CHART_PADDING = 10;
const TICK_WIDTH = 30;
const PLOT_WIDTH = CONTENT_WIDTH - 2 * CHART_PADDING - TICK_WIDTH;
const PLOT_HEIGHT = 150;

const styles = StyleSheet.create({
  page: { fontFamily: "ReportInter", fontSize: 8, color: COLORS.text, padding: 32, paddingBottom: 44 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 },
  logo: { height: 26, objectFit: "contain" },
  title: { fontSize: 16, fontWeight: "semibold", marginTop: 10 },
  meta: { fontSize: 8, color: COLORS.muted, marginTop: 3 },
  rule: { borderBottomWidth: 2, borderBottomColor: COLORS.brand, marginVertical: 10 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  card: {
    width: (CONTENT_WIDTH - 18) / 4,
    borderWidth: 0.5,
    borderColor: COLORS.line,
    borderRadius: 4,
    backgroundColor: COLORS.surface,
    padding: 7,
  },
  cardLabel: { fontSize: 7, color: COLORS.muted },
  cardValue: { fontSize: 12, fontWeight: "semibold", marginTop: 3 },
  chart: { borderWidth: 0.5, borderColor: COLORS.line, borderRadius: 4, padding: CHART_PADDING, marginBottom: 10 },
  chartTitle: { fontSize: 10, fontWeight: "semibold" },
  chartHint: { fontSize: 7, color: COLORS.muted, marginTop: 2, marginBottom: 8 },
  empty: { fontSize: 8, color: COLORS.faint, textAlign: "center", paddingVertical: 24 },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  swatch: { width: 6, height: 6, borderRadius: 1 },
  small: { fontSize: 6.5, color: COLORS.muted },
  tableTitle: { fontSize: 10, fontWeight: "semibold", marginTop: 6, marginBottom: 6 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.line, paddingVertical: 4 },
  headRow: { backgroundColor: COLORS.surface, borderTopWidth: 0.5, borderTopColor: COLORS.line },
  cell: { paddingHorizontal: 4, fontSize: 7 },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: COLORS.faint,
  },
});

const seriesColors = (series: TChartSeries[]) => {
  const extended = generateExtendedColors(PALETTE, series.length);
  return series.map((item, index) => item.color ?? extended[index] ?? COLORS.brand);
};

const rowValue = (row: TChartRow, key: string) => Number(row[key] ?? 0) || 0;

/** A round upper bound for the axis, and its four steps (whole steps for counts and percentages). */
const axisScale = (max: number, format: TChartValueFormat) => {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= rough) ?? rough;
  if (format !== "hours") step = Math.max(1, Math.round(step));
  const top = step * Math.ceil(max / step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step) };
};

const tickLabel = (value: number, format: TChartValueFormat) =>
  format === "hours"
    ? `${Math.round(value * 10) / 10}h`
    : format === "percent"
      ? `${Math.round(value)}%`
      : `${Math.round(value)}`;

const charsFor = (width: number) => Math.max(3, Math.floor(width / 3.6));

const fit = (text: string, width: number) => {
  const chars = charsFor(width);
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
};

/** The row's full title when it fits under its bar, else the shorter axis name. */
const axisLabel = (row: TChartRow, width: number) => {
  const title = row.title === undefined ? "" : String(row.title);
  return fit(title && title.length <= charsFor(width) ? title : String(row.name), width);
};

function Legend({ series, colors }: { series: TChartSeries[]; colors: string[] }) {
  if (series.length < 2) return null;
  return (
    <View style={styles.legend}>
      {series.map((item, index) => (
        <View key={item.key} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors[index] }]} />
          <Text style={styles.small}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Y-axis tick labels next to the plot, the plot itself and the x-axis labels under it. */
function Axes(props: {
  rows: TChartRow[];
  format: TChartValueFormat;
  top: number;
  ticks: number[];
  children: ReactNode;
}) {
  const { rows, format, top, ticks, children } = props;
  const band = PLOT_WIDTH / Math.max(rows.length, 1);
  // label every row when they fit, otherwise every other one
  const every = band < 22 ? Math.ceil(22 / band) : 1;
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ width: TICK_WIDTH, height: PLOT_HEIGHT, position: "relative" }}>
        {ticks.map((tick) => (
          <Text
            key={tick}
            style={[
              styles.small,
              { position: "absolute", right: 4, top: PLOT_HEIGHT - (tick / top) * PLOT_HEIGHT - 4 },
            ]}
          >
            {tickLabel(tick, format)}
          </Text>
        ))}
      </View>
      <View>
        <Svg width={PLOT_WIDTH} height={PLOT_HEIGHT}>
          {ticks.map((tick) => {
            const y = PLOT_HEIGHT - (tick / top) * PLOT_HEIGHT;
            return <Line key={tick} x1={0} x2={PLOT_WIDTH} y1={y} y2={y} stroke={COLORS.line} strokeWidth={0.5} />;
          })}
          {children}
        </Svg>
        <View style={{ flexDirection: "row", marginTop: 3 }}>
          {rows.map((row, index) => (
            <Text key={row.key} style={[styles.small, { width: band, textAlign: "center" }]}>
              {index % every === 0 ? axisLabel(row, band * every) : ""}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

function BarChart({ chart }: { chart: Extract<TReportChart, { kind: "bar" }> }) {
  const { rows, series, format, grouped } = chart;
  const colors = seriesColors(series);
  const max = Math.max(
    0,
    ...rows.map((row) =>
      grouped
        ? Math.max(...series.map((s) => rowValue(row, s.key)))
        : series.reduce((sum, s) => sum + rowValue(row, s.key), 0)
    )
  );
  const { top, ticks } = axisScale(max, format);
  const band = PLOT_WIDTH / Math.max(rows.length, 1);
  const groupWidth = Math.min(band * 0.7, grouped ? 14 * series.length : 22);
  const barWidth = grouped ? groupWidth / series.length : groupWidth;
  return (
    <>
      <Axes rows={rows} format={format} top={top} ticks={ticks}>
        {rows.map((row, rowIndex) => {
          const left = rowIndex * band + (band - groupWidth) / 2;
          let stacked = 0;
          return series.map((item, index) => {
            const height = (rowValue(row, item.key) / top) * PLOT_HEIGHT;
            if (height <= 0) return null;
            const x = grouped ? left + index * barWidth : left;
            const y = grouped ? PLOT_HEIGHT - height : PLOT_HEIGHT - stacked - height;
            stacked += grouped ? 0 : height;
            return (
              <Rect
                key={`${row.key}-${item.key}`}
                x={x}
                y={y}
                width={Math.max(barWidth - (grouped ? 1 : 0), 1)}
                height={height}
                fill={colors[index]}
              />
            );
          });
        })}
      </Axes>
      <Legend series={series} colors={colors} />
    </>
  );
}

function LineChart({ chart }: { chart: Extract<TReportChart, { kind: "line" }> }) {
  const { rows, series, format } = chart;
  const colors = seriesColors(series);
  const max = Math.max(0, ...rows.flatMap((row) => series.map((s) => Number(row[s.key] ?? 0) || 0)));
  const { top, ticks } = axisScale(max, format);
  const band = PLOT_WIDTH / Math.max(rows.length, 1);
  const point = (row: TChartRow, index: number, key: string) => ({
    id: row.key,
    x: index * band + band / 2,
    y: PLOT_HEIGHT - (rowValue(row, key) / top) * PLOT_HEIGHT,
  });
  return (
    <>
      <Axes rows={rows} format={format} top={top} ticks={ticks}>
        {series.map((item, index) => {
          const points = rows.map((row, rowIndex) => point(row, rowIndex, item.key));
          return [
            <Polyline
              key={`${item.key}-line`}
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke={colors[index]}
              strokeWidth={1.4}
              fill="none"
            />,
            ...points.map((p) => <Circle key={`${item.key}-${p.id}`} cx={p.x} cy={p.y} r={1.8} fill={colors[index]} />),
          ];
        })}
      </Axes>
      <Legend series={series} colors={colors} />
    </>
  );
}

/** An annulus segment from `start` to `end` (fractions of the circle, clockwise from 12 o'clock). */
const arc = (start: number, end: number, outer: number, inner: number, center: number) => {
  const at = (fraction: number, radius: number) => {
    const angle = 2 * Math.PI * fraction - Math.PI / 2;
    return `${center + radius * Math.cos(angle)} ${center + radius * Math.sin(angle)}`;
  };
  const large = end - start > 0.5 ? 1 : 0;
  return [
    `M ${at(start, outer)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${at(end, outer)}`,
    `L ${at(end, inner)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${at(start, inner)}`,
    "Z",
  ].join(" ");
};

function DonutChart({ chart }: { chart: Extract<TReportChart, { kind: "donut" }> }) {
  const size = 120;
  const visible = chart.slices.filter((slice) => slice.value > 0);
  const total = visible.reduce((sum, slice) => sum + slice.value, 0);
  let cursor = 0;
  const segments = visible.flatMap((slice) => {
    const share = slice.value / total;
    const start = cursor;
    cursor += share;
    // a full circle can't be one arc: split it in two halves
    const parts =
      share >= 0.999
        ? [
            { id: "first-half", from: start, to: start + 0.5 },
            { id: "second-half", from: start + 0.5, to: start + 0.9999 },
          ]
        : [{ id: "slice", from: start, to: cursor }];
    return parts.map((part) => (
      <Path key={`${slice.key}-${part.id}`} d={arc(part.from, part.to, 56, 34, size / 2)} fill={slice.color} />
    ));
  });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 24 }}>
      <View style={{ width: size, height: size, position: "relative" }}>
        <Svg width={size} height={size}>
          {segments}
        </Svg>
        <Text
          style={{
            position: "absolute",
            top: size / 2 - 7,
            width: size,
            textAlign: "center",
            fontSize: 11,
            fontWeight: "semibold",
          }}
        >
          {chart.centerText}
        </Text>
      </View>
      <View style={{ flexGrow: 1, gap: 5 }}>
        {chart.slices.map((slice) => (
          <View key={slice.key} style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: slice.color }]} />
              <Text>{slice.label}</Text>
            </View>
            <Text>
              {formatChartValue(slice.value, chart.format)}
              <Text style={{ color: COLORS.muted }}>
                {"  "}
                {total ? Math.round((slice.value * 100) / total) : 0}%
              </Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const TONES = { brand: COLORS.brand, success: "#16a34a", warning: "#d97706", danger: "#dc2626" };

function ProgressChart({ chart }: { chart: Extract<TReportChart, { kind: "progress" }> }) {
  const width = CONTENT_WIDTH - 2 * CHART_PADDING;
  return (
    <View style={{ gap: 8 }}>
      {chart.items.map((item) => (
        <View key={item.key} wrap={false}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
            <View>
              <Text style={{ fontWeight: "medium" }}>{item.title}</Text>
              {item.subtitle && <Text style={styles.small}>{item.subtitle}</Text>}
            </View>
            <Text style={{ fontWeight: "medium" }}>
              {item.progress}%{item.detail ? `  ${item.detail}` : ""}
            </Text>
          </View>
          <Svg width={width} height={5}>
            <Rect x={0} y={0} width={width} height={5} rx={2.5} fill={COLORS.track} />
            {item.progress > 0 && (
              <Rect
                x={0}
                y={0}
                width={(width * Math.min(item.progress, 100)) / 100}
                height={5}
                rx={2.5}
                fill={TONES[item.tone ?? "brand"]}
              />
            )}
          </Svg>
        </View>
      ))}
    </View>
  );
}

function ChartBlock({ chart }: { chart: TReportChart }) {
  return (
    <View style={styles.chart} wrap={false}>
      <Text style={styles.chartTitle}>{chart.title}</Text>
      {chart.hint && <Text style={styles.chartHint}>{chart.hint}</Text>}
      {chart.isEmpty ? (
        <Text style={styles.empty}>{chart.emptyText}</Text>
      ) : chart.kind === "bar" ? (
        <BarChart chart={chart} />
      ) : chart.kind === "line" ? (
        <LineChart chart={chart} />
      ) : chart.kind === "donut" ? (
        <DonutChart chart={chart} />
      ) : (
        <ProgressChart chart={chart} />
      )}
    </View>
  );
}

/** Rows with ids and each cell paired with its column. */
const keyedRows = (table: TReportPdfTable) =>
  table.rows.map((row, rowIndex) => ({
    id: `row-${rowIndex}`,
    cells: table.columns.map((column, columnIndex) => ({ column, value: row[columnIndex] ?? "" })),
  }));

function Table({ table }: { table: TReportPdfTable }) {
  const flex = (index: number) => table.columns[index]?.flex ?? 1;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.tableTitle} minPresenceAhead={40}>
        {table.title}
      </Text>
      <View style={[styles.row, styles.headRow]} wrap={false}>
        {table.columns.map((column, index) => (
          <Text
            key={column.label}
            style={[styles.cell, { flex: flex(index), fontWeight: "semibold", textAlign: column.align ?? "left" }]}
          >
            {column.label}
          </Text>
        ))}
      </View>
      {table.rows.length ? (
        keyedRows(table).map((row) => (
          <View key={row.id} style={styles.row} wrap={false}>
            {row.cells.map((cell) => (
              <Text
                key={cell.column.label}
                style={[styles.cell, { flex: cell.column.flex ?? 1, textAlign: cell.column.align ?? "left" }]}
              >
                {String(cell.value)}
              </Text>
            ))}
          </View>
        ))
      ) : (
        <Text style={styles.empty}>Nothing to list.</Text>
      )}
      {table.note && <Text style={[styles.small, { marginTop: 4 }]}>{table.note}</Text>}
    </View>
  );
}

export function ReportPdfDocument({ report }: { report: TReportPdf }) {
  const generated = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return (
    <Document title={report.title} author="Variance" creator="Variance Workplace">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Image src={VarianceLockupImage} style={styles.logo} />
          <Text style={styles.meta}>Generated {generated}</Text>
        </View>
        <Text style={styles.title}>{report.title}</Text>
        <Text style={styles.meta}>{report.period}</Text>
        {report.filters.length > 0 && <Text style={styles.meta}>Filters: {report.filters.join(" · ")}</Text>}
        <View style={styles.rule} />
        <View style={styles.cards}>
          {report.cards.map((card) => (
            <View key={card.label} style={styles.card}>
              <Text style={styles.cardLabel}>{card.label}</Text>
              <Text style={styles.cardValue}>{String(card.value)}</Text>
            </View>
          ))}
        </View>
        {report.charts.map((chart) => (
          <ChartBlock key={chart.key} chart={chart} />
        ))}
        {report.tables.map((table) => (
          <Table key={table.title} table={table} />
        ))}
        <View style={styles.footer} fixed>
          <Text>Variance · {report.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
