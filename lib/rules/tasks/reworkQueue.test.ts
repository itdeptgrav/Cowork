import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { REWORK_RANKS, describeQueueShift } from "./reworkQueue.ts";
import type { ReworkQueueRow } from "@/lib/repositories";

const row = (over: Partial<ReworkQueueRow>): ReworkQueueRow => ({
  taskId: "T1" as ReworkQueueRow["taskId"],
  title: "A task",
  rank: 2,
  isRework: false,
  from: "2026-08-18T16:00:00+05:30",
  to: "2026-08-18T16:00:00+05:30",
  ...over,
});

const pushedSameDay = row({
  taskId: "T2" as ReworkQueueRow["taskId"],
  from: "2026-08-18T16:00:00+05:30",
  to: "2026-08-18T18:00:00+05:30",
});

const pushedNextDay = row({
  taskId: "T3" as ReworkQueueRow["taskId"],
  from: "2026-08-18T17:00:00+05:30",
  to: "2026-08-19T11:00:00+05:30",
});

test("a choice that moves nothing says nothing", () => {
  /**
   * The useful half. A warning on every choice is ignored by the third
   * rework; one that appears only when deadlines really move gets read — so
   * the absence of the line is itself the message.
   */
  assert.equal(describeQueueShift([]), null);
  assert.equal(describeQueueShift([row({}), row({})]), null);
});

test("the rework's own row is never counted as a casualty", () => {
  /* It has no previous deadline to be pushed from — it is the thing being
     scheduled, not something disturbed by the scheduling. */
  assert.equal(
    describeQueueShift([row({ isRework: true, from: null, to: "2026-08-18T18:00:00+05:30" })]),
    null,
  );
  /* Even if the engine did hand it a `from`. */
  assert.equal(
    describeQueueShift([
      row({ isRework: true, from: "2026-08-18T16:00:00+05:30", to: "2026-08-18T19:00:00+05:30" }),
    ]),
    null,
  );
});

test("one deadline pushed within the day is named as one", () => {
  assert.equal(describeQueueShift([pushedSameDay]), "This pushes 1 deadline out.");
});

test("several pushed within the day are counted", () => {
  const two = [
    pushedSameDay,
    row({
      taskId: "T4" as ReworkQueueRow["taskId"],
      from: "2026-08-18T15:00:00+05:30",
      to: "2026-08-18T17:30:00+05:30",
    }),
  ];
  assert.equal(describeQueueShift(two), "This pushes 2 deadlines out.");
});

test("crossing into another day is called out separately", () => {
  /**
   * The shift people actually care about. An hour later the same afternoon is
   * a nuisance; landing on tomorrow is a different promise to whoever is
   * waiting for it.
   */
  assert.equal(
    describeQueueShift([pushedNextDay]),
    "This pushes 1 deadline into another day.",
  );
  assert.equal(
    describeQueueShift([pushedSameDay, pushedNextDay]),
    "This pushes 2 deadlines out, 1 into another day.",
  );
});

test("when every pushed deadline crosses the day, it says so once", () => {
  const both = [
    pushedNextDay,
    row({
      taskId: "T5" as ReworkQueueRow["taskId"],
      from: "2026-08-18T18:00:00+05:30",
      to: "2026-08-20T10:00:00+05:30",
    }),
  ];
  assert.equal(
    describeQueueShift(both),
    "This pushes 2 deadlines out, all into another day.",
  );
});

test("a row with no previous deadline is not a push", () => {
  /* Nothing was promised, so nothing was broken. */
  assert.equal(
    describeQueueShift([row({ from: null, to: "2026-08-19T10:00:00+05:30" })]),
    null,
  );
});

test("an unreadable date does not crash the sentence", () => {
  /* It still counts as pushed — the dates differ — it just cannot be said to
     have crossed a day. */
  assert.equal(
    describeQueueShift([row({ from: "not a date", to: "also not a date" })]),
    "This pushes 1 deadline out.",
  );
});

test("the ranks offered match what the engine stores", () => {
  assert.deepEqual([...REWORK_RANKS], [1, 2, 3, 4, 5]);
});

