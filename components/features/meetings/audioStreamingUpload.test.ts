import assert from "node:assert/strict";
import { test } from "node:test";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * The recording upload STREAMS to Drive — it never loads the whole file into
 * memory.
 *
 * The old finalize called `mergeChunks`, which `fs.readFileSync`'d every chunk
 * and concatenated them into ONE Buffer: a 500 MB recording became 500 MB of
 * RAM, and several people finalizing at once could out-of-memory-kill the
 * process. Now the chunks are streamed off disk one at a time
 * (`createMergedStream`), and googleapis pipes that stream straight to Drive
 * without buffering it (see multipartUpload in googleapis-common). These pin
 * that the memory-bounded path is what ships, across every finalize route.
 *
 * Source-read (see audioPathSafety.test.ts for why the module cannot be
 * import-executed under `node --test`). Comments are stripped first, so the
 * prose above — which NAMES the old approach — is not mistaken for the code
 * still doing it.
 */

const ROUTES = "routes/task_routes/audioRecording.routes.js";
const SKIP_ENGINE = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

function codeOnly() {
  return backendSource(ROUTES)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the whole-file in-memory merge is gone", { skip: SKIP_ENGINE }, () => {
  const src = codeOnly();
  assert.doesNotMatch(
    src,
    /Buffer\.concat/,
    "a Buffer.concat still merges the whole recording in memory",
  );
  assert.doesNotMatch(
    src,
    /function mergeChunks\(/,
    "mergeChunks (the in-memory merge) is back",
  );
  assert.doesNotMatch(
    src,
    /readFileSync/,
    "readFileSync reads a whole chunk into memory — stream it instead",
  );
});

test("chunks are streamed off disk, one at a time", { skip: SKIP_ENGINE }, () => {
  const src = codeOnly();
  assert.match(src, /function createMergedStream\(/);
  assert.match(src, /fs\.createReadStream\(/, "the merge does not read from disk as a stream");
  assert.match(src, /Readable\.from\(/, "the concatenation is not exposed as a stream");
  assert.match(src, /function listChunkFiles\(/);
  assert.match(src, /function chunkFilesSize\(/);
});

test("each upload attempt builds a FRESH stream (retry-safe)", { skip: SKIP_ENGINE }, () => {
  const src = codeOnly();
  const at = src.indexOf("function uploadFileWithRetry(");
  assert.ok(at !== -1, "uploadFileWithRetry is gone");
  const body = src.slice(at, src.indexOf("async function uploadAudioToDrive", at));
  /* Inside the retry loop — a consumed stream cannot be replayed, so a retry
     rebuilds it from disk rather than carrying a buffer. */
  assert.match(body, /for \(let attempt/);
  assert.match(body, /createMergedStream\(chunkFiles\)/);
  assert.doesNotMatch(body, /\bbuffer\b/i, "the retry still holds a whole buffer");
});

test("a chunk read fault can't crash the server (error listener + abort)", { skip: SKIP_ENGINE }, () => {
  const src = codeOnly();
  const at = src.indexOf("function uploadFileWithRetry(");
  assert.ok(at !== -1, "uploadFileWithRetry is gone");
  const body = src.slice(at, src.indexOf("async function uploadAudioToDrive", at));
  /* The merged stream is handed to googleapis as the media body. googleapis
     pipes it without ever listening for its `error`, and Node's pipe() does not
     forward a source error to the destination — so an unhandled read fault mid
     upload becomes an uncaughtException that takes the whole backend down. The
     'error' MUST be listened for here. */
  assert.match(
    body,
    /\.on\(\s*["']error["']/,
    "the media body's 'error' is unhandled — a chunk read fault would crash the server",
  );
  /* And the in-flight request must be abortable, so a body error REJECTS the
     upload (into the try/catch) instead of hanging forever on a body that will
     never finish. */
  assert.match(body, /AbortController/, "no AbortController — a body error would hang the upload, not reject it");
  assert.match(body, /signal:/, "the abort signal is never passed to drive.files.create");
});

test("every finalize route uploads the chunk-file list, not a buffer", { skip: SKIP_ENGINE }, () => {
  const src = codeOnly();
  /* Four finalize paths — employee, backup, guest, beacon — each lists the
     chunk files and hands them to the streamed upload. */
  const listCalls = [...src.matchAll(/listChunkFiles\(chunkDir\)/g)].length;
  assert.ok(
    listCalls >= 4,
    `expected all four finalize routes to list chunk files, found ${listCalls}`,
  );
  assert.match(src, /uploadAudioToDrive\(\s*chunkFiles,/);
  assert.doesNotMatch(
    src,
    /uploadAudioToDrive\(\s*merged/,
    "a route still passes an in-memory buffer to the upload",
  );
});
