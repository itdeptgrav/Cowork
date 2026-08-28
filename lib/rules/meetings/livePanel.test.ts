import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The live panel's freshness, guarded at the source.
 *
 * **The reported fault: two people in the same room, one counting and one at
 * zero.** Both figures were right about the data they held and the data was
 * stale — attendance arrives with the session list, and the panel refetched it
 * only every fifteen seconds, only once it already knew a session was running.
 *
 * That last clause is what made it stick rather than merely lag. Somebody who
 * pressed Join before their snapshot contained the session had no running
 * session, so no clock started and no refetch was ever scheduled: the panel sat
 * at "not counting" for the whole meeting while the other side counted
 * normally.
 *
 * Source-read because this is a React component with LiveKit and a repository
 * behind it, neither of which `node --test` can stand up. What is asserted is
 * that the three things that made it stale cannot come back.
 */

const PANEL = "components/features/tasks/TaskMeetingPanel.tsx";
const src = readFileSync(PANEL, "utf8");

test("joining refetches immediately, not on the next tick", () => {
  const from = src.indexOf("setJoined(r.data)");
  assert.ok(from > 0, "the join handler was restructured");
  /* Generous, because the join handler now also hands the session to the
     shell — that is what lets the room outlive this page — and the block that
     does it sits between `setJoined` and the refetch. What is being pinned is
     that the refetch happens in the SAME handler rather than on a later tick,
     which a wider window still says. */
  const after = src.slice(from, from + 2000);
  assert.match(
    after,
    /sessions\.refetch\(\)/,
    "A fresh joiner's snapshot contains neither their own attendance row nor " +
      "anybody already in the room, so the figure reads zero and the reason " +
      "line blames the other person for not being somewhere they are standing.",
  );
});

test("the clock and the refetch run while THIS reader is in a meeting", () => {
  /* `openId`, not the running session. The two differ once a room can be
     abandoned: a session stays OPEN until somebody closes it, and it stops
     RUNNING the moment its last attendance row goes stale. The clock and the
     refetch are how the panel notices that transition, so gating them on the
     room still being occupied would freeze the panel at the last instant it
     was — permanently showing a meeting nobody is in. */
  assert.match(
    src,
    /* `inRoom`, not `joined`: returning from the floating window remounts the
       panel, so its own state would say nobody is in a meeting about a call
       still running in the corner. The shell's session is the authority now —
       the same guarantee, with one more way of being in the room. */
    /const watching = openId !== null \|\| inRoom !== null/,
    "the live state is gated on a running session alone — a reader who joined " +
      "before their list knew about it gets no clock and no refetch at all, " +
      "and an abandoned room is never noticed going empty",
  );
  /* And both effects hang off it, rather than off `runningId` again. */
  const effects = src.match(/if \(!watching\) return;/g) ?? [];
  assert.equal(
    effects.length,
    2,
    "expected both the tick and the refetch to wait on `watching`",
  );
});

test("the refetch is faster than the figure beside it is slow", () => {
  /* The credited figure ticks every second. A fifteen-second lag on WHO IS IN
     THE ROOM is what let two sides of one meeting disagree for a quarter of a
     minute at a time. */
  const m = src.match(/setInterval\(\(\) => refetchSessions\(\), (\d[\d_]*)\)/);
  assert.ok(m, "the attendance refetch is gone");
  const ms = Number(m![1].replace(/_/g, ""));
  assert.ok(
    ms <= 5_000,
    `attendance is re-read every ${ms}ms; at that spacing the two sides of a ` +
      `meeting can disagree for ${ms / 1000}s at a time`,
  );
});

test("the room coming up re-reads who is in it", () => {
  assert.match(
    src,
    /* It travels on the session now: the room moved into the shell, and the
       engine has no idea which page — if any — is showing it. */
    /onConnected: \(\) => refetchSessions\(\)/,
    "the room connecting is the moment the other side becomes visible to this " +
      "one; waiting out the poll there is the longest avoidable disagreement",
  );
});

test("the header states the rule that actually applies to this task", () => {
  /* The static paragraph said "the clock runs only while <one person> is in the
     room" on every task, while the live box beside it named two people on a
     cross-department one. Two sentences, one screen, different rules. */
  const from = src.indexOf("Every task has its own room");
  assert.ok(from > 0, "the introduction was rewritten");
  const para = src.slice(from, from + 800);
  /* **One rule now, so the paragraph no longer branches** — OWNER DECISION,
     17 Aug 2026, when cross-department stopped counting any two people. The
     old wording said the clock ran "whenever two people are in the room
     together — it does not matter which two", which is now false. */
  assert.match(
    para,
    /are both in the room/,
    "the introduction no longer states the rule that applies",
  );
  assert.equal(
    /it does not matter which two/.test(para),
    false,
    "the any-two-people wording is back, and it no longer matches the rule",
  );
  /* "two people in the room together", not "both sides". The cross-department
     window stopped naming anybody: the clock runs whenever any two people are
     in the room, because the sender of record is often the head who forwarded
     the task and never joins the call. */

});

/* ── The suggestion under "Your move" ─────────────────────────────────────── */

