import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RANK,
  MIN_RANK,
  UNRANKED,
  formatRank,
  isRealRank,
  rankFor,
  rankTitle,
  formatRankDisplay,
} from "./priorityDisplay.ts";
import type { TaskView } from "../../repositories/types.ts";

/**
 * What priority a task shows, and to whom.
 *
 * **The reported bug.** Six surfaces rendered `P{view.myRank ?? "—"}` inline.
 * `myRank` is the VIEWER's own rank and is null for anybody who is not an
 * assignee, so a manager looking at work they had assigned saw `P—` on every
 * task — while the rank sat in the document the whole time. Two of those call
 * sites produced the literal string `"P—"`, a priority level that does not
 * exist and reads as data rather than as absence.
 */

function view(input: {
  myRank?: number | null;
  myStoredRank?: number | null;
  ranks?: number[];
  /* Defaulted to a live status. A rank now reads differently once the task has
     left the queue, so a fixture without one was silently exercising the
     closed-task branch. */
  status?: string;
}): TaskView {
  return {
    task: { id: "t-1", status: input.status ?? "in_progress" },
    myRank: input.myRank ?? null,
    myStoredRank: input.myStoredRank ?? null,
    assignments: (input.ranks ?? []).map((rank, i) => ({
      employeeId: `e-${i}`,
      rank,
    })),
  } as unknown as TaskView;
}

/* ── The scale ────────────────────────────────────────────────────────────── */

test("the scale is legacy's 1..10, not a low/medium/high enum", () => {
  /* `taskForward.service.js:224` defaults `priority = 5`, and
     `handleUpdatePriority` clamps to `Math.max(1, Math.min(10, …))`. */
  assert.equal(MIN_RANK, 1);
  assert.equal(MAX_RANK, 10);
  assert.equal(isRealRank(1), true);
  assert.equal(isRealRank(10), true);
});

test("0 and 999 are not ranks somebody set", () => {
  /* The mapper used to fall back to 0, which rendered "P0" — reading as the
     highest possible priority rather than as an absent one. 999 is legacy's own
     unranked sentinel from `assigneePriorities[me] ?? priority ?? 999`. */
  assert.equal(isRealRank(0), false);
  assert.equal(isRealRank(UNRANKED), false);
  assert.equal(isRealRank(11), false);
  assert.equal(isRealRank(-1), false);
  assert.equal(isRealRank(null), false);
  assert.equal(isRealRank(undefined), false);
  assert.equal(isRealRank(Number.NaN), false);
});

/* ── Whose rank is shown ──────────────────────────────────────────────────── */

test("an assignee sees their OWN rank", () => {
  const d = rankFor(view({ myRank: 2, ranks: [2, 7] }), "e-0");
  assert.equal(d.rank, 2);
  assert.equal(d.isMine, true);
});

test("a manager who is not an assignee sees the TASK's rank, not a dash", () => {
  /* The bug. `myRank` is correctly null — it is not their queue — but the task
     plainly carries a priority, and withholding it showed `P—` on every task a
     manager had assigned. */
  const d = rankFor(view({ myRank: null, ranks: [3] }), "manager-1");
  assert.equal(d.rank, 3);
  assert.equal(d.isMine, false, "and the label must not call it theirs");
});

test("where assignees disagree, the most urgent is reported", () => {
  /* Legacy allows a per-person rank, so two assignees can hold different ones.
     The lowest number is the highest priority, and it is the honest summary of
     how urgent the task is to the people carrying it. */
  assert.equal(rankFor(view({ ranks: [8, 2, 5] }), "manager-1").rank, 2);
});

test("an unranked task reports nothing rather than inventing a level", () => {
  assert.equal(rankFor(view({ myRank: null, ranks: [] }), "x").rank, null);
  /* Sentinels in the document must not leak through as levels. */
  assert.equal(rankFor(view({ ranks: [UNRANKED] }), "x").rank, null);
  assert.equal(rankFor(view({ ranks: [0] }), "x").rank, null);
});

test("a null viewer falls through to the task's rank", () => {
  /* The viewer resolves asynchronously; a task's priority should not blink to a
     dash while it does. */
  assert.equal(rankFor(view({ myRank: 4, ranks: [4] }), null).rank, 4);
});

test("a nonsense myRank does not win over a real assignment rank", () => {
  assert.equal(rankFor(view({ myRank: 0, ranks: [6] }), "e-0").rank, 6);
});

/* ── Rendering ────────────────────────────────────────────────────────────── */

test("a rank renders as P<n>, and no rank as a dash", () => {
  assert.equal(formatRank(1), "P1");
  assert.equal(formatRank(3), "P3");
  assert.equal(formatRank(10), "P10");
  assert.equal(formatRank(null), "—");
});

test('"P—" can no longer be produced', () => {
  /* The exact string the old inline render emitted. It is a priority level that
     does not exist. */
  for (const rank of [null, 0, UNRANKED, 3]) {
    const out = formatRank(isRealRank(rank) ? rank : null);
    assert.notEqual(out, "P—");
    assert.ok(out === "—" || /^P\d+$/.test(out), `bad render: ${out}`);
  }
});

test("the tooltip says whose rank it is", () => {
  /* A manager told "your priority" about a report's rank comes to believe their
     own day is ordered by somebody else's queue. */
  assert.match(rankTitle({ rank: 2, isMine: true, isHistoric: false }), /Your priority/);
  assert.match(rankTitle({ rank: 2, isMine: false, isHistoric: false }), /assignee's priority/);
  assert.match(rankTitle({ rank: null, isMine: false, isHistoric: false }), /No priority/);
});

/* ── Live position against closed record ─────────────────────────────────── */

test("a closed task says it WAS a priority, not that it is one", () => {
  /* The whole point of compacting the queue: a finished task rendering the same
     chip as a live one puts two P1s on the screen. */
  const d = rankFor(
    view({ status: "completed", myStoredRank: 1, ranks: [1] }),
    "e-0",
  );
  assert.equal(d.rank, 1);
  assert.equal(d.isHistoric, true);
  assert.equal(formatRankDisplay(d), "Was P1");
  assert.match(rankTitle(d), /closed/i);
});

test("a closed task does not fall through to the stored assignment rank", () => {
  /* The bug re-entering by the back door. `myRank` is null on a finished task,
     and the manager fallback below reads `assignments[].rank` — which nothing
     rewrites on completion — so without the closed check first, a completed
     task rendered a live-looking "P1" beside the real one. */
  for (const status of ["completed", "cancelled", "assignment_rejected"]) {
    const d = rankFor(view({ status, myRank: null, ranks: [1] }), "e-0");
    assert.equal(d.isHistoric, true, `${status} rendered as a live position`);
    assert.equal(formatRankDisplay(d).startsWith("Was"), true);
  }
});

test("a live task renders a bare position", () => {
  const d = rankFor(view({ myRank: 2, ranks: [2] }), "e-0");
  assert.equal(d.isHistoric, false);
  assert.equal(formatRankDisplay(d), "P2");
});

test("a manager viewing somebody else's closed task is not told it is theirs", () => {
  const d = rankFor(view({ status: "completed", ranks: [3] }), "manager-1");
  assert.equal(d.rank, 3);
  assert.equal(d.isMine, false);
  assert.equal(d.isHistoric, true);
});

test("a closed task with no rank still shows a dash, not \"Was P—\"", () => {
  const d = rankFor(view({ status: "completed", ranks: [] }), "e-0");
  assert.equal(d.rank, null);
  assert.equal(formatRankDisplay(d), "—");
});
