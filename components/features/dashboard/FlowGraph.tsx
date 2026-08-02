"use client";

import { memo, useMemo, useState } from "react";
import type { FlowChannelId, WorkloadFlow } from "@/lib/domain";

/**
 * The workload-flow graph — structure and visual treatment from `anywhere.png`.
 *
 * What that reference actually depicts is DIVERGENCE FROM A SHARED BASELINE: a
 * bundle of smooth uniform-weight curves that pinch where every series agrees
 * and fan symmetrically above and below where they do not, cool hues rising,
 * warm hues falling, each carrying a soft bloom on a near-black ground.
 *
 * That geometry is not decoration here — it is the question. Arrivals draw
 * upward, departures draw downward, and the baseline is zero net change. So:
 *
 *   · a pinch is a week where you cleared exactly what arrived
 *   · a fan opening upward is work accumulating faster than you finish it
 *   · a fan opening downward is a queue draining
 *   · the fan's WIDTH is throughput volatility
 *
 * Colour comes from the FIELD palette, never from C1–C4. The Four Channels Rule
 * reserves channel colour for score components; this is the second sanctioned
 * use of the iridescent palette outside the background, after avatar monograms.
 */

const PLOT_W = 1000;
const PLOT_H = 260;
const MID = PLOT_H / 2;
/** Half the plot, less headroom so a peak week never touches the frame. */
const AMPLITUDE = MID - 26;

