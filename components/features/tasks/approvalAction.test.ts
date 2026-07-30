import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Why a department head saw "current action required" and no button.
 *
 * Two faults met, and each alone was enough to break it. These pin both at
 * their source plus the visibility rule on top, because fixing only the card
 * would have produced a button that failed when pressed.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const MAP = "lib/repositories/legacy/taskMap.ts";
const REPO = "lib/repositories/legacy/index.ts";
const CARD = "components/features/tasks/ApprovalActionCard.tsx";
const DETAIL = "components/features/tasks/TaskDetail.tsx";

/* ── Root cause 1: the array the button reads was always empty ────────────── */

test("pendingApprovals is built from the record, not hardcoded empty", () => {
  /* `TaskDetail` and `statusMeta` both find the viewer's approval with
     `pendingApprovals.find(a => a.approverId === me)`. An empty array never
     finds anything, so neither the button nor the "Approve or reject" label
     could ever appear. */
  const map = code(MAP);
  assert.equal(/pendingApprovals: \[\],/.test(map), false, "still hardcoded");
  assert.match(map, /pendingApprovals: pendingApprovalsFor\(/);
  assert.match(map, /function pendingApprovalsFor\(/);
});

test("only a pending approval is offered, never a waiting one", () => {
  /* The receiving side's entry is real but not yet theirs — the engine flips it
     to `pending` when the stage before clears. A button there offers an action
     the engine refuses. */
  const map = code(MAP);
  const block = map.slice(
    map.indexOf("function pendingApprovalsFor("),
    map.indexOf("export function toTaskView("),
  );
  assert.match(block, /a\.status === "pending"/);
  assert.equal(
    /a\.status === "waiting"/.test(block),
    false,
    "a waiting approver would be given a button",
  );
});

/* ── Root cause 2: the id the button would have sent ──────────────────────── */

test("the approval id is decoded before it reaches the endpoint", () => {
  /* An approval id is `${taskId}#approval-${n}`. The endpoint looks up a task,
     so passing it through sent `T631#approval-0` and produced "Task not found"
     — the same fault `reviewSubmission` had before it was given this decode. */
  const repo = code(REPO);
  const fn = repo.slice(repo.indexOf("async decideApproval("));
  assert.match(fn.slice(0, 900), /taskIdOf\(approvalId\)/);
  assert.equal(
    /const taskId = String\(approvalId\)/.test(fn.slice(0, 900)),
    false,
    "the composite id is used verbatim again",
  );
});

test("approval ids are built with the shared helper", () => {
  /* Hand-built ids and a shared decoder drift apart; this is why the decode
     failed silently rather than at the type level. */
  const map = code(MAP);
  assert.equal(/`\$\{legacy\.id\}#approval-/.test(map), false);
  assert.match(map, /compositeId\(legacy\.id, `approval-\$\{i\}`\)/);
});

/* ── Root cause 3: the decision was mislabelled ───────────────────────────── */

test("a department gate is not labelled an assignment", () => {
  /* `assignment` maps to the word "acceptance" in `statusMeta`, which produced
     "Awaiting acceptance from Rishee Ray" on a task nobody had been asked to
     accept — the decision in front of him was whether his department would send
     the work at all. */
  const map = code(MAP);
  assert.equal(/kind: "assignment" as const/.test(map), false);
  assert.match(map, /kind: "cross_department" as const/);
  const meta = code("components/features/tasks/statusMeta.ts");
  assert.match(meta, /cross_department: "department approval"/);
});

/* ── Visibility ───────────────────────────────────────────────────────────── */

test("the card renders for the current approver and nobody else", () => {
  const card = code(CARD);
  assert.match(card, /a\.approverId === viewerId && a\.kind === "cross_department"/);
  assert.match(card, /if \(!mine\) return null;/);
});

test("a refusal requires a reason and an approval does not", () => {
  /* The engine stores `rejectionReason` and has no field for why somebody
     agreed. Refusing silently leaves the sender a dead task and nothing to
     act on. */
  const card = code(CARD);
  assert.match(card, /reason\.trim\(\) === ""/);
  assert.match(card, /decide\(mine\.id, "rejected", reason\.trim\(\)\)/);
  assert.match(card, /decide\(mine\.id, "approved", ""\)/);
});

test("no send-back button is offered, because the engine has none", () => {
  /* `departmentApprove` takes `approved` as a boolean plus a rejection reason.
     A third button that quietly refused would be worse than its absence. */
  const card = code(CARD);
  for (const invented of ["Request changes", "Send back", "changes_requested"]) {
    assert.equal(card.includes(invented), false, `invented action: ${invented}`);
  }
  /* The engine takes a verb and a reason — `decision: "approve" | "reject"`.
     There is no third value it would accept, which is why there is no third
     button. (This asserted `approved: boolean` until the wire was corrected to
     match the route; the point it pins is the two-ness, not the field.) */
  const writes = code("lib/legacy/taskWrites.ts");
  const fn = writes.slice(writes.indexOf("export async function departmentApprove("));
  assert.match(fn.slice(0, 500), /decision: DepartmentDecision;/);
  assert.match(writes, /export type DepartmentDecision = "approve" \| "reject";/);
});

test("only one set of approve buttons can render", () => {
  /* Populating `pendingApprovals` also makes `nextAction` return "Approve or
     reject", so the generic action card's own buttons would appear alongside
     this one — two Approve buttons wired to the same endpoint. */
  const detail = code(DETAIL);
  assert.match(
    detail,
    /!v\.pendingApprovals\.some\(\s*\(a\) => a\.approverId === me && a\.kind === "cross_department",\s*\)/,
  );
});

test("the decision refreshes the task rather than moving state locally", () => {
  /* The next stage, the notifications and the assignee move all happen in the
     engine; the page's job is to read them back. */
  const card = code(CARD);
  assert.match(card, /if \(r\.ok\) onDone\(\)/);
  assert.equal(/setStatus\(|setApprov/.test(card), false, "local lifecycle state");
});

/* ── The budget stage ─────────────────────────────────────────────────────── */

test("the budget stage produces an approval, so its form has a trigger", () => {
  /* The root cause of "cross-department tasks never ask for a budget". With
     `hasTimer === false` the engine does NOT assign on the last approval — it
     sets `pending_tl_hours` and keeps the person in `pendingAssigneeId`
     (`taskForward.js:1083`) until hours arrive. Every part existed except this:
     `setEffortEstimate` is wired and `EffortEstimateForm` renders on
     `kind === "effort_estimate"`, but nothing ever produced one. */
  const map = code(MAP);
  const fn = map.slice(
    map.indexOf("function pendingApprovalsFor("),
    map.indexOf("export function toTaskView("),
  );
  assert.match(fn, /legacy\.status === "pending_tl_hours"/);
  assert.match(fn, /kind: "effort_estimate" as const/);
});

test("the budget stage is offered to the assignee's manager, and to nobody else", () => {
  /* Department plays no part. A department lead answers "may this
     cross-department work happen"; a manager answers "how many hours does this
     person get". The endpoint now refuses anyone but the assignee's manager, so
     this is the same single test. */
  const map = code(MAP);
  const fn = map.slice(
    map.indexOf("function pendingApprovalsFor("),
    map.indexOf("export function toTaskView("),
  );
  assert.match(fn, /!budgetOwner \|\| budgetOwner\.id !== viewer\.id/);
  assert.equal(/departmentId/.test(fn), false, "department logic is back");
  assert.equal(/isTeamLead/.test(fn), false, "a role test is back");
});

test("the budget stage is not labelled approve or reject", () => {
  /* It asks for a number. Offering approve/reject sends somebody looking for
     buttons that are deliberately absent. */
  const meta = code("components/features/tasks/statusMeta.ts");
  assert.match(meta, /mine\?\.kind === "effort_estimate"/);
  assert.match(meta, /"Set the time budget"/);
});

test("the approval card does not hijack the budget stage", () => {
  /* It suppresses the generic card only for `cross_department`, so the effort
     form still reaches the screen through the normal action card. */
  const card = code(CARD);
  assert.match(card, /a\.kind === "cross_department"/);
  const detail = code(DETAIL);
  assert.match(detail, /a\.kind === "cross_department"/);
});

test("the assignee is still held until the budget is set", () => {
  /* The security line. `pending_tl_hours` maps to `pending_approval`, so the
     timer control offers nothing and the queue does not count it — the person
     is in `pendingAssigneeId` and the engine's own `arrayUnion` inside
     `department-tl-set-hours` is what hands the task over. */
  const map = code(MAP);
  assert.match(map, /case "pending_tl_hours":/);
  const queue = code("lib/rules/tasks/activeQueue.ts");
  assert.equal(
    /pending_tl_hours/.test(queue),
    false,
    "a task awaiting its budget must not occupy a queue slot",
  );
});

/* ── One action at a time ─────────────────────────────────────────────────── */

test("a completed approval never renders as a live action", () => {
  /* T633: past both gates, at the budget stage, and the card still offered
     "Approve your department taking this work on" — whose button posted a
     department decision the engine answered with "This task is not waiting on a
     department approval." Matching on the viewer alone found the synthesised
     effort_estimate entry and treated it as an approval. */
  const card = code(CARD);
  assert.match(card, /task\.approvalReason === "cross_department"/);
  assert.match(card, /a\.kind === "cross_department"/);
});

test("the approval card and the budget form cannot both appear", () => {
  /* They key off the same array from opposite ends: the card requires the task
     to be IN department approval, and the budget form requires an
     effort_estimate entry, which only exists at `pending_tl_hours`. The two
     states are mutually exclusive in the engine, so the UI is too. */
  const map = code(MAP);
  const fn = map.slice(
    map.indexOf("function pendingApprovalsFor("),
    map.indexOf("export function toTaskView("),
  );
  /* The budget branch RETURNS — it never falls through to the gate list, so a
     task at the budget stage yields no cross_department entry at all. */
  assert.match(fn, /if \(legacy\.status === "pending_tl_hours"\)/);
  const budgetBranch = fn.slice(fn.indexOf('"pending_tl_hours"'));
  assert.match(budgetBranch.slice(0, 1400), /return \[\s*\{/);
  const reason = map.slice(map.indexOf("function approvalReasonOf("));
  assert.match(reason.slice(0, 500), /"pending_tl_hours":\s*\n?\s*return "effort_estimate"/);
});

test("invalid hours are refused before a request is made", () => {
  /* The engine refuses `val <= 0`; catching it here means the reader is not
     told about a field they cannot see. */
  const detail = code(DETAIL);
  assert.match(detail, /disabled=\{state\.isPending \|\| !\(hours > 0\)\}/);
});
