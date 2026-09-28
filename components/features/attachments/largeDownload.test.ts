import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * **Reported 28 September 2026: a 3 GB file said "Opening…" for ever.**
 *
 * The engine was streaming it correctly the whole time. The browser was the
 * problem: `<a download href>` cannot carry an Authorization header, so the
 * page fetched the bytes itself and `res.blob()` assembled every one of them
 * in the tab before anything was offered. At a few megabytes nobody notices.
 * At three gigabytes there is no progress, no save dialog, nothing to cancel,
 * and usually nothing at the end of it either.
 *
 * The fix hands the download to the browser: one small request for a
 * short-lived link, then an ordinary navigation. What is pinned here is that
 * the link path is TRIED FIRST — a fallback that quietly became the main path
 * again would restore the fault exactly, and the symptom would be identical.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const UI = strip("components/features/attachments/Attachments.tsx");
const WIRE = strip("lib/legacy/attachments.ts");
const TYPES = strip("lib/repositories/types.ts");
const REPO = strip("lib/repositories/legacy/index.ts");

const skip = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

test("the button asks for a link before it asks for bytes", () => {
  /* Order is the whole fix. Both branches still exist; which one runs first is
     the difference between a 3 GB download and a 3 GB tab. */
  const at = UI.indexOf("if (repo.attachmentDownloadUrl)");
  const bytes = UI.indexOf("await repo.downloadAttachment(attachment.id)");
  assert.ok(at > 0, "the link path is gone");
  assert.ok(bytes > at, "it still fetches the bytes first");
});

test("with a link, the browser does the downloading and nothing is buffered", () => {
  const branch = UI.slice(
    UI.indexOf("if (repo.attachmentDownloadUrl)"),
    UI.indexOf("const r = await repo.downloadAttachment"),
  );
  assert.match(branch, /a\.href = t\.data;/);
  assert.match(branch, /a\.click\(\);/);
  /* The thing that must NOT be in this branch. An object URL here would mean
     the bytes came through the tab after all. */
  assert.doesNotMatch(branch, /createObjectURL/);
  assert.doesNotMatch(branch, /downloadAttachment/);
});

test("a refusal is shown, not retried down the slow path", () => {
  /* "You do not have access to this file" is the same answer the bytes would
     give, several gigabytes later. */
  const branch = UI.slice(
    UI.indexOf("if (repo.attachmentDownloadUrl)"),
    UI.indexOf("const r = await repo.downloadAttachment"),
  );
  assert.match(branch, /t\.code === "permission_denied"/);
});

test("a large file never falls through to the path that cannot carry it", () => {
  /**
   * **Reported twice, and the second report is why this exists.** After the
   * fix went in, the same screen still said "Opening…" — because the page in
   * front of the person was the previous build, and the fallback made "this
   * page is old" and "this page is broken" look identical.
   *
   * A fallback that cannot finish is not a fallback. Above the ceiling the
   * button says what went wrong instead of starting something that will spin
   * for ten minutes and produce nothing.
   */
  const rules = strip("components/features/attachments/attachmentRules.ts");
  assert.match(rules, /export const BLOB_DOWNLOAD_CEILING_BYTES = 200 \* 1024 \* 1024;/);
  assert.match(UI, /attachment\.size > BLOB_DOWNLOAD_CEILING_BYTES/);
  assert.match(UI, /Cowork could not prepare a download for a file this large/);
  /* And when the store has no link method at all — an older build. */
  assert.match(UI, /This copy of Cowork cannot download a file this large/);

  /* The guard is BEFORE the bytes are asked for, or it guards nothing. */
  const guard = UI.indexOf("attachment.size > BLOB_DOWNLOAD_CEILING_BYTES");
  assert.ok(
    guard < UI.indexOf("await repo.downloadAttachment(attachment.id)"),
    "the size check runs after the download it is supposed to prevent",
  );
});

test("the Blob download survives as the fallback, for a backend without the route", () => {
  /* Removed rather than demoted, it would break every older engine — and it is
     still the right shape for the preview, which needs an object URL. */
  assert.match(UI, /const url = URL\.createObjectURL\(r\.data\);/);
  assert.match(TYPES, /downloadAttachment\(id: string\): Promise<ActionResult<Blob>>;/);
  assert.match(TYPES, /attachmentDownloadUrl\?\(id: string\): Promise<ActionResult<string>>;/);
  assert.match(REPO, /async attachmentDownloadUrl\(id: string\)/);
});

test("the link is built from the engine's path, not guessed", () => {
  /* The engine returns a path because it does not reliably know the origin it
     was reached on; this side already does. Two places inventing one URL is
     how a download works in development and 404s in production. */
  assert.match(WIRE, /export async function createDownloadTicket/);
  assert.match(WIRE, /\/download-ticket`/);
  assert.match(WIRE, /url: `\$\{baseUrl\(\)\}\$\{body\.path\}`/);
});

/* ── The engine ───────────────────────────────────────────────────────────── */

const routes = () => backendSource("routes/task_routes/coworkAttachments.js");

test("the ticket is issued behind the same permission check as the file", { skip }, () => {
  /**
   * The safety of the whole thing. The redeeming request has no session on it,
   * so the ticket carries the ANSWER — which means the question has to be
   * asked, in full, at the moment it is issued.
   */
  const src = routes();
  const issue = src.slice(
    src.indexOf('router.post(\n  "/attachments/:id/download-ticket"'),
    src.indexOf('router.get("/attachments/download/:ticket"'),
  );
  assert.ok(issue.length > 0, "the ticket route is missing");
  assert.match(issue, /const gate = await mayViewTask\(taskId, req\.coworkUser\)/);
  assert.match(issue, /verifyCoworkToken,\s*\n\s*verifyEmployeeToken,/);
  assert.match(issue, /randomBytes\(32\)\.toString\("hex"\)/);
});

test("a ticket expires, and the store cannot grow without bound", { skip }, () => {
  const src = routes();
  assert.match(src, /const TICKET_TTL_MS = 10 \* 60 \* 1000;/);
  assert.match(src, /if \(value\.expiresAt <= now\) tickets\.delete\(key\)/);
  assert.match(src, /while \(tickets\.size > TICKET_MAX\)/);
  /* Pruned on both sides, so an expired ticket cannot be redeemed even if the
     map has not been touched since. */
  const redeem = src.slice(src.indexOf('router.get("/attachments/download/:ticket"'));
  assert.match(redeem, /pruneTickets\(\);/);
});

test("both downloads send the same headers, from one place", { skip }, () => {
  /**
   * The inline-versus-attachment rule is a security decision — an uploaded
   * HTML file served inline runs its author's script in the reader's session —
   * so it cannot exist twice. One helper, called by both routes.
   */
  const src = routes();
  assert.match(src, /async function sendAttachment\(res, record\)/);
  assert.equal((src.match(/await sendAttachment\(res, record\)/g) ?? []).length, 2);
  assert.equal((src.match(/svc\.mayRenderInline\(mimeType\)/g) ?? []).length, 1);
});

test("the size goes out, so the browser can show a real progress bar", { skip }, () => {
  /* Without Content-Length the browser's downloader shows an unbounded
     spinner — the same non-answer the page used to give. Drive's own figure
     is the authority: a length that disagrees with the body truncates it. */
  const src = routes();
  assert.match(src, /Number\(meta\.size\) \|\| Number\(record\.size\) \|\| 0/);
  assert.match(src, /res\.setHeader\("Content-Length", String\(declaredSize\)\)/);
});
