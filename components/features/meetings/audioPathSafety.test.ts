import assert from "node:assert/strict";
import { test } from "node:test";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * An id from a request body must never become a filesystem path.
 *
 * ## The bug these pin
 *
 * `routes/task_routes/audioRecording.routes.js` builds temp directories from
 * `meetId` and `employeeId`, and both arrive from callers. Every one of them was
 * concatenated straight in:
 *
 * ```js
 * function getChunkDir(meetId, employeeId) {
 *   return path.join(TMP_BASE, meetId, employeeId);
 * }
 * ```
 *
 * `path.join` RESOLVES `..` rather than rejecting it, so `meetId = "../../.."`
 * walked out of `TMP_BASE`. That matters because the finalize paths end in
 * `fs.rmSync(dir, { recursive: true, force: true })`, and `mergeChunks` returns
 * `null` for any directory without `chunk_*` files — which is every ordinary
 * directory. So an escaped path was a recursive delete of somebody else's
 * files.
 *
 * `POST /cowork/audio/beacon-finalize` made it reachable with no credentials at
 * all. It is called by `navigator.sendBeacon` on unload, which cannot set an
 * Authorization header, so the route is unauthenticated by necessity and its
 * header comment says so. An unauthenticated destructive path traversal is the
 * worst shape a bug takes, and `meetId` was the only thing between an anonymous
 * POST and the delete.
 *
 * ## Why this is asserted at the helper and not at the call sites
 *
 * There are eighteen places that build one of these paths. Guarding them one at
 * a time is a guarantee that lasts until the nineteenth is added, so the checks
 * live in `getChunkDir` / `getBackupChunkDir` / `containedPath` and these tests
 * pin that no raw join comes back.
 *
 * Source-read rather than executed: the route module wants `express`, `multer`,
 * Socket.IO and a Firebase credential at import time, none of which exist under
 * plain `node --test`.
 */

const ROUTES = "routes/task_routes/audioRecording.routes.js";
const SKIP_ENGINE = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

test("ids are validated as single path segments", { skip: SKIP_ENGINE }, () => {
  const src = backendSource(ROUTES);
  assert.match(src, /const SAFE_ID = \/\^\[A-Za-z0-9_-\]\{1,128\}\$\//);
  assert.match(
    src,
    /function safeSegment\(/,
    "the segment validator is gone, so an id can carry a separator again",
  );
});

test("the temp root is proved, not assumed", { skip: SKIP_ENGINE }, () => {
  /* The backstop behind the regex: even a caller that forgets to validate
     cannot address anything outside TMP_BASE. */
  const src = backendSource(ROUTES);
  assert.match(src, /function containedPath\(/);
  assert.match(
    src,
    /resolved !== root && !resolved\.startsWith\(root \+ path\.sep\)/,
    "the containment check no longer compares against the resolved root",
  );
});

test("no chunk directory is built by a raw join", { skip: SKIP_ENGINE }, () => {
  const src = backendSource(ROUTES);

  /* `containedPath` owns the only legitimate `path.join(TMP_BASE, ...)`. Any
     other is a path built without the guard. */
  const rawJoins = [...src.matchAll(/path\.join\(TMP_BASE[^)]*\)/g)].map(
    (m) => m[0],
  );
  assert.equal(
    rawJoins.length,
    1,
    `TMP_BASE is joined directly ${rawJoins.length} times; only containedPath may do that. Found: ${rawJoins.join(" | ")}`,
  );
  assert.match(rawJoins[0], /\.\.\.segments/, "the one raw join is not containedPath's");

  for (const helper of ["getChunkDir", "getBackupChunkDir"]) {
    const at = src.indexOf(`function ${helper}(`);
    assert.ok(at !== -1, `${helper} is gone`);
    const body = src.slice(at, src.indexOf("}", at));
    assert.match(
      body,
      /containedPath\(/,
      `${helper} builds a path without containment`,
    );
    assert.match(
      body,
      /safeSegment\(/,
      `${helper} builds a path from an unvalidated id`,
    );
  }
});

test(
  "the unauthenticated beacon validates the id before touching the disk",
  { skip: SKIP_ENGINE },
  () => {
    /* This is the route with no token. If the check ever moves below the
       `readdirSync`/`rmSync`, the traversal is open again. */
    const src = backendSource(ROUTES);
    const at = src.indexOf('"/audio/beacon-finalize"');
    assert.ok(at !== -1, "the beacon-finalize route is gone");
    const body = src.slice(at, at + 4000);

    const validated = body.indexOf("safeSegment(meetId");
    const listed = body.indexOf("readdirSync");
    assert.ok(validated !== -1, "beacon-finalize does not validate meetId");
    assert.ok(
      listed === -1 || validated < listed,
      "beacon-finalize reads the directory before validating meetId",
    );
  },
);
