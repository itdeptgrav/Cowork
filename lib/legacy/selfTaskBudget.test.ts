import assert from "node:assert/strict";
import { test } from "node:test";
import { readTask } from "./tasks.ts";
import type { LegacyTaskDoc } from "./tasks.ts";

/**
 * A self task's opening budget is the ASSIGNEE's proposal, waiting on the
 * MANAGER — the reverse of a standard task. Umung makes the task and suggests
 * the time; his primary manager (the assigner of record in `assignedBy`)
 * approves or negotiates it. The regression this guards: reading a self task as
 * "your manager proposed and you accept", when the manager has not seen it yet.
 */

const UMUNG = "GR-UMUNG";
const MANAGER = "GR-RISHEE";

function selfTaskDoc(): LegacyTaskDoc {
  return {
    id: "T-SELF-1",
    title: "My own 4h task",
    // The route sets the assigner of record to the assignee's manager.
    assignedBy: MANAGER,
    assignedByName: "Rishee Ray",
    // The real creator stays the assignee.
    createdBy: UMUNG,
    assigneeIds: [UMUNG],
    isSelfAssigned: true,
    senderTimerWindowSecs: 4 * 3600,
    // No stored budgetNegotiation — the opening is derived.
  } as unknown as LegacyTaskDoc;
}

test("self task: opening budget is proposed BY the assignee, waiting ON the manager", () => {
  const t = readTask(selfTaskDoc());
  assert.ok(t, "readTask returned a task");
  const n = t!.budgetNegotiation;
  assert.ok(n, "self task has a derived opening negotiation");
  assert.equal(n!.state, "WAITING_FOR_ASSIGNOR", "manager's turn to decide");
  assert.equal(n!.proposedById, UMUNG, "the assignee proposed the budget");
  assert.equal(n!.waitingForId, MANAGER, "the manager approves/negotiates it");
  assert.equal(n!.currentSecs, 4 * 3600, "the proposed figure is on the table");
});

test("self task: 'Created by' credit stays with the assignee, not the manager", () => {
  const t = readTask(selfTaskDoc());
  assert.equal(t!.createdById, UMUNG);
});

test("standard task still opens the other way (manager proposes, assignee accepts)", () => {
  const doc = {
    id: "T-STD-1",
    title: "Assigned to Umung",
    assignedBy: MANAGER,
    assignedByName: "Rishee Ray",
    assigneeIds: [UMUNG],
    isSelfAssigned: false,
    senderTimerWindowSecs: 2 * 3600,
  } as unknown as LegacyTaskDoc;
  const n = readTask(doc)!.budgetNegotiation;
  assert.equal(n!.state, "WAITING_FOR_ASSIGNEE");
  assert.equal(n!.proposedById, MANAGER);
  assert.equal(n!.waitingForId, UMUNG);
});
