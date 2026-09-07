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
 * DEPARTURE (19 Aug 2026) — the right stack is two cards, the meeting card
 *   joins the stat pair, and the page is sized to the window.
 *
 *   The reference’s right-hand column runs the height of the page because it
 *   holds three objects. Cowork’s third — the next meeting — is a FIXED shape
 *   with nothing to grow into, while its second is a triage list that grows
 *   with the work. Stacked in that order the column outran the left region and
 *   the page ended in a band of empty field on one side and a card past the
 *   fold on the other: one fault wearing two faces.
 *
 *   So the meeting card took the second slot of the row-1 pair — the slot open
 *   work held, which counted the same five tasks the ring below it breaks down
 *   by state — and the list took the height the meeting card vacated. The pair
 *   stretches to the hero’s height, so B2’s bottom edge meets A’s exactly, as
 *   the reference measures them (both rows end at 846).
 *
 *   The page carries a MIN height of one window, not a fixed one. A fixed
 *   height squashed row 1 below its content on a short screen and the ring
 *   overlapped the card above it by 20px. A minimum fills a tall window and
 *   yields to a short one, which is the only version of "one screen" that
 *   cannot clip. A dashboard is a glance surface; a summary you must scroll to
 *   finish is not a summary, but one that overlaps itself is worse.
 *
 * LENS: the team lens changes what each slot reads, never which slots exist.
 * ───────────────────────────────────────────────────────────────────────────── */

import { DashboardChrome } from "@/components/features/dashboard/Chrome";
import { ActiveTimerBar } from "@/components/features/dashboard/ActiveTimerBar";
import { DashboardSearch } from "@/components/features/dashboard/DashboardSearch";
import { SignatureGraph } from "@/components/features/dashboard/SignatureGraph";
import { ScoreStat } from "@/components/features/dashboard/Stats";
import { AttentionCard } from "@/components/features/dashboard/AttentionCard";
import { TeamLoadCard } from "@/components/features/dashboard/TeamLoadCard";
import { WorkMix } from "@/components/features/dashboard/WorkMix";
import { NextCard } from "@/components/features/dashboard/NextCard";
import { AttendanceButton } from "@/components/features/dashboard/AttendanceButton";
import { QuickAssign } from "@/components/features/dashboard/QuickAssign";
import { useLens } from "@/components/layout/shell/LensContext";
import { useSession } from "@/components/features/auth/SessionProvider";
import { canAccessAdminConsole } from "@/lib/rules/admin/access";

