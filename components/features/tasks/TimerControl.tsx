"use client";

import { usePerformanceProfile } from "@/components/layout/shell/DeviceModeContext";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEmployeeStatus } from "@/components/features/status/useEmployeeStatus";
import { Icon } from "@/components/ui/Icons";
import { Button, InlineError } from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import { useNow } from "@/lib/hooks/useNow";
import { formatTimer } from "@/lib/utils/format";
import {
  displaySecs,
  elapsedSecs,
  timerDisplayState,
} from "@/lib/rules/tasks/timer";
import type { TimerSession } from "@/lib/domain";
import { presenceRefusal } from "@/lib/rules/presence/taskGate";
import type { TaskView } from "@/lib/repositories";

/**
 * Play / pause for a task's work session.
 *
 * Every control here is wired to the repository — `startTimer` and `pauseTimer`
 * write a real `WorkCommit`, which is what feeds worked-time credit and the
 * daily-report requirement. There are no decorative transport buttons.
 *
 * One active task per person is a real constraint the repository enforces:
 * starting a second task pauses the first with `pauseReason: "task_switch"`.
 * The UI says so before it happens rather than surprising the person after.
 */

/**
 * Live elapsed for one running session.
 *
 * Derived from the session's REAL start rather than counted up from mount.
 * Counting from mount meant every remount restarted at zero — open the task in
 * a new tab, navigate away and back, or reload, and the running session's
 * elapsed silently vanished from the display until the next pause.
 *
 * The interval only drives repaints; the value is always `now - startedAtRealMs`,
 * so a throttled or backgrounded tab catches up on its next tick instead of
 * drifting permanently behind.
 *
 * `startedAtRealMs` is null when nothing is running, which is what makes this
 * return 0 between sessions.
 */
export function useTicker(startedAtRealMs: number | null): number {
  /* Seeded from the real start on the FIRST render, which is the case that
     needs it: mounting into a session that is already running — a reload, a new
     tab, or navigating back. Counting up from zero instead is what made a
     running session's elapsed disappear on every remount. Later renders are
     driven by the interval below; a fresh start is genuinely at zero, so
     nothing needs reseeding. */
  const { timerTickMs } = usePerformanceProfile();
  const [secs, setSecs] = useState(() => elapsedSecs(startedAtRealMs, Date.now()));

  useEffect(() => {
    if (startedAtRealMs === null) return;
    /* **The redraw rate, not the count.** `elapsedSecs` derives the figure from
       `startedAtRealMs` and the wall clock on every tick, so a slower interval
       shows a coarser number and never a wrong one. That property is what makes
       this the one interval in the product safe to throttle — a heartbeat, by
       contrast, is a claim that expires. */
    const id = setInterval(
      () => setSecs(elapsedSecs(startedAtRealMs, Date.now())),
      timerTickMs,
    );
    return () => clearInterval(id);
  }, [startedAtRealMs, timerTickMs]);

  return startedAtRealMs === null ? 0 : secs;
}


/**
 * The live session for whoever is DOING the work.
 *
 * Two things this fixes at once.
 *
 * **Whose timer.** `getTimer` reads the acting employee's session, so a manager
 * opening a report's task was shown their OWN clock on somebody else's work —
 * usually nothing at all. The subject here is the assignee, so Rishee viewing
 * Anant's task sees Anant's timer.
 *
 * **Live.** `watchTimerSession` is a Firestore listener on the same document
 * the employee's own browser writes, so a manager sees a start or a pause
 * without refreshing. It is the existing realtime channel — legacy has no REST
 * route or socket for timers — and observation only: nothing here writes.
 */
function useAssigneeSession(
  taskId: string,
  assigneeId: string | null,
): TimerSession | null {
  /*
   * Keyed by subject, so a change of person discards the previous clock without
   * an effect that sets state. Storing the key ALONGSIDE the session and
   * comparing on read is what keeps a previous person's timer from lingering
   * under a new one while the first snapshot is still in flight — the same
   * guarantee a `setSession(null)` in an effect gives, without the extra render
   * and without the lint rule it breaks.
   */
  const key = assigneeId ? `${assigneeId}:${taskId}` : "";
  const [entry, setEntry] = useState<{ key: string; session: TimerSession | null }>(
    { key: "", session: null },
  );
  const repo = useRepo();

  useEffect(() => {
    if (!assigneeId) return;
    return repo.watchTimerSession(assigneeId, taskId, (session) =>
      setEntry({ key: `${assigneeId}:${taskId}`, session }),
    );
  }, [repo, taskId, assigneeId]);

  return entry.key === key ? entry.session : null;
}

