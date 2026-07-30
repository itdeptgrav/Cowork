import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { elapsedSecs } from "./timer.ts";

/**
 * The timer, audited against production rather than assumed.
 *
 * The write path turned out to be sound: `startTimer` preserves the
 * accumulator, `pauseTimer` banks `total + floor((now - lastStartTime)/1000)`,
 * and a second start pauses whatever else was running. The fault was one
 * hardcoded zero on the READ path — `loggedSecs: 0` — which `TimerControl`
 * renders as `view.loggedSecs + ticked`.
 *
 * Real evidence: T634's session holds `totalSeconds: 152, isActive: false`, and
 * the task displayed no time at all.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const REPO = "lib/repositories/legacy/index.ts";
const MAP = "lib/repositories/legacy/taskMap.ts";

/* ── The zero that caused three symptoms ──────────────────────────────────── */

test("banked time is read from the session, not hardcoded", () => {
  assert.equal(/loggedSecs: 0,/.test(code(MAP)), false, "still hardcoded");
  assert.match(code(MAP), /loggedSecs: input\.loggedSecs \?\? 0/);
  assert.match(code(REPO), /totalSeconds/);
});

test("resuming continues from the banked total rather than from zero", () => {
  /* `elapsed = loggedSecs + ticked`. With T634's real 152 seconds banked, one
     second after resuming reads 00:02:33 — not 00:00:01, which is what a zero
     produced. */
  const banked = 152;
  assert.equal(banked + elapsedSecs(Date.now() - 1000, Date.now()), 153);
});

test("a paused session still reports the work already done", () => {
  /* Nothing is ticking, so the whole display is the banked figure. Zero here is
     what made a refresh look like lost time. */
  assert.equal(elapsedSecs(null, Date.now()), 0);
});

test("the assignee's time is read, not the viewer's", () => {
  /* So a manager opening the task sees the work that was done rather than their
     own empty session.

     Read from `holders`, which includes a PENDING assignee — a task at the
     cross-department gate has an empty `assigneeIds`, so this resolved to null
     and no session was read for anybody. */
  const fn = code(REPO).slice(code(REPO).indexOf("const timeSubject ="));
  assert.match(fn.slice(0, 400), /holders\.includes\(viewerId\)/);
  assert.match(fn.slice(0, 400), /holders\[0\]/);
  assert.equal(
    /legacy\.assigneeIds/.test(fn.slice(0, 400)),
    false,
    "the timer subject is blind to a pending assignee again",
  );
});

