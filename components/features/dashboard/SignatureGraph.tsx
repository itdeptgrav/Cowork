"use client";

import Link from "next/link";
import { useState } from "react";
import { FlowGraph } from "./FlowGraph";
import { Icon } from "@/components/ui/Icons";
import { InlineError, SkeletonRows } from "@/components/ui/Primitives";
import { useLens } from "@/components/layout/shell/LensContext";
import { useQuery } from "@/lib/hooks/useRepository";
import type { WorkloadFlow } from "@/lib/domain";

/**
 * The signature card — Cowork's flow graph, given the dashboard's hero slot.
 *
 * Structure comes from `dashboardlayoutref`, whose hero is not a chart in a box
 * but a single large card whose *ground* is the colour: the figure sits on it,
 * the controls sit on it, and everything else on the page is quieter by
 * comparison. So the plot here is the card. It runs edge to edge, the header
 * floats over the plate, and the reading sits at the bottom-left where the
 * reference puts its actions.
 *
 * The material comes from `iridescentgraphdark` and `iridescentgraphlight`,
 * which are deliberately not the same picture at two brightnesses — see the
 * graph tokens in `globals.css`.
 *
 * It is one card, not two: the verdict sentence that used to live in a separate
 * momentum card is the chip on this one. A signature element competing with a
 * summary of itself was the reason neither read as important.
 */
