"use client";

import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ComponentBand } from "@/components/ui/ComponentBand";
import { Icon } from "@/components/ui/Icons";
import { SlabCard } from "@/components/ui/SlabCard";
import { SkeletonRows } from "@/components/ui/Primitives";
import { MonitorRoom } from "@/components/features/monitoring/MonitorRoom";
import { LiveScreenViewer } from "@/components/features/monitoring/LiveScreenViewer";
import { ScreenDialog } from "@/components/features/monitoring/ScreenDialog";
import { duration } from "@/components/features/monitoring/MonitorParts";
import { useQuery } from "@/lib/hooks/useRepository";
import { STATUS_META } from "@/lib/status/employeeStatus";
import {
  AchievementsPanel,
  CollaborationPanel,
  GoalsPanel,
  KeyMomentsPanel,
  ObservationsPanel,
  PerformancePanel,
  RightNowPanel,
  ScoreContributionPanel,
  SessionDeck,
  TodayPanel,
  WorkloadPanel,
} from "./PersonMonitorPanels";
import type {
  Employee,
  MonitoringSubject,
  ScoreOverview,
} from "@/lib/domain";
import type { TaskView } from "@/lib/repositories";

/**
 * One person, watched.
 *
 * **The composition comes from `layoutreferences/managermontiroing.webp`; the
 * material, type, colour and spacing come from Cowork.** What was taken from
 * that image is its *arrangement*, which is the thing it does exceptionally:
 *
 *   left rail     x 190 → 510   (320w)  three stacked panels, unequal
 *   centre        x 537 → 1475  (938w)  ONE large media object, chrome inside it
 *   right rail    x 1495 → 1910 (415w)  three stacked panels, independent height
 *
 * Against a 1720px content box that is 18.6 / 54.5 / 24.1 percent, which in
 * twenty-four columns is **5 / 13 / 6** — the split this file uses, and the
 * reason it uses twenty-four rather than twelve. At twelve the centre rounds to
 * 6/12 and the live screen loses 90px of the width that is the entire point of
 * the panel.
 *
 * Three structural facts carried over, and one deliberately not:
 *
 *  1. **The media object is the anchor, and its chrome floats inside it.** A
 *     status bar stacked above the video would cost the screen the height it
 *     exists for. `LiveScreenViewer` already works this way; what is added here
 *     is the control deck *below* it, for the things that must be read rather
 *     than glanced at — capture state, link quality, the three actions.
 *  2. **The three columns are independent stacks, not grid cells.** The
 *     reference's right column ends 66px below its left, and nothing in it
 *     lines up with anything opposite. Expressed as grid rows that becomes a
 *     hole; expressed as three flex columns it becomes the composition.
 *  3. **Panels within a column differ in height and internal grammar** — a
 *     figure block, a scrolling timeline, a compact list. Per The Unequal Bands
 *     Rule, four surfaces of equal weight read as one repeated object.
 *
 *  Not carried: the reference's vertical icon rail. Cowork navigates from the
 *  top bar, and a second permanent navigation would be a new pattern paying for
 *  nothing.
 *
 * The dark, cinematic register the reference gets from translucent glass over a
 * photograph, Cowork gets from its own material order — the iridescent field
 * around the deck, opaque frosted panels on it, and two slabs: the person and
 * the screen. Per The Look-Through Rule the field is seen *between* surfaces,
 * never through one carrying text.
 */