/* ── wiring ─────────────────────────────────────────────────────────────── */

const picker = readFileSync(
  "components/features/tasks/ReworkQueuePicker.tsx",
  "utf8",
);
const panel = readFileSync("components/features/tasks/ReviewPanel.tsx", "utf8");
const code = picker.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

test("the picker asks the engine and computes no dates itself", () => {
  /* A preview that predicts something the commit does not do is worse than
     showing nothing, so every figure comes from the queue walk. */
  assert.match(
    code.replace(/\s+/g, " "),
    /repo\.reworkQueuePreview!?\(taskId, value\)/,
  );
  assert.doesNotMatch(code, /addWorkingSecs|setHours\(|\* 3600 \* 1000/);
});

test("a missing preview never blocks the rework", () => {
  /* Losing a rework because a picker could not load would be far worse than a
     queue in a slightly wrong order. A store with no queue engine behind it
     is a normal state, not an error. */
  assert.match(
    code.replace(/\s+/g, " "),
    /typeof getRepository\(\)\.reworkQueuePreview === "function"/,
  );
  assert.match(
    code.replace(/\s+/g, " "),
    /const state = loading \? "loading" : failed \? "unavailable" : "ready";/,
  );
  assert.match(picker.replace(/\s+/g, " "), /Sending this back still works/);
});

test("a stale answer cannot overwrite a newer one", () => {
  /* The picker is changed faster than the round trip completes. */
  assert.match(code, /let live = true;/);
  assert.match(code, /if \(!live\) return;/);
});

test("the reviewer's choice is sent with the rework", () => {
  assert.match(panel, /reworkPriority:/);
  assert.match(panel, /<ReworkQueuePicker/);
});

test("the priority choice is hidden, and only 'Leave as it is' is offered", () => {
  /**
   * OWNER DECISION, 18 Aug 2026. One change at a time while the deadline
   * shifting is watched on real work: if a deadline lands somewhere
   * surprising, there is no question about which rule put it there.
   *
   * Same shape as `OFFER_REJECTION` in `ReviewPanel.tsx` — the control is
   * hidden, the logic behind it is untouched.
   */
  assert.match(picker, /const OFFER_PRIORITY_CHOICE = false;/);
  /* The rank options are behind the flag, so the dropdown has one entry. */
  assert.match(
    picker.replace(/\s+/g, " "),
    /\{OFFER_PRIORITY_CHOICE && REWORK_RANKS\.map/,
  );
  assert.match(picker, /<option value="">Leave as it is<\/option>/);
  /* And nothing can arrive pre-selected at a rank that cannot be chosen. */
  assert.match(
    picker.replace(/\s+/g, " "),
    /value=\{OFFER_PRIORITY_CHOICE \? \(rank \?\? ""\) : ""\}/,
  );
});

test("nothing behind the hidden control was removed", () => {
  /* The engine still takes a priority and the preview still runs the real
     walk — turning the flag to true is the whole of switching it back on. */
  assert.match(picker, /onChange\(e\.target\.value === "" \? null : Number\(e\.target\.value\)\)/);
  assert.match(panel, /reworkPriority:/);
  assert.deepEqual([...REWORK_RANKS], [1, 2, 3, 4, 5]);
});

test("no copy on screen promises a choice that is not offered", () => {
  /* A panel headed "Where does this sit in their work?" above a dropdown with
     one option is a control that lies. */
  const bare = picker.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");
  for (const phrase of ["Where does this sit", "After your choice", "the priority you pick"]) {
    if (!bare.includes(phrase)) continue;
    const at = bare.indexOf(phrase);
    const around = bare.slice(Math.max(0, at - 160), at);
    assert.match(
      around,
      /OFFER_PRIORITY_CHOICE/,
      `"${phrase}" is shown unconditionally while the choice is hidden`,
    );
  }
});

test("the priority is only sent on a rework", () => {
  /* An approval carries none — sending one would reorder a queue on the
     strength of a decision that did not return any work. */
  assert.match(
    panel.replace(/\s+/g, " "),
    /reworkPriority: decision === "rework" \? \w+ : null/,
  );
});
