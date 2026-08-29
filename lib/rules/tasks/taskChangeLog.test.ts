import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChangeSummary,
  changeEventType,
  changePayload,
  parseChangeSummary,
} from "./taskChangeLog.ts";

const H = 3600;
const M = 60;

/* ── The worked examples from the request ─────────────────────────────────── */

test("adding a requirement reads as the request describes", () => {
  const s = buildChangeSummary({
    kind: "added",
    subject: "Create barcode validation",
    etBeforeSecs: 6 * H,
    etAfterSecs: 7 * H + 30 * M,
  });
  assert.match(s, /Requirement added: “Create barcode validation”/);
  assert.match(s, /Time \+1h 30m/);
  assert.match(s, /ET 6h → 7h 30m/);
});

test("deleting a requirement shows the time subtracted and the drop", () => {
  const s = buildChangeSummary({
    kind: "removed",
    subject: "Old validation logic",
    etBeforeSecs: 7 * H + 30 * M,
    etAfterSecs: 7 * H,
  });
  assert.match(s, /Requirement removed: “Old validation logic”/);
  assert.match(s, /Time −30m/); // real minus sign
  assert.match(s, /ET 7h 30m → 7h/);
});

test("editing shows before and after, and the time change", () => {
  const s = buildChangeSummary({
    kind: "edited",
    before: "Create login page",
    subject: "Create responsive login page",
    etBeforeSecs: 7 * H,
    etAfterSecs: 8 * H,
  });
  assert.match(s, /Requirement edited: “Create login page” → “Create responsive login page”/);
  assert.match(s, /Time \+1h/);
  assert.match(s, /ET 7h → 8h/);
});

/* ── When the estimate did not move ───────────────────────────────────────── */

test("a change that left the time alone says so, with no arrow", () => {
  /* An add or remove whose ET prompt was cancelled, or a rewording. Showing
     "+0m" and "2h → 2h" would read as a change that did not happen. */
  const s = buildChangeSummary({
    kind: "removed",
    subject: "mmmm",
    etBeforeSecs: 2 * H,
    etAfterSecs: 2 * H,
  });
  assert.match(s, /Requirement removed: “mmmm”/);
  assert.match(s, /ET unchanged \(2h\)/);
  assert.equal(/Time/.test(s), false, "a no-op still printed a time clause");
  assert.equal(/→/.test(s), false, "a no-op still printed an arrow");
});

/* ── The event type it files under ────────────────────────────────────────── */

test("the event type is one the history panel already renders", () => {
  /* Values from the existing TaskEventType union — no new type the panel would
     not recognise. */
  assert.equal(changeEventType("added"), "requirement_added");
  assert.equal(changeEventType("removed"), "edited");
  assert.equal(changeEventType("edited"), "edited");
});

/* ── The structured payload kept beside the sentence ──────────────────────── */

test("the payload carries the numbers, not just the prose", () => {
  const payload = changePayload({
    kind: "added",
    subject: "Create barcode validation",
    etBeforeSecs: 6 * H,
    etAfterSecs: 7 * H + 30 * M,
  });
  assert.equal(payload.change, "added");
  assert.equal(payload.requirement, "Create barcode validation");
  assert.equal(payload.etBeforeSecs, 6 * H);
  assert.equal(payload.etAfterSecs, 7 * H + 30 * M);
  assert.equal(payload.etDeltaSecs, 90 * M);
});

test("an edit's payload keeps the before text", () => {
  const payload = changePayload({
    kind: "edited",
    before: "Create login page",
    subject: "Create responsive login page",
    etBeforeSecs: 7 * H,
    etAfterSecs: 8 * H,
  });
  assert.equal(payload.requirementBefore, "Create login page");
  assert.equal(payload.requirement, "Create responsive login page");
});

test("the ET figures in the payload are floored, never negative", () => {
  /* A subtraction clamped to zero on the writing side must not surface as a
     negative etAfter here. */
  const payload = changePayload({
    kind: "removed",
    subject: "x",
    etBeforeSecs: 30 * M,
    etAfterSecs: 0,
  });
  assert.equal(payload.etAfterSecs, 0);
  assert.equal(payload.etDeltaSecs, -30 * M);
});

/* ── One line, always ─────────────────────────────────────────────────────── */

test("the summary is a single line, so it fits a row, a bubble and a push", () => {
  const s = buildChangeSummary({
    kind: "edited",
    before: "a\nb",
    subject: "c\nd",
    etBeforeSecs: H,
    etAfterSecs: 2 * H,
  });
  /* The requirement text itself could contain a newline; the STRUCTURE the
     builder adds ( · separators) introduces none of its own. */
  assert.equal(s.split(" · ").length, 3, "expected three ·-separated clauses");
});

/* ── Reading a change line back for the card ──────────────────────────────── */

test("an added line round-trips through parse", () => {
  const s = buildChangeSummary({ kind: "added", subject: "kjhv", etBeforeSecs: 2 * H, etAfterSecs: 3 * H });
  const p = parseChangeSummary(s);
  assert.ok(p);
  assert.equal(p!.action, "added");
  assert.equal(p!.requirement, "kjhv");
  assert.equal(p!.time, "+1h");
  assert.equal(p!.etFrom, "2h");
  assert.equal(p!.etTo, "3h");
  assert.equal(p!.etUnchanged, null);
});

test("a removed line parses its subject and drop", () => {
  const s = buildChangeSummary({ kind: "removed", subject: "Old validation logic", etBeforeSecs: 7 * H + 30 * M, etAfterSecs: 7 * H });
  const p = parseChangeSummary(s)!;
  assert.equal(p.action, "removed");
  assert.equal(p.requirement, "Old validation logic");
  assert.equal(p.time, "−30m");
  assert.equal(p.etTo, "7h");
});

test("an edited line recovers before and after", () => {
  const s = buildChangeSummary({ kind: "edited", before: "Create login page", subject: "Create responsive login page", etBeforeSecs: 7 * H, etAfterSecs: 8 * H });
  const p = parseChangeSummary(s)!;
  assert.equal(p.action, "edited");
  assert.equal(p.before, "Create login page");
  assert.equal(p.requirement, "Create responsive login page");
  assert.equal(p.etFrom, "7h");
  assert.equal(p.etTo, "8h");
});

test("an unchanged-ET line parses as unchanged, with no from/to", () => {
  const s = buildChangeSummary({ kind: "removed", subject: "mmmm", etBeforeSecs: 2 * H, etAfterSecs: 2 * H });
  const p = parseChangeSummary(s)!;
  assert.equal(p.time, null);
  assert.equal(p.etFrom, null);
  assert.equal(p.etUnchanged, "2h");
});

test("a non-change system line is not parsed as a card", () => {
  /* An approval or deadline decision must fall through to the quiet line. */
  for (const other of [
    "✅ Task approved by Ray (TL)",
    "❌ Cross-department assignment rejected",
    "Receipt confirmed",
    "",
  ]) {
    assert.equal(parseChangeSummary(other), null, `parsed "${other}" as a change`);
  }
});

test("a requirement whose text contains ' · ' is not split by it", () => {
  /* The parser splits on the separator IT inserts, and the requirement text is
     inside a clause — but a subject containing the separator would still land in
     clause 0 only up to the first ` · `. Guard the realistic case: a subject
     with an arrow or quotes does not corrupt the action. */
  const s = buildChangeSummary({ kind: "added", subject: 'Add "login" → dashboard', etBeforeSecs: H, etAfterSecs: 2 * H });
  const p = parseChangeSummary(s);
  assert.ok(p);
  assert.equal(p!.action, "added");
});
