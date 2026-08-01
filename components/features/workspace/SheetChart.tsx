"use client";

import type { ChartModel, ChartType } from "@/lib/rules/sheets/grid";

/**
 * A chart, drawn as plain SVG.
 *
 * No charting dependency — the rest of the app draws its own SVG (the score ring,
 * the monitor sparklines), and a spreadsheet chart is the same handful of shapes:
 * bars for a column/bar chart, a polyline for a line, a filled polygon for an
 * area, wedges for a pie/doughnut, dots for a scatter, and a column+line overlay
 * for a combo. It takes the already-extracted {@link ChartModel} (see `chartData`)
 * so it stays pure: numbers in, shapes out, nothing about the grid or the engine.
 *
 * It sizes to whatever `width`/`height` its embedded frame gives it, reserving
 * space for the axes and legend only when they are shown, so a small chart drops
 * the chrome before it drops the data.
 */

const PALETTE = [
  "#6b8afd",
  "#4caf82",
  "#e6a23c",
  "#c56b8a",
  "#8b9fbc",
  "#b39cc6",
  "#7fb2a1",
  "#d9a4b0",
];

export function SheetChart({
  model,
  type,
  width = 320,
  height = 200,
  legend = true,
  axes = true,
  stacked = false,
}: {
  model: ChartModel;
  type: ChartType;
  width?: number;
  height?: number;
  legend?: boolean;
  axes?: boolean;
  stacked?: boolean;
}) {
  const { labels, series } = model;
  if (labels.length === 0 || series.length === 0) {
    return (
      <div className="grid h-full w-full place-items-center text-[11px] text-ink-faint">
        No numbers in this range.
      </div>
    );
  }

  const round = type === "doughnut" || type === "pie";
  const cartesian = !round;
  const showLegend = legend && series.length > 0;
  const legendH = showLegend ? 20 : 0;
  const showAxes = axes && cartesian;

  const padT = 10;
  const padR = 12;
  const padL = showAxes ? 38 : 8;
  const padB = (showAxes ? 20 : 6) + legendH;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = Math.max(10, height - padT - padB);
  const color = (i: number) => PALETTE[i % PALETTE.length];

  const svg = (children: React.ReactNode) => (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
    >
      {children}
    </svg>
  );

  const legendNode = showLegend ? (
    <g>
      {series.map((s, i) => {
        const step = width / series.length;
        const cx = i * step + 8;
        const cy = height - legendH / 2;
        return (
          <g key={i}>
            <rect
              x={cx}
              y={cy - 4}
              width={8}
              height={8}
              rx={2}
              fill={color(i)}
            />
            <text
              x={cx + 12}
              y={cy + 3}
              className="fill-ink-muted"
              style={{ fontSize: 9 }}
            >
              {s.name.length > 12 ? s.name.slice(0, 12) + "…" : s.name}
            </text>
          </g>
        );
      })}
    </g>
  ) : null;

  /* ── Round charts: pie & doughnut, the first series ─────────────────────── */
  if (round) {
    const vals = series[0].values.map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = padL + plotW / 2;
    const cy = padT + plotH / 2;
    const r = Math.min(plotW, plotH) / 2;
    const rInner = type === "doughnut" ? r * 0.58 : 0;
    let angle = -Math.PI / 2;
    return svg(
      <>
        {vals.map((v, i) => {
          const frac = v / total;
          const a0 = angle;
          const a1 = angle + frac * 2 * Math.PI;
          angle = a1;
          const large = frac > 0.5 ? 1 : 0;
          const p = (rad: number, radius: number) =>
            `${cx + radius * Math.cos(rad)} ${cy + radius * Math.sin(rad)}`;
          const path =
            frac >= 0.999
              ? // a single full slice can't be an arc — draw the ring/disc
                rInner > 0
                ? `M ${p(a0, r)} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} M ${p(a0, rInner)} A ${rInner} ${rInner} 0 1 0 ${cx - 0.01} ${cy - rInner} Z`
                : `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
              : rInner > 0
                ? `M ${p(a0, rInner)} L ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, rInner)} A ${rInner} ${rInner} 0 ${large} 0 ${p(a0, rInner)} Z`
                : `M ${cx} ${cy} L ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} Z`;
          return (
            <path
              key={i}
              d={path}
              fill={color(i)}
              stroke="var(--doc-page)"
              strokeWidth="1"
            >
              <title>{`${labels[i] ?? i + 1}: ${v} (${Math.round(frac * 100)}%)`}</title>
            </path>
          );
        })}
        {/* A pie's legend names its slices, not its (single) series. */}
        {showLegend && (
          <g>
            {labels.slice(0, 6).map((lbl, i) => {
              const step = width / Math.min(6, labels.length);
              const lx = i * step + 8;
              const ly = height - legendH / 2;
              return (
                <g key={i}>
                  <rect
                    x={lx}
                    y={ly - 4}
                    width={8}
                    height={8}
                    rx={2}
                    fill={color(i)}
                  />
                  <text
                    x={lx + 12}
                    y={ly + 3}
                    className="fill-ink-muted"
                    style={{ fontSize: 9 }}
                  >
                    {lbl.length > 10 ? lbl.slice(0, 10) + "…" : lbl}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </>,
    );
  }

  /* ── Cartesian charts share a value axis ────────────────────────────────── */
  const flat = series.flatMap((s) => s.values);
  let dataMin = Math.min(0, ...flat);
  let dataMax = Math.max(0, ...flat);
  if (stacked && (type === "column" || type === "bar" || type === "area")) {
    /* Stacked: the axis must reach the tallest STACK, not the tallest bar. */
    let sMax = 0;
    let sMin = 0;
    for (let i = 0; i < labels.length; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      sMax = Math.max(sMax, pos);
      sMin = Math.min(sMin, neg);
    }
    dataMax = Math.max(dataMax, sMax);
    dataMin = Math.min(dataMin, sMin);
  }
  const scale = niceScale(dataMin, dataMax);
  const vMin = scale.min;
  const vMax = scale.max;
  const span = vMax - vMin || 1;

  const fmt = (n: number) =>
    Math.abs(n) >= 1000
      ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k"
      : String(Math.round(n * 100) / 100);

  /* Horizontal bar: value runs along X, categories down Y. */
  if (type === "bar") {
    const band = plotH / labels.length;
    const x = (v: number) => padL + ((v - vMin) / span) * plotW;
    const zeroX = x(0);
    return svg(
      <>
        {scale.values.map((tv, i) => (
          <g key={i}>
            <line
              x1={x(tv)}
              x2={x(tv)}
              y1={padT}
              y2={padT + plotH}
              stroke="var(--hairline)"
              strokeWidth={tv === 0 ? 1.2 : 0.5}
            />
            <text
              x={x(tv)}
              y={padT + plotH + 12}
              /* Anchor the end ticks inward so a wide (e.g. negative) label at an
                 axis extreme doesn't spill past the plot edge. */
              textAnchor={
                i === 0
                  ? "start"
                  : i === scale.values.length - 1
                    ? "end"
                    : "middle"
              }
              className="fill-ink-faint"
              style={{ fontSize: 8 }}
            >
              {fmt(tv)}
            </text>
          </g>
        ))}
        {labels.map((lbl, li) => {
          if (stacked) {
            let posOff = 0;
            let negOff = 0;
            return series.map((s, si) => {
              const v = s.values[li] ?? 0;
              const base = v >= 0 ? posOff : negOff;
              const x0 = x(base);
              const x1 = x(base + v);
              if (v >= 0) posOff += v;
              else negOff += v;
              const bh = (band * 0.7) / 1;
              const by = padT + li * band + band * 0.15;
              return (
                <rect
                  key={`${li}-${si}`}
                  x={Math.min(x0, x1)}
                  y={by}
                  width={Math.max(1, Math.abs(x1 - x0))}
                  height={bh}
                  fill={color(si)}
                >
                  <title>{`${lbl} · ${s.name}: ${v}`}</title>
                </rect>
              );
            });
          }
          const bh = (band * 0.7) / series.length;
          return series.map((s, si) => {
            const v = s.values[li] ?? 0;
            const by = padT + li * band + band * 0.15 + si * bh;
            const xv = x(v);
            return (
              <rect
                key={`${li}-${si}`}
                x={Math.min(zeroX, xv)}
                y={by}
                width={Math.max(1, Math.abs(xv - zeroX))}
                height={Math.max(1, bh - 1)}
                fill={color(si)}
              >
                <title>{`${lbl} · ${s.name}: ${v}`}</title>
              </rect>
            );
          });
        })}
        {labels.map((lbl, li) =>
          li % Math.max(1, Math.ceil(labels.length / 8)) === 0 ? (
            <text
              key={li}
              x={padL - 4}
              y={padT + li * band + band / 2 + 3}
              textAnchor="end"
              className="fill-ink-faint"
              style={{ fontSize: 8 }}
            >
              {lbl.length > 6 ? lbl.slice(0, 6) + "…" : lbl}
            </text>
          ) : null,
        )}
        {legendNode}
      </>,
    );
  }

  /* Vertical charts: column, line, area, scatter, combo. */
  const band = plotW / labels.length;
  const y = (v: number) => padT + plotH - ((v - vMin) / span) * plotH;
  const xCat = (i: number) => padL + i * band + band / 2;
  const zeroY = y(0);
  const tickStep = Math.max(1, Math.ceil(labels.length / 8));

  const gridAndAxes = (
    <>
      {scale.values.map((tv, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={padL + plotW}
            y1={y(tv)}
            y2={y(tv)}
            stroke="var(--hairline)"
            strokeWidth={tv === 0 ? 1.2 : 0.5}
          />
          {showAxes && (
            <text
              x={padL - 5}
              y={y(tv) + 3}
              textAnchor="end"
              className="fill-ink-faint"
              style={{ fontSize: 8 }}
            >
              {fmt(tv)}
            </text>
          )}
        </g>
      ))}
      {labels.map((lbl, i) =>
        i % tickStep === 0 ? (
          <text
            key={i}
            x={xCat(i)}
            y={padT + plotH + 12}
            textAnchor="middle"
            className="fill-ink-faint"
            style={{ fontSize: 8 }}
          >
            {lbl.length > 7 ? lbl.slice(0, 7) + "…" : lbl}
          </text>
        ) : null,
      )}
    </>
  );

  if (type === "scatter") {
    /* Two-or-more series: the first is the X axis, the rest are plotted against
       it. One series: value against its category index. */
    const hasX = series.length >= 2;
    const xs = hasX ? series[0].values : labels.map((_, i) => i);
    const xMinRaw = Math.min(...xs);
    const xMaxRaw = Math.max(...xs);
    /* Scatter uses absolute positions on BOTH axes, so — unlike bars — the X axis
       hugs the data instead of being forced through zero. */
    const xScale = niceScale(xMinRaw, xMaxRaw);
    const xSpan = xScale.max - xScale.min || 1;
    const px = (v: number) => padL + ((v - xScale.min) / xSpan) * plotW;
    const plotted = hasX ? series.slice(1) : series;
    return svg(
      <>
        {gridAndAxes}
        {plotted.map((s, si) =>
          s.values.map((v, i) => (
            <circle
              key={`${si}-${i}`}
              cx={px(xs[i] ?? 0)}
              cy={y(v)}
              r={2.6}
              fill={color(si)}
              fillOpacity={0.85}
            >
              <title>{`${s.name}: (${xs[i] ?? i}, ${v})`}</title>
            </circle>
          )),
        )}
        {legendNode}
      </>,
    );
  }

  const columnSeries =
    type === "combo" ? series.slice(0, 1) : type === "column" ? series : [];
  const lineSeries =
    type === "combo"
      ? series.slice(1)
      : type === "line" || type === "area"
        ? series
        : [];

  return svg(
    <>
      {gridAndAxes}
      {/* Columns (grouped or stacked). */}
      {columnSeries.length > 0 &&
        labels.map((lbl, li) => {
          if (stacked && type === "column") {
            let posOff = 0;
            let negOff = 0;
            return columnSeries.map((s, si) => {
              const v = s.values[li] ?? 0;
              const base = v >= 0 ? posOff : negOff;
              const y0 = y(base);
              const y1 = y(base + v);
              if (v >= 0) posOff += v;
              else negOff += v;
              const bw = band * 0.7;
              const bx = padL + li * band + band * 0.15;
              return (
                <rect
                  key={`${li}-${si}`}
                  x={bx}
                  y={Math.min(y0, y1)}
                  width={bw}
                  height={Math.max(1, Math.abs(y1 - y0))}
                  fill={color(si)}
                >
                  <title>{`${lbl} · ${s.name}: ${v}`}</title>
                </rect>
              );
            });
          }
          const bw = (band * 0.7) / columnSeries.length;
          return columnSeries.map((s, si) => {
            const v = s.values[li] ?? 0;
            const bx = padL + li * band + band * 0.15 + si * bw;
            const yv = y(v);
            return (
              <rect
                key={`${li}-${si}`}
                x={bx}
                y={Math.min(zeroY, yv)}
                width={Math.max(1, bw - 1)}
                height={Math.max(1, Math.abs(yv - zeroY))}
                fill={color(si)}
              >
                <title>{`${lbl} · ${s.name}: ${v}`}</title>
              </rect>
            );
          });
        })}
      {/* Areas (fill under the line), then lines & their markers. */}
      {type === "area" &&
        lineSeries.map((s, si) => {
          const pts = s.values.map((v, i) => `${xCat(i)},${y(v)}`);
          const d = `M ${padL + band / 2},${zeroY} L ${pts.join(" L ")} L ${xCat(s.values.length - 1)},${zeroY} Z`;
          return (
            <path
              key={`area-${si}`}
              d={d}
              fill={color(si)}
              fillOpacity={0.18}
              stroke="none"
            />
          );
        })}
      {lineSeries.map((s, si) => {
        const idx = type === "combo" ? si + 1 : si;
        const pts = s.values.map((v, i) => `${xCat(i)},${y(v)}`).join(" ");
        return (
          <g key={`line-${si}`}>
            <polyline
              points={pts}
              fill="none"
              stroke={color(idx)}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {s.values.map((v, i) => (
              <circle key={i} cx={xCat(i)} cy={y(v)} r={2} fill={color(idx)}>
                <title>{`${labels[i]} · ${s.name}: ${v}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {legendNode}
    </>,
  );
}

/**
 * A "nice" value axis: rounded bounds and a whole-number step, so the gridlines
 * fall on 0, 20, 40… rather than 0, 17.3, 34.6…. The textbook loose-label
 * algorithm, small enough to inline.
 */
function niceScale(
  min: number,
  max: number,
  maxTicks = 5,
): { min: number; max: number; step: number; values: number[] } {
  if (min === max) max = min + 1;
  const niceNum = (range: number, round: boolean) => {
    const exp = Math.floor(Math.log10(Math.abs(range) || 1));
    const frac = Math.abs(range) / Math.pow(10, exp);
    let nf: number;
    if (round) nf = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
    else nf = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  };
  const range = niceNum(max - min, false);
  const step = niceNum(range / (maxTicks - 1), true) || 1;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step)
    values.push(Math.round(v * 1e6) / 1e6);
  return { min: niceMin, max: niceMax, step, values };
}
