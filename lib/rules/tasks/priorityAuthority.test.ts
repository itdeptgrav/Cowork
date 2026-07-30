import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  canChangePriority,
  clampRank,
  describePriority,
  displayPriority,
  formatPriority,
  getPersonPriority,
  getTaskPriority,
  priorityChangeRefusal,
  queuePositions,
  updateTaskPriority,
  MAX_RANK,
  MIN_RANK,
} from "./priority.ts";

/**
 * The priority authority, and the four audited cases.
 *
 * The reported symptom was *"task page shows P1, task list shows P3"*. It was
 * real, and it was not a duplicated read — the reads were already centralised.
 * **One field held two different numbers on two different scales**, and which one
 * depended on which person's queue the read had happened to fetch.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const PRAMOD = "GR0067";
const RAKESH = "GR0045";
const SOUMYA = "GR0108";

/* ── Case 1 · the detail-versus-list mismatch ─────────────────────────────── */

test("1 · the same viewer reads one number on both screens", () => {
  /* THE REPORTED BUG, as the two reads actually differed.
   *
   *   list   → queue.ownerId = the VIEWER   → manager holds nothing → stored rank
   *   detail → queue.ownerId = the SUBJECT  → assignee's position   → derived
   *
   * A manager therefore saw the stored priority in the list and the assignee's
   * queue position on the detail page, both as `P{n}`. Now the stored rank is
   * always the stored rank, and a position is a separate, explicitly-owned fact.
   */
  const storedOnly = [{ employeeId: PRAMOD, rank: 3, queuePosition: null }];
  /* What the DETAIL read produces: the subject's queue was fetched. */
  const withSubjectQueue = [
    { employeeId: PRAMOD, rank: 3, queuePosition: 1 },
  ];

  const listView = displayPriority({
    status: "in_progress",
    viewerId: RAKESH,
    holders: storedOnly,
  });
  const detailView = displayPriority({
    status: "in_progress",
    viewerId: RAKESH,
    holders: withSubjectQueue,
  });

  /* The numbers may still differ — a position and a stored rank are different
     facts — but the READER is now told which is which and whose it is, and
     neither is silently labelled as the other. */
  assert.equal(listView.scale, "stored_rank");
  assert.equal(listView.rank, 3);
  assert.equal(detailView.scale, "queue_position");
  assert.equal(detailView.rank, 1);

  /* And both name the same subject, so a tooltip cannot claim the manager's own
     queue is being reported. */
  assert.equal(listView.subjectId, PRAMOD);
  assert.equal(detailView.subjectId, PRAMOD);
  assert.equal(listView.isMine, false);
  assert.equal(detailView.isMine, false);

  /* The distinction a reader can act on: one renumbers itself, one does not. */
  assert.match(describePriority(detailView, () => "Pramod"), /live queue/);
  assert.match(describePriority(listView, () => "Pramod"), /stored priority/);
});

test("1b · the stored rank can never hold a derived position again", () => {
  const map = code("lib/repositories/legacy/taskMap.ts");
  assert.match(map, /rank: resolveTaskPriority\(legacy, employeeId\)/);
  const at = map.indexOf("rank: resolveTaskPriority(legacy, employeeId)");
  assert.equal(
    /rank:[\s\S]{0,80}positions\.get/.test(map.slice(at, at + 400)),
    false,
    "the assignment rank can hold a queue position again",
  );
  /* The two facts, in two fields, named in the domain so nobody has to guess. */
  assert.match(code("lib/domain/tasks.ts"), /queuePosition: number \| null;/);
});

/* ── Case 2 · viewer-dependence ───────────────────────────────────────────── */

