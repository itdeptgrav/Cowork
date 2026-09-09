import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  clockStartReason,
  deadlineOrigin,
  formatWindow,
  referenceTimes,
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
  /**
   * **The "one line, the instant alone" half of that decision was superseded.**
   *
   * It held while the panel showed a single instant. Once a deadline could be
   * counted from a moment that is NOT the creation — accepted, approved, hours
   * granted — one bare date could no longer answer the question a reader has,
   * because nothing on screen said which of the two it was. The owner asked for
   * both instants, with the one that counted marked.
   *
   * What did NOT change, and is what the loop above still holds: the window and
   * the rule name stay out. The panel shows instants, never arithmetic.
   */
  assert.match(history, /formatDateTime\(r\.at\)/);
});

test("a deadline pushed by the queue says so", () => {
  /**
   * OWNER DECISION, 17 Aug 2026: a task cannot start before the work queued
   * above it finishes. T059 (P2) was due 14:07 — its own 12:57 anchor plus its
   * own budget — while T057 (P1) ran until 13:23. It is now anchored at 13:23
   * and due 14:33, and the line has to explain the later start or the date
   * looks arbitrary.
   */
  assert.equal(
    clockStartReason("after_priority_work"),
    "when the higher-priority work above it finishes",
  );
  const o = deadlineOrigin({
    clockStartsAt: "2026-08-17T07:53:42.433Z",
    clockStartsAtSource: "after_priority_work",
    windowSecs: 4200,
  });
  assert.equal(o?.reason, "when the higher-priority work above it finishes");
  assert.equal(o?.windowSecs, 4200);
});

test("an unknown source still shows the date, without a reason", () => {
  /* The engine may grow another anchor rule before this file hears about it.
     A missing sentence costs an explanation; a wrong one costs trust. */
  const o = deadlineOrigin({
    clockStartsAt: "2026-08-17T07:53:42.433Z",
    clockStartsAtSource: "some_future_rule",
    windowSecs: 3600,
  });
  assert.equal(o?.reason, null);
  assert.equal(o?.startedAt, "2026-08-17T07:53:42.433Z");
});

/* ── The first task for a person ───────────────────────────────────────────── */

test("a first task says the clock waited for the person, not the task", () => {
  /* `first_online` and `first_task` differ by WHOSE wait it was, and the date on
     screen is otherwise identical — so the reason is the only thing telling the
     two apart. Falling through to null would leave the one deadline that moved
     as the one with no explanation. */
  const reason = clockStartReason("first_task");
  assert.ok(reason, "a first-task anchor has no reason on screen");
  assert.match(reason!, /nothing else open/i);
  assert.notEqual(reason, clockStartReason("first_online"));
});

test("a self-assigned task approved by a manager says so", () => {
  const reason = clockStartReason("self_approved");
  assert.ok(reason, "a self-approved anchor has no reason on screen");
  assert.match(reason!, /approved/i);
});

test("every source the engine can stamp has words", () => {
  /* The engine writes these five; any one without a reason renders a date with
     no explanation, which is the state this file exists to prevent. */
  for (const s of [
    "hours_granted",
    "first_online",
    "first_task",
    "self_approved",
    "acceptance",
    "after_priority_work",
  ]) {
    assert.ok(clockStartReason(s), `${s} has no reason`);
  }
});

test("an unknown source is still null rather than invented", () => {
  assert.equal(clockStartReason("something_else"), null);
  assert.equal(clockStartReason(null), null);
});

/* ── The two instants a reader compares ────────────────────────────────────── */

const CREATED = "2026-09-02T07:30:00.000Z"; // 1:00 PM IST
const ACCEPTED = "2026-09-02T08:00:00.000Z"; // 1:30 PM IST

test("both times are listed, and only the one that counted is marked", () => {
  /* The whole point of showing two: without the creation there is no way to
     see the anchor moved, and without the anchor the date is unexplainable.

     The second label was "Accepted" here — the moment's own name, chosen by
     whichever rule set the anchor. Two fixed labels were asked for instead;
     see "the anchor row is ALWAYS called 'Counted from'" below for why. This
     test is about which rows appear and which one is marked, and both of those
     are unchanged. */
  const rows = referenceTimes({
    createdAt: CREATED,
    clockStartsAt: ACCEPTED,
    clockStartsAtSource: "first_task",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.label, r.isReference]),
    [
      ["Created", false],
      ["Counted from", true],
    ],
  );
});

