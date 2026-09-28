import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UPLOAD_ABANDONED_AFTER_MS,
  fileCountLabel,
  readSubmissionUploads,
  reviewWaitReason,
  uploadState,
  uploadsMissing,
  uploadsRunning,
  uploadsStillRunning,
  type SubmissionUpload,
} from "./submissionUploads.ts";

/**
 * **Reported 28 September 2026.** A 3 GB video attached, Submit pressed, and
 * the attempt read "Submitted files (0) — No files on this attempt." while the
 * file was at 1% — to the reviewer as much as to the person uploading, who
 * alone could see a progress bar. The reviewer could approve it, or send it
 * back for having nothing attached, before the work arrived.
 */

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

const up = (over: Partial<SubmissionUpload> = {}): SubmissionUpload => ({
  name: "Vishwanath.and.Sons.2026.mkv",
  sizeBytes: 3_221_225_472,
  startedAt: at(5),
  state: "uploading",
  ...over,
});

/* ── What an entry is doing ───────────────────────────────────────────────── */

test("an upload started moments ago is running", () => {
  assert.equal(uploadState(up(), NOW), "uploading");
  assert.equal(uploadsStillRunning([up()], NOW), true);
});

test("one the browser gave up on is failed, and releases the reviewer", () => {
  /* The point of storing a state rather than only a name: a file that is never
     coming must not hold a decision for ever. */
  const failed = up({ state: "failed" });
  assert.equal(uploadState(failed, NOW), "failed");
  assert.equal(uploadsStillRunning([failed], NOW), false);
  assert.deepEqual(uploadsMissing([failed], NOW), [failed]);
});

test("one that has been silent for six hours is presumed gone", () => {
  /**
   * A closed tab writes nothing at all — no failure, no progress — so without
   * this the reviewer would wait on an upload that stopped existing when
   * somebody shut their laptop. Six hours is past any honest transfer and
   * short of blocking somebody into the next day.
   */
  const stale = up({ startedAt: new Date(NOW - UPLOAD_ABANDONED_AFTER_MS).toISOString() });
  assert.equal(uploadState(stale, NOW), "abandoned");
  assert.equal(uploadsStillRunning([stale], NOW), false);

  /* A minute short of it is still running — a big file on a bad line is slow,
     not gone. */
  const slow = up({
    startedAt: new Date(NOW - UPLOAD_ABANDONED_AFTER_MS + 60_000).toISOString(),
  });
  assert.equal(uploadState(slow, NOW), "uploading");
});

test("an unreadable start time does not release the reviewer by accident", () => {
  /* Ageing something you cannot date would turn a formatting fault into an
     approval on work that never arrived. It stays running until somebody says
     otherwise. */
  assert.equal(uploadState(up({ startedAt: "" }), NOW), "uploading");
  assert.equal(uploadState(up({ startedAt: "not a date" }), NOW), "uploading");
});

/* ── What the screens say ─────────────────────────────────────────────────── */

test("the count says what is coming, not just what is here", () => {
  /* "Submitted files (0)" was the complaint: true about what had arrived and
     silent about the 3 GB on its way. */
  assert.equal(fileCountLabel(0, [up()], NOW), "0 of 1");
  assert.equal(fileCountLabel(2, [up()], NOW), "2 of 3");
});

test("once everything has landed the count is a plain number again", () => {
  assert.equal(fileCountLabel(1, [], NOW), "1");
  assert.equal(fileCountLabel(1, undefined, NOW), "1");
  /* A failed upload is not counted as coming — it is reported separately. */
  assert.equal(fileCountLabel(0, [up({ state: "failed" })], NOW), "0");
});

test("the reviewer is told which file they are waiting on", () => {
  const one = reviewWaitReason([up()], NOW);
  assert.match(one ?? "", /Vishwanath\.and\.Sons\.2026\.mkv is still uploading/);
  assert.match(one ?? "", /The decision opens once it arrives\./);

  const two = reviewWaitReason([up(), up({ name: "b.mkv" })], NOW);
  assert.match(two ?? "", /2 files are still uploading/);
});

test("nothing running is no reason, so the decision is offered", () => {
  assert.equal(reviewWaitReason([], NOW), null);
  assert.equal(reviewWaitReason(undefined, NOW), null);
  assert.equal(reviewWaitReason([up({ state: "failed" })], NOW), null);
});

/* ── Reading the record back ──────────────────────────────────────────────── */

test("a half-formed entry is dropped rather than rendered at a reviewer", () => {
  /**
   * The list is written by a browser and read by every screen. Dropping a bad
   * entry can only ever UN-block a decision, which is the safe direction —
   * showing "undefined is still uploading" to a reviewer is not.
   */
  const read = readSubmissionUploads([
    { name: "good.mkv", sizeBytes: 10, startedAt: at(1), state: "uploading" },
    { name: "   ", sizeBytes: 10, startedAt: at(1) },
    null,
    "nonsense",
    { sizeBytes: 10 },
  ]);
  assert.deepEqual(read.map((u) => u.name), ["good.mkv"]);
});

test("anything that is not a list reads as no uploads at all", () => {
  assert.deepEqual(readSubmissionUploads(undefined), []);
  assert.deepEqual(readSubmissionUploads(null), []);
  assert.deepEqual(readSubmissionUploads({ name: "x" }), []);
});

test("an unknown state reads as uploading, never as failed", () => {
  /* Guessing "failed" would release a reviewer onto work that is still on its
     way — the exact defect this module exists to close. */
  const [u] = readSubmissionUploads([
    { name: "x.mkv", sizeBytes: 1, startedAt: at(1), state: "whatever" },
  ]);
  assert.equal(u.state, "uploading");
  assert.equal(uploadsRunning([u], NOW).length, 1);
});
