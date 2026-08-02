"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * DIRECTION CONTRACT — Cowork dashboard
 *
 * FORM: `dashboardlayoutref.png`, measured rather than interpreted. Every edge
 *   below was read off the file, not estimated:
 *
 *     content       x 56 → 2777          (2721 wide, gutters 34–39)
 *     row 1         1095 / 674 / 874     → 5 / 3 / 4 of twelve
 *     row 2          963 / 816 / 878     → 4 / 4 / 4
 *     A hero        345 → 846   h 501    aspect 0.46
 *     B1 · B2       345 → 578, 613 → 845 h 233 each, 35 between
 *     C list        345 → 925   h 580    ← ends 79px BELOW A and B
 *     D · E         877 → 1310, → 1420
 *     F1 · F2       962 → 1233, 1268 →   ← starts 85px below D and E
 *
 *   That last pair of facts is the structure, and it is what a two-row grid
 *   cannot express: the right-hand column is ONE stack running the whole height
 *   of the page — list, then gradient card, then the small action card — while
 *   the left eight columns carry two rows beside it. C overhangs row 1 and F
 *   begins below row 2's top edge because they are siblings in that stack, not
 *   cells in a grid. Hence `row-span-2` on the right column.
 *
 *   Proportions follow the same measurements: the hero is wide and flat (0.46,
 *   not the near-square it had become), the stacked pair is a third of its
 *   width, and the lists are capped so the right column does not tower over the
 *   composition it is supposed to sit inside.
 *
 * OWN-WORLD: "Chrome Under Frost", untouched. Frosted 18px cards on the living
 *   iridescent field, Geist, tabular figures, saturated colour only as C1–C4,
 *   and the field palette for the graph plate and the Next card.
 *   `iridescentgraphdark` and `iridescentgraphlight` remain the material
 *   authority for the plate — two materials, not one dimmed.
 *
 * CONTENT: the reference's content is a wallet's; Cowork's is work. The hero is
 *   the flow graph rather than a balance, the pair is score and load rather
 *   than income and expense, the tall list is triage rather than saved cards,
 *   the ring is where open work sits rather than where money went, and the
 *   gradient card is the next meeting rather than a referral offer.
 *
 * LENS: the team lens changes what each slot reads, never which slots exist.
 * ───────────────────────────────────────────────────────────────────────────── */

import { DashboardChrome } from "@/components/features/dashboard/Chrome";
import { DashboardSearch } from "@/components/features/dashboard/DashboardSearch";
import { SignatureGraph } from "@/components/features/dashboard/SignatureGraph";
import { ScoreStat, LoadStat } from "@/components/features/dashboard/Stats";
import { AttentionCard } from "@/components/features/dashboard/AttentionCard";
import { NowCard } from "@/components/features/dashboard/NowCard";
import { TeamLoadCard } from "@/components/features/dashboard/TeamLoadCard";
import { WorkMix } from "@/components/features/dashboard/WorkMix";
import { NextCard } from "@/components/features/dashboard/NextCard";
import { QuickAssign } from "@/components/features/dashboard/QuickAssign";
import { useLens } from "@/components/layout/shell/LensContext";

export function Home() {
  const { lens } = useLens();
  const team = lens === "team";

  return (
    <>
      <DashboardChrome />

      <DashboardSearch />

      {/* Two regions, not one grid of cells.
          A twelve-column grid with a row-spanning cell stretches its other rows
          to fit that cell, which opened a hole under the stacked pair. The
          reference has no such hole because its right-hand column is a stack
          standing beside the left region rather than a member of it. So: eight
          columns of rows on the left, four columns of stack on the right, each
          packing to its own content. The module is unchanged — the inner grids
          resolve to the same 557 / 328 and 443 / 443 the reference measures. */}
      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 deck:col-span-8">
          {/* Row 1 — hero 5, stacked pair 3. */}
          <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-8">
            <div className="min-w-0 deck:col-span-5">
              <SignatureGraph />
            </div>
            <div className="flex min-w-0 flex-col gap-4 deck:col-span-3">
              <ScoreStat />
              <LoadStat />
            </div>
          </div>

          {/* Row 2 — two equal cards. */}
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              {team ? <TeamLoadCard /> : <NowCard />}
            </div>
            <div className="min-w-0">
              <WorkMix />
            </div>
          </div>
        </div>

        {/* The right-hand stack — list, gradient card, action card — running
            the height of both rows and overhanging the first, as measured. */}
        <div className="flex min-w-0 flex-col gap-4 deck:col-span-4">
          <AttentionCard />
          <NextCard />
          <QuickAssign />
        </div>
      </div>
    </>
  );
}