export function TimerControl({
  view,
  size = "row",
  onChange,
}: {
  view: TaskView;
  size?: "row" | "detail";
  onChange?: () => void;
}) {
  const taskId = view.task.id;
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const timer = useQuery(
    (r) => r.getTimer(taskId),
    [taskId, view.task.updatedAt],
  );
  const active = useQuery(
    (r) => r.getActiveTimer(),
    [taskId, view.task.updatedAt],
  );
  const [start, startState] = useAction((r) => r.startTimer(taskId));
  const [pause, pauseState] = useAction((r) =>
    r.pauseTimer(taskId, null, "manual"),
  );
  // A confirmed task has to enter `in_progress` before a session can run. That
  // is one press for the person, two writes for the repository.
  const [beginTask, beginState] = useAction((r) => r.startTask(taskId));

  /* The assignee's live session is the source of truth. `timer.data` (the
     viewer's own one-shot read) is kept only as the first paint before the
     listener delivers, and is never preferred over it. */
  const assigneeId = view.assignments[0]?.employeeId ?? null;
  const live = useAssigneeSession(taskId, assigneeId ? String(assigneeId) : null);
  const session = live ?? timer.data;

  /**
   * Banked work, from the LIVE session document.
   *
   * This read `view.loggedSecs`, which is fetched once with the task and does
   * not move when the timer does — so pausing wrote 7 seconds to
   * `cowork_task_timers` and the screen kept showing the figure from page load,
   * which was zero. "Start timer · 0m" over a session that had just banked
   * time is that, and nothing else.
   *
   * `accumulatedSecs` IS `totalSeconds` on the session document, delivered by
   * the listener, so it updates the moment the engine writes it. `loggedSecs`
   * survives only as the first paint before the first snapshot lands — and it
   * is itself derived from the same field, so the two cannot disagree about
   * anything except how fresh they are.
   */
  const banked = session?.accumulatedSecs ?? view.loggedSecs;
  /* Minute granularity, which is ample: the only thing `now` decides here is
     whether a run has passed a SIXTEEN HOUR threshold. The per-second figure
     comes from the ticker below, so nothing calls `Date.now()` during render. */
  const nowMs = (useNow() ?? new Date(0)).getTime();
  /*
   * One derivation, shared with every other surface.
   *
   * Was `view.loggedSecs + ticked`, which had no notion of a session left
   * running: a clock started before a laptop slept reported every hour since as
   * worked. `displaySecs` returns the banked total alone for a stale run, and
   * `timerDisplayState` is what decides which controls may appear — so "Start"
   * cannot show while the record says active, whatever React thinks.
   */
  /* **The status state, coupled DIRECTLY to the timer engine.** When the person
     carrying the work leaves online — offline, break or emergency — their clock
     must stop this instant, read from the in-memory presence store, not a beat
     later when the Firestore duty write and its listener have made the round
     trip. `useMyDutyMode` (below) is the durable, staleness-aware mode and lags a
     manual toggle; this is the immediate one, and it is the difference between
     "stops now" and "stops eventually". */
  const { status: myPresence, reconnecting } = useEmployeeStatus();
  const isMine = me.data
    ? view.assignments.some((a) => a.employeeId === me.data!.id)
    : false;
  /* **Reconnecting is NOT away.** After a refresh the durable presence document
     still says online, but the share has not been re-established, so the derived
     status reads offline for a moment. Treating that transient state as "away"
     fired the auto-pause below on every reload — and pausing a session that was
     left running banks its whole wall-clock elapsed, INCLUDING the reload gap, as
     worked time. That is the "4:20 appeared without me pressing play" figure: the
     clock was never paused on unload, so the reconnect banked minutes nobody
     worked. Excluding `reconnecting` holds the timer exactly as it was until the
     person genuinely goes online (it continues) or deliberately away (it pauses). */
  const away = isMine && myPresence !== "online" && !reconnecting;

  const state = timerDisplayState(session, banked, nowMs);
  const running = state === "running" && !away;
  const ticked = useTicker(running ? (session?.startedAtRealMs ?? null) : null);
  /* `ticked` only re-renders; the FIGURE comes from the rule, so a throttled
     tab or a stale run cannot make the two disagree.

     The comment that stood here warned against `accumulatedSecs` on the
     grounds that pausing writes a `WorkCommit` as well. That is the MOCK's
     model — legacy writes no commits at all, `pauseTimer` only updates
     `totalSeconds`, and there is nothing to double-count. */
  /*
   * `displaySecs`' rule, expressed against the ticker so the figure advances
   * every second: banked work alone unless the run is genuinely live, in which
   * case the current run is added. A stale run contributes nothing, which is
   * the whole point of the guard.
   */
  /* Away freezes the figure at the seconds worked up to the moment they left,
     rather than letting `displaySecs` keep counting off a session document that
     is still marked active until the pause below lands. */
  const elapsed = away
    ? banked +
      (state === "running"
        ? elapsedSecs(session?.startedAtRealMs ?? null, nowMs)
        : 0)
    : running
      ? banked + ticked
      : displaySecs(session, banked, nowMs);

  const other =
    active.data && active.data.taskId !== taskId ? active.data : null;
  /**
   * Presence, and what it withholds.
   *
   * Legacy's rule, ported: the person carrying the work cannot advance it while
   * they are not online, because the minutes of a break or an emergency are
   * being credited back to their deadlines and a clock running through them
   * would be paid for twice.
   *
   * The control is REPLACED rather than disabled. A greyed-out play button says
   * "not now" and leaves the reader to guess why; legacy replaced its whole
   * action banner with a sentence, and the sentence is the useful part. The
   * repository refuses the write regardless — this only saves somebody the trip.
   */
  /* **The gate reads the SAME immediate presence as `away`** — not the durable
     `useMyDutyMode`, which lags a status toggle by a Firestore round trip. That
     lag is the "came back online but there's no Start button" bug: `away` cleared
     the instant the person returned, but this gate stayed stuck on the stale
     mode, so the control kept rendering its away branch (which has no button)
     until the round trip landed. `presenceRefusal` only ever gates the assignee,
     so the viewer's own status is exactly the right signal. */
  /* Not while reconnecting, for the same reason as `away`: a reload is not a
     departure, so the control stays as it was rather than flipping to "paused". */
  const blocked = reconnecting ? null : presenceRefusal(myPresence, isMine);
  const needsStart = view.task.status === "confirmed";
  const startable = view.task.status === "in_progress" || needsStart;
  const pending =
    startState.isPending || pauseState.isPending || beginState.isPending;
  const error = startState.error ?? pauseState.error ?? beginState.error;

  /* **The write half of the coupling.** The display froze the instant `away`
     went true; this makes it real — the running session is paused so the banked
     seconds are correct and every other viewer (and the manager) sees it stop
     too, not only this screen. `setDutyMode` also auto-pauses on the backend when
     presence leaves online; the two are idempotent, because pausing an
     already-paused session is a no-op, so whichever lands first is fine. The ref
     fires it once per departure rather than on every render the deps churn. */
  const autoPaused = useRef(false);
  useEffect(() => {
    if (away && state === "running" && !autoPaused.current) {
      autoPaused.current = true;
      console.info(
        `[timer] STATUS CHANGED: ${myPresence} · TIMER ACTION: paused`,
        { taskId },
      );
      void pause().then(() => {
        timer.refetch();
        active.refetch();
      });
    }
    if (!away) autoPaused.current = false;
  }, [away, state, myPresence, taskId, pause, timer, active]);

  async function toggle() {
    if (running) {
      await pause();
    } else {
      if (needsStart) {
        const began = await beginTask();
        if (!began.ok) return;
      }
      await start();
    }
    timer.refetch();
    active.refetch();
    onChange?.();
  }

  /* Away, and it is my work. Legacy withheld the control entirely here —
     `page.js:7824` returns null, `:6601` disables — and the detail view says
     why. A running session is still shown: the time is real and was worked,
     and hiding it would read as the product having lost it. */
  if (blocked && startable) {
    if (size === "row") {
      return (
        <span
          data-figure
          className="inline-flex h-6 w-[74px] shrink-0 items-center justify-center text-[11px] text-ink-faint"
          title={blocked.message}
        >
          {elapsed > 0 ? formatTimer(elapsed) : "—"}
        </span>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex items-baseline gap-1.5">
            <span
              data-figure
              className="text-[22px] leading-none tracking-[-0.025em] text-ink-muted"
            >
              {formatTimer(elapsed)}
            </span>
            <span data-figure className="text-xs text-ink-faint">
              of {formatTimer(view.task.estimatedEffortSecs ?? 0)}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-ink-faint">
            {blocked.stateLabel} — timer paused
          </p>
        </div>
        <p className="w-full text-[11px] text-ink-faint">{blocked.message}</p>
      </div>
    );
  }

  /*
   * A clock left running past any plausible stretch.
   *
   * Shown before every other branch because it outranks them: the record says
   * active, so an ordinary render would offer "Pause" beside a figure counting
   * a laptop's sleep. The banked total is still shown — it was really worked —
   * and pausing is offered to whoever owns it, since closing the session is
   * exactly what it needs.
   */
  if (state === "stale") {
    if (size === "row") {
      return (
        <span
          data-figure
          className="inline-flex h-6 w-[74px] shrink-0 items-center justify-center text-[11px] text-ink-faint"
          title="This timer was left running and needs attention"
        >
          {formatTimer(elapsed)}
        </span>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p data-figure className="text-[22px] leading-none tracking-[-0.025em] text-ink-muted">
            {formatTimer(elapsed)}
          </p>
          <p className="mt-1 text-[11px] text-ink-faint">
            Timer requires attention — it was left running
          </p>
        </div>
        {isMine && (
          <Button
            tone="secondary"
            size="sm"
            disabled={pending}
            onClick={async () => {
              const r = await pause();
              if (r.ok) onChange?.();
            }}
          >
            Close session
          </Button>
        )}
      </div>
    );
  }

  /* Not actionable — never offer a control that would fail. The row keeps its
     width so the column stays aligned; elapsed time still shows if any exists. */
  if (!isMine || !startable) {
    if (size !== "row") return null;
    return (
      <span
        data-figure
        className="inline-flex h-6 w-[74px] shrink-0 items-center justify-center text-[11px] text-ink-faint"
        title={isMine ? "Not startable in this state" : "Not assigned to you"}
      >
        {elapsed > 0 ? formatTimer(elapsed) : "—"}
      </span>
    );
  }

  if (size === "row") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title={
          running
            ? `Pause — ${formatTimer(elapsed)} on the clock`
            : other
              ? `Start — this will pause “${other.taskTitle}”`
              : state === "paused"
                ? `Resume — ${formatTimer(elapsed)} worked so far`
                : "Start timer"
        }
        aria-label={
          running
            ? `Pause timer on ${view.task.title}`
            : state === "paused"
              ? `Resume timer on ${view.task.title}`
              : `Start timer on ${view.task.title}`
        }
        className={`inline-flex h-6 w-[74px] shrink-0 items-center justify-center gap-1 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50 ${
          running
            ? "bg-ink text-[var(--body-bg)]"
            : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
        }`}
      >
        {running ? (
          <Icon.pause className="h-3 w-3" />
        ) : (
          <Icon.play className="h-3 w-3" />
        )}
        <span data-figure>{running ? formatTimer(elapsed) : "Start"}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[15px] font-medium transition-colors disabled:opacity-50 ${
          running
            ? "bg-ink text-[var(--body-bg)]"
            : "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)]"
        }`}
      >
        {running ? <Icon.pause /> : <Icon.play />}
        {/* Never "Start timer" once work is banked — that reads as though the
            time is gone. `state` comes from the session document, so the label
            cannot disagree with what the engine holds. */}
        {pending
          ? "…"
          : running
            ? "Pause"
            : needsStart
              ? "Start work"
              : state === "paused"
                ? "Resume timer"
                : "Start timer"}
      </button>

      <div className="min-w-0">
        <p className="flex items-baseline gap-1.5">
          <span
            data-figure
            className="text-[22px] leading-none tracking-[-0.025em] text-ink"
          >
            {formatTimer(elapsed)}
          </span>
          <span data-figure className="text-xs text-ink-faint">
            of {formatTimer(view.task.estimatedEffortSecs ?? 0)}
          </span>
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
          {/* Read off `state`, not off `elapsed > 0` — the two agreed only by
              accident, and disagreed exactly when the banked figure was stale. */}
          {running ? (
            <>
              <LiveDot />
              Working
            </>
          ) : state === "paused" ? (
            "Paused · total worked"
          ) : (
            "Not started"
          )}
        </p>
      </div>

      {other && !running && (
        <p className="w-full text-[11px] text-ink-faint">
          Starting this pauses{" "}
          <span className="text-ink">“{other.taskTitle}”</span> — only one task
          runs at a time.
        </p>
      )}

      {error && (
        <div className="w-full">
          <InlineError
            message={error}
            code={
              startState.errorCode ??
              pauseState.errorCode ??
              beginState.errorCode
            }
          />
        </div>
      )}
    </div>
  );
}

export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative flex h-1.5 w-1.5 shrink-0 ${className}`}
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  );
}

/**
 * "What am I working on right now", carried by the shell so the answer is never
 * more than a glance away — and absent entirely when nothing is running, rather
 * than sitting there as an empty slot.
 */
export function ActiveWorkPill() {
  const active = useQuery((r) => r.getActiveTimer(), []);
  const data = active.data;
  const ticked = useTicker(data?.startedAtRealMs ?? null);

  if (!data) return null;

  return (
    <Link
      href={`/tasks/${data.taskId}`}
      className="inline-flex max-w-[220px] items-center gap-2 rounded-full bg-ink py-1.5 pr-3 pl-2.5 text-[var(--body-bg)] transition-opacity hover:opacity-90"
      title={`Running: ${data.taskTitle}`}
    >
      <LiveDot />
      <span className="min-w-0 truncate text-xs">{data.taskTitle}</span>
      <span data-figure className="shrink-0 text-xs opacity-75">
        {formatTimer(data.loggedSecs + ticked)}
      </span>
    </Link>
  );
}
