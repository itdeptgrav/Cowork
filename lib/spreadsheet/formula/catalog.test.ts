import assert from "node:assert/strict";
import { test } from "node:test";
import { FUNCTIONS } from "@/lib/spreadsheet/formula/functions/index";
import {
  FUNCTION_HELP,
  matchFunctions,
  renderSignature,
} from "@/lib/spreadsheet/formula/catalog";

test("every registered function has a catalog entry", () => {
  const missing = Object.keys(FUNCTIONS).filter((name) => !FUNCTION_HELP[name]);
  assert.deepEqual(missing, [], `functions without help: ${missing.join(", ")}`);
});

test("the catalog describes no function that does not exist", () => {
  const stray = Object.keys(FUNCTION_HELP).filter((name) => !FUNCTIONS[name]);
  assert.deepEqual(stray, [], `help for unknown functions: ${stray.join(", ")}`);
});

test("each entry's name matches its key", () => {
  for (const [key, help] of Object.entries(FUNCTION_HELP)) {
    assert.equal(help.name, key);
  }
});

test("signatures render name-first with an optional bracket", () => {
  assert.equal(renderSignature(FUNCTION_HELP.SUM), "SUM(value1, [value2, …])");
  assert.equal(renderSignature(FUNCTION_HELP.ABS), "ABS(number)");
  assert.equal(renderSignature(FUNCTION_HELP.TODAY), "TODAY()");
});

test("matchFunctions is a case-insensitive prefix search, exact first", () => {
  assert.deepEqual(matchFunctions("if").slice(0, 1).map((h) => h.name), ["IF"]);
  assert.equal(matchFunctions("").length, 0);
  assert.ok(matchFunctions("sum").every((h) => h.name.startsWith("SUM")));
});
