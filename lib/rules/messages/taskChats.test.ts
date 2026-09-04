import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pairedTaskChats,
  taskChatLabel,
  type PairedTaskChat,
} from "./taskChats.ts";
import type { TaskView } from "../../repositories/types.ts";

/**
 * Which task discussions surface inside a direct message.
 *
 * The pairing is the whole rule: a task is a thing one person handed another,
 * so its thread belongs in the DM between those two. Everything asserted here
 * is about not showing a thread to somebody it does not concern, and about not
 * inventing a priority number — the two ways this can be quietly wrong.
 */

function view(input: {
  id?: string;
  title?: string;
  status?: string;
  assignerId?: string | null;
  assigneeIds?: string[];
  /** The viewer's own derived queue position, where the read fetched it. */
  myRank?: number | null;
  myStoredRank?: number | null;
  /** Stored ranks, one per assignee, in the same order. */
  ranks?: number[];
  /** What the task asks for. Null is ordinary — most fixtures leave it. */
  description?: string | null;
  /** Deliverables, deliberately out of order where a test cares. */
  outputs?: { id: string; label: string; order: number }[];
}): TaskView {
  const assigneeIds = input.assigneeIds ?? ["them"];
  return {
    task: {
      id: input.id ?? "t-1",
      title: input.title ?? "A task",
      status: input.status ?? "in_progress",
      description: input.description ?? null,
      outputs: input.outputs ?? [],
    },
    assigner: input.assignerId === null ? null : { id: input.assignerId ?? "me" },
    assignees: assigneeIds.map((id) => ({ id })),
    myRank: input.myRank ?? null,
    myStoredRank: input.myStoredRank ?? null,
    assignments: assigneeIds.map((id, i) => ({
      employeeId: id,
      rank: input.ranks?.[i] ?? 5,
      queuePosition: null,
      provisionalPosition: null,
    })),
  } as unknown as TaskView;
}

const pair = (tasks: TaskView[]) =>
  pairedTaskChats({ tasks, viewerId: "me", otherId: "them" });

/* ── The pairing ──────────────────────────────────────────────────────────── */

test("work I gave them appears in our conversation", () => {
  const got = pair([view({ assignerId: "me", assigneeIds: ["them"] })]);
  assert.equal(got.length, 1);
  assert.equal(got[0].mine, false, "I am not the one doing it");
});

test("work they gave me appears too, and is marked as mine to do", () => {
  const got = pair([view({ assignerId: "them", assigneeIds: ["me"] })]);
  assert.equal(got.length, 1);
  assert.equal(got[0].mine, true);
});

test("a task neither of us is on stays out of our conversation", () => {
  /* The failure that would matter most: a thread about somebody else's work
     appearing in a DM, in a product where a task carries salary-relevant
     scoring and a deadline argument. */
  const got = pair([view({ assignerId: "someone", assigneeIds: ["other"] })]);
  assert.deepEqual(got, []);
});

test("a task I assigned to a THIRD person is not in this conversation", () => {
  /* I am on it, so a naive "does the viewer touch this task" filter would
     show it here. The pairing is both people, not either. */
  const got = pair([view({ assignerId: "me", assigneeIds: ["other"] })]);
  assert.deepEqual(got, []);
});

test("a task with no assigner cannot pair with anybody", () => {
  const got = pair([view({ assignerId: null, assigneeIds: ["me"] })]);
  assert.deepEqual(got, []);
});

test("a multi-assignee task pairs with each assignee separately", () => {
  /* Documented rather than prevented: the thread is one per TASK, so both
     assignees see the SAME conversation in their own DM with the assigner.
     Honest for the common case and never to be called a private channel. */
  const t = view({ assignerId: "me", assigneeIds: ["them", "other"] });
  assert.equal(pairedTaskChats({ tasks: [t], viewerId: "me", otherId: "them" }).length, 1);
  assert.equal(pairedTaskChats({ tasks: [t], viewerId: "me", otherId: "other" }).length, 1);
});

/* ── What is left out ─────────────────────────────────────────────────────── */

test("closed tasks are excluded, so the picker holds one P1 and not two", () => {
  /* A completed task keeps the rank it finished with. Including one puts a
     second P1 in the list beside the live one, which is exactly the "two tasks
     have the same priority" report `isHistoric` exists to prevent. */
  for (const status of ["completed", "cancelled", "assignment_rejected"]) {
    const got = pair([view({ status, assignerId: "me", assigneeIds: ["them"] })]);
    assert.deepEqual(got, [], `${status} should not be offered as a live chat`);
  }
});

test("an unresolved viewer or partner returns nothing, never everything", () => {
  const tasks = [view({ assignerId: "me", assigneeIds: ["them"] })];
  assert.deepEqual(pairedTaskChats({ tasks, viewerId: null, otherId: "them" }), []);
  assert.deepEqual(pairedTaskChats({ tasks, viewerId: "me", otherId: null }), []);
});

test("a note to self does not pair", () => {
  /* Same person on both sides of the DM is not a conversation between two
     people, and the assigner/assignee test would otherwise match trivially. */
  const tasks = [view({ assignerId: "me", assigneeIds: ["me"] })];
  assert.deepEqual(pairedTaskChats({ tasks, viewerId: "me", otherId: "me" }), []);
});

