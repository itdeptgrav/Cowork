/**
 * Which half of an upload a file is in, and what to say about it.
 *
 * ## The gap this exists to make visible
 *
 * `uploadToDrive` reports 0–1 **across the byte transfer only** — its own
 * comment says so. After the last byte lands there is still a
 * `POST /cowork/upload/drive-finalize`, and that call is not a formality: the
 * backend confirms the file with Drive and grants `role: reader, type: anyone`,
 * without which the image cannot be rendered by anybody. It takes as long as
 * Drive takes.
 *
 * So the bar reached 100%, stopped, and sat there. Nothing said whether the
 * upload was finishing or had hung, and 100% reads as done — which is the
 * reported fault: an attachment that looked ready while it was still being
 * processed.
 *
 * ## Derived, never stored
 *
 * A file is still in `uploadProgress` for exactly as long as its promise is
 * unresolved, and its fraction only reaches 1 once the bytes are gone.
 * "Listed AND at 1" therefore means "bytes sent, finalize outstanding" without
 * any new state to keep in step — a second flag would be a second thing that
 * could disagree with the first, which is how a spinner gets left on screen
 * over an upload that finished.
 */

export type UploadStage = "sending" | "processing";

/**
 * 0–100, clamped, never NaN.
 *
 * `Math.round(undefined)` is NaN and it reaches three places — an
 * `aria-valuenow` no screen reader can say, a `width: NaN%` the browser
 * discards, and the figure on screen. Both threads had grown their own copy of
 * this guard; this is the one they now share.
 */
export function uploadPercent(fraction: number): number {
  const pct = Math.round((Number(fraction) || 0) * 100);
  return Math.max(0, Math.min(100, pct));
}

export function uploadStage(fraction: number): UploadStage {
  return uploadPercent(fraction) >= 100 ? "processing" : "sending";
}

/** What the row says while it is in that stage. */
export function uploadStageLabel(stage: UploadStage): string {
  return stage === "processing" ? "Processing…" : "Uploading";
}

/**
 * The accessible description of the whole row.
 *
 * Processing is genuinely INDETERMINATE — the finalize round trip reports no
 * progress of its own — so the row drops `aria-valuenow` rather than pinning it
 * at 100. A progressbar stuck at "100%" while work continues is precisely the
 * wrong thing to say, in the accessibility tree as much as on screen.
 */
export function uploadAriaLabel(name: string, stage: UploadStage): string {
  return stage === "processing"
    ? `Processing ${name}`
    : `Uploading ${name}`;
}
