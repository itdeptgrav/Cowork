import assert from "node:assert/strict";
import { displayPriority } from "../../rules/tasks/priority.ts";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The same task shows the same priority to everybody.
 *
 * **Pramod saw no priority on his own task.** Every read was keyed on
 * `assigneeIds`, and a cross-department task waiting at the gate has an empty
 * `assigneeIds` with its person in `pendingAssigneeId`. So `myRank` was null,
 * `myStoredRank` was null, and `assignments` — which `rankFor` falls back to —
 * had no entry for him at all. Three null answers and a dash on screen, while
 * the number sat in the document.
 *
 * These are source assertions rather than a rendered comparison: the mapper
 * needs a live Firestore document to run, and what is being pinned is the
 * shape of the reads, which is exactly where the bug lived.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const MAP = "lib/repositories/legacy/taskMap.ts";
const REPO = "lib/repositories/legacy/index.ts";

test("no priority read is keyed on assigneeIds alone", () => {
  const map = code(MAP);
  for (const gone of [
    "!legacy.assigneeIds.includes(input.viewerId)",
    "myStoredRank: legacy.assigneeIds.includes(input.viewerId)",
    "assignments: legacy.assigneeIds.map(",
  ]) {
    assert.equal(
      map.includes(gone),
      false,
      `a priority read is blind to a pending assignee again: ${gone}`,
    );
  }
});

