"use client";

import Link from "next/link";
import { useState } from "react";
import {
  describeTotals,
  filterLedger,
  groupLedger,
  isFiltered,
  isReversed,
  recentEntries,
  signedPointsOf,
  totalsOf,
  LEDGER_COMPONENTS,
  NO_FILTER,
  type LedgerEntryLike,
  type LedgerQuery,
} from "@/lib/rules/scoring/scoreLedgerHistory";
import {
  offersChoice,
  resolveSubject,
  scoreSubjects,
} from "@/lib/rules/scoring/scoreSubjects";
import {
  factsOf,
  outcomeOf,
  reasonsFor,
} from "@/lib/rules/scoring/taskExplanation";
import {
  explanationFor,
  presentChannel,
  presentLedgerEntry,
  presentOverview,
  trendFrom,
  DETAIL_ELSEWHERE,
} from "@/lib/rules/scoring/scoreDisplay";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import {
  EmptyState,
  ErrorState,
  Meter,
  Panel,
  PermissionDenied,
  ProvisionalBadge,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { ComponentBand } from "@/components/ui/ComponentBand";
import { TimerSopCounters } from "@/components/features/attendance/TimerSopCounters";
import { useQuery } from "@/lib/hooks/useRepository";
import { usePermissions, useViewerId } from "@/lib/hooks/usePermissions";
import { formatDateFull, formatPoints } from "@/lib/utils/format";
import { formatPeriod } from "@/lib/rules/scoring/engine";
import { CHANNEL_CODE, CHANNEL_LABEL, type ChannelId } from "@/lib/domain";

/**
 * Score surfaces.
 *
 * Every figure is points-over-points and every figure traces to the events
 * beneath it — that traceability is the whole point of the ledger, and it is
 * what makes a score decomposable rather than a verdict.
 */

import { SCORE_TABS as TABS } from "./tabs";

export function ScoreOverviewPage({
  employeeId,
}: {
  /** Omitted means "the acting person" — never a seeded default. */
  employeeId?: string;
}) {
  const viewerId = useViewerId();
  const subject = employeeId ?? viewerId ?? "";
  const { data, isLoading, error, refetch } = useQuery(
    (r) => r.getScoreOverview(subject),
    [subject],
  );
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  /* The annual strip, for a trend the engine actually reported. Failure here
     costs the arrow and nothing else — the score does not depend on it. */
  const history = useQuery((r) => r.listScoreHistory(subject), [subject]);
  /**
   * **What actually happened to the score, on the page that states it.**
   *
   * Reported 17 Aug 2026: the Score tab explained the model at length and never
   * once said what had been earned or taken off. The events were two clicks away
   * on History and what stood in their place was prose, so the first thing a
   * person read about their own quarter was a caveat about weightings.
   *
   * The whole ledger, unfiltered, exactly as the History tab asks for it — the
   * panel below shows the newest entries and names how many earlier ones it is
   * not showing. Gated on `subject` for the reason spelled out in `ChannelPage`:
   * an empty id builds a path that matches no route and answers an HTML 404.
   */
  const ledger = useQuery(
    (r) => (subject ? r.listLedger(subject) : Promise.resolve([])),
    [subject],
  );

  if (isLoading) return <SkeletonRows rows={8} />;
  if (error) return <ErrorState body={error} onRetry={refetch} />;
  if (!data) return <PermissionDenied what="this score" />;

  /* One resolver decides what is safe to show — see `scoreDisplay.ts`. */
  const view = presentOverview(data);
  const trend = trendFrom(history.data ?? [], data.periodKey);

  return (
    <>
      <WorkspaceHead
        title="Your score"
        count={
          /* The composite's point total is deliberately absent. Printing
             "20.7 of 27 points" invites the reader to divide it back into
             components, and the division would publish a weighting the product
             has not chosen (O2).

             The measured count is stated only when a provider reports one. It
             used to sum an unreported count as zero, so a real score sat under
             "0 units measured" — two statements that cannot both be true. */
          <>
            {view.periodLabel}
            {view.measuredCount !== null && (
              <>
                {" · "}
                <span data-figure>{view.measuredCount}</span>{" "}
                {view.measuredCount === 1 ? "item" : "items"} measured
              </>
            )}
          </>
        }
        tabs={<IconTabs items={TABS} active="overview" />}
      />

      {/* Today's Work — the Timer SOP deficit/overtime counters, driven by real
          tracked work time. Sits above the channels because it is a live daily
          figure, not part of the C1–C4 composite. */}
      <TimerSopCounters />

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        <div className="deck:col-span-8">
          {/* The slab — the one place the stepped silhouette is earned. */}
          <div
            className="slab-wrap"
            style={{ "--tab-rise": "72px" } as React.CSSProperties}
          >
            <div className="slab">
              <div
                className="slab-content absolute left-0 px-6"
                style={{ top: "-54px" }}
              >
                {me.data && (
                  <Avatar
                    initials={me.data.initials}
                    hue={me.data.hue}
                    src={me.data.profilePictureUrl}
                    name={me.data.displayName}
                    size="lg"
                  />
                )}
              </div>
              <div className="slab-content px-6 pt-7 pb-6">
                <p className="text-xs text-slab-ink-muted">
                  Achieved against achievable
                </p>
                <p className="mt-2 flex items-baseline gap-3">
                  <span
                    data-figure
                    className="text-[clamp(2.5rem,4.6vw,3.5rem)] leading-none font-light tracking-[-0.035em] text-slab-ink"
                  >
                    {Math.round(data.overallPercentage)}%
                  </span>
                  {/* **A real trend, or none.** `delta` is documented as always
                      zero — the dashboard answers for one period — so this used
                      to render "↑0 since <last quarter>" on every score, which
                      is a claim about a comparison nobody made. The annual strip
                      on the same response carries prior quarters, so the change
                      is now two reported figures subtracted, and absent when
                      there is no earlier period to subtract. */}
                  {trend.change !== null && trend.previousLabel && (
                    <span data-figure className="text-sm text-slab-ink-muted">
                      {trend.direction === "up"
                        ? "↑"
                        : trend.direction === "down"
                          ? "↓"
                          : "→"}
                      {Math.abs(Math.round(trend.change))} since{" "}
                      {trend.previousLabel}
                    </span>
                  )}
                </p>
                {/**
                 * **One line, and it still cannot be a comfortable one.**
                 *
                 * This was four sentences of caveat standing where the record of
                 * somebody's quarter belongs. What it may not lose is the fact
                 * that pooling every unit into one total weights each component
                 * by how many units it happens to have — attendance carries the
                 * composite simply because there are more attendance days than
                 * tasks — because an earlier version claimed the opposite and
                 * that claim was false. So the fact stays and the essay goes;
                 * the decisions themselves are one link away, where they can be
                 * read by anybody who wants them.
                 */}
                <p className="mt-2 text-xs text-slab-ink-muted">
                  Provisional — pooled, so a component with more measured units
                  counts for more.{" "}
                  <Link
                    href="/admin/scoring-rules"
                    className="text-slab-ink underline-offset-2 hover:underline"
                  >
                    Open decisions
                  </Link>
                </p>
              </div>
              <div className="slab-content px-6 pb-6">
                {/* `verbose` off: the band's captions restated what each channel
                    measures under all four columns, and the channel's own tab is
                    where that sentence now lives — see `ChannelPage`. What stays
                    is the figure, its label and what it was measured across. */}
                <ComponentBand
                  channels={data.channels}
                  height={92}
                  verbose={false}
                />
              </div>
            </div>
          </div>

          {/* The record, directly under the figure it produced. */}
          <div className="mt-4">
            <EarnedAndLost
              entries={ledger.data ?? []}
              isLoading={ledger.isLoading}
              error={ledger.error}
              onRetry={ledger.refetch}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 deck:col-span-4">
          <Panel label="Channels">
            <h2 className="text-sm font-medium text-ink">Channels</h2>
            <ul className="mt-3 space-y-3">
              {data.channels.map((c) => {
                const ch = presentChannel(c);
                return (
                  <li key={c.id}>
                    <Link href={`/score/${c.id}`} className="block">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-ink">
                          {c.code} · {c.label}
                        </span>
                        {/* No score rather than a confident 0%. An unscored
                            channel and a channel scored zero are different
                            facts about somebody's quarter. */}
                        <span
                          data-figure
                          className={`shrink-0 text-sm ${
                            ch.percentage === null ? "text-ink-faint" : "text-ink"
                          }`}
                        >
                          {ch.percentage === null ? (
                            "Not scored yet"
                          ) : (
                            <>
                              {ch.percentage < 0 ? "−" : ""}
                              {Math.abs(Math.round(ch.percentage))}%
                            </>
                          )}
                        </span>
                      </div>
                      {ch.percentage !== null && (
                        <Meter
                          value={c.extent}
                          label={`${c.label} extent`}
                          className="mt-1.5"
                        />
                      )}
                      {/* What moves this channel is stated on the channel's own
                          tab, which is one tap from here and is where somebody
                          asking the question is going anyway. Four sentences of
                          it in a rail is what pushed the actual record off the
                          page. */}
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
                        {/* Points only when they actually produce the
                            percentage above — see `pointsReconcile`. */}
                        {ch.earnedPoints !== null && ch.possiblePoints !== null && (
                          <span>
                            <span data-figure>{formatPoints(ch.earnedPoints)}</span>{" "}
                            of{" "}
                            <span data-figure>{formatPoints(ch.possiblePoints)}</span>{" "}
                            points
                          </span>
                        )}
                        {ch.measuredCount !== null && (
                          <span>
                            <span data-figure>{ch.measuredCount}</span>{" "}
                            {ch.measuredCount === 1 ? "item" : "items"} measured
                          </span>
                        )}
                        {c.hasProvisionalRules && <ProvisionalBadge />}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {/**
             * **An unmeasured channel names itself, in its own row.**
             *
             * This footer used to list the awaiting codes and add that they
             * would start contributing once there was something to measure —
             * both of which the rows above already say, since a channel with
             * nothing in it is listed like every other one and reads "Not scored
             * yet". The absence it was written to explain is not an absence any
             * more, so the sentence is a second statement of the same fact.
             */}
            {data.hasProvisionalRules && (
              <p className="mt-3 border-t border-hairline pt-3 text-[11px] text-ink-faint">
                Some figures come from placeholder rules and are marked.{" "}
                <Link
                  href="/admin/scoring-rules"
                  className="inline-flex items-center gap-0.5 text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Every rule <Icon.chevronRight className="h-3 w-3" />
                </Link>
              </p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * **What was earned and what was lost, on the tab that states the score.**
 *
 * The Score tab used to explain the model and never say what had happened: the
 * events sat two tabs away under History, and a person opening their own score
 * read a paragraph about weightings where the record belonged. Asked for on
 * 17 Aug 2026 in exactly those terms — too much written, not enough of what the
 * employee gained or lost.
 *
 * It is the History tab's own shape, shortened: a day, that day's reward and
 * penalty, then the entries that made it up, each with its reason. The
 * arithmetic is `groupLedger` and `totalsOf` — the same tested functions
 * `PointHistory` renders — so the two tabs can never disagree about a day.
 *
 * **What it does not do is truncate quietly.** A panel showing twelve of ninety
 * entries reads as a complete record unless it says otherwise, so the count it
 * is not showing is named and the link to the whole thing is part of the panel
 * rather than a tab somebody has to think of.
 */
const RECENT_ENTRIES = 12;

function EarnedAndLost({
  entries,
  isLoading,
  error,
  onRetry,
}: {
  entries: LedgerEntryLike[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const recent = recentEntries(entries, RECENT_ENTRIES);
  /* Years are collapsed away: every date printed below carries its own year, so
     a year header on a twelve-row panel is a heading for nothing. */
  const days = groupLedger(recent).flatMap((y) => y.days);
  /* Over the WHOLE record, not the rows on screen — and labelled as such. A net
     computed from twelve visible entries, sitting unqualified at the top of a
     panel, is read as the total of everything. */
  const record = totalsOf(entries);
  const earlier = entries.length - recent.length;

  return (
    <Panel padded={false} label="Earned and lost">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-medium text-ink">Earned and lost</h2>
        {entries.length > 0 && (
          <span className="text-[11px] text-ink-faint">
            <span data-figure>{entries.length}</span>{" "}
            {entries.length === 1 ? "entry" : "entries"} on record
          </span>
        )}
        {entries.length > 0 && (
          /* Earned and deducted apart, never only netted — a record with
             nothing in it and a record with ten points each way are different
             facts, and the net alone cannot tell them apart.

             Both figures are said in words as well as in sign and colour, and
             they cover the whole record rather than the twelve rows below —
             which is what the count beside the heading is there to establish. */
          <span className="ml-auto flex items-baseline gap-2.5 text-xs">
            <span className="text-[var(--state-positive-ink)]">
              <span data-figure>+{record.earned.toFixed(1)}</span> earned
            </span>
            <span className="text-[var(--state-rework-ink)]">
              <span data-figure>−{record.deducted.toFixed(1)}</span> deducted
            </span>
          </span>
        )}
      </div>

      {error ? (
        <ErrorState
          title="Your points could not be loaded"
          body={error}
          onRetry={onRetry}
        />
      ) : isLoading ? (
        <SkeletonRows rows={5} />
      ) : !entries.length ? (
        <EmptyState
          compact
          title="Nothing on your record yet"
          body="Points appear here as they are earned or taken off, each with its reason."
        />
      ) : (
        <>
          <div className="divide-y divide-hairline">
            {days.map((day) => (
              <div key={day.date || "undated"}>
                <div className="flex items-baseline gap-2 bg-[var(--surface-sunken,transparent)] px-4 py-1.5">
                  <span data-figure className="text-[11px] text-ink-muted">
                    {day.date ? formatDateFull(day.date) : "No date"}
                  </span>
                  <span className="ml-auto flex gap-2.5 text-[11px]">
                    {day.totals.earned > 0 && (
                      <span
                        data-figure
                        className="text-[var(--state-positive-ink)]"
                      >
                        +{day.totals.earned.toFixed(1)} reward
                      </span>
                    )}
                    {day.totals.deducted > 0 && (
                      <span
                        data-figure
                        className="text-[var(--state-rework-ink)]"
                      >
                        −{day.totals.deducted.toFixed(1)} penalty
                      </span>
                    )}
                  </span>
                </div>

                {day.entries.map((e) => {
                  const points = signedPointsOf(e);
                  const reversed = isReversed(e);
                  return (
                    <div
                      key={e.id}
                      className={`flex items-baseline gap-2 px-4 py-2 ${reversed ? "opacity-60" : ""}`}
                    >
                      {e.component && (
                        <span className="w-5 shrink-0 text-[10px] font-medium tracking-wide text-ink-faint uppercase">
                          {e.component.toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-sm text-ink ${reversed ? "line-through" : ""}`}
                        >
                          {e.sourceLabel || "Score entry"}
                        </p>
                        {/* The reason, because a figure without one is a
                            verdict. Clamped rather than cut: two lines is a
                            recorded sentence, and the whole of it is on the
                            History tab. */}
                        {e.reason && (
                          <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-faint">
                            {e.reason}
                          </p>
                        )}
                        {/* Said in words, not only struck through. */}
                        {reversed && (
                          <p className="text-[11px] text-ink-faint">
                            reversed after review
                          </p>
                        )}
                      </div>
                      <span
                        data-figure
                        className={`shrink-0 text-sm ${
                          points > 0
                            ? "text-[var(--state-positive-ink)]"
                            : points < 0
                              ? "text-[var(--state-rework-ink)]"
                              : "text-ink-faint"
                        }`}
                      >
                        {points > 0 ? "+" : points < 0 ? "−" : ""}
                        {formatPoints(Math.abs(points))}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <Link
            href="/score/history"
            className="flex items-center gap-1 border-t border-hairline px-4 py-2.5 text-[11px] text-ink-muted hover:text-ink"
          >
            {earlier > 0
              ? `${earlier} earlier ${earlier === 1 ? "entry" : "entries"} — open the full history`
              : "Open the full history"}
            <Icon.chevronRight className="h-3 w-3" />
          </Link>
        </>
      )}
    </Panel>
  );
}

/* ── Channel drill-in ─────────────────────────────────────────────────────── */

export function ChannelPage({ channel }: { channel: ChannelId }) {
  const viewerId = useViewerId();
  /**
   * **Nothing is asked until there is somebody to ask about.**
   *
   * `useViewerId` answers null on the first renders while the viewer is being
   * fetched, and passing that on as `""` builds paths with no id on the end —
   * `/cowork/sop/bleach/`, `/cowork/pmp//c1`. Those match no route, so the
   * engine answers a plain HTML 404 page and the panel renders
   * `<!DOCTYPE html> … Cannot GET …` where the figures should be. Reported on
   * C3, which had the identical shape; these three are the same page.
   *
   * `viewerId` is also a dependency of the overview now — without it the query
   * never re-ran once the viewer landed, so skipping the empty call would have
   * left the panel empty for good rather than briefly.
   */
  const overview = useQuery(
    (r) => (viewerId ? r.getScoreOverview(viewerId) : Promise.resolve(null)),
    [viewerId],
  );
  const units = useQuery(
    (r) => (viewerId ? r.listScoreUnits(viewerId, channel) : Promise.resolve([])),
    [channel, viewerId],
  );
  const ledger = useQuery(
    (r) => (viewerId ? r.listLedger(viewerId, channel) : Promise.resolve([])),
    [channel, viewerId],
  );

  const ch = overview.data?.channels.find((c) => c.id === channel);
  const view = ch ? presentChannel(ch) : null;

  return (
    <>
      <WorkspaceHead
        title={`${CHANNEL_CODE[channel]} · ${CHANNEL_LABEL[channel]}`}
        count={
          /* **"90 of 40 points" used to sit here**, beside a percentage it does
             not produce — the engine's figure is pre-normalised and is never
             earned/possible, so a reader who divided got 225%. Points are now
             stated only when they reconcile, and the count only when a provider
             reports one. */
          view ? (
            <>
              {view.percentage !== null && (
                <>
                  <span data-figure>
                    {view.percentage < 0 ? "−" : ""}
                    {Math.abs(Math.round(view.percentage))}%
                  </span>
                  {" · "}
                </>
              )}
              {view.earnedPoints !== null && view.possiblePoints !== null && (
                <>
                  <span data-figure>{formatPoints(view.earnedPoints)}</span> of{" "}
                  <span data-figure>{formatPoints(view.possiblePoints)}</span>{" "}
                  points
                </>
              )}
              {view.measuredCount !== null && (
                <>
                  {view.earnedPoints !== null && " · "}
                  <span data-figure>{view.measuredCount}</span>{" "}
                  {view.measuredCount === 1 ? "item" : "items"}
                </>
              )}
            </>
          ) : undefined
        }
        tabs={<IconTabs items={TABS} active={channel} />}
      />

      {units.isLoading ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
          <div className="deck:col-span-7">
            {/* **What moves this channel — one sentence, on the channel's own
                page.** It used to be repeated under all four rows of the
                overview's rail and under all four columns of its band, which is
                the same rule stated eight times on a page that never said what
                had actually happened to the score. Here it is answering a
                question the reader has just asked by opening the tab. */}
            <Panel className="mb-4">
              <p className="text-xs leading-relaxed text-ink-muted">
                {explanationFor(CHANNEL_CODE[channel])}
                {DETAIL_ELSEWHERE[CHANNEL_CODE[channel]] && (
                  <> {DETAIL_ELSEWHERE[CHANNEL_CODE[channel]]}</>
                )}
              </p>
            </Panel>
            <Panel padded={false}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-hairline px-4 py-3">
                {/* "Scoring units" named a data structure. This names the thing
                    the reader is looking at. */}
                <h2 className="text-sm font-medium text-ink">
                  {channel === "c1"
                    ? "Tasks contributing to your score"
                    : "What contributed"}
                </h2>
                {units.data && units.data.length > 0 && (
                  <span data-figure className="text-xs text-ink-faint">
                    {units.data.length}
                  </span>
                )}
              </div>
              {!units.data?.length ? (
                <EmptyState
                  compact
                  title="Nothing counted yet this period"
                  body={
                    channel === "c1"
                      ? "Tasks appear here once they are approved. Work in progress is not scored until it is reviewed."
                      : "This area starts contributing once there is something to measure."
                  }
                />
              ) : (
                <div className="divide-y divide-hairline">
                  {units.data.map((u) => {
                    const facts = factsOf(u);
                    const outcome = outcomeOf(facts);
                    const reasons = reasonsFor(facts);
                    return (
                      <article key={u.id} className="px-4 py-3.5">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h3 className="min-w-0 flex-1 truncate text-sm text-ink">
                            {u.sourceLabel}
                          </h3>
                          {/* The impact, signed, as the second thing read. */}
                          {u.earnedPoints !== null ? (
                            <span
                              data-figure
                              className={`shrink-0 text-sm ${
                                u.earnedPoints > 0
                                  ? "text-[var(--state-positive-ink)]"
                                  : u.earnedPoints < 0
                                    ? "text-[var(--state-rework-ink)]"
                                    : "text-ink-muted"
                              }`}
                            >
                              {u.earnedPoints > 0 ? "+" : ""}
                              {formatPoints(u.earnedPoints)} pts
                            </span>
                          ) : (
                            <span className="shrink-0 text-xs text-ink-faint">
                              Not scored yet
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-[11px] text-ink-muted">
                          {outcome.label}
                        </p>

                        {/* Why. The counters the engine already sends, read as
                            what happened rather than as fields. */}
                        <ul className="mt-2 space-y-1">
                          {reasons.map((r, i) => (
                            <li
                              key={i}
                              className="flex items-baseline gap-2 text-[11px] leading-relaxed"
                            >
                              <span
                                aria-hidden
                                className={`mt-[0.4em] h-1 w-1 shrink-0 rounded-full ${
                                  r.tone === "positive"
                                    ? "bg-[var(--state-positive)]"
                                    : r.tone === "negative"
                                      ? "bg-[var(--state-rework)]"
                                      : "bg-[var(--ink-faint)]"
                                }`}
                              />
                              <span
                                className={`min-w-0 flex-1 ${
                                  r.tone === "negative"
                                    ? "text-ink-muted"
                                    : "text-ink-faint"
                                }`}
                              >
                                {r.text}
                              </span>
                              {/* What it COST, where the engine said so.
                                  Reported 17 Aug 2026: the reasons named what
                                  happened and never how much, so the only
                                  figure on the row was the total and a person
                                  could not tell which event took what.

                                  Null is not zero — a positive reason was
                                  never a charge, and a record predating the
                                  breakdown reported nothing. Both show no
                                  figure rather than a fabricated 0. */}
                              {r.points !== null && (
                                <span
                                  data-figure
                                  className={`shrink-0 tabular-nums ${
                                    r.points < 0
                                      ? "text-[var(--state-rework-ink)]"
                                      : "text-ink-faint"
                                  }`}
                                >
                                  {r.points > 0 ? "+" : ""}
                                  {formatPoints(r.points)} pts
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>

                        {/* The sum, where anything was taken. A list of
                            negatives beside a total leaves the reader doing
                            the arithmetic to check it; this states it. */}
                        {facts.baseScore !== null &&
                          reasons.some((r) => (r.points ?? 0) < 0) &&
                          u.earnedPoints !== null && (
                            <p className="mt-2 text-[11px] text-ink-faint">
                              {formatPoints(facts.baseScore)} base
                              {reasons
                                .filter((r) => (r.points ?? 0) < 0)
                                .map(
                                  (r) => ` − ${formatPoints(Math.abs(r.points as number))}`,
                                )
                                .join("")}
                              {" = "}
                              <span className="text-ink-muted">
                                {formatPoints(u.earnedPoints)} pts
                              </span>
                            </p>
                          )}
                      </article>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          <div className="deck:col-span-5 space-y-4">
            {/* C2 only. The ledger below lists the individual credits; this
                says which goal each came from and how far through its pool the
                goal has got. No other channel has a source to break down this
                way, so no other channel grows a panel explaining one. */}
            {channel === "c2" && viewerId && (
              <GoalContributions employeeId={viewerId} />
            )}

            <Panel padded={false}>
              <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
                <h2 className="text-sm font-medium text-ink">Ledger</h2>
                <span data-figure className="text-xs text-ink-faint">
                  {ledger.data?.length ?? 0}
                </span>
                <span className="ml-auto text-[11px] text-ink-faint">
                  append-only
                </span>
              </div>
              {!ledger.data?.length ? (
                <EmptyState compact title="No entries" />
              ) : (
                <div className="max-h-[560px] divide-y divide-hairline overflow-y-auto scroll-slim">
                  {ledger.data.map((e) => {
                    const entry = presentLedgerEntry(e);
                    return (
                      <div key={e.id} className="px-4 py-3">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-xs font-medium text-ink">
                            {entry.title}
                          </span>
                          {/* Signed, so a credit and a deduction can never be
                              told apart only by colour. */}
                          <span
                            data-figure
                            className={`ml-auto shrink-0 text-xs ${
                              entry.direction === "credit"
                                ? "text-[var(--state-positive-ink)]"
                                : entry.direction === "deduction"
                                  ? "text-[var(--state-rework-ink)]"
                                  : "text-ink-faint"
                            }`}
                          >
                            {entry.direction === "credit" ? "+" : ""}
                            {entry.direction === "deduction" ? "−" : ""}
                            {formatPoints(Math.abs(entry.signedPoints))} points
                          </span>
                        </div>
                        {/* What it happened TO. The record has carried this all
                            along and the row discarded it, so an entry could
                            not be matched to the work it came from. */}
                        {entry.subject && (
                          <p className="mt-1 truncate text-[11px] text-ink-muted">
                            {entry.subject}
                          </p>
                        )}
                        {entry.reason && (
                          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                            {entry.reason}
                          </p>
                        )}
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
                          <span>{e.effectiveDate}</span>
                          {entry.actor && <span>· {entry.actor}</span>}
                          {/* The rule id and version are gone. An employee
                              cannot act on a rule version, and it is what made
                              this page read as a debug log. */}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

/* ── History ──────────────────────────────────────────────────────────────── */

/**
 * **The page answers "where did my points go", not "which periods closed".**
 *
 * It used to show only `listScoreHistory` — a trend across CLOSED scoring
 * periods — so a person with a ledger full of entries and no closed period was
 * told "No history yet". That was true of the trend and flatly untrue of their
 * score, and it is the reason the old application's SOP history was the page
 * people actually used.
 *
 * Both are here now. The trend stays exactly as it was and appears when there
 * are closed periods to plot; the ledger below it is the history in the sense
 * somebody means when they ask for it — every entry, newest first, what it cost
 * or earned, and why.
 */
export function ScoreHistoryPage() {
  const viewerId = useViewerId();
  const perms = usePermissions();
  const people = useQuery((r) => r.listEmployees(), []);

  /**
   * Whose history is on screen.
   *
   * A manager may open a report's record — the old application's SOP page had
   * the same picker. Who appears in it is decided by `score.view` and nothing
   * else; see `scoreSubjects`. `resolveSubject` is what makes the selection
   * safe to hold in component state: a role that changes while the page is open
   * falls the selection back to the viewer rather than leaving a stale id
   * deciding whose conduct record gets fetched.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const subjects = scoreSubjects({
    viewerId,
    employees: people.data ?? [],
    canView: (id) => perms.can("score.view", id),
  });
  const subject = resolveSubject({ selectedId, viewerId, subjects });
  const viewingOther = subject !== null && subject !== viewerId;

  /* Follows the picker, so the chart and the ledger below it always describe
     the same person. With nobody picked this is the viewer, which is what it
     always was. */
  const { data, isLoading } = useQuery(
    (r) => (subject ? r.listScoreHistory(subject) : Promise.resolve([])),
    [subject],
  );
  /**
   * The whole ledger, unfiltered, once.
   *
   * `listLedger` takes an optional component, and asking per filter would mean
   * a request on every tap of C1..C4 — and a window in which the totals on
   * screen describe a different set of entries than the rows under them.
   * Filtering happens in `filterLedger`, over what is already here.
   *
   * Gated on `viewerId` for the reason spelled out in `ChannelPage`: an empty
   * id builds `/cowork/sop/bleach/`, which matches no route and answers an HTML
   * 404 page.
   */
  const ledger = useQuery(
    (r) => (subject ? r.listLedger(subject) : Promise.resolve([])),
    [subject],
  );

  return (
    <>
      <WorkspaceHead
        title="Score history"
        count={
          ledger.data?.length
            ? `${ledger.data.length} ${ledger.data.length === 1 ? "entry" : "entries"}`
            : data
              ? `${data.length} periods`
              : undefined
        }
        tabs={<IconTabs items={TABS} active="history" />}
      />
      {isLoading && ledger.isLoading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-4">
          {/* Offered only to somebody who has a choice — an employee sees no
              control at all, rather than a dropdown holding only themselves. */}
          {offersChoice(subjects) && (
            <Panel>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="score-subject"
                  className="text-[11px] text-ink-faint"
                >
                  Whose history
                </label>
                <select
                  id="score-subject"
                  value={subject ?? ""}
                  onChange={(e) => setSelectedId(e.target.value || null)}
                  className="rounded border border-hairline bg-transparent px-2 py-1 text-xs text-ink"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.isSelf ? `${s.name} (you)` : s.name}
                    </option>
                  ))}
                </select>
                {/* Said out loud. Somebody who has forgotten they switched
                    would otherwise read a colleague's deductions as their
                    own — and this page is exactly where that misreading
                    would matter. */}
                {viewingOther && (
                  <span className="text-[11px] text-ink-muted">
                    You are reading somebody else&apos;s record.
                  </span>
                )}
              </div>
            </Panel>
          )}
          {/* Only when there is something to plot. An empty chart said less
              than nothing — it said the history was empty. */}
          {data && data.length > 0 && <TrendChart series={data} />}
          <PointHistory
            entries={ledger.data ?? []}
            isLoading={ledger.isLoading}
            error={ledger.error}
            onRetry={ledger.refetch}
          />
        </div>
      )}
    </>
  );
}

/**
 * The point ledger, as history.
 *
 * Ported from `OwnHistory` in the old project. The shape is kept because people
 * already read it: filter row, then year, then a collapsible row per day with
 * that day's damage stated on it, then the entries.
 *
 * The arithmetic lives in `scoreLedgerHistory.ts` and is tested there. This
 * renders it and owns nothing but the filter state.
 */
function PointHistory({
  entries,
  isLoading,
  error,
  onRetry,
}: {
  entries: LedgerEntryLike[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState<LedgerQuery>(NO_FILTER);
  /* Collapsed rather than expanded state, so a day the reader has not touched
     stays open — the same default as the old page, where the history is the
     point of the screen and hiding it behind a chevron would bury it. */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = filterLedger(entries, query);
  const years = groupLedger(filtered);
  const totals = totalsOf(filtered);
  const filtering = isFiltered(query);

  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-medium text-ink">Point history</h2>
        <span data-figure className="text-xs text-ink-faint">
          {filtered.length}
        </span>
        {/* The net, in words as well as sign — see `describeTotals`. */}
        {filtered.length > 0 && (
          <span
            data-figure
            className={`ml-auto text-xs ${
              totals.net > 0
                ? "text-[var(--state-positive-ink)]"
                : totals.net < 0
                  ? "text-[var(--state-rework-ink)]"
                  : "text-ink-faint"
            }`}
          >
            {describeTotals(totals)}
          </span>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
        {(["all", ...LEDGER_COMPONENTS] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setQuery((q) => ({ ...q, component: c }))}
            aria-pressed={query.component === c}
            className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              query.component === c
                ? "bg-ink text-canvas"
                : "border border-hairline text-ink-muted hover:text-ink"
            }`}
          >
            {c === "all" ? "All" : c.toUpperCase()}
          </button>
        ))}
        <input
          type="date"
          aria-label="From date"
          value={query.from}
          onChange={(e) => setQuery((q) => ({ ...q, from: e.target.value }))}
          className="rounded border border-hairline bg-transparent px-2 py-1 text-[11px] text-ink"
        />
        <span className="text-[11px] text-ink-faint">to</span>
        <input
          type="date"
          aria-label="To date"
          value={query.to}
          onChange={(e) => setQuery((q) => ({ ...q, to: e.target.value }))}
          className="rounded border border-hairline bg-transparent px-2 py-1 text-[11px] text-ink"
        />
        {filtering && (
          <button
            type="button"
            onClick={() => setQuery(NO_FILTER)}
            className="rounded border border-hairline px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>

      {/* Earned and deducted stated APART while a filter is on. A net of zero
          from nothing happening and a net of zero from ten points each way are
          different facts about somebody's month. */}
      {filtering && filtered.length > 0 && (
        <div className="flex flex-wrap gap-4 border-b border-hairline px-4 py-2.5 text-[11px]">
          <span>
            <span className="text-ink-faint">Earned </span>
            <span data-figure className="text-[var(--state-positive-ink)]">
              +{totals.earned.toFixed(1)}
            </span>
          </span>
          <span>
            <span className="text-ink-faint">Deducted </span>
            <span data-figure className="text-[var(--state-rework-ink)]">
              −{totals.deducted.toFixed(1)}
            </span>
          </span>
        </div>
      )}

      {error ? (
        <ErrorState
          title="The point history could not be loaded"
          body={error}
          onRetry={onRetry}
        />
      ) : isLoading ? (
        <SkeletonRows rows={5} />
      ) : !entries.length ? (
        <EmptyState
          title="Nothing on your record"
          body="No points have been added or taken off yet. Entries appear here as they are applied, each with its reason."
        />
      ) : !filtered.length ? (
        <EmptyState
          compact
          title="Nothing in this range"
          body="No entries match the filters above."
        />
      ) : (
        years.map((year) => (
          <section key={year.year || "undated"}>
            <div className="flex items-baseline gap-2 border-b border-hairline bg-[var(--surface-sunken,transparent)] px-4 py-2">
              <h3 data-figure className="text-xs font-medium text-ink">
                {year.year || "Undated"}
              </h3>
              <span className="text-[11px] text-ink-faint">
                {describeTotals(year.totals)}
              </span>
            </div>

            {year.days.map((day) => {
              const key = `${year.year}:${day.date}`;
              const shut = collapsed[key] === true;
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [key]: !shut }))
                    }
                    aria-expanded={!shut}
                    className="flex w-full items-center gap-2 border-b border-hairline px-4 py-2 text-left hover:bg-[var(--surface-hover,transparent)]"
                  >
                    <span
                      aria-hidden
                      className={`text-[10px] text-ink-faint transition-transform ${shut ? "" : "rotate-90"}`}
                    >
                      ▶
                    </span>
                    <span data-figure className="text-xs text-ink">
                      {day.date || "No date"}
                    </span>
                    <span className="ml-auto flex gap-3 text-[11px]">
                      {day.totals.earned > 0 && (
                        <span
                          data-figure
                          className="text-[var(--state-positive-ink)]"
                        >
                          +{day.totals.earned.toFixed(1)} reward
                        </span>
                      )}
                      {day.totals.deducted > 0 && (
                        <span
                          data-figure
                          className="text-[var(--state-rework-ink)]"
                        >
                          −{day.totals.deducted.toFixed(1)} penalty
                        </span>
                      )}
                    </span>
                  </button>

                  {!shut &&
                    day.entries.map((e) => {
                      const points = signedPointsOf(e);
                      const reversed = isReversed(e);
                      return (
                        <article
                          key={e.id}
                          className={`border-b border-hairline px-4 py-3 pl-8 ${reversed ? "opacity-60" : ""}`}
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            {e.component && (
                              <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                                {e.component.toUpperCase()}
                              </span>
                            )}
                            <span
                              className={`min-w-0 flex-1 truncate text-sm text-ink ${reversed ? "line-through" : ""}`}
                            >
                              {e.sourceLabel || "Score entry"}
                            </span>
                            <span
                              data-figure
                              className={`shrink-0 text-xs ${
                                points > 0
                                  ? "text-[var(--state-positive-ink)]"
                                  : points < 0
                                    ? "text-[var(--state-rework-ink)]"
                                    : "text-ink-faint"
                              }`}
                            >
                              {points > 0 ? "+" : points < 0 ? "−" : ""}
                              {formatPoints(Math.abs(points))} pts
                            </span>
                          </div>
                          {/* The REASON. This is what the page is for: a figure
                              without one is a verdict, and the old application
                              was preferred precisely because it gave both. */}
                          {e.reason && (
                            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                              {e.reason}
                            </p>
                          )}
                          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
                            <span>
                              Applied by{" "}
                              {e.actorId === "system" || !e.actorLabel.trim()
                                ? "System"
                                : e.actorLabel}
                            </span>
                            {/* Said plainly rather than only struck through:
                                the points are back, and somebody scanning for
                                what happened to their objection needs the
                                answer in words. */}
                            {reversed && <span>· reversed after review</span>}
                          </p>
                        </article>
                      );
                    })}
                </div>
              );
            })}
          </section>
        ))
      )}
    </Panel>
  );
}

/**
 * Multi-series trend, mapped from `anywhere.png`.
 *
 * Channel series use their own hues per The Four Channels Rule; the composite
 * is ink. C3 plots below a zero rule so a rising deduction can never read as
 * improvement. Nothing is stacked or summed.
 */
function TrendChart({
  series,
}: {
  series: {
    periodKey: string;
    overall: number;
    channels: Record<ChannelId, number>;
  }[];
}) {
  const W = 720;
  const H = 220;
  const pad = { l: 34, r: 12, t: 12, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = Math.max(1, series.length - 1);

  const x = (i: number) => pad.l + (i / n) * innerW;
  const y = (v: number) => pad.t + innerH - ((v + 100) / 200) * innerH;

  const lines: {
    id: string;
    label: string;
    colour: string;
    points: number[];
  }[] = [
    {
      id: "overall",
      label: "Overall",
      colour: "var(--color-ink)",
      points: series.map((s) => s.overall),
    },
    {
      id: "c1",
      label: "C1 · Task Execution",
      colour: "var(--color-c1)",
      points: series.map((s) => s.channels.c1),
    },
    {
      id: "c2",
      label: "C2 · Goal Attainment",
      colour: "var(--color-c2)",
      points: series.map((s) => s.channels.c2),
    },
    {
      id: "c3",
      label: "C3 · Conduct & Policy",
      colour: "var(--color-c3)",
      points: series.map((s) => s.channels.c3),
    },
    {
      id: "c4",
      label: "C4 · Attendance",
      colour: "var(--color-c4)",
      points: series.map((s) => s.channels.c4),
    },
  ];

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-ink">Trend</h2>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {lines.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink-muted"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: l.colour }}
              />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto scroll-slim">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[220px] w-full min-w-[560px]"
          role="img"
          aria-label="Score trend by period and channel"
        >
          {[100, 50, 0, -50, -100].map((v) => (
            <g key={v}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--color-hairline)"
                strokeWidth={v === 0 ? 1.2 : 1}
              />
              <text
                x={4}
                y={y(v) + 3}
                fontSize="10"
                fill="var(--color-ink-faint)"
              >
                {v}
              </text>
            </g>
          ))}

          {series.map((s, i) => (
            <text
              key={s.periodKey}
              x={x(i)}
              y={H - 6}
              fontSize="10"
              fill="var(--color-ink-faint)"
              textAnchor="middle"
            >
              {formatPeriod(s.periodKey)}
            </text>
          ))}

          {lines.map((l) => (
            <g key={l.id}>
              <polyline
                fill="none"
                stroke={l.colour}
                strokeWidth={l.id === "overall" ? 2 : 1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={l.points.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              />
              {l.points.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill={l.colour} />
              ))}
            </g>
          ))}
        </svg>
      </div>

      <p className="mt-2 text-[11px] text-ink-faint">
        C3 is deduction-only and plots below the zero rule, so a larger
        deduction always reads downward. Channels are independent and are never
        summed.
      </p>
    </Panel>
  );
}

/**
 * C2 · which goals earned it.
 *
 * The ledger beside this already lists every credit — each approved step lands
 * there as a `type: "C2"` entry. What a list of credits cannot answer is which
 * GOAL each belongs to and how far through its pool that goal has got, and that
 * is the question somebody opening C2 is actually asking: not "what did I earn"
 * but "where is this coming from, and what is still available".
 *
 * The figures are the engine's own, written as each step is approved. Nothing
 * here recomputes them from the ledger — the two are written by the same call,
 * and a page that recalculated the score it was explaining would eventually
 * explain a different number than the one above it.
 */
function GoalContributions({ employeeId }: { employeeId: string }) {
  const breakdown = useQuery(
    (r) => (employeeId ? r.getC2Breakdown(employeeId) : Promise.resolve(null)),
    [employeeId],
  );

  if (breakdown.isLoading) {
    return (
      <Panel>
        <SkeletonRows rows={3} />
      </Panel>
    );
  }

  const data = breakdown.data;
  const tasks = data?.tasks ?? [];

  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-medium text-ink">Goals you have earned from</h2>
        {data && data.totalEarned > 0 && (
          <span data-figure className="text-xs text-ink-muted">
            {data.totalEarned} points
          </span>
        )}
      </div>

      {!tasks.length ? (
        <EmptyState
          compact
          title="No goal points yet"
          body="A goal earns when one of its steps is approved, and only when the step was handed in on or before its deadline."
        />
      ) : (
        <div className="divide-y divide-hairline">
          {tasks.map((t) => (
            <div key={t.taskId} className="px-4 py-3">
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/tasks/${t.taskId}/roadmap`}
                  className="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
                >
                  {t.taskTitle || "Untitled goal"}
                </Link>
                {/* Earned OF the goal's own pool, not of the company's — the
                    figure that says how much of THIS goal is still to play
                    for. */}
                <span data-figure className="shrink-0 text-xs text-ink-muted">
                  {t.earnedPoints} of {t.taskMaxPoints}
                </span>
              </div>
              <div className="mt-1.5">
                {/* `Meter` takes a percentage, not a pair — the pair is
                    printed above it, so the bar is the shape and the numbers
                    are the fact. */}
                <Meter
                  value={
                    t.taskMaxPoints > 0
                      ? Math.min(100, (t.earnedPoints / t.taskMaxPoints) * 100)
                      : 0
                  }
                  label={`${t.taskTitle || "Untitled goal"}: ${t.earnedPoints} of ${t.taskMaxPoints} points earned`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