test("2 · the viewer never changes the number, only whose it is", () => {
  const holders = [
    { employeeId: PRAMOD, rank: 3, queuePosition: null },
    { employeeId: SOUMYA, rank: 7, queuePosition: null },
  ];
  const readings = [RAKESH, SOUMYA, "STRANGER", null].map((viewerId) =>
    displayPriority({ status: "in_progress", viewerId, holders }),
  );

  /* Everyone who does not hold it reads the same figure — the most urgent
     holder's stored rank. Only Soumya, who holds it, reads her own. */
  assert.equal(readings[0].rank, 3); // manager
  assert.equal(readings[2].rank, 3); // stranger
  assert.equal(readings[3].rank, 3); // no viewer
  assert.equal(readings[0].isMine, false);
});

test("2b · priority IS per person, and flattening it would be the bug", () => {
  /* The premise worth stating plainly: a task given to three people carries
     three ranks, because each is that person's position in their OWN day.
     Legacy stores it that way and creates one rank per assignee from that
     person's own open-task count.

     One shared number would order everybody's day by one colleague's queue —
     which is the defect the per-person map exists to prevent. */
  const holders = [
    { employeeId: PRAMOD, rank: 1, queuePosition: null },
    { employeeId: SOUMYA, rank: 9, queuePosition: null },
  ];
  const forPramod = displayPriority({
    status: "in_progress",
    viewerId: PRAMOD,
    myRank: 1,
    myStoredRank: 1,
    holders,
  });
  const forSoumya = displayPriority({
    status: "in_progress",
    viewerId: SOUMYA,
    myRank: 9,
    myStoredRank: 9,
    holders,
  });
  assert.equal(forPramod.rank, 1);
  assert.equal(forSoumya.rank, 9);
  assert.equal(forPramod.isMine, true);
  assert.equal(forSoumya.isMine, true);

  /* The task's own priority is a separate, shared question, and it does NOT
     summarise the per-person ranks — taking the minimum would report the most
     urgent holder's position as though it were the task's. */
  const shared = getTaskPriority({ status: "in_progress", priority: 5 });
  assert.equal(shared.rank, 5);
  assert.equal(shared.subjectId, null);
});

test("2c · a holder whose own reading is unusable still sees a number", () => {
  /* Legacy's read is `assigneePriorities[me] ?? priority ?? 999` — it gives up on
     nothing. Returning null for a holder with a nonsense `myRank` would show a
     dash to the one person holding the work, which is the bug this area exists
     to have fixed, reached from a new direction. I wrote that regression while
     building this and a pre-existing test caught it. */
  const d = displayPriority({
    status: "in_progress",
    viewerId: PRAMOD,
    myRank: 0, // off the scale
    holders: [{ employeeId: PRAMOD, rank: 6, queuePosition: null }],
  });
  assert.equal(d.rank, 6);
});

/* ── Case 3 · queue ordering ──────────────────────────────────────────────── */

test("3 · a P1 can never sit behind a P3", () => {
  /* Verified rather than fixed — `activeQueuePositions` already sorted by stored
     rank first. Pinned here because the audit asked, and because the whole chain
     priority → position → expected completion rests on it. */
  const positions = queuePositions([
    { taskId: "c", status: "in_progress", storedRank: 3, order: 1 },
    { taskId: "a", status: "in_progress", storedRank: 1, order: 9 },
    { taskId: "b", status: "in_progress", storedRank: 2, order: 5 },
  ]);
  assert.deepEqual([...positions.entries()], [["a", 1], ["b", 2], ["c", 3]]);
});

test("3b · closed and unsettled work holds no slot", () => {
  const positions = queuePositions([
    { taskId: "done", status: "completed", storedRank: 1 },
    { taskId: "live", status: "in_progress", storedRank: 4 },
    {
      taskId: "haggling",
      status: "assigned",
      storedRank: 2,
      budgetState: "WAITING_FOR_ASSIGNOR",
    },
  ]);
  /* The live task is first because the other two are not in the queue at all —
     a completed P1 holding slot 1 for ever is the bug the derivation replaced. */
  assert.deepEqual([...positions.entries()], [["live", 1]]);
});

