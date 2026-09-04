"use client";

/**
 * What a SPARKLINE or IMAGE cell shows — a small SVG, or a picture.
 *
 * A sparkline is drawn to the cell's own size on every render, so a column
 * dragged wider gets a wider chart; it has no axes, labels or legend, which
 * is the whole point of one. The picture is an ordinary `<img>` limited to
 * https addresses (the function refuses anything else), never scripted.
 */

import type { RichPayload } from "@/lib/spreadsheet/formula/value";

const ACCENT = "#5b7bd5";

function Sparkline({ p, width, height }: { p: Extract<RichPayload, { type: "sparkline" }>; width: number; height: number }) {
  const w = Math.max(8, width - 6);
  const h = Math.max(6, height - 6);
  const vals = p.values;
  const color = p.color ?? ACCENT;
  if (vals.length === 0) return null;
  const lo = p.min ?? Math.min(0, ...vals);
  const hi = p.max ?? Math.max(...vals);
  const span = hi - lo || 1;
  const y = (v: number) => h - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * h;

  if (p.chart === "line") {
    const step = vals.length > 1 ? w / (vals.length - 1) : 0;
    const points = vals.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Sparkline">
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }
  if (p.chart === "bar") {
    /* One horizontal bar split in proportion — Sheets' "bar" sparkline. */
    const total = vals.reduce((a, b) => a + Math.abs(b), 0) || 1;
    const segments: { x: number; w: number }[] = [];
    vals.reduce((x, v) => {
      const bw = (Math.abs(v) / total) * w;
      segments.push({ x, w: bw });
      return x + bw;
    }, 0);
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Bar sparkline">
        {segments.map((seg, i) => (
          <rect key={i} x={seg.x} y={h * 0.2} width={Math.max(0, seg.w - 1)} height={h * 0.6} fill={color} opacity={i % 2 === 0 ? 1 : 0.55} />
        ))}
      </svg>
    );
  }
  /* column and winloss: one column per value. */
  const gap = 1;
  const bw = Math.max(1, (w - gap * (vals.length - 1)) / vals.length);
  const zero = p.chart === "winloss" ? h / 2 : y(0);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={p.chart === "winloss" ? "Win-loss sparkline" : "Column sparkline"}>
      {vals.map((v, i) => {
        const top = p.chart === "winloss" ? (v >= 0 ? 0 : h / 2) : Math.min(zero, y(v));
        const bottom = p.chart === "winloss" ? (v >= 0 ? h / 2 : h) : Math.max(zero, y(v));
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={top}
            width={bw}
            height={Math.max(1, bottom - top)}
            fill={v < 0 && p.chart === "winloss" ? "#c0392b" : color}
          />
        );
      })}
    </svg>
  );
}

export function CellVisual({ payload, width, height }: { payload: RichPayload; width: number; height: number }) {
  if (payload.type === "sparkline") return <Sparkline p={payload} width={width} height={height} />;
  const fit = payload.mode === 2 ? "fill" : payload.mode === 3 ? "none" : "contain";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={payload.url}
      alt=""
      draggable={false}
      style={{ width: "100%", height: "100%", objectFit: fit, objectPosition: "left center", display: "block" }}
    />
  );
}
