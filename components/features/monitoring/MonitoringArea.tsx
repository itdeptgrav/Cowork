"use client";

import { useState } from "react";
import { useQuery } from "@/lib/hooks/useRepository";
import { ErrorState, PermissionDenied } from "@/components/ui/Primitives";
import { WorkspaceHead } from "@/components/ui/Workspace";
import { MonitorRoom } from "./MonitorRoom";
import { ScreenDialog } from "./ScreenDialog";
import {
  EmployeeActivityOverview,
  InterventionPanel,
  LiveActionsPanel,
  ProductivityCard,
  ScoreCard,
  TeamAnalyticsPanel,
  TeamWorkloadList,
  WorkloadCard,
} from "./MonitorPanels";

/**
 * The manager monitoring dashboard.
 *
 * **The composition is `layoutreferences/dashboardlayoutref.png`, measured.**
 * That image is 2850×1502 — roughly 2× a 1363pt viewport, which is Cowork's own
 * 1360 container — so its boxes convert almost one-to-one. What was measured:
 *
 *   content box  x 54 → 2780 (2726 wide), a 12-column grid
 *   ROW 1  A x 54→1155 (5 col, h 501) │ B1 y 345→578, B2 y 613→845 (3 col)
 *          C x 1900→2780 (4 col, h 567 — 66px BELOW A, it overhangs)
 *   ROW 2  D x 54→1017 (h 543) │ E x 1051→1867 (h 543) │ F y 959→1237 (h 278)
 *
 * Two facts drive the markup:
 *
 *  1. **The right column is an independent stack, not a grid cell.** C's bottom
 *     edge sits 66px below A's, and F's boundaries line up with nothing on the
 *     left. Expressing that as grid rows would force C to A's height and open a
 *     hole under it. So the page is two regions: an 8-column region carrying two
 *     rows (5|3 then 4|4), and a 4-column region carrying one stack.
 *  2. **The centre stack sums to the large panel.** B1 + gap + B2 = 233+35+232
 *     = 500, against A's 501. Three cards instead of two keeps that: the stack
 *     stretches to the row, so the sum is preserved by construction.
 *
 * One rounding, stated: row 2 measures 963 / 816, which is 4.33 / 3.67 of eight
 * columns. It is built as 4 / 4 — the grid-legal reading. Row 1's 5 / 3 / 4 is
 * exact.
 *
 * Nothing else came from that image. Material, type, colour, radius, spacing,
 * state palette and both themes are Cowork's, unchanged.
 */
