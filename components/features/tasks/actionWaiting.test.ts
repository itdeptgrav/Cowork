import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createStageLabel, createWaitNote } from "@/lib/rules/tasks/createProgress";

/**
 * Saying what the wait is.
 *
 * Every action button already turned into "Approving…" with a ring, which
 * answers "is this working?" and not "why is this taking so long?" — and the
 * second question is the one that gets a button pressed twice.
 *
 * Two rules run through all of this and neither can be relaxed:
 *
 *  · **Nothing is simulated.** Every line describes work that is really being
 *    done at the moment it is shown. A fake progress bar would be a lie told
 *    to somebody who is already waiting.
 *  · **A busy button stays busy for the whole press.** Where a handler does
 *    more than one round trip, the pending flag from the first one is not the
 *    press — it went false while files were still going up, un-spinning the
 *    button and re-opening it to a second click on an action that was still
 *    running.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const FORM = code("components/features/tasks/NewTaskForm.tsx");
const SUBMISSION = code("components/features/tasks/SubmissionPanel.tsx");
const WAIT = code("components/ui/ActionWait.tsx");

/* ── The line itself ──────────────────────────────────────────────────────── */

test("it says nothing until the wait has become one", () => {
  /* On a fast press the whole thing is over in a few hundred milliseconds, and
     an explanation that flashes up and vanishes makes a quick action feel
     slow. */
  assert.match(WAIT, /export const EXPLAIN_AFTER_MS = 900;/);
  assert.match(WAIT, /setTimeout\(\(\) => setSlow\(true\), afterMs\)/);
  assert.match(WAIT, /if \(!slow\) return null;/);
});

test("it is announced, not just drawn", () => {
  /* It appears part-way through an interaction somebody has committed to, so a
     screen reader has to be told — politely, which is what `status` means. */
  assert.match(WAIT, /role="status"/);
});

test("the explanation describes what the engine really does", () => {
  /* Not "please wait". The route writes the change, tells everyone on the task
     and renumbers their queues before replying, and that is worth knowing. */
  assert.match(WAIT, /export const TASK_WRITE_WAIT =/);
  assert.match(WAIT, /notified and their priority lists are put back in order/);
});

test("one sentence, in one place, for every task action", () => {
  /* Approve, submit, start, reject and accept all funnel through the same
     route, so the same sentence is true of all of them — and copied into ten
     components it would stop being true of some of them. */
  const surfaces = [
    "components/features/tasks/ReviewPanel.tsx",
    "components/features/tasks/ApprovalActionCard.tsx",
    "components/features/tasks/AssignmentConfirmationCard.tsx",
    "components/features/tasks/TaskDetail.tsx",
    "components/features/tasks/SubmissionPanel.tsx",
    "components/features/tasks/NewTaskForm.tsx",
  ];
  for (const path of surfaces) {
    const src = code(path);
    assert.match(src, /<ActionWait/, `${path} has no waiting line`);
    assert.ok(
      !src.includes("priority lists are put back in order"),
      `${path} restates the explanation instead of using the shared one`,
    );
  }
});

/* ── Creating a task: three round trips, named ────────────────────────────── */

test("the stage is set where the stage actually changes", () => {
  const handler = FORM.slice(FORM.indexOf('setStage("task");'));
  const task = handler.indexOf('setStage("task")');
  const created = handler.indexOf("const r = await create()");
  const extras = handler.indexOf('setStage("extras")');
  const opening = handler.indexOf('setStage("opening")');
  const push = handler.indexOf("router.push(");
  assert.ok(task < created, "the stage is set after the work it describes");
  assert.ok(created < extras, "attaching is announced before the task exists");
  assert.ok(extras < opening && opening < push, "opening is announced late");
});

test("a refused create drops the busy state rather than hanging", () => {
  const handler = FORM.slice(FORM.indexOf('setStage("task");'));
  assert.match(
    handler.slice(0, 300),
    /if \(!r\.ok\) \{\s*setStage\(null\);\s*return;\s*\}/,
  );
});

test("the button stays busy for the whole press", () => {
  /* `useAction`'s own pending covers the first round trip only. */
  assert.match(FORM, /loading=\{state\.isPending \|\| stage !== null\}/);
  assert.match(FORM, /state\.isPending \|\|\s*\n?\s*stage !== null \|\|/);
  assert.match(SUBMISSION, /loading=\{state\.isPending \|\| sending\}/);
  assert.match(
    SUBMISSION,
    /disabled=\{state\.isPending \|\| sending \|\| !message\.trim\(\)\}/,
  );
});

test("the busy flag is released whichever way the handler leaves", () => {
  /* A `return` on a refusal must not strand the button. */
  const handler = SUBMISSION.slice(SUBMISSION.indexOf("setSending(true);"));
  assert.match(handler.slice(0, 4000), /\} finally \{\s*setSending\(false\);\s*\}/);
});

/* ── The words ────────────────────────────────────────────────────────────── */

test("each stage says what is happening in that stage", () => {
  assert.match(createWaitNote("task", 0, 0), /Creating a task is more than a save/);
  assert.match(createWaitNote("extras", 3, 0), /sending its 3 files/);
  assert.match(createWaitNote("extras", 1, 0), /sending its 1 file\b/);
  assert.match(createWaitNote("extras", 2, 1), /2 files and 1 output/);
  assert.equal(createWaitNote("opening", 0, 0), "Opening the task…");
});

test("a create with nothing attached does not claim to be attaching", () => {
  assert.equal(createWaitNote("extras", 0, 0), "The task exists. Opening it…");
});

test("the label is short and the line is the explanation", () => {
  /* Different jobs: the label is for a glance, the line is for somebody who
     has started to wonder. */
  assert.equal(createStageLabel("task"), "Creating…");
  assert.equal(createStageLabel("extras"), "Attaching…");
  assert.equal(createStageLabel("opening"), "Opening…");
});

/* ── The part that is actually faster ─────────────────────────────────────── */

test("staged files go up together, not one after another", () => {
  /* Each is an independent write against a record that already exists, so the
     serial loop paid a whole round trip per file on the critical path. */
  for (const src of [FORM, SUBMISSION]) {
    assert.match(src, /uploadAll\(/);
    assert.ok(
      !/for \(const file of stage?d\w*\) \{/.test(src),
      "the serial upload loop is back",
    );
  }
});

test("outputs and files are sent together, since neither reads the other", () => {
  const handler = FORM.slice(FORM.indexOf('setStage("extras");'));
  assert.match(handler.slice(0, 1200), /const \[, failed\] = await Promise\.all\(\[/);
  assert.match(handler.slice(0, 1200), /repo\.setOutputs\(\{/);
  assert.match(handler.slice(0, 1200), /uploadAll\(stagedFiles,/);
});

test("files still go up only after the task exists", () => {
  /* Unchanged, and not negotiable: the engine checks permission against the
     task, so an upload before there is one has nothing to check. */
  const handler = FORM.slice(FORM.indexOf("const r = await create()"));
  assert.ok(handler.indexOf("uploadAll(") > handler.indexOf("create()"));
  assert.match(handler.slice(0, 1600), /entityId: r\.data\.id/);
});
