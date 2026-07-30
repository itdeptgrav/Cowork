import assert from "node:assert/strict";
import { test } from "node:test";
import { readTask } from "./tasks.ts";

/**
 * Acceptance criteria survive the read.
 *
 * They were saved correctly all along — T634 holds
 * `["shud match specs", "shud be luxurious"]`, and 23 of 48 production tasks
 * carry a non-empty array. Two faults lost them on the way back: the wire type
 * declared `requirements?: string` when every document holds an ARRAY, so the
 * field was never extracted; and the mapper then wrote `[]` under a comment
 * asserting that tasks do not have any.
 */

function doc(over: Record<string, unknown> = {}) {
  return { id: "T634", taskId: "T634", title: "t", status: "open", ...over } as never;
}

test("an array of criteria is read, in the order written", () => {
  const t = readTask(doc({ requirements: ["shud match specs", "shud be luxurious"] }));
  assert.deepEqual(t!.requirements, ["shud match specs", "shud be luxurious"]);
});

test("a task without criteria reads as none, not as a broken value", () => {
  for (const value of [undefined, null, [], "", 0, {}]) {
    const t = readTask(doc({ requirements: value }));
    assert.deepEqual(t!.requirements, [], `${JSON.stringify(value)} leaked through`);
  }
});

test("a lone string is tolerated, because the field is untyped at the source", () => {
  const t = readTask(doc({ requirements: "just the one" }));
  assert.deepEqual(t!.requirements, ["just the one"]);
});

test("blank entries are dropped rather than rendered as empty checkboxes", () => {
  const t = readTask(doc({ requirements: ["real", "   ", "", "also real"] }));
  assert.deepEqual(t!.requirements, ["real", "also real"]);
});

test("non-string entries do not become the string \"undefined\"", () => {
  const t = readTask(doc({ requirements: ["real", null, 42, { a: 1 }] }));
  assert.deepEqual(t!.requirements, ["real"]);
});
