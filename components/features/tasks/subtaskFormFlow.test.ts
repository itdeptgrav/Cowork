import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Breaking a task down: what the form shows, what it saves, and what it no
 * longer refuses. Three reports from one press of "Break this down into
 * subtasks", 8 Sep 2026.
 *
 * 1. **It opened the wrong form first.** For as long as reading the parent
 *    took — a second or two — the plain New task form was on screen, type
 *    picker and all, and then it was replaced by the subtask form. One click,
 *    two pages, and the first was not the one anybody asked for.
 *
 * 2. **The requirement the subtask was raised to close was not on it.** The
 *    chooser above the form asks which of the parent's completion requirements
 *    this subtask satisfies; that claim was carried only as a link on the
 *    parent, so the child was created with the two criteria typed into its own
 *    form and no mention of the third thing it actually exists to do.
 *
 * 3. **A budget was refused against a date that did not exist yet.** Inside a
 *    reporting line no deadline is typed — one is derived at acceptance — so
 *    the form judged a queue projection instead, and a few hours of work behind
 *    a busy queue projects past almost any near date. Create went dead over a
 *    guess.
 *
 * Source-read, like the rest of this feature's guards: what is pinned is which
 * branch the form takes and what it passes to `createSubtask`, both of which
 * are visible in the text and neither of which a runtime test could reach
 * without a repository and a signed-in reader.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const FORM = code("components/features/tasks/NewTaskForm.tsx");
const RULES = code("lib/rules/tasks/criteria.ts");

/* ── 1. One click, one form ───────────────────────────────────────────────── */

test("nothing is drawn until the parent has been read", () => {
  /* The guard has to sit before the main return, or the plain form renders
     underneath it exactly as before. */
  const at = FORM.indexOf("if (presetParentTaskId && parentView.isLoading) {");
  assert.ok(at !== -1, "the form renders again before it knows what it is");
  const mainReturn = FORM.indexOf("return (\n    <>\n      <Breadcrumb");
  assert.ok(
    mainReturn > at,
    "the loading branch no longer comes before the form it is meant to replace",
  );
});

test("the wait is gated on there BEING a parent to wait for", () => {
  /* An ordinary New task has no parent to read and must not wait for one. */
  const at = FORM.indexOf("if (presetParentTaskId && parentView.isLoading) {");
  assert.match(
    FORM.slice(at, at + 120),
    /presetParentTaskId && parentView\.isLoading/,
  );
});

test("the type picker cannot appear while the parent is unknown", () => {
  /* It is the loudest part of the wrong form — five type cards that vanish. It
     renders under `!isSubtask`, which reads true for an unloaded parent, so the
     loading branch above is the only thing keeping it off the screen. */
  assert.match(FORM, /\{!isSubtask && \(/, "the type picker moved — re-check the loading branch");
});

/* ── 2. The claimed requirement is one of the subtask's criteria ──────────── */

test("the claimed requirements are read off the parent as text", () => {
  assert.match(
    FORM,
    /const claimedRequirementTexts = \(parent\?\.completion\.requirements \?\? \[\]\)\s*\.filter\(\(r\) => claims\.includes\(r\.requirement\.id\)\)\s*\.map\(\(r\) => r\.requirement\.text\);/,
    "the claimed requirements are no longer resolved to their text",
  );
});

test("what the subtask is created with is the merged list", () => {
  assert.match(
    FORM,
    /const subtaskRequirements = subtaskCriteria\(\s*claimedRequirementTexts,\s*requirements,\s*\);/,
  );
  assert.match(
    FORM,
    /requirements: subtaskRequirements,/,
    "createSubtask sends only the typed criteria again",
  );
});

test("the claim itself still goes as ids, unchanged", () => {
  /* The criteria are what a person reads; `satisfiesRequirementIds` is what the
     parent links by, and closing the requirement still depends on it. Writing
     the text must not have replaced it. */
  assert.match(FORM, /satisfiesRequirementIds: claims,/);
});

test("an ordinary task is unaffected", () => {
  /* `createTask` — a task in a project, or a plain new task — claims nothing
     and must still be created with exactly what was typed. */
  const at = FORM.indexOf("r.createTask({");
  assert.ok(at > 0, "createTask moved");
  const body = FORM.slice(at, at + 2000);
  assert.match(body, /^\s*requirements,$/m, "createTask no longer sends the typed criteria as they are");
  assert.doesNotMatch(body, /subtaskRequirements/, "an ordinary task inherited a claim it never made");
});

test("the form says the claimed requirements will be saved with it", () => {
  /* Otherwise the panel shows two rows and three are written, which is the
     mismatch that started this. Read-only: removing one here would contradict
     the claim made in the chooser above. */
  assert.match(FORM, /\{isSubtask && claimedRequirementTexts\.length > 0 && \(/);
  assert.match(FORM, /saved with it:/);
});

test("the merge rule is the one place that decides the list", () => {
  assert.match(RULES, /export function subtaskCriteria\(/);
  /* Inherited first, then typed — the requirement it was raised to close is
     the first thing a reviewer should read. */
  assert.match(RULES, /for \(const raw of \[\.\.\.inherited, \.\.\.typed\]\)/);
});

/* ── 3. No creation-time deadline cap ─────────────────────────────────────── */

test("the budget is not refused against the parent's deadline", () => {
  assert.doesNotMatch(FORM, /capApplies|capVerdict|capMessage/);
  assert.doesNotMatch(
    FORM,
    /subtaskDeadlineCap|capRefusal/,
    "the creation form imports the cap rule again",
  );
});

test("the projection that stood in for a date is gone with it", () => {
  /* It existed only to feed the cap: a `previewDeadlineFeasibility` read on
     every keystroke of the budget field, for a refusal that no longer happens. */
  assert.doesNotMatch(FORM, /previewDeadlineFeasibility/);
});

test("the create button no longer gates on any of it", () => {
  const at = FORM.indexOf("disabled={");
  assert.ok(at > 0, "the create button's disabled expression moved");
  assert.doesNotMatch(FORM.slice(at), /capVerdict|capApplies|parentDueAtMs/);
});

test("the budget field itself is untouched", () => {
  /* Removing the refusal must not have taken the control it sat under. */
  assert.match(FORM, /label="Budget"/);
  assert.match(FORM, /hint="Hours and minutes the assignee plans inside\."/);
});
