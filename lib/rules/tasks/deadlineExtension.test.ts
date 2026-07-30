import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extensionFromAddition,
  extensionImpact,
  extensionOf,
} from "./deadlineExtension.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * What an extension adds, and what granting it moves.
 *
 * **Issue 1.** The request form asks for an absolute window and legacy's route
 * takes a total, but a person asking for an extension means "+2 hours".
 * Nothing computed the difference, so choosing "2 hours" on a task that already
 * had a two-hour window added exactly nothing — and the history honestly showed
 * 00:00:00, because that is what was sent.
 *
 * **Issue 2.** Granting it must move the tasks BEHIND it, by re-chaining the
 * queue rather than adding the same number to every date. A task that spills
 * past closing moves by a night, not by two hours.
 */

/* The shape `_dayCfg` actually reads: FULL day names, `isOff`, `inTime`,
   `outTime`. The earlier fixture used `mon`/`open`/`close`/`isOpen`, none of
   which it looks at — so it silently fell back to the built-in default and
   these tests were not exercising the schedule they declared. It matched by
   coincidence (09:30–18:30) and nothing here crossed a Saturday, which the
   default leaves OPEN. */
const SCHEDULE = {
  monday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  tuesday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  wednesday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  thursday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  friday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  saturday: { isOff: true, inTime: "09:00", outTime: "18:00" },
  sunday: { isOff: true, inTime: "09:00", outTime: "18:00" },
};
const work = (a: number, s: number) =>
  addWorkingSecs(a, s, SCHEDULE, new Set<string>(), []);

const H = 3600;
/* Thursday 30 July 2026, 09:00 IST. */
const AT_0900 = Date.parse("2026-07-30T03:30:00.000Z");

/* ── 1 · The added time ───────────────────────────────────────────────────── */

test("an extension reports what it adds, not only the new total", () => {
  /* THE BUG, stated: two hours becoming four is an addition of two, and the
     history had no way to say so. */
  const e = extensionOf({ requestedWindowSecs: 4 * H, previousWindowSecs: 2 * H });
  assert.equal(e.previousSecs, 2 * H);
  assert.equal(e.addedSecs, 2 * H);
  assert.equal(e.totalSecs, 4 * H);
  assert.equal(e.isExtension, true);
});

test("asking for the same window adds nothing, and says so", () => {
  /* The reported symptom. Not a display fault — the request really did add
     nothing, because the form asked for a total while the person meant an
     addition. */
  const e = extensionOf({ requestedWindowSecs: 2 * H, previousWindowSecs: 2 * H });
  assert.equal(e.addedSecs, 0);
  assert.equal(e.totalSecs, 2 * H);
});

test("a first proposal sets a window, it does not extend one", () => {
  /* Calling it "+4 hours" would imply a four-hour window already existed. */
  const e = extensionOf({ requestedWindowSecs: 4 * H, previousWindowSecs: 0 });
  assert.equal(e.isExtension, false);
  assert.equal(e.previousSecs, 0);
  assert.equal(e.addedSecs, 4 * H);
});

test("choosing an addition produces the total the wire wants", () => {
  /* The form's direction. Nothing else in the app adds these two together. */
  const e = extensionFromAddition({ previousWindowSecs: 2 * H, addedSecs: 2 * H });
  assert.equal(e.addedSecs, 2 * H);
  assert.equal(e.totalSecs, 4 * H);
  /* And it round-trips: what the form sends, the history reads back. */
  const read = extensionOf({
    requestedWindowSecs: e.totalSecs,
    previousWindowSecs: e.previousSecs,
  });
  assert.deepEqual(read, e);
});

test("a reduction is expressible, and cannot erase the window", () => {
  const cut = extensionFromAddition({ previousWindowSecs: 4 * H, addedSecs: -1 * H });
  assert.equal(cut.totalSecs, 3 * H);
  assert.equal(cut.addedSecs, -1 * H);
  /* Legacy refuses a zero window, and a task with none leaves the queue. */
  const wipe = extensionFromAddition({ previousWindowSecs: 2 * H, addedSecs: -9 * H });
  assert.equal(wipe.totalSecs, 1);
});

test("junk in the document does not become an extension", () => {
  const e = extensionOf({ requestedWindowSecs: null, previousWindowSecs: "x" });
  assert.deepEqual(e, {
    previousSecs: 0,
    addedSecs: 0,
    totalSecs: 0,
    isExtension: false,
  });
});

/* ── 2 · The cascade ──────────────────────────────────────────────────────── */

const QUEUE = [
  { taskId: "A", assigneeIds: ["P"], priority: 1, senderTimerWindowSecs: 2 * H },
  { taskId: "B", assigneeIds: ["P"], priority: 2, senderTimerWindowSecs: 3 * H },
  { taskId: "C", assigneeIds: ["P"], priority: 3, senderTimerWindowSecs: 3 * H },
] as never;

const impact = (newWindowSecs: number, taskId = "A") =>
  extensionImpact({
    queue: QUEUE,
    taskId,
    newWindowSecs,
    anchorMs: AT_0900,
    addWorkingSecs: work,
  });

