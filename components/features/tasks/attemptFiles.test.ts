import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { clusterSubmissionAttempts } from "@/lib/rules/tasks/submissionAttempts";

/**
 * **Reported 28 September 2026, with the two panels photographed side by
 * side.** One 1.2 MB PDF had been submitted. The submitter's attempt card
 * said one file. The REVIEWER's panel — the screen with Approve on it —
 * listed that PDF and a 3 GB video from the attempt before, as the work to be
 * judged.
 *
 * The cause is the engine's record, not the screen: one `completionSubmission`
 * per task, overwritten on every resubmit, with every attempt's files pooled
 * under one id. `clusterSubmissionAttempts` is what splits that pool back
 * apart, and it was applied on the submitter's side only. Two screens reading
 * one record two ways, and the one that could act on it had the wrong answer.
 *
 * What is pinned here is that every surface showing "the submitted work"
 * applies that rule. A surface that forgets it does not look broken — it looks
 * like somebody attached files they never attached.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SURFACES = [
  ["the reviewer's panel", "components/features/tasks/ReviewPanel.tsx"],
  ["the task chat card", "components/features/tasks/TaskChatSubmission.tsx"],
] as const;

test("every surface that shows the submitted work splits it by attempt", () => {
  for (const [what, path] of SURFACES) {
    const src = strip(path);
    assert.match(
      src,
      /entityType="submission"[\s\S]{0,200}?filter=\{/,
      `${what} lists the pool rather than the attempt`,
    );
    assert.match(src, /clusterSubmissionAttempts\(\s*files,/, what);
    assert.match(src, /attempts\[attempts\.length - 1\]\.files/, what);
    /* The reworks are the other boundary; without them a resubmission made
       inside the gap window merges into the attempt before it. */
    assert.match(src, /listReworkRequests\(/, `${what} clusters without reworks`);
  }
});

test("the submitter's own card already split it, and still does", () => {
  /* It was right all along. The bug was the two sides disagreeing, so this is
     here to keep the side that was correct from being "fixed" into the other
     one's shape. */
  const src = strip("components/features/tasks/SubmissionPanel.tsx");
  assert.match(src, /clusterSubmissionAttempts\(pooled\.data \?\? \[\], reworks\.data \?\? \[\]\)/);
});

test("filtering never swallows the loading or the error state", () => {
  /**
   * The filter runs on what came back, not instead of the fetch. A section
   * that filtered before settling would show "No files attached" while it was
   * still loading — which is the same lie in a different direction, and the
   * one that made a storage outage read as an empty task once before.
   */
  const src = strip("components/features/attachments/Attachments.tsx");
  assert.match(src, /const fetched = settled\?\.files \?\? \[\];/);
  assert.match(src, /const files = settled && filter \? filter\(fetched\) : fetched;/);
  const settledAt = src.indexOf("const settled = state?.key === key");
  const guard = src.indexOf("if (!settled)");
  assert.ok(settledAt < guard, "the loading guard moved above the settle");
});

/* ── The rule itself, on the reported data ───────────────────────────────── */

test("the reported case: a 3 GB video and a PDF four hours apart are two attempts", () => {
  /**
   * The real timestamps from the report. The video went up at 12:14 and the
   * PDF at 16:22 — four hours apart, which is not one hand-over by any
   * reading, and a rework was recorded between them.
   */
  const files = [
    { name: "Vishwanath.and.Sons.2026.1080p.mkv", uploadedAt: "2026-09-28T06:44:00.000Z" },
    { name: "majhi page.pdf", uploadedAt: "2026-09-28T10:52:00.000Z" },
  ];
  const reworks = [{ requestedAt: "2026-09-28T09:00:00.000Z" }];

  const attempts = clusterSubmissionAttempts(files, reworks);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].files.map((f) => f.name), [
    "Vishwanath.and.Sons.2026.1080p.mkv",
  ]);
  assert.deepEqual(attempts[1].files.map((f) => f.name), ["majhi page.pdf"]);
  assert.equal(attempts[1].isCurrent, true);

  /* Which is what the reviewer now sees: the PDF, and only the PDF. */
  const current = attempts[attempts.length - 1].files;
  assert.equal(current.length, 1);
  assert.equal(current[0].name, "majhi page.pdf");
});

test("with no rework recorded, four hours is still two attempts", () => {
  /* The gap alone has to be enough — a rework record does not always survive,
     and that is precisely the case that left three files reading as one. */
  const files = [
    { name: "old.mkv", uploadedAt: "2026-09-28T06:44:00.000Z" },
    { name: "new.pdf", uploadedAt: "2026-09-28T10:52:00.000Z" },
  ];
  const attempts = clusterSubmissionAttempts(files, []);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1].files.map((f) => f.name), ["new.pdf"]);
});

test("files sent together in one hand-over stay together", () => {
  /* The other direction matters just as much: splitting one submission into
     two would hide half of somebody's work from the person judging it. */
  const files = [
    { name: "a.pdf", uploadedAt: "2026-09-28T10:52:00.000Z" },
    { name: "b.pdf", uploadedAt: "2026-09-28T10:52:30.000Z" },
    { name: "c.pdf", uploadedAt: "2026-09-28T10:53:10.000Z" },
  ];
  const attempts = clusterSubmissionAttempts(files, []);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].files.length, 3);
});

test("a file with no upload time lands on the current attempt, not an old one", () => {
  /* An undated file is usually one that has just arrived. Putting it with the
     oldest group would file today's work under last week's attempt. */
  const files = [
    { name: "old.mkv", uploadedAt: "2026-09-28T06:44:00.000Z" },
    { name: "undated.pdf" },
    { name: "new.pdf", uploadedAt: "2026-09-28T10:52:00.000Z" },
  ];
  const attempts = clusterSubmissionAttempts(files, []);
  assert.deepEqual(
    attempts[attempts.length - 1].files.map((f) => f.name).sort(),
    ["new.pdf", "undated.pdf"],
  );
});
