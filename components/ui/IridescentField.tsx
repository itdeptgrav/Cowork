"use client";

/**
 * The chrome field — the back layer of "Chrome Under Frost".
 *
 * Six large soft hues drifting on independent cycles behind everything. It is
 * the only thing in Cowork that moves at rest, and every frosted surface
 * depends on it: per The Look-Through Rule, glass over a flat backdrop is not
 * glass, it is grey. Rendered in CSS rather than as a bitmap so it never
 * repeats, costs no bytes, and stays sharp on any display.
 */

import { useDeviceMode } from "@/components/layout/shell/DeviceModeContext";

type Blob = {
  hue: string;
  top: string;
  left: string;
  size: string;
  dx: string;
  dy: string;
  ds: string;
  dur: string;
  delay: string;
  opacity: number;
};

const blobs: Blob[] = [
  {
    hue: "var(--color-field-ivory)",
    top: "28%",
    left: "6%",
    size: "46vw",
    dx: "9%",
    dy: "-7%",
    ds: "1.22",
    dur: "48s",
    delay: "0s",
    opacity: 0.9,
  },
  {
    hue: "var(--color-field-gold)",
    top: "52%",
    left: "22%",
    size: "38vw",
    dx: "-7%",
    dy: "8%",
    ds: "1.14",
    dur: "56s",
    delay: "-8s",
    opacity: 0.82,
  },
  {
    hue: "var(--color-field-rose)",
    top: "44%",
    left: "44%",
    size: "42vw",
    dx: "6%",
    dy: "9%",
    ds: "1.26",
    dur: "44s",
    delay: "-16s",
    opacity: 0.78,
  },
  {
    hue: "var(--color-field-mauve)",
    top: "20%",
    left: "58%",
    size: "40vw",
    dx: "-9%",
    dy: "6%",
    ds: "1.18",
    dur: "62s",
    delay: "-24s",
    opacity: 0.72,
  },
  {
    hue: "var(--color-field-slate)",
    top: "58%",
    left: "70%",
    size: "48vw",
    dx: "7%",
    dy: "-9%",
    ds: "1.2",
    dur: "50s",
    delay: "-12s",
    opacity: 0.8,
  },
  {
    hue: "var(--color-field-deep)",
    top: "72%",
    left: "36%",
    size: "52vw",
    dx: "-6%",
    dy: "-6%",
    ds: "1.3",
    dur: "68s",
    delay: "-30s",
    opacity: 0.55,
  },
];

export function IridescentField() {
  /*
   * **Not rendered at all in Plain mode.**
   *
   * The CSS hides it too, but hiding is not enough on its own: these ten nodes
   * each carry `will-change: transform`, which asks the compositor for a layer
   * whether or not the element is painted. Skipping the render is what stops the
   * layers being created — and on shared-memory graphics the layers, not the
   * paint, are the cost.
   *
   * Coherent rather than merely cheaper: the field exists so the frosted
   * surfaces have something to look through, and Plain mode has no frost.
   */
  const { profile } = useDeviceMode();
  if (profile.backdropField === "none") return null;

  return (
    <div className="field" aria-hidden="true">
      {blobs.map((b, i) => (
        <span
          key={i}
          className="field-blob"
          style={
            {
              top: b.top,
              left: b.left,
              width: b.size,
              height: b.size,
              opacity: b.opacity,
              background: `radial-gradient(circle at 34% 30%, ${b.hue}, transparent 68%)`,
              "--dx": b.dx,
              "--dy": b.dy,
              "--ds": b.ds,
              "--dur": b.dur,
              "--delay": b.delay,
            } as React.CSSProperties
          }
        />
      ))}
      {/* Specular bands over the hue blobs. Without these the field averages
          into a neutral haze and the frost above reads as plain grey — the
          reference's chrome is legible precisely because it has highlights and
          shadow cores for the glass to distort. */}
      {blobs.slice(0, 4).map((b, i) => (
        <span
          key={`spec-${i}`}
          className="field-spec"
          style={
            {
              top: b.top,
              left: b.left,
              width: b.size,
              height: b.size,
              opacity: 0.5,
              "--angle": `${72 + i * 34}deg`,
              "--dx": b.dx,
              "--dy": b.dy,
              "--ds": b.ds,
              "--dur": b.dur,
              "--delay": b.delay,
            } as React.CSSProperties
          }
        />
      ))}
      <span className="field-vignette" />
    </div>
  );
}
