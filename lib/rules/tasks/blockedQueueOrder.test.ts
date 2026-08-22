import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { activeQueuePositions, type QueueEntry } from "./activeQueue.ts";
import { isActiveWorkload, type QueueCandidate } from "./priorityQueue.ts";
import { hasStartableOutput } from "./outputs.ts";

/**
 * Work that cannot be started sorts below work that can, and nothing else moves.
 *
 * OWNER RULE: a task blocked on somebody else's output must not hold P1. The
 * task below it becomes P1 and the blocked one becomes P2, until its input
 * lands — at which point it takes P1 back on its own, because its STORED rank
 * was never touched.
 */

const RAKESH = [
  /* Stored P1, but its only output waits on Umang's design. */
  { taskId: "development", status: "in_progress", storedRank: 1, isWorkable: false },
  { taskId: "testing", status: "in_progress", storedRank: 2 },
  { taskId: "deployment", status: "in_progress", storedRank: 3 },
] as (QueueEntry & QueueCandidate)[];

test("a blocked P1 hands the top spot to the task below it", () => {
  const p = activeQueuePositions(RAKESH);
  assert.equal(p.get("testing"), 1, "the next task becomes P1");
  assert.equal(p.get("development"), 2, "the blocked one becomes P2");
  assert.equal(p.get("deployment"), 3);
});

test("it stays IN the queue — blocked is not removed", () => {
  /**
   * Dropping it out entirely was the first attempt and it was wrong: the work
   * is still committed to and still owned. It is numbered like anything else,
   * one place lower.
   */
  assert.equal(
    isActiveWorkload({
      taskId: "development",
      status: "in_progress",
      storedRank: 1,
      budgetState: "ACCEPTED",
      accepted: true,
      isWorkable: false,
    }),
    true,
  );
  assert.equal(activeQueuePositions(RAKESH).size, 3);
});

test("the input landing puts it straight back at P1", () => {
  /* Nothing is restored and nobody re-ranks it. The stored rank was 1 the whole
     time, so removing the sort key returns it to where its manager put it. */
  const released = RAKESH.map((t) =>
    t.taskId === "development" ? { ...t, isWorkable: true } : t,
  );
  const p = activeQueuePositions(released);
  assert.equal(p.get("development"), 1);
  assert.equal(p.get("testing"), 2);
});

test("with several blocked at the top, the first workable one still takes P1", () => {
  /**
   * The flaw in the first attempt: a pass that swapped each blocked task down
   * one place left `a` holding P1, because `b` below it was blocked too. The
   * rule is about the TOP of the queue — whatever can be started leads.
   */
  const p = activeQueuePositions([
    { taskId: "a", status: "in_progress", storedRank: 1, isWorkable: false },
    { taskId: "b", status: "in_progress", storedRank: 2, isWorkable: false },
    { taskId: "c", status: "in_progress", storedRank: 3 },
  ] as (QueueEntry & QueueCandidate)[]);
  assert.equal(p.get("c"), 1, "the workable task leads");
  assert.equal(p.get("a"), 2, "the blocked ones keep their order below it");
  assert.equal(p.get("b"), 3);
});

test("a queue with no outputs anywhere is ordered exactly as before", () => {
  /**
   * The guarantee that matters most: every task in the product predates
   * outputs, so `isWorkable` is undefined on all of them and this key must be
   * completely inert. Stored rank decides, as it always has.
   */
  const p = activeQueuePositions([
    { taskId: "x", status: "in_progress", storedRank: 2 },
    { taskId: "y", status: "in_progress", storedRank: 1 },
    { taskId: "z", status: "in_progress", storedRank: 3 },
  ] as (QueueEntry & QueueCandidate)[]);
  assert.equal(p.get("y"), 1);
  assert.equal(p.get("x"), 2);
  assert.equal(p.get("z"), 3);
});

test("every task blocked leaves the order unchanged among them", () => {
  /* Nobody can start anything, so there is no better answer than their stored
     order — and inventing one would be noise. */
  const p = activeQueuePositions([
    { taskId: "a", status: "in_progress", storedRank: 1, isWorkable: false },
    { taskId: "b", status: "in_progress", storedRank: 2, isWorkable: false },
  ] as (QueueEntry & QueueCandidate)[]);
  assert.equal(p.get("a"), 1);
  assert.equal(p.get("b"), 2);
});

/* ── The two questions, kept apart ─────────────────────────────────────────── */

test("a task whose only released output is with a reviewer is NOT startable", () => {
  /**
   * The reported bug. Development had Gopalpur released and already submitted,
   * and Puri still waiting. Its inputs were satisfied, so the looser question —
   * "has any output's input landed?" — said yes and kept it at P1, while the
   * row beside it read "Waiting on Puri pg".
   *
   * The queue and the timer need the stricter one: is there anything left to
   * DO. An output sitting with a reviewer is not it.
   */
  assert.equal(
    hasStartableOutput({
      outputs: [
        { id: "gopalpur", needsOutputIds: [] },
        { id: "puri", needsOutputIds: ["puri-content"] },
      ],
      approvedOutputIds: new Set<string>(),
      stateOf: (id) => (id === "gopalpur" ? "in_review" : "not_started"),
    }),
    false,
  );
});

test("but it IS startable while that output is still to be written", () => {
  assert.equal(
    hasStartableOutput({
      outputs: [
        { id: "gopalpur", needsOutputIds: [] },
        { id: "puri", needsOutputIds: ["puri-content"] },
      ],
      approvedOutputIds: new Set<string>(),
      stateOf: () => "not_started",
    }),
    true,
  );
});

