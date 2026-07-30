import Link from "next/link";
import { hasDataOn } from "@/lib/rules/scoring/scoreDisplay";
import type { ChannelBreakdown } from "@/lib/domain";

/**
 * The C1–C4 band.
 *
 * Four adjacent full-bleed channels share one baseline with no gaps, forming a
 * continuous ribbon at the foot of a slab card. Three rules from docs/architecture/DESIGN.md are
 * load-bearing here:
 *
 *  - The No Weighting Rule — each channel has its own independent baseline and
 *    is never sized relative to the others. Component weights are an undecided
 *    product fact, and a stacked or proportional band would assert a split
 *    Cowork has not chosen.
 *  - The Deduction Hangs Rule — C3 is deduction-only, so it fills DOWNWARD from
 *    the top of the band while the rest stand on the baseline. Direction, not
 *    magnitude, carries the semantics, so a large deduction can never be
 *    misread as a strong result.
 *  - The Four Channels Rule — these hues mean "score component" and nothing
 *    else anywhere in the product.
 */

const channelColor: Record<string, string> = {
  c1: "var(--color-c1)",
  c2: "var(--color-c2)",
  c3: "var(--color-c3)",
  c4: "var(--color-c4)",
};

interface ComponentBandProps {
  channels: ChannelBreakdown[];
  /** Ribbon height in px. Compact cards in a rail use a shorter band. */
  height?: number;
  /**
   * Let the ribbon absorb the height of a stretched card instead of sitting at
   * a fixed size with a void above it. `height` then acts as a minimum.
   */
  fillTrack?: boolean;
  /** Show the per-channel caption line. Suppressed on compact cards. */
  verbose?: boolean;
  /**
   * When set, each channel becomes a link to `${linkBase}/${ch.id}`. The brief
   * asks for clickable component summaries: a channel that states a figure and
   * cannot be opened makes the person go and find the same number again.
   */
  linkBase?: string;
}

export function ComponentBand({
  channels,
  height = 92,
  fillTrack = false,
  verbose = true,
  linkBase,
}: ComponentBandProps) {
  return (
    // items-stretch, never items-end: the label blocks below have different
    // heights, and bottom-aligning the columns would knock the four tracks off
    // their shared baseline.
    <div className={`flex items-stretch ${fillTrack ? "min-h-0 flex-1" : ""}`}>
      {channels.map((ch, i) => {
        const hangs = ch.direction === "down";
        const color = channelColor[ch.id];
        // No measured units is NOT a zero. A person with no tasks this period
        // has not failed task execution, and rendering "0%" over an empty track
        // says they have — a reading that follows someone into a review.
        // Measured means SCORED, not "a count was reported". The engine sends
        // no count, so testing it alone rendered every channel as empty.
        const measured = hasDataOn(ch);
        const Col = linkBase ? Link : "div";
        const colProps = linkBase
          ? {
              href: `${linkBase}/${ch.id}`,
              "aria-label": `${ch.code} ${ch.label} detail`,
            }
          : {};

        return (
          <Col
            key={ch.id}
            {...(colProps as { href: string })}
            /* `@container`: each channel column is its own query container, so
               the label below reflows on the COLUMN's width rather than the
               window's. See the note on that label. */
            className={`@container flex min-w-0 flex-1 flex-col ${
              linkBase
                ? "transition-opacity duration-[180ms] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slab-ink"
                : ""
            }`}
          >
            {/* The ribbon. Fills are absolutely positioned so adjacent channels
                touch with no gap, exactly as in the reference. The faint track
                keeps a small value reading as a measured channel rather than as
                an empty column — which matters most for C3, where a good result
                is a nearly empty bar. */}
            <div
              className={`relative bg-white/[0.045] ${fillTrack ? "min-h-0 flex-1" : ""}`}
              style={fillTrack ? { minHeight: height } : { height }}
            >
              {measured ? (
                <span
                  className={`band-fill band-grow absolute inset-x-0 ${
                    hangs ? "top-0 origin-top" : "bottom-0 origin-bottom"
                  }`}
                  style={
                    {
                      height: `${Math.max(ch.extent, 4)}%`,
                      backgroundColor: color,
                      "--delay": `${140 + i * 70}ms`,
                    } as React.CSSProperties
                  }
                />
              ) : (
                /* Unmeasured reads as a ruled-off column, never as an empty
                   one — an empty track and a zero track look identical. */
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-full"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, rgba(255,255,255,0.09) 0 1px, transparent 1px 7px)",
                  }}
                />
              )}
            </div>

            {/* Leader hairline down to a channel-hued tick, then the label. */}
            <span aria-hidden="true" className="block h-8 w-px bg-white/15" />
            <span
              aria-hidden="true"
              className="-ml-[2.5px] mb-2.5 block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: color }}
            />

            <div className="pr-3">
              {/* docs/architecture/PRODUCT.md is explicit: the code appears ALONGSIDE the
                  descriptive label — never `C1` alone and never the label
                  alone. So a narrow column wraps the pairing onto a second line
                  rather than dropping either half of it. */}
              {/* The label box reserves three lines UNCONDITIONALLY.
                  It previously dropped that reservation at `min-[560px]`, which
                  is a VIEWPORT query — but the thing that decides whether
                  `Conduct & Policy` wraps is the COLUMN's width, not the
                  window's. On a 1460px viewport a 61px column in a team card
                  still wrapped to three lines with the reservation switched off,
                  so C3's percentage sat 15px below its neighbours. Percentages
                  the eye compares must share a baseline at every width, and the
                  only width that can decide that is this element's own. */}
              <p className="min-h-[3.6em] text-xs leading-tight text-slab-ink-muted @[150px]:min-h-[2.4em]">
                <span className="text-slab-ink/70">{ch.code}</span>
                <span className="hidden @[150px]:inline"> · </span>
                <span className="block @[150px]:inline">{ch.label}</span>
              </p>
              <p
                data-figure
                className="mt-1 text-[22px] leading-none tracking-[-0.025em] text-slab-ink"
              >
                {measured ? (
                  <>
                    {/* Minus sign U+2212, not a hyphen — this is a value. */}
                    {ch.percentage < 0
                      ? `−${Math.abs(Math.round(ch.percentage))}`
                      : Math.round(ch.percentage)}
                    %
                  </>
                ) : (
                  <span className="text-slab-ink-muted">—</span>
                )}
              </p>
              {/* What the figure is measured ACROSS — never what it is worth.
                  A points decomposition (`0.8 / 1.0 pts` under each channel,
                  summing to one total) publishes a weighting the product has
                  not decided: pooled units make attendance 67% of the composite
                  purely because there are more attendance days than tasks.
                  docs/architecture/PRODUCT.md:87 and :107 forbid displaying that split; the unit
                  count gives the same traceability and asserts nothing. */}
              <p className="mt-0.5 hidden text-[11px] text-slab-ink-muted @[150px]:block">
                {measured
                  ? `${ch.unitCount} ${ch.unitCount === 1 ? "unit" : "units"} measured`
                  : "not measured"}
              </p>
              {/* Full-strength muted ink, not a fraction of it: #949494 holds
                  4.99:1 on the slab, and any opacity below that fails 4.5:1. */}
              {verbose && (
                <p className="mt-1.5 hidden text-xs leading-snug text-slab-ink-muted deck:block">
                  {ch.caption}
                </p>
              )}
            </div>
          </Col>
        );
      })}
    </div>
  );
}
