"use client";

import Link from "next/link";
import { Chip } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { useTicker } from "@/components/features/tasks/TimerControl";
import { useNow } from "@/lib/hooks/useNow";
import { useWatchedTimerSession } from "@/lib/hooks/useTimerSession";
import { formatTimer } from "@/lib/utils/format";
import {
  remainderLabel,
  taskWorkProgress,
  type WorkProgress,
  type WorkProgressState,
} from "@/lib/rules/tasks/workProgress";
import type { TaskView } from "@/lib/repositories";

/**
 * What the time somebody was given is actually being spent on.
 *
 * **This is the detail legacy's status-tracking modal had and this app did not.**
 * The old surface (`cowork-old-frontend/app/coworking/status-tracking/page.js`)
 * answered four questions about a running task in one block — how much time was
 * asked for, how much has been worked, how much is left, and when the budget
 * runs out — and the new person view answered only "what are they on". A task
 * title and a due date cannot distinguish a report who is comfortably inside a
 * three-hour window from one who has burned it with nothing to show, and those
 * are the two situations a manager opens this page to tell apart.
 *
 * Three things carried over from that modal, deliberately:
 *
 *  1. **The three figures side by side.** Asked for, worked, and what is left —
 *     read across, not inferred by subtracting one caption from another.
 *  2. **The denominator never moves.** The bar is worked-against-budget, and
 *     the budget is the window in force including approved extensions. A bar
 *     whose base changes is a bar that can go backwards.
 *  3. **The third column is renamed, not just recoloured.** "Time left" becomes
 *     "Still needed" the moment the window runs out. `remainderLabel` owns that.
 *
 * One thing deliberately not carried: legacy's inline hex palette. Every colour
 * here is a state wash from the product's own set, so overtime is the same
 * purple as an extension everywhere else in Cowork rather than a fifth opinion
 * about what purple means.
 *
 * The figures come from `workProgress`, which is pure and tested. Nothing in
 * this file decides anything — it renders a reading.
 */

/* ── Formatting ───────────────────────────────────────────────────────────── */

/**
 * A span of work, honest below a minute.
 *
 * `duration` rounds to the nearest minute, which is right for a total and wrong
 * for the thing beside a running clock: forty-nine seconds of work rendered as
 * "1m" disagrees with the `00:00:49` two columns to its left, and a reader
 * cannot tell which of the two is broken.
 */