test("the meeting suggestion sits UNDER the obligation, never instead of it", () => {
  /* Somebody is on the other side of that deadline waiting for an answer.
     Replacing their request with a suggestion would make this feature cost
     them their day. */
  const detail = readFileSync("components/features/tasks/TaskDetail.tsx", "utf8");

  const label = detail.indexOf("{action.label}");
  const hint = detail.indexOf("meetFirst.text");
  assert.ok(label > 0 && hint > 0, "the next-action card was restructured");
  assert.ok(
    label < hint,
    "the meeting hint is rendered above the move somebody is waiting on",
  );

  /* And it is driven by the shared rule rather than a second opinion here. */
  assert.match(detail, /meetingFirstHint\(\{/);
  assert.match(
    detail,
    /everMet: v\.task\.meetings\.firstStartedAt !== null/,
    "the hint does not stop once a meeting has actually been held",
  );
});

/* ── The three figures, and the session list beneath them ─────────────────── */

test("the totals are read from the sessions, not from a copy that can go missing", () => {
  /* Reported: `Total 00:00:00` and `First start —` directly above two finished
     sessions worth 00:01:07 and 00:04:32. The task carries a denormalised copy
     of these three figures, written by the settlement; the sessions are the
     record. One fact with two sources eventually disagrees, and when it did,
     the reader was looking at the answer and being told there wasn't one.

     Deriving them from the list the panel already draws makes that particular
     contradiction impossible — the total is the sum of the column it sits
     above, by construction. */
  const from = src.indexOf("const summary =");
  assert.ok(from > 0, "the derived summary is gone");
  /* Widened from 900: the total now carries the note explaining why it sums
     per-task credit rather than each session's own figure. */
  const body = src.slice(from, from + 1800);

  /* **The invariant is unchanged; the expression moved.** 17 Aug 2026: the
     column now shows what each session gave THIS task, not the session's own
     `creditedSecs`, because those differ — T067 listed 00:07:05 of "counted"
     time against a budget that had grown by 00:01:57, the other two sessions
     having been credited to their attendees' own tasks. Summing
     `creditedSecs` would now contradict the very rows this guard exists to
     keep it agreeing with. */
  assert.match(
    body,
    /settled\.reduce\(\(n, s\) => n \+ creditedHere\(s\), 0\)/,
    "the total is not summed from the sessions, so it can disagree with the " +
      "rows printed underneath it",
  );
  /* And the discarded form must not come back. */
  assert.equal(
    /settled\.reduce\(\(n, s\) => n \+ s\.creditedSecs, 0\)/.test(body),
    false,
    "the total sums every session again, including ones credited elsewhere",
  );

  /* And the figures render from that, never straight from the task. */
  for (const field of ["firstStartedAt", "lastEndedAt", "totalSecs"]) {
    assert.ok(
      !new RegExp(`meetings\.${field}\s*\?`).test(
        src.slice(src.indexOf("<dl "), src.indexOf("</dl>")),
      ) && !src.includes(`formatTimer(meetings.${field})`),
      `the ${field} figure still reads the task's stored copy directly`,
    );
  }

  /* The stored copy stays as the fallback: a task card with no session list to
     hand still has to show something, and "no meetings yet" is an answer. */
  assert.match(
    body,
    /:\s*meetings;/,
    "nothing falls back to the stored totals while the sessions are loading",
  );
});

test("a session that has not settled is left out of the total", () => {
  /* `creditedSecs` is zero until a session closes, so including a running one
     would show a total that drops when it settles. The column is headed "Time
     counted for your deadline"; an unfinished meeting has not counted yet. */
  const from = src.indexOf("const settled =");
  assert.ok(from > 0, "the settled filter is gone");
  assert.match(
    src.slice(from, from + 120),
    /list\.filter\(\(s\) => s\.endedAt !== null\)/,
  );
});

test("leaving takes the room off the screen before it waits on the network", () => {
  /**
   * **Reported 17 Aug 2026: "when I click leave two/three times, then it
   * leaves — not straight after the click."**
   *
   * `setJoined(null)` sat at the END of `depart`, after two round trips. So
   * pressing Leave disconnected LiveKit but left `<LiveKitRoom>` mounted, with
   * its control bar still on screen, until both calls returned — and somebody
   * watching a room that had not gone pressed Leave again. Those presses did
   * nothing, because the re-entry guard was working; the room appeared to
   * close on the third click when it was really the first call returning.
   *
   * Same shape as the timer's held press: answer the person first, finish the
   * write behind them.
   */
  /**
   * **The guarantee is now stronger, and the mechanism moved.**
   *
   * `depart` used to clear the room and then `await leave` and `await end`
   * itself. It cannot any more: the room lives in the shell, and
   * `TaskMeetingLifecycle` runs both when the session closes — including when
   * this page is not mounted, which is exactly what the floating window
   * creates. Two callers would be two owners of one settlement, closing a
   * session twice against different clocks.
   *
   * So the departure awaits NOTHING. The room goes on the click and the
   * settlement follows from the session closing, which is the same answer to
   * the 17 Aug report arrived at more directly.
   */
  const from = src.indexOf("const depart = async (sessionId: string)");
  assert.ok(from > 0, "the departure handler was restructured");
  const body = src.slice(from, from + 2400);

  const cleared = body.indexOf("setJoined(null)");
  const closed = body.indexOf("closeMeeting()");
  assert.ok(cleared > 0, "the departure no longer clears the room");
  assert.ok(closed > 0, "the departure no longer closes the shell's session");
  assert.ok(
    cleared < closed,
    "the room is cleared after the session, so the page and the shell disagree " +
      "for a frame about whether a meeting is running",
  );
  assert.doesNotMatch(
    body,
    /await leave\(/,
    "the panel settles the session again, racing the shell that already does",
  );

  /* The re-entry guard stays: without it the button press AND the resulting
     disconnection both run the departure. */
  assert.match(body, /if \(departingRef\.current === sessionId\) return;/);

  /* And the settlement still happens — in the shell, where it survives the page
     going away. Clearing early must not skip the credit. */
  const shell = readFileSync(
    "components/features/meetings/TaskMeetingLifecycle.tsx",
    "utf8",
  );
  assert.match(shell, /await leave\(args\)/, "leaving is no longer recorded");
  assert.match(shell, /await end\(args\)/, "the session is never settled");
});
