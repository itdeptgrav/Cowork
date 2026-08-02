import assert from "node:assert/strict";
import { test } from "node:test";
import { assistRequestRefusal, MAX_CONTEXT_LENGTH, MAX_INSTRUCTION_LENGTH } from "./protocol.ts";

test("an empty instruction is refused", () => {
  assert.equal(
    assistRequestRefusal({ instruction: "   ", contextSummary: "" }),
    "Type an instruction first.",
  );
});

test("an instruction at the limit is accepted; one over is refused", () => {
  const atLimit = "a".repeat(MAX_INSTRUCTION_LENGTH);
  assert.equal(assistRequestRefusal({ instruction: atLimit, contextSummary: "" }), null);
  assert.match(
    assistRequestRefusal({ instruction: atLimit + "a", contextSummary: "" }) ?? "",
    /under 1500 characters/,
  );
});

test("oversized context is refused with the multi-selection message, not silently truncated", () => {
  const message = assistRequestRefusal({
    instruction: "Summarize this",
    contextSummary: "x".repeat(MAX_CONTEXT_LENGTH + 1),
  });
  assert.match(message ?? "", /too much context/);
});

test("a normal request passes", () => {
  assert.equal(
    assistRequestRefusal({ instruction: "Fix the grammar", contextSummary: "Selected: hello" }),
    null,
  );
});
