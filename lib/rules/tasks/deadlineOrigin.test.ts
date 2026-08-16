import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  clockStartReason,
  deadlineOrigin,
  formatWindow,
} from "./deadlineOrigin.ts";

/**
 * The reported case, 16 Aug 2026: T048 shows "Deadline 16 Aug · 16:03 IST" and
 * a 30-minute budget, and the owner asked "from which time does it take that?"
 *
 * The engine had the answer stamped all along — 15:33:21, `first_online` —
 * and nothing on screen said it.
 */

const START = "2026-08-16T10:03:21.000Z"; /* 15:33:21 IST */

test("the origin carries the instant, the window and the reason", () => {
  const o = deadlineOrigin({
    clockStartsAt: START,
    clockStartsAtSource: "first_online",
    windowSecs: 1800,
  });
  assert.equal(o?.startedAt, START);
  assert.equal(o?.windowSecs, 1800);
  assert.equal(o?.reason, "when you first came online for it");
});

test("the arithmetic it explains is the engine's own", () => {
  /* 15:33:21 + 00:30:00 = 16:03:21, which is exactly the stored deadline.
     Recomputed here only to prove the two halves match — the DATE always comes
     from the engine, never from this side. */
  const o = deadlineOrigin({
    clockStartsAt: START,
    clockStartsAtSource: "first_online",
    windowSecs: 1800,
  });
  assert.equal(
    new Date(Date.parse(o!.startedAt) + o!.windowSecs! * 1000).toISOString(),
    "2026-08-16T10:33:21.000Z",
  );
});

test("each rule is named in the words a reader can act on", () => {
  assert.equal(clockStartReason("hours_granted"), "when the hours were granted");
  assert.equal(clockStartReason("first_online"), "when you first came online for it");
  assert.equal(clockStartReason("acceptance"), "when you accepted it");
});

test("first_online is not described as acceptance", () => {
  /* The two differ exactly where it matters: sitting on an acceptance while
     online does not push the deadline later, because that wait was the
     assignee's own. Describing one as the other would explain a date somebody
     could then dispute correctly. */
  assert.notEqual(clockStartReason("first_online"), clockStartReason("acceptance"));
});

test("an unknown source leaves the reason out rather than guessing", () => {
  const o = deadlineOrigin({
    clockStartsAt: START,
    clockStartsAtSource: "something_new",
    windowSecs: 1800,
  });
  assert.equal(o?.reason, null);
  assert.equal(o?.startedAt, START, "the instant is still stated");
});

test("a task with no stamped anchor says nothing at all", () => {
  /* Null rather than a half sentence: "counted from —" explains nothing and
     reads as a fault. Tasks written before the anchor existed keep the bare
     date they have always had. */
  for (const bad of [null, "", "not a date"]) {
    assert.equal(
      deadlineOrigin({ clockStartsAt: bad, clockStartsAtSource: "first_online", windowSecs: 1800 }),
      null,
      `${JSON.stringify(bad)} produced an origin`,
    );
  }
});

test("a missing or zero window still states where the count began", () => {
  /* The instant is the half people ask about; the window is already on screen
     beside the budget. */
  const o = deadlineOrigin({ clockStartsAt: START, clockStartsAtSource: "acceptance", windowSecs: 0 });
  assert.equal(o?.windowSecs, null);
  assert.equal(o?.startedAt, START);
});

test("the window reads in the same shape as a time budget", () => {
  assert.equal(formatWindow(1800), "00:30:00");
  assert.equal(formatWindow(3683), "01:01:23");
  assert.equal(formatWindow(0), "00:00:00");
});

/* ── Where it is shown ────────────────────────────────────────────────────── */

test("the line lives in the budget history, not under the deadline", () => {
  /**
   * OWNER DECISION, 16 Aug 2026, revised the same day. It first sat under the
   * deadline and read "Counted from … — when you first came online for it +
   * 02:01:46". The owner asked for one line and nothing else, moved into the
   * history somebody opens deliberately, so the deadline stays a single clean
   * date.
   */
  const history = readFileSync(
    "components/features/tasks/BudgetHistory.tsx",
    "utf8",
  );
  assert.match(history, /Counted from/);
  assert.match(history, /countedFrom/);

  const detail = readFileSync(
    "components/features/tasks/TaskDetail.tsx",
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(
    /Counted from/.test(detail),
    false,
    "the origin line is back under the deadline — it belongs in the history",
  );
  /* And the anchor is handed to the history rather than re-read there. */
  assert.match(detail, /countedFrom=\{v\.task\.deadline\.clockStartsAt\}/);
});

test("the line carries the instant alone — no rule name, no arithmetic", () => {
  /* The rule still resolves both, and both are still tested above; the display
     deliberately shows neither. */
  const history = readFileSync(
    "components/features/tasks/BudgetHistory.tsx",
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const shown of ["origin.reason", "formatWindow", "origin.windowSecs"]) {
    assert.equal(
      history.includes(shown),
      false,
      `the history renders ${shown} — the owner asked for the date alone`,
    );
  }
  assert.match(history, /formatDateTime\(origin\.startedAt\)/);
});
