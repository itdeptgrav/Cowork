"use client";

import Link from "next/link";
import { statusMeta, nextAction } from "./statusMeta";
import {
  formatRankDisplay,
  rankFor,
  rankTitle,
} from "@/lib/rules/tasks/priorityDisplay";
import { TimerControl } from "./TimerControl";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Panel,
  Ring,
  SegmentBar,
  SkeletonRows,
  type BarSegment,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { periodLabel, presentChannel } from "@/lib/rules/scoring/scoreDisplay";
import {
  formatDate,
  formatPercent,
  formatTimer,
  formatDurationTimer,
  formatDateTime,
} from "@/lib/utils/format";
import type { TaskScope, TaskView } from "@/lib/repositories";

/**
 * The Tasks overview.
 *
 * Structure comes from `Task_overview`, region for region — see
 * docs/specs/REFERENCE_MAPPING.md §3 for the full table. In band order:
 *
 *   1. section header — "Up next" plus whether anything is first
 *   2. the P1 band — the task at the front of the queue, in two halves;
 *      this replaced the projects rail, which counted containers rather
 *      than work and left the page empty in an organisation that keeps its
 *      work as plain tasks
 *   3. KPI strip — four cells that are deliberately NOT alike
 *
 * Two things an earlier pass got backwards, both now corrected against the
 * file itself rather than against my notes about it:
 *
 *  · The reference leads with PROJECTS and anchors with the metric strip. I had
 *    the strip on top, which turns the page into a dashboard fragment instead
 *    of the project-first overview the reference describes.
 *  · Its four metric cells have four different anatomies — composition bar,
 *    plain figure, figure plus an actionable row, ring plus context. Each cell
 *    uses the visualisation its data actually wants. I had built four identical
 *    cells, which is the low-information block the brief warns against.
 *
 * One addition beyond the reference: the action queue at the foot. The
 * reference Overview carries no task list at all, but brief §8 requires this
 * page to answer "what requires action now" and §9 requires the running and
 * paused sessions to be visible and operable. That is a Cowork requirement the
 * reference has no opinion about, so it is added rather than substituted.
 *
 * **The fourth cell counts score, not the clock.** It carried the work session
 * — a ring of elapsed-against-estimate, the running task, a paused tally — and
 * that made the strip answer "how long" three times over: cell 2 already logs
 * time spent against time estimated, and every row in the queue below carries
 * its own timer control. What the strip could not answer was what any of the
 * work had been WORTH, which is the question a quarter is judged on. So the
 * cell now reads C1 — Task Execution, the one channel of the four that a task
 * can move, for the current scoring period.
 *
 * §9 is not weakened by that: the sessions stay operable on every queue row,
 * and the paused tally moved into the queue’s own header, beside the controls
 * that can resume one. A count on a strip could only ever announce them.
 */
