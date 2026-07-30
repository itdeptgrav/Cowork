import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  BUDGET_EXTENSION_REQUIRED,
  DEADLINE_EXTENSION_REQUIRED,
  PayloadError,
  documentBody,
} from "./firestorePayload.ts";
import { timeBudgetExtension, deadlineExtension } from "../tasks/extensionRecords.ts";
import { waitingSentence, budgetAction, deadlineAction } from "../tasks/extensionActions.ts";

/**
 * The crash, and why it happened three times.
 *
 *     Function addDoc() called with invalid data. Unsupported field value:
 *     undefined (found in field id in document cowork_task_budget_extensions/…)
 *
 * The intent was to strip the client-side id before writing. The expression was
 * `{ ...record, id: undefined }`, which does not remove a key — it sets it to
 * `undefined`, the one value Firestore refuses. Spreading cannot delete.
 *
 * Written three times, across two collections and the audit log, so a request
 * crashed whichever door it came through.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const H = 3600;

/* ── 1/2 · A valid, undefined-free document ───────────────────────────────── */

test("the id is removed, not blanked", () => {
  const body = documentBody({ id: "x", taskId: "T646" });
  assert.equal("id" in body, false, "id is still present");
  assert.equal(body.taskId, "T646");
});

test("no undefined survives, at any depth", () => {
  const body = documentBody({
    id: undefined,
    a: undefined,
    nested: { b: undefined, c: 1 },
    list: [{ d: undefined, e: 2 }],
  });
  const json = JSON.stringify(body);
  assert.equal(json.includes("undefined"), false);
  assert.deepEqual(body, { nested: { c: 1 }, list: [{ e: 2 }] });
});

test("null survives, because it means something", () => {
  /* `approvedAt: null` on a pending record says what an absent key does not. */
  const body = documentBody({ id: "x", approvedAt: null, counterDeadline: null });
  assert.equal(body.approvedAt, null);
  assert.ok("approvedAt" in body);
});

test("a real budget record produces a writable document", () => {
  const rec = timeBudgetExtension({
    taskId: "T646",
    requestedBy: "PRAMOD",
    approverId: "RAKESH",
    previousBudgetSecs: 2 * H,
    requestedAdditionalSecs: 2 * H,
    createdAt: "2026-07-30T04:30:00.000Z",
  });
  const body = documentBody(rec, BUDGET_EXTENSION_REQUIRED);
  assert.equal(body.type, "TIME_BUDGET_EXTENSION");
  assert.equal(body.newBudgetSecs, 4 * H);
  assert.equal(body.status, "pending");
  assert.equal("id" in body, false);
  for (const [k, v] of Object.entries(body)) {
    assert.notEqual(v, undefined, `${k} is undefined`);
  }
});

test("a real deadline record produces a writable document", () => {
  const rec = deadlineExtension({
    taskId: "T646",
    requestedBy: "RAKESH",
    approverId: "UMUNG",
    previousDeadline: null,
    proposedDeadline: "2026-08-02T06:30:00.000Z",
    createdAt: "2026-07-30T05:30:00.000Z",
  });
  const body = documentBody(rec, DEADLINE_EXTENSION_REQUIRED);
  assert.equal(body.type, "DEADLINE_EXTENSION");
  /* Dates only — no seconds crossed over. */
  assert.deepEqual(
    Object.keys(body).filter((k) => /secs|budget/i.test(k)),
    [],
  );
  assert.equal("id" in body, false);
});

test("a missing required field fails here, with the field named", () => {
  /* Rather than inside the SDK, with a message a user should never see. */
  for (const missing of ["taskId", "requestedBy", "createdAt"]) {
    const rec = {
      type: "TIME_BUDGET_EXTENSION",
      taskId: "T646",
      requestedBy: "PRAMOD",
      createdAt: "2026-07-30T04:30:00.000Z",
      [missing]: undefined,
    };
    assert.throws(
      () => documentBody(rec, BUDGET_EXTENSION_REQUIRED),
      (e: unknown) => e instanceof PayloadError && e.field === missing,
      `${missing} was accepted`,
    );
  }
});

