import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addWallClockDuration,
  cascadeShifts,
  type AddDuration,
  type CascadeQueueEntry,
} from "./priorityCascade.ts";

/**
 * A priority change moves the deadlines of what it displaces — and nothing else.
 *
 * The bug these replace: the cascade computed an absolute finish estimate and
 * refused to pull a date earlier, so any queue with slack never moved at all
 * while the acknowledgement still announced that deadlines had.
 */

const H = 3600;
const T0 = "2026-07-25T10:00:00.000Z";
const at = (hours: number) =>
  new Date(Date.parse(T0) + hours * H * 1000).toISOString();

const entry = (
  taskId: string,
  previousRank: number,
  newRank: number,
  remainingSecs: number,
  dueAt: string | null,
): CascadeQueueEntry => ({ taskId, previousRank, newRank, remainingSecs, dueAt });

const run = (entries: CascadeQueueEntry[], addDuration: AddDuration = addWallClockDuration) =>
  cascadeShifts({ entries, addDuration });

/* ── 1 · the brief's example ──────────────────────────────────────────────── */

test("promoting a four-hour task above two shifts both four hours later", () => {
  const shifts = run([
    entry("new", 3, 1, 4 * H, at(60)),
    entry("a", 1, 2, 6 * H, at(30)),
    entry("b", 2, 3, 5 * H, at(52)),
  ]);
  assert.deepEqual(
    shifts.map((s) => [s.taskId, s.shiftedBySecs]),
    [
      ["a", 4 * H],
      ["b", 4 * H],
    ],
  );
  assert.equal(shifts[0].newDueAt, at(34));
  assert.equal(shifts[1].newDueAt, at(56));
});

/* ── 2 · slack must not suppress the cascade ──────────────────────────────── */

test("the cascade fires however much slack the deadlines carry", () => {
  /* THE REGRESSION. With due dates weeks out, the old absolute estimate was
     always earlier than the commitment, so `max(computed, existing)` kept every
     date exactly where it was and nothing ever moved. */
  const shifts = run([
    entry("new", 2, 1, 4 * H, at(24 * 30)),
    entry("a", 1, 2, 6 * H, at(24 * 40)),
  ]);
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].shiftedBySecs, 4 * H);
  assert.equal(shifts[0].newDueAt, at(24 * 40 + 4));
});

/* ── 4 · only what was displaced ──────────────────────────────────────────── */

test("a task nothing was inserted ahead of does not move", () => {
  /* `c` sits below the reorder entirely: the same work is ahead of it after as
     before, so it pays nothing. */
  const shifts = run([
    entry("new", 2, 1, 4 * H, at(10)),
    entry("a", 1, 2, 6 * H, at(30)),
    entry("c", 3, 3, 2 * H, at(80)),
  ]);
  assert.deepEqual(shifts.map((s) => s.taskId), ["a"]);
});

test("a task that merely shuffled behind unchanged work is unaffected", () => {
  /* Reordering two tasks that are both already below everything else inserts
     nothing new ahead of the lower one. */
  const shifts = run([
    entry("top", 1, 1, 3 * H, at(20)),
    entry("x", 3, 2, 1 * H, at(40)),
    entry("y", 2, 3, 1 * H, at(50)),
  ]);
  assert.deepEqual(
    shifts.map((s) => [s.taskId, s.shiftedBySecs]),
    [["y", 1 * H]],
    "only y has new work (x) ahead of it",
  );
});

/* ── 5 · demotions and no-ops ─────────────────────────────────────────────── */

test("a no-op reorder moves nothing", () => {
  const shifts = run([
    entry("a", 1, 1, 6 * H, at(30)),
    entry("b", 2, 2, 5 * H, at(52)),
  ]);
  assert.deepEqual(shifts, []);
});

test("tasks promoted by somebody else's demotion do not extend", () => {
  /* `x` is demoted from top to bottom. `a` and `b` move UP, so nothing is
     newly ahead of them — they must not gain time. */
  const shifts = run([
    entry("a", 2, 1, 6 * H, at(30)),
    entry("b", 3, 2, 5 * H, at(52)),
    entry("x", 1, 3, 4 * H, at(20)),
  ]);
  assert.deepEqual(
    shifts.map((s) => s.taskId),
    ["x"],
    "only the demoted task pays, because only it has new work ahead of it",
  );
  assert.equal(shifts[0].shiftedBySecs, 11 * H, "a + b now precede it");
});

/* ── 6 · the reported count is the persisted count ────────────────────────── */

test("undated tasks are absent, not present-and-unchanged", () => {
  /* The acknowledgement counts this array. An entry that did not move would
     inflate "N deadlines moved" over a list that changed nothing. */
  const shifts = run([
    entry("new", 2, 1, 4 * H, at(10)),
    entry("undated", 1, 2, 6 * H, null),
  ]);
  assert.deepEqual(shifts, []);
});

test("zero-length work ahead produces no shift", () => {
  const shifts = run([
    entry("new", 2, 1, 0, at(10)),
    entry("a", 1, 2, 6 * H, at(30)),
  ]);
  assert.deepEqual(shifts, []);
});

test("every returned shift moves strictly forward", () => {
  const shifts = run([
    entry("new", 3, 1, 4 * H, at(60)),
    entry("a", 1, 2, 6 * H, at(30)),
    entry("b", 2, 3, 5 * H, at(52)),
  ]);
  for (const s of shifts)
    assert.ok(
      Date.parse(s.newDueAt) > Date.parse(s.previousDueAt),
      `${s.taskId} must move forward`,
    );
});

/* ── 7 · the calendar seam ────────────────────────────────────────────────── */

test("duration addition is injected, so office hours drop in unchanged", () => {
  /* Checkpoint 3 passes `addWorkingDuration` here. The rule below must not
     change — which is what this asserts by swapping in a calendar that skips
     a fixed twelve hours of non-working time per addition. */
  const skipsOvernight: AddDuration = (from, secs) =>
    new Date(Date.parse(from) + (secs + 12 * H) * 1000).toISOString();

  const shifts = run(
    [
      entry("new", 2, 1, 4 * H, at(10)),
      entry("a", 1, 2, 6 * H, at(30)),
    ],
    skipsOvernight,
  );
  assert.equal(shifts.length, 1);
  assert.equal(
    shifts[0].shiftedBySecs,
    4 * H,
    "the displacement is the work inserted, whatever the calendar does with it",
  );
  assert.equal(
    shifts[0].newDueAt,
    at(30 + 4 + 12),
    "the calendar decides where that lands",
  );
});
