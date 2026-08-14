import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "../../legacy/backendSource.ts";
import { toDeadlineProposal, toPendingExtension } from "./deadlineMap.ts";
import { extensionFromAddition } from "../../rules/tasks/deadlineExtension.ts";

/**
 * The chosen amount, all the way from the dropdown to the screen.
 *
 * **It went missing in four places, and the form was not one of them.**
 *
 *   1. `requestExtension` declared `windowSecs?` while the contract and the
 *      form say `additionalSecs`, and forwarded NEITHER — the body it built
 *      carried only a date and a reason. TypeScript allowed the mismatch
 *      because method parameters are bivariant.
 *   2. `requestDeadlineExtension` had no seconds field at all.
 *   3. The legacy route destructured `{ proposedDate, reason }` and stored
 *      `deadlineExtRequest` with no window on it.
 *   4. `toPendingExtension` and `toDeadlineProposal` hardcoded
 *      `windowSecs: 0, previousWindowSecs: null`.
 *
 * Every layer agreed the amount did not exist, so the display was honest.
 *
 * All three figures are stored at REQUEST time. Deriving the addition later
 * cannot work: approving overwrites the window it was measured against, so a
 * difference computed at read time is zero for every extension ever granted.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const H = 3600;

/* ── 1 · The payload ──────────────────────────────────────────────────────── */

test("choosing +2 hours puts 7200 in the payload", () => {
  const e = extensionFromAddition({ previousWindowSecs: 2 * H, addedSecs: 2 * H });
  assert.equal(e.addedSecs, 7200);
  assert.equal(e.previousSecs, 7200);
  assert.equal(e.totalSecs, 14400);
});

