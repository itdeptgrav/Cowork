import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The proxy verifies the session token on EVERY request it matches — every
 * page, every RSC payload the router fetches on a navigation, and every link it
 * prefetches. Each one re-parsed an X.509 certificate, re-imported a public key
 * and re-verified the same RSA signature over the same bytes.
 *
 * The answer to "did Google sign this exact string with this key" cannot change
 * between two requests a millisecond apart, so it is reached once. What must
 * NOT be cached is anything time-dependent: the claims check owns expiry, runs
 * before this on every call, and is untouched.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const TOKEN = code("lib/auth/firebaseToken.ts");

test("expiry is still decided per request, never remembered", () => {
  /* The one thing that would turn this from an optimisation into a security
     bug: claims are checked on every call, before the signature, and their
     result is what is returned. */
  const at = TOKEN.indexOf("export async function verifyIdToken(");
  assert.ok(at !== -1, "verifyIdToken moved");
  const fn = TOKEN.slice(at, at + 3000);
  const claimsAt = fn.indexOf("const claims = checkClaims({");
  const cacheAt = fn.indexOf("signatureVerdicts.get(");
  assert.ok(claimsAt !== -1, "the claims check is gone");
  assert.ok(cacheAt !== -1, "the signature verdict is no longer reused");
  assert.ok(claimsAt < cacheAt, "the signature is consulted before the claims");
  assert.match(fn, /if \(!claims\.ok\) return claims;/);
  assert.doesNotMatch(
    fn,
    /signatureVerdicts\.set\([^)]*claims/,
    "a claims result is being cached — expiry would stop being checked",
  );
});

test("the verdict is keyed on the token AND the key that signed it", () => {
  /* Keyed on the token alone, a rotation reusing a key id could be answered
     with a verdict reached under the key it replaced. */
  const at = TOKEN.indexOf("export async function verifyIdToken(");
  const fn = TOKEN.slice(at, at + 3000);
  assert.match(fn, /const cacheKey = `\$\{kid\}\.\$\{input\.token\}`;/);
});

test("imported keys are held by certificate, not by key id", () => {
  assert.match(
    TOKEN,
    /const keysByCertificate = new Map<string, Promise<CryptoKey>>\(\);/,
  );
  assert.match(TOKEN, /let key = keysByCertificate\.get\(pem\);/);
  /* The promise is stored, so requests arriving together import once. */
  assert.match(TOKEN, /keysByCertificate\.set\(pem, key\);/);
  assert.match(
    TOKEN,
    /key\.catch\(\(\) => keysByCertificate\.delete\(pem\)\)/,
    "a failed import is remembered, so every later request inherits it",
  );
});

test("neither cache can grow without bound", () => {
  assert.match(TOKEN, /const SIGNATURE_CACHE_LIMIT = 8;/);
  const evictions = TOKEN.match(/while \((signatureVerdicts|keysByCertificate)\.size > SIGNATURE_CACHE_LIMIT\)/g);
  assert.equal(evictions?.length, 2, "one of the two caches is unbounded");
});

test("resetting the certificates resets everything derived from them", () => {
  /* Otherwise a rotation — or a test that swaps Google's certificates — would
     be answered from a verdict reached under the old key. */
  const at = TOKEN.indexOf("export function resetCertificateCache()");
  assert.ok(at !== -1, "resetCertificateCache moved");
  const fn = TOKEN.slice(at, at + 500);
  assert.match(fn, /cache = null;/);
  assert.match(fn, /keysByCertificate\.clear\(\);/);
  assert.match(fn, /signatureVerdicts\.clear\(\);/);
});
