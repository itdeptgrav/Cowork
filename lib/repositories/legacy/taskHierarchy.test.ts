import assert from "node:assert/strict";
import test from "node:test";

import { readTask } from "../../legacy/tasks.ts";

/**
 * Hierarchy and cross-department visibility.
 *
 * The predicates are transcribed from `LegacyRepository.listTasks`, which in
 * turn comes from `app/coworking/tasks/page.js:6010-6031` and `:6932`. Written
 * against the old page's rule rather than our implementation, so that changing
 * ours does not quietly change what is asserted.
 */

const base = { id: "T", taskId: "T", title: "T", status: "open" };
const read = (doc: Record<string, unknown>) => readTask({ ...base, ...doc })!;

type T = ReturnType<typeof read>;

const rootFilter = (tasks: T[], role: string, scope: string) => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (scope === "submitted") return tasks;
  return tasks.filter((t) => {
    if (!t.parentTaskId) return true;
    if (role === "ceo" || role === "tl") return false;
    return t.isForwardedTask || !byId.has(t.parentTaskId);
  });
};

const hasAssignedDescendant = (
  byId: Map<string, T>,
  taskId: string,
  me: string,
  visited = new Set<string>(),
): boolean => {
  if (visited.has(taskId)) return false;
  visited.add(taskId);
  const t = byId.get(taskId);
  if (!t) return false;
  if (t.isForwardedTask) return false;
  if (t.assigneeIds.includes(me) && t.createdById !== me) return true;
  return t.subtaskIds.some((s) => hasAssignedDescendant(byId, s, me, visited));
};

/* ── Root-only filtering ───────────────────────────────────────────────── */

test("a TL and a CEO see roots only", () => {
  const tasks = [
    read({ id: "P", subtaskIds: ["C"] }),
    read({ id: "C", parentTaskId: "P" }),
  ];
  for (const role of ["tl", "ceo"]) {
    const kept = rootFilter(tasks, role, "mine").map((t) => t.id);
    assert.deepEqual(kept, ["P"], `${role} must see the root only`);
  }
});

test("an employee keeps an orphan whose parent is out of reach", () => {
  /* The parent is not in the loaded set — most often because it belongs to
     somebody else. Hiding the child would lose work the employee owns. */
  const tasks = [read({ id: "C", parentTaskId: "MISSING" })];
  assert.deepEqual(
    rootFilter(tasks, "employee", "mine").map((t) => t.id),
    ["C"],
  );
});

test("an employee keeps a forward-created subtask", () => {
  const tasks = [
    read({ id: "P", subtaskIds: ["C"] }),
    read({ id: "C", parentTaskId: "P", isForwardedTask: true }),
  ];
  assert.deepEqual(
    rootFilter(tasks, "employee", "mine").map((t) => t.id).sort(),
    ["C", "P"],
  );
});

test("Submitted keeps subtasks, because submissions live on them", () => {
  const tasks = [
    read({ id: "P", subtaskIds: ["C"] }),
    read({ id: "C", parentTaskId: "P" }),
  ];
  assert.equal(rootFilter(tasks, "ceo", "submitted").length, 2);
});

/* ── Descendant matching ───────────────────────────────────────────────── */

test("a parent counts as mine when a descendant is", () => {
  const tasks = [
    read({ id: "P", subtaskIds: ["C"], assignedBy: "E2" }),
    read({ id: "C", parentTaskId: "P", assigneeIds: ["E1"], assignedBy: "E2" }),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.equal(hasAssignedDescendant(byId, "P", "E1"), true);
});

test("nesting is followed to any depth", () => {
  const tasks = [
    read({ id: "P", subtaskIds: ["M"] }),
    read({ id: "M", parentTaskId: "P", subtaskIds: ["C"] }),
    read({ id: "C", parentTaskId: "M", assigneeIds: ["E1"], assignedBy: "E2" }),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.equal(hasAssignedDescendant(byId, "P", "E1"), true);
});

test("a forwarded descendant does not pull its parent in", () => {
  /* Once work is forwarded the original above it stays hidden — that is what
     forwarding is for. */
  const tasks = [
    read({ id: "P", subtaskIds: ["C"] }),
    read({
      id: "C",
      parentTaskId: "P",
      assigneeIds: ["E1"],
      assignedBy: "E2",
      isForwardedTask: true,
    }),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.equal(hasAssignedDescendant(byId, "P", "E1"), false);
});

test("a cycle in subtaskIds terminates", () => {
  /* `subtaskIds` is engine-written; a malformed chain must not hang the list. */
  const tasks = [
    read({ id: "A", subtaskIds: ["B"] }),
    read({ id: "B", parentTaskId: "A", subtaskIds: ["A"] }),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.equal(hasAssignedDescendant(byId, "A", "E1"), false);
});

/* ── Cross-department gate scoping ─────────────────────────────────────── */

const gateVisible = (t: T, me: string) => {
  if (t.status !== "pending_department_approval") return true;
  if (t.createdById === me) return true;
  if (t.pendingAssigneeId === me) return true;
  return t.departmentApproverIds.includes(me);
};

test("a held task reaches only the three people legacy shows it to", () => {
  const held = {
    status: "pending_department_approval",
    assigneeIds: [],
    assignedBy: "E2",
    pendingAssigneeId: "E3",
    departmentApprovals: [{ approverId: "E4" }, { approverId: "E5" }],
  };
  assert.equal(gateVisible(read(held), "E2"), true, "the sender");
  assert.equal(gateVisible(read(held), "E3"), true, "the pending assignee");
  assert.equal(gateVisible(read(held), "E4"), true, "sender-side approver");
  assert.equal(gateVisible(read(held), "E5"), true, "receiver-side approver");
  /* Everyone else. The query behind this is org-wide by necessity — Firestore
     cannot filter inside `departmentApprovals[]` — so without this clause it
     is a straight permission leak. */
  assert.equal(gateVisible(read(held), "E9"), false, "an unrelated employee");
});

test("the gate filter leaves ordinary tasks alone", () => {
  assert.equal(gateVisible(read({ assigneeIds: ["E9"] }), "E1"), true);
});

test("held tasks carry no assignees, which is why they needed their own query", () => {
  const t = read({
    status: "pending_department_approval",
    assigneeIds: [],
    pendingAssigneeId: "E3",
    departmentApprovals: [{ approverId: "E4" }],
  });
  assert.deepEqual(t.assigneeIds, []);
  assert.equal(t.pendingAssigneeId, "E3");
  assert.deepEqual(t.departmentApproverIds, ["E4"]);
});

test("a malformed approvals array yields no approvers rather than throwing", () => {
  const t = read({
    status: "pending_department_approval",
    departmentApprovals: [{}, { approverId: "" }],
  });
  assert.deepEqual(t.departmentApproverIds, []);
  /* And so it is visible to nobody but the sender and the pending assignee —
     which is the safe direction to fail. */
  assert.equal(gateVisible(t, "E4"), false);
});