test("the earlier instant is listed first", () => {
  /* Chronological, so the reader follows the task forward to the moment that
     counted rather than reading the answer before the question. */
  const rows = referenceTimes({
    createdAt: CREATED,
    clockStartsAt: ACCEPTED,
    clockStartsAtSource: "acceptance",
  });
  assert.equal(rows[0].at, CREATED);
  assert.equal(rows[1].at, ACCEPTED);
});

test("exactly one row is ever the reference", () => {
  for (const src of [
    "first_task",
    "self_approved",
    "hours_granted",
    "first_online",
    "acceptance",
    "after_priority_work",
    null,
  ]) {
    const rows = referenceTimes({
      createdAt: CREATED,
      clockStartsAt: ACCEPTED,
      clockStartsAtSource: src,
    });
    assert.equal(
      rows.filter((r) => r.isReference).length,
      1,
      `${src} produced ${rows.filter((r) => r.isReference).length} references`,
    );
  }
});

test("an anchor at the creation is still BOTH rows, sharing one instant", () => {
  /**
   * **Reversed at the owner's request.** This asserted one row: "printing that
   * twice invites a hunt for a difference that is not there."
   *
   * What one row actually produced was worse. The panel prints the rows and
   * then the sentence "Counted from the time in bold" underneath — so a single
   * Created row left that sentence pointing at nothing, and it was reported as
   * a row whose figure had gone missing rather than as two instants that
   * agree. Asked for by name: "Created 9 Sep · 10:19 IST / Counted from 9 Sep ·
   * 10:19 IST".
   *
   * Both rows, and both carry the CREATION's timestamp — see below — so the
   * pair can never disagree by a rounding.
   */
  const rows = referenceTimes({
    createdAt: CREATED,
    clockStartsAt: CREATED,
    clockStartsAtSource: "first_online",
  });
  assert.deepEqual(
    rows.map((r) => [r.label, r.at, r.isReference]),
    [
      ["Created", CREATED, false],
      ["Counted from", CREATED, true],
    ],
  );
});

test("a second apart is the same instant written by two clocks", () => {
  /* Both rows print the CREATION's stamp, not each their own: a sub-second
     difference between two clocks is not something to make a reader compare. */
  const rows = referenceTimes({
    createdAt: CREATED,
    clockStartsAt: "2026-09-02T07:30:00.900Z",
    clockStartsAtSource: "first_online",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((r) => r.at)), new Set([CREATED]));
});

test("the anchor row is ALWAYS called 'Counted from'", () => {
  /**
   * **Reversed at the owner's request.** This asserted the opposite: that each
   * rule named its own moment, so the row read "Accepted", "Came online",
   * "Hours granted" or "Earlier work finished" depending on which rule chose
   * the anchor.
   *
   * Two fixed labels were asked for and no invented vocabulary — Created, and
   * Counted from — because a row whose name changes from task to task has to
   * be decoded before it can be read. "Earlier work finished" beside a
   * creation instant was reported as exactly that.
   *
   * The rule is still resolved and still tested: `clockStartReason` says it in
   * a sentence and `deadlineOrigin` carries it. It is simply not this label.
   */
  const labelFor = (src: string) =>
    referenceTimes({
      createdAt: CREATED,
      clockStartsAt: ACCEPTED,
      clockStartsAtSource: src,
    }).find((r) => r.isReference)!.label;

  for (const src of [
    "first_task",
    "self_approved",
    "hours_granted",
    "first_online",
    "after_priority_work",
    "something_unknown",
    null,
  ]) {
    assert.equal(labelFor(src as string), "Counted from", `source ${src} renamed the row`);
  }
});

test("an older task with no anchor still shows when it was created", () => {
  const rows = referenceTimes({
    createdAt: CREATED,
    clockStartsAt: null,
    clockStartsAtSource: null,
  });
  assert.deepEqual(rows, [{ label: "Created", at: CREATED, isReference: true }]);
});

test("nothing to say is said as nothing", () => {
  assert.deepEqual(
    referenceTimes({ createdAt: null, clockStartsAt: null, clockStartsAtSource: null }),
    [],
  );
  assert.deepEqual(
    referenceTimes({ createdAt: "not a date", clockStartsAt: "", clockStartsAtSource: null }),
    [],
  );
});

test("the panel renders the reference in bold and the other faint", () => {
  /* The rule deciding correctly is worth nothing if the panel renders both the
     same — the mark IS the answer to "which time was used". */
  const src = readFileSync("components/features/tasks/BudgetHistory.tsx", "utf8");
  assert.match(src, /referenceTimes\(/);
  assert.match(src, /r\.isReference \? "font-medium text-ink" : "text-ink-faint"/);
});
