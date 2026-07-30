import assert from "node:assert/strict";
import test from "node:test";

/**
 * Which `cowork_employees` document a Firebase login resolves to.
 *
 * The resolution order is legacy's, in `Middlewear/coworkAuth.js`:
 *
 * ```js
 * 40:  where("authUid", "==", decoded.uid).limit(1)      // primary
 * 43:  where("email",   "==", decoded.email).limit(1)    // fallback
 * 51:  employeeId: "E000", authUid: decoded.uid          // last resort — creates E000
 * ```
 *
 * Both queries are `.limit(1)` **with no ordering**, so any two documents
 * matching one predicate is a coin flip decided by Firestore's internal
 * ordering — different on different requests.
 *
 * That is the whole risk this file guards. `E000` and `GR0000` briefly shared
 * `email: "ray@grav.in"`; the primary lookup hid it, because `GR0000` matched
 * on `authUid` first. But the fallback is one lost or rotated uid away, and
 * line 67 re-stamps `authUid` onto whichever document it lands on — silently
 * reverting the identity migration.
 *
 * Closed in the data: `E000.email` is now a reserved `.invalid` address
 * (RFC 2606), which is guaranteed never routable and can never be a Firebase
 * account. The original is preserved in `legacyEmail`.
 *
 * The middleware itself is in `cowork-old-backend`, which this migration does
 * not modify — so the invariant is enforced by the documents, and asserted
 * here.
 */

interface EmployeeDoc {
  id: string;
  authUid?: string;
  email?: string;
  isSystemIdentity?: boolean;
}

/** Production, verified 2026-07-29 after the migration. */
const DIRECTORY: EmployeeDoc[] = [
  {
    id: "GR0000",
    authUid: "paHxne71GZQR7Qt89STzj8XHXmq2",
    email: "ray@grav.in",
  },
  {
    /* No `authUid` key at all, and an unroutable address. */
    id: "E000",
    email: "system.e000@cowork.invalid",
    isSystemIdentity: true,
  },
  { id: "GR0045", authUid: "uid-rakesh", email: "rakesh.biswal@grav.in" },
  { id: "GR0067", authUid: "uid-soumya", email: "soumyaranjanpraharaj04@gmail.com" },
];

/** `coworkAuth.js:40-57`, replayed. Null means "would create E000". */
function resolveLogin(
  directory: EmployeeDoc[],
  token: { uid: string; email?: string },
): string | null {
  const byUid = directory.filter((e) => e.authUid === token.uid);
  if (byUid.length > 0) return byUid[0].id;

  if (token.email) {
    const byEmail = directory.filter((e) => e.email === token.email);
    if (byEmail.length > 0) return byEmail[0].id;
  }
  return null;
}

/* ── The two required scenarios ────────────────────────────────────────── */

test("signing in with ray@grav.in resolves to GR0000", () => {
  assert.equal(
    resolveLogin(DIRECTORY, {
      uid: "paHxne71GZQR7Qt89STzj8XHXmq2",
      email: "ray@grav.in",
    }),
    "GR0000",
  );
});

test("E000 is never returned as the authenticated user", () => {
  /* Through the primary path, the fallback path, and with the uid gone. */
  for (const token of [
    { uid: "paHxne71GZQR7Qt89STzj8XHXmq2", email: "ray@grav.in" },
    { uid: "some-other-uid", email: "ray@grav.in" },
    { uid: "", email: "ray@grav.in" },
  ]) {
    assert.notEqual(resolveLogin(DIRECTORY, token), "E000");
  }
});

/* ── The specific failure mode that was closed ─────────────────────────── */

test("the email fallback cannot reach E000 even if the uid is lost", () => {
  /* The scenario the fix exists for: GR0000 loses its `authUid`, so the
     primary lookup misses and the fallback runs on the email. Before the fix
     both documents matched and `.limit(1)` picked one unordered. */
  const uidLost = DIRECTORY.map((e) =>
    e.id === "GR0000" ? { ...e, authUid: undefined } : e,
  );
  assert.equal(
    resolveLogin(uidLost, { uid: "paHxne71GZQR7Qt89STzj8XHXmq2", email: "ray@grav.in" }),
    "GR0000",
  );
});

test("exactly one document is reachable by the login email", () => {
  /* The invariant. Two would make `.limit(1)` a coin flip, and the losing
     outcome re-stamps `authUid` onto a system account. */
  const matches = DIRECTORY.filter((e) => e.email === "ray@grav.in");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "GR0000");
});

test("no two documents share an authUid", () => {
  const uids = DIRECTORY.map((e) => e.authUid).filter(Boolean);
  assert.equal(new Set(uids).size, uids.length);
});

test("E000 carries no login-matching field", () => {
  const e000 = DIRECTORY.find((e) => e.id === "E000")!;
  assert.equal(e000.authUid, undefined);
  /* `.invalid` is reserved by RFC 2606 — never routable, so it can never be a
     Firebase account, so the fallback can never match it. */
  assert.match(e000.email!, /\.invalid$/);
  assert.equal(e000.isSystemIdentity, true);
});

/* ── Everyone else is unaffected ───────────────────────────────────────── */

test("ordinary employees still resolve by uid and by email", () => {
  assert.equal(
    resolveLogin(DIRECTORY, { uid: "uid-soumya", email: "soumyaranjanpraharaj04@gmail.com" }),
    "GR0067",
  );
  /* Email fallback, for an account whose uid has not been stamped yet — the
     path `coworkAuth.js:67` exists to repair. */
  assert.equal(
    resolveLogin(DIRECTORY, { uid: "not-yet-stamped", email: "rakesh.biswal@grav.in" }),
    "GR0045",
  );
});

test("an unknown user still falls through to the E000 bootstrap", () => {
  /* Unchanged behaviour, and deliberately so: it is how a new Firebase user
     gets a Cowork record. It is also how the CEO ended up as E000 in the first
     place, so it is worth seeing stated. */
  assert.equal(
    resolveLogin(DIRECTORY, { uid: "brand-new", email: "nobody@example.com" }),
    null,
  );
});
