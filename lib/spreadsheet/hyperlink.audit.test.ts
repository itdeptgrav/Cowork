/**
 * Hyperlink audit — URL recognition/normalisation safety, the link map's
 * sparseness discipline, and link behaviour under structural operations.
 *
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { detectUrl, isUrl, linkAt, normalizeUrl, setLink } from "@/lib/spreadsheet/hyperlink";
import { createWorksheet, setCellValue, getCellValue } from "@/lib/spreadsheet/model";
import { insertCols } from "@/lib/spreadsheet/structure";

test("AUDIT: script-ish and lookalike schemes can never become a link", () => {
  for (const evil of [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>x</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "blob:https://x",
    "java\u0000script:alert(1)", // NUL-split scheme
    "java script:alert(1)", // space-split scheme
  ]) {
    assert.equal(normalizeUrl(evil), null, `${JSON.stringify(evil)} must not normalise`);
  }
});

test("AUDIT: case and surrounding whitespace are tolerated on safe schemes", () => {
  assert.equal(normalizeUrl("  https://example.com  "), "https://example.com");
  assert.equal(normalizeUrl("HTTPS://EXAMPLE.COM/Path"), "HTTPS://EXAMPLE.COM/Path");
  assert.equal(normalizeUrl("MailTo:a@b.co"), "MailTo:a@b.co");
});

test("AUDIT: bare domains promote to https; emails to mailto; prose does not", () => {
  assert.equal(normalizeUrl("sub.example.co.uk/deep/path?q=1"), "https://sub.example.co.uk/deep/path?q=1");
  assert.equal(normalizeUrl("first.last+tag@example.com"), "mailto:first.last+tag@example.com");
  assert.equal(normalizeUrl("not a url"), null);
  assert.equal(normalizeUrl("example"), null, "a single label is not a domain");
  assert.equal(detectUrl("see example.com for info"), null, "only a WHOLE-cell URL auto-links");
});

test("AUDIT: a bare host with a port is currently rejected (documented divergence)", () => {
  // "localhost:8080" parses as scheme "localhost:" under ANY_SCHEME, so it is
  // refused rather than promoted. Excel would link it; this module chooses the
  // conservative reading. Asserted so an intentional change shows up.
  assert.equal(normalizeUrl("localhost:8080"), null);
  assert.equal(normalizeUrl("example.com:8080/x"), null);
  assert.equal(isUrl("localhost:8080"), false);
});

test("AUDIT: setLink add/replace/clear keeps the map sparse and shares no-op references", () => {
  let links = setLink(undefined, "A1", "https://a.com");
  links = setLink(links, "B2", "https://b.com");
  assert.deepEqual(links, { A1: "https://a.com", B2: "https://b.com" });

  const same = setLink(links, "A1", "https://a.com");
  assert.equal(same, links, "setting the identical URL returns the same reference");

  const cleared = setLink(links, "A1", null);
  assert.deepEqual(cleared, { B2: "https://b.com" });
  assert.equal(linkAt(cleared, "A1"), undefined);

  assert.equal(setLink(cleared, "Z9", null), cleared, "clearing a missing link is a no-op");
  assert.equal(setLink(cleared, "B2", null), undefined, "the last link removes the map");
  assert.equal(setLink(undefined, "A1", null), undefined);
});

test("AUDIT: clearing a cell's VALUE does not orphan-delete its link (kept separate)", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = setCellValue(ws, 0, 0, "click me");
  ws = { ...ws, links: setLink(undefined, "A1", "https://kept.com") };
  ws = setCellValue(ws, 0, 0, "");
  assert.equal(getCellValue(ws, 0, 0), "");
  assert.equal(linkAt(ws.links, "A1"), "https://kept.com", "the link layer is independent");
});

test("structural ops move links with their cells (the old gap is closed)", () => {
  let ws = createWorksheet("s", "Sheet1", 10, 10);
  ws = setCellValue(ws, 0, 1, "linked"); // B1
  ws = { ...ws, links: setLink(undefined, "B1", "https://x.com") };
  const shifted = insertCols(ws, 0, 1);
  assert.equal(getCellValue(shifted, 0, 2), "linked", "the value moved to C1");
  assert.equal(linkAt(shifted.links, "C1"), "https://x.com", "and the link followed it");
  assert.equal(linkAt(shifted.links, "B1"), undefined);
});
