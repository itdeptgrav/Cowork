import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

/**
 * Private Cowork attachments.
 *
 * The rule that matters: a file attached in Cowork must never be reachable
 * without an authenticated request that also passes the TASK's own visibility
 * check. The existing `mediaUpload` path makes files public with
 * `permissions.create({ type: "anyone" })`; this one must never do that.
 *
 * The sniffing tests drive the REAL service, because "the backend decides a
 * file's type from its bytes" is a security claim and reading the source would
 * only prove the code exists.
 */

/**
 * Where the engine's source lives, on whichever machine this is running on.
 *
 * It was a single hardcoded macOS path. On any other checkout `available()`
 * returned false and all twenty-one tests here SKIPPED — reported as passing,
 * so a change to the engine's attachment rules could be made with no coverage
 * at all and nothing would say so. That is how a security claim quietly stops
 * being checked.
 *
 * `COWORK_BACKEND` wins where it is set, then the known checkout locations.
 * A machine with none of them still skips, which is honest; what it no longer
 * does is skip on a machine that HAS the backend under a different path.
 */
const BACKEND =
  [
    process.env.COWORK_BACKEND,
    "D:/GRAV_Project/grav-cms-backend",
    "/Users/risheeray/Documents/cowork-old-backend",
  ].find((dir) => {
    if (!dir) return false;
    try {
      return statSync(join(dir, "services/coworkAttachmentRules.js")).isFile();
    } catch {
      return false;
    }
  }) ?? "/Users/risheeray/Documents/cowork-old-backend";
const SERVICE = join(BACKEND, "services/coworkAttachment.service.js");
/* The validation half, dependency-free so it can be driven without a
   credential — which is the point of it being a separate module. */
const RULES = join(BACKEND, "services/coworkAttachmentRules.js");
const ROUTE = join(BACKEND, "routes/task_routes/coworkAttachments.js");
const SHARED = join(BACKEND, "services/mediaUpload.service.js");

const available = () => {
  try {
    return statSync(RULES).isFile();
  } catch {
    return false;
  }
};
/**
 * The engine's source, comments stripped and line endings normalised.
 *
 * **`\r\n` → `\n` matters.** The assertions below match multi-line shapes like
 * `router.post(\n  "/attachments"`, and the backend checkout on Windows has
 * CRLF endings — so every one of them silently failed to match on this
 * platform. Combined with the hardcoded path that used to skip the whole file,
 * a security claim could be false on one machine and unverifiable on the other.
 */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function svc() {
  return createRequire(import.meta.url)(RULES);
}

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/* ── The type comes from the bytes ────────────────────────────────────────── */

test("real formats are recognised from their magic numbers", (t) => {
  if (!available()) return t.skip("backend not present");
  const { sniffMimeType } = svc();
  assert.equal(sniffMimeType(Buffer.from("%PDF-1.7 x"), "application/pdf"), "application/pdf");
  assert.equal(
    sniffMimeType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(8)]), "image/png"),
    "image/png",
  );
  assert.equal(
    sniffMimeType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8)]), "image/jpeg"),
    "image/jpeg",
  );
});

test("a forged extension is refused, not stored under its claim", (t) => {
  if (!available()) return t.skip("backend not present");
  /* The attack this exists to stop: an HTML document named `report.pdf` and
     declared `application/pdf`. Stored, it would later be streamed back with a
     PDF content type. */
  const { sniffMimeType } = svc();
  assert.equal(
    sniffMimeType(Buffer.from("<html><body>x</body></html>"), "application/pdf"),
    null,
  );
});

test("a ZIP cannot claim to be a PDF", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Office formats are ZIPs, so the declared type is consulted — but ONLY to
     choose between ZIP-based formats, never to widen what is accepted. */
  const { sniffMimeType } = svc();
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(8)]);
  assert.equal(sniffMimeType(zip, DOCX), DOCX);
  assert.equal(sniffMimeType(zip, "application/pdf"), null);
});

test("binary content cannot be passed off as text", (t) => {
  if (!available()) return t.skip("backend not present");
  const { sniffMimeType } = svc();
  assert.equal(sniffMimeType(Buffer.from([0x00, 0x01, 0xff, 0x02]), "text/plain"), null);
  assert.equal(sniffMimeType(Buffer.from("a,b,c\n1,2,3"), "text/csv"), "text/csv");
});

