import assert from "node:assert/strict";
import test from "node:test";

import {
  activeQueuePositions,
  provisionalQueuePositions,
  type QueueEntry,
} from "./activeQueue.ts";
import {
  calculateProvisionalOrder,
  isActiveWorkload,
  isLiveCandidate,
  type QueueCandidate,
} from "./priorityQueue.ts";
import { displayPriority, getPersonPriority } from "./priority.ts";

/**
 * The reported symptom, reproduced exactly.
 *
 * Five tasks for one person: T709, T711 and T713 are real subtasks, none yet
 * accepted; T710 and T712 are the tasks they were broken out of, now
 * containers. The engine had stamped all five with sequential stored ranks
 * 1..5 back when all five were ordinary tasks. Screen showed P1, P3, P5 —
 * nothing at P2 or P4 — because nothing excluded the two containers from
 * either the accepted queue or the raw number a pending task fell back to.
 */
function screenshotEntries(): (QueueEntry & QueueCandidate)[] {
  return [
    { taskId: "T709", status: "assigned", storedRank: 1, isContainer: false },
    { taskId: "T710", status: "assigned", storedRank: 2, isContainer: true },
    { taskId: "T711", status: "assigned", storedRank: 3, isContainer: false },
    { taskId: "T712", status: "assigned", storedRank: 4, isContainer: true },
    { taskId: "T713", status: "assigned", storedRank: 5, isContainer: false },
  ];
}

test("a container never holds an active-queue slot", () => {
  assert.equal(
    isActiveWorkload({
      taskId: "T710",
      status: "assigned",
      storedRank: 2,
      budgetState: "ACCEPTED",
      accepted: true,
      isContainer: true,
    }),
    false,
    "an accepted, settled container still must not count — a project is not workload",
  );
});

test("a container is not even a live candidate for the provisional queue", () => {
  assert.equal(
    isLiveCandidate({
      taskId: "T710",
      status: "assigned",
      storedRank: 2,
      isContainer: true,
    }),
    false,
  );
});

test("calculateProvisionalOrder excludes containers and closed accepted-workload alike", () => {
  const order = calculateProvisionalOrder(screenshotEntries());
  assert.deepEqual(order, ["T709", "T711", "T713"]);
});

test("the three real subtasks number 1, 2, 3 — not 1, 3, 5", () => {
  /* This is the screenshot. Before the fix, nothing computed a provisional
     position at all, and the fallback was the raw `storedRank` — 1, 3, 5,
     with the reader left to wonder where P2 and P4 went. */
  const positions = provisionalQueuePositions(screenshotEntries());
  assert.equal(positions.get("T709"), 1);
  assert.equal(positions.get("T711"), 2);
  assert.equal(positions.get("T713"), 3);
  assert.equal(positions.has("T710"), false, "a container gets no position");
  assert.equal(positions.has("T712"), false, "a container gets no position");
});

test("provisional and active positions are disjoint — a task is never numbered by both", () => {
  /* One accepted (T709), the rest still pending. T709 must appear in the
     active map and nowhere in the provisional one, or a reader would see two
     different numbers race for the same task depending on which the screen
     happened to read. */
  const entries: (QueueEntry & QueueCandidate)[] = [
    {
      taskId: "T709",
      status: "in_progress",
      storedRank: 1,
      isContainer: false,
      accepted: true,
      budgetState: "ACCEPTED",
    },
    { taskId: "T711", status: "assigned", storedRank: 3, isContainer: false },
    { taskId: "T713", status: "assigned", storedRank: 5, isContainer: false },
  ];
  const active = activeQueuePositions(entries);
  const provisional = provisionalQueuePositions(entries);
  assert.equal(active.get("T709"), 1);
  assert.equal(provisional.has("T709"), false);
  assert.equal(provisional.get("T711"), 1);
  assert.equal(provisional.get("T713"), 2);
});

test("accepting the lead task moves it to the active queue and closes the provisional gap behind it", () => {
  /* Exactly the behaviour `activeQueuePositions` already has for a completed
     task — "closing a task renumbers nothing on disk, so the gap simply stops
     being rendered" — applied to the provisional queue too: T709 leaving for
     the accepted queue is indistinguishable, from the provisional sequence's
     point of view, from any other departure. T711 and T713 move up exactly
     the way P2 becomes P1 when a P1 completes. */
  const afterAccepting709 = provisionalQueuePositions(
    screenshotEntries().map((e) =>
      e.taskId === "T709"
        ? { ...e, accepted: true, budgetState: "ACCEPTED" }
        : e,
    ),
  );
  assert.equal(afterAccepting709.has("T709"), false);
  assert.equal(afterAccepting709.get("T711"), 1);
  assert.equal(afterAccepting709.get("T713"), 2);
});

/* ── Through the display layer ─────────────────────────────────────────── */

test("getPersonPriority reports the provisional position, not the raw stored gap", () => {
  const positions = provisionalQueuePositions(screenshotEntries());
  const result = getPersonPriority({
    task: { status: "assigned", priority: 3 },
    subjectId: "me",
    queuePosition: null,
    provisionalPosition: positions.get("T711") ?? null,
    viewerId: "me",
  });
  assert.equal(result.rank, 2, "T711 is the second real subtask, not P3");
  assert.equal(result.scale, "provisional_position");
  assert.equal(result.isHistoric, false);
});

test("displayPriority prefers a holder's provisional position over their raw stored rank", () => {
  const result = displayPriority({
    status: "assigned",
    viewerId: "manager",
    holders: [
      { employeeId: "report", rank: 3, queuePosition: null, provisionalPosition: 2 },
    ],
  });
  assert.equal(result.rank, 2);
  assert.equal(result.scale, "provisional_position");
  assert.equal(result.subjectId, "report");
  assert.equal(result.isMine, false);
});

test("a container still resolves through getTaskPriority-style callers as nothing shown, never a wrong number", () => {
  /* Not a rank display test in itself — this is the invariant TaskTable.tsx's
     `isContainer` branch depends on: a container is never fed into
     provisionalQueuePositions at all (it is filtered out before the map is
     built), so looking it up always returns undefined, never a stale or
     borrowed number. */
  const positions = provisionalQueuePositions(screenshotEntries());
  assert.equal(positions.get("T710"), undefined);
  assert.equal(positions.get("T712"), undefined);
});
