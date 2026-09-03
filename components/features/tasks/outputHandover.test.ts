import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Handing an output over, and the reviewer being able to open what arrived.
 *
 * **Why this is asserted rather than trusted.** The engine has stored files on
 * an output submission since the day the route existed — `imageUrls` and
 * `pdfAttachments`, the same fields a task submission uses. Three separate
 * places threw them away: the repository method had no field to send them
 * with, and BOTH read paths returned a hardcoded empty list. So a person could
 * attach a document, see it accepted, and the reviewer would open the
 * submission to find a covering note describing a file that was not there.
 *
 * Nothing failed. Every layer worked exactly as written. That is the shape of
 * fault these tests exist for: an empty array is indistinguishable from "no
 * files were attached", so neither side could tell the feature was missing.
 *
 * These read source rather than render, in the style of the other wiring tests
 * here: what is protected is that the files are CARRIED, which a rendering test
 * over a prototype task with no submissions cannot show.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SUBMIT_LIST = strip("components/features/tasks/OutputSubmitList.tsx");
const FORM = strip("components/features/tasks/OutputHandoverForm.tsx");
const OUTPUTS = strip("components/features/tasks/OutputsPanel.tsx");
const SUBMISSION = strip("components/features/tasks/SubmissionPanel.tsx");
const REVIEW = strip("components/features/tasks/ReviewPanel.tsx");
const DETAIL = strip("components/features/tasks/TaskDetail.tsx");
const REPO = strip("lib/repositories/legacy/index.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const TYPES = strip("lib/repositories/types.ts");
const MAP = strip("lib/repositories/legacy/taskMap.ts");

/* ── Where handing over lives ─────────────────────────────────────────────── */

test("outputs are submitted from the Submission tab", () => {
  /* Beside the review that decides on them. `TaskDetail` renders
     `SubmissionPanel` and `ReviewPanel` under one tab for exactly this reason:
     the person handing work in and the person judging it read one screen. */
  assert.match(SUBMISSION, /<OutputSubmitList\b/);
  assert.match(SUBMISSION, /import \{ OutputSubmitList \}/);
});

test("the Submission tab no longer sends the reader somewhere else", () => {
  /* Its entire content was "Submit them from Overview" — a screen explaining a
     flow and then directing the reader two tabs away to take part in it. */
  assert.equal(
    /Submit them from Overview/.test(SUBMISSION),
    false,
    "the Submission tab still points at Overview",
  );
});

test("outputs are submitted from Overview too", () => {
  /* Naming an output and handing it over are one thought when the work is
     fresh in front of you, and Overview is the list somebody is already
     looking at. It keeps setup — Remove — as well. */
  assert.match(OUTPUTS, /<OutputHandoverForm\b/);
  assert.match(OUTPUTS, /Remove/);
});

test("both screens drive ONE handover form", () => {
  /**
   * The property that matters most here, and the reason the form is its own
   * component. Two copies would be two upload paths and two definitions of a
   * complete handover — which is how somebody attaches a file on one screen and
   * loses it on the other. Neither list may call `submitOutput` itself.
   */
  assert.match(SUBMIT_LIST, /<OutputHandoverForm\b/);
  assert.match(FORM, /r\.submitOutput\(/);
  for (const [name, src] of [
    ["OutputsPanel", OUTPUTS],
    ["OutputSubmitList", SUBMIT_LIST],
  ] as const) {
    assert.equal(
      /r\.submitOutput\(/.test(src),
      false,
      `${name} submits on its own instead of through the shared form`,
    );
  }
});

test("one table names the output states", () => {
  /* A state reading "Rework" on one tab and something else on the other is two
     names for one fact. Both panels had their own copy for exactly as long as
     it took to write the second one. */
  assert.match(OUTPUTS, /OUTPUT_TONE/);
  assert.match(SUBMIT_LIST, /OUTPUT_TONE/);
});

/* ── The files, on the way out ────────────────────────────────────────────── */

test("the contract carries files on an output submission", () => {
  const method = TYPES.slice(
    TYPES.indexOf("submitOutput(input: {"),
    TYPES.indexOf("reviewOutput(input: {"),
  );
  assert.notEqual(method, "", "submitOutput not found in the contract");
  assert.match(method, /attachments\?: ReportAttachment\[\]/);
});

test("files go to Drive, not through the engine", () => {
  /* The pipeline that makes a large file viable at all: bytes go browser to
     Google. `uploadAttachment` would stream every byte through Express. */
  assert.match(FORM, /repo\.uploadDriveFile\(/);
  assert.equal(
    /uploadAttachment\(/.test(FORM),
    false,
    "the output handover streams bytes through the engine",
  );
});

test("files are optional — a note alone is a complete handover", () => {
  /**
   * Not every output is a document. Some are a sentence confirming something,
   * and refusing those would block handovers that are legitimate. Send waits
   * on the NOTE only; the picker carries a suggestion rather than a rule.
   */
  assert.match(FORM, /disabled=\{busy \|\| !note\.trim\(\)\}/);
  assert.equal(
    /staged\.length > 0 \|\|/.test(FORM) || /!filesReady/.test(FORM),
    false,
    "Send is gated on having attached a file",
  );
  assert.match(FORM, /Not required/);
  assert.match(FORM, /optional, any type, any size/);
});

test("nothing is submitted when a file fails to upload", () => {
  /**
   * The order matters and it is the opposite of the task-level panel's.
   *
   * There, a submission may legitimately carry no files, so a failed upload
   * leaves a valid submission with a missing attachment. Here the file IS the
   * handover: sending the note while its document failed would put work in
   * front of a reviewer with nothing to review, and the person would believe
   * they had handed it over.
   */
  const send = FORM.slice(
    FORM.indexOf("async function send("),
    FORM.indexOf("return ("),
  );
  assert.notEqual(send, "", "send() not found");
  const failedAt = send.indexOf("failed.length > 0");
  const submitAt = send.indexOf("await submit(");
  assert.ok(failedAt !== -1 && submitAt !== -1, "both branches must exist");
  assert.ok(
    failedAt < submitAt,
    "the submission is written before failed uploads are checked",
  );
});

test("a build with no storage offers no picker", () => {
  /* The in-memory prototype has no upload endpoint, and a picker that cannot
     upload is worse than no picker. It says so rather than showing a control
     that fails on use. */
  assert.match(FORM, /typeof repo\.uploadDriveFile === "function"/);
  assert.match(FORM, /no file storage/);
});

test("the suggestion is shown once, and only while nothing is attached", () => {
  /* Repeating "attaching helps" under a list of four files is nagging about a
     decision already made. */
  assert.match(FORM, /staged\.length === 0 && \(/);
});

test("the legacy repository sends the files the route has always taken", () => {
  const method = REPO.slice(
    REPO.indexOf("async submitOutput(input: {"),
    REPO.indexOf("async reviewOutput(input: {"),
  );
  assert.notEqual(method, "", "submitOutput not found in the legacy repository");
  assert.match(method, /imageUrls/);
  assert.match(method, /pdfAttachments/);
  /* Split by type, because the old application reads two typed arrays and
     knows nothing about anything else. */
  assert.match(method, /mimeType\.startsWith\("image\/"\)/);
});

test("the prototype accepts the same field", () => {
  const method = MOCK.slice(
    MOCK.indexOf("async submitOutput(input: {"),
    MOCK.indexOf("async reviewOutput(input: {"),
  );
  assert.notEqual(method, "", "submitOutput not found in the mock");
  assert.match(method, /attachments\?: ReportAttachment\[\]/);
});

/* ── The files, on the way back ───────────────────────────────────────────── */

test("both read paths carry the files back", () => {
  /**
   * TWO places returned `attachments: []`, and each feeds a different screen:
   * `readOutputSubmissionRecords` feeds the review panel through
   * `listSubmissions`, and `taskMap`'s `openSubmissions` feeds the Approvals
   * queue. Fixing one would have left a reviewer able to open the work from one
   * surface and not the other.
   */
  const records = REPO.slice(
    REPO.indexOf("function readOutputSubmissionRecords("),
    REPO.indexOf("function readOutputSubmissionRecords(") + 1800,
  );
  assert.match(records, /readSubmissionAttachments\(v\)/);
  assert.equal(
    /attachments: \[\]/.test(records),
    false,
    "the review path still drops output files",
  );

  const open = MAP.slice(
    MAP.indexOf("openSubmissions:"),
    MAP.indexOf("openSubmissions:") + 1400,
  );
  assert.match(open, /readSubmissionAttachments\(/);
  assert.equal(
    /attachments: \[\]/.test(open),
    false,
    "the approvals queue still drops output files",
  );
});

test("one rule reads the files, not a second copy of it", () => {
  /* `readSubmissionAttachments` is what the task-level path uses. A second
     reader here is how one submission comes to read differently on two
     screens — which is the fault `SubmittedFiles` was written to end. */
  assert.match(MAP, /import \{ readSubmissionAttachments \}/);
});

test("the reviewer's panel renders what arrived", () => {
  /* Already true before this change and asserted so it stays: the panel reads
     `latest.attachments`, which is the list the two paths above now fill. */
  assert.match(REVIEW, /<SubmittedFiles files=\{latest\.attachments\}/);
});

test("the attempts list names which output it is about", () => {
  /* Three outputs listed three rows reading "Attempt 1", and the person who
     submitted them could not tell which was which. Each attempt card names its
     output (from `s.outputId`) ahead of the attempt number. */
  assert.match(SUBMISSION, /s\.outputId/);
  assert.match(SUBMISSION, /outputs\.find\(\(o\) => o\.id === s\.outputId\)/);
  assert.match(SUBMISSION, /· attempt \{s\.attempt\}/);
});

test("submissions are grouped: the current attempt, then previous ones", () => {
  /* The whole point of the redesign — a rework cycle reads as distinct attempts,
     not one merged pile of files, so a reviewer can tell what was sent first
     from what was sent after the rework. The current attempt leads the panel;
     the earlier ones render in history-only mode (newest first), which the
     reviewer's "Review history" section embeds. */
  assert.match(SUBMISSION, /Current submission/);
  assert.match(SUBMISSION, /renderAttempt\(attempts\[attempts\.length - 1\]\)/);
  assert.match(SUBMISSION, /Previous submissions/);
  assert.match(SUBMISSION, /\[\.\.\.previous\]\.reverse\(\)\.map\(\(a\) => renderAttempt\(a\)\)/);
});

test("the pooled files are split back into attempts by rework boundary", () => {
  /* The engine keeps one submission and pools every resubmission's files under
     it, so the attempts are reconstructed from upload time against the reworks
     rather than read from a history the engine does not keep. */
  assert.match(SUBMISSION, /clusterSubmissionAttempts\(pooled\.data \?\? \[\], reworks\.data \?\? \[\]\)/);
  assert.match(SUBMISSION, /getAttachments\("submission", submissionId\)/);
  /* Each attempt renders ITS files, not the whole pool. */
  assert.match(SUBMISSION, /<FileList attachments=\{a\.files\}/);
});

test("on the review tab, the earlier submissions live inside Review history", () => {
  /* All of a task's history reads as ONE "Review history" section: the earlier
     submissions and the earlier decisions together, beneath the current work and
     the decision. ReviewPanel renders that history itself — a history-only
     SubmissionPanel under its "Review history" heading — so the review tab is
     ReviewPanel alone and the previous attempts never sit in a second panel
     above (or beside) it. */
  assert.match(DETAIL, /tab === "review" \? \(/);
  assert.match(REVIEW, /import \{ SubmissionPanel \}/);
  assert.match(
    REVIEW,
    /Review history[\s\S]*?<SubmissionPanel view=\{view\} onChange=\{onChange\} historyOnly/,
  );
  /* The review tab no longer appends its own history panel — that would render
     the previous attempts twice. */
  assert.doesNotMatch(DETAIL, /historyOnly/);
});

test("history-only mode shows just the previous attempts, no composer", () => {
  assert.match(SUBMISSION, /historyOnly = false/);
  assert.match(SUBMISSION, /if \(historyOnly\) \{/);
  assert.match(SUBMISSION, /const previous = attempts\.slice\(0, -1\);/);
  /* Nothing to show for a first submission — renders null, not an empty box. */
  assert.match(SUBMISSION, /previous\.length === 0\s*\)?\s*\)?\s*\{?\s*[\s\S]*?return null/);
});

test("each attempt carries its own status, notes and reviewer feedback", () => {
  /* Feedback is the rework that ENDED the attempt (a.rework), folded into the
     card rather than a separate top panel divorced from the files it judged. */
  assert.match(SUBMISSION, /const \{ isCurrent, rework \} = a;/);
  assert.match(SUBMISSION, /Reviewer feedback/);
  assert.match(SUBMISSION, /Initial submission/);
  assert.match(SUBMISSION, /Resubmission/);
  assert.match(SUBMISSION, /Under review/);
  assert.match(SUBMISSION, /Rework requested/);
});