test("3c · the derived position renumbers with no write", () => {
  const before = queuePositions([
    { taskId: "a", status: "in_progress", storedRank: 1 },
    { taskId: "b", status: "in_progress", storedRank: 2 },
  ]);
  assert.equal(before.get("b"), 2);
  /* `a` closes. `b`'s STORED rank is untouched — nothing was written — and its
     position moves up on the next read. */
  const after = queuePositions([
    { taskId: "a", status: "completed", storedRank: 1 },
    { taskId: "b", status: "in_progress", storedRank: 2 },
  ]);
  assert.equal(after.get("b"), 1);
});

/* ── Case 4 · the lifecycle ───────────────────────────────────────────────── */

test("4 · a closed task reports a record, never a position", () => {
  for (const status of ["completed", "cancelled", "assignment_rejected"]) {
    const d = displayPriority({
      status,
      viewerId: PRAMOD,
      myStoredRank: 2,
      /* A stale position from a read that happened while it was live. It must
         not be shown: `isHistoric` is decided by the status, not by whether a
         number is available. */
      holders: [{ employeeId: PRAMOD, rank: 2, queuePosition: 1 }],
    });
    assert.equal(d.isHistoric, true, `${status} rendered as live`);
    assert.equal(d.rank, 2, `${status} showed the stale position`);
    assert.equal(d.scale, "stored_rank");
    assert.equal(formatPriority(d), "Was P2");
  }
});

test("4b · who may change it, and when", () => {
  const live = { status: "in_progress", priority: 5 };
  const reaches = () => true;

  /* A manager may reorder a report's queue. */
  assert.equal(
    canChangePriority({
      actorId: RAKESH,
      subjectId: PRAMOD,
      actorHasManager: true,
      canReorder: reaches,
      task: live,
    }),
    true,
  );

  /* You do not order your own work — unless nobody manages you, in which case
     there is nobody else to ask. */
  assert.equal(
    canChangePriority({
      actorId: PRAMOD,
      subjectId: PRAMOD,
      actorHasManager: true,
      canReorder: reaches,
      task: live,
    }),
    false,
  );
  assert.equal(
    canChangePriority({
      actorId: "CEO",
      subjectId: "CEO",
      actorHasManager: false,
      canReorder: reaches,
      task: live,
    }),
    true,
  );

  /* Capability is necessary as well as the reporting relationship. */
  assert.equal(
    canChangePriority({
      actorId: RAKESH,
      subjectId: PRAMOD,
      actorHasManager: true,
      canReorder: () => false,
      task: live,
    }),
    false,
  );

  /* A closed task's priority is a record. Nothing may change it. */
  assert.equal(
    canChangePriority({
      actorId: RAKESH,
      subjectId: PRAMOD,
      actorHasManager: true,
      canReorder: reaches,
      task: { status: "completed", priority: 5 },
    }),
    false,
  );
});

test("4c · each refusal says which rule was hit", () => {
  const base = {
    actorId: PRAMOD,
    subjectId: PRAMOD,
    actorHasManager: true,
    canReorder: () => true,
    newRank: 2,
  };
  /* Legacy's own wording, quoted by the help corpus so the screen and the answer
     are one string. */
  assert.match(
    priorityChangeRefusal({ ...base, task: { status: "in_progress" } }) ?? "",
    /You cannot change your own priority/,
  );
  assert.match(
    priorityChangeRefusal({ ...base, task: { status: "completed" } }) ?? "",
    /a record rather than a position/,
  );
  assert.match(
    priorityChangeRefusal({
      ...base,
      actorId: RAKESH,
      canReorder: () => false,
      task: { status: "in_progress" },
    }) ?? "",
    /does not let you set the order/,
  );
  assert.equal(
    priorityChangeRefusal({
      ...base,
      actorId: RAKESH,
      task: { status: "in_progress" },
    }),
    null,
  );
});

