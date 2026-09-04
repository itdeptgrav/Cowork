import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Why Recorded audio and History are shut, and why only those two.
 *
 * They are the rail's only unbounded panels — one row per clip, one line every
 * time anybody joins or leaves. A meeting with twenty-two clips from four
 * people put twenty-two rows in the rail, and between them the two logs were
 * most of the page's height and none of its usual reading.
 *
 * They are also the only two nobody reads in passing. Details, Participants and
 * the transcript answer questions you have while looking at the page; these
 * answer questions you came for. So they sit last and start shut.
 *
 * The rule that keeps this honest: **minimising costs the detail, never the
 * answer.** A shut panel still carries its headline — "22 files from 4 people",
 * "18 changes" — because a closed panel you must open to learn there is nothing
 * inside is worse than an open one.
 */

function code(path: string): string {
  /* CRLF → LF FIRST, before anything searches this text.
     Every source file in this repo is stored with CRLF endings, and the
     assertions below look for multi-line shapes written with "\n" — so
     `indexOf` returned -1 on text that was present, and two tests failed
     claiming "the chevron lost aria-hidden" and "the two logs are not
     adjacent" when both were correct in the source all along. A test that
     reports a fault which is not there is worse than having no test. */
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DETAIL = "components/features/meetings/MeetingDetailArea.tsx";
const RECORDINGS = "components/features/meetings/RecordingsPanel.tsx";
const COLLAPSIBLE = "components/features/meetings/CollapsiblePanel.tsx";

test("both logs start shut", () => {
  const src = code(COLLAPSIBLE);
  assert.match(src, /defaultOpen = false/, "the default is no longer shut");
  /* Neither call site opts out. */
  for (const path of [DETAIL, RECORDINGS]) {
    assert.doesNotMatch(code(path), /defaultOpen/, `${path} overrides the default`);
  }
});

test("a shut panel still answers the question it exists for", () => {
  /* The whole difference between minimised and useless. */
  const src = code(RECORDINGS);
  assert.match(src, /summary=\{summary\}/);
  assert.match(src, /files?\$\{rows\.length === 1 \? "" : "s"\}/);
  assert.match(src, /No audio was recorded\./, "a meeting with nothing recorded says so while shut");
  assert.match(src, /does not store recordings/, "an engine with no store says so while shut");
});

test("History's shut headline counts the changes", () => {
  const src = code(DETAIL);
  assert.match(src, /change\$\{events\.data\.length === 1 \? "" : "s"\}/);
  assert.match(src, /"Nothing recorded\."/);
});

test("the two logs are grouped together, last", () => {
  const src = code(DETAIL);
  const heading = src.indexOf("<RailHeading>Files and history</RailHeading>");
  const recordings = src.indexOf("<RecordingsPanel");
  const history = src.indexOf('<CollapsiblePanel\n            title="History"');
  assert.ok(heading !== -1, "the group is unnamed");
  assert.ok(heading < recordings, "Recorded audio sits above its own heading");
  assert.ok(recordings < history, "the two logs are not adjacent");
});

test("the guest link moved up, out of the logs", () => {
  /* It is about access to the meeting, not a record of it, and it is short. */
  const src = code(DETAIL);
  const guest = src.indexOf('<Panel label="Guest link">');
  const filesHeading = src.indexOf("<RailHeading>Files and history</RailHeading>");
  assert.ok(guest !== -1 && filesHeading !== -1);
  assert.ok(guest < filesHeading, "the guest link is still filed under the logs");
});

test("the panels that answer at a glance stay open", () => {
  /* Details, Participants, Transcript and Summary are read in passing. Shutting
     them would trade the page's usefulness for its tidiness. */
  const src = code(DETAIL);
  for (const name of ["Details", "Participants", "Transcript", "AI Summary"]) {
    assert.match(
      src,
      new RegExp(`<Panel label="${name}"`),
      `${name} became collapsible`,
    );
  }
});

test("it is a disclosure to a screen reader, not a mystery button", () => {
  const src = code(COLLAPSIBLE);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /aria-controls=\{bodyId\}/);
  assert.match(src, /id=\{bodyId\}/);
  assert.match(src, /useId\(\)/);
});

test("the whole header is the target, not just the chevron", () => {
  const src = code(COLLAPSIBLE);
  const button = src.slice(src.indexOf("<button"), src.indexOf("</button>"));
  assert.match(button, /w-full/, "the pressable area is narrower than the panel");
});

test("shut content is unmounted, not merely hidden", () => {
  /* A shut log should cost nothing to have — no list of DOM nodes, and the
     panel's own queries are the caller's business rather than a hidden div's. */
  const src = code(COLLAPSIBLE);
  assert.match(src, /\{open && \(/);
  assert.doesNotMatch(src, /hidden=\{!open\}/);
});

test("the chevron is decorative", () => {
  /* The button already carries the name and the state; a second announcement
     of "chevron" is noise. */
  const src = code(COLLAPSIBLE);
  const chev = src.slice(src.indexOf("<span\n          aria-hidden"));
  assert.match(chev, /aria-hidden/);
});