export function PersonMonitor({
  employeeId,
  nav,
}: {
  employeeId: string;
  /**
   * The person's tab bar, rendered between the hero and the deck.
   *
   * Passed in rather than built here because the tabs belong to the record, not
   * to this composition — but the hero has to sit above them, and the hero
   * needs feeds only this component reads. A slot keeps the ownership honest in
   * both directions.
   */
  nav?: ReactNode;
}) {
  const [screenOpen, setScreenOpen] = useState(false);

  /* Seven feeds, seven reads. They come from different providers and fail
     independently, so each panel owns its own loading, empty and error state
     rather than the page holding one spinner over all of them. */
  const subjectQ = useQuery(
    (r) => r.getMonitoringSubject(employeeId),
    [employeeId],
  );
  const eventsQ = useQuery(
    (r) => r.listActivityEvents(employeeId),
    [employeeId],
  );
  const perfQ = useQuery(
    (r) => r.getMonitoringPerformance(employeeId),
    [employeeId],
  );
  const summaryQ = useQuery((r) => r.getDailySummary(employeeId), [employeeId]);
  const deviceQ = useQuery((r) => r.getDeviceInfo(employeeId), [employeeId]);
  const observationsQ = useQuery(
    (r) => r.listObservations(employeeId),
    [employeeId],
  );
  const teamQ = useQuery((r) => r.listTeamMonitoring(), []);
  const scoreQ = useQuery(
    (r) => r.getScoreOverview(employeeId),
    [employeeId],
  );
  const goalsQ = useQuery((r) => r.listGoals(employeeId), [employeeId]);
  /* One task read serves three panels. `scope: "all"` returns everything this
     manager may see, which is what makes both directions of "working with"
     derivable — who raised the work this person carries, and who carries the
     work they raised — without a collaboration feed the product does not have. */
  const tasksQ = useQuery(
    (r) => r.listTasks({ scope: "all", limit: 200 }).then((p) => p.items),
    [employeeId],
  );

  const subject = subjectQ.data ?? null;
  const events = eventsQ.data ?? [];
  const tasks = tasksQ.data ?? [];
  const row =
    (teamQ.data ?? []).find((t) => t.employeeId === employeeId) ?? null;

  const currentTask =
    tasks.find((t) => t.task.id === subject?.currentTaskId) ?? null;
  const counterparts = deriveCounterparts(tasks, employeeId);
  const meetings = events.filter((e) => e.kind === "meeting");

  if (subjectQ.isLoading && !subject) return <SkeletonRows rows={8} />;

  return (
    <MonitorRoom subjectId={employeeId}>
      {({ embedUrl, connecting, error: roomError }) => (
        <>
          <PersonHero
            subject={subject}
            score={scoreQ.data ?? null}
            onlineSecs={subject?.onlineSecondsToday ?? 0}
            focusSecs={perfQ.data?.focusSecondsToday ?? 0}
          />

          {nav && <div className="mt-4">{nav}</div>}

          {/* ── The monitoring deck · 5 / 13 / 6 of twenty-four ───────────
              `items-start` is deliberate: the three columns are independent
              stacks and must be free to end at different heights, which is
              what gives the composition its overhang rather than three
              boxes ruled off at the same line. */}
          <div className="mt-4 grid items-start gap-4 deck:grid-cols-24">
            {/* LEFT — the subject of everything else on the page. */}
            <div className="rise flex min-w-0 flex-col gap-4 deck:col-span-5">
              <RightNowPanel
                subject={subject}
                task={currentTask}
                loading={subjectQ.isLoading}
                queries={[subjectQ, tasksQ]}
              />
              <TodayPanel
                events={events}
                timezone={subject?.timezone ?? "UTC"}
                loading={eventsQ.isLoading}
                query={eventsQ}
              />
              <KeyMomentsPanel
                events={events}
                timezone={subject?.timezone ?? "UTC"}
                loading={eventsQ.isLoading}
                query={eventsQ}
              />
            </div>

            {/* CENTRE — the one thing on this page that is not a summary. */}
            {/* `self-stretch` on this column only, against the container's
                `items-start`. The row is already as tall as the tallest column,
                so stretching the centre lets the live screen — which has
                `flex-1` and object-contain — absorb the slack instead of
                leaving a 350px hole under the session deck. Left and right keep
                their natural heights, which is what preserves the reference's
                staggered column ends rather than ruling all three off level. */}
            <div
              className="rise flex min-w-0 flex-col gap-4 deck:col-span-13 deck:self-stretch"
              style={{ "--delay": "70ms" } as React.CSSProperties}
            >
              {subject ? (
                <LiveScreenViewer
                  embedUrl={embedUrl}
                  displayName={subject.displayName}
                  presence={subject.presence}
                  connecting={connecting}
                  error={roomError}
                />
              ) : (
                <NoSubjectFrame loading={subjectQ.isLoading} />
              )}
              <SessionDeck
                subject={subject}
                device={deviceQ.data ?? null}
                onOpenScreen={() => setScreenOpen(true)}
                live={subject?.presence === "online"}
                loading={subjectQ.isLoading}
                queries={[subjectQ, deviceQ]}
              />
            </div>

            {/* RIGHT — what the manager is being asked to do something about. */}
            <div
              className="rise flex min-w-0 flex-col gap-4 deck:col-span-6"
              style={{ "--delay": "140ms" } as React.CSSProperties}
            >
              <WorkloadPanel
                row={row}
                performance={perfQ.data ?? null}
                loading={teamQ.isLoading}
                queries={[teamQ, perfQ]}
              />
              <ObservationsPanel
                observations={observationsQ.data ?? []}
                loading={observationsQ.isLoading}
                query={observationsQ}
              />
              <CollaborationPanel
                counterparts={counterparts}
                meetings={meetings}
                timezone={subject?.timezone ?? "UTC"}
                loading={tasksQ.isLoading}
                queries={[tasksQ, eventsQ]}
              />
            </div>
          </div>

          {/* ── Performance ──────────────────────────────────────────────
              A section heading rather than another panel row: the deck above
              is "right now" and everything below it is "over time", and that
              is a change of subject the eye should be told about. 32px above
              and 12px below, per the vertical rhythm. */}
          <h2 className="mt-8 mb-3 text-[17px] leading-none font-medium tracking-[-0.02em] text-ink">
            Performance
          </h2>

          <div className="grid items-stretch gap-4 deck:grid-cols-24">
            <div className="flex min-w-0 deck:col-span-9">
              <ScoreContributionPanel score={scoreQ.data ?? null}>
                {scoreQ.data ? (
                  <ComponentBand
                    channels={scoreQ.data.channels}
                    height={72}
                    verbose={false}
                  />
                ) : (
                  <p className="py-4 text-xs text-slab-ink-muted">
                    No score for this period.
                  </p>
                )}
              </ScoreContributionPanel>
            </div>
            <div className="flex min-w-0 deck:col-span-8">
              <PerformancePanel
                performance={perfQ.data ?? null}
                summary={summaryQ.data ?? null}
                loading={perfQ.isLoading}
                queries={[perfQ, summaryQ]}
              />
            </div>
            <div className="flex min-w-0 deck:col-span-7">
              <GoalsPanel
                goals={goalsQ.data ?? []}
                loading={goalsQ.isLoading}
                query={goalsQ}
              />
            </div>
          </div>

          <div className="mt-4">
            <AchievementsPanel
              summary={summaryQ.data ?? null}
              loading={summaryQ.isLoading}
              query={summaryQ}
            />
          </div>

          <ScreenDialog
            open={screenOpen}
            onClose={() => setScreenOpen(false)}
            embedUrl={embedUrl}
            connecting={connecting}
            error={roomError}
            displayName={subject?.displayName ?? "This person"}
            presence={subject?.presence ?? "offline"}
          />
        </>
      )}
    </MonitorRoom>
  );
}

