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
 *   The 5/3/4 proportion is kept. The overhang is NOT, and that is a deliberate
 *   departure from the reference rather than a drift away from it.
 *
 *   The reference can afford a right-hand column that overhangs its rows
 *   because it is 2721px wide: at that measure the stack reads as its own
 *   panel standing beside the composition. Cowork renders at roughly half of
 *   it, and there the same overhang stopped reading as a second panel and
 *   started reading as cards that missed. Measured at 1470: the stack's card
 *   boundaries fell 16–31px from the left region's, and the interior seam
 *   moved 117px between row 1 (4/4, edge at 493) and row 2 (5/3, edge at 610).
 *   A near-miss is the one offset that always reads as an error.
 *
 *   So the structure here is two stretch bands across a single twelve-column
 *   grid at 5 / 3 / 4. Both interior seams hold the full height of the page,
 *   and every card in a band shares a top and a bottom edge. The reference's
 *   hierarchy — wide lead, narrow support, rail — is now stated identically in
 *   both bands instead of being re-improvised per row.
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

      {/* ONE grid of two bands, not two regions with private rhythms.
          The previous shape — eight columns of rows beside a four-column stack,
          each packing to its own content — is what made this page read as
          amateur, and it is measurable rather than a matter of taste:

            · the interior seam MOVED between rows. Row 1 split the left region
              4/4 (edge at 493) and row 2 split it 5/3 (edge at 610). Two rows
              stacked directly on each other, drawn against two different
              column edges, 117px apart. The eye tracks a vertical edge down a
              page; there was none to track.
            · row 1's three cards ended at 422 / 535 / 566 — a 144px ragged
              hem, because `items-start` lets every card pack to its content.
            · the right stack's card boundaries landed 16–31px off the left
              region's. Not aligned, and not decisively offset either: a
              near-miss reads as a mistake, where a large offset reads as
              intent.

          So: twelve columns, 5 / 3 / 4, and those two seams hold from the top
          of the page to the bottom. Both bands are stretch rows, so every card
          in a band shares a top AND a bottom edge. The hierarchy the reference
          asked for survives — a wide lead slot, a narrow support slot, a rail —
          but it is now the SAME hierarchy in both bands rather than a fresh
          improvisation per row.

          Three widths, and the collapse is by PRIORITY rather than by source
          order. Under `sm` one column: what to do now, where the work sits,
          what needs you, then the trend. Between `sm` and `deck` six columns —
          the lead card of each band takes the full width and its two
          supporting cards halve the row beneath it, so a tablet is not handed
          a phone layout. At `deck` the twelve-column composition above. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-6 deck:grid-cols-12">
        {/* ── Band 1 · the situation right now ───────────────────────────── */}

        {/* `grid` on the wrapper rather than `block`: a lone grid child
            stretches to its row, which is what carries the shared hem down to
            cards that do not take a className of their own. */}
        <div className="grid min-w-0 sm:col-span-6 deck:col-span-5">
          {team ? <TeamLoadCard /> : <NowCard />}
        </div>
        <div className="grid min-w-0 sm:col-span-3 deck:col-span-3">
          <WorkMix />
        </div>
        <div className="grid min-w-0 sm:col-span-3 deck:col-span-4">
          <AttentionCard />
        </div>

        {/* ── Band 2 · the trend, and what is coming ─────────────────────── */}

        <div className="grid min-w-0 sm:col-span-6 deck:col-span-5">
          <SignatureGraph />
        </div>
        {/* Two figures of one idea, so they sit tighter than the 16px card
            gutter — proximity doing the grouping instead of another container.
            Equal rows, so the pair reads as one divided block rather than two
            cards that happen to be adjacent. */}
        <div className="grid min-w-0 grid-rows-2 gap-3 sm:col-span-3 deck:col-span-3">
          <ScoreStat />
          <LoadStat />
        </div>
        {/* The meeting card takes the slack; handing work over is a small fixed
            affordance and should not be inflated to match it. */}
        <div className="grid min-w-0 grid-rows-[1fr_auto] gap-4 sm:col-span-3 deck:col-span-4">
          <NextCard />
          <QuickAssign />
        </div>
      </div>
    </>
  );
}