test("4d · a change moves the whole queue, not one rank", () => {
  /* "I moved C to P1 and A is still P1": setting one rank leaves two tasks at
     rank 1, and the displayed order then falls to a tie-break that put the older
     one first — silently defeating the move. */
  assert.deepEqual(
    updateTaskPriority({ currentOrder: ["a", "b", "c"], taskId: "c", newRank: 1 }),
    ["c", "a", "b"],
  );
  /* Off-scale input is clamped rather than refused, as legacy clamps it. */
  assert.deepEqual(
    updateTaskPriority({ currentOrder: ["a", "b", "c"], taskId: "a", newRank: 99 }),
    ["b", "c", "a"],
  );
  assert.equal(clampRank(0), MIN_RANK);
  assert.equal(clampRank(50), MAX_RANK);
  assert.equal(clampRank("3"), 3);
  assert.equal(clampRank(null), MIN_RANK);
  /* A task absent from the order is inserted rather than dropped — the priority
     map and `assigneeIds` can disagree, and renumbering a queue without the moved
     task would be worse than the bug being fixed. */
  assert.deepEqual(
    updateTaskPriority({ currentOrder: ["a", "b"], taskId: "new", newRank: 2 }),
    ["a", "new", "b"],
  );
});

test("4e · the number is never invented at any lifecycle stage", () => {
  /* `0` and `999` are both absences, not positions. `Number(null)` is 0 and 0 is
     finite, so a missing entry once resolved to P0 — off the bottom of the scale
     and, being smallest, sorted AHEAD of every real priority. */
  for (const stored of [0, 999, null, undefined, ""]) {
    const d = getPersonPriority({
      task: { status: "in_progress", priority: stored },
      subjectId: PRAMOD,
    });
    assert.equal(d.rank, null, `${String(stored)} produced a rank`);
    assert.equal(d.scale, "none");
    assert.equal(formatPriority(d), "—");
  }
});

/* ── One authority ───────────────────────────────────────────────────────── */

test("every priority surface reads the one authority", () => {
  /* The display resolver is a translation now, not a second judgement. */
  const display = code("lib/rules/tasks/priorityDisplay.ts");
  assert.match(display, /displayPriority\(\{/);
  assert.equal(
    /Math\.min\(\.\.\.ranks\)/.test(display),
    false,
    "priorityDisplay decides for itself again",
  );

  /* And the mapper resolves through it, so the view it produces and the screens
     that read the view cannot disagree. */
  const map = code("lib/repositories/legacy/taskMap.ts");
  assert.match(map, /getPersonPriority\(\{/);
});

test("the authority reads the DOMAIN status, never legacy's raw field", () => {
  /* Legacy leaves `status` at `open` through an entire review cycle while
     `completionStatus` moves, so testing the raw string would keep approved work
     holding a live position for ever. The queue builder already documents the
     trap; the mapper's call has to avoid it too. */
  const map = code("lib/repositories/legacy/taskMap.ts");
  const at = map.indexOf("getPersonPriority({");
  assert.ok(at > 0);
  assert.match(
    map.slice(at, at + 300),
    /task: \{ \.\.\.legacy, status: toTaskStatus\(legacy\) \}/,
  );
});

test("the P prefix is written in one place", () => {
  /* It was inline at six call sites, two of which produced the literal `"P—"` —
     a priority level that does not exist and reads as data rather than absence. */
  assert.equal(formatPriority({ ...getTaskPriority({ status: "in_progress" }) }), "—");
  assert.equal(
    formatPriority({
      rank: 3,
      scale: "queue_position",
      subjectId: PRAMOD,
      isMine: true,
      isHistoric: false,
      storedRank: 3,
    }),
    "P3",
  );
  assert.equal(
    formatPriority({
      rank: 3,
      scale: "stored_rank",
      subjectId: PRAMOD,
      isMine: true,
      isHistoric: true,
      storedRank: 3,
    }),
    "Was P3",
  );
});
