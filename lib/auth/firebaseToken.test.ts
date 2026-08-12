import assert from "node:assert/strict";
import { test } from "node:test";
import { checkClaims, decode, maxAgeMs } from "./firebaseToken.ts";
import { LEGACY_LANDING, archetypeForLegacyRole } from "./roleMap.ts";
import { FIREBASE_COOKIE_MAX_AGE, readFirebaseCookie } from "./firebaseCookie.ts";

const PROJECT = "grav-cms-38f45";
const NOW = 1_785_153_600; // seconds

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (header: unknown, payload: unknown) =>
  `${b64(header)}.${b64(payload)}.${Buffer.from("sig").toString("base64url")}`;

const goodPayload = {
  iss: `https://securetoken.google.com/${PROJECT}`,
  aud: PROJECT,
  sub: "uid-123",
  exp: NOW + 3600,
  iat: NOW,
  email: "rakesh@grav.in",
  email_verified: true,
  name: "Rakesh Biswal",
};

/* ── Decoding ─────────────────────────────────────────────────────────────── */

test("a well-formed token decodes into header and payload", () => {
  const d = decode(token({ alg: "RS256", kid: "k1" }, goodPayload))!;
  assert.equal(d.header.kid, "k1");
  assert.equal(d.payload.sub, "uid-123");
  assert.ok(d.signed.includes("."), "the signed portion is header.payload");
});

test("anything that is not three segments is rejected", () => {
  assert.equal(decode("not-a-token"), null);
  assert.equal(decode("a.b"), null);
  assert.equal(decode(""), null);
});

test("non-JSON segments are rejected rather than throwing", () => {
  assert.equal(decode("!!!.!!!.!!!"), null);
});

/* ── Claims ───────────────────────────────────────────────────────────────── */

const check = (payload: Record<string, unknown>, nowSeconds = NOW) =>
  checkClaims({ payload, projectId: PROJECT, nowSeconds });

test("a valid payload yields the identity claims", () => {
  const r = check(goodPayload);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.claims.uid, "uid-123");
  assert.equal(r.ok && r.claims.email, "rakesh@grav.in");
  assert.equal(r.ok && r.claims.emailVerified, true);
});

test("a token from another Firebase project is refused", () => {
  /* Without this, anybody with a Google-signed token from ANY project could
     present it — the audience check is what binds a token to Cowork. */
  const r = check({ ...goodPayload, aud: "some-other-project" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "wrong_audience");
});

test("a wrong issuer is refused", () => {
  const r = check({ ...goodPayload, iss: "https://evil.example/" });
  assert.equal(!r.ok && r.reason, "wrong_issuer");
});

test("an expired token is refused", () => {
  const r = check({ ...goodPayload, exp: NOW - 3600 });
  assert.equal(!r.ok && r.reason, "expired");
});

test("a little clock skew is tolerated, a lot is not", () => {
  /* Google's clock and ours will not agree exactly; rejecting on a second of
     drift would sign people out at random. */
  assert.equal(check({ ...goodPayload, exp: NOW - 30 }).ok, true, "30s within leeway");
  assert.equal(check({ ...goodPayload, exp: NOW - 120 }).ok, false, "2m is expired");
});

test("a token with no subject is refused", () => {
  const r = check({ ...goodPayload, sub: undefined });
  assert.equal(!r.ok && r.reason, "no_subject");
});

test("a missing exp is treated as expired, never as eternal", () => {
  const r = check({ ...goodPayload, exp: undefined });
  assert.equal(!r.ok && r.reason, "expired");
});

test("optional profile claims default to null, not to guesses", () => {
  const r = check({ iss: goodPayload.iss, aud: PROJECT, sub: "u", exp: NOW + 60 });
  assert.equal(r.ok && r.claims.email, null);
  assert.equal(r.ok && r.claims.name, null);
  assert.equal(r.ok && r.claims.emailVerified, false);
});

/* ── Certificate caching ──────────────────────────────────────────────────── */

test("Google's own max-age is respected, within a ceiling", () => {
  /* A cache that outlived Google's key rotation would reject every freshly
     signed token — an outage that reads as "nobody can log in". */
  assert.equal(maxAgeMs("public, max-age=19260"), 19_260_000);
  assert.equal(maxAgeMs(null), 3_600_000, "an hour when Google says nothing");
  assert.equal(maxAgeMs("max-age=99999999"), 21_600_000, "capped at six hours");
});

/* ── Role mapping ─────────────────────────────────────────────────────────── */

test("the owner-approved mapping holds", () => {
  assert.equal(archetypeForLegacyRole("ceo"), "system_admin");
  assert.equal(archetypeForLegacyRole("tl"), "manager");
  assert.equal(archetypeForLegacyRole("employee"), "employee");
});

test("an unrecognised role maps DOWN to employee, never up", () => {
  /* Matching the engine, where anything not "ceo"/"tl" fails both checks.
     Guessing upward would grant access the engine then refuses. */
  for (const role of ["superadmin", "admin", "", null, undefined, 42]) {
    assert.equal(archetypeForLegacyRole(role), "employee", `${String(role)}`);
  }
});

test("only ceo reaches an archetype that opens /admin", () => {
  /* mayOpenAdmin allows system_admin and people_ops; a TL must not get either. */
  assert.equal(archetypeForLegacyRole("tl"), "manager");
  assert.notEqual(archetypeForLegacyRole("tl"), "people_ops");
});

test("everyone lands on the workspace", () => {
  assert.equal(LEGACY_LANDING, "/home");
});

/* ── Cookie mirroring ─────────────────────────────────────────────────────── */

test("the mirrored token is found in a cookie header", () => {
  /* Firebase keeps its token in IndexedDB, which the Edge cannot see. The
     client mirrors it here so middleware has something to check. */
  assert.equal(readFirebaseCookie("cowork_fb=abc.def.ghi"), "abc.def.ghi");
  assert.equal(
    readFirebaseCookie("theme=dark; cowork_fb=abc.def.ghi; other=1"),
    "abc.def.ghi",
  );
});

test("an absent or empty cookie reads as no token, never as empty string", () => {
  assert.equal(readFirebaseCookie(null), null);
  assert.equal(readFirebaseCookie("theme=dark"), null);
  assert.equal(readFirebaseCookie("cowork_fb="), null);
  assert.equal(readFirebaseCookie("cowork_fb=   "), null);
});

test("a cookie whose name merely contains ours is not mistaken for it", () => {
  assert.equal(readFirebaseCookie("not_cowork_fb=xyz"), null);
  assert.equal(readFirebaseCookie("cowork_fb_old=xyz"), null);
});

test("the mirror outlives the token it mirrors", () => {
  /**
   * **This asserted the opposite, and the opposite was the bug.** An hour,
   * matching Firebase's own token lifetime, on the reasoning that a closed
   * browser should leave nothing usable behind for long.
   *
   * What it actually left behind was nothing at all: come back after lunch and
   * the cookie has expired, so the Edge — which runs before any JavaScript —
   * sees an anonymous request and redirects to the sign-in page, while the
   * refresh token sits in IndexedDB, valid, one call from restoring everything.
   * People were typing passwords to recover sessions that had never ended.
   *
   * The cookie is not the credential's lifetime; it is the browser's claim to
   * have a session worth restoring. What stops an old one being useful is the
   * signature check and the bounded expiry grace, not a short cookie — see
   * `sessionPersists.test.ts`.
   */
  assert.ok(FIREBASE_COOKIE_MAX_AGE > 3600);
});