export function TasksOverview({ scope }: { scope: TaskScope }) {
  const tasks = useQuery(
    (r) => r.listTasks({ scope }).then((p) => p.items),
    [scope],
  );
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const active = useQuery((r) => r.getActiveTimer(), []);
  const timers = useQuery((r) => r.listTimers(), []);
  /**
   * Cell 4 reads the VIEWER’s own score, never the scope’s.
   *
   * A score belongs to one person — “Visible only to you and your reporting
   * chain” — so switching the list to My team must not switch whose points sit
   * on the strip. Called before the early returns, because a hook cannot sit
   * behind a loading branch.
   */
  const scoreOwnerId = useViewerId();
  const score = useQuery(
    (r) =>
      scoreOwnerId ? r.getScoreOverview(scoreOwnerId) : Promise.resolve(null),
    [scoreOwnerId],
  );

  if (tasks.isLoading) return <SkeletonRows rows={8} />;
  if (tasks.error)
    return <ErrorState body={tasks.error} onRetry={tasks.refetch} />;

  const list = tasks.data ?? [];
  const viewerId = me.data?.id ?? "";
  const closed = (t: TaskView) =>
    t.task.status === "completed" ||
    t.task.status === "cancelled" ||
    t.task.status === "assignment_rejected";

  const open = list.filter((t) => !closed(t));
  const overdue = open.filter((t) => t.isOverdue);
  const blocked = open.filter((t) => t.task.isBlocked && !t.isOverdue);
  const inReview = open.filter(
    (t) => t.task.status === "in_review" && !t.isOverdue,
  );
  const running = open.filter(
    (t) => t.task.status === "in_progress" && !t.isOverdue && !t.task.isBlocked,
  );
  const waiting =
    open.length -
    overdue.length -
    blocked.length -
    inReview.length -
    running.length;

  /* Cell 1 — composition of the open workload. */
  const composition: BarSegment[] = [
    { label: "in progress", value: running.length, tone: "var(--color-ink)" },
    {
      label: "in review",
      value: inReview.length,
      tone: "var(--state-extension)",
    },
    { label: "overdue", value: overdue.length, tone: "var(--state-overdue)" },
    { label: "blocked", value: blocked.length, tone: "var(--state-blocked)" },
    {
      label: "not started",
      value: Math.max(0, waiting),
      tone: "var(--control-active)",
    },
  ];

  /* Cell 2 — effort actually spent, against what was estimated. */
  const logged = list.reduce((s, t) => s + t.loggedSecs, 0);
  const estimated = open.reduce(
    (s, t) => s + (t.task.estimatedEffortSecs ?? 0),
    0,
  );

  /* Cell 3 — decisions only. "Needs you" includes doing the work; this cell is
     narrower on purpose: things that are stalled until you rule on them. */
  const DECISIONS = new Set([
    "Review submission",
    "Approve or reject",
    "Decide deadline",
    "Decide the time budget",
    "Respond to counter",
  ]);
  const decisions = open
    .map((t) => ({ view: t, action: nextAction(t, viewerId) }))
    .filter((x) => x.action.actor === "you" && DECISIONS.has(x.action.label));
  const topDecision = decisions[0];

  /* Cell 4 — what the quarter’s work has actually been worth.
     C1 is the task channel: the only one of the four a task can move, so it is
     the honest answer to “what has this earned me” on a page about tasks. */
  const c1 = score.data?.channels.find((c) => c.id === "c1") ?? null;
  const c1View = c1 ? presentChannel(c1) : null;
  /* Through the formatter, never `Math.round` into a template: an absent
     figure rounds to NaN and templates without complaint, and "NaN%" on
     somebody’s score is the fault `formatPercent` exists to refuse. */
  const c1Percent = formatPercent(c1View?.percentage);
  /* The quarter said in words — “July–September 2026”, not “2026-Q3”. Nobody
     reads a period key, and “this quarter” alone leaves the reader to guess
     which one a figure on a dashboard belongs to. */
  const period = score.data ? periodLabel(score.data.periodKey) : "this quarter";
  /* Points where the engine reconciled them, its percentage where it did not,
     and a dash where it has not scored the channel at all. NEVER a confident
     0.0 — on somebody’s own score that is a claim, and the wrong one. */
  const scoreFigure =
    c1View?.earnedPoints != null
      ? c1View.earnedPoints.toFixed(1)
      : (c1Percent ?? "—");
  /* One line, and it must never imply a figure the cell is not showing. */
  const scoreContext = score.isLoading
    ? "Working it out…"
    : score.isUnavailable
      ? "Not connected in this build."
      : score.error
        ? "Your score could not be loaded."
        : c1View === null
          ? "No score for this period yet."
          : c1View.state === "no_data"
            ? "Nothing approved yet this quarter."
            : c1View.possiblePoints != null
              ? `of ${c1View.possiblePoints.toFixed(1)} · ${period}`
              : period;

  /* §9 keeps its paused sessions — they moved to the action queue’s own
     header, beside the controls that can actually resume them. */
  const pausedCount = (timers.data ?? []).filter(
    (t) => !t.isActive && t.accumulatedSecs > 0,
  ).length;

  /* The foot queue. */
  const queue = open
    .map((t) => ({ view: t, action: nextAction(t, viewerId) }))
    .filter((x) => x.action.actor === "you")
    .sort((a, b) => {
      const rank = (x: typeof a) =>
        (x.view.isOverdue ? 0 : x.view.task.isBlocked ? 1 : 2) * 100 +
        (x.view.myRank ?? 9);
      return rank(a) - rank(b);
    });

  /* The task the queue puts first.

     `rankFor` rather than `myRank`, for the reason the queue below states:
     the stored number and the derived queue position are different facts, and
     reading the wrong one is what once showed one manager two priorities for
     one task. Historic and provisional ranks are excluded — a closed task
     that WAS P1, and a task ranked only among work awaiting acceptance, are
     both first in a list that is not this one. */
  const p1 = open.find((t) => {
    const r = rankFor(t, viewerId);
    return r.rank === 1 && !r.isHistoric && !r.isProvisional;
  });
  const p1Rank = p1 ? rankFor(p1, viewerId) : null;

  /* No elapsed figure is derived here on purpose. `TimerControl` reads the live
     session document; `view.loggedSecs` is fetched once with the task and does
     not move when the timer does, so a figure computed here sat at zero beside
     a control counting forty minutes. One clock, and it is the control's. */

  /* The submit link, on the same test `ProjectPanel` uses: null unless
     submitting is genuinely the next move, so the dashboard cannot offer a
     hand-in the task itself would not. */
  const p1Action = p1 ? nextAction(p1, viewerId) : null;
  const p1Submit =
    p1 && p1Action?.href === `/tasks/${p1.task.id}/submission`
      ? p1Action.href
      : null;

  return (
    <div className="flex flex-col gap-5">
      {/* ── The task in front of you ───────────────────────────────
          This was the projects rail, under a census reading “0 live · 0 jobs
          between them”. A project is a container, and the census counted
          containers — so the page opened on a figure nobody acts on, and in an
          organisation that keeps its work as plain tasks it opened on an empty
          box offering to create one.

          What replaces it is the single task the queue already puts first.
          Nothing here decides that: `rankFor` is the same reader the task list
          and the detail chip use, so this band cannot disagree with them about
          which task is P1, and a closed task reading “Was P1” is not mistaken
          for the live one.

          Two halves because the question has two halves — on the left what the
          work is and how long it has had, on the right what it asks for and the
          way to hand it in. */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg leading-none font-light tracking-[-0.025em] text-ink">
            Up next
          </h2>
          {/* On the field: `ink-muted`, never `ink-faint`. */}
          <p className="text-xs text-ink-muted">
            {p1 ? "first in your queue" : "nothing is first right now"}
          </p>
          <Link
            href="/tasks?view=tasks"
            className="ml-auto flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-ink-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            All tasks
            <Icon.chevronRight className="h-3 w-3" />
          </Link>
        </div>

        {!p1 || !p1Rank ? (
          <Panel>
            <EmptyState
              compact
              title="Nothing is first in your queue"
              body="A task takes a position once its hours are agreed and you have accepted it. Nothing you are holding has one yet."
              action={
                <Link
                  href="/tasks?view=tasks"
                  className="text-ink underline-offset-4"
                >
                  See all your tasks
                </Link>
              }
            />
          </Panel>
        ) : (
          <Panel padded={false}>
            <div className="grid grid-cols-1 deck:grid-cols-2">
              {/* ── left: what it is, when it is due, how long it has had ── */}
              <div className="flex flex-col border-b border-hairline p-5 deck:border-r deck:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-figure
                    className="min-w-7 rounded-full bg-[color-mix(in_srgb,var(--state-risk)_22%,transparent)] px-1.5 py-0.5 text-center text-[11px] whitespace-nowrap text-ink"
                    title={rankTitle(p1Rank)}
                  >
                    {formatRankDisplay(p1Rank)}
                  </span>
                  <Chip tone={statusMeta(p1).tone}>{statusMeta(p1).label}</Chip>
                </div>

                <Link href={`/tasks/${p1.task.id}`} className="mt-3 block">
                  <h3 className="text-xl leading-snug font-light tracking-[-0.025em] text-ink">
                    {p1.task.title}
                  </h3>
                </Link>
                <p className="mt-1 text-[11px] text-ink-faint">
                  {p1.project?.name ?? "No project"}
                </p>

                <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
                  <div>
                    <dt className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                      Deadline
                    </dt>
                    {/* The time as well as the date. A deadline of “18 Aug” is
                        a day of ambiguity on the day it matters.

                        Set at the timer's figure size and given the same
                        tracking: these are the two numbers the band exists to
                        put side by side — how long is left, and how long has
                        been spent — and one of them reading as body text made
                        it look like a caption on the other. */}
                    <dd
                      data-figure
                      className="mt-1.5 text-[22px] leading-none tracking-[-0.025em] text-ink"
                    >
                      {formatDateTime(
                        p1.task.deadline.dueAt ??
                          p1.task.deadline.operationalDueAt,
                      )}
                    </dd>
                  </div>
                </dl>

                {/**
                 * **The clock, and the only one.**
                 *
                 * This band used to print its own “Logged” figure from
                 * `view.loggedSecs` above this control, and the two disagreed
                 * on screen — 00:00:00 over 00:40:30 for one task. The figure
                 * here is right: `loggedSecs` is fetched once with the task and
                 * does not move when the timer does, which `TimerControl`
                 * documents having been bitten by already. Printing it again
                 * here reintroduced exactly that bug one card away from the
                 * control that fixed it.
                 *
                 * `size="detail"` is the full control — play/pause, the live
                 * figure, the estimate beside it, and whether it is running.
                 * It renders nothing when the timer is not this viewer's to
                 * start, which is deliberate: no control that would fail.
                 */}
                {/* `mt-auto` pins the control to the foot of the half, the
                    same way the submit row is pinned opposite. The two halves
                    are grid siblings and so are the same height, which is what
                    puts the two presses on one line. */}
                <div className="mt-auto pt-5">
                  <TimerControl
                    size="detail"
                    align="end"
                    view={p1}
                    onChange={() => {
                      active.refetch();
                      timers.refetch();
                      tasks.refetch();
                    }}
                  />
                </div>
              </div>

              {/* ── right: what it asks for, and the way to hand it in ──── */}
              {/* Sunken rather than raised: what the task asks of you sits
                  behind what the task IS, which is the reading order the two
                  halves already imply. One token, so both themes follow. */}
              <div className="flex flex-col bg-[var(--surface-sunken)] p-5">
                <h3 className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                  Brief
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {p1.task.description ??
                    "No description was given for this task."}
                </p>

                <div className="mt-5 flex items-baseline gap-2">
                  <h3 className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                    Completion requirements
                  </h3>
                  {p1.completion.total > 0 && (
                    <span data-figure className="text-[11px] text-ink-faint">
                      {p1.completion.satisfiedCount}/{p1.completion.total}
                    </span>
                  )}
                </div>

                {!p1.completion.total ? (
                  <p className="mt-2 text-sm text-ink-faint">
                    This task has no completion requirements.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {p1.completion.requirements.slice(0, 4).map((r) => (
                      <li
                        key={r.requirement.id}
                        className="flex items-start gap-2.5"
                      >
                        {/* Read-only, exactly as on the task itself — the
                            reviewer decides what is met, and a tick on the
                            dashboard would be a second opinion. */}
                        <span
                          aria-hidden="true"
                          className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                            r.isSatisfied
                              ? "bg-[color-mix(in_srgb,var(--state-positive)_28%,transparent)] text-[var(--state-positive-ink)]"
                              : "bg-[var(--surface-sunken)] text-ink-faint"
                          }`}
                        >
                          {r.isSatisfied && <Icon.check className="h-3 w-3" />}
                        </span>
                        <p
                          className={`text-sm ${r.isSatisfied ? "text-ink-muted line-through decoration-hairline" : "text-ink"}`}
                        >
                          {r.requirement.text}
                        </p>
                      </li>
                    ))}
                    {p1.completion.requirements.length > 4 && (
                      <li className="pl-[30px] text-[11px] text-ink-faint">
                        <Link
                          href={`/tasks/${p1.task.id}`}
                          className="text-ink"
                        >
                          {p1.completion.requirements.length - 4} more
                        </Link>
                      </li>
                    )}
                  </ul>
                )}

                {/* `mt-auto` pins this row to the foot of the half, so the two
                    columns end on one line whatever the brief’s length. */}
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
                  {!p1.completion.canComplete && (
                    <span className="text-[11px] text-ink-faint">
                      {p1.completion.total - p1.completion.satisfiedCount}{" "}
                      requirement
                      {p1.completion.total - p1.completion.satisfiedCount === 1
                        ? ""
                        : "s"}{" "}
                      outstanding — this cannot be submitted yet.
                    </span>
                  )}
                  {/* Offered on the same test the task itself uses — null
                      unless submitting is genuinely this task’s next move, so
                      the dashboard never offers a hand-in the task refuses. */}
                  {/* `size="md"` rather than `sm`: the same `py-2` and
                      `text-[15px]` the timer press opposite uses, so the two are
                      the same height rather than nearly so. */}
                  {p1Submit && (
                    <Button tone="primary" size="md" className="ml-auto">
                      <Link href={p1Submit}>Submit task</Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        )}
      </section>

      {/* ── R5: the metric strip ───────────────────────────────────────────
          Four cells, four anatomies. The reference's variety is the point:
          a composition wants a segmented bar, a duration wants a plain figure,
          a decision queue wants its top item inline, and a consumed budget
          wants a ring. */}
      <Panel padded={false}>
        {/* Separators are written per cell rather than with `divide-*`, because
            divide draws on DOM order and a 2×2 arrangement then puts a vertical
            rule at the start of the second row. Four cells, four literal rules. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 deck:grid-cols-4">
          {/* 1 · figure + composition bar + dot legend */}
          <div className="px-4 py-3.5">
            <p className="flex items-baseline gap-1.5">
              <span
                data-figure
                className="text-[28px] leading-none tracking-[-0.03em] text-ink"
              >
                {open.length}
              </span>
              <span className="text-xs text-ink-faint">
                open of {list.length}
              </span>
            </p>
            <SegmentBar className="mt-3" segments={composition} />
          </div>

          {/* 2 · label + large figure */}
          <div className="border-t border-hairline px-4 py-3.5 sm:border-t-0 sm:border-l">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Time logged
            </p>
            <p
              data-figure
              className="mt-2 text-[28px] leading-none tracking-[-0.03em] text-ink"
            >
              {formatTimer(logged)}
            </p>
            <p data-figure className="mt-2 text-[11px] text-ink-faint">
              {formatDurationTimer(estimated)} still estimated
            </p>
          </div>

          {/* 3 · label + figure + one actionable row */}
          <div className="flex flex-col border-t border-hairline px-4 py-3.5 deck:border-t-0 deck:border-l">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Awaiting your decision
            </p>
            <p
              data-figure
              className="mt-2 text-[28px] leading-none tracking-[-0.03em] text-ink"
            >
              {decisions.length}
            </p>
            {topDecision ? (
              <Link
                href={
                  topDecision.action.href ??
                  `/tasks/${topDecision.view.task.id}`
                }
                className="mt-2.5 flex items-center gap-2 rounded-full bg-[var(--surface-sunken)] py-1.5 pr-2.5 pl-2 transition-colors hover:bg-[var(--control)]"
              >
                <span className="shrink-0 rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] tracking-[0.06em] text-ink-muted uppercase">
                  {topDecision.action.label.split(" ")[0]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                  {topDecision.view.task.title}
                </span>
                {(topDecision.view.task.deadline.dueAt ??
                  topDecision.view.task.deadline.operationalDueAt) && (
                  <span
                    data-figure
                    className="shrink-0 text-[11px] text-ink-faint"
                  >
                    {formatDate(
                      topDecision.view.task.deadline.dueAt ??
                        topDecision.view.task.deadline.operationalDueAt,
                    )}
                  </span>
                )}
              </Link>
            ) : (
              <p className="mt-2.5 text-[11px] text-ink-faint">
                Nothing is stalled on you.
              </p>
            )}
          </div>

          {/* 4 · ring + figure + context — what the quarter has earned.
              The ring stays because the anatomy still fits: this is a
              proportion of a maximum, which is exactly what a ring says and
              what the other three cells do not. The work session it replaces
              has not been dropped from the page — every queue row below still
              carries its own timer control, and the paused count moved to that
              queue’s header, beside the controls that can resume them. */}
          <div className="flex items-center gap-3 border-t border-l-0 border-hairline px-4 py-3.5 sm:border-l deck:border-t-0">
            {/* **No ring where there is no figure.** `Ring` is a `role="meter"`,
                so rendering it at 0 announces `aria-valuenow="0"` — a measured
                zero, which is the exact claim this channel refuses to make
                before anything has been approved. The placeholder holds the
                cell’s shape and says nothing. */}
            {c1Percent !== null ? (
              <Ring
                value={c1View?.percentage ?? 0}
                /* The channel code AND its fixed label, together, in the
                   accessible name — the cell has no room to print both, and a
                   bare “C1” means nothing to the person reading it. */
                label={`C1 Task Execution — ${c1Percent}, ${period}`}
              >
                <span data-figure className="text-[11px] text-ink-faint">
                  {c1Percent}
                </span>
              </Ring>
            ) : (
              <span
                aria-hidden
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-[3px] border-[var(--control-active)] text-[11px] text-ink-faint"
              >
                —
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                Score from tasks
              </p>
              <p
                data-figure
                className="mt-2 text-[28px] leading-none tracking-[-0.03em] text-ink"
              >
                {scoreFigure}
              </p>
              <p className="mt-2 truncate text-[11px] text-ink-faint" title={scoreContext}>
                {scoreContext}
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Cowork addition: the action queue ──────────────────────────────
          Not in the reference. Required by brief §8 and §9. */}
      <Panel padded={false}>
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
          <h2 className="text-sm font-medium text-ink">Needs you now</h2>
          <span data-figure className="text-xs text-ink-faint">
            {queue.length}
          </span>
          {/* §9 wants paused sessions VISIBLE and operable. Operable they
              already are — every row below carries its own timer control — but
              a session paused on a task that is not in this queue had only the
              metric strip to announce it, and the strip now counts score. So
              the tally sits here instead, beside the rows that can resume one. */}
          {pausedCount > 0 && (
            <span className="text-xs text-ink-faint">
              · <span data-figure>{pausedCount}</span> paused
            </span>
          )}
          <Link
            href="/tasks?view=tasks"
            className="ml-auto flex items-center gap-1 text-xs text-ink-faint transition-colors hover:text-ink"
          >
            All tasks
            <Icon.chevronRight className="h-3 w-3" />
          </Link>
        </div>

        {!queue.length ? (
          <EmptyState
            compact
            title="Nothing waiting on you"
            body="Every open task is with someone else right now."
          />
        ) : (
          <div className="divide-y divide-hairline">
            {queue.slice(0, 8).map(({ view, action }) => {
              const meta = statusMeta(view);
              return (
                <div
                  key={view.task.id}
                  className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-[var(--control)]"
                >
                  {/* The shared reader, not `myRank` inline: a closed task has
                      no live position and must read "Was P1" rather than
                      borrowing the chip a live P1 wears. */}
                  {(() => {
                    const rank = rankFor(view, viewerId);
                    return (
                      <span
                        data-figure
                        className={`min-w-7 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] whitespace-nowrap ${
                          !rank.isHistoric &&
                          rank.rank !== null &&
                          rank.rank <= 2
                            ? "bg-[color-mix(in_srgb,var(--state-risk)_22%,transparent)] text-ink"
                            : "bg-[var(--control)] text-ink-muted"
                        }`}
                        title={rankTitle(rank)}
                      >
                        {formatRankDisplay(rank)}
                      </span>
                    );
                  })()}

                  <Link
                    href={`/tasks/${view.task.id}`}
                    className="min-w-0 flex-1"
                  >
                    <span className="block truncate text-sm text-ink">
                      {view.task.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                      {view.project?.name ?? "No project"}
                      {(view.task.deadline.dueAt ??
                        view.task.deadline.operationalDueAt) &&
                        ` · due ${formatDate(
                          view.task.deadline.dueAt ??
                            view.task.deadline.operationalDueAt,
                        )}`}
                      {view.loggedSecs > 0 &&
                        ` · ${formatTimer(view.loggedSecs)} logged`}
                    </span>
                  </Link>

                  <TimerControl
                    view={view}
                    onChange={() => {
                      active.refetch();
                      timers.refetch();
                      tasks.refetch();
                    }}
                  />

                  <Link
                    href={action.href ?? `/tasks/${view.task.id}`}
                    className="hidden w-[130px] shrink-0 truncate text-xs text-ink-muted transition-colors hover:text-ink deck:block"
                  >
                    {action.label}
                  </Link>

                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