test("an unrecognised file is refused rather than defaulted", (t) => {
  if (!available()) return t.skip("backend not present");
  /* "unknown" must never become application/octet-stream and slip past the
     allow-list. */
  const { sniffMimeType } = svc();
  assert.equal(sniffMimeType(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "application/pdf"), null);
  assert.equal(sniffMimeType(Buffer.alloc(0), "application/pdf"), null);
});

test("the filename cannot traverse or inject a header", (t) => {
  if (!available()) return t.skip("backend not present");
  /* It ends up in a Content-Disposition header, so a quote or a newline would
     let the client write headers of its own. */
  const { safeName } = svc();
  const cleaned = safeName('../../etc/pa"ss\nwd');
  for (const bad of ["..", "/", "\\", '"', "\n", "\r"]) {
    assert.equal(cleaned.includes(bad), false, `"${bad}" survived`);
  }
  assert.equal(safeName(""), "attachment");
  assert.equal(safeName(null), "attachment");
});

test("there is no size cap, in the service or on the route", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Withdrawn on the owner's instruction. Checked in all three places at once,
     because a cap surviving in ANY of them is the failure: the route would
     reject before the service ever saw the bytes, and the service is the
     boundary a non-HTTP caller crosses. */
  const s = svc();
  assert.equal(s.MAX_BYTES, null);
  assert.match(code(RULES), /MAX_BYTES = null/);
  /* The check is kept but guarded, so restoring a cap is a one-line change. */
  assert.match(code(SERVICE), /MAX_BYTES !== null && buffer\.length > MAX_BYTES/);
  assert.doesNotMatch(code(ROUTE), /limits:\s*\{\s*fileSize/);
});

/* ── Privacy ──────────────────────────────────────────────────────────────── */

