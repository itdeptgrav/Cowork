/**
 * Files that were handed over with a submission but have not arrived yet.
 *
 * **Reported 28 September 2026, with two screenshots.** A 3 GB video was
 * attached, Submit was pressed, and the task went to the reviewer at once — as
 * it should, because the timer stops on submit and lateness is stamped there.
 * But the attempt then read:
 *
 *     Submitted files (0)
 *     No files on this attempt.
 *
 * while the file was at 1%. That is not a loading state, it is a false
 * statement, and it was shown to the reviewer as readily as to the person
 * uploading — whose progress bar lives only in their own browser. The reviewer
 * could open that submission and approve it, or send it back for having
 * nothing attached, while the work was still on its way.
 *
 * **The fix is to say what is true, not to reorder the submission.** Making
 * Submit wait for the upload was the obvious alternative and is the wrong one:
 * `TaskSubmission.wasLate` is computed against the deadline AT SUBMISSION TIME
 * and feeds scoring, so a forty-minute upload would mark an on-time hand-over
 * late and cost somebody score for the size of their own file.
 *
 * So the submission records what is coming. The screens read that list through
 * this module, and the reviewer's decision waits for it.
 *
 * Nothing here is derived from the files themselves — an upload runs in one
 * browser and nothing else can see it, which is the whole reason the list has
 * to be written down at submission time.
 */

import type { SubmissionUpload } from "@/lib/domain";

/* The shape lives on the record, in `lib/domain/tasks.ts`. Re-exported so a
   caller reading this file for the rules does not have to go and find it. */
export type { SubmissionUpload };

/**
 * How long an upload may say it is running before it is presumed gone.
 *
 * The browser that is uploading writes `failed` when it fails — but a closed
 * tab or a laptop that never comes back writes nothing at all, and an entry
 * left at `uploading` would hold the reviewer for ever. Six hours: long enough
 * that a genuinely enormous file on a bad line is never cut off, short enough
 * that nobody is blocked into a second day.
 *
 * Derived on every read rather than stored — there is no process anywhere that
 * would do the writing, and a flag nobody sets is a flag that lies.
 */
export const UPLOAD_ABANDONED_AFTER_MS = 6 * 60 * 60 * 1000;

export type UploadState = "uploading" | "failed" | "abandoned";

/** What this upload is actually doing, as of `nowMs`. */
export function uploadState(
  upload: SubmissionUpload,
  nowMs: number,
): UploadState {
  if (upload.state === "failed") return "failed";
  const started = Date.parse(upload.startedAt);
  /* An unreadable stamp cannot be aged, and treating it as abandoned would
     release the reviewer on a formatting fault. It stays "uploading" until
     somebody says otherwise. */
  if (!Number.isFinite(started)) return "uploading";
  return nowMs - started >= UPLOAD_ABANDONED_AFTER_MS ? "abandoned" : "uploading";
}

/**
 * Is a file still on its way?
 *
 * This is what holds the reviewer's decision. Only a genuinely running upload
 * counts — one that failed, or that has been silent long enough to be presumed
 * gone, releases them.
 */
export function uploadsStillRunning(
  uploads: SubmissionUpload[] | undefined,
  nowMs: number,
): boolean {
  return (uploads ?? []).some((u) => uploadState(u, nowMs) === "uploading");
}

/** The ones that are not coming — failed, or silent long enough to presume so. */
export function uploadsMissing(
  uploads: SubmissionUpload[] | undefined,
  nowMs: number,
): SubmissionUpload[] {
  return (uploads ?? []).filter((u) => uploadState(u, nowMs) !== "uploading");
}

/** The ones still running. */
export function uploadsRunning(
  uploads: SubmissionUpload[] | undefined,
  nowMs: number,
): SubmissionUpload[] {
  return (uploads ?? []).filter((u) => uploadState(u, nowMs) === "uploading");
}

/**
 * The count line above a submission's files.
 *
 * "Submitted files (0)" was the whole complaint: true about what had arrived
 * and silent about what was coming. With something in flight it reads "0 of 1",
 * which is the same number plus the part that was missing.
 */
export function fileCountLabel(
  arrived: number,
  uploads: SubmissionUpload[] | undefined,
  nowMs: number,
): string {
  const expected = arrived + uploadsRunning(uploads, nowMs).length;
  return expected > arrived ? `${arrived} of ${expected}` : String(arrived);
}

/**
 * Why the reviewer cannot decide yet, or null when they can.
 *
 * A sentence rather than a boolean, for the same reason the composer's refusal
 * is: a control that is simply dead teaches nobody anything, and "approve" is
 * the last place to leave somebody guessing.
 */
export function reviewWaitReason(
  uploads: SubmissionUpload[] | undefined,
  nowMs: number,
): string | null {
  const running = uploadsRunning(uploads, nowMs);
  if (running.length === 0) return null;
  return running.length === 1
    ? `${running[0].name} is still uploading. The decision opens once it arrives.`
    : `${running.length} files are still uploading. The decision opens once they arrive.`;
}

/**
 * Read a stored list back, keeping only entries that are actually usable.
 *
 * The record is written by a browser and read by every screen, so a half-formed
 * entry is a real possibility and rendering `undefined is still uploading` at a
 * reviewer would be worse than dropping it. A dropped entry releases the
 * decision, which is the safe direction: it can only ever un-block.
 */
export function readSubmissionUploads(raw: unknown): SubmissionUpload[] {
  if (!Array.isArray(raw)) return [];
  const out: SubmissionUpload[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const u = item as Record<string, unknown>;
    const name = typeof u.name === "string" ? u.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      sizeBytes: Number(u.sizeBytes) || 0,
      startedAt: typeof u.startedAt === "string" ? u.startedAt : "",
      state: u.state === "failed" ? "failed" : "uploading",
    });
  }
  return out;
}