export function Home() {
  const { lens } = useLens();
  const team = lens === "team";
  /* Everybody's whereabouts on one screen is the comparative visibility the
     lens rule reserves for administration — the same single definition of
     administrator the console and the lens toggle use, never a second one. */
  const isAdmin = canAccessAdminConsole(useSession());

  return (
    /*
     * **One screen, and it does not scroll.**
     *
     * The dashboard is a glance surface: everything on it is a summary of
     * something else, and a summary you have to scroll to finish is not one.
     * It scrolled because the right-hand stack was three cards tall while the
     * left region packed to its content — so the page ended in a band of empty
     * field on the left and a card hanging past the fold on the right.
     *
     * The height is the window minus the chrome and ONE gap at each end, the
     * same arithmetic `MessagesPage` uses and for the same reason. The
     * negative bottom margin is what makes it possible: the frame pads the
     * bottom by more than the gap we want and a page cannot shrink its
     * parent’s padding, so the difference is pulled back here.
     *
     * Locked at `deck` only. Below it the columns stack and the page must
     * scroll — a fixed height there would clip the content instead of fitting
     * it, which is the failure this is trying to avoid.
     */
    <div className="deck:mb-[calc(var(--shell-gap)-var(--shell-bottom))] deck:flex deck:min-h-[calc(100vh-var(--shell-top)-2*var(--shell-gap))] deck:flex-col">
      <DashboardChrome />

      {/* The active-work bar and the search share one row, split on the same
          8 / 4 grid as the content below: the bar runs the width of the left
          region (ending where the graph does), and the search fills the right
          column, sitting above "Needs you". */}
      <div className="mb-4 grid shrink-0 grid-cols-1 items-center gap-4 deck:grid-cols-12">
        <div className="min-w-0 deck:col-span-8">
          <ActiveTimerBar />
        </div>
        <div className="min-w-0 deck:col-span-4">
          <DashboardSearch />
        </div>
      </div>

      {/* Two regions, not one grid of cells.
          A twelve-column grid with a row-spanning cell stretches its other rows
          to fit that cell, which opened a hole under the stacked pair. The
          reference has no such hole because its right-hand column is a stack
          standing beside the left region rather than a member of it. So: eight
          columns of rows on the left, four columns of stack on the right, each
          packing to its own content. The module is unchanged — the inner grids
          resolve to the same 557 / 328 and 443 / 443 the reference measures. */}
      <div className="grid grid-cols-1 items-start gap-4 deck:flex-1 deck:grid-cols-12 deck:items-stretch">
        <div className="flex min-w-0 flex-col gap-4 deck:col-span-8">
          {/* Row 1 — hero graph 5, stacked pair 3.

              **The pair is score and the next meeting, not score and open
              work.** Open work counted the same five tasks the ring beneath
              it breaks down by state — "5 open, 4 overdue" over "Open 5 ·
              Overdue 4 · Blocked 0 · In review 0 · Not started 1" — so the
              region opened with a figure and then immediately explained it
              twice. The meeting card is the fact neither of them carries.

              `items-stretch` (the default, restored from `items-start`) is
              what makes the two columns end on ONE line: the pair takes the
              graph’s height rather than its own content’s, and the meeting
              card — the `flex-1` half of that pair — absorbs the difference.
              Bottoms align at any window with no height written anywhere.

              **The row does NOT absorb the page’s surplus**, and that is
              deliberate: giving it `flex-1` made the hero grow with the
              window, and at 1200px it stood 802 tall against 524 wide — a
              portrait hero, against a contract that measures it wide and flat
              at 0.46. The graph keeps the height its content asks for; the
              meeting card is what flexes, which is the right way round
              because the graph has a measured proportion to honour and the
              meeting card has none. */}
          <div className="grid grid-cols-1 gap-4 deck:grid-cols-8">
            <div className="min-w-0 deck:col-span-5">
              <SignatureGraph />
            </div>
            <div className="flex min-w-0 flex-col gap-4 deck:col-span-3">
              <ScoreStat />
              <div className="min-w-0 deck:flex-1">
                <NextCard />
              </div>
            </div>
          </div>

          {/* Row 2 — the work mix ring. In the team lens it keeps its companion
              (team load); the personal "now" surface has moved up into the
              active-work bar, so the private lens gives the ring the full width
              rather than leaving a hole where the card was. */}
          {team ? (
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <TeamLoadCard />
              </div>
              <div className="min-w-0">
                <WorkMix />
              </div>
            </div>
          ) : (
            <div className="min-w-0 deck:shrink-0">
              <WorkMix />
            </div>
          )}
        </div>

        {/* The right-hand stack — action card then list, running
            the height of both rows. The gradient card that closed it has moved
            into the row-1 pair; see the DEPARTURE note at the head of this file.

            **QuickAssign leads it.** It carries the only "new task" control on
            the page now that the header's duplicate is gone, so it sits where
            that button was: top of the right column, under the search. Buried
            at the foot of a three-card stack it was the least findable thing on
            the dashboard while being the one thing people arrive wanting to do. */}
        <div className="flex min-w-0 flex-col gap-4 deck:col-span-4 deck:h-full deck:min-h-0">
          {/* Today's attendance — administrators only, and a BUTTON rather than
              the roster card this replaced: the count is the glance, the drawer
              behind it is the detail. It leads the right column because "who is
              here" is the first question of an administrator's morning, and a
              slim control can sit at the top of the page without displacing the
              work surfaces the way a full roster did. */}
          {isAdmin && <AttendanceButton />}
          <QuickAssign />
          {/**
            * Holds the rest of the column, so the two regions end on one line.
            *
            * **This reverses an earlier decision, on the owner's instruction
            * (5 Sep 2026).** It used to pack to its rows, because the list is
            * capped at six and beyond that height there is nothing for the card
            * to hold — the reasoning being that field below a finished card
            * reads as composition, while empty card below its own content reads
            * as a loading failure.
            *
            * The counter-argument, and the one that won: a right column that
            * stops short of the left one reads as unfinished at every window
            * size, and it does so ALL the time, whereas the empty band only
            * appears when there are few signals. If it becomes a nuisance the
            * fix is to let the list use the extra height rather than to shorten
            * the card again.
            *
            * `deck:` only, like the fixed height it fills: below that the
            * columns stack and the page scrolls, where stretching means
            * nothing. */}
          <div className="min-w-0 deck:min-h-0 deck:flex-1">
            <AttentionCard />
          </div>
        </div>
      </div>
    </div>
  );
}