/* ── The header ───────────────────────────────────────────────────────────── */

/**
 * Who this is, how they are, and what their work is worth — one object.
 *
 * The stepped slab, at hero geometry. Per The Earned Step Rule the silhouette
 * is reserved for a card carrying *both* an identity and a measurement, and a
 * person on a performance surface is the case the rule was written for. It is
 * also the only hero on this view: the live screen below is a slab because it
 * is a video frame, not because it is competing for the same role.
 *
 * The presence dot is the one glowing element on the page and it earns that —
 * it is the single fact a manager opens this surface to check, and it is live.
 */
function PersonHero({
  subject,
  score,
  onlineSecs,
  focusSecs,
}: {
  subject: MonitoringSubject | null;
  score: ScoreOverview | null;
  onlineSecs: number;
  focusSecs: number;
}) {
  if (!subject) return null;
  const meta = STATUS_META[subject.presence];
  const localTime = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: subject.timezone,
  });

  return (
    <SlabCard
      /* Identity in the tab, measurement in the body — which is the whole
         reason the step exists. An avatar alone left 900px of raised slab
         carrying nothing at this width, and a step that makes room for
         nothing reads as a notch rather than as a silhouette. */
      tab={
        <div className="flex items-center gap-4">
          <Avatar
            initials={subject.initials}
            hue={subject.hue}
            name={subject.displayName}
            size="lg"
          />
          <div className="min-w-0">
            <h1 className="truncate text-[clamp(1.375rem,2.1vw,1.875rem)] leading-[1.1] font-[350] tracking-[-0.03em] text-slab-ink">
              {subject.displayName}
            </h1>
            <p className="mt-0.5 truncate text-sm text-slab-ink-muted">
              {subject.designation}
              {subject.departmentName ? ` · ${subject.departmentName}` : ""}
            </p>
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-6 pt-4 pb-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-slab-ink"
            title={meta.help}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: meta.dot,
                boxShadow:
                  subject.presence === "offline"
                    ? "none"
                    : `0 0 8px 1px ${meta.glow}`,
              }}
            />
            {meta.label}
          </span>
          <span
            data-figure
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-slab-ink"
            title={`Local time in ${subject.timezone}`}
          >
            <Icon.clock aria-hidden="true" className="h-3 w-3" />
            {localTime}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-slab-ink">
            <span data-figure>{duration(onlineSecs)}</span>
            <span className="text-slab-ink-muted">online</span>
          </span>
          {focusSecs > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-slab-ink">
              <span data-figure>{duration(focusSecs)}</span>
              <span className="text-slab-ink-muted">focused</span>
            </span>
          )}
        </div>

        {score && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-slab-ink-muted">
              Achieved against achievable
            </p>
            <p className="mt-1.5 flex items-baseline justify-end gap-2.5">
              <span
                data-figure
                className="text-[clamp(1.875rem,2.8vw,2.375rem)] leading-none font-light tracking-[-0.035em] text-slab-ink"
              >
                {Math.round(score.overallPercentage)}%
              </span>
              <span data-figure className="text-xs text-slab-ink-muted">
                {score.delta >= 0 ? "↑" : "↓"}
                {Math.abs(Math.round(score.delta))} on the period
              </span>
            </p>
          </div>
        )}
      </div>
    </SlabCard>
  );
}

