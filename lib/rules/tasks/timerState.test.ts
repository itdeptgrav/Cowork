import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { elapsedSecs, TIMER_BANKABLE_GRACE_MS } from "./timer.ts";
import { STALE_AFTER_MS } from "../presence/duty.ts";

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

/**
 * One method's body, bounded by the next method rather than by a character
 * count.
 *
 * The slices here were fixed windows — `slice(0, 1600)` — which asserted "this
 * rule appears near the top of the function" when the intent was "this rule is
 * enforced in this function". Adding a guard above them pushed the real checks
 * out of the window and failed a test about code that had not changed. Bounding
 * on the next `async` member cannot drift as the method grows.
 */
function methodBody(src: string, name: string): string {
  const start = src.indexOf(`async ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\n  async ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

/* ── Single active timer ──────────────────────────────────────────────────── */

test("starting a second task pauses the first", () => {
  /* Enforced at the write, so it holds however the button was reached. */
  const fn = methodBody(code(REPO), "startTimer");
  assert.match(fn, /getActiveTimer\(\)/);
  assert.match(fn, /active\.taskId !== id/);
  assert.match(fn, /pauseTimer\(active\.taskId/);
});

test("the accumulator survives a restart", () => {
  /* `startTimer` reads the existing total and writes it back, so a resume adds
     to the record rather than replacing it. */
  const fn = methodBody(code(REPO), "startTimer");
  assert.match(fn, /totalSeconds: accumulated/);
});

test("pausing banks time from timestamps, not from a tick", () => {
  const fn = methodBody(code(REPO), "pauseTimer");
  assert.match(fn, /lastStartTime/);
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
/* The keyed subscription moved out of the control when the status-tracking
   surface needed the same listener against a PERSON rather than a task's
   assignee. Two copies of a listener is two places for one to be left
   unsubscribed, so the guarantees below now hold against the hook. */
const WATCH = "lib/hooks/useTimerSession.ts";

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
  assert.match(src, /running\s*\?\s*banked \+ runSecs\s*:\s*displaySecs\(/);
});

test("the running figure is capped where the CREDIT is capped", () => {
  /**
   * **The reported fault: the clock reached 59:10 and then dropped to 50:00.**
   *
   * `ticked` is raw wall clock. The engine never pays for all of it —
   * `bankableRunSecs` stops at the last beat plus a grace, and
   * `#closeGapAndKeepRunning` banks exactly that. A backgrounded tab has its
   * beats throttled to roughly once a minute and a sleeping laptop sends none,
   * so the display and the credit drifted apart in silence until a beat landed
   * and reconciled them downwards.
   *
   * The minutes were never creditable. Showing them and taking them back is
   * the fault, so the display now stops where the credit stops.
   *
   * **Which is what this assertion did not check.** It required
   * `STALE_AFTER_MS` — 120 000, presence's constant — while both engine paths
   * bank with `TIMER_BANKABLE_GRACE_MS` at fifteen minutes. So the test passed
   * while the display was capped seven times tighter than the credit, and the
   * drift it was written to prevent went on happening in the other direction:
   * the run froze at the last beat plus two minutes, then lurched whenever the
   * engine reconciled. Capped where the CREDIT is capped means the constant the
   * credit uses.
   */
  const src = code(CONTROL);
  assert.match(src, /const runSecs =/);
  assert.match(src, /bankableRunSecs\(\{/);
  assert.match(src, /heartbeatAtRealMs: session\?\.heartbeatAtRealMs \?\? null/);
  assert.match(src, /graceMs: TIMER_BANKABLE_GRACE_MS/);
  assert.equal(
    /graceMs: STALE_AFTER_MS/.test(src),
    false,
    "presence's staleness constant is back on the credit path",
  );
  /* Derived from the ticker, never from the clock: reading `Date.now()` during
     a render makes the same props produce two different figures, which is what
     the assertion further down this file exists to prevent. */
  assert.match(src, /nowRealMs: runOrigin \+ ticked \* 1000/);
});

test("the two sides of a task cannot show different clocks", () => {
  /**
   * `getTimer` reads the ACTING employee's session — the viewer's own. For the
   * assignee that is the same document the listener watches. For the manager
   * who created the task it is a different document entirely, so falling back
   * to it showed them THEIR clock on somebody else's work: 40 minutes on one
   * screen and 20 on the other, for one running timer.
   */
  const src = code(CONTROL);
  assert.match(src, /const viewerIsAssignee =/);
  /* The one-shot read is still gated on being the SAME document — a manager
     must never see their own clock on somebody else's work — and the last live
     snapshot now sits in front of it, so a refetch cannot flick the display
     back to a stale state. Both facts pinned. */
  assert.match(
    src,
    /live \?\? remembered \?\? \(viewerIsAssignee \? timer\.data : null\)/,
  );
});

test("the timer is coupled to presence: away stops the clock at once", () => {
  /* The bug: `running` was driven only by the session document, so a person
     going offline/break/emergency kept ticking until a Firestore round trip
     eventually paused the session. Now `away` (the immediate in-memory status)
     freezes `running` and a paused write is issued from the control itself. */
  const src = code(CONTROL);
  assert.match(src, /const away = isMine && hydrated && myPresence !== "online"/);
  /* The engine's own answer, which the auto-pause and the heartbeat read. It
     carries the `!away` coupling that used to sit on `running`. */
  assert.match(src, /const serverRunning = state === "running" && !away/);
  /* `running` gained an optimistic override so the button answers a press
     without waiting for the write. Presence must still outrank it: `away` is a
     rule, not a pending request, so it is tested FIRST and short-circuits to
     false before the override is ever consulted. */
  assert.match(src, /const running = away\s*\n?\s*\? false/);
  /* And it actually pauses the session, not only the display. */
  assert.match(src, /if \(away && state === "running" && !autoPaused\.current\)/);
  assert.match(src, /void pause\(\)/);
});

test("a reload does not read as stepping away, so it cannot pause the clock", () => {
  /**
   * **The reported fault: the timer was running before the refresh and paused
   * after it, with no press behind it.**
   *
   * Nothing was lost on the client — `useTicker` derives elapsed from the
   * session's real start, so a remount picks a live run straight back up. The
   * run was being STOPPED, by this component, on the way back in.
   *
   * `away` is `myPresence !== "online"`, and the presence store initialises to
   * `offline` before it has heard from the duty document. `reconnecting` covers
   * the window after that read; nothing covered the window before it. So every
   * reload spent a few frames indistinguishable from somebody going offline,
   * the auto-pause fired, and a real session was banked and closed.
   *
   * `hydrated` is the store's own name for "this is a fact, not the initial
   * guess", and `DutySync` already refuses to publish anything without it. The
   * clock must not be stopped on weaker evidence than a dot is coloured on.
   */
  const src = code(CONTROL);
  assert.match(
    src,
    /useEmployeeStatus\(\);?/,
    "the control no longer reads presence",
  );
  assert.match(
    src,
    /const \{ status: myPresence, reconnecting, hydrated \} = useEmployeeStatus\(\)/,
    "`hydrated` is not being read, so the initial guess is trusted again",
  );
  /* Both surfaces that act on presence wait for it: the one that WRITES a pause
     and the one that replaces the control with a refusal. */
  assert.match(src, /const away = isMine && hydrated &&/);
  assert.match(src, /!hydrated \|\| reconnecting \? null : presenceRefusal\(/);
});

test("the heartbeat follows the engine, never the optimistic flip", () => {
  /* A heartbeat is a claim about a session the engine holds. Beating on the
     optimistic state fired a write for a session that did not exist yet. */
  assert.match(code(CONTROL), /if \(!serverRunning\) return;/);
});

test("a press is answered before the write lands", () => {
  /* The lag: `disabled={pending}` plus a "…" label meant the control died for
     the whole round trip — a write, then a global query invalidation — and
     people pressed twice. The press now flips the control and the write is
     reconciled behind it. */
  const src = code(CONTROL);
  /* The flip is recorded before anything is awaited. */
  assert.match(src, /setPressed\(\{\s*\n?\s*kind: wasRunning \? "paused" : "running"/);
  /* Expired by derivation against the press-time server value, so a spent
     override cannot be re-asserted by a later change in the other direction. */
  assert.match(
    src,
    /const optimistic = pressed && serverRunning === pressed\.fromServer \? pressed : null/,
  );
  /* A refusal puts the button back rather than leaving a clock apparently
     running. */
  assert.match(src, /if \(!r\.ok\) \{\s*\n?\s*setPressed\(null\);/);
  /* And the dead-button branch is gone: neither transport button — the row one
     nor the detail one — is disabled by its own write. The single remaining
     `disabled={pending}` belongs to "Close session" on the stale branch, which
     is a genuine one-shot with no optimistic state behind it. */
  const disabledByPending = (src.match(/disabled=\{pending\}/g) ?? []).length;
  assert.equal(
    disabledByPending,
    1,
    "a transport button is disabled during its own write again",
  );
  const stale = src.slice(src.indexOf('state === "stale"'));
  assert.match(stale, /disabled=\{pending\}[\s\S]{0,400}?Close session/);
  /* The ellipsis label went with it. */
  assert.equal(
    /pending\s*\n?\s*\? "…"/.test(src),
    false,
    "the toggle is showing an ellipsis instead of its result again",
  );
});

/* ── The number only ever counts up ──────────────────────────────────────── */

test("the ticker's figure is keyed to the origin it was measured against", () => {
  /* "The timer goes back and then suddenly jumps numbers forward." A bare
     `secs` survives a pause, so a resume rendered the previous run's minutes
     on top of the banked total until the next interval fired, then dropped
     back. Keyed, a figure belonging to a previous origin is rebased on the
     render that notices. */
  const src = code(CONTROL);
  assert.match(src, /originMs: startedAtRealMs,\s*\n?\s*secs: elapsedSecs\(startedAtRealMs, Date\.now\(\)\),/);
  assert.match(src, /rebaseSecs\(tick, startedAtRealMs\)/);
  assert.equal(
    /const \[secs, setSecs\] = useState/.test(src),
    false,
    "the unkeyed figure is back — a resume will carry the last run's seconds",
  );
});

test("a spent optimistic press is discarded, not left to be re-matched", () => {
  /* Expiry by comparison alone is not expiry: `serverRunning` returning to its
     press-time value re-arms the override, which then re-asserts a run whose
     origin is the original press — the clock leaps forward by everything that
     has happened since. */
  const src = code(CONTROL);
  assert.match(
    src,
    /if \(pressed && serverRunning !== pressed\.fromServer\) setPressed\(null\)/,
  );
});

test("the away figure is per-second, not measured against the coarse clock", () => {
  /* `useNow` is quantised DOWN to the minute, so a 40-second run measured 0
     against it: stepping away dropped the clock by up to a minute and banking
     the real elapsed a moment later threw it forward again. */
  const src = code(CONTROL);
  assert.match(src, /const elapsed = away\s*\n?\s*\? banked \+ runSecs/);
  assert.equal(
    /elapsedSecs\(session\?\.startedAtRealMs \?\? null, nowMs\)/.test(src),
    false,
    "the away branch is reading the minute-quantised clock again",
  );
  /* `nowMs` keeps its one honest job: a SIXTEEN HOUR threshold, where a minute
     of resolution is ample. */
  assert.match(src, /timerDisplayState\(session, banked, nowMs\)/);
});

test("the pause figure is held, never rolled back", () => {
  /* On an optimistic pause the banked total does not yet include the run being
     closed, so falling through to it makes the number jump BACKWARDS. */
  assert.match(
    code(CONTROL),
    /optimistic\?\.kind === "paused"\s*\n?\s*\? optimistic\.heldSecs/,
  );
});

test("a successful write is not followed by a duplicate refetch", () => {
  /* `useAction` calls `notifyRepositoryChanged()` on success, which re-runs
     every mounted query — including these two. The explicit calls bought a
     second round trip after the write the person was already waiting on. */
  const src = code(CONTROL);
  const toggleBody = src.slice(src.indexOf("async function toggle()"));
  assert.equal(
    /timer\.refetch\(\);\s*\n?\s*active\.refetch\(\);/.test(toggleBody),
    false,
    "toggle is refetching what the mutation already invalidated",
  );
});

test("the control watches the ASSIGNEE's session, not the viewer's", () => {
  /* `getTimer` reads the acting employee, so a manager saw their own clock —
     usually nothing — on somebody else's work. */
  const src = code(CONTROL);
  assert.match(src, /view\.assignments\[0\]\?\.employeeId/);
  assert.match(src, /useWatchedTimerSession\(assigneeId \? String\(assigneeId\) : null, taskId\)/);
  assert.match(code(WATCH), /repo\.watchTimerSession\(String\(employeeId\), String\(taskId\)/);
});

test("the live session outranks the one-shot read", () => {
  /* Otherwise the first paint would keep winning and the view would never move. */
  /* Still preferred over the one-shot read — but only where that read is the
     SAME document. See "the two sides of a task cannot show different clocks". */
  assert.match(
    code(CONTROL),
    /const session = live \?\? remembered \?\? \(viewerIsAssignee \? timer\.data : null\)/,
  );
});

test("a previous person's clock cannot linger under a new one", () => {
  /* The session is keyed by subject and compared on read, so a change of
     assignee discards the old value rather than showing it until the first
     snapshot lands. */
  assert.match(code(WATCH), /entry\.key === key \? entry\.session : null/);
});

test("the control never calls the clock during render", () => {
  /* A render-time `Date.now()` is impure and makes the same props render two
     different figures. The threshold reads `useNow`; the seconds come from the
     ticker.

     An event handler may legitimately read the clock — a press is not a render
     — so the optimistic flip stamps its origin through `pressMs()`, declared
     at module scope above the component and therefore outside this slice. That
     keeps the seam named rather than letting a bare `Date.now()` sit in the
     component body where it is indistinguishable from the bug. */
  const src = code(CONTROL);
  const renderPart = src.slice(src.indexOf("export function TimerControl("));
  assert.equal(/Date\.now\(\)/.test(renderPart), false);
  assert.match(src, /useNow\(\)/);
  /* The seam exists and is the only way a press reads the clock. */
  assert.match(src, /function pressMs\(\): number \{\s*\n?\s*return Date\.now\(\);/);
  assert.match(renderPart, /atMs: pressMs\(\)/);
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
  /* "Start timer" over banked time reads as though the work is gone.

     Reads `shownState`, which is the session document's state until a press
     overrides it — so a pressed Pause offers Resume immediately rather than
     falling back to "Start timer" for the length of the write. */
  const src = code(CONTROL);
  assert.match(src, /shownState === "paused"\s*\n?\s*\?\s*"Resume timer"/);
});

test("the status line is read off the state, not off a figure", () => {
  /* `elapsed > 0` agreed with the state only by accident, and disagreed
     exactly when the banked figure was stale. */
  const src = code(CONTROL);
  assert.match(src, /shownState === "paused" \? \(\s*\n?\s*"Paused · total worked"/);
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

test("a refetch cannot flick the clock back to a stale state", () => {
  /**
   * **The reported flicker: ON, then OFF, then ON again a second later.**
   *
   * A successful write calls `notifyRepositoryChanged()`, which re-runs every
   * mounted query including `getTimer`. While that refetch is in flight — or
   * on any frame the listener has not re-delivered — `live` is momentarily
   * null, and the display fell through to a `timer.data` still describing the
   * PREVIOUS state. The button flipped back to what it had just stopped being.
   *
   * The last live snapshot is remembered and sits in front of the one-shot
   * read, so once the listener has spoken it is never overruled.
   */
  const src = code(CONTROL);
  assert.match(src, /const lastLive = useRef</);
  assert.match(src, /if \(live\) lastLive\.current = \{ taskId, data: live \}/);
  /* Keyed by task: opening another one must not inherit this one's clock. */
  assert.match(src, /lastLive\.current\?\.taskId === taskId/);
});

test("starting a timer does not wait on the whole task view", () => {
  /**
   * `#readTaskView` builds the queue chain, the office calendar, blocked dates
   * and every sibling task. It was awaited before a byte of the session was
   * written, for one string — `taskTitle`, a label that decides nothing. On a
   * slow connection it outlasted TIMER_WRITE_TIMEOUT_MS, so Resume answered
   * "That did not reach the server in time" with the clock still off.
   */
  const src = code(REPO);
  const at = src.indexOf("async startTimer(");
  const fn = src.slice(at, at + 2000);
  assert.match(fn, /this\.#taskDoc\(id\)/, "the cheap document read is gone");
  assert.equal(
    /#readTaskView\(/.test(fn),
    false,
    "starting a timer waits on the full task view again — that is the timeout",
  );
});

test("finding what is already running does not fetch every task", () => {
  /**
   * **The second half of the Resume timeout, found after the first fix did not
   * cure it.**
   *
   * `getActiveTimer` filled one display string from
   * `listTasks({ scope: "all" })` — every task the viewer may see. `startTimer`
   * awaits `getActiveTimer()` to learn what else is running, so every press of
   * Play or Resume paid for the whole task list. `Promise.all` waits for its
   * slowest member, so batching the reads around it did not lift the floor.
   *
   * The title is written beside the session by `startTimer`, so the snapshot
   * already in hand carries it.
   */
  const src = code(REPO);
  const at = src.indexOf("async getActiveTimer(");
  const fn = src.slice(at, src.indexOf("async #taskDocuments("));
  assert.equal(
    /listTasks\(/.test(fn),
    false,
    "getActiveTimer fetches the task list again — that is the Resume timeout",
  );
  assert.match(fn, /taskTitle: session\.title/);
  assert.match(fn, /typeof data\.taskTitle === "string"/);
});

test("the stall message clears itself once the server catches up", () => {
  /**
   * **The screenshot that proved this: button reading Pause, status reading
   * Working, and "That did not reach the server in time" underneath.**
   *
   * `settledWithin` gives up at twelve seconds; the write frequently lands
   * anyway. The listener then delivers the new state and the control corrects
   * itself, but the banner was a plain boolean cleared only by the NEXT
   * successful press — so it sat under a running clock telling the person to
   * try again. Trying again pauses the timer they just started.
   *
   * The stall now remembers what the server held when we stopped waiting, and
   * the message is derived: server moved, message gone. A write that really
   * failed leaves the server where it was, so it stays.
   */
  const src = code(CONTROL);
  assert.match(src, /useState<\{ serverRunning: boolean \} \| null>\(null\)/);
  assert.match(
    src,
    /const stalledNow = stall !== null && stall\.serverRunning === serverRunning/,
  );
  assert.match(src, /setStall\(\{ serverRunning \}\)/);
  /* Still cleared outright on a press that succeeds. `\s` rather than `\n`:
     this file is checked out with CRLF endings, and an assertion that only
     matched LF failed on a line nobody had touched. */
  assert.match(src, /setStall\(null\);\s*onChange\?\.\(\)/);
  assert.equal(
    /setStalled\(/.test(src),
    false,
    "the boolean stall flag is back — it cannot expire on its own",
  );
});

/* ── Resume answering the first press ─────────────────────────────────────── */

test("a press during a write is held, not discarded", () => {
  /**
   * **Why Resume "worked after some time" while Pause felt perfect.**
   *
   * Pausing flips the display optimistically and returns at once, but its write
   * is still in flight. The obvious next press — Resume, a second later —
   * arrived while the re-entrancy guard was still held and was dropped in
   * silence: nothing moved and nothing was said. The timer started only when
   * the person pressed a SECOND time, by which point the guard had cleared.
   *
   * The guard still stands (two overlapping writes could interleave a start and
   * a pause on one session). The press is now remembered and run when the way
   * is clear.
   */
  const src = code(CONTROL);
  const at = src.indexOf("async function toggle()");
  const fn = src.slice(at, src.indexOf("if (block && startable)"));
  assert.match(fn, /if \(inFlight\.current\) \{\s*queued\.current = true;\s*return;\s*\}/);
  assert.equal(
    /if \(inFlight\.current\) return;/.test(fn),
    false,
    "the press is dropped in silence again",
  );
});

test("the held press runs against fresh state, not the closure that queued it", () => {
  /* Calling `toggle()` from the `finally` would use the render that STARTED the
     write, which still believes the timer is in its pre-write state — a queued
     Resume would read itself as a Pause and stop the clock. */
  const src = code(CONTROL);
  assert.match(src, /setReplay\(\(n\) => n \+ 1\)/);
  assert.match(src, /if \(replay === 0\) return;\s*void toggle\(\);/);
});

test("a pause already agreed to is not asked about twice", () => {
  /* `setConfirmingPause(false)` sits AFTER the guard. A confirmed pause that
     gets held keeps the flag, so the replay passes the confirmation branch
     instead of re-opening the dialog. */
  const src = code(CONTROL);
  const at = src.indexOf("async function toggle()");
  const fn = src.slice(at, src.indexOf("if (block && startable)"));
  assert.ok(
    fn.indexOf("setConfirmingPause(false)") > fn.indexOf("queued.current = true"),
    "the confirmation is cleared before the guard — a held pause asks again",
  );
});

test("starting costs one round of reads and one write, like pausing", () => {
  /* The session document was read AFTER the batch — a whole extra round trip
     for one number, the banked total to resume from. It needs no answer from
     the other three, and `#timerSession` only builds a path. */
  const src = code(REPO);
  const at = src.indexOf("async startTimer(");
  const fn = src.slice(at, at + 3000);
  assert.match(fn, /this\.#timerSession\(employeeId, id\)\.then\(\(r\) => getDoc\(r\)\)/);
  assert.equal(
    /const existing = await getDoc\(ref\)/.test(fn),
    false,
    "the extra sequential read is back",
  );
});

/* ── The clock that jumped ────────────────────────────────────────────────── */

test("both engine paths bank with that same grace", () => {
  const src = code(REPO);
  /* Matched on the grace itself rather than on the call. The gap-closer now
     names its window — `const runWindow = { ... }` — so the restart point can
     be computed against the SAME instant it banks up to, and a pattern pinned
     to `bankableRunSecs({` stopped seeing it. Every grace the engine passes,
     wherever it passes it, still has to be the one the screen shows. */
  const graces = src.match(/graceMs: [A-Za-z_.]+/g) ?? [];
  assert.ok(graces.length >= 2, "expected pauseTimer and the gap-closer");
  for (const grace of graces) {
    assert.equal(
      grace,
      "graceMs: TIMER_BANKABLE_GRACE_MS",
      "an engine path banks with a different grace than the screen shows",
    );
  }
});

test("the two graces are deliberately different constants", () => {
  /* Guards the merge that would "tidy" them into one. They answer different
     questions: which tab owns a presence claim, versus whether somebody was
     working. `timer.ts` says so at length above the constant. */
  assert.notEqual(TIMER_BANKABLE_GRACE_MS, STALE_AFTER_MS);
  assert.ok(TIMER_BANKABLE_GRACE_MS > STALE_AFTER_MS);
});
