import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { toTaskStatus } from "../../repositories/legacy/taskMap.ts";
import {
  committedEffort,
  MAX_REMEMBERED,
  noticeKey,
  rememberSeen,
  unseenNotices,
  type AssignmentNotice,
} from "./newAssignments.ts";

function notice(over: Partial<AssignmentNotice> = {}): AssignmentNotice {
  return {
    taskId: "T1",
    title: "Write the report",
    reference: "TSK-1",
    assignedAt: "2026-08-02T09:00:00.000Z",
    assignedByName: "Ray",
    dueAt: null,
    rank: 3,
    description: null,
    requirementCount: 0,
    effortSecs: null,
    deadlineMode: "fixed",
    projectName: null,
    isSubtask: false,
    action: null,
    ...over,
  };
}

test("an unseen assignment is shown", () => {
  assert.equal(unseenNotices([notice()], []).length, 1);
});

test("a seen assignment is not shown again", () => {
  const n = notice();
  assert.deepEqual(unseenNotices([n], [noticeKey(n)]), []);
});

test("being re-assigned to the same task later announces itself again", () => {
  /* Keyed on taskId AND assignedAt: the second assignment is a genuinely new
     event, and keying on taskId alone would swallow it silently. */
  const first = notice({ assignedAt: "2026-08-01T09:00:00.000Z" });
  const again = notice({ assignedAt: "2026-08-02T09:00:00.000Z" });
  assert.equal(unseenNotices([again], [noticeKey(first)]).length, 1);
});

test("the newest assignment comes first", () => {
  const older = notice({ taskId: "T1", assignedAt: "2026-08-01T09:00:00.000Z" });
  const newer = notice({ taskId: "T2", assignedAt: "2026-08-02T09:00:00.000Z" });
  assert.deepEqual(
    unseenNotices([older, newer], []).map((n) => n.taskId),
    ["T2", "T1"],
  );
});

test("the input list is never mutated", () => {
  const list = [
    notice({ taskId: "T1", assignedAt: "2026-08-01T09:00:00.000Z" }),
    notice({ taskId: "T2", assignedAt: "2026-08-02T09:00:00.000Z" }),
  ];
  const before = list.map((n) => n.taskId);
  unseenNotices(list, []);
  assert.deepEqual(list.map((n) => n.taskId), before);
});

test("remembering is idempotent — showing the same notice twice stores one key", () => {
  const n = notice();
  const once = rememberSeen([], [n]);
  assert.deepEqual(rememberSeen(once, [n]), once);
});

test("the remembered set is bounded, dropping the oldest keys first", () => {
  const many = Array.from({ length: MAX_REMEMBERED + 10 }, (_, i) => `T${i}:t`);
  const next = rememberSeen(many, [notice({ taskId: "NEW" })]);
  assert.equal(next.length, MAX_REMEMBERED);
  assert.equal(next.includes(noticeKey(notice({ taskId: "NEW" }))), true, "the new key survives");
  assert.equal(next.includes("T0:t"), false, "the oldest key was dropped");
});

test("nothing outstanding means nothing to show", () => {
  assert.deepEqual(unseenNotices([], ["T1:x"]), []);
});

test("committed effort totals only the tasks that actually carry an estimate", () => {
  /* Reported as a pair so a caller can say "4h across 2 of 3" — a bare total
     over a partially-estimated set reads as the whole commitment and is not. */
  const summary = committedEffort([
    notice({ taskId: "A", effortSecs: 3600 }),
    notice({ taskId: "B", effortSecs: 10_800 }),
    notice({ taskId: "C", effortSecs: null }),
  ]);
  assert.deepEqual(summary, { totalSecs: 14_400, withEstimate: 2, total: 3 });
});

test("committed effort over nothing estimated is zero, not a false total", () => {
  const summary = committedEffort([notice({ effortSecs: null })]);
  assert.deepEqual(summary, { totalSecs: 0, withEstimate: 0, total: 1 });
});

/* ── The notice has to be LIVE ────────────────────────────────────────────── */