test("granting an extension moves every task behind it", () => {
  /* A 09:00→11:00, B →14:00, C →17:00. Add two hours to A. */
  const rows = impact(4 * H);
  assert.deepEqual(
    rows.map((r) => [r.taskId, r.oldDueAt, r.newDueAt]),
    [
      ["A", "2026-07-30T05:30:00.000Z", "2026-07-30T07:30:00.000Z"], // 11:00 → 13:00
      ["B", "2026-07-30T08:30:00.000Z", "2026-07-30T10:30:00.000Z"], // 14:00 → 16:00
      ["C", "2026-07-30T11:30:00.000Z", "2026-07-31T04:30:00.000Z"], // 17:00 → 10:00 next day
    ],
  );
  assert.equal(rows.find((r) => r.isSubject)!.taskId, "A");

  /* A and B stay inside the working day and move by exactly the two hours
     added. C does not: pushed to a 16:00 start it can only take two of its
     three hours before the 18:00 close, so it finishes at 10:00 the NEXT
     morning — seventeen wall-clock hours later, not two.

     This is the whole of "do not just add +2 hours to every task". A constant
     shift would have reported C finishing at 19:00, an hour that does not
     exist in this office. */
  assert.equal(rows.find((r) => r.taskId === "A")!.movedSeconds, 2 * H);
  assert.equal(rows.find((r) => r.taskId === "B")!.movedSeconds, 2 * H);
  assert.equal(rows.find((r) => r.taskId === "C")!.movedSeconds, 17 * H);
});

test("the queue is re-chained, not shifted by a constant", () => {
  /* C's new time above lands past the 18:00 close, so with a LARGER extension
     it must move by a night rather than by the added hours. Adding the same
     number to every date would report a working evening that does not exist. */
  const rows = impact(6 * H); // A: 2h → 6h, +4h
  const c = rows.find((r) => r.taskId === "C")!;
  assert.notEqual(c.movedSeconds, 4 * H);
  assert.equal(c.newDueAt, "2026-07-31T06:30:00.000Z"); // 12:00 next day
  assert.equal(c.movedSeconds, 19 * H);
  /* The subject itself stayed inside the day and moved by exactly its added
     hours, which is why a constant shift looked right until it was not. */
  assert.equal(rows.find((r) => r.isSubject)!.movedSeconds, 4 * H);
});

test("a rejected extension changes nothing", () => {
  /* Rejection means the window is unchanged, so the impact of the window it
     still has must be all zeroes. */
  const rows = impact(2 * H); // A's existing window
  for (const r of rows) {
    assert.equal(r.movedSeconds, 0);
    assert.equal(r.newDueAt, r.oldDueAt);
  }
});

test("extending a task behind others leaves those ahead untouched", () => {
  const rows = impact(5 * H, "B"); // B: 3h → 5h
  assert.equal(rows.find((r) => r.taskId === "A")!.movedSeconds, 0);
  assert.equal(rows.find((r) => r.taskId === "A")!.newDueAt, rows.find((r) => r.taskId === "A")!.oldDueAt);
  assert.equal(rows.find((r) => r.taskId === "B")!.movedSeconds, 2 * H);
  /* C again crosses the close and lands next morning rather than moving by
     the two hours added above it. */
  assert.equal(rows.find((r) => r.taskId === "C")!.movedSeconds, 17 * H);
  assert.equal(rows.find((r) => r.taskId === "C")!.newDueAt, "2026-07-31T04:30:00.000Z");
});

test("extensions chain: each is measured from the window then in force", () => {
  /* Two grants in sequence. The second must start from the first's total, or
     the addition is measured against a window nobody has. */
  const first = extensionFromAddition({ previousWindowSecs: 2 * H, addedSecs: 2 * H });
  assert.equal(first.totalSecs, 4 * H);
  const second = extensionFromAddition({
    previousWindowSecs: first.totalSecs,
    addedSecs: 1 * H,
  });
  assert.equal(second.totalSecs, 5 * H);
  assert.equal(second.addedSecs, 1 * H);

  /* And the queue reflects the cumulative total, not the last addition. */
  const rows = impact(second.totalSecs);
  assert.equal(rows.find((r) => r.isSubject)!.movedSeconds, 3 * H);
});

test("work already logged is honoured when the queue re-chains", () => {
  /* The extension adds to the BUDGET; what gets scheduled is the remainder. */
  const worked = [
    { taskId: "A", assigneeIds: ["P"], priority: 1, senderTimerWindowSecs: 2 * H, loggedSecs: 1 * H },
    { taskId: "B", assigneeIds: ["P"], priority: 2, senderTimerWindowSecs: 3 * H },
  ] as never;
  const rows = extensionImpact({
    queue: worked,
    taskId: "A",
    newWindowSecs: 4 * H,
    anchorMs: AT_0900,
    addWorkingSecs: work,
  });
  /* A had 1h left of 2h; with a 4h budget it has 3h left — two more, not four. */
  assert.equal(rows.find((r) => r.taskId === "A")!.movedSeconds, 2 * H);
  assert.equal(rows.find((r) => r.taskId === "A")!.oldDueAt, "2026-07-30T04:30:00.000Z"); // 10:00
  assert.equal(rows.find((r) => r.taskId === "A")!.newDueAt, "2026-07-30T06:30:00.000Z"); // 12:00
});