export function workSpan(secs: number): string {
  const total = Math.max(0, Math.round(Number(secs) || 0));
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** The due moment, as a manager reads it: "01:48 · 4 Aug", or "· Today". */
function dueMoment(ms: number, nowMs: number): { time: string; day: string } {
  const d = new Date(ms);
  const now = new Date(nowMs);
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(nowMs + 86_400_000).toDateString() === d.toDateString();
  return {
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    day: sameDay
      ? "Today"
      : tomorrow
        ? "Tomorrow"
        : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
  };
}

const STATE_TONE: Record<
  WorkProgressState,
  "positive" | "rework" | "overdue" | "extension" | "neutral"
> = {
  on_track: "positive",
  incomplete: "rework",
  overdue: "overdue",
  overtime: "extension",
  no_budget: "neutral",
};

/** The wash the progress bar is drawn in, matching the chip beside it. */
const STATE_FILL: Record<WorkProgressState, string> = {
  on_track: "var(--state-positive)",
  incomplete: "var(--state-rework)",
  overdue: "var(--state-overdue)",
  overtime: "var(--state-extension)",
  no_budget: "var(--control-active)",
};

/**
 * The one line that says how the work stands, in the words of the state.
 *
 * A sentence rather than a badge because three of the four readings are things
 * a manager may have to act on, and "⚠️ Incomplete" does not say what is
 * incomplete about it. Legacy wrote these out too, and they were the most
 * useful thing in the modal.
 */
function verdict(p: WorkProgress): string | null {
  switch (p.state) {
    case "incomplete":
      return `The window has run out with ${workSpan(p.remainingSecs ?? 0)} of the agreed ${workSpan(p.budgetSecs ?? 0)} never worked.`;
    case "overdue":
      return "The window has run out and the budget is spent. Nothing is left in it.";
    case "overtime":
      return `${workSpan(p.overtimeSecs ?? 0)} beyond the agreed ${workSpan(p.budgetSecs ?? 0)}.`;
    case "on_track":
      /* Only worth a sentence when it is nearly gone. Saying "on track" under a
         bar that already says so is the caption-restating-the-figure that the
         rest of this product avoids. */
      return (p.remainingSecs ?? 0) > 0 && (p.remainingSecs ?? 0) < 2 * 3600
        ? `Under two hours of budget left — ${workSpan(p.remainingSecs ?? 0)} of work remaining.`
        : null;
    default:
      return null;
  }
}

/* ── The breakdown ────────────────────────────────────────────────────────── */

/**
 * The time budget for one task, read against what has been worked.
 *
 * Presentational and pure — every figure arrives in `progress`. That is what
 * lets the same block serve a live session, a paused one, and a task nobody has
 * started, with no branch here deciding which.
 */
export function WorkBudgetBreakdown({
  progress,
  nowMs,
}: {
  progress: WorkProgress;
  nowMs: number;
}) {
  const p = progress;
  if (p.state === "no_budget") {
    return (
      <p className="mt-3 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink-faint">
        No time budget was agreed on this task, so there is nothing to measure
        the work against.
        {p.workedSecs > 0 && (
          <>
            {" "}
            <span data-figure className="text-ink">
              {workSpan(p.workedSecs)}
            </span>{" "}
            logged.
          </>
        )}
      </p>
    );
  }

  const tone = STATE_TONE[p.state];
  const label = remainderLabel(p.state);
  const remainder =
    p.state === "overtime" ? (p.overtimeSecs ?? 0) : (p.remainingSecs ?? 0);
  const due = p.budgetEndsAtMs !== null ? dueMoment(p.budgetEndsAtMs, nowMs) : null;
  const line = verdict(p);

  return (
    <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] p-3">
      {/* What was given, and where that leaves them. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-ink-faint">
          Time given{" "}
          <span data-figure className="text-ink">
            {workSpan(p.budgetSecs ?? 0)}
          </span>
        </span>
        <Chip tone={tone}>
          {p.state === "on_track"
            ? `${workSpan(p.remainingSecs ?? 0)} left`
            : p.state === "incomplete"
              ? "Incomplete"
              : p.state === "overtime"
                ? `+${workSpan(p.overtimeSecs ?? 0)} overtime`
                : "Window closed"}
        </Chip>
      </div>

      {/* When the budget runs out — derived from the clock, not read off the
          task, so it agrees with the figure the person working sees. */}
      {due && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <Icon.clock aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span
            className={
              p.isPastDue ? "text-[var(--state-overdue-ink)]" : "text-ink-faint"
            }
          >
            {p.isPastDue ? "Was due" : "Due"}
          </span>
          <span data-figure className="text-ink">
            {due.time}
          </span>
          <span data-figure>· {due.day}</span>
        </p>
      )}

      {/* The three figures, read across. */}
      <dl className="mt-2.5 grid grid-cols-3 divide-x divide-hairline rounded-inset border border-hairline bg-[var(--surface)] text-center">
        <Figure label="Asked for" value={workSpan(p.budgetSecs ?? 0)} />
        <Figure label="Worked" value={workSpan(p.workedSecs)} accent="var(--state-positive-ink)" />
        {label ? (
          <Figure
            label={label}
            value={`${p.state === "overtime" ? "+" : ""}${workSpan(remainder)}`}
            accent={
              p.state === "on_track"
                ? undefined
                : `var(--state-${p.state === "overtime" ? "extension" : "rework"}-ink)`
            }
          />
        ) : (
          <Figure label="Left" value="—" />
        )}
      </dl>

      {/* Worked against the window in force. The base never moves. */}
      <div
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--control-active)]"
        role="img"
        aria-label={`${p.percentUsed ?? 0}% of the agreed time used`}
      >
        <span
          className="block h-full rounded-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${p.percentUsed ?? 0}%`,
            backgroundColor: STATE_FILL[p.state],
          }}
        />
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">
        <span data-figure>{p.percentUsed ?? 0}%</span> of the agreed time used
      </p>

      {/* The extension chain: what was first agreed, and what it grew to.
          Read off the two windows the task already carries rather than counting
          extension records, which would be a second feed to say the same thing
          — and a feed that can be refused, leaving the chain silently absent on
          exactly the tasks that have one. */}
      {p.originalBudgetSecs !== null &&
        p.budgetSecs !== null &&
        p.originalBudgetSecs !== p.budgetSecs && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
            <span data-figure>{workSpan(p.originalBudgetSecs)}</span>
            <span>originally</span>
            <span aria-hidden="true">→</span>
            <span data-figure className="text-ink">
              {workSpan(p.budgetSecs ?? 0)}
            </span>
            <Chip tone="extension">
              +{workSpan(p.budgetSecs - p.originalBudgetSecs)} granted
            </Chip>
          </p>
        )}

      {line && (
        <p
          className={`mt-2 border-t border-hairline pt-2 text-[11px] leading-relaxed ${
            p.state === "on_track"
              ? "text-ink-muted"
              : `text-[var(--state-${p.state === "overtime" ? "extension" : p.state === "incomplete" ? "rework" : "overdue"}-ink)]`
          }`}
        >
          {line}
        </p>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0 px-1.5 py-2">
      <dd
        data-figure
        className="truncate text-[13px] text-ink"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </dd>
      <dt className="mt-0.5 truncate text-[10px] tracking-[0.06em] text-ink-faint uppercase">
        {label}
      </dt>
    </div>
  );
}