/* ── The order ────────────────────────────────────────────────────────────── */

test("P1 comes first, which is what the picker opens on", () => {
  const got = pair([
    view({ id: "c", title: "Third", assignerId: "them", assigneeIds: ["me"], myRank: 3 }),
    view({ id: "a", title: "First", assignerId: "them", assigneeIds: ["me"], myRank: 1 }),
    view({ id: "b", title: "Second", assignerId: "them", assigneeIds: ["me"], myRank: 2 }),
  ]);
  assert.deepEqual(
    got.map((c) => c.rank),
    [1, 2, 3],
  );
  assert.equal(got[0].taskId, "a");
});

test("an unranked task sorts last, not first", () => {
  /* Unplaced is not urgent. Sorting a null as 0 would put work nobody has
     ranked above the P1 somebody did. */
  const got = pair([
    view({ id: "none", title: "Unranked", assignerId: "them", assigneeIds: ["me"], ranks: [0] }),
    view({ id: "p2", title: "Ranked", assignerId: "them", assigneeIds: ["me"], myRank: 2 }),
  ]);
  assert.equal(got[0].taskId, "p2");
  assert.equal(got[1].rank, null, "0 is not a rank anybody set");
});

test("equal ranks break on title, so the list does not reshuffle on refetch", () => {
  /* A picker whose second item moves under the cursor between reads is worse
     than one that is merely arbitrary. */
  const build = () =>
    pair([
      view({ id: "z", title: "Zebra", assignerId: "them", assigneeIds: ["me"], myRank: 2 }),
      view({ id: "a", title: "Apple", assignerId: "them", assigneeIds: ["me"], myRank: 2 }),
    ]);
  assert.deepEqual(
    build().map((c) => c.taskId),
    ["a", "z"],
  );
  assert.deepEqual(build().map((c) => c.taskId), build().map((c) => c.taskId));
});

/* ── The label ────────────────────────────────────────────────────────────── */

/* `taskChatLabel` reads only the rank, the title and whether it is provisional.
   Built through a helper so adding a field to PairedTaskChat does not break
   three tests that never cared about it. */
const chat = (over: Partial<PairedTaskChat>): PairedTaskChat => ({
  taskId: "t",
  title: "A task",
  rank: 1,
  isProvisional: false,
  status: "in_progress",
  mine: true,
  description: null,
  outputs: [],
  ...over,
});

test("the label leads with the rank, so a reader scanning for P1 need not read titles", () => {
  assert.equal(
    taskChatLabel(chat({ title: "Redesign the deck", rank: 1 })),
    "P1 · Redesign the deck",
  );
});

test("an unranked task shows its title alone, never “P—”", () => {
  /* `P—` reads as a priority level that does not exist. Absence is absence. */
  const label = taskChatLabel(chat({ title: "Unplaced work", rank: null }));
  assert.equal(label, "Unplaced work");
  assert.equal(/P/.test(label.replace("Unplaced work", "")), false);
});

test("work awaiting acceptance is numbered as its own sequence", () => {
  /* It is first in line to be ACCEPTED, not first in the running order.
     Rendered identically, a list holding one of each shows two P1s. */
  assert.equal(
    taskChatLabel(chat({ title: "New work", rank: 1, isProvisional: true })),
    "P1 to accept · New work",
  );
});

/* ── The brief and the deliverables ───────────────────────────────────────── */

test("the brief rides along, so opening it costs no second read", () => {
  const got = pair([
    view({
      assignerId: "them",
      assigneeIds: ["me"],
      description: "Redraw the deck for the Gopalpur pitch.",
    }),
  ]);
  assert.equal(got[0].description, "Redraw the deck for the Gopalpur pitch.");
});

test("no brief is null, which is ordinary rather than an error", () => {
  assert.equal(pair([view({ assignerId: "me" })])[0].description, null);
});

test("deliverables come back in the task's own order", () => {
  /* The numbering somebody reads beside a deliverable has to be the numbering
     the task uses, or "the second one" means two things on two screens. */
  const got = pair([
    view({
      assignerId: "me",
      outputs: [
        { id: "o2", label: "Figma — Gopalpur", order: 2 },
        { id: "o1", label: "Google Doc — Gopalpur", order: 1 },
      ],
    }),
  ]);
  assert.deepEqual(
    got[0].outputs.map((o) => o.label),
    ["Google Doc — Gopalpur", "Figma — Gopalpur"],
  );
});

test("a task with no deliverables carries an empty list, never undefined", () => {
  /* The panel renders from `.length`, so undefined would throw rather than
     read as "none listed". */
  assert.deepEqual(pair([view({ assignerId: "me" })])[0].outputs, []);
});

test("sorting the deliverables does not reorder the task's own array", () => {
  const outputs = [
    { id: "o2", label: "Second", order: 2 },
    { id: "o1", label: "First", order: 1 },
  ];
  pair([view({ assignerId: "me", outputs })]);
  assert.deepEqual(
    outputs.map((o) => o.id),
    ["o2", "o1"],
    "the caller's array was sorted in place",
  );
});