test("NaN is refused too, and it arrives far more easily", () => {
  /* Any arithmetic on a missing number produces one, and Firestore rejects it
     the same way it rejects undefined. */
  assert.throws(
    () => documentBody({ id: "x", newBudgetSecs: Number.NaN }),
    (e: unknown) => e instanceof PayloadError && e.field === "newBudgetSecs",
  );
});

/* ── The three call sites ─────────────────────────────────────────────────── */

test("nothing spreads an undefined id any more", () => {
  const src = code("lib/repositories/legacy/index.ts");
  assert.equal(
    /id: undefined/.test(src),
    false,
    "the spread-and-blank pattern is back",
  );
  /* All three writes go through the validator. */
  assert.equal((src.match(/documentBody\(/g) ?? []).length, 3);
});

test("the SDK's words never reach the screen", () => {
  const src = code("lib/repositories/legacy/index.ts");
  const n = (src.match(/Unable to submit extension request\. Please try again\./g) ?? [])
    .length;
  assert.equal(n, 2, "both request paths must give the short message");
  /* And the cause is logged rather than swallowed. */
  assert.match(src, /console\.error\("\[requestTimeBudgetExtension\]", e\)/);
  assert.match(src, /console\.error\("\[requestDeadlineExtensionRecord\]", e\)/);
  /* The old passthrough is gone. */
  assert.equal(
    /message:\s*\n?\s*e instanceof Error \? e\.message : "The request could not be saved\."/.test(src),
    false,
    "the SDK message is being shown again",
  );
});

/* ── 12 · No "waiting" without an action ──────────────────────────────────── */

test("a waiting line names the person AND what they must do", () => {
  const nameOf = (id: string) =>
    ({ RAKESH: "Rakesh Biswal", UMUNG: "Umung Arora" })[id] ?? id;

  const b = budgetAction(
    timeBudgetExtension({
      taskId: "T646",
      requestedBy: "PRAMOD",
      approverId: "RAKESH",
      previousBudgetSecs: 2 * H,
      requestedAdditionalSecs: 2 * H,
    }),
  );
  assert.equal(
    waitingSentence(b, nameOf),
    "Rakesh Biswal needs to review the request for additional working time",
  );

  const d = deadlineAction(
    deadlineExtension({
      taskId: "T646",
      requestedBy: "RAKESH",
      approverId: "UMUNG",
      previousDeadline: null,
      proposedDeadline: "2026-08-02T06:30:00.000Z",
    }),
  );
  assert.equal(
    waitingSentence(d, nameOf),
    "Umung Arora needs to approve the revised deadline",
  );

  /* Nothing outstanding produces no sentence at all. */
  assert.equal(
    waitingSentence({ kind: "none", ownerId: null, prompt: "" }, nameOf),
    null,
  );
});

test("no surface renders a bare \"Waiting for\"", () => {
  /* A name with no verb tells a reader somebody is blocking them and not what
     that person must do — and says nothing at all to the person named, who is
     usually the one reading it. */
  for (const f of [
    "components/features/tasks/ExtensionTimeline.tsx",
    "components/features/tasks/ExtensionDecisionCard.tsx",
    "components/features/tasks/CounterDeadlineCard.tsx",
  ]) {
    assert.equal(
      /Waiting for \{/.test(code(f)),
      false,
      `${f} shows a bare "Waiting for"`,
    );
  }
  assert.match(
    code("components/features/tasks/ExtensionTimeline.tsx"),
    /needs to/,
  );
});

test("the legacy wording no longer diagnoses a fault", () => {
  const src = code("components/features/tasks/DeadlinePanel.tsx");
  assert.match(src, /Previous extension request/);
  for (const wrong of ["Historical extension record", "amount not recorded"]) {
    assert.equal(src.includes(wrong), false, `"${wrong}" is back`);
  }
});