export function SignatureGraph() {
  const { lens } = useLens();
  const team = lens === "team";
  const [weeks, setWeeks] = useState<8 | 12 | 24>(12);
  const [week, setWeek] = useState<string | null>(null);

  const flow = useQuery(
    (r) => r.getWorkloadFlow({ scope: team ? "team" : "mine", weeks }),
    [team, weeks],
    { staleTime: 30_000 },
  );

  const data = flow.data ?? null;
  /* A failed read has no reading. "No movement yet" beside an error message
     would be two different answers to the same question. */
  const reading = flow.error
    ? { figure: "—", unit: "unavailable", chip: "" }
    : verdict(data);

  return (
    <section
      aria-label={team ? "Team workload flow" : "Workload flow"}
      className="frost-panel relative isolate flex min-h-[300px] flex-col overflow-hidden rounded-card"
    >
      {/* THE PLATE, as the card's own ground — edge to edge, behind everything,
          exactly as the reference's hero carries its gradient. Nothing sits in
          a box on top of it; the header and the reading float. */}
      <div className="absolute inset-0 z-0">
        {/* The ground belongs to the card, not to the data. A failed or empty
            window still shows the plate — the identity is the material. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(160deg, var(--graph-ground-2) 0%, var(--graph-ground) 55%)",
          }}
        />
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

        {!flow.error && !flow.isLoading && !!data?.points.length && (
          <FlowGraph
            flow={data}
            loading={false}
            hero
            plate={false}
            selectedWeek={week}
            onSelectWeek={setWeek}
          />
        )}
      </div>

      <div className="relative z-10 flex flex-1 flex-col">
        {/* Header. Title left, window control right. */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 pt-4">
          <div className="min-w-0">
            <h2
              className="text-[17px] leading-none font-medium tracking-[-0.02em]"
              style={{ color: "var(--graph-ink)" }}
            >
              {team ? "Team workload flow" : "Workload flow"}
            </h2>
            <p
              className="mt-1.5 text-[11px]"
              style={{ color: "var(--graph-ink-muted)" }}
            >
              Arrivals draw up · completions draw down
            </p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <span
              role="radiogroup"
              aria-label="Window"
              className="inline-flex gap-0.5 rounded-full p-[3px] backdrop-blur-sm"
              style={{ backgroundColor: "var(--graph-chip)" }}
            >
              {([8, 12, 24] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={weeks === w}
                  onClick={() => {
                    setWeeks(w);
                    setWeek(null);
                  }}
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity"
                  style={
                    weeks === w
                      ? {
                          backgroundColor: "var(--graph-ink)",
                          color: "var(--graph-ground)",
                        }
                      : { color: "var(--graph-ink-muted)" }
                  }
                >
                  {w}w
                </button>
              ))}
            </span>

            <Link
              href="/tasks?view=timeline"
              aria-label="Open the timeline"
              title="Open the timeline"
              className="grid h-7 w-7 place-items-center rounded-full backdrop-blur-sm transition-opacity hover:opacity-70"
              style={{
                backgroundColor: "var(--graph-chip)",
                color: "var(--graph-chip-ink)",
              }}
            >
              <Icon.chevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* The reading. The reference floats a value chip over its chart; this
            is the same device carrying the only number that is a decision. */}
        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2 px-5">
          <p className="min-w-0">
            <span
              data-figure
              className="text-[clamp(2rem,3.4vw,3rem)] leading-none font-light tracking-[-0.035em]"
              style={{ color: "var(--graph-ink)" }}
            >
              {flow.isLoading ? "—" : reading.figure}
            </span>
            <span
              className="ml-2 text-xs"
              style={{ color: "var(--graph-ink-muted)" }}
            >
              {reading.unit}
            </span>
          </p>

          {!flow.isLoading && !flow.error && (
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm"
              style={{
                backgroundColor: "var(--graph-chip)",
                color: "var(--graph-chip-ink)",
              }}
            >
              {reading.chip}
            </span>
          )}

          {week && (
            <button
              type="button"
              onClick={() => setWeek(null)}
              className="rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm transition-opacity hover:opacity-75"
              style={{
                backgroundColor: "var(--graph-chip)",
                color: "var(--graph-chip-ink)",
              }}
            >
              Week of {week.slice(8, 10)}/{week.slice(5, 7)} · clear
            </button>
          )}
        </div>

        {/* States. The plate stays: a card whose identity is its material
            should not lose it because a fetch failed. */}
        {flow.error ? (
          <div className="mt-auto px-5 pb-5">
            <InlineError
              onSlab
              message="The workload flow could not be loaded."
              code={flow.error}
              onRetry={flow.refetch}
            />
          </div>
        ) : flow.isLoading ? (
          <div className="mt-auto px-5 pb-5 opacity-60">
            <SkeletonRows rows={3} />
          </div>
        ) : !data?.points.length ? (
          <p
            className="mt-auto px-5 pb-5 text-xs"
            style={{ color: "var(--graph-ink-muted)" }}
          >
            No movement recorded in this window yet.
          </p>
        ) : (
          /* The axis, laid over the plate's bottom edge — the plate reaches the
             card's corner and the labels sit on it, not under it. */
          <div
            aria-hidden="true"
            className="pointer-events-none mt-auto flex px-5 pb-4"
            style={{ color: "var(--graph-ink-muted)" }}
          >
            {data.points.map((p, i) => (
              <span
                key={p.weekStart}
                data-figure
                className={`min-w-0 flex-1 truncate text-[11px] ${
                  i === 0
                    ? "text-left"
                    : i === data.points.length - 1
                      ? "text-right"
                      : "text-center"
                } ${data.points.length > 9 && i % 2 === 1 ? "invisible deck:visible" : ""}`}
              >
                {p.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * What the curve says, as a figure and a sentence.
 *
 * Read from the last four weeks rather than the whole window: a dashboard
 * reports the present, and a long net can hide a month of slipping behind a
 * good start.
 */
function verdict(flow: WorkloadFlow | null): {
  figure: string;
  unit: string;
  chip: string;
} {
  if (!flow || !flow.points.length)
    return { figure: "—", unit: "no movement yet", chip: "Nothing recorded" };

  const recent = flow.points.slice(-4);
  let arrived = 0;
  let cleared = 0;
  for (const p of recent) {
    for (const ch of flow.channels) {
      const v = p.values[ch.id] ?? 0;
      if (ch.direction === "in") arrived += v;
      else cleared += v;
    }
  }

  const net = arrived - cleared;
  if (arrived === 0 && cleared === 0)
    return { figure: "0", unit: "moved in four weeks", chip: "Quiet" };
  if (net > 1)
    return {
      figure: `+${net}`,
      unit: "net over four weeks",
      chip: `${arrived} in · ${cleared} out — the queue is growing`,
    };
  if (net < -1)
    return {
      figure: `−${Math.abs(net)}`,
      unit: "net over four weeks",
      chip: `${cleared} out · ${arrived} in — the queue is draining`,
    };
  return {
    figure: "Level",
    unit: "over four weeks",
    chip: `${arrived} in · ${cleared} out — holding`,
  };
}
