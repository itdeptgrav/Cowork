import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Every surface that counts or orders work uses one rule.
 *
 * Four definitions of "active" existed — `status !== "completed"` in two
 * counters, `isOpen` on the dashboard, and the queue's own list — so a person's
 * workload, their queue length and their dashboard could each report a
 * different number for the same day.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("workload counters use the shared predicate", () => {
  for (const path of [
    "components/features/admin/EmployeeProfile.tsx",
    "components/features/tasks/TasksArea.tsx",
  ]) {
    const src = code(path);
    assert.match(src, /isActivePriorityTask/, `${path} counts its own way`);
    assert.equal(
      /status !== "completed" && .*status !== "cancelled"/.test(src),
      false,
      `${path} still defines active for itself`,
    );
  }
});

test("the predicate lives in one place", () => {
  /* A component-local copy is how the definitions diverged in the first
     place. */
  const rule = code("lib/rules/tasks/activeQueue.ts");
  assert.match(rule, /export function isActivePriorityTask\(/);
  for (const path of [
    "components/features/admin/EmployeeProfile.tsx",
    "components/features/tasks/TasksArea.tsx",
  ]) {
    assert.equal(
      /function isActivePriorityTask/.test(code(path)),
      false,
      `${path} defines its own copy`,
    );
  }
});

test("the dashboard's isOpen is left alone, deliberately", () => {
  /* It feeds the "waiting" counter, which is precisely where a task awaiting
     budget agreement SHOULD appear — it is waiting on somebody. Swapping it for
     the priority rule would hide those tasks from the one counter designed to
     surface them.
     Its hours total is unaffected either way: a budget-pending task is
     `assigned`, and the timer refuses anything but `confirmed`/`in_progress`,
     so it can never have accrued time. */
  const signals = code("components/features/dashboard/signals.ts");
  assert.match(signals, /export function isOpen\(/);
  assert.match(signals, /status !== "completed"/);
  const stats = code("components/features/dashboard/Stats.tsx");
  assert.match(stats, /task\.status === "pending_approval" \|\| v\.task\.isBlocked/);
});