/**
 * Catmull–Rom through the points, converted to cubic beziers.
 *
 * The reference's curves are continuous and tension-free — they read as one
 * drawn stroke rather than as connected segments, which is what makes the fan
 * legible as a single form. A polyline would destroy that.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export const FlowGraph = memo(function FlowGraph({
  flow,
  loading,
  onSelectWeek,
  selectedWeek,
  /**
   * Compact draws the same graph at dashboard scale: shorter plot, no series
   * chips, no axis rail. The curve is the signal — the legend is a reading aid
   * that belongs where someone has come to study the series, not where they
   * have come to glance at its shape.
   */
  compact = false,
  /**
   * `hero` is the dashboard's signature presentation: the plot becomes the
   * card's own ground, edge to edge, with the header floating over it. The
   * chart stops being a picture inside a card and becomes the card.
   */
  hero = false,
  /**
   * Whether this draws its own ground. The hero's card owns the plate so it
   * survives an empty or failed fetch — a signature that disappears when a
   * request does was never a signature.
   */
  plate = true,
}: {
  flow: WorkloadFlow | null;
  loading: boolean;
  /** Clicking a week filters the urgent rows in the same card. */
  onSelectWeek?: (weekStart: string | null) => void;
  selectedWeek?: string | null;
  compact?: boolean;
  hero?: boolean;
  plate?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<FlowChannelId>>(new Set());
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Memoised so the fallbacks do not create a fresh array identity on every
  // render and re-run the series build underneath them.
  const points = useMemo(() => flow?.points ?? [], [flow]);
  const channels = useMemo(() => flow?.channels ?? [], [flow]);
  const peak = Math.max(1, flow?.peak ?? 1);

  const series = useMemo(
    () =>
      channels.map((ch) => {
        const pts = points.map((p, i) => {
          const v = p.values[ch.id] ?? 0;
          const offset = (v / peak) * AMPLITUDE;
          return {
            x:
              points.length === 1
                ? PLOT_W / 2
                : (i / (points.length - 1)) * PLOT_W,
            y: ch.direction === "in" ? MID - offset : MID + offset,
          };
        });
        return { ch, d: smoothPath(pts), pts };
      }),
    [channels, points, peak],
  );

  const visible = series.filter((s) => !hidden.has(s.ch.id));
  const hasMovement = points.some((p) =>
    Object.values(p.values).some((v) => v > 0),
  );

  function toggle(id: FlowChannelId) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* Axis ticks: the arrivals side and the departures side share one scale, so
     the axis is labelled symmetrically about zero rather than 0→peak. */
  const ticks = [peak, Math.round(peak / 2), 0, Math.round(peak / 2), peak];
  const plotHeight = compact ? 150 : PLOT_H * 0.9;

  const summary = flow
    ? `Workload flow over ${points.length} weeks. ${
        flow.netTotal > 0
          ? `Net ${flow.netTotal} more tasks arrived than were cleared.`
          : flow.netTotal < 0
            ? `Net ${Math.abs(flow.netTotal)} more tasks were cleared than arrived.`
            : "Arrivals and departures balanced."
      }`
    : "Workload flow";

  return (
    <div className={`flex flex-col ${hero ? "h-full" : ""}`}>
      {/* Series chips — the reference's own header device. The hero draws its
          own set over the plate, so this row is for the standalone form only. */}
      <div
        className={`mb-3 flex-wrap items-center gap-1.5 ${
          compact || hero ? "hidden" : "flex"
        }`}
      >
        {channels.map((ch) => {
          const off = hidden.has(ch.id);
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => toggle(ch.id)}
              aria-pressed={!off}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                off
                  ? "bg-[var(--surface-sunken)] text-ink-faint"
                  : "bg-[var(--control)] text-ink"
              }`}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: off ? "currentColor" : ch.hue,
                  opacity: off ? 0.4 : 1,
                }}
              />
              {ch.label}
            </button>
          );
        })}
      </div>

      {/* The plate.
          Two materials, not one dimmed: `iridescentgraphdark` is near-black
          with a warm haze bleeding from the lower right and every strand lit;
          `iridescentgraphlight` is a pale pearlescent plate where the same
          strands are unlit and the colour pools softly beneath them. Which one
          renders is a matter of tokens, so the geometry below is written once. */}
      <div className={hero ? "h-full" : "flex gap-2"}>
        <div
          aria-hidden="true"
          className={`w-10 shrink-0 flex-col justify-between py-1 text-right text-[11px] ${
            compact || hero ? "hidden" : "flex"
          }`}
          style={{ height: plotHeight, color: "var(--graph-ink-muted)" }}
        >
          {ticks.map((t, i) => (
            <span key={i} data-figure>
              {i === 2 ? "0" : t}
            </span>
          ))}
        </div>

        <div
          className={`relative min-w-0 overflow-hidden ${
            hero ? "h-full w-full" : "flex-1 rounded-inset"
          }`}
          style={
            plate
              ? {
                  background:
                    "linear-gradient(160deg, var(--graph-ground-2) 0%, var(--graph-ground) 55%)",
                }
              : undefined
          }
        >
          {/* Weather. A warm mass low and right, a cool one high and left —
              the reference's own asymmetry, which is what stops the plate
              reading as a flat swatch. */}
          {plate && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background: [
                  "radial-gradient(60% 90% at 88% 82%, var(--graph-haze-warm), transparent 68%)",
                  "radial-gradient(52% 80% at 8% 12%, var(--graph-haze-cool), transparent 66%)",
                ].join(","),
              }}
            />
          )}
          {/* The sheen under the bundle, where the strands crowd. In light this
              is the whole of the iridescence; in dark it sits beneath the bloom. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-[52%] -translate-y-1/2"
            style={{
              background: [
                "radial-gradient(46% 100% at 28% 50%, var(--graph-wash), transparent 74%)",
                "radial-gradient(42% 92% at 74% 50%, var(--graph-wash), transparent 72%)",
              ].join(","),
            }}
          />

          {/* Gridlines. Sparse — the reference has three, not one per point. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <span
                key={f}
                className="absolute top-0 bottom-0 w-px"
                style={{
                  left: `${f * 100}%`,
                  backgroundColor: "var(--graph-grid)",
                }}
              />
            ))}
            <span
              className="absolute inset-x-0 top-1/2 h-px"
              style={{ backgroundColor: "var(--graph-axis)" }}
            />
          </div>

          <svg
            viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="block w-full"
            style={{ height: hero ? "100%" : plotHeight }}
            role="img"
            aria-label={summary}
          >
            <defs>
              <filter
                id="flow-bloom"
                x="-20%"
                y="-40%"
                width="140%"
                height="180%"
              >
                <feGaussianBlur stdDeviation="7" />
              </filter>
            </defs>

            {/* Each curve is drawn twice: a blurred wide pass for the glow, then
                a crisp pass on top. In light the glow pass is transparent, so
                the same code draws an unlit plate. */}
            {visible.map(({ ch, d }) => (
              <path
                key={`glow-${ch.id}`}
                d={d}
                fill="none"
                stroke={ch.hue}
                strokeWidth="8"
                strokeLinecap="round"
                opacity="var(--graph-glow)"
                filter="url(#flow-bloom)"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {visible.map(({ ch, d }) => (
              <path
                key={ch.id}
                d={d}
                fill="none"
                stroke={ch.hue}
                strokeWidth="var(--graph-stroke-w)"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className={
                  loading
                    ? "opacity-0"
                    : "opacity-100 transition-opacity duration-500"
                }
              />
            ))}

            {/* Scrub line */}
            {hoverIndex !== null && points.length > 1 && (
              <line
                x1={(hoverIndex / (points.length - 1)) * PLOT_W}
                x2={(hoverIndex / (points.length - 1)) * PLOT_W}
                y1={0}
                y2={PLOT_H}
                stroke="var(--graph-scrub)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* Hit areas — one per week, so hover and click are unambiguous and
              keyboard-reachable without the SVG needing focus management. */}
          <div className="absolute inset-0 flex">
            {points.map((p, i) => (
              <button
                key={p.weekStart}
                type="button"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex(i)}
                onBlur={() => setHoverIndex(null)}
                onClick={() =>
                  onSelectWeek?.(
                    selectedWeek === p.weekStart ? null : p.weekStart,
                  )
                }
                aria-label={`Week of ${p.label}: ${p.net > 0 ? `${p.net} more arrived` : p.net < 0 ? `${Math.abs(p.net)} more cleared` : "balanced"}`}
                className="h-full flex-1 transition-colors focus-visible:ring-1 focus-visible:ring-[var(--graph-axis)] focus-visible:ring-inset focus-visible:outline-none"
                style={{
                  backgroundColor:
                    selectedWeek === p.weekStart
                      ? "var(--graph-grid)"
                      : undefined,
                }}
              />
            ))}
          </div>

          {/* The pinch nodes. Where every series agrees, the bundle closes to
              a point — the reference marks those. Drawn in HTML rather than in
              the SVG: `preserveAspectRatio="none"` stretches the viewBox, and a
              circle inside it would render as an ellipse. */}
          {!loading &&
            hero &&
            points.map((p, i) => {
              const balanced = Object.values(p.values).every((v) => v === 0);
              if (!balanced || i === 0 || i === points.length - 1) return null;
              return (
                <span
                  key={`node-${p.weekStart}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${(i / (points.length - 1)) * 100}%`,
                    backgroundColor: "var(--graph-node)",
                    boxShadow: "0 0 0 1px var(--graph-node-ring)",
                  }}
                />
              );
            })}

          {hoverIndex !== null && points[hoverIndex] && (
            <div
              className="pointer-events-none absolute top-3 z-10 max-w-[min(320px,80%)] -translate-x-1/2 rounded-full px-3 py-1.5 text-[11px] whitespace-nowrap backdrop-blur-sm"
              style={{
                left: `${((hoverIndex + 0.5) / points.length) * 100}%`,
                backgroundColor: "var(--graph-chip)",
                color: "var(--graph-chip-ink)",
              }}
            >
              <span data-figure className="font-medium">
                {points[hoverIndex].label}
              </span>
              {channels.map((ch) => {
                const v = points[hoverIndex].values[ch.id] ?? 0;
                if (!v || hidden.has(ch.id)) return null;
                return (
                  <span key={ch.id} className="ml-2 opacity-85">
                    <span
                      aria-hidden="true"
                      className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                      style={{ backgroundColor: ch.hue }}
                    />
                    <span data-figure>{v}</span>
                  </span>
                );
              })}
            </div>
          )}

          {!loading && !hasMovement && (
            <p
              className="absolute inset-0 grid place-items-center text-xs"
              style={{ color: "var(--graph-ink-muted)" }}
            >
              No movement recorded in this window.
            </p>
          )}
        </div>
      </div>

      {/* X axis. The hero suppresses it: that card lays the labels over the
          plate itself, so the plate can reach the card's bottom edge. */}
      <div
        aria-hidden="true"
        className={`${hero ? "hidden" : "flex"} ${compact ? "mt-1.5" : "mt-1.5 pl-12"}`}
        style={{ color: "var(--graph-ink-muted)" }}
      >
        {points.map((p, i) => (
          <span
            key={p.weekStart}
            className={`min-w-0 flex-1 truncate text-[11px] ${
              i === 0
                ? "text-left"
                : i === points.length - 1
                  ? "text-right"
                  : "text-center"
            } ${points.length > 8 && i % 2 === 1 ? "invisible sm:visible" : ""}`}
            data-figure
          >
            {p.label}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            {channels.map((c) => (
              <th key={c.id} scope="col">
                {c.label}
              </th>
            ))}
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.weekStart}>
              <th scope="row">{p.label}</th>
              {channels.map((c) => (
                <td key={c.id}>{p.values[c.id] ?? 0}</td>
              ))}
              <td>{p.net}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
