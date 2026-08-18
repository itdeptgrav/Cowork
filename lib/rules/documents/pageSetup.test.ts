import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PAGE_SETUP,
  MAX_HEADER_FOOTER_CHARS,
  MIN_MEASURE_IN,
  PAPER,
  clampZoom,
  contentWidthIn,
  fitZoom,
  pageSetupRefusal,
  pageSizeIn,
  readHeaderFooterText,
  readPageSetup,
  stepZoom,
} from "./pageSetup.ts";
import type { DocumentPageSetup } from "../../domain/documents.ts";

const setup = (over: Partial<DocumentPageSetup> = {}): DocumentPageSetup => ({
  ...DEFAULT_PAGE_SETUP,
  ...over,
  margins: { ...DEFAULT_PAGE_SETUP.margins, ...(over.margins ?? {}) },
});

test("landscape turns the same sheet rather than describing a different one", () => {
  const portrait = pageSizeIn(setup({ orientation: "portrait" }));
  const landscape = pageSizeIn(setup({ orientation: "landscape" }));
  assert.equal(landscape.widthIn, portrait.heightIn);
  assert.equal(landscape.heightIn, portrait.widthIn);
});

test("A4 is the ISO sheet, not Letter under another name", () => {
  /* Pinned because a paper table that quietly holds one size twice produces
     documents that print with the wrong margins and look almost right. */
  assert.notEqual(PAPER.a4.widthIn, PAPER.letter.widthIn);
  assert.ok(PAPER.a4.heightIn > PAPER.letter.heightIn);
});

test("the measure is the paper less both side margins", () => {
  assert.equal(contentWidthIn(setup({ margins: { ...DEFAULT_PAGE_SETUP.margins, left: 1.5, right: 0.5 } })), 8.5 - 2);
});

test("margins that leave no room to write are refused, with a reason", () => {
  const refusal = pageSetupRefusal(
    setup({ margins: { top: 1, bottom: 1, left: 4, right: 4 } }),
  );
  assert.ok(refusal, "expected a refusal");
  assert.match(refusal!, new RegExp(`${MIN_MEASURE_IN}`));
});

test("a negative margin is refused rather than treated as zero", () => {
  assert.ok(pageSetupRefusal(setup({ margins: { ...DEFAULT_PAGE_SETUP.margins, left: -1 } })));
});

test("an ordinary setup is not refused", () => {
  assert.equal(pageSetupRefusal(DEFAULT_PAGE_SETUP), null);
  assert.equal(
    pageSetupRefusal(setup({ paper: "a4", orientation: "landscape" })),
    null,
  );
});

test("a document written before page setup existed opens at the default", () => {
  assert.deepEqual(readPageSetup(null), DEFAULT_PAGE_SETUP);
  assert.deepEqual(readPageSetup(undefined), DEFAULT_PAGE_SETUP);
  assert.deepEqual(readPageSetup("letter"), DEFAULT_PAGE_SETUP);
});

test("a stored setup is read field by field, keeping what is usable", () => {
  const read = readPageSetup({
    paper: "a4",
    orientation: "landscape",
    margins: { top: 0.5, left: 0.75 },
  });
  assert.equal(read.paper, "a4");
  assert.equal(read.orientation, "landscape");
  assert.equal(read.margins.top, 0.5);
  assert.equal(read.margins.left, 0.75);
  /* Absent fields fall back rather than becoming zero — a zero margin is a
     deliberate choice and must not be arrived at by omission. */
  assert.equal(read.margins.right, DEFAULT_PAGE_SETUP.margins.right);
});

test("a stored setup that leaves no measure is discarded, not rendered", () => {
  assert.deepEqual(
    readPageSetup({ paper: "a5", margins: { left: 3, right: 3, top: 1, bottom: 1 } }),
    DEFAULT_PAGE_SETUP,
  );
});

test("zoom steps land on the round values the menu offers", () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.9);
  assert.equal(stepZoom(0.5, -1), 0.5, "the lowest step holds rather than wrapping");
  assert.equal(stepZoom(2, 1), 2);
});

test("zoom is clamped, and a non-number is 100% rather than NaN", () => {
  assert.equal(clampZoom(99), 4);
  assert.equal(clampZoom(0), 0.25);
  assert.equal(clampZoom(Number.NaN), 1);
});

test("fit-to-width divides the space by the page, not by the measure", () => {
  /* 816px is Letter at 96dpi. Half of it must be 50%, regardless of margins. */
  assert.equal(fitZoom(DEFAULT_PAGE_SETUP, 408), 0.5);
  assert.equal(
    fitZoom(setup({ margins: { top: 2, bottom: 2, left: 2, right: 2 } }), 408),
    0.5,
  );
});

/* ── Headers, footers & page numbers — added 18 Aug 2026 ─────────────────── */

test("a document from before headers existed reads as having none", () => {
  /* The stored setups in every existing document lack the three fields, and
     they must read as defaults rather than as broken. */
  const s = readPageSetup({ paper: "a4", orientation: "portrait", margins: {} });
  assert.equal(s.header, "");
  assert.equal(s.footer, "");
  assert.equal(s.pageNumbers, false);
});

test("header text is one bounded line, whatever was pasted", () => {
  /* These repeat on every printed page — a newline would push its second line
     into the text area, and a runaway string repeats with the pages. */
  assert.equal(readHeaderFooterText("Quarterly report\r\n2026"), "Quarterly report 2026");
  assert.equal(readHeaderFooterText("  spaced  "), "spaced");
  assert.equal(readHeaderFooterText("x".repeat(500)).length, MAX_HEADER_FOOTER_CHARS);
  assert.equal(readHeaderFooterText(42), "");
  assert.equal(readHeaderFooterText(null), "");
});

test("page numbers are on only when stored as exactly true", () => {
  assert.equal(readPageSetup({ pageNumbers: true }).pageNumbers, true);
  assert.equal(readPageSetup({ pageNumbers: "yes" }).pageNumbers, false);
  assert.equal(readPageSetup({ pageNumbers: 1 }).pageNumbers, false);
});

test("the stored fields round-trip through the reader", () => {
  const s = readPageSetup({
    header: "Cowork · internal",
    footer: "Confidential",
    pageNumbers: true,
  });
  assert.equal(s.header, "Cowork · internal");
  assert.equal(s.footer, "Confidential");
  assert.equal(s.pageNumbers, true);
});
