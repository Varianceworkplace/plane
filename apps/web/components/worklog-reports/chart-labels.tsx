/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Bar charts whose bars are named (projects, people): each name on up to three lines under its bar, every bar labelled,
// and a bar's room fixed so a long list scrolls sideways in its box instead of squeezing the names together.

/** pixels a named bar gets (three label lines of LABEL_LINE_CHARS fit it) */
export const NAMED_BAR_SLOT = 112;
/** room under the bars for the label lines, and where the axis title sits below them */
export const NAMED_LABELS_MARGIN_BOTTOM = 60;
export const NAMED_LABELS_AXIS_DY = 58;

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
export function WrappedXAxisTick(props: { x?: number; y?: number; payload?: { value?: string | number } }) {
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
