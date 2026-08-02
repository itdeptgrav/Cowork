import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The subtask body, against the route that reads it.
 *
 * A delegated task arrived with no time on it for one reason: this file sent
 * `dueDate` and `windowSecs`, and `POST /cowork/task/:taskId/subtask`
 * destructures `hasTimer`, `senderTimerWindowSecs` and `fixedDeadline`. Nothing
 * threw and nothing warned — the route read three undefined values, `Number(
 * undefined) || 0` gave a budget of zero, and the subtask was created as a
 * timer task with no time in it.
 *
 * That class of fault is invisible to a type checker: both sides are correct on
 * their own and only the pairing is wrong. So the field names are asserted as
 * text here, which is the only place the two can be compared at all — the
 * engine is a separate repository in a separate language.
 *
 * **If the route's destructure changes, this test is where it is noticed.**
 * `taskForward.js:1399` is the line to check against.
 */

const source = readFileSync(
  new URL("./taskWrites.ts", import.meta.url),
  "utf8",
);

/** The body of `createSubtask`, up to the next exported function. */
function createSubtaskSource(): string {
  const from = source.indexOf("export async function createSubtask(");
  assert.ok(from > 0, "createSubtask is missing from taskWrites.ts");
  const after = source.indexOf("export async function", from + 10);
  return source.slice(from, after > from ? after : undefined);
}

/** Every name the engine's destructure pulls off `req.body`. */
const ENGINE_READS = [
  "title",
  "assigneeIds",
  "description",
  "satisfiesRequirementIds",
  "hasTimer",
  "senderTimerWindowSecs",
  "fixedDeadline",
] as const;

test("every field sent is one the engine actually reads", () => {
  const body = createSubtaskSource();
  for (const name of ENGINE_READS) {
    assert.match(
      body,
      new RegExp(`\\b${name}\\s*:`),
      `createSubtask must send \`${name}\` — the route destructures it`,
    );
  }
});

test("the names the route never reads are gone", () => {
  const body = createSubtaskSource();
  /* The two that shipped. `dueDate` and `windowSecs` are real names elsewhere
     in this file — on routes that do read them — so this asserts only about
     the subtask body. */
  for (const dead of ["dueDate:", "windowSecs:"]) {
    assert.ok(
      !body.includes(dead),
      `createSubtask must not send \`${dead}\` — the subtask route ignores it, which is how a subtask came to be created with a budget of zero`,
    );
  }
});

test("the budget and the fixed date are mutually exclusive on the wire", () => {
  const body = createSubtaskSource();
  /* The engine picks which one to read from `hasTimer` alone. Sending a window
     alongside a date would leave the unread one on the document as a value
     nothing honours — and the deadline shown would not be the one enforced. */
  assert.match(
    body,
    /hasTimer:\s*onTimer/,
    "hasTimer must state the mode explicitly rather than relying on the route's default",
  );
  assert.match(
    body,
    /senderTimerWindowSecs:\s*onTimer\s*\?/,
    "the window must be sent only on a timer subtask",
  );
  assert.match(
    body,
    /fixedDeadline:\s*onTimer\s*\?\s*null/,
    "the fixed date must be null on a timer subtask",
  );
});
