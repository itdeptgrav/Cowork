"use client";

/**
 * The bar that appears over a selected chart — everything about the chart
 * that is not its position: type, title, what the legend and axes do, whether
 * columns stack, which way the series run, and Remove.
 *
 * It floats at the top of the grid rather than inside the chart so a small
 * chart is not covered by its own controls.
 */

import { CHART_TYPES, type ChartSpec } from "@/lib/spreadsheet/charts";
import { rangeLabel } from "@/lib/spreadsheet/coordinates";
import type { SpreadsheetController } from "./useSpreadsheet";

const field =
  "h-7 rounded-md border border-hairline bg-transparent px-2 text-[12px] text-ink outline-none focus:border-ink";
const toggle = (on: boolean) =>
  `h-7 rounded-md px-2 text-[12px] transition-colors ${
    on ? "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] text-ink" : "text-ink-muted hover:text-ink"
  }`;

export function ChartToolbar({ controller, chart }: { controller: SpreadsheetController; chart: ChartSpec }) {
  const set = (patch: Partial<ChartSpec>) => controller.updateChart(chart.id, patch);
  const cartesian = chart.type !== "pie" && chart.type !== "doughnut";
  return (
    <div
      role="toolbar"
      aria-label="Chart"
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute right-3 top-2 z-30 flex flex-wrap items-center gap-1.5 rounded-lg border border-hairline bg-[var(--surface-raised)] px-2 py-1.5 shadow-lg"
    >
      <select
        value={chart.type}
        onChange={(e) => set({ type: e.target.value as ChartSpec["type"] })}
        aria-label="Chart type"
        className={field}
      >
        {CHART_TYPES.map((t) => (
          <option key={t.type} value={t.type}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        value={chart.title}
        onChange={(e) => set({ title: e.target.value })}
        aria-label="Chart title"
        placeholder="Title"
        spellCheck={false}
        className={`${field} w-[150px]`}
      />
      <span data-figure className="rounded-full bg-[var(--control)] px-1.5 text-[10px] text-ink-faint" title="The data range">
        {rangeLabel(chart.rect)}
      </span>
      <button type="button" className={toggle(chart.legend ?? true)} onClick={() => set({ legend: !(chart.legend ?? true) })} aria-pressed={chart.legend ?? true}>
        Legend
      </button>
      {cartesian && (
        <>
          <button type="button" className={toggle(chart.axes ?? true)} onClick={() => set({ axes: !(chart.axes ?? true) })} aria-pressed={chart.axes ?? true}>
            Axes
          </button>
          <button type="button" className={toggle(chart.stacked ?? false)} onClick={() => set({ stacked: !(chart.stacked ?? false) })} aria-pressed={chart.stacked ?? false}>
            Stacked
          </button>
        </>
      )}
      <button
        type="button"
        className={toggle(chart.orientation === "rows")}
        onClick={() => set({ orientation: chart.orientation === "rows" ? "cols" : "rows" })}
        aria-pressed={chart.orientation === "rows"}
        title="Read each row as a series instead of each column"
      >
        Rows as series
      </button>
      <button
        type="button"
        onClick={() => controller.removeChart(chart.id)}
        className="h-7 rounded-md px-2 text-[12px] text-[var(--state-overdue-ink,#b42318)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
      >
        Remove
      </button>
    </div>
  );
}