test("the repository forwards the seconds instead of dropping them", () => {
  const src = code("lib/repositories/legacy/index.ts");
  const at = src.indexOf("async requestExtension(");
  assert.ok(at > 0);
  const fn = src.slice(at, at + 2400);
  assert.match(fn, /additionalSecs\?: number;/);
  assert.match(fn, /previousWindowSecs\?: number;/);
  assert.match(fn, /addedSecs: e\.addedSecs,/);
  assert.match(fn, /proposedWindowSecs: e\.totalSecs,/);
  /* The parameter that never matched the contract is gone. */
  assert.equal(
    /windowSecs\?: number;/.test(fn),
    false,
    "the mismatched parameter name is back",
  );
  /* And the sum is the rule's, not the repository's. */
  assert.match(fn, /extensionFromAddition\(\{/);
});

test("the request body carries all three figures", () => {
  const src = code("lib/legacy/taskWrites.ts");
  const at = src.indexOf("export async function requestDeadlineExtension(");
  const fn = src.slice(at, at + 1600);
  for (const f of ["previousWindowSecs", "addedSecs", "proposedWindowSecs"]) {
    assert.match(fn, new RegExp(`${f}: input\\.${f} \\?\\? 0`), `body omits ${f}`);
  }
});

test("the assignee's request is hours, and carries no date", () => {
  /* It used to send `dueAt + addedSecs` as a deadline proposal, straight to the
     assignor — the banned sum, sent to the wrong person. An assignee asks for
     working time; whether that needs a new date is decided further up, by the
     manager who can see their queue. */
  const src = code("components/features/tasks/DeadlinePanel.tsx");
  /* Its OWN record now, in its own store — not the deadline negotiation and
     not the budget negotiation either. */
  assert.match(src, /r\.requestTimeBudgetExtension\(\{/);
  assert.match(src, /requestedAdditionalSecs: extension\.addedSecs,/);
  assert.equal(
    /proposedDueAt|proposedDeadline/.test(
      src.slice(src.indexOf("requestTimeBudgetExtension"), src.indexOf("requestTimeBudgetExtension") + 400),
    ),
    false,
    "the assignee's request carries a date again",
  );
  /* The window comes from the one budget field, not a second reading. */
  assert.match(src, /const previousWindowSecs = view\.task\.estimatedEffortSecs \?\? 0;/);
  /* And the form still shows the sum it is sending. */
  assert.match(src, /formatDurationTimer\(extension\.totalSecs\)/);
});

/* ── 2 · The stored record ────────────────────────────────────────────────── */

test("the legacy route stores previous, added and total", (t) => {
  if (!backendAvailable()) return t.skip("engine checkout not present");
  const src = backendSource("routes/task_routes/taskForward.js");
  const at = src.indexOf('router.post("/task/:taskId/request-deadline-extension"');
  assert.ok(at > 0);
  const fn = src.slice(at, at + 4000);
  assert.match(fn, /const addedSecs = _num\(req\.body\.addedSecs\);/);
  assert.match(fn, /const previousWindowSecs = _num\(req\.body\.previousWindowSecs\);/);
  /* A total is derived when an older client sends only the parts. */
  assert.match(fn, /_num\(req\.body\.proposedWindowSecs\) \|\| \(previousWindowSecs \+ addedSecs\)/);
  const write = fn.slice(fn.indexOf("deadlineExtRequest: {"));
  for (const f of ["previousWindowSecs", "addedSecs", "proposedWindowSecs"]) {
    assert.match(write.slice(0, 500), new RegExp(`\\b${f},`), `record omits ${f}`);
  }
});

test("both copies of the route agree", (t) => {
  if (!backendAvailable()) return t.skip("engine checkout not present");
  /* Both register `/cowork` and taskForward wins on mount order. One patched
     and the other not is a bug waiting for somebody to reorder the mounts. */
  const twin = backendSource("routes/task_routes/taskTree.routes.js");
  const at = twin.indexOf('router.post("/task/:taskId/request-deadline-extension"');
  assert.ok(at > 0);
  assert.match(twin.slice(at, at + 4000), /const addedSecs = _num\(req\.body\.addedSecs\);/);
});

test("the mapper reads the stored amounts back", () => {
  const p = toPendingExtension(
    {
      deadlineExtRequest: {
        status: "pending",
        proposedDate: "2026-07-30T12:00:00.000Z",
        previousWindowSecs: 7200,
        addedSecs: 7200,
        proposedWindowSecs: 14400,
        requestedBy: "PRAMOD",
      },
    },
    "T646",
  )!;
  assert.equal(p.previousWindowSecs, 7200);
  assert.equal(p.addedSecs, 7200);
  assert.equal(p.windowSecs, 14400);
  assert.equal(p.isExtension, true);
});

test("a record written before the amounts existed says so", () => {
  /* Null, not zero. Zero reads as "they asked for nothing". */
  const p = toPendingExtension(
    {
      deadlineExtRequest: {
        status: "pending",
        proposedDate: "2026-07-30T12:00:00.000Z",
        requestedBy: "PRAMOD",
      },
    },
    "T646",
  )!;
  assert.equal(p.addedSecs, null);
  assert.equal(p.previousWindowSecs, null);
  assert.equal(p.windowSecs, 0);
});

/* ── 3 · The display ──────────────────────────────────────────────────────── */

test("the history renders the stored amount, never a difference", () => {
  /* The rule the fix turns on: approving overwrites the window, so a
     difference is zero for every granted extension. */
  const src = code("components/features/tasks/DeadlinePanel.tsx");
  assert.match(src, /p\.addedSecs !== null \?/);
  assert.match(src, /formatDurationTimer\(p\.addedSecs\)/);
  assert.equal(
    /p\.windowSecs - \(p\.previousWindowSecs/.test(src),
    false,
    "the history is differencing again",
  );
  /* And an unrecorded amount is named as a record from before the amounts
     were kept — not as a failure. "amount not recorded" read as a request that
     had gone wrong; "unavailable" read as something broken now. */
  assert.match(src, /Previous extension request/);
});

test("a granted extension in history keeps its amount", () => {
  const p = toDeadlineProposal(
    {
      newDueDate: "2026-07-30T12:00:00.000Z",
      editedBy: "TL",
      previousWindowSecs: 7200,
      addedSecs: 7200,
      proposedWindowSecs: 14400,
    },
    "T646",
    0,
  )!;
  assert.equal(p.addedSecs, 7200);
  assert.equal(p.windowSecs, 14400);
  assert.equal(p.isExtension, true);
  assert.equal(p.state, "approved");
});

test("a plain date change in history is not an extension", () => {
  const p = toDeadlineProposal(
    { newDueDate: "2026-07-30T12:00:00.000Z", editedBy: "TL" },
    "T646",
    0,
  )!;
  assert.equal(p.isExtension, false);
  assert.equal(p.addedSecs, null);
});

/* ── 4/5 · Approve and reject ─────────────────────────────────────────────── */

test("nothing outside the engine recalculates a deadline", () => {
  /* Approval raises the budget; the queue chain does the rest on the next
     read. No component adds hours to a date. */
  for (const f of [
    "components/features/tasks/DeadlinePanel.tsx",
    "lib/repositories/legacy/index.ts",
  ]) {
    const src = code(f);
    assert.equal(
      /dueAt\s*\+\s*|\.dueAt\).getTime\(\) \+ hours/.test(src),
      false,
      `${f} is doing deadline arithmetic`,
    );
  }
});
