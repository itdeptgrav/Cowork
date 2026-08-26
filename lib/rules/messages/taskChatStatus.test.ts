import assert from "node:assert/strict";
import { test } from "node:test";
import type { EmployeeId } from "../../domain/identity.ts";
import {
  taskAudience,
  taskChatStatus,
  taskChatStatusLabel,
} from "./taskChatStatus.ts";

const ME = "GR1";
const A = "GR2" as EmployeeId;
const B = "GR3" as EmployeeId;
const CROWD = [ME as EmployeeId, A, B];

const mine = (readBy: EmployeeId[] = []) => ({
  senderId: ME as EmployeeId,
  readBy,
});

test("somebody else's message never carries your tick", () => {
  assert.equal(
    taskChatStatus({ senderId: A, readBy: [ME as EmployeeId] }, ME, CROWD),
    "sent",
  );
});

test("one tick, two ticks, two blue — earned in that order", () => {
  /* The whole reason this is not the direct-message rule. On a task the BLUE
     tick must not turn the moment one of five people opens the tab — "the
     person I need has seen this" and "somebody has" are different claims. The
     middle state is what says the difference. */
  assert.equal(taskChatStatus(mine([]), ME, CROWD), "sent", "nobody yet");
  assert.equal(taskChatStatus(mine([A]), ME, CROWD), "delivered", "one of two");
  assert.equal(taskChatStatus(mine([A, B]), ME, CROWD), "read", "both");
});

test("the middle state is never claimed as a delivery", () => {
  /* A task has no per-device delivery stamp — the message thread computes that
     from a mark on the conversation document and nothing equivalent exists
     here. The `delivered` name only tells `MessageTicks` to draw two; the words
     shown to a person say what is actually known. */
  assert.equal(taskChatStatusLabel("sent", 3), "Sent");
  assert.equal(taskChatStatusLabel("delivered", 3), "Read by some");
  assert.equal(taskChatStatusLabel("read", 3), "Read by everyone on this task");
  /* With one other person, "everyone" is a strange way to name them. */
  assert.equal(taskChatStatusLabel("read", 1), "Read");
});

test("the sender reading their own message counts for nothing", () => {
  assert.equal(taskChatStatus(mine([ME as EmployeeId]), ME, CROWD), "sent");
});

test("a thread with nobody else in it stays sent", () => {
  /* An unassigned task's chat is a note to self. "Read by everyone" would be
     vacuously true and would show a confident tick nobody earned. */
  assert.equal(taskChatStatus(mine([]), ME, [ME as EmployeeId]), "sent");
  assert.equal(taskChatStatus(mine([]), ME, []), "sent");
});

test("a signed-out viewer is told nothing", () => {
  assert.equal(taskChatStatus(mine([A, B]), null, CROWD), "sent");
});

test("a system message carries no tick", () => {
  assert.equal(taskChatStatus({ senderId: "system" }, ME, CROWD), "sent");
});

test("an absent readBy reads as nobody, not as a crash", () => {
  assert.equal(taskChatStatus({ senderId: ME as EmployeeId }, ME, CROWD), "sent");
});

/* ── The audience ─────────────────────────────────────────────────────────── */

test("the audience is every distinct person on the task", () => {
  assert.deepEqual(
    taskAudience({ assignorId: ME, assigneeIds: [A, B], reviewerId: null }),
    [ME, A, B],
  );
});

test("somebody counted twice counts once", () => {
  /* Self-assignment makes assignor and assignee the same person, and a
     duplicate would make `every` unsatisfiable — the tick could never turn. */
  assert.deepEqual(
    taskAudience({ assignorId: ME, assigneeIds: [ME, A], reviewerId: ME }),
    [ME, A],
  );
});

test("blanks and absent fields are dropped", () => {
  assert.deepEqual(
    taskAudience({ assignorId: "", assigneeIds: [A], reviewerId: undefined }),
    [A],
  );
  assert.deepEqual(taskAudience({}), []);
});

test("a self-assigned task's own message is sent, never read", () => {
  /* End to end: assignor and assignee are one person, so the audience is one
     and there is nobody left to read it. */
  const audience = taskAudience({ assignorId: ME, assigneeIds: [ME] });
  assert.equal(taskChatStatus(mine([]), ME, audience), "sent");
});