/* ── The live block ───────────────────────────────────────────────────────── */

/**
 * One task somebody is on, with its clock and its budget.
 *
 * The clock is the watched person's own session document, so it starts and
 * stops on the manager's screen exactly when they start and stop — there is no
 * polling and no refresh. `useTicker` only drives repaints; every figure is
 * derived from `banked + elapsed`, so a throttled tab shows a coarser number
 * and never a wrong one.
 */
export function LiveTaskWork({
  view,
  employeeId,
}: {
  view: TaskView;
  employeeId: string;
}) {
  /* The clock is read here rather than passed in. `useNow` is null on the
     server and on the first client render, which is exactly right: every figure
     below is derived against it, and rendering them against `Date.now()` during
     SSR would hydrate a due moment computed on the wrong machine at the wrong
     instant. Until it lands the breakdown simply does not claim a reading. */
  const now = useNow();
  const session = useWatchedTimerSession(employeeId, view.task.id);
  const running = session?.isActive === true;
  /* Banked comes from the live session document when there is one; `loggedSecs`
     is the first paint before the first snapshot lands, and is derived from the
     same field, so the two cannot disagree about anything but freshness. */
  const banked = session?.accumulatedSecs ?? view.loggedSecs;
  const ticked = useTicker(running ? (session?.startedAtRealMs ?? null) : null);
  const worked = banked + ticked;

  const progress = taskWorkProgress(
    view.task,
    {
      workedSecs: worked,
      isRunning: running,
      /* A paused session's budget freezes where it stopped. `startedAtRealMs`
         plus what was banked is the last moment the clock was live, which is
         the closest thing the session document carries to "when it stopped". */
      pausedAtMs:
        !running && session?.startedAtRealMs != null
          ? session.startedAtRealMs + banked * 1000
          : null,
    },
    now?.getTime() ?? 0,
  );

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <Link
          href={`/tasks/${view.task.id}`}
          className="group min-w-0 flex-1 truncate text-xs font-medium text-ink hover:underline"
        >
          {view.task.title}
        </Link>
        <span
          data-figure
          className={`shrink-0 text-xs ${running ? "text-[var(--state-positive-ink)]" : "text-ink-faint"}`}
        >
          {formatTimer(worked)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[11px] text-ink-faint">
        {running ? "Working now" : "Clock paused"}
        {view.project?.name ? ` · ${view.project.name}` : ""}
      </p>
      {now && <WorkBudgetBreakdown progress={progress} nowMs={now.getTime()} />}
    </div>
  );
}

/* ── The compact reading, for a card in a grid ────────────────────────────── */

/**
 * The same reading in one line and one bar, for the team wall.
 *
 * A card in a three-up grid has room for the answer but not the working. What
 * survives the compression is what a manager scans for: how far into the budget
 * they are, and whether that is fine.
 */
export function LiveWorkLine({
  view,
  employeeId,
}: {
  view: TaskView;
  employeeId: string;
}) {
  const now = useNow();
  const session = useWatchedTimerSession(employeeId, view.task.id);
  const running = session?.isActive === true;
  const banked = session?.accumulatedSecs ?? view.loggedSecs;
  const ticked = useTicker(running ? (session?.startedAtRealMs ?? null) : null);
  const worked = banked + ticked;
  const p = taskWorkProgress(
    view.task,
    { workedSecs: worked, isRunning: running },
    now?.getTime() ?? 0,
  );

  if (!now || p.state === "no_budget") return null;

  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate text-ink-faint">
          <span data-figure className="text-ink">
            {workSpan(p.workedSecs)}
          </span>{" "}
          of <span data-figure>{workSpan(p.budgetSecs ?? 0)}</span>
        </span>
        <span
          data-figure
          className="shrink-0"
          style={{ color: `var(--state-${STATE_TONE[p.state] === "neutral" ? "risk" : STATE_TONE[p.state]}-ink)` }}
        >
          {p.state === "on_track"
            ? `${workSpan(p.remainingSecs ?? 0)} left`
            : p.state === "overtime"
              ? `+${workSpan(p.overtimeSecs ?? 0)} over`
              : p.state === "incomplete"
                ? `${workSpan(p.remainingSecs ?? 0)} short`
                : "Window closed"}
        </span>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--control-active)]">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${p.percentUsed ?? 0}%`,
            backgroundColor: STATE_FILL[p.state],
          }}
        />
      </div>
    </div>
  );
}
