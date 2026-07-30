import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A cross-department assignee is told the work is coming.
 *
 * **The gap.** The gate creates the task with `assigneeIds: []` and the target
 * in `pendingAssigneeId` (`taskForward.js:339`), and the entire fan-out in
 * `createTask` is wrapped in `if (assigneeIds?.length)`. Empty array, no
 * notification, no push, no socket event — so the one person the work was
 * addressed to heard nothing until both approvals landed. Approvers were
 * notified correctly the whole time; only the receiver was silent.
 *
 * The fix is a SEPARATE notification type, not a reuse of `task_assigned`: the
 * task is not theirs yet and may still be rejected. Telling somebody they have
 * been assigned work that a department head can still refuse is worse than
 * telling them nothing.
 *
 * Skips when the reference backend is not checked out beside this repo.
 */

/**
 * The pending-assignee block, comments removed, sliced FORWARD from its own
 * guard.
 *
 * A window that reached backwards overlapped the normal fan-out immediately
 * above it — which legitimately contains `emitToMany` — so a check for "no
 * socket emit here" read the neighbouring block's.
 */
function pendingBlock(): string {
  const c = code(SERVICE);
  const at = c.indexOf("!assigneeIds?.length && pendingAssigneeId");
  return at < 0 ? "" : c.slice(at, at + 700);
}

/**
 * Source with comments removed.
 *
 * Asserting on raw source repeatedly matched a file's own documentation — a
 * comment explaining why `task_assigned` is NOT used contains the string
 * `task_assigned`, and a JSDoc line begins with an asterisk. Every check below
 * that looks for code reads through this.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const BACKEND = "/Users/risheeray/Documents/cowork-old-backend";
const SERVICE = join(BACKEND, "services/taskForward.service.js");
const ROUTE = join(BACKEND, "routes/task_routes/taskForward.js");

function backendAvailable(): boolean {
  try {
    return statSync(SERVICE).isFile();
  } catch {
    return false;
  }
}

test("the pending assignee is notified when the gate holds the task", (t) => {
  if (!backendAvailable()) {
    t.skip("cowork-old-backend is not checked out beside this repo");
    return;
  }
  const src = readFileSync(SERVICE, "utf8");
  assert.match(src, /task_pending_department_approval/);
  assert.match(src, /recipientIds: \[pendingAssigneeId\]/);
});

test("it fires ONLY when the normal fan-out did not", (t) => {
  if (!backendAvailable()) return t.skip("backend not present");
  /* `!assigneeIds?.length && pendingAssigneeId` — a normal assignment has a
     populated array and must keep its single `task_assigned`. Notifying twice
     would double every ordinary assignment. */
  const src = readFileSync(SERVICE, "utf8");
  assert.match(src, /!assigneeIds\?\.length && pendingAssigneeId/);
});

test("it does NOT reuse task_assigned", (t) => {
  if (!backendAvailable()) return t.skip("backend not present");
  /* The type is what the client keys off. Reusing `task_assigned` would put
     work in somebody's assigned list before a department head had agreed to
     it. */
  const src = readFileSync(SERVICE, "utf8");
  const block = pendingBlock();
  assert.ok(src.includes("task_pending_department_approval"));
  assert.ok(block.length > 0, "the pending-assignee block is gone");
  assert.equal(
    block.includes('"task_assigned"'),
    false,
    "the pending notification must not reuse the assigned type",
  );
});

test("no socket new_task is emitted before approval", (t) => {
  if (!backendAvailable()) return t.skip("backend not present");
  /* `new_task` carries the task into the assignee's live list — precisely what
     must not happen while the gate holds it. */
  assert.equal(pendingBlock().includes("emitToMany"), false);
});

test("the employee is NOT added to assigneeIds before approval", (t) => {
  if (!backendAvailable()) return t.skip("backend not present");
  /* The security line. The notification tells them the work is coming; the gate
     still decides whether it arrives. */
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /assigneeIds: departmentApprovalGate \? \[\] : \(assigneeIds \|\| \[\]\)/);
  const block = pendingBlock();
  assert.equal(block.includes("arrayUnion"), false);
  assert.equal(block.includes("assigneeIds ="), false);
});

test("the approver notifications are untouched", (t) => {
  if (!backendAvailable()) return t.skip("backend not present");
  /* Both were already correct and neither was in scope. */
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /uniqueApproverIds/);
  assert.match(route, /department_approval_your_turn/);
  assert.match(route, /department_approval_completed/);
});

/* ── The client ───────────────────────────────────────────────────────────── */

test("an unknown notification type is displayed, not dropped", () => {
  /* The new type needs no client change, and this is why: the ported hook keys
     sounds off a map WITH a fallback and counts unread across every type. A
     whitelist anywhere here would have made the new notification invisible,
     which is the failure this asserts against. */
  const hook = readFileSync("lib/legacy-ui/useCoworkNotifications.ts", "utf8");
  assert.match(hook, /SOUND_URLS\[notifType\] \|\| SOUND_URLS\.default/);
  assert.match(hook, /notifs\.filter\(n => !n\.read\)\.length/);
});

test("the notification type stays free-form through the mapper", () => {
  /* `Notification.type` is a string, so a new engine type reaches the client
     without a domain change — and without a union that would need editing in
     lockstep with the engine. */
  const domain = readFileSync("lib/domain/work.ts", "utf8");
  const block = domain.slice(domain.indexOf("export interface Notification"));
  assert.match(block.slice(0, 600), /type: string;/);
});

test("a pending task offers no start or submit action", () => {
  /* `pending_department_approval` maps to `pending_approval`, and the timer
     control only offers itself for `confirmed` or `in_progress`. So the gate
     holds the actions as well as the assignment — the notification cannot
     become a way in. */
  const map = readFileSync("lib/repositories/legacy/taskMap.ts", "utf8");
  assert.match(map, /case "pending_department_approval":/);
  const timer = readFileSync("components/features/tasks/TimerControl.tsx", "utf8");
  assert.match(timer, /view\.task\.status === "in_progress" \|\| needsStart/);
});
