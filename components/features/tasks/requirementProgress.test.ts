import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Ticking a requirement, without handing the assignee the reviewer's job.
 *
 * The circle beside each requirement was deliberately inert, and its comment
 * said why: acceptance criteria are the reviewer's reference during review, not
 * a checklist the submitter ticks to unlock submission. That reasoning is
 * intact — `isSatisfied` is still the reviewer's answer and still what gates a
 * submission, and nothing here writes it.
 *
 * What the inert circle also did was leave the person doing the work with no way
 * to say "I have finished this one", and whoever raised the task no way to see
 * it short of asking. That is what a progress mark records: a separate fact, in
 * its own collection, that notifies the creator and changes no rule.
 *
 * These pin the separation, because merging the two would be invisible in the
 * UI and enormous in consequence — the assignee would be able to satisfy their
 * own acceptance criteria and unlock their own submission.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const TOGGLE = "components/features/tasks/RequirementProgressToggle.tsx";
const PANEL = "components/features/tasks/ProjectPanel.tsx";
const TYPES = "lib/repositories/types.ts";
const ROUTE =
  "D:/GRAV_Project/grav-cms-backend/routes/task_routes/requirementProgress.routes.js";

/* ─────────────────────────────── the separation ─────────────────────────── */

test("a progress mark never writes requirement satisfaction", () => {
  /* The one that matters. `setRequirementSatisfied` is the reviewer's answer
     and is refused by the engine anyway; this must not reach for it. */
  const src = code(TOGGLE);
  assert.doesNotMatch(
    src,
    /setRequirementSatisfied/,
    "the toggle writes satisfaction, so the assignee can accept their own work",
  );
  assert.match(src, /setRequirementProgress/);
});

test("satisfaction arrives as a read-only prop", () => {
  const src = code(TOGGLE);
  assert.match(src, /satisfied: boolean/);
  assert.doesNotMatch(src, /setSatisfied/);
});

test("a met requirement is not pressable", () => {
  /* A progress mark about a question the reviewer has settled is noise, and
     offering one implies it still matters. */
  const src = code(TOGGLE);
  const met = src.slice(src.indexOf("if (satisfied) {"));
  assert.match(met.slice(0, 400), /<span/, "the met state renders a button");
  assert.doesNotMatch(met.slice(0, 400), /<button/);
});

test("it is stored in its own collection, not on the task", () => {
  /* Writing it onto the requirement would put a second answer beside the
     reviewer's on one question, with no rule for which wins. */
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /cowork_task_requirement_progress/);
  assert.doesNotMatch(
    route,
    /collection\("cowork_tasks"\)[\s\S]{0,200}\.update\(/,
    "the route edits the task document",
  );
});

/* ──────────────────────────────── persistence ───────────────────────────── */

test("the mark survives a refresh, because it is read back", () => {
  const src = code(PANEL);
  assert.match(src, /listRequirementProgress\(view\.task\.id\)/);
  assert.match(src, /marked=\{progressFor\(r\.requirement\.id\)\}/);
});

test("one document per requirement, so a second tick overwrites", () => {
  /* Otherwise the history piles up and "is it done" has several answers. */
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /\$\{taskId\}__\$\{requirementId\}/);
  assert.match(route, /\{ merge: true \}/);
});

/* ─────────────────────────────── who may mark ───────────────────────────── */

test("only the people the task is between", () => {
  /* A manager reading the task is looking at somebody else's checklist, and a
     tick from them would say the assignee had reported something they had not. */
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /const mayMark =/);
  assert.match(route, /res\.status\(403\)/);
  assert.match(code(PANEL), /const mayMarkProgress = isOwner \|\| isAssignee/);
});

test("it reads the fields a task document actually has", () => {
  /**
   * The first version guessed `assignedTo` and refused everybody — including
   * the person carrying the task, which is the whole point of the feature.
   *
   * A Cowork task holds `assigneeIds`, an ARRAY, because a task can be held by
   * more than one person; and while a cross-department task waits at its gate
   * the holder sits in `pendingAssigneeId` with `assigneeIds` still empty.
   * Reading only the first of those would refuse the assignee at exactly the
   * moment they are most likely to be marking work off.
   */
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /Array\.isArray\(task\.assigneeIds\)/);
  assert.match(route, /task\.pendingAssigneeId/);
  assert.doesNotMatch(route, /task\.assignedTo/, "the guessed field is back");
  /* Both directions of the fold, because they differ on a SELF task — there the
     engine deliberately makes the assigner somebody other than the creator. */
  assert.match(route, /task\.createdBy \?\? task\.assignedBy/);
  assert.match(route, /task\.assignedBy \?\? task\.createdBy/);
});

test("a refusal is shown on the row, not swallowed", () => {
  /* The whole output of this control is a small shape changing; a silent
     failure is indistinguishable from success. */
  const src = code(TOGGLE);
  assert.match(src, /role="alert"/);
  assert.match(src, /setError\(r\.message\)/);
});

/* ─────────────────────────────── notification ───────────────────────────── */

test("marking done tells the person who raised the task", () => {
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /if \(isDone && creator && creator !== me\)/);
  assert.match(route, /_notifyRequirementProgress/);
  assert.match(route, /cowork_notifications/);
});

test("unticking is not announced", () => {
  /* An untick is a correction. A notification for it would read as work having
     been undone. */
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /if \(isDone &&/, "the notification is not gated on done");
});

test("nobody is told about their own tick", () => {
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /creator !== me/);
});

test("a failed notification does not fail the tick", () => {
  /* The mark is the record; telling somebody is a courtesy on top of it. */
  const route = readFileSync(ROUTE, "utf8");
  const notify = route.slice(route.indexOf("async function _notifyRequirementProgress"));
  assert.match(notify.slice(0, 1800), /catch \(e\)/);
});

/* ──────────────────────────── what the creator sees ─────────────────────── */

test("the row names who marked it and when", () => {
  /* "Done" without a name is a claim nobody owns, and on a task with two people
     the first question about a tick is who left it. */
  const src = code(PANEL);
  assert.match(src, /Marked done by/);
  assert.match(src, /byName \|\| "the assignee"/);
  assert.match(src, /formatDateTime/);
});

test("the row still says the reviewer decides", () => {
  /* Replacing "checked by the reviewer" with a bare tick would quietly suggest
     the requirement had been accepted. It has not. */
  assert.match(code(PANEL), /The reviewer still decides whether it is met\./);
});

/* ─────────────────────── and what must not have changed ─────────────────── */

test("the engine still refuses to satisfy a requirement", () => {
  /* The refusal was correct and stays: there is no per-item satisfaction field
     on the task, and the reviewer is the one who answers that question. */
  const legacy = code("lib/repositories/legacy/index.ts");
  assert.match(
    legacy,
    /Requirements are not part of the Cowork engine's task model/,
  );
});

test("progress and satisfaction are separate methods on the interface", () => {
  const t = code(TYPES);
  assert.match(t, /setRequirementProgress\(input: \{/);
  assert.match(t, /setRequirementSatisfied\(/);
});
