import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Why uploads "sometimes failed unexpectedly", and what now prevents it.
 *
 * Five separate faults, and the headline one is in the name: the code opened a
 * Google RESUMABLE upload session, streamed to it, and then treated a dropped
 * connection as fatal. Nothing ever resumed. A 40 MB file that lost its
 * connection at 95% was reported as a failure and the bytes were thrown away —
 * which is exactly why it was worse on larger files, since a bigger file is
 * simply a longer window in which a blip can happen.
 *
 * Alongside it: no retry on any of the three steps, no timeout anywhere (so a
 * stalled upload hung behind a spinner for as long as the tab was open), the
 * chosen file discarded on failure, and a retry that would have made a second
 * Drive file.
 *
 * Asserted on the source. The alternative is a fake `XMLHttpRequest` and a fake
 * Google, and a test that elaborate mostly proves the fake works.
 */

const UPLOAD = "lib/legacy/driveUpload.ts";
const AREA = "components/features/messages/MessagesArea.tsx";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── The resumable session is actually resumed ────────────────────────────── */

test("the upload asks Google how much it already has", () => {
  /* A PUT with an empty body and `Content-Range: bytes STAR/total` is the
     protocol's own way to ask, and it is what makes a resume possible at all. */
  const src = code(UPLOAD);
  assert.match(src, /function queryReceived\(/, "nothing queries the received offset");
  assert.match(src, /Content-Range", `bytes \*\/\$\{total\}`/);
});

test("a 308 is read as progress, not as a failure", () => {
  /* 308 Resume Incomplete is the normal mid-upload answer. Treating it as an
     error is what turned a recoverable interruption into a lost file. */
  const src = code(UPLOAD);
  assert.match(src, /xhr\.status === 308/);
  assert.match(src, /kind: "incomplete",\s*received:/);
});

test("the Range header decides where to continue from", () => {
  /* `Range: bytes=0-1023` means 1024 bytes are in, so the next byte is N+1. An
     off-by-one here either re-sends a byte or skips one, and skipping corrupts
     the file silently. */
  assert.match(code(UPLOAD), /Number\.isFinite\(end\) \? end \+ 1 : 0/);
});

test("a resumed request sends only the remaining bytes", () => {
  const src = code(UPLOAD);
  assert.match(src, /xhr\.send\(offset > 0 \? file\.slice\(offset\) : file\)/);
  assert.match(src, /`bytes \$\{offset\}-\$\{total - 1\}\/\$\{total\}`/);
});

test("progress is reported against the whole file, not the slice", () => {
  /* A resumed upload restarting the bar at zero looks exactly like the failure
     it is recovering from. */
  assert.match(code(UPLOAD), /onProgress\(Math\.min\(1, \(offset \+ e\.loaded\) \/ total\)\)/);
});

test("an expired session is distinguished from a failure", () => {
  /* Nothing can be resumed onto an expired session, so retrying the transfer is
     futile — but opening a NEW one recovers completely. The two need different
     handling, so they cannot share a return shape. */
  const src = code(UPLOAD);
  assert.match(src, /xhr\.status === 404 \|\| xhr\.status === 410/);
  assert.match(src, /kind: "expired"/);
  assert.match(src, /if \("expired" in attempt\)/);
});

test("a new session is opened at most twice", () => {
  /* Recovering from expiry must not become an infinite loop: a session that
     expires immediately is a configuration problem, and retrying for ever would
     hide it behind a spinner. */
  const src = code(UPLOAD);
  assert.match(src, /round <= 2/);
  assert.match(src, /kept expiring/);
});

/* ── Retries, and what is NOT retried ─────────────────────────────────────── */

test("transient failures are retried and permanent ones are not", () => {
  /* A 401 will be a 401 next time and a 403 means no. Retrying those turns an
     instant, readable refusal into a wait for the same words. */
  const src = code(UPLOAD);
  assert.match(
    src,
    /function worthRetrying\(status: number\): boolean \{\s*return status === 0 \|\| status === 408 \|\| status === 429 \|\| status >= 500;/,
  );
  assert.match(src, /if \(last\.ok \|\| !worthRetrying\(last\.error\.status\)\) return last;/);
});

test("retries back off rather than hammering", () => {
  const src = code(UPLOAD);
  assert.match(src, /function backoffMs\(attempt: number\): number/);
  assert.match(src, /await sleep\(backoffMs\(attempt\)\)/);
});

test("a cancelled upload is never retried", () => {
  /* The signal aborting is somebody's decision, not a fault. */
  assert.match(code(UPLOAD), /if \(signal\?\.aborted\) return failure\(0, "Upload cancelled\."\)/);
});

test("progress does not count as a spent attempt", () => {
  /* An upload moving forward in 308 steps is the protocol working. Counting
     each one against the attempt budget would abandon a healthy transfer. */
  assert.match(code(UPLOAD), /attempt--;/);
});

/* ── Nothing hangs ────────────────────────────────────────────────────────── */

test("the metadata calls are bounded", () => {
  /* `fetch` has no timeout of its own: a connection accepted and never answered
     stays pending for as long as the tab is open. */
  const src = code(UPLOAD);
  assert.match(src, /const controller = new AbortController\(\);/);
  assert.match(src, /setTimeout\(\(\) => controller\.abort\(\), META_TIMEOUT_MS\)/);
});

test("the byte transfer uses a STALL timer, not a duration cap", () => {
  /* `xhr.timeout` measures the whole request and would kill a large upload that
     is progressing perfectly well over a slow line. This only fires when
     nothing has moved. */
  const src = code(UPLOAD);
  assert.match(src, /const armStall = \(\) => \{/);
  assert.doesNotMatch(src, /xhr\.timeout =/, "a whole-request timeout would kill slow big uploads");
  const at = src.indexOf("xhr.upload.onprogress");
  assert.match(src.slice(at, at + 120), /armStall\(\);/, "the stall timer is not reset by progress");
});

/* ── The file is not lost, and a retry does not duplicate ─────────────────── */

test("a failed upload keeps its File so retrying does not need the picker", () => {
  const src = code(AREA);
  assert.match(src, /const \[failedUploads, setFailedUploads\] = useState</);
  assert.match(src, /\{ id: string; file: File; message: string \}\[\]/);
});

test("failures are matched to their file by index", () => {
  /* Filtering the results loses which File produced which failure, and that
     File is the whole point of keeping them. */
  assert.match(code(AREA), /results\.forEach\(\(r, i\) => \{/);
  assert.match(code(AREA), /file: batch\[i\]\.file,/);
});

test("the failed list is cleared BEFORE the retry, not after", () => {
  /* `handleFiles` appends fresh failures to it. Clearing afterwards would wipe
     the ones it had just recorded and the retry control would vanish from files
     that are still broken. */
  const src = code(AREA);
  const at = src.indexOf("async function retryFailedUploads()");
  assert.ok(at > 0, "retryFailedUploads not found");
  const body = src.slice(at, src.indexOf("\n  }", at));
  assert.ok(
    body.indexOf("setFailedUploads([])") < body.indexOf("await handleFiles(again)"),
    "the list is cleared after the retry, which discards the new failures",
  );
});

test("a successful upload is never re-sent by a retry", () => {
  /* This is the duplicate guard: anything that uploaded is a MessageAttachment
     in `pending` and is not in the failed list at all, so it cannot go to Drive
     a second time. */
  const src = code(AREA);
  const at = src.indexOf("async function retryFailedUploads()");
  const body = src.slice(at, src.indexOf("\n  }", at));
  assert.match(body, /failedUploads\.map\(\(f\) => f\.file\)/);
  assert.doesNotMatch(body, /pending/, "the retry touches the already-uploaded list");
});

test("failed uploads are dropped once the message is sent", () => {
  /* Holding a retry offer beside an empty composer invites attaching them to
     nothing. */
  const src = code(AREA);
  const at = src.indexOf("const r = await send();");
  const body = src.slice(at, at + 700);
  assert.match(body, /setFailedUploads\(\[\]\)/);
});
