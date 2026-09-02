import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { mockRepository } from "./index.ts";
import { getStore, resetStore, setActingId } from "./store.ts";

/**
 * The pre-assignment deadline pushback, driven end to end through the mock.
 *
 * The pure rules are tested in `lib/rules/tasks/preAssignDeadline.test.ts`;
 * this drives the whole path — a request written against a real store task,
 * then a creator decision — and asserts the STORED deadline moves only when it
 * should. It reaches into the store to place a task at the budget gate
 * (`approvalReason: "effort_estimate"`), which is where the feature lives and
 * which the create flow does not produce on its own in the prototype.
 */

const CREATOR = "e-01";
const MANAGER = "e-02";

function gateTask() {
  const s = getStore();
  const t = s.tasks[0];
  t.createdById = CREATOR;
  t.status = "pending_approval";
  t.approvalReason = "effort_estimate";
  t.deadline.dueAt = "2026-09-10T08:30:00.000Z"; // 10 Sep, 2 PM IST
  t.deadline.officialDueAt = "2026-09-10T08:30:00.000Z";
  t.preAssignDeadline = null;
  return t.id;
}

beforeEach(() => {
  resetStore();
});

test("manager requests a later date; it is recorded but nothing moves yet", async () => {
  const id = gateTask();
  setActingId(MANAGER);
  const r = await mockRepository.requestPreAssignDeadline(
    id,
    "2026-09-11T10:30:00.000Z", // 11 Sep, 4 PM IST
    "queue is full until the 11th",
  );
  assert.equal(r.ok, true, r.ok ? "" : (r as { message: string }).message);

  const t = getStore().tasks.find((x) => x.id === id)!;
  assert.equal(t.preAssignDeadline?.status, "pending");
  assert.equal(t.preAssignDeadline?.proposedDueAt, "2026-09-11T10:30:00.000Z");
  /* The commitment has NOT changed — only a request is on record. */
  assert.equal(t.deadline.dueAt, "2026-09-10T08:30:00.000Z");
});

test("creator approves — the deadline moves to the proposed date", async () => {
  const id = gateTask();
  setActingId(MANAGER);
  await mockRepository.requestPreAssignDeadline(
    id,
    "2026-09-11T10:30:00.000Z",
    "queue is full",
  );

  setActingId(CREATOR);
  const r = await mockRepository.decidePreAssignDeadline(id, "approve");
  assert.equal(r.ok, true, r.ok ? "" : (r as { message: string }).message);

  const t = getStore().tasks.find((x) => x.id === id)!;
  assert.equal(t.deadline.dueAt, "2026-09-11T10:30:00.000Z");
  assert.equal(t.deadline.officialDueAt, "2026-09-11T10:30:00.000Z");
  assert.equal(t.preAssignDeadline?.status, "approved");
});

test("creator rejects — the deadline stands", async () => {
  const id = gateTask();
  setActingId(MANAGER);
  await mockRepository.requestPreAssignDeadline(id, "2026-09-11T10:30:00.000Z", "…");

  setActingId(CREATOR);
  await mockRepository.decidePreAssignDeadline(id, "reject", { reason: "client fixed it" });

  const t = getStore().tasks.find((x) => x.id === id)!;
  assert.equal(t.deadline.dueAt, "2026-09-10T08:30:00.000Z", "the date moved on a reject");
  assert.equal(t.preAssignDeadline?.status, "rejected");
});

test("creator counters — the date holds and a counter is recorded", async () => {
  const id = gateTask();
  setActingId(MANAGER);
  await mockRepository.requestPreAssignDeadline(id, "2026-09-11T10:30:00.000Z", "…");

  setActingId(CREATOR);
  await mockRepository.decidePreAssignDeadline(id, "counter", {
    counterDueAt: "2026-09-11T05:00:00.000Z",
  });

  const t = getStore().tasks.find((x) => x.id === id)!;
  assert.equal(t.deadline.dueAt, "2026-09-10T08:30:00.000Z", "a counter must not move the date");
  assert.equal(t.preAssignDeadline?.status, "countered");
  assert.equal(t.preAssignDeadline?.counterDueAt, "2026-09-11T05:00:00.000Z");
});

/* ── Guards ───────────────────────────────────────────────────────────────── */

test("a task not at the budget gate refuses the request", async () => {
  const s = getStore();
  const t = s.tasks[0];
  t.approvalReason = null;
  t.status = "in_progress";
  setActingId(MANAGER);
  const r = await mockRepository.requestPreAssignDeadline(t.id, "2027-01-01T00:00:00.000Z", "x");
  assert.equal(r.ok, false);
});

test("an earlier date is refused", async () => {
  const id = gateTask();
  setActingId(MANAGER);
  const r = await mockRepository.requestPreAssignDeadline(id, "2026-09-09T00:00:00.000Z", "x");
  assert.equal(r.ok, false);
});

test("only the creator may decide", async () => {
  const id = gateTask();
  setActingId(MANAGER);
  await mockRepository.requestPreAssignDeadline(id, "2026-09-11T10:30:00.000Z", "…");
  setActingId("e-03");
  const r = await mockRepository.decidePreAssignDeadline(id, "approve");
  assert.equal(r.ok, false);
});

test("two open requests cannot stack", async () => {
  const id = gateTask();
  setActingId(MANAGER);
  await mockRepository.requestPreAssignDeadline(id, "2026-09-11T10:30:00.000Z", "…");
  const second = await mockRepository.requestPreAssignDeadline(id, "2026-09-12T10:30:00.000Z", "…");
  assert.equal(second.ok, false);
});