test("holders decide, and pending counts", () => {
  const map = code(MAP);
  assert.match(map, /const holders = holdersOf\(\{/);
  assert.match(map, /pendingAssigneeIds: legacy\.pendingAssigneeId/);
  assert.match(map, /myRank: !holds\(input\.viewerId\)/);
  assert.match(map, /myStoredRank: holds\(input\.viewerId\)/);
  assert.match(map, /assignments: holders\.map\(/);
});

test("the queue subject falls back to the pending assignee", () => {
  /* `assigneeIds[0] ?? null` was null for a held task, so NO queue was fetched
     and the view fell back to stored ranks — for the one person whose queue
     the work is actually in. */
  const src = code(REPO);
  assert.match(
    src,
    /const subjectId = holders\.includes\(viewerId\)\s+\? viewerId\s+: \(holders\[0\] \?\? null\);/,
  );
  assert.equal(
    src.includes("legacy.assigneeIds.includes(viewerId)\n      ? viewerId"),
    false,
    "the subject is blind to a pending assignee again",
  );
});

/* ── One resolver ─────────────────────────────────────────────────────────── */

test("nobody re-types legacy's priority expression", () => {
  /* `assigneePriorities[me] ?? priority ?? 999` existed in four places. Four
     copies is four chances for a manager's screen and an employee's screen to
     disagree about one task. */
  for (const f of [MAP, "lib/rules/tasks/priorityDeadline.ts"]) {
    const src = code(f);
    assert.equal(
      /assigneePriorities\[\s*(employeeId|input\.viewerId)\s*\]\s*\?\?\s*legacy\.priority/.test(src),
      false,
      `${f} still has its own copy of the priority rule`,
    );
  }
  assert.match(code(MAP), /resolveTaskPriority\(legacy, employeeId\)/);
  assert.match(code(MAP), /resolveTaskPriority\(legacy, input\.viewerId\)/);
  assert.match(
    code("lib/rules/tasks/priorityDeadline.ts"),
    /return resolveTaskPriority\(task, employeeId\);/,
  );
});

test("the display resolver is shared by every surface", () => {
  /* Six surfaces once rendered `P{view.myRank ?? "—"}` independently. */
  for (const f of [
    "components/features/tasks/TaskDetail.tsx",
    "components/features/tasks/TaskTable.tsx",
    "components/features/tasks/TasksOverview.tsx",
  ]) {
    const src = code(f);
    assert.match(src, /rankFor\(/, `${f} does not use the shared resolver`);
    assert.equal(
      /P\{[^}]*myRank/.test(src),
      false,
      `${f} renders myRank inline again`,
    );
  }
});

test("a viewer cannot change the number", () => {
  /* `rankFor` takes the viewer only to decide WHOSE rank it is reporting — the
     value falls back to the stored ranks, which are the same for everybody. A
     manager and the assignee read one number.

     The judgement moved into `displayPriority`, so the assertion follows it: this
     module is a translation now, and the min-of-stored-ranks lives in the one
     place that decides. */
  const display = code("lib/rules/tasks/priorityDisplay.ts");
  assert.match(display, /displayPriority\(\{/);
  assert.match(display, /queuePosition: a\.queuePosition/);

  const authority = code("lib/rules/tasks/priority.ts");
  /* The stored-rank fallback, still picking the most urgent holder. */
  assert.match(authority, /const ranked = holders\.filter\(\(h\) => isRealRank\(h\.rank\)\)/);
  assert.match(authority, /a\.rank as number\) <= \(b\.rank as number\) \? a : b/);
  /* And the viewer changes only WHOSE it is, never the value. Asserted by
     calling it rather than by matching prose — `code()` strips comments, so a
     doc-comment assertion can never match, and asserting on the call is what
     survives a rewording. */
  const holders = [
    { employeeId: "PRAMOD", rank: 3, queuePosition: null },
    { employeeId: "SOUMYA", rank: 7, queuePosition: null },
  ];
  const asManager = displayPriority({
    status: "in_progress",
    viewerId: "RAKESH",
    holders,
  });
  const asStranger = displayPriority({
    status: "in_progress",
    viewerId: "NOBODY",
    holders,
  });
  const asNull = displayPriority({
    status: "in_progress",
    viewerId: null,
    holders,
  });
  assert.equal(asManager.rank, 3, "the most urgent holder's stored rank");
  assert.equal(asStranger.rank, 3);
  assert.equal(asNull.rank, 3);
  /* Same number for all three; only `isMine` could ever differ, and none of
     them holds it. */
  for (const d of [asManager, asStranger, asNull]) {
    assert.equal(d.isMine, false);
    assert.equal(d.scale, "stored_rank");
  }
});

/* ── The owner-only dash ──────────────────────────────────────────────────── */

test("the queue owner falls back to the stored rank, like everybody else", () => {
  /* THE BUG. `activeQueuePositions` numbers only the LIVE queue — it omits
     closed work and anything whose budget is unsettled. `?? UNRANKED` meant
     the owner alone got nothing for those, while every other viewer took the
     `resolveTaskPriority` branch and saw the stored number.
     That is precisely "the manager sees P1/P2/P3 and Pramod sees dashes". */
  const map = code(MAP);
  assert.equal(
    map.includes("input.queue.positions.get(legacy.id) ?? UNRANKED"),
    false,
    "the queue owner loses their rank again",
  );

  /* **The fall-back moved, and so did the shape of this assertion.** The mapper
     used to make the position-or-stored decision inline, twice, which is exactly
     the ambiguity that let one field mean two things. It now emits the two facts
     SEPARATELY — a stored `rank` always, and a `queuePosition` only where this
     person's queue was the one read — and `displayPriority` decides between them.

     So `?? null` on the position is now correct rather than the bug it was: null
     means "no position was read for this person", which is a different and honest
     fact from "they have no rank". */
  assert.match(map, /rank: resolveTaskPriority\(legacy, employeeId\)/);

  /* **The decision moved into `positionFor`, and gained a second source.**
     The owner check is unchanged: a position is read only from THIS person's
     queue. What changed is the fall-back — it was `null`, and null sent
     `displayPriority` to the stored rank, which is how a blocked task showed
     P1 beside a deadline computed for position 2. It now reads
     `effectivePriority`, the figure the engine's own chain recorded, so the
     badge and the deadline come from one number. */
  assert.match(map, /if \(queue && queue\.ownerId === employeeId\) \{/);
  assert.match(map, /return queue\.positions\.get\(legacy\.id\) \?\? null;/);
  assert.match(map, /return soleHolder \? \(legacy\.effectivePriority \?\? null\) : null;/);

  /* And only where the task has ONE assignee: the field records a position in
     whichever queue was last chained, so on shared work it names a queue we
     cannot identify. */
  assert.match(map, /legacy\.assigneeIds\.length === 1 && legacy\.assigneeIds\[0\] === employeeId/);

  /* And the fall-through that keeps a holder from seeing a dash is in the
     authority, where it is made once for every surface. */
  const authority = code("lib/rules/tasks/priority.ts");
  assert.match(authority, /if \(usable !== null\) \{/);
});

test("the two scales cannot be confused, which was the reported mismatch", () => {
  /* The list read fetches the VIEWER's queue and the detail read fetches the
     SUBJECT's. While one field held either number, that difference showed the
     same manager two values for one task — "detail says P1, list says P3".

     Now the stored rank is always the stored rank, so the paths differing about
     which queue they fetched changes only whether a POSITION is available, never
     which scale the number is on. */
  const map = code(MAP);
  const at = map.indexOf("rank: resolveTaskPriority(legacy, employeeId)");
  assert.ok(at > 0, "the assignment rank is no longer the stored rank");
  const block = map.slice(at, at + 400);
  assert.equal(
    /rank:[\s\S]{0,80}positions\.get/.test(block),
    false,
    "the stored rank can hold a derived position again",
  );

  /* And the domain type says which is which, so a new consumer cannot guess. */
  const domain = code("lib/domain/tasks.ts");
  assert.match(domain, /queuePosition: number \| null;/);
});

test("the list queue sees pending assignees and uses the shared resolver", () => {
  /* The list builds its own queue. It was filtering on `assigneeIds` and
     re-typing legacy's priority expression — a fifth copy. */
  const src = code(REPO);
  /* `myQueueEntries`, not `activeQueuePositions(` — the entries are now built
     once and read by both the accepted queue and the provisional one. */
  const at = src.indexOf("const myQueueEntries = legacyTasks");
  assert.ok(at > 0);
  const block = src.slice(at, at + 1400);
  assert.match(block, /holdersOf\(\{/);
  assert.match(block, /storedRank: resolveTaskPriority\(t, viewerId\)/);
  assert.equal(
    /t\.assigneePriorities\[viewerId\]/.test(block),
    false,
    "the list has its own copy of the priority rule again",
  );
});

test("the list and the task page get their dates from one chain", () => {
  /* The list never received chained dates, so a task read one date in the list
     and another when opened. Both call `#chainQueue` now. */
  const src = code(REPO);
  assert.match(src, /async #chainQueue\(/);
  assert.equal(
    (src.match(/this\.#chainQueue\(/g) ?? []).length,
    2,
    "the list and the task page must share the chain",
  );
  /* The list attaches each ROW's SUBJECT queue now — so a manager sees the
     report's OWN derived positions and dates, not the viewer's — seeded with the
     viewer's own chained `myQueue`/`myDueDates` and filled per report via the
     same `#activeQueueOf` the detail page uses. Dates still come from one chain;
     they are just computed per person rather than only for the viewer. */
  assert.match(src, /queuesBySubject/);
  /* Each fact checked on its own rather than as one literal line: the viewer's
     seed entry gained a `provisionalPositions` field alongside `positions` and
     `dueDates`, and pinning the old single-line shape would fail on the next
     genuinely unrelated field this object gains too. What must stay true is
     that `myQueue` and `myDueDates` — not some other pair — seed the viewer's
     own row. */
  const seedAt = src.search(/\[\s*viewerId,\s*\{\s*ownerId: viewerId,/);
  assert.ok(seedAt > 0, "the viewer's seed entry in queuesBySubject is missing");
  const seed = src.slice(seedAt, seedAt + 300);
  assert.match(seed, /ownerId: viewerId,/);
  assert.match(seed, /positions: myQueue,/);
  assert.match(seed, /dueDates: myDueDates,/);
  assert.match(src, /this\.#activeQueueOf\(subjectId\)/);
  assert.match(src, /queue: \(subjectId && queuesBySubject\.get\(subjectId\)\)/);
  /* And the chain is seeded from settled budgets and a fixed anchor — never from
     a STORED DEADLINE. That last one is the circularity guard and it still
     stands: `dueAtMs` and `fixedDeadline` are this chain's own output, so
     reading them back would let a date drift a little further every time it was
     recomputed. */
  /* 4200, not 2600: the anchor comment grew when the pairing below was
     documented, and a slice length is not a fact about the code. */
  const fn = src.slice(src.indexOf("async #chainQueue("), src.indexOf("async #chainQueue(") + 4200);
  /* The day's opening, paired with the FULL budget — see the fuller note in
     `operationalDueDate.test.ts`. Presence is not consulted: anchoring on the
     online session while subtracting logged time counted the same hour twice
     and made the date run backwards as work was done. */
  assert.match(fn, /const anchorMs = officeOpenMsFor\(policy\.schedule, nowMs\)/);
  assert.match(fn, /budget: "full"/);
  assert.match(fn, /senderTimerWindowSecs: resolveTimeBudget\(x\)/);
  assert.equal(
    /dueAtMs|fixedDeadline/.test(fn),
    false,
    "the chain is seeded from a stored deadline — that is circular",
  );
  /* `createdAtMs` IS an input, and deliberately. It is not circular — nothing
     derives it, it never changes — and without it the chain started every queue
     at the office opening, so a one-hour task assigned at 10:00 was due at 10:30
     and one assigned at 15:00 arrived already overdue. A task cannot be due
     before it existed. */
  assert.match(fn, /createdAtMs: x\.createdAtMs/);
});

/* ── The badge and the deadline come from one number ──────────────────────── */

/**
 * **Reported: badge P1, deadline 22 Aug 12:19 — the P2 slot.**
 *
 * The detail page reads the SUBJECT's queue, and a failed read is swallowed
 * (`catch { queue = undefined }`) so a task stays openable. That fallback then
 * left `queuePosition` null, `displayPriority` fell through to the rank
 * somebody SET, and a blocked task showed its stored 1 next to dates the chain
 * had laid out for position 2.
 *
 * Both numbers are now the engine's: `effectivePriority` is written by
 * `rechainQueueFor`, the same walk that produced the dates.
 */

test("a task with no queue read shows the recorded position, not the stored rank", () => {
  const map = code(MAP);
  const at = map.indexOf("function positionFor(");
  assert.ok(at !== -1, "positionFor is gone — renamed?");
  const fn = map.slice(at, map.indexOf("\n}", at));
  /* The stored rank must not appear in it at all: that was the wrong answer. */
  assert.doesNotMatch(fn, /resolveTaskPriority|assigneePriorities|legacy\.priority/);
  assert.match(fn, /legacy\.effectivePriority/);
});

test("shared work reports no position rather than a confident wrong one", () => {
  /* `effectivePriority` names a position in whichever person's queue was last
     chained. On a task with two assignees that queue cannot be identified, and
     a number attributed to the wrong person is worse than an honest null. */
  const map = code(MAP);
  const at = map.indexOf("function positionFor(");
  const fn = map.slice(at, map.indexOf("\n}", at));
  assert.match(fn, /assigneeIds\.length === 1/);
});
