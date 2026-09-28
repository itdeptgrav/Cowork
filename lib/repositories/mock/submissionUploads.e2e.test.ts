import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { mockRepository } from "./index.ts";
import { getStore, resetStore, setActingId } from "./store.ts";
import {
  fileCountLabel,
  reviewWaitReason,
  uploadsMissing,
} from "../../rules/tasks/submissionUploads.ts";
import type { SubmissionUpload } from "../../domain/tasks.ts";

/**
 * A 1 GB hand-over, driven end to end through the store.
 *
 * Asked for on 28 September 2026 — *test all* — after a 3 GB video was
 * attached, Submit was pressed, and the attempt read "Submitted files (0) — No
 * files on this attempt" beside a live Approve button.
 *
 * The ageing rules are proved in `lib/rules/tasks/submissionUploads.test.ts`
 * and the engine's half is pinned in `lib/legacy/submissionUploadsEngine.test.ts`.
 * What runs HERE is the path between them: a submission that carries the list,
 * a reviewer who is held by it, and the same browser correcting it afterwards.
 * Every one of those is a separate write, and a list that were dropped at any
 * of them would leave the reviewer blocked for six hours with nothing on
 * screen to explain it.
 */

const ASSIGNEE = "e-01";
const OTHER = "e-02";

const NOW = Date.parse("2026-09-28T06:25:00.000Z");
const GB_FILE: SubmissionUpload = {
  name: "Vishwanath.and.Sons.2026.1080p.mkv",
  sizeBytes: 1024 * 1024 * 1024,
  startedAt: new Date(NOW).toISOString(),
  state: "uploading",
};

/** A task this person can actually hand in. */
function openTask(): string {
  const s = getStore();
  /* Assignment is its own record here, not a field on the task. */
  const mine = s.assignments.find((a) => a.employeeId === ASSIGNEE);
  const t = s.tasks.find((x) => x.id === mine?.taskId) ?? s.tasks[0];
  t.status = "in_progress";
  t.outputs = [];
  return t.id;
}

beforeEach(() => {
  resetStore();
  setActingId(ASSIGNEE);
});

test("the submission carries the file that has not arrived yet", async () => {
  const id = openTask();
  const r = await mockRepository.submitCompletion({
    taskId: id,
    message: "Final cut attached.",
    attachmentIds: [],
    pendingUploads: [GB_FILE],
  });
  assert.equal(r.ok, true, r.ok ? "" : (r as { message: string }).message);

  /* Read BACK, not asserted on the value handed in: the whole failure was a
     screen reading a record, and a list that never reached the record would
     look identical at the moment of submitting. */
  const [stored] = await mockRepository.listSubmissions(id);
  assert.equal(stored.pendingUploads.length, 1);
  assert.equal(stored.pendingUploads[0].name, GB_FILE.name);
  assert.equal(stored.pendingUploads[0].state, "uploading");

  /* And the count line the reviewer reads. Zero files have arrived; the file
     that is coming is the difference between "(0)" and "(0 of 1)". */
  assert.equal(fileCountLabel(0, stored.pendingUploads, NOW), "0 of 1");
});

test("the reviewer is held while it uploads, and told which file", async () => {
  const id = openTask();
  await mockRepository.submitCompletion({
    taskId: id,
    message: "Final cut attached.",
    attachmentIds: [],
    pendingUploads: [GB_FILE],
  });

  const [stored] = await mockRepository.listSubmissions(id);
  const reason = reviewWaitReason(stored.pendingUploads, NOW);
  assert.match(reason ?? "", /Vishwanath\.and\.Sons\.2026\.1080p\.mkv is still uploading/);
});

test("the file landing releases the decision", async () => {
  /* The ordinary ending: every byte arrives, the browser drops it from the
     list, and the reviewer's screen opens. */
  const id = openTask();
  await mockRepository.submitCompletion({
    taskId: id,
    message: "Final cut attached.",
    attachmentIds: [],
    pendingUploads: [GB_FILE],
  });

  const cleared = await mockRepository.setSubmissionUploads(id, []);
  assert.equal(cleared.ok, true);

  const [stored] = await mockRepository.listSubmissions(id);
  assert.deepEqual(stored.pendingUploads, []);
  assert.equal(reviewWaitReason(stored.pendingUploads, NOW), null);
});

test("a file that gave up releases the decision too, and is named", async () => {
  /**
   * The ending that matters more. A reviewer held for ever by an upload that
   * died would be a worse failure than the one this replaced — so a browser
   * that gives up says so, and the attempt reports the file as one that did
   * not arrive rather than one that is coming.
   */
  const id = openTask();
  await mockRepository.submitCompletion({
    taskId: id,
    message: "Final cut attached.",
    attachmentIds: [],
    pendingUploads: [GB_FILE],
  });

  const r = await mockRepository.setSubmissionUploads(id, [
    { ...GB_FILE, state: "failed" },
  ]);
  assert.equal(r.ok, true);

  const [stored] = await mockRepository.listSubmissions(id);
  assert.equal(reviewWaitReason(stored.pendingUploads, NOW), null);
  assert.deepEqual(
    uploadsMissing(stored.pendingUploads, NOW).map((u) => u.name),
    [GB_FILE.name],
  );
  /* And it is no longer counted as coming. */
  assert.equal(fileCountLabel(0, stored.pendingUploads, NOW), "0");
});

test("six hours of silence releases it without anybody writing anything", async () => {
  /* A closed tab writes no failure at all. Without the ageing rule the entry
     above would still say "uploading" tomorrow morning. */
  const id = openTask();
  await mockRepository.submitCompletion({
    taskId: id,
    message: "Final cut attached.",
    attachmentIds: [],
    pendingUploads: [GB_FILE],
  });

  const [stored] = await mockRepository.listSubmissions(id);
  const sixHoursOn = NOW + 6 * 60 * 60 * 1000;
  /* Held now... */
  assert.notEqual(reviewWaitReason(stored.pendingUploads, NOW), null);
  /* ...and released six hours later, with nothing written in between. */
  assert.equal(reviewWaitReason(stored.pendingUploads, sixHoursOn), null);
  assert.equal(uploadsMissing(stored.pendingUploads, sixHoursOn).length, 1);
});

test("nobody else may say what is still coming", async () => {
  /* It decides whether their reviewer may act, so it is the submitter's to
     report on — the same rule the engine applies. */
  const id = openTask();
  await mockRepository.submitCompletion({
    taskId: id,
    message: "Final cut attached.",
    attachmentIds: [],
    pendingUploads: [GB_FILE],
  });

  setActingId(OTHER);
  const r = await mockRepository.setSubmissionUploads(id, []);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.code, "permission_denied");

  /* And the list is untouched, so the reviewer is still held. */
  setActingId(ASSIGNEE);
  const [stored] = await mockRepository.listSubmissions(id);
  assert.equal(stored.pendingUploads.length, 1);
});

test("a submission with no files is exactly as it was", async () => {
  /* The common case must not grow a wait. Nothing coming, nothing held. */
  const id = openTask();
  await mockRepository.submitCompletion({
    taskId: id,
    message: "Nothing to attach.",
    attachmentIds: [],
  });

  const [stored] = await mockRepository.listSubmissions(id);
  assert.deepEqual(stored.pendingUploads, []);
  assert.equal(reviewWaitReason(stored.pendingUploads, NOW), null);
  assert.equal(fileCountLabel(0, stored.pendingUploads, NOW), "0");
});
