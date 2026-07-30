import assert from "node:assert/strict";
import test from "node:test";

import { checkClaims, decode, verifyIdToken } from "./firebaseToken.ts";

/**
 * The authentication bypass.
 *
 * The route gate accepted any token whose **claims** looked right, without
 * checking the signature. A JWT payload is base64, not a secret, and the
 * session cookie is written by client JavaScript so it is not `httpOnly` —
 * meaning anyone could type a valid-looking credential.
 *
 * Confirmed against the running app before the fix: this exact token returned
 * **200 on `/team`**. After it, 307 to `/signin`.
 */

const PROJECT = "grav-cms-38f45";
const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");

function forgedToken(nowSeconds: number): string {
  return [
    b64({ alg: "RS256", typ: "JWT", kid: "fake" }),
    b64({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: "GR0045",
      auth_time: nowSeconds,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      user_id: "GR0045",
    }),
    Buffer.from("not-a-real-signature").toString("base64url"),
  ].join(".");
}

test("a forged token passes the claims check — which is why claims alone were not enough", () => {
  const now = 1_800_000_000;
  const decoded = decode(forgedToken(now))!;
  assert.ok(decoded);
  /* Issuer, audience and expiry are all attacker-supplied, so of course they
     check out. This assertion exists to document that the old gate was not
     merely weak — it was verifying values the attacker chose. */
  assert.equal(
    checkClaims({
      payload: decoded.payload,
      projectId: PROJECT,
      nowSeconds: now,
    }).ok,
    true,
  );
});

test("a forged token fails signature verification", async () => {
  const now = 1_800_000_000;
  /* Certificates are stubbed so the test does not reach the network. The `kid`
     is unknown to them, which is itself the correct rejection: a token signed
     by a key Google does not publish is not a Google token. */
  const result = await verifyIdToken({
    token: forgedToken(now),
    projectId: PROJECT,
    nowMs: now * 1000,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ realkid: "-----BEGIN CERTIFICATE-----" }), {
        status: 200,
        headers: { "cache-control": "max-age=3600" },
      })) as unknown as typeof fetch,
  });

  assert.equal(result.ok, false);
});

test("an expired token is refused even before the signature is considered", () => {
  const issued = 1_800_000_000;
  const decoded = decode(forgedToken(issued))!;
  assert.equal(
    checkClaims({
      payload: decoded.payload,
      projectId: PROJECT,
      /* Two hours after a one-hour token was issued. */
      nowSeconds: issued + 7200,
    }).ok,
    false,
  );
});

test("a token for another Firebase project is refused", () => {
  const now = 1_800_000_000;
  const decoded = decode(forgedToken(now))!;
  assert.equal(
    checkClaims({
      payload: decoded.payload,
      projectId: "some-other-project",
      nowSeconds: now,
    }).ok,
    false,
  );
});

test("a malformed cookie decodes to nothing rather than throwing", () => {
  /* The gate must treat garbage as unauthenticated, not crash the Edge
     function — a throwing middleware fails the request in ways that are much
     harder to reason about than a redirect. */
  assert.equal(decode("not.a.jwt"), null);
  assert.equal(decode(""), null);
  assert.equal(decode("a.b"), null);
});
