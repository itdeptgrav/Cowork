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
  const after = src.slice(from, from + 600);
  assert.match(
    after,
    /sessions\.refetch\(\)/,
    "A fresh joiner's snapshot contains neither their own attendance row nor " +
      "anybody already in the room, so the figure reads zero and the reason " +
      "line blames the other person for not being somewhere they are standing.",
  );
});

test("the clock and the refetch run while THIS reader is in a meeting", () => {
  assert.match(
    src,
    /const watching = runningId !== null \|\| joined !== null/,
    "the live state is gated on a running session alone — a reader who joined " +
      "before their list knew about it gets no clock and no refetch at all",
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
    /onConnected=\{\(\) => refetchSessions\(\)\}/,
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
  assert.match(para, /crossDept/, "the introduction ignores which rule applies");
  assert.match(para, /both in the room/, "the cross-department wording is missing");
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
