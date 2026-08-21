import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classify,
  failure,
  isRetryable,
  readErrorMessage,
  unwrap,
} from "./envelope.ts";
import { configRefusal, isConfigured, joinUrl, readConfig } from "./config.ts";

/* ── Envelopes ────────────────────────────────────────────────────────────── */

test("a named-key envelope is unwrapped", () => {
  /* GET /cowork/employee/list answers { employees: [...] }. */
  const r = unwrap<string[]>({ employees: ["E001", "E002"] }, "employees");
  assert.deepEqual(r, { ok: true, data: ["E001", "E002"] });
});

test("a success/data envelope is unwrapped", () => {
  const r = unwrap<{ id: number }>({ success: true, data: { id: 7 } });
  assert.deepEqual(r, { ok: true, data: { id: 7 } });
});

test("a bare body is the payload", () => {
  const r = unwrap<{ employeeId: string }>({ employeeId: "E001", role: "tl" });
  assert.equal(r.ok && r.data.employeeId, "E001");
});

test("a bare array is the payload", () => {
  const r = unwrap<number[]>([1, 2, 3]);
  assert.deepEqual(r.ok && r.data, [1, 2, 3]);
});

test("success:false is a FAILURE even with HTTP 200", () => {
  /* The trap: legacy refuses with a 200 body. A parser that only read the
     status code would put "no employees" on screen when the real answer was
     "you are not allowed to see them". */
  const r = unwrap({ success: false, error: "Not permitted." });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error.message, "Not permitted.");
});

test("an empty key is preferred over guessing", () => {
  /* An empty list under the expected key is a real, successful empty result —
     not a malformed response. */
  const r = unwrap<string[]>({ employees: [] }, "employees");
  assert.deepEqual(r, { ok: true, data: [] });
});

test("null and undefined bodies are malformed, not empty successes", () => {
  assert.equal(unwrap(null).ok, false);
  assert.equal(unwrap(undefined).ok, false);
});

/* ── Error messages ───────────────────────────────────────────────────────── */

test("legacy's own wording is preferred over a generic message", () => {
  /* "TL can only bleach employees in their own department." explains the
     refusal. "Request failed" does not. */
  assert.equal(
    readErrorMessage({ error: "TL can only bleach employees in their own department." }),
    "TL can only bleach employees in their own department.",
  );
  assert.equal(readErrorMessage({ message: "Employee not found." }), "Employee not found.");
  assert.equal(readErrorMessage("Missing token"), "Missing token");
});

test("a body with no message yields null, not an empty string", () => {
  assert.equal(readErrorMessage({}), null);
  assert.equal(readErrorMessage({ error: "   " }), null);
  assert.equal(readErrorMessage(42), null);
});

test("a failure without a body still explains itself", () => {
  const r = failure(403, {});
  assert.equal(!r.ok && r.error.message, "You do not have access to this.");
  assert.equal(!r.ok && r.error.kind, "permission");
});

/* ── Error pages are not error messages ───────────────────────────────────── */

/**
 * The engine answered a call to an unmounted route with Express's own 404 page,
 * and the whole document was rendered into the row where the explanation goes:
 *
 *     <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8">
 *     <title>Error</title> </head> <body> <pre>Cannot POST /cowork/…
 *
 * Any front door can do this — nginx, a load balancer, a tunnel — so it is not
 * specific to one deployment being behind.
 */
const EXPRESS_404 =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n' +
  "</head>\n<body>\n<pre>Cannot POST /cowork/employee/GR0122/send-credentials</pre>\n</body>\n</html>\n";

test("an HTML error page is never used as the message", () => {
  assert.equal(readErrorMessage(EXPRESS_404), null);
  assert.equal(readErrorMessage("<html><body>502 Bad Gateway</body></html>"), null);
  assert.equal(readErrorMessage("  <!doctype html><p>nope"), null);
});

test("a 404 served as a page says the server is behind, not that a record is missing", () => {
  const r = failure(404, EXPRESS_404);
  assert.equal(
    !r.ok && r.error.message,
    "This server does not have that feature yet — it may be running an older version.",
  );
  assert.equal(!r.ok && r.error.kind, "not_found");
});