test("a returned output is startable again", () => {
  assert.equal(
    hasStartableOutput({
      outputs: [{ id: "gopalpur", needsOutputIds: [] }],
      approvedOutputIds: new Set<string>(),
      stateOf: () => "rework",
    }),
    true,
  );
});

test("a task with no outputs is startable — every task that predates them", () => {
  assert.equal(
    hasStartableOutput({
      outputs: [],
      approvedOutputIds: new Set<string>(),
      stateOf: () => "not_started",
    }),
    true,
  );
});

/* ── Every queue that a person READS applies the rule ─────────────────────── */

/**
 * The rule above is only as good as the number of places that ask for it.
 *
 * `isWorkable` is optional on `QueueCandidate` — deliberately, so that every
 * task predating outputs is inert — and optionality is silent. A queue builder
 * that simply never sets it gets the old behaviour with no type error and no
 * failing test, which is how `#activeQueueOf` shipped without it: the assignee's
 * own list demoted a blocked P1 while every screen showing that same queue to
 * their manager still read P1.
 *
 * So the builders are pinned by name. Two of them feed a DISPLAY and must
 * supply it; the other two decide STORED rank and must not — `workableFirst`
 * writes nothing, and persisting a demotion would lose the rank the manager set
 * and never give it back when the input landed.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function methodBody(src: string, name: string): string {
  const start = src.indexOf(`async ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\n  async ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

const REPO = "lib/repositories/legacy/index.ts";

test("another person's queue is workability-aware, like their own", () => {
  const fn = methodBody(code(REPO), "#activeQueueOf");
  assert.notEqual(fn, "", "#activeQueueOf not found — has it been renamed?");
  assert.match(fn, /isWorkable: taskIsWorkable\(/);
});

test("the normaliser does NOT — it writes stored ranks", () => {
  /**
   * `workableFirst` is a reordering of what is SHOWN. The stored rank is left
   * alone precisely so the task returns to its own position the moment its
   * input is approved, with nobody restoring anything. A normaliser that
   * persisted the demotion would make that impossible.
   */
  const src = code(REPO);
  const fn = src.slice(src.indexOf("normalizePriorityQueue("));
  assert.doesNotMatch(fn.slice(0, 1200), /isWorkable/);
});

test("the queue, the timer and the label share one definition", () => {
  /* Three readers derived this separately once, and two of them disagreeing is
     what put a P1 badge beside "Waiting on Puri pg". */
  const src = code(REPO);
  assert.equal(
    (src.match(/hasStartableOutput\(\{/g) ?? []).length,
    1,
    "hasStartableOutput should be called in exactly one place — taskIsWorkable",
  );
  assert.equal((src.match(/taskIsWorkable\(/g) ?? []).length, 4);
});

/* ── The deadline follows, without a rule of its own ──────────────────────── */

/**
 * **The feature swaps priority. That is the whole of it.**
 * OWNER RULE, 21 Aug 2026.
 *
 * Every date stays the engine's: anchors from `resolveAcceptanceAnchor`, dates
 * walked through the office calendar, chaining by `rechainQueueFor`. A blocked
 * task drops to P2 and the ordinary chain anchors it after the task that
 * overtook it — which IS the clock stopping while its input is unavailable.
 *
 * An earlier version pushed the blocked deadline out directly and gave it back
 * on approval. It computed the same answer twice, from two anchors, and they
 * disagreed the moment either moved: the chain kept re-deriving a blocked task
 * from its original anchor and discarding the compensation the push had just
 * paid. These tests exist to stop that second mechanism growing back.
 */

test("the sync tells the engine the derived order — and writes no rank", () => {
  /**
   * `workableFirst` reorders for DISPLAY without touching a stored rank, so
   * nothing engine-side knows the order changed until it is told. That telling
   * is the only thing this method does.
   */
  const fn = methodBody(code(REPO), "#syncQueueDeadlines");
  assert.notEqual(fn, "", "#syncQueueDeadlines not found — renamed?");
  assert.match(fn, /effectiveP1TaskId: order\[0\]\?\.\[0\]/);
  assert.doesNotMatch(fn, /assigneePriorities|priority-order|setPriority/);
});

test("it carries no deadline arithmetic of its own", () => {
  /* The whole point of the rewrite: no dates are computed here, only asked
     for. If arithmetic reappears in this method, the two-mechanism problem is
     back. */
  const fn = methodBody(code(REPO), "#syncQueueDeadlines");
  assert.doesNotMatch(fn, /dueDate|deadline(?!s)|addWorkingSecs|3600|Date\.parse/i);
});

test("no blocked-deadline push survives anywhere in the repository", () => {
  /* The mechanism that was removed, pinned by absence so it cannot creep back
     in under another name. */
  const src = code(REPO);
  assert.doesNotMatch(src, /blocked_on_input/);
  assert.doesNotMatch(src, /checkPriorityConflict/);
});

test("a queue with no outputs and nothing blocked is never touched", () => {
  /* Every queue in the product today. It must not even cost a round trip. */
  const fn = methodBody(code(REPO), "#syncQueueDeadlines");
  assert.match(
    fn,
    /if \(!entries\.some\(\(e\) => e\.isWorkable === false \|\| e\.hasOutputs\)\) return;/,
  );
});

test("it can never cost somebody their task list", () => {
  /* Not awaited, and it swallows its own failures — a stale date is a thing to
     fix on the next load. */
  const src = code(REPO);
  assert.match(src, /void this\.#syncQueueDeadlines\(/);
  assert.match(methodBody(src, "#syncQueueDeadlines"), /catch \{/);
});
