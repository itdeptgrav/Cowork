import assert from "node:assert/strict";
import { test } from "node:test";
import { displayCase } from "./taskMap.ts";

/**
 * How legacy task records read once mapped.
 *
 * The wire is a decade of accumulated convention — names shouted in capitals,
 * gate stages the mapper used to discard. These pin the presentation choices
 * made at that boundary, so they are made once rather than in each component.
 */


test("a shouted legacy name is calmed for display", () => {
  /* The real record holds "RISHEE RAY". On a workflow diagram that reads as a
     bug rather than a person. */
  assert.equal(displayCase("RISHEE RAY"), "Rishee Ray");
  assert.equal(displayCase("SUBHADRA SAHOO"), "Subhadra Sahoo");
});

test("a name that already has case is left exactly as written", () => {
  /* Applying a casing rule to "McDonald" or "de Souza" damages a name its owner
     spelled deliberately — worse than leaving one shouting. */
  for (const name of ["Umung Arora", "McDonald", "de Souza", "Nabin kumar"]) {
    assert.equal(displayCase(name), name);
  }
});

test("hyphens and apostrophes start a word too", () => {
  assert.equal(displayCase("MARY-JANE O'BRIEN"), "Mary-Jane O'Brien");
});
