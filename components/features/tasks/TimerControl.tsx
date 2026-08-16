"use client";

import { usePerformanceProfile } from "@/components/layout/shell/DeviceModeContext";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEmployeeStatus } from "@/components/features/status/useEmployeeStatus";
import { Icon } from "@/components/ui/Icons";
import { Button, InlineError } from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import { useWatchedTimerSession } from "@/lib/hooks/useTimerSession";
import { useNow } from "@/lib/hooks/useNow";
import { formatTimer } from "@/lib/utils/format";
import {
  bankableRunSecs,
  displaySecs,
  elapsedSecs,
  rebaseSecs,
  timerDisplayState,
} from "@/lib/rules/tasks/timer";
import { presenceRefusal } from "@/lib/rules/presence/taskGate";
import { blockedMessage, deadlineBlock } from "@/lib/rules/tasks/deadlineBlock";
import { HEARTBEAT_INTERVAL_MS, STALE_AFTER_MS } from "@/lib/rules/presence/duty";
import { settledWithin } from "@/lib/rules/tasks/writeTimeout";
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
     running session's elapsed disappear on every remount.

     **The origin is stored WITH the figure.** It used to be a bare number, and
     the comment here claimed a fresh start needed no reseeding "because it is
     genuinely at zero" — which is true of the run and false of the state. The
     held number survives a pause: press resume after a five-minute run and the
     display read five minutes on top of the banked total for one whole tick,
     then fell back to zero-plus-banked when the interval next fired. That is
     the jump forward and the drop back, and it happened on every resume, on
     every optimistic start handing over to the engine's own timestamp, and on
     the shell pill whenever the active task changed under it. Keyed like this,
     a figure belonging to a previous origin is rebased on the render that
     notices, not a tick later. */
  const { timerTickMs } = usePerformanceProfile();
  const [tick, setTick] = useState(() => ({
    originMs: startedAtRealMs,
    secs: elapsedSecs(startedAtRealMs, Date.now()),
  }));

  useEffect(() => {
    if (startedAtRealMs === null) return;
    /* Stamped with the origin it was measured against, and left alone when
       neither has moved — a slow tab must not re-render for an unchanged
       second. */
    const setSecs = (secs: number) =>
      setTick((prev) =>
        prev.originMs === startedAtRealMs && prev.secs === secs
          ? prev
          : { originMs: startedAtRealMs, secs },
      );
    /* Re-anchored the moment the origin moves rather than at the next tick.
       The render below has already rebased the held figure, so this only
       settles the state onto the real clock — but without it a low-power
       profile would carry a rebased approximation for a couple of seconds. */
    setSecs(elapsedSecs(startedAtRealMs, Date.now()));
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

  if (startedAtRealMs === null) return 0;
  /* A figure taken against a previous origin is shifted onto this one rather
     than shown as-is or blanked to zero — both of which are visible jumps in a
     number that may only ever count up. */
  return tick.originMs === startedAtRealMs
    ? tick.secs
    : rebaseSecs(tick, startedAtRealMs);
}


/**
 * The wall clock, for EVENT HANDLERS only.
 *
 * Deliberately module-level rather than inline in the component. Reading the
 * clock during a render is impure — the same props would produce two different
 * figures — and `timerState.test.ts` enforces that by scanning the component
 * body for `Date.now()`. A press is not a render, so it genuinely may read the
 * clock; naming the seam is what keeps that exception explicit instead of
 * looking like the bug the test exists to catch.
 */
function pressMs(): number {
  return Date.now();
}

export function TimerControl({
  view,
  size = "row",
  onChange,
  tone = "default",
}: {
  view: TaskView;
  /** `bar` is `row` at a larger scale — same compact control, bigger clock. */
  size?: "row" | "detail" | "bar";
  onChange?: () => void;
  /**
   * Presentational only. `warn` recolours the row clock amber for a caller that
   * has decided the work is over its time budget — the timer itself decides
   * nothing about that. Default leaves every colour exactly as it was.
   */
  tone?: "default" | "warn";
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
  const repo = useRepo();
  const [start, startState] = useAction((r) => r.startTimer(taskId));
  const [pause, pauseState] = useAction((r) =>
    r.pauseTimer(taskId, null, "manual"),
  );
  // A confirmed task has to enter `in_progress` before a session can run. That
  // is one press for the person, two writes for the repository.
  const [beginTask, beginState] = useAction((r) => r.startTask(taskId));

  /**
   * **The press, answered before the network is.**
   *
   * `startTimer` and `pauseTimer` are real round trips, and on success
   * `useAction` bumps the global repository version — which re-runs EVERY
   * `useQuery` mounted on the page. Until all of that had landed the button was
   * `disabled` and its label was "…", so the honest description of a press was:
   * the control dies, several seconds pass, then the clock moves. People
   * pressed twice.
   *
   * So the control now flips on the press and the write is reconciled behind
   * it. Two things make that safe rather than a lie:
   *
   *   - it is dropped the moment the engine's own session document disagrees,
   *     and on any failed write, so a refused start cannot leave a clock
   *     apparently running;
   *   - `heldSecs` freezes the figure where the pause was pressed. Without it
   *     the display falls back to `banked`, which does not yet include the run
   *     being closed, and the number visibly jumps BACKWARDS before settling.
   *
   * `atMs` is the optimistic run's origin, used only until the real
   * `startedAtRealMs` arrives. The previous session's start is deliberately not
   * reused: it belongs to a run that already ended, and reading it would open a
   * fresh clock at that run's elapsed.
   */
  const [pressed, setPressed] = useState<{
    kind: "running" | "paused";
    atMs: number;
    heldSecs: number;
    /* `serverRunning` as it stood when the press happened. The override expires
       on the first value that differs from it — see `optimistic` below. */
    fromServer: boolean;
  } | null>(null);
  /* Re-entrancy guard, in a ref rather than `disabled`. The button stays live
     to the touch — it is the WRITE that must not overlap, not the press. */
  const inFlight = useRef(false);
  /**
   * **A press that lands mid-write is remembered, not thrown away.**
   *
   * The guard above kept two writes from overlapping, which is right, but it
   * did it by discarding the second press in silence. That is the reported
   * fault: pausing flips the display instantly while its write is still going,
   * so the obvious next press — Resume, a moment later — arrived while the
   * guard was still held and vanished. Nothing moved, nothing was said, and the
   * button worked "after some time", meaning after the person pressed a second
   * time with the guard finally free.
   *
   * One slot, deliberately. Jabbing the button five times should not queue five
   * writes; the last intent is the one that stands.
   */
  const queued = useRef(false);
  const [replay, setReplay] = useState(0);
  /* A write that did not come back in time. Said out loud, because the display
     has just reverted to the engine's state under the person's hands and an
     unexplained jump back is worse than the delay itself. */
  /* What the server held when we gave up waiting, or null. Read by the
     derivation beside `error` — not a plain boolean, because the message has to
     expire on its own. */
  const [stall, setStall] = useState<{ serverRunning: boolean } | null>(null);
  /* Whether the "pause the timer?" confirmation is open. Pausing writes a work
     commit and closes the run, so the deliberate press asks once first. */
  const [confirmingPause, setConfirmingPause] = useState(false);

  /* The assignee's live session is the source of truth. `timer.data` (the
     viewer's own one-shot read) is kept only as the first paint before the
     listener delivers, and is never preferred over it. */
  const assigneeId = view.assignments[0]?.employeeId ?? null;
  /* **Whose timer.** `getTimer` reads the ACTING employee's session, so a
     manager opening a report's task was shown their own clock on somebody
     else's work — usually nothing at all. The subject here is the assignee, so
     Rishee viewing Anant's task sees Anant's timer, live. */
  const live = useWatchedTimerSession(assigneeId ? String(assigneeId) : null, taskId);
  /**
   * **The fallback is only valid for the person doing the work.**
   *
   * `getTimer` reads the ACTING employee's session — the viewer's own. For the
   * assignee that is the same document the listener watches, so falling back to
   * it while the first snapshot arrives is harmless. For anybody else it is a
   * different document entirely: the manager who created the task sees THEIR
   * own clock on it, which is why one screen read 40 minutes and the other 20.
   *
   * Null instead, so `banked` falls through to `view.loggedSecs` — the task's
   * own recorded total, which is the same figure for every viewer.
   */
  const viewerIsAssignee =
    !!me.data && !!assigneeId && String(me.data.id) === String(assigneeId);
  /**
   * **Once the listener has spoken, it is never overruled by the one-shot read.**
   *
   * This was `live ?? timer.data`, and the fallback is what made the button
   * flicker ON → OFF → ON within a second of a press. A successful write calls
   * `notifyRepositoryChanged()`, which re-runs every mounted query including
   * `getTimer`; while that refetch is in flight — or on any frame where the
   * listener has not yet re-delivered — `live` is momentarily null and the
   * display fell back to a `timer.data` that still described the PREVIOUS
   * state. The clock flipped back to what it had just stopped being, then
   * forward again when the snapshot arrived.
   *
   * The last live snapshot is remembered instead, keyed by task so opening a
   * different one cannot inherit it. The one-shot read survives for exactly
   * what it was for: the first paint, before the listener has ever delivered.
   */
  const lastLive = useRef<{ taskId: string; data: NonNullable<typeof live> } | null>(null);
  if (live) lastLive.current = { taskId, data: live };
  const remembered =
    lastLive.current?.taskId === taskId ? lastLive.current.data : null;
  const session = live ?? remembered ?? (viewerIsAssignee ? timer.data : null);

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
  const { status: myPresence, reconnecting, hydrated } = useEmployeeStatus();
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
  /* **And `hydrated` is the other half of that guard, which was missing.**
     `reconnecting` only becomes true once the durable duty document has been
     read back. Between mount and that first read the store still holds its
     INITIAL value — `offline`, with `reconnecting` false — and the store itself
     calls that a guess rather than a fact: "initialises to offline, which is a
     GUESS until the duty document has been heard from... surfaces that would
     otherwise assert Offline wait on this instead."

     Without it every reload spent a few frames looking exactly like somebody
     stepping away, so the auto-pause below fired and STOPPED A RUNNING TIMER on
     each refresh — the clock was live before the reload and paused after it,
     with no press behind it. `DutySync` already guards `!hydrated` before
     `reconnecting` for the same reason; this is the same rule applied to the
     surface that writes a pause. */
  const away = isMine && hydrated && myPresence !== "online" && !reconnecting;

  const state = timerDisplayState(session, banked, nowMs);
  /* What the ENGINE says, kept separate from what the button says. Everything
     that writes — the auto-pause, the heartbeat — reads this one; only the
     display reads the optimistic one below. */
  const serverRunning = state === "running" && !away;
  /**
   * The override, expired by DERIVATION rather than by an effect.
   *
   * It lives exactly as long as the engine still reports what it reported when
   * the button was pressed. The first `serverRunning` that differs is the write
   * landing, and from that instant the engine is authoritative again.
   *
   * Expiring on "differs from the press" rather than on "matches what I asked
   * for" is deliberate: matching would go on holding the override open through
   * every value that is not the one requested. It is only half the guarantee
   * though — a comparison against a value that can come back is not an expiry
   * at all, which is what the effect below exists to finish.
   *
   * A refused write never reaches here: `toggle` clears the press itself on
   * `!ok`, because a refusal moves nothing on the server and there is therefore
   * no change for this to expire on.
   */
  const optimistic = pressed && serverRunning === pressed.fromServer ? pressed : null;
  /**
   * And once expired it is THROWN AWAY, not merely ignored.
   *
   * Expiry above is a comparison against a value that can come back. A press
   * to start expires when `serverRunning` goes true — and the session is later
   * paused by the presence gate, by another tab, or by a stale heartbeat, at
   * which point `serverRunning` is false again and matches `fromServer` once
   * more. The spent override then springs back to life and re-asserts a run
   * whose origin is the ORIGINAL press, so the clock jumps forward by
   * everything that has happened since — minutes or hours in one frame — and
   * falls back the moment anything flips again.
   *
   * Dropping the record at the instant it expires is what makes the override
   * live exactly once. The derivation above is kept as well: it is what the
   * render actually reads, so this cannot flicker whatever order the two run
   * in.
   *
   * Adjusted during the render rather than from an effect, which is React's
   * own answer for state that must reset when a prop changes: the re-render is
   * discarded before it is committed, so nothing paints and nothing cascades.
   * `setPressed(null)` makes the condition false, so it settles at once.
   */
  if (pressed && serverRunning !== pressed.fromServer) setPressed(null);
  /* Away still wins outright: presence stopping the clock is a rule, not a
     pending request, so an optimistic "running" must not survive it. */
  const running = away
    ? false
    : optimistic
      ? optimistic.kind === "running"
      : serverRunning;
  /* The label and the status line read this rather than `state`, so a pressed
     Pause does not sit there reading "Working" until the write lands. */
  const shownState = optimistic
    ? optimistic.kind === "running"
      ? ("running" as const)
      : ("paused" as const)
    : state;
  /* While the optimistic run is unconfirmed the origin is the press itself;
     once the engine confirms, `optimistic` is cleared and this becomes the real
     `startedAtRealMs`.
     Read off the ENGINE's state rather than off `running`, so the figure keeps
     being derived per second while `away` holds the display — see `elapsed`.
     Null whenever no run is in flight, which is what makes the ticker return 0
     between sessions. */
  const runOrigin =
    optimistic?.kind === "running"
      ? optimistic.atMs
      : state === "running"
        ? (session?.startedAtRealMs ?? null)
        : null;
  const ticked = useTicker(runOrigin);
  /**
   * **The run, capped exactly as the credit is capped.**
   *
   * `ticked` is raw wall clock — `now − runOrigin` — and the engine never pays
   * for all of it: `bankableRunSecs` stops at the last beat plus a grace, and
   * `#closeGapAndKeepRunning` banks that figure. A backgrounded tab has its
   * beats throttled to about once a minute and a sleeping laptop sends none, so
   * the two diverge silently. The screen climbed to 59:10, the engine
   * reconciled 50:00, and the clock dropped nine minutes.
   *
   * Nothing was ever lost — those minutes were never creditable. Showing them
   * and withdrawing them is the fault, so the display now stops where the
   * credit stops and simply holds still instead of counting into time it cannot
   * keep.
   *
   * `nowRealMs` is derived from the ticker rather than read from the clock:
   * `timerState.test.ts` scans this component for `Date.now()`, because reading
   * the clock during a render makes the same props produce two different
   * figures. The ticker is the one thing allowed to move.
   */
  const runSecs =
    runOrigin === null
      ? 0
      : bankableRunSecs({
          startedAtRealMs: runOrigin,
          /* Null for an optimistic run the engine has not seen yet, and for
             sessions written before beats existed — both mean "no cap known",
             which `bankableRunSecs` reads as the full run. */
          heartbeatAtRealMs: session?.heartbeatAtRealMs ?? null,
          nowRealMs: runOrigin + ticked * 1000,
          graceMs: STALE_AFTER_MS,
        });

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
  /* Away holds the figure at the work done up to the moment they left — the
     auto-pause below lands within a round trip and `banked` then carries the
     run, so this branch is only ever a fraction of a second long.
     It reads the SECOND-resolution ticker rather than recomputing against
     `nowMs`. `useNow` is quantised down to the minute, so a run that had been
     going for 40 seconds measured 0 against it: stepping away made the clock
     drop by up to a minute, and banking the real elapsed a moment later threw
     it forward again. That pair — backwards, then a jump — is the same bug
     `useLiveNow` was written for elsewhere. */
  /* The optimistic pause branch holds the figure it was pressed at. Falling
     through to `displaySecs` would keep counting — the engine's session still
     says running until the write lands — and falling back to `banked` would
     drop the run that is being closed. Neither is what the person just did. */
  const elapsed = away
    ? banked + runSecs
    : optimistic?.kind === "paused"
      ? optimistic.heldSecs
      : running
        ? banked + runSecs
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
  /* Ungated until presence is known, for the same reason `away` is: an
     unhydrated store reports a guess, and gating on it replaced the running
     clock with "you are offline — timer paused" for a frame on every reload. */
  const blocked =
    !hydrated || reconnecting ? null : presenceRefusal(myPresence, isMine);
  const needsStart = view.task.status === "confirmed";
  const startable = view.task.status === "in_progress" || needsStart;

  /**
   * **Past the deadline the clock stops — OWNER DECISION, 15 Aug 2026.**
   *
   * Read from the task's CURRENT deadline on every render, never stored: an
   * approved extension moves the date and the next render is simply no longer
   * past it, so the timer returns without anything being cleared. See
   * `deadlineBlock`.
   *
   * `nowMs` is the minute-quantised clock, which is ample — a block that
   * arrives up to a minute late is a minute of work, not a wrong figure, and
   * reading the real clock during a render is what `timerState.test.ts`
   * forbids.
   */
  const block = deadlineBlock({
    dueAt: view.task.deadline.dueAt,
    nowMs,
    isActionable: startable,
  });
  const pending =
    startState.isPending || pauseState.isPending || beginState.isPending;
  /**
   * **The stall message expires when the server moves, not only on the next
   * press.**
   *
   * A write that "did not reach the server in time" has very often NOT failed —
   * it lands a moment after we stop waiting for it. The listener then delivers
   * the new state and the button correctly reads Pause · Working, while this
   * banner sat underneath still saying the press did not land. A running clock
   * and "try again" on the same screen is worse than either alone: it teaches
   * people to distrust the control that is in fact working, and to press again,
   * which stops the timer they just started.
   *
   * The message's own words are the rule. It says the timer is showing what the
   * server holds — so the moment the server holds something ELSE, it is
   * describing a past that has been overtaken, and it goes. A write that really
   * did fail leaves the server where it was, so the message stays.
   *
   * Derived rather than cleared from an effect, the same shape as `optimistic`
   * above: nothing has to remember to tidy up.
   */
  const stalledNow = stall !== null && stall.serverRunning === serverRunning;
  const error =
    startState.error ??
    pauseState.error ??
    beginState.error ??
    (stalledNow
      ? "That did not reach the server in time. The timer is showing what the server holds — try again."
      : null);

  /* **The write half of the coupling.** The display froze the instant `away`
     went true; this makes it real — the running session is paused so the banked
     seconds are correct and every other viewer (and the manager) sees it stop
     too, not only this screen. `setDutyMode` also auto-pauses on the backend when
     presence leaves online; the two are idempotent, because pausing an
     already-paused session is a no-op, so whichever lands first is fine. The ref
     fires it once per departure rather than on every render the deps churn. */
  /**
   * **A run that crosses its own deadline is stopped.**
   *
   * The same shape as the presence auto-pause below and for the same reason:
   * the display refusing to count is not enough, because the ENGINE's session
   * would still be open and would go on banking minutes against a commitment
   * that has already been missed. Time already worked is never touched — this
   * closes the session, it does not take anything back.
   *
   * Fires once per block; the ref is released when the deadline moves, so an
   * approved extension leaves it able to fire again on the next one.
   */
  const deadlinePaused = useRef(false);
  useEffect(() => {
    if (block && state === "running" && !deadlinePaused.current) {
      deadlinePaused.current = true;
      void pause();
    }
    if (!block) deadlinePaused.current = false;
  }, [block, state, pause]);

  const autoPaused = useRef(false);
  useEffect(() => {
    if (away && state === "running" && !autoPaused.current) {
      autoPaused.current = true;
      console.info(
        `[timer] STATUS CHANGED: ${myPresence} · TIMER ACTION: paused`,
        { taskId },
      );
      /* No refetch pair here either: a successful `pause` notifies every
         mounted query through `useAction`, which is what these two calls were
         asking for a second time. */
      void pause();
    }
    if (!away) autoPaused.current = false;
  }, [away, state, myPresence, taskId, pause]);

  /* **The liveness beat that stops a gap being paid for.**
   *
   * While the run is genuinely live this moves the session's `heartbeatAt`
   * forward every interval. The point is what happens when it STOPS: a closed
   * tab or a sleeping laptop sends no beat, and `pauseTimer` refuses to bank time
   * past the last one plus the staleness grace — which is what keeps a session
   * left running across a two-hour gap from crediting the whole gap as worked.
   * The same interval and window presence itself uses.
   *
   * A beat that finds the previous one already stale reconcile-pauses the
   * session (in the repository), so the refetch here picks the clock up as
   * stopped at the right figure rather than running on the gap. */
  /* Gated on `serverRunning`, NOT on the optimistic flip: a heartbeat is a
     claim about a session the engine holds, and there is no such session to
     beat for until the start has actually landed. Beating on the optimistic
     state fired a doomed write on every press. */
  useEffect(() => {
    if (!serverRunning) return;
    let cancelled = false;
    const beat = async () => {
      await repo.heartbeatTimer(taskId).catch(() => {});
      if (cancelled) return;
      /* Kept, unlike the pairs removed elsewhere. `heartbeatTimer` is called
         straight on the repository rather than through `useAction`, so nothing
         invalidates anything — and a beat that finds the previous one stale
         reconcile-pauses the session, which is precisely the change these two
         reads exist to notice. */
      timer.refetch();
      active.refetch();
    };
    void beat();
    const id = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

    /**
     * **Beat again the moment the tab comes back.**
     *
     * `setInterval` is the one thing a browser throttles hardest: Chrome clamps
     * a hidden tab to roughly one tick a minute, and stops it altogether when
     * the window is occluded or the machine sleeps. So the gap between beats is
     * widest exactly when somebody is working in another window — and every
     * second past the bankable grace is time taken off their record.
     *
     * `visibilitychange` is not throttled. Returning to the tab lands a beat
     * immediately, which closes the gap at its source rather than relying on
     * the grace to forgive it.
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [serverRunning, taskId, repo, timer, active]);

  /**
   * One press.
   *
   * The optimistic flip happens FIRST, before anything is awaited, so the
   * control answers in the same frame as the click. Every failure path clears
   * it again — `useAction` returns a refusal rather than throwing, so a
   * presence gate or a task-switch conflict lands here as `!ok` and puts the
   * button back where it was, with `error` rendered below.
   *
   * The `timer.refetch()` / `active.refetch()` pair that used to close this
   * function is gone. It was never needed: `useAction` calls
   * `notifyRepositoryChanged()` on success, which re-runs every mounted query
   * INCLUDING these two, so the explicit calls bumped their nonces on top of
   * that and bought a second, duplicate round trip for each — after the write
   * the person was already waiting on.
   */
  async function toggle() {
    /**
     * **Pausing asks first — OWNER DECISION, 15 Aug 2026.**
     *
     * Pausing is not a display change: it writes a work commit and closes the
     * run, which is what credits the time. A mis-press mid-session is
     * therefore a real write, and the confirmation is one press against it.
     *
     * Only the deliberate press asks. The automatic pauses — presence, the
     * deadline block above, the task switch inside `startTimer` — never reach
     * here and could not wait for an answer anyway: nobody is at the screen
     * when a laptop sleeps.
     */
    if (running && !confirmingPause) {
      setConfirmingPause(true);
      return;
    }
    /**
     * Not `disabled`: the guard is on the write, so a second press during a
     * round trip cannot interleave a start and a pause on one session.
     *
     * It is now HELD rather than dropped — see `queued`. The confirmation flag
     * is deliberately left standing while a press waits: it is what tells the
     * replay below that this pause was already agreed to, so nobody is asked
     * the same question twice.
     */
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    setConfirmingPause(false);
    inFlight.current = true;

    const wasRunning = running;
    setPressed({
      kind: wasRunning ? "paused" : "running",
      atMs: pressMs(),
      /* Only a pause needs the figure held; a start begins at the banked
         total and counts up from `atMs`. */
      heldSecs: wasRunning ? elapsed : 0,
      fromServer: serverRunning,
    });

    try {
      /* Every write is raced against a clock — see `settledWithin`. A write that
         never settles used to leave the guard held and the optimistic flip
         asserted, so the button died and the page claimed a state the engine
         did not have. */
      const stalled = () => {
        setPressed(null);
        setStall({ serverRunning });
      };

      if (wasRunning) {
        const r = await settledWithin(pause());
        if (r === null) return stalled();
        if (!r.ok) {
          setPressed(null);
          return;
        }
      } else {
        if (needsStart) {
          const began = await settledWithin(beginTask());
          if (began === null) return stalled();
          if (!began.ok) {
            setPressed(null);
            return;
          }
        }
        const r = await settledWithin(start());
        if (r === null) return stalled();
        if (!r.ok) {
          setPressed(null);
          return;
        }
      }
      setStall(null);
      onChange?.();
    } finally {
      inFlight.current = false;
      /* Handed to a render rather than called straight from here. Re-entering
         `toggle` at this point would run the closure of the render that STARTED
         the write, which still believes the timer is in the state it was in
         then — a queued Resume would read itself as a Pause. Bumping a counter
         makes the replay happen in a render that has seen the write land. */
      if (queued.current) {
        queued.current = false;
        setReplay((n) => n + 1);
      }
    }
  }

  /**
   * The held press, run against the state as it now stands.
   *
   * Deps are the counter alone on purpose: `toggle` is rebuilt every render, so
   * depending on it would fire this on each one. The counter only moves when a
   * press was actually held back.
   */
  useEffect(() => {
    if (replay === 0) return;
    void toggle();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [replay]);

  /* Away, and it is my work. Legacy withheld the control entirely here —
     `page.js:7824` returns null, `:6601` disables — and the detail view says
     why. A running session is still shown: the time is real and was worked,
     and hiding it would read as the product having lost it. */
  /* Row and the larger `bar` share one compact shape — only the dimensions and
     the glyph scale differ. `detail` is the separate two-line block further
     down and is unaffected. */
  const isBar = size === "bar";
  const compact = size === "row" || isBar;
  const figSize = isBar
    ? "h-9 min-w-[108px] gap-1.5 px-3.5 text-[15px]"
    : "h-6 w-[74px] gap-1 text-[11px]";
  const glyphSize = isBar ? "h-4 w-4" : "h-3 w-3";
  /**
   * **Blocked: the deadline has passed.**
   *
   * Before the presence branch, because it outranks it — somebody who is
   * online has a different reason they cannot start, and naming presence here
   * would send them to fix the wrong thing.
   *
   * The banked figure is still shown: it was really worked. What is withheld
   * is only the control that would accrue more.
   */
  if (block && startable) {
    if (size === "row") {
      return (
        <span
          data-figure
          className="inline-flex h-6 w-[74px] shrink-0 items-center justify-center text-[11px] text-[var(--state-overdue-ink)]"
          title={blockedMessage(block)}
        >
          {elapsed > 0 ? formatTimer(elapsed) : "Blocked"}
        </span>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-3 py-1.5 text-[13px] text-[var(--state-overdue-ink)]">
          <Icon.blocked className="h-3.5 w-3.5" />
          Blocked
        </span>
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
            Deadline passed{" "}
            <span data-figure>{formatTimer(block.overdueSecs)}</span> ago
          </p>
        </div>
        <p className="w-full max-w-[62ch] text-[11px] text-[var(--state-overdue-ink)]">
          {blockedMessage(block)}
        </p>
      </div>
    );
  }

  if (blocked && startable) {
    if (compact) {
      return (
        <span
          data-figure
          className={`inline-flex shrink-0 items-center justify-center ${figSize} ${
            tone === "warn" ? "text-[var(--state-warn-ink)]" : "text-ink-faint"
          }`}
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
    if (compact) {
      return (
        <span
          data-figure
          className={`inline-flex shrink-0 items-center justify-center ${figSize} text-ink-faint`}
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
    if (size === "detail") return null;
    return (
      <span
        data-figure
        className={`inline-flex shrink-0 items-center justify-center ${figSize} text-ink-faint`}
        title={isMine ? "Not startable in this state" : "Not assigned to you"}
      >
        {elapsed > 0 ? formatTimer(elapsed) : "—"}
      </span>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={
          running
            ? `Pause — ${formatTimer(elapsed)} on the clock`
            : other
              ? `Start — this will pause “${other.taskTitle}”`
              : shownState === "paused"
                ? `Resume — ${formatTimer(elapsed)} worked so far`
                : "Start timer"
        }
        aria-label={
          running
            ? `Pause timer on ${view.task.title}`
            : shownState === "paused"
              ? `Resume timer on ${view.task.title}`
              : `Start timer on ${view.task.title}`
        }
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-colors disabled:opacity-50 ${figSize} ${
          running
            ? tone === "warn"
              ? /* Over budget: an amber chip. `#1c1405` is a fixed dark ink for
                   text ON the amber fill — readable in both themes. */
                "bg-[var(--state-warn)] text-[#1c1405]"
              : "bg-ink text-[var(--body-bg)]"
            : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
        }`}
      >
        {running ? (
          <Icon.pause className={glyphSize} />
        ) : (
          <Icon.play className={glyphSize} />
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
        className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[15px] font-medium transition-colors disabled:opacity-50 ${
          running
            ? "bg-ink text-[var(--body-bg)]"
            : "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)]"
        }`}
      >
        {running ? <Icon.pause /> : <Icon.play />}
        {/* Never "Start timer" once work is banked — that reads as though the
            time is gone. `shownState` is the session document's state until a
            press overrides it, so the label cannot disagree with what the
            engine holds for longer than the write takes.

            The "…" branch this replaces was the visible face of the lag: the
            label went to an ellipsis and the button went dead for the whole
            round trip. The press now shows its own result. */}
        {running
          ? "Pause"
          : needsStart
            ? "Start work"
            : shownState === "paused"
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
          ) : shownState === "paused" ? (
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

      {/* Pausing writes a work commit and closes the run, so the deliberate
          press asks once. Nothing is written until Yes. */}
      {confirmingPause && (
        <div className="w-full rounded-inset border border-hairline bg-[var(--surface-sunken)] p-3">
          <p className="text-[13px] text-ink">Pause the timer?</p>
          <p className="mt-0.5 max-w-[58ch] text-[11px] text-ink-faint">
            This closes the current run and credits the time worked so far. You
            can resume afterwards.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void toggle()}>
              Yes, pause
            </Button>
            <Button
              size="sm"
              tone="secondary"
              onClick={() => setConfirmingPause(false)}
            >
              Keep running
            </Button>
          </div>
        </div>
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
/**
 * How often the top-bar pill re-asks the engine what is running.
 *
 * Well inside the heartbeat staleness window, so a session stopped by anything
 * that does not bump the query version — a reconcile-pause, another device — is
 * corrected long before it could mislead anybody about a day's work.
 */
const ACTIVE_PILL_REFRESH_MS = 20_000;

export function ActiveWorkPill() {
  const active = useQuery((r) => r.getActiveTimer(), []);
  const data = active.data;
  const ticked = useTicker(data?.startedAtRealMs ?? null);

  /**
   * Re-read on a slow interval, because not every stop bumps the version.
   *
   * `useAction` invalidates every mounted query on a successful write, which
   * covers a person pressing Pause. It does NOT cover the two paths that stop a
   * session without one: the heartbeat's reconcile-pause, which
   * `TimerControl` calls straight on the repository, and a pause performed on
   * ANOTHER device. Both leave this pill holding a session the engine has
   * already closed — and because it ticks from `startedAtRealMs`, it does not
   * merely show a stale figure, it keeps counting up. That is the top bar
   * reading 00:02:49 while the task page reads "Paused · 00:01:56".
   *
   * The task page solved this with a live listener per session. This is one
   * pill over whichever task is running, so it re-asks instead — cheaply, and
   * far inside the staleness window, so the pill can be briefly behind but
   * never indefinitely wrong.
   */
  const refetch = active.refetch;
  useEffect(() => {
    const id = setInterval(() => refetch(), ACTIVE_PILL_REFRESH_MS);
    /* Coming back to a backgrounded tab, whose timers were clamped while it
       was away — the moment the figure is most likely to be stale. */
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);

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