test("a 404 answered properly still reads as a missing record", () => {
  /* The distinction is the whole point: a mounted route that found nothing
     replies in JSON, and that person should go looking for the record. */
  const empty = failure(404, {});
  assert.equal(!empty.ok && empty.error.message, "That could not be found.");

  const named = failure(404, { error: "Employee not found." });
  assert.equal(!named.ok && named.error.message, "Employee not found.");
});

test("a 500 served as a page says so rather than pretending to be an answer", () => {
  const r = failure(502, "<html><head><title>502</title></head><body>nginx</body></html>");
  assert.equal(
    !r.ok && r.error.message,
    "The server answered with an error page rather than an answer.",
  );
});

test("plain-text failures are still passed through — only markup is dropped", () => {
  /* Legacy answers some failures with a bare string, and those ARE the
     explanation. Rejecting every string body would have thrown them away. */
  assert.equal(readErrorMessage("Missing token"), "Missing token");
  assert.equal(
    readErrorMessage("Password must be at least 6 characters."),
    "Password must be at least 6 characters.",
  );
});

/* ── Retry honesty ────────────────────────────────────────────────────────── */

test("statuses are classified by whether retrying could help", () => {
  assert.equal(classify(0), "network");
  assert.equal(classify(401), "auth");
  assert.equal(classify(403), "permission");
  assert.equal(classify(404), "not_found");
  assert.equal(classify(500), "server");
  assert.equal(classify(502), "server");
});

test("only failures that might resolve get a retry", () => {
  /* Offering "try again" on a 403 wastes somebody's time on an action that
     cannot succeed. */
  assert.equal(isRetryable({ message: "", status: 0, kind: "network" }), true);
  assert.equal(isRetryable({ message: "", status: 500, kind: "server" }), true);
  assert.equal(isRetryable({ message: "", status: 403, kind: "permission" }), false);
  assert.equal(isRetryable({ message: "", status: 401, kind: "auth" }), false);
  assert.equal(isRetryable({ message: "", status: 404, kind: "not_found" }), false);
});

/* ── Configuration ────────────────────────────────────────────────────────── */

const FULL_ENV = {
  NEXT_PUBLIC_LEGACY_API_URL: "https://api.example.com/",
  NEXT_PUBLIC_FIREBASE_API_KEY: "k",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "d",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "s",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "m",
  NEXT_PUBLIC_FIREBASE_APP_ID: "a",
};

test("a complete environment is accepted and the URL normalised", () => {
  assert.equal(configRefusal(FULL_ENV), null);
  assert.equal(isConfigured(FULL_ENV), true);
  assert.equal(readConfig(FULL_ENV).apiUrl, "https://api.example.com");
});

/** `FULL_ENV` with one variable unset, the way a half-configured deploy looks. */
function without(name: keyof typeof FULL_ENV) {
  return { ...FULL_ENV, [name]: undefined };
}

test("the missing API URL is named first", () => {
  assert.match(
    configRefusal(without("NEXT_PUBLIC_LEGACY_API_URL")) ?? "",
    /NEXT_PUBLIC_LEGACY_API_URL/,
  );
});

test("a missing Firebase key explains why Firebase is required at all", () => {
  /* Somebody reading this has just been told the new project already has
     authentication. The message has to say why it is not enough. */
  const refusal = configRefusal(without("NEXT_PUBLIC_FIREBASE_API_KEY")) ?? "";
  assert.match(refusal, /NEXT_PUBLIC_FIREBASE_API_KEY/);
  assert.match(refusal, /only Firebase ID tokens/);
});

test("reading an incomplete config throws rather than half-building", () => {
  /* A partial client that fails deep inside a later request is far harder to
     diagnose than one that refuses immediately. */
  assert.throws(() => readConfig({}), /NEXT_PUBLIC_LEGACY_API_URL/);
  assert.equal(isConfigured({}), false);
});

test("URLs join with exactly one slash", () => {
  /* `${base}${path}` with a trailing slash gives //cowork/me, which some
     proxies rewrite and others 404. */
  assert.equal(joinUrl("https://a.com/", "/cowork/me"), "https://a.com/cowork/me");
  assert.equal(joinUrl("https://a.com", "cowork/me"), "https://a.com/cowork/me");
  assert.equal(joinUrl("https://a.com///", "///cowork/me"), "https://a.com/cowork/me");
});
