import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The submission dialog has to be opaque.
 *
 * It is a portal on `document.body`, so what sits behind it is the whole task
 * page. `SubmissionPanel` paints itself with `frost-panel` — 74% transparent,
 * hiding what is behind it with `backdrop-filter` — and that holds over the
 * page's own quiet ground and fails here: the form and the thread's cards were
 * drawn over each other, both legible, neither readable.
 *
 * Measured in a browser: a plain `.frost-panel` computes
 * `rgba(32, 32, 37, 0.74)`; inside the dialog's override it computes
 * `rgb(32, 32, 37)`.
 */

const DIALOG = readFileSync(
  "components/features/tasks/TaskChatSubmission.tsx",
  "utf8",
);
/* Comments stripped: the prose here NAMES `frost-panel` while explaining why
   the dialog must not paint one, and a check for the class would match the
   explanation of its own absence. */
const DIALOG_CODE = DIALOG.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);
const CSS = readFileSync("app/globals.css", "utf8");

test("a solid panel colour exists in both themes", () => {
  /* Two definitions: the light `:root` and the dark block. A token defined in
     only one is the kind of thing that looks right until somebody switches. */
  const hits = CSS.match(/--frost-panel-solid:/g) ?? [];
  assert.ok(hits.length >= 2, `expected light and dark, found ${hits.length}`);
});

test("the dialog overrides the panel colour to the solid one", () => {
  /* Both names: the class reads `--color-frost-panel`, and the
     reduced-transparency rule mixes from `--frost-panel`. */
  assert.match(DIALOG, /"--color-frost-panel": "var\(--frost-panel-solid\)"/);
  assert.match(DIALOG, /"--frost-panel": "var\(--frost-panel-solid\)"/);
});

test("the scrim is heavy enough to put the page behind it", () => {
  /* At 45% every card on the task page stayed legible around the dialog and
     competed with it. */
  assert.match(DIALOG, /bg-black\/70/);
  assert.doesNotMatch(DIALOG, /bg-black\/45/);
});

test("the dialog still paints no surface of its own", () => {
  /* The override is what makes the CHILD opaque. Laying an opaque div under it
     instead would put a second border a hair outside the panel's own and leave
     two sets of corners to keep in step. */
  /* The CLASS, not the bare word — the override names `--frost-panel-solid`
     right beside `role="dialog"`, and a looser pattern matches the very change
     that makes the child opaque. */
  assert.doesNotMatch(
    DIALOG_CODE,
    /role="dialog"[\s\S]{0,600}className="[^"]*frost-(bar|panel)/,
  );
});

/* ── A staged upload has to show it is moving ──────────────────────────────── */

const PANEL = "components/features/tasks/SubmissionPanel.tsx";

test("staged files report progress while they upload", () => {
  /**
   * Staged files go up AFTER the submission is created, so the slowest part of
   * submitting happens once the form already looks finished. A large PDF on a
   * slow line showed nothing moving at all, and a screen with nothing moving
   * reads as hung — which is exactly when somebody presses Submit again.
   */
  const src = readFileSync(PANEL, "utf8");
  assert.match(src, /onProgress: \(fraction\) =>/, "the upload reports no progress");
  assert.match(src, /<UploadProgressRow name=\{u\.name\} fraction=\{u\.fraction\}/);
});

test("it reuses the composer's progress row rather than a second one", () => {
  /* Two controls for one idea drift apart — and this one already answers the
     hard half: the finalize step reports no progress, so a bar pinned at 100%
     would claim the upload had finished while it had not. */
  const src = readFileSync(PANEL, "utf8");
  assert.match(
    src,
    /import \{ UploadProgressRow \} from "@\/components\/features\/messages\/MessageAttachments"/,
  );
  assert.doesNotMatch(src, /function UploadProgressRow/, "a second progress row was defined");
});

test("progress is matched by POSITION, not by file name", () => {
  /* Two files chosen from different folders can carry the same name, and
     matching on it would drive one row from two uploads while another never
     moved at all. */
  const src = readFileSync(PANEL, "utf8");
  assert.match(src, /const at = staged\.indexOf\(file\);/);
  assert.match(src, /rows\.map\(\(row, i\) =>\s*\n?\s*i === at \? \{ \.\.\.row, fraction \} : row,?\s*\)/);
});

test("the rows appear before the first byte and clear only once settled", () => {
  /**
   * Listed up front so the wait is accounted for from the moment it starts,
   * not when the first progress event happens to arrive — and cleared after
   * `uploadAll` resolves, because a row that vanished at 100% would hide the
   * finalize step, which is the part people wait longest on.
   */
  const src = readFileSync(PANEL, "utf8");
  const at = src.indexOf("if (staged.length > 0) {");
  assert.ok(at > 0, "the staged-upload branch was removed");
  const block = src.slice(at, at + 2600);
  /* Matched by CONTENT, not by line ending — the component file is CRLF, so a
     newline anchored straight after the call never matches. */
  const listed = block.indexOf("name: file.name, fraction: 0");
  const uploaded = block.indexOf("await uploadAll(");
  const cleared = block.lastIndexOf("setUploads([]);");
  assert.ok(listed > 0 && listed < uploaded, "the rows are listed after the upload starts");
  assert.ok(cleared > uploaded, "the rows are cleared before the uploads settle");
});

test("the progress rows survive the submission succeeding", () => {
  /**
   * **The reason nothing ever appeared on screen.**
   *
   * `canSubmit` requires `status === "in_progress"`. Submitting moves the task
   * to `in_review`, and `useAction` calls `notifyRepositoryChanged()` the
   * instant that write succeeds — so the view refetches and the composer
   * unmounts BEFORE the staged files begin uploading. That order is forced by
   * the engine: the submission must exist before anything can be attached to
   * it.
   *
   * Rendered inside the composer, the bar was mounted and destroyed in the same
   * tick. The upload ran on invisibly and the person saw a form that had simply
   * gone — which is indistinguishable from nothing having happened. The failure
   * notice had the identical fault: a file that did not upload said so on a
   * screen that had already been replaced.
   */
  const src = readFileSync(PANEL, "utf8");
  const gate = src.indexOf("{canSubmit ? (");
  assert.ok(gate > 0, "the composer gate was renamed");

  const rows = src.indexOf("uploads.length > 0 && (");
  assert.ok(rows > 0, "the progress rows were removed");
  assert.ok(rows < gate, "the progress rows are inside the composer and will unmount");

  const failure = src.indexOf("uploadFailures.length > 0 && (");
  assert.ok(failure > 0, "the failure notice was removed");
  assert.ok(failure < gate, "the failure notice is inside the composer and will unmount");
});

test("a disabled Submit says what is blocking it", () => {
  /**
   * Reported as "files are not uploading". They were not: the button is
   * disabled without a note, said so nowhere, and pressing it did nothing —
   * which reads as a broken upload. A 2 KB file and a 200 MB file behaved
   * identically, because neither submission ever started, and staged files go
   * up only AFTER the submission exists.
   */
  const src = readFileSync(PANEL, "utf8");
  assert.match(src, /disabled=\{state\.isPending \|\| sending \|\| !message\.trim\(\)\}/);
  assert.match(src, /Describe what you completed first/);
  /* Only while that is genuinely the blocker — not on a form ready to send,
     and not while the press is already in flight. */
  assert.match(src, /\{!message\.trim\(\) && !state\.isPending && !sending && \(/);
});