test("a failed timer read does not fail the task", () => {
  const fn = code(REPO).slice(code(REPO).indexOf("const timeSubject ="));
  assert.match(fn.slice(0, 900), /catch \{/);
});

/* ── Elapsed is derived from timestamps, never counted ────────────────────── */

test("elapsed comes from the start timestamp, so a throttled tab is exact", () => {
  /* The automation browser throttles timers and a sleeping laptop stops them
     entirely. Counting intervals would lose that time; subtracting timestamps
     cannot. */
  assert.equal(elapsedSecs(Date.now() - 3600_000, Date.now()), 3600);
});

test("a clock that appears to run backwards reports no negative work", () => {
  assert.equal(elapsedSecs(Date.now() + 5000, Date.now()), 0);
});

/* ── Single active timer ──────────────────────────────────────────────────── */

test("starting a second task pauses the first", () => {
  /* Enforced at the write, so it holds however the button was reached. */
  const fn = code(REPO).slice(code(REPO).indexOf("async startTimer("));
  assert.match(fn.slice(0, 1600), /getActiveTimer\(\)/);
  assert.match(fn.slice(0, 1600), /active\.taskId !== id/);
  assert.match(fn.slice(0, 1600), /pauseTimer\(active\.taskId/);
});

test("the accumulator survives a restart", () => {
  /* `startTimer` reads the existing total and writes it back, so a resume adds
     to the record rather than replacing it. */
  const fn = code(REPO).slice(code(REPO).indexOf("async startTimer("));
  assert.match(fn.slice(0, 2000), /totalSeconds: accumulated/);
});

test("pausing banks time from timestamps, not from a tick", () => {
  const fn = code(REPO).slice(code(REPO).indexOf("async pauseTimer("));
  assert.match(fn.slice(0, 1600), /lastStartTime/);
});

/* ── Permissions ──────────────────────────────────────────────────────────── */

test("only an assignee is offered the controls", () => {
  const timer = code("components/features/tasks/TimerControl.tsx");
  assert.match(timer, /view\.assignments\.some\(\(a\) => a\.employeeId === me\.data!\.id\)/);
});

test("starting is gated on presence and pausing is not", () => {
  /* Refusing a pause would strand a running clock for as long as somebody
     stayed away. */
  const start = code(REPO).slice(code(REPO).indexOf("async startTimer("));
  assert.match(start.slice(0, 1600), /presenceWriteRefusal/);
  const pause = code(REPO).slice(
    code(REPO).indexOf("async pauseTimer("),
    code(REPO).indexOf("async pauseTimer(") + 1600,
  );
  assert.equal(/presenceWriteRefusal/.test(pause), false);
});

/* ── Live observation ─────────────────────────────────────────────────────── */

test("the manager's live view reuses the existing listener pattern", () => {
  /* Legacy has no REST route for timers and no socket for them either, so
     Firestore's own listener IS the live channel — the same one the old app
     uses and the same shape as `watchDutyModes`. A second realtime system would
     be a second answer to "is this person working". */
  const src = code(REPO);
  const fn = src.slice(src.indexOf("watchTimerSession("));
  assert.match(fn.slice(0, 1600), /onSnapshot\(/);
  assert.match(fn.slice(0, 1600), /return \(\) => \{/);
  assert.match(fn.slice(0, 1600), /if \(unsub\) unsub\(\)/);
});

test("the watcher observes and never writes", () => {
  /* A manager watching must not be able to move the clock. */
  const src = code(REPO);
  const fn = src.slice(
    src.indexOf("watchTimerSession("),
    src.indexOf("async getTimer("),
  );
  for (const write of ["setDoc(", "updateDoc(", "addDoc(", "deleteDoc("]) {
    assert.equal(fn.includes(write), false, `the watcher performs "${write}"`);
  }
});

test("one mapping serves both the read and the watcher", () => {
  /* Two mappings of one document is how a manager's view and an employee's come
     to disagree about whether a clock is running. */
  const src = code(REPO);
  assert.match(src, /function toTimerSession\(/);
  assert.equal(
    (src.match(/toTimerSession\(/g) ?? []).length,
    3,
    "a caller is mapping the timer document itself",
  );
});

test("a dead listener does not take the page with it", () => {
  const src = code(REPO);
  const fn = src.slice(src.indexOf("watchTimerSession("));
  assert.match(fn.slice(0, 1600), /console\.error\(/);
});

/* ── The control consumes the rules ───────────────────────────────────────── */

const CONTROL = "components/features/tasks/TimerControl.tsx";

test("the control derives its state from the rule, not from React", () => {
  /* `view.loggedSecs + ticked` had no notion of a session left running, so a
     clock started before a laptop slept reported every hour since as worked. */
  const src = code(CONTROL);
  assert.match(src, /timerDisplayState\(session, banked, nowMs\)/);
  assert.equal(
    /view\.loggedSecs \+ ticked/.test(src),
    false,
    "the old derivation is back",
  );
});

test("a stale run contributes no time to the display", () => {
  const src = code(CONTROL);
  assert.match(src, /running\s*\?\s*banked \+ ticked\s*:\s*displaySecs\(/);
});

test("the timer is coupled to presence: away stops the clock at once", () => {
  /* The bug: `running` was driven only by the session document, so a person
     going offline/break/emergency kept ticking until a Firestore round trip
     eventually paused the session. Now `away` (the immediate in-memory status)
     freezes `running` and a paused write is issued from the control itself. */
  const src = code(CONTROL);
  assert.match(src, /const away = isMine && myPresence !== "online"/);
  assert.match(src, /const running = state === "running" && !away/);
  /* And it actually pauses the session, not only the display. */
  assert.match(src, /if \(away && state === "running" && !autoPaused\.current\)/);
  assert.match(src, /void pause\(\)/);
});

test("the control watches the ASSIGNEE's session, not the viewer's", () => {
  /* `getTimer` reads the acting employee, so a manager saw their own clock —
     usually nothing — on somebody else's work. */
  const src = code(CONTROL);
  assert.match(src, /view\.assignments\[0\]\?\.employeeId/);
  assert.match(src, /useAssigneeSession\(taskId,/);
  assert.match(src, /repo\.watchTimerSession\(assigneeId, taskId,/);
});

test("the live session outranks the one-shot read", () => {
  /* Otherwise the first paint would keep winning and the view would never move. */
  assert.match(code(CONTROL), /const session = live \?\? timer\.data/);
});

test("a previous person's clock cannot linger under a new one", () => {
  /* The session is keyed by subject and compared on read, so a change of
     assignee discards the old value rather than showing it until the first
     snapshot lands. */
  const src = code(CONTROL);
  assert.match(src, /entry\.key === key \? entry\.session : null/);
});

test("the control never calls the clock during render", () => {
  /* A render-time `Date.now()` is impure and makes the same props render two
     different figures. The threshold reads `useNow`; the seconds come from the
     ticker. */
  const src = code(CONTROL);
  const renderPart = src.slice(src.indexOf("export function TimerControl("));
  assert.equal(/Date\.now\(\)/.test(renderPart), false);
  assert.match(src, /useNow\(\)/);
});

test("a stale session is offered a close, not a pause beside a wrong figure", () => {
  const src = code(CONTROL);
  assert.match(src, /state === "stale"/);
  assert.match(src, /Timer requires attention/);
});

/* ── The banked figure comes from the live session ────────────────────────── */

test("banked time is read from the session, not from the task view", () => {
  /* The reported bug. `view.loggedSecs` is fetched once with the task and does
     not move when the timer does — so pausing wrote 7 seconds to
     `cowork_task_timers` and the screen kept showing the figure from page
     load, which was zero: "Start timer · 0m" over work just banked. */
  const src = code(CONTROL);
  assert.match(src, /const banked = session\?\.accumulatedSecs \?\? view\.loggedSecs/);
  assert.equal(
    /const banked = view\.loggedSecs;/.test(src),
    false,
    "the stale figure is back",
  );
});

test("the old double-counting warning is gone, because it described the mock", () => {
  /* Legacy writes no `WorkCommit`s at all — `pauseTimer` only updates
     `totalSeconds` — so there was never anything to double-count on this path,
     and the warning is what kept the stale field in place. */
  const src = code(CONTROL);
  assert.equal(/NOT `session\.accumulatedSecs`/.test(src), false);
});

/* ── The four states, and what each may offer ─────────────────────────────── */

test("a paused timer offers Resume, never Start", () => {
  /* "Start timer" over banked time reads as though the work is gone. */
  const src = code(CONTROL);
  assert.match(src, /state === "paused"\s*\n?\s*\?\s*"Resume timer"/);
});

test("the status line is read off the state, not off a figure", () => {
  /* `elapsed > 0` agreed with the state only by accident, and disagreed
     exactly when the banked figure was stale. */
  const src = code(CONTROL);
  assert.match(src, /state === "paused" \? \(\s*\n?\s*"Paused · total worked"/);
  assert.equal(
    /\) : elapsed > 0 \? \(\s*\n?\s*"Paused"/.test(src),
    false,
    "the status line is inferring state from a number again",
  );
});

test("one format everywhere — no bare minutes beside a clock", () => {
  /* "0m", "3m" and "0:07" appeared on the same screen. */
  const src = code(CONTROL);
  assert.equal(
    /formatDuration/.test(src),
    false,
    "a coarse duration is still rendered beside a running clock",
  );
  assert.match(src, /formatTimer\(elapsed\)/);
});

test("worked time is shown even though legacy records no run breakdown", () => {
  /* The commits list is empty on every real task, so it claimed "No time
     logged yet" over hours of work. */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  assert.match(detail, /view\.loggedSecs > 0 \?/);
  assert.match(detail, /formatTimer\(view\.loggedSecs\)/);
  assert.match(detail, /running total rather than a/);
});