export function MonitoringArea() {
  const viewer = useQuery((r) => r.getViewer(), []);
  const teamQ = useQuery((r) => r.listTeamMonitoring(), []);
  const analyticsQ = useQuery((r) => r.getTeamAnalytics(), []);

  const rows = teamQ.data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const employeeId = selected ?? rows[0]?.employeeId ?? null;
  const [screenOpen, setScreenOpen] = useState(false);

  const subjectQ = useQuery(
    (r) =>
      employeeId ? r.getMonitoringSubject(employeeId) : Promise.resolve(null),
    [employeeId],
  );
  const eventsQ = useQuery(
    (r) =>
      employeeId ? r.listActivityEvents(employeeId) : Promise.resolve([]),
    [employeeId],
  );
  const perfQ = useQuery(
    (r) =>
      employeeId
        ? r.getMonitoringPerformance(employeeId)
        : Promise.resolve(null),
    [employeeId],
  );
  const summaryQ = useQuery(
    (r) => (employeeId ? r.getDailySummary(employeeId) : Promise.resolve(null)),
    [employeeId],
  );
  const deviceQ = useQuery(
    (r) => (employeeId ? r.getDeviceInfo(employeeId) : Promise.resolve(null)),
    [employeeId],
  );
  const interventionsQ = useQuery(
    (r) => (employeeId ? r.listInterventions(employeeId) : Promise.resolve([])),
    [employeeId],
  );

  const subject = subjectQ.data;
  const selectedRow = rows.find((r) => r.employeeId === employeeId) ?? null;

  const date = new Date(Date.UTC(2026, 6, 25)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  /* A failed roster read is NOT an empty roster.
     Both produce zero rows, and rendering "you have no reports" over a failure
     tells a manager something false about their own position — the worst kind
     of wrong answer, because it looks settled. The error branch comes first and
     carries the retry. */
  const rosterError = viewer.error ?? teamQ.error;
  if (rosterError) {
    return (
      <>
        <WorkspaceHead title="Monitoring" count={date} />
        <ErrorState
          title="Your reporting line could not be loaded"
          body={rosterError}
          onRetry={() => {
            viewer.refetch();
            teamQ.refetch();
          }}
        />
      </>
    );
  }

  /* An UNAVAILABLE roster is not an empty one either.
     The branch above says a failed read must not be rendered as "you have no
     reports", and the same is true of a read that succeeded with nothing in it
     while this manager plainly has people: the roster needs a stated capacity
     figure the engine does not send, so it comes back empty on this backend. A
     manager with eight reports was being told they had none — the same
     settled-looking wrong answer, arrived at from the other direction.
     The reporting line is the authority on who reports to whom, so it decides
     which of the two sentences is true. */
  const hasReports = (viewer.data?.directReportIds.length ?? 0) > 0;
  if (!viewer.isLoading && !teamQ.isLoading && rows.length === 0) {
    return (
      <>
        <WorkspaceHead title="Monitoring" count={date} />
        {hasReports ? (
          <ErrorState
            title="The monitoring roster is not available"
            body="Your reporting line is intact — this list needs a workload figure the Cowork engine does not report, so it cannot be built here yet. Open a person from Team to watch their screen; that view is connected."
            onRetry={() => teamQ.refetch()}
          />
        ) : (
          <PermissionDenied
            what="anyone's monitoring view"
            reason="You have no direct reports, so there is nothing to monitor here. Activity and scores are only ever visible looking down the reporting chain."
          />
        )}
      </>
    );
  }

  return (
    <MonitorRoom subjectId={employeeId}>
      {({ embedUrl, connecting, error: roomError, sharing }) => (
        <>
          <WorkspaceHead title="Monitoring" count={date} />

          <div className="grid gap-4 deck:grid-cols-12">
            {/* ── REGION 1 · left + centre, 8 of 12 ─────────────────────── */}
            {/* 24 inner columns, not 8, so row 2 can be measured rather than
                rounded: the reference splits it 963 / 816, which is 13 / 11 of
                twenty-four. Row 1's 5 / 3 becomes 15 / 9, unchanged.
                The row template carries the measured heights as flex factors —
                with an indefinite container, `501fr 543fr` sizes both rows from
                whichever needs more and holds the reference's 0.92 ratio
                between them, which no fixed height could survive a content
                change. */}
            <div className="grid gap-4 deck:col-span-8 deck:grid-cols-24 deck:grid-rows-[501fr_543fr]">
              {/* ROW 1 — A (15/24 ≡ 5/8) | B stack (9/24 ≡ 3/8) */}
              <div className="flex min-h-0 deck:col-span-15">
                <EmployeeActivityOverview
                  subject={subject}
                  summary={summaryQ.data}
                  events={eventsQ.data ?? []}
                  loading={subjectQ.isLoading}
                  queries={[subjectQ, eventsQ, summaryQ]}
                />
              </div>

              {/* Three equal rows, not a flex stack.
                  The reference's centre cards are the same height (233 / 232)
                  and together they equal the large panel beside them (500 ≡
                  502). A flex stack gave 114 / 191 / 155 summing to 492 against
                  a 554 panel — three different heights and 62px of dead space
                  at the bottom of the column, which is what made the cards read
                  as floating rather than composed. Equal rows restore both
                  relationships by construction: the tallest card sets the row,
                  the other two match it, and the column can no longer end short
                  of its neighbour. */}
              <div className="grid min-h-0 gap-4 deck:col-span-9 deck:grid-rows-3">
                <ScoreCard
                  performance={perfQ.data}
                  loading={perfQ.isLoading}
                  query={perfQ}
                />
                <ProductivityCard
                  performance={perfQ.data}
                  summary={summaryQ.data}
                  loading={perfQ.isLoading}
                  queries={[perfQ, summaryQ]}
                />
                <WorkloadCard
                  performance={perfQ.data}
                  row={selectedRow}
                  loading={perfQ.isLoading}
                  queries={[perfQ, teamQ]}
                />
              </div>

              {/* ROW 2 — D (13/24) | E (11/24), measured, not rounded */}
              <div className="flex min-h-0 deck:col-span-13">
                <TeamWorkloadList
                  rows={rows}
                  selectedId={employeeId}
                  onSelect={setSelected}
                  loading={teamQ.isLoading}
                  query={teamQ}
                />
              </div>
              <div className="flex min-h-0 deck:col-span-11">
                <TeamAnalyticsPanel
                  analytics={analyticsQ.data}
                  loading={analyticsQ.isLoading}
                  query={analyticsQ}
                />
              </div>
            </div>

            {/* ── REGION 2 · right, 4 of 12, one stack ────────────────────
                The stack spans the whole page height and the intervention panel
                takes the surplus, which is what makes C's bottom edge sit below
                A's in the reference. Capping it here rather than letting it grow
                is also why the actions panel stays in view: a list of alerts
                that pushes the actions off-screen has answered "what needs me"
                and hidden "what can I do about it". */}
            <div className="flex min-h-0 flex-col gap-4 deck:col-span-4">
              <InterventionPanel
                /* `basis-0` matters: with flex-basis auto this panel's own content
                   height would inflate the right column and force the left
                   region to match it. At basis 0 it claims nothing and grows
                   into what the left region leaves, which is how C ends up
                   taller than A — the overhang, expressed as a rule rather
                   than a number. */
                className="min-h-0 deck:flex-1 deck:basis-0"
                items={interventionsQ.data ?? []}
                displayName={subject?.displayName ?? "this person"}
                loading={interventionsQ.isLoading}
                query={interventionsQ}
              />
              <LiveActionsPanel
                subject={subject}
                device={deviceQ.data}
                onOpenScreen={() => setScreenOpen(true)}
                loading={subjectQ.isLoading}
                query={deviceQ}
              />
            </div>
          </div>

          <ScreenDialog
            open={screenOpen}
            onClose={() => setScreenOpen(false)}
            embedUrl={embedUrl}
            connecting={connecting}
            error={roomError}
            sharing={sharing}
            displayName={subject?.displayName ?? "This person"}
            presence={subject?.presence ?? "offline"}
          />
        </>
      )}
    </MonitorRoom>
  );
}