/**
 * The centre frame when there is no monitoring subject at all.
 *
 * Distinct from `LiveScreenViewer`'s own empty states, which answer "why is
 * there no picture" for somebody who *can* be monitored. This answers a
 * different question — the person is visible on this surface but outside the
 * monitoring closure, which is a boundary rather than a fault, and saying
 * "no screen is being shared" there would be false.
 */
function NoSubjectFrame({ loading }: { loading: boolean }) {
  return (
    <section
      aria-label="Live screen"
      className="slab slab-flat grid min-h-[320px] flex-1 place-items-center rounded-card px-8 py-14 text-center"
      data-on-slab
    >
      <div className="max-w-[40ch]">
        <span
          aria-hidden="true"
          className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-white/[0.07] text-slab-ink-muted"
        >
          <Icon.overview className="h-5 w-5" />
        </span>
        <p className="text-[15px] font-medium text-slab-ink">
          {loading ? "Loading" : "Live monitoring is not available here"}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slab-ink-muted">
          {loading
            ? "Reading the monitoring feeds."
            : "Screens are only visible for people in your own reporting line. The rest of this record is unaffected."}
        </p>
      </div>
    </section>
  );
}

/* ── Derivation ───────────────────────────────────────────────────────────── */

/**
 * Who is on the other side of this person's work.
 *
 * Both directions, from one task list: the owner of a task assigned to them
 * raised work they are carrying; the assignees of a task they created are
 * carrying work they raised. Self-assignment is excluded — a person is not
 * their own collaborator, and leaving it in would put every solo task at the
 * top of the list.
 *
 * Ordered by how much work is actually shared, because the question is who
 * they are most in the loop with, not who appears alphabetically first.
 */
function deriveCounterparts(
  tasks: TaskView[],
  employeeId: string,
): { person: Employee; shared: number; direction: "from" | "to" }[] {
  const tally = new Map<
    string,
    { person: Employee; shared: number; direction: "from" | "to" }
  >();

  const add = (person: Employee, direction: "from" | "to") => {
    if (person.id === employeeId) return;
    const key = `${person.id}:${direction}`;
    const seen = tally.get(key);
    if (seen) seen.shared += 1;
    else tally.set(key, { person, shared: 1, direction });
  };

  for (const v of tasks) {
    const open =
      v.task.status !== "completed" && v.task.status !== "cancelled";
    if (!open) continue;

    if (v.assignees.some((a) => a.id === employeeId)) {
      if (v.owner) add(v.owner, "from");
    }
    if (v.task.createdById === employeeId) {
      for (const a of v.assignees) add(a, "to");
    }
  }

  return [...tally.values()].sort(
    (a, b) =>
      b.shared - a.shared ||
      a.person.displayName.localeCompare(b.person.displayName),
  );
}
