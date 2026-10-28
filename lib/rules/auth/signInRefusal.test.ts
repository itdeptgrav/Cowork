/**
 * A correct password the workspace then refuses is told WHICH refusal it was
 * (21 Oct 2026). A 401 from `/cowork/me` — the engine could not verify the
 * token — used to be reported as "not registered", and on cowork.grav.in that
 * was every sign-in: the engine there was configured for another Firebase
 * project and refused every token with `incorrect "aud"`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  INVALID_CREDENTIAL_MESSAGE,
  MISCONFIGURED_SIGN_IN_NOTICE,
  NOT_REGISTERED_SIGN_IN_NOTICE,
  TOKEN_PROJECT_MISMATCH_CODE,
  UNVERIFIED_SIGN_IN_NOTICE,
  signInRefusal,
} from "./signInRefusal.ts";
import { HR_INACTIVE_CODE } from "./hrInactive.ts";

/* The engine's own words for a token from another project, verbatim. */
const AUD =
  'Auth error: Firebase ID token has incorrect "aud" (audience) claim. Expected "testing-63656" but got "grav-cms-38f45".';

test("a 403 is the engine answering: not registered, or inactive in HR", () => {
  assert.equal(signInRefusal({ kind: "permission", message: "Employee not found in Firestore. Ask your CEO." }), "refused");
  assert.equal(signInRefusal({ kind: "permission", code: HR_INACTIVE_CODE }), "inactive");
});

test("a 401 is never reported as not registered", () => {
  assert.equal(signInRefusal({ kind: "auth", code: TOKEN_PROJECT_MISMATCH_CODE, message: AUD }), "misconfigured");
  /* An engine deployed before the code existed is still diagnosed by its wording. */
  assert.equal(signInRefusal({ kind: "auth", message: AUD }), "misconfigured");
  assert.equal(signInRefusal({ kind: "auth", message: "Auth error: bad token" }), "unverified");
  assert.equal(signInRefusal({ kind: "auth", message: "Missing token" }), "unverified");
});

test("the session leaves each refusal its own sentence", () => {
  const s = readFileSync("components/features/auth/SessionProvider.tsx", "utf8");
  assert.match(s, /data\.reason === "refused"\) leaveSignInNotice\(NOT_REGISTERED_SIGN_IN_NOTICE\)/);
  assert.match(s, /data\.reason === "misconfigured"\) leaveSignInNotice\(MISCONFIGURED_SIGN_IN_NOTICE\)/);
  assert.match(s, /data\.reason === "unverified"\) leaveSignInNotice\(UNVERIFIED_SIGN_IN_NOTICE\)/);
  const form = readFileSync("components/features/auth/SignInForm.tsx", "utf8");
  assert.match(form, /case "auth\/invalid-credential":\s*return INVALID_CREDENTIAL_MESSAGE;/);
});

test("no Cowork password starts as the mobile number, and nothing says it does", () => {
  assert.doesNotMatch(INVALID_CREDENTIAL_MESSAGE, /mobile/i);
  assert.doesNotMatch(readFileSync("components/features/auth/SignInForm.tsx", "utf8"), /mobile number/);
});

test("the help article quotes every one of these sentences as shown", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  for (const sentence of [
    NOT_REGISTERED_SIGN_IN_NOTICE,
    UNVERIFIED_SIGN_IN_NOTICE,
    MISCONFIGURED_SIGN_IN_NOTICE,
    INVALID_CREDENTIAL_MESSAGE,
  ]) {
    assert.ok(help.includes(sentence), `help does not quote: ${sentence}`);
  }
});
