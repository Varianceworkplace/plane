/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TBarItem } from "@plane/types";
import { BarChart } from "./root";

// jsdom has no layout, so ResponsiveContainer would measure 0 x 0 and draw nothing: give the chart a fixed size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 400, height: 300 })
        : null,
  };
});

const DATA = [
  { key: "ada", name: "Ada", hours: 3 },
  { key: "bob", name: "Bob", hours: 1.5 },
];

const bar = (onClick?: (payload: unknown) => void): TBarItem<"hours"> => ({
  key: "hours",
  label: "Hours",
  stackId: "hours",
  fill: "#6172E8",
  textClassName: "",
  onClick,
});

const renderChart = (onClick?: (payload: unknown) => void) =>
  render(
    <BarChart
      data={DATA}
      bars={[bar(onClick)]}
      xAxis={{ key: "name", label: "Users" }}
      yAxis={{ key: "hours", label: "Hours" }}
      showTooltip={false}
    />
  );

describe("BarChart bar clicks", () => {
  it("calls the bar's onClick with the clicked data item", () => {
    const onClick = vi.fn();
    const { container } = renderChart(onClick);
    const rectangles = container.querySelectorAll(".recharts-bar-rectangle");
    expect(rectangles).toHaveLength(2);

    fireEvent.click(rectangles[1]);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toMatchObject({ key: "bob", hours: 1.5 });
    expect(container.querySelector(".recharts-bar.cursor-pointer")).not.toBeNull();
  });

  it("leaves bars inert without onClick", () => {
    const { container } = renderChart();
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);
    expect(container.querySelector(".recharts-bar.cursor-pointer")).toBeNull();
  });
});