test("no public permission is ever created", (t) => {
  if (!available()) return t.skip("backend not present");
  /* The whole point. `mediaUpload.service.js` does exactly this and is left
     alone; this service must never grow it. */
  for (const path of [SERVICE, RULES, ROUTE]) {
    assert.equal(
      /permissions\.create/.test(code(path)),
      false,
      `${path} grants a Drive permission`,
    );
    assert.equal(/type:\s*["']anyone["']/.test(code(path)), false);
  }
});

test("the shared public service is untouched and still public", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Four non-Cowork features depend on it. This asserts we did NOT quietly
     change their behaviour while building ours. */
  assert.match(readFileSync(SHARED, "utf8"), /type:\s*["']anyone["']/);
});

test("no storage id or URL is returned to a client", (t) => {
  if (!available()) return t.skip("backend not present");
  /* A URL in a response gets copied into a document and becomes a second,
     unguarded way in. The id is the only handle. */
  const src = code(SERVICE);
  const ret = src.slice(src.indexOf("return {\n    id: ref.id"));
  assert.equal(/storageFileId/.test(ret.slice(0, 300)), false);
  const list = code(ROUTE).slice(code(ROUTE).indexOf("attachments: files.map"));
  assert.equal(/storageFileId/.test(list.slice(0, 500)), false);
});

/* ── Authorisation ────────────────────────────────────────────────────────── */

test("every route is authenticated, including the download", (t) => {
  if (!available()) return t.skip("backend not present");
  /* The existing `/media/view/:fileId` is deliberately open because an <img>
     cannot carry a token — acceptable only because those files are already
     public. These are not. */
  const src = code(ROUTE);
  /* Five now — a health diagnostic joined them, and it is authenticated too:
     it reports whether a credential is present and whether Drive answers,
     which is infrastructure detail. */
  const routes = src.match(/router\.(post|get|delete)\(/g) ?? [];
  assert.equal(routes.length, 5);
  /* Minus one for the import line — the earlier count included it and was
     therefore satisfied by three guarded routes plus a destructure. */
  const uses = (name: string) =>
    (src.match(new RegExp(name, "g")) ?? []).length - 1;
  assert.equal(uses("verifyCoworkToken"), 5, "a route is missing authentication");
  assert.equal(uses("verifyEmployeeToken"), 5);
});

test("access follows the task's own visibility, not a new rule", (t) => {
  if (!available()) return t.skip("backend not present");
  /* A parallel permission model would drift from the one deciding whether the
     task is visible, and the file would outlive the task's own gate. */
  const fn = code(ROUTE).slice(code(ROUTE).indexOf("async function mayViewTask("));
  for (const clause of [
    "assigneeIds", "pendingAssigneeId", "assignedBy", "approverId",
    "departmentApprovals", "visibleTo",
  ]) {
    assert.ok(fn.slice(0, 1600).includes(clause), `missing ${clause}`);
  }
});

test("permission is checked before the file is stored", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Otherwise a person with no claim on the task leaves an orphaned private
     file behind every refused upload. */
  const src = code(ROUTE);
  const post = src.slice(src.indexOf('router.post(\n  "/attachments"'));
  const gateAt = post.indexOf("mayViewTask");
  const uploadAt = post.indexOf("svc.uploadAttachment");
  assert.ok(gateAt > 0 && uploadAt > 0 && gateAt < uploadAt);
});

test("the download re-checks access on every read", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Who can see a task changes as it moves; a link shared onward must not
     outlive the sharer's own access. */
  const src = code(ROUTE);
  const get = src.slice(src.indexOf('router.get(\n  "/attachments/:id"'));
  assert.match(get.slice(0, 1800), /mayViewTask\(taskId, req\.coworkUser\)/);
});

test("deleting is narrower than viewing", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Seeing a task is not authority to destroy somebody else's evidence on it. */
  const del = code(ROUTE).slice(code(ROUTE).indexOf('router.delete('));
  assert.match(del.slice(0, 1600), /isUploader/);
  assert.match(del.slice(0, 1600), /isOwner/);
  assert.match(del.slice(0, 1600), /isCeo/);
});

test("a private file is never cached by a shared proxy", (t) => {
  if (!available()) return t.skip("backend not present");
  const src = code(ROUTE);
  assert.match(src, /"Cache-Control",\s*"private, no-store"/);
  assert.equal(
    /public, max-age/.test(src),
    false,
    "a private response is publicly cacheable",
  );
});

/* ── Failures are typed, not prose ────────────────────────────────────────── */

test("a missing credential is an operator problem, not a bad request", (t) => {
  if (!available()) return t.skip("backend not present");
  /* A client that retries a 400 never succeeds, and a person told "bad
     request" keeps changing the file. 503 says the server is at fault. */
  const src = code(ROUTE);
  assert.match(src, /e\.code === "STORAGE_NOT_CONFIGURED" \? 503 : 400/);
});

test("every failure carries a code the UI can branch on", (t) => {
  if (!available()) return t.skip("backend not present");
  const src = code(ROUTE);
  for (const c of [
    "STORAGE_NOT_CONFIGURED", "UPLOAD_FAILED",
    "DOWNLOAD_FAILED", "PERMISSION_DENIED", "LIST_FAILED",
  ]) {
    assert.ok(src.includes(c), `missing ${c}`);
  }
});

test("health is declared before the id route it would otherwise match", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Express would match "health" as an attachment id and answer "Attachment
     not found" — the least useful possible reply to "is storage working". */
  const src = code(ROUTE);
  assert.ok(
    src.indexOf('"/attachments/health"') < src.indexOf('"/attachments/:id"'),
    "the health route is shadowed by :id",
  );
});

test("storage configuration is checked without attempting a call", (t) => {
  if (!available()) return t.skip("backend not present");
  /* So a boot-time warning costs nothing and cannot hang startup. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function storageConfigured("));
  assert.match(fn.slice(0, 600), /client_email && j\.private_key/);
  assert.equal(/await/.test(fn.slice(0, 600)), false);
});

test("a missing credential warns at boot but does not stop the server", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Every other Cowork feature works without it; refusing to start would turn
     a missing attachment credential into a total outage. */
  /* Through `BACKEND`, not a second hardcoded path — this one was missed when
     the others were resolved and failed with ENOENT rather than skipping. */
  const server = code(join(BACKEND, "server.js"));
  assert.match(server, /Private attachment storage is disabled because GOOGLE_SERVICE_ACCOUNT_KEY is missing/);
  assert.match(server, /console\.warn\(/);
  const at = server.indexOf("storageConfigured()");
  assert.equal(
    /process\.exit|throw /.test(server.slice(at, at + 400)),
    false,
    "a missing attachment credential halts the server",
  );
});