/**
 * The gate watches Firestore for the whole session.
 *
 * These assert the component's source rather than its behaviour, which is the
 * honest thing available here: the failure being guarded against is not a wrong
 * value, it is a listener that stops listening, and nothing observable from a
 * unit test distinguishes "no new work" from "no longer watching".
 */
const gate = () =>
  readFileSync("components/features/tasks/NewAssignmentGate.tsx", "utf8");

/**
 * The same source with comments stripped.
 *
 * Needed because the file DOCUMENTS the bugs it fixed, quoting the broken lines
 * verbatim — which is worth keeping, and which makes a naive grep for the old
 * code match the explanation of why it is gone. Assertions about what the code
 * does read this; assertions about what it says read `gate()`.
 */
const gateCode = () =>
  gate()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

test("the snapshot listener is not detached once it has seen something", () => {
  /* **This was the bug.** The listener used to call `detach()` from inside
     `buildNotices` — the moment it saw any assigned task, before checking
     whether that task was one the person had already been told about. Somebody
     with one outstanding assignment from yesterday therefore killed it on the
     first snapshot, and every assignment made for the rest of the session
     arrived at a page with nothing watching. Reloading re-attached it, which is
     precisely the "I have to refresh to see the popup" symptom.

     Asserted as a COUNT because that is what distinguishes the two versions:
     the broken one detached in two places, the correct one only ever unmounts.
     A test scoped to the callback would have missed it — the offending call sat
     above the listener, not inside it. */
  const src = gateCode();
  const detaches = src.match(/detach\?\.\(\)/g) ?? [];
  assert.equal(
    detaches.length,
    1,
    `detach?.() is called ${detaches.length} times — the only legitimate one is the unmount cleanup, so a second means the notice has gone one-shot again`,
  );
  /* And the one that remains is the unmount cleanup. */
  assert.match(src, /return \(\) => \{[\s\S]*cancelled = true;[\s\S]*detach\?\.\(\);/);
  /* The listeners themselves are still attached; `detach` now closes over all
     of them rather than being one subscription. */
  assert.match(src, /onSnapshot\(/);
  assert.match(src, /detach = \(\) => detachers\.forEach/);
});

test("a rebuild is triggered by a NEW assigned id, not by any task edit", () => {
  /* Every edit to any of this person's tasks bumps `updatedAt` and re-fires the
     snapshot. Without this guard each one would cost a full `listTasks()` to
     discover there is nothing new to say. */
  const src = gateCode();
  assert.match(src, /builtFor/);
  assert.match(src, /const fresh = assignedIds\.filter/);
});

test("the listener's trigger state does not survive a remount", () => {
  /* **This regression broke the notice completely, and briefly.** The trigger
     set was a `useRef`, which survives a remount — and React StrictMode mounts
     every effect twice in development (`next.config.ts` sets
     `reactStrictMode: true`). Mount one's snapshot recorded the task id and
     started a build; the unmount cancelled that build; mount two's snapshot saw
     the id already recorded, took the "nothing new" path, and never built. The
     popup stopped appearing at all rather than merely appearing late.

     So the state has to be scoped to the LISTENER, not to the component: each
     effect run starts empty, and a cancelled build leaves nothing behind that
     can suppress its replacement. */
  const src = gateCode();
  assert.equal(
    /builtFor\s*=\s*useRef/.test(src),
    false,
    "the trigger set is a ref again — it will outlive a cancelled build and suppress the rebuild that should replace it",
  );
  assert.match(
    src,
    /const builtFor = new Set<string>\(\);/,
    "the trigger set is no longer declared inside the effect",
  );
  /* Declared after the effect opens, so it is genuinely per-listener. */
  const effectAt = src.indexOf("useEffect(() => {");
  assert.ok(effectAt > 0 && src.indexOf("const builtFor = new Set") > effectAt);
});

test("what has been SEEN is still decided by the stored list, not by the ref", () => {
  /* The ref is a cost guard. Conflating it with "already announced" is what
     produced a one-shot notice in the first place — `unseenNotices` against the
     persisted keys is the authority, and it has to stay that way. */
  assert.match(gateCode(), /unseenNotices\(all, readSeen\(\)\)/);
});

test("the snapshot trigger reads the DOMAIN status, not the raw legacy field", () => {
  /* **This is why the popup stopped appearing entirely.** The filter was
     `d.data().status === "assigned"`, comparing the raw Firestore field against
     a domain status NAME. Legacy has no such status: its own word for that
     state is `open`, which `toTaskStatus` maps to `assigned`. Almost every real
     assignment is written `status: "open"` by `taskForward.js`, so the filter
     matched nothing on every snapshot and no build ever ran — not late, never.

     Asserted on the source because the failure is a vocabulary mismatch between
     two layers, which no amount of exercising the pure rules can surface. */
  const src = gateCode();
  assert.match(
    src,
    /toTaskStatus\(t\) === "assigned"/,
    "the trigger no longer maps the legacy status — it is comparing raw Firestore data against a domain name again",
  );
  assert.equal(
    /d\.data\(\)\.status === "assigned"/.test(src),
    false,
    "the raw-field comparison is back; it matches almost nothing",
  );
});

test("the legacy statuses a real assignment is written with all map to assigned", () => {
  /* The concrete values `taskForward.js` and `cowork.js` write when work lands
     on somebody. If any of these stopped mapping to `assigned`, the notice
     would go quiet for that flow — which is the failure that just happened,
     one layer down. */
  const legacy = (status: string) =>
    toTaskStatus({ status, reviewState: "unknown" } as never);

  for (const status of ["open", "pending_deadline_approval", "deadline_approved"])
    assert.equal(legacy(status), "assigned", `legacy "${status}" no longer reads as assigned`);

  /* An unrecognised status is deliberately `assigned` — the neutral live state
     — so a new legacy status does not silently hide work. */
  assert.equal(legacy("some_new_status_nobody_mapped"), "assigned");

  /* And the states that must NOT announce: work already in flight, held at a
     gate, or finished. */
  for (const status of ["in_progress", "confirmed"])
    assert.equal(legacy(status), "in_progress");
  for (const status of ["pending_tl_approval", "pending_department_approval", "pending"])
    assert.equal(legacy(status), "pending_approval");
  for (const status of ["completed", "done", "approved"])
    assert.equal(legacy(status), "completed");
  assert.equal(legacy("cancelled"), "cancelled");
});

test("the trigger watches BOTH fields that can hold a task", () => {
  /* **This is what left the notice needing a refresh.** A task still at a gate
     — cross-department approval, TL hours — has an EMPTY `assigneeIds` and its
     person in `pendingAssigneeId`; `taskForward.js` only writes `assigneeIds`
     at the moment the task goes to `open`. A single `array-contains` listener
     therefore cannot see that whole class of work arrive.

     It looked like reloading fixed it because of an accident: on mount the
     trigger set is empty, so any OTHER existing task counts as fresh and starts
     a build — and the build reads `listTasks`, which resolves holders through
     `holdersOf` and does include pending assignees. The new task was found by
     the rebuild, never by the listener. */
  const src = gateCode();
  assert.match(
    src,
    /where\("assigneeIds", "array-contains", employeeId\)/,
    "the assignee listener is gone",
  );
  assert.match(
    src,
    /where\("pendingAssigneeId", "==", employeeId\)/,
    "work held at a gate is invisible to the trigger again — the notice will need a reload",
  );
  /* Both are torn down together; one leaked listener outlives the session. */
  assert.match(src, /detach = \(\) => detachers\.forEach/);
});

test("the pending listener's index is declared", () => {
  /* An undeclared composite index fails at runtime as SILENCE — onSnapshot
     calls the error callback and the screen simply shows no notice, which is
     indistinguishable from having no new work. */
  const declared = JSON.parse(
    readFileSync("firestore.indexes.json", "utf8"),
  ) as { indexes: { collectionGroup: string; fields: { fieldPath: string }[] }[] };
  const has = declared.indexes.some(
    (i) =>
      i.collectionGroup === "cowork_tasks" &&
      i.fields.map((f) => f.fieldPath).join(",") === "pendingAssigneeId,updatedAt",
  );
  assert.ok(has, "the pendingAssigneeId listener has no declared index — it will fail silently");
});
