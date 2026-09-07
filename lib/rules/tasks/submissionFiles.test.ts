import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  readSubmissionAttachments,
  submissionAttempt,
  typeOf,
  nameFromUrl,
} from "./submissionFiles.ts";

/**
 * A submitted document has to reach the person deciding whether to accept it.
 *
 * The engine stored it, the chat carried it, and every other surface lost it:
 * the reader flattened `{url, name, downloadUrl}` to a bare URL string, the
 * review screen rendered no files at all, the submission screen rendered the URL
 * as chip TEXT rather than a link, and the Files tab asked a different store
 * entirely and was correctly told it held nothing.
 */

test("a PDF keeps its name and its download address", () => {
  const files = readSubmissionAttachments({
    pdfAttachments: [
      {
        url: "https://cdn.example.com/a1b2.pdf",
        name: "Ray&Co carousel copy.pdf",
        embedUrl: "https://cdn.example.com/a1b2?embed",
        downloadUrl: "https://cdn.example.com/a1b2?dl=1",
      },
    ],
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "Ray&Co carousel copy.pdf");
  assert.equal(files[0].downloadUrl, "https://cdn.example.com/a1b2?dl=1");
  assert.equal(files[0].type, "pdf");
});

test("both storage shapes are read — strings and objects", () => {
  /* `imageUrls` is a list of plain URLs; `pdfAttachments` is a list of objects.
     Reading only one of them is how half a submission goes missing. */
  const files = readSubmissionAttachments({
    imageUrls: ["https://cdn.example.com/proof.png"],
    pdfAttachments: [{ url: "https://cdn.example.com/spec.pdf", name: "Spec.pdf" }],
  });
  assert.deepEqual(files.map((f) => f.name), ["proof.png", "Spec.pdf"]);
  assert.deepEqual(files.map((f) => f.type), ["image", "pdf"]);
});

test("a nameless file is still identifiable", () => {
  /* The URL's last segment beats "Document 1", and both beat an empty label on
     a link somebody has to choose whether to open. */
  const files = readSubmissionAttachments({
    pdfAttachments: [{ url: "https://cdn.example.com/files/final%20draft.pdf" }],
  });
  assert.equal(files[0].name, "final draft.pdf");
});

test("a download address falls back to the stored URL", () => {
  const files = readSubmissionAttachments({
    pdfAttachments: [{ url: "https://cdn.example.com/x.pdf", name: "X.pdf" }],
  });
  assert.equal(files[0].downloadUrl, "https://cdn.example.com/x.pdf");
});

test("a row with no address at all is dropped, not rendered dead", () => {
  const files = readSubmissionAttachments({
    pdfAttachments: [{ name: "Lost.pdf" }, { url: "https://ok/x.pdf", name: "Kept.pdf" }],
    imageUrls: ["", null, 42],
  });
  assert.deepEqual(files.map((f) => f.name), ["Kept.pdf"]);
});

test("the same file stored under both keys is listed once", () => {
  const files = readSubmissionAttachments({
    imageUrls: ["https://cdn.example.com/same.png"],
    pdfAttachments: [{ url: "https://cdn.example.com/same.png", name: "same.png" }],
  });
  assert.equal(files.length, 1);
});

test("a submission with nothing attached reads as empty, never as broken", () => {
  for (const empty of [null, undefined, {}, { imageUrls: null, pdfAttachments: "nope" }]) {
    assert.deepEqual(readSubmissionAttachments(empty as never), []);
  }
});

test("type survives a query string on the URL", () => {
  /* Signed storage URLs carry tokens after the extension; matching to end-of-
     string would classify every one of them as "file". */
  assert.equal(typeOf("https://x/a.pdf?token=abc", "a.pdf", "pdf"), "pdf");
  assert.equal(typeOf("https://x/a.png?sig=1", "a.png", "image"), "image");
  assert.equal(nameFromUrl("https://x/dir/b.pdf?t=1", "fallback"), "b.pdf");
});

/* ── The five surfaces ────────────────────────────────────────────────────── */

const read = (p: string) => readFileSync(p, "utf8");

test("the reviewer can open what was submitted, from BOTH stores", () => {
  /**
   * **The reported fault.** `ReviewPanel` rendered the covering message and the
   * review chain and nothing else, so somebody deciding whether to approve a
   * document had no way to see the document.
   *
   * Two origins, because a submission can carry files in two places. Cowork's
   * own uploader writes to the attachment service keyed to the submission id —
   * that is where anything uploaded from this app actually lands, and reading
   * only the task record would have missed every one of them. The old
   * application wrote URLs onto the task record instead, and work submitted
   * there still has to be reviewable.
   */
  const src = read("components/features/tasks/ReviewPanel.tsx");
  assert.match(src, /entityType="submission"\s*\n\s*entityId=\{latest\.id\}/);
  assert.match(src, /<SubmittedFiles files=\{latest\.attachments\}/);
});

test("the submission screen shows the same two origins as the reviewer", () => {
  const src = read("components/features/tasks/SubmissionPanel.tsx");
  assert.match(src, /entityId=\{s\.id\}/);
  assert.match(src, /<SubmittedFiles files=\{s\.attachments\}/);
  assert.equal(
    /<Chip key=\{a\}>[\s\S]*?\{a\}/.test(src),
    false,
    "the raw-URL chip is back — it is neither readable nor clickable",
  );
});

test("there is no fake 'Attach file' button producing placeholder ids", () => {
  /**
   * **The control that made the whole thing look like it worked.**
   *
   * A paperclip button appended the literal string `at-demo-1` and drew it as a
   * chip indistinguishable from a real attachment. It opened no file picker and
   * uploaded nothing, and `submitCompletion` dropped the ids on the way out —
   * so somebody attaching a document watched it appear and reach nobody. The
   * real uploader sits below it and is now the only one.
   */
  /* Comments stripped, as the other source-reading tests do: the note above the
     removal names the placeholder in order to explain it, and the CODE is what
     is being asserted about. */
  const src = read("components/features/tasks/SubmissionPanel.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.equal(
    /at-demo-/.test(src),
    false,
    "the placeholder attachment button is back",
  );
  assert.match(src, /entityType="submission"/);
});

test("the Files tab reads the submission record, not only the attachment service", () => {
  /* The completion path never registers files with the attachment service — it
     writes them onto the task document. Asking only the service is why this tab
     was empty for every submission ever made. */
  const src = read("components/features/tasks/TaskFilesPanel.tsx");
  assert.match(src, /files\.push\(\.\.\.fromSubmissionRecord\(sub\)\);/);
  /* Added BEFORE the service result is checked, so a failed service read does
     not withhold a document that is already in hand. */
  const at = src.indexOf("fromSubmissionRecord(sub)");
  const guard = src.indexOf("if (!res.ok)", src.indexOf("const { sub, res }"));
  assert.ok(at > 0 && guard > at, "the record's own files are behind the service check");
});

test("submitted files are labelled by the access they actually have", () => {
  /**
   * The engine posts every submitted file into the task chat, where anybody
   * holding the URL can open it. The Files tab marks link-accessible files as
   * such and says so under the list; labelling these "private" would be a claim
   * about the storage that is not true of it.
   */
  const src = read("lib/rules/tasks/taskFiles.ts");
  const fn = src.slice(src.indexOf("export function fromSubmissionRecord("));
  assert.match(fn.slice(0, 1400), /access: "link" as const/);
});

/* ── Which attempt this is ────────────────────────────────────────────────── */

/**
 * THE REPORTED BUG. Work was submitted, returned, and submitted again — and
 * the card still read "Attempt 1". `listSubmissions` hardcoded it, under a
 * note claiming legacy kept no history of resubmissions. It keeps one: the
 * task's `reworkHistory`, which `reworkCount` on the view is already the
 * length of.
 */
test("a first submission is attempt 1", () => {
  assert.equal(submissionAttempt({}), 1);
  assert.equal(submissionAttempt({ reworkHistory: [] }), 1);
});

test("each return makes the next send a further attempt", () => {
  /* A submission can only be sent again after it has been RETURNED, so the
     number of returns is exactly the number of previous attempts. */
  assert.equal(submissionAttempt({ reworkHistory: [{}] }), 2);
  assert.equal(submissionAttempt({ reworkHistory: [{}, {}] }), 3);
});

test("a malformed or absent history reads as a first attempt, never as zero", () => {
  /* Attempt 0 is not a thing anybody can be on, and a task written before this
     field existed must not report one. */
  for (const bad of [undefined, null, "2", 7, {}]) {
    assert.equal(
      submissionAttempt({ reworkHistory: bad } as { reworkHistory?: unknown }),
      1,
      `reworkHistory ${JSON.stringify(bad)} should fall back to attempt 1`,
    );
  }
});

test("the repository derives the attempt rather than stating one", () => {
  /* The regression guard: the value was a literal for the life of the feature,
     and a literal reads as deliberate. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  assert.match(src, /attempt: submissionAttempt\(doc\)/);
  assert.equal(
    /attempt: 1,/.test(src),
    false,
    "a submission attempt is hardcoded again",
  );
});

test("the TASK THREAD shows the same two origins as the reviewer", () => {
  /**
   * The decision now happens on the submitted-work card in a task chat, so
   * that card is a fifth surface the work has to reach. It shipped rendering
   * `submission.attachments` alone — the task record's URLs — which meant
   * anything uploaded through Cowork's own uploader was invisible to the
   * person deciding on it: the same fault this file was written about,
   * reappearing on a new screen because only half of ReviewPanel's answer was
   * carried across.
   */
  const src = read("components/features/tasks/TaskChatSubmission.tsx");
  assert.match(src, /entityType="submission"\s*\n\s*entityId=\{submission\.id\}/);
  assert.match(src, /<SubmittedFiles files=\{submission\.attachments\}/);
});
