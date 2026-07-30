import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./password.ts";

/**
 * The hashing boundary.
 *
 * These are cheap to write and they hold the properties that are invisible when
 * broken: a hash that silently stores plaintext, a verify that accepts anything,
 * a salt that is not per-password. None of those fail loudly in a browser — the
 * login still works, which is exactly why they need a test rather than a
 * manual check.
 */

/* scrypt at these parameters is deliberately slow. Two hashes plus a few
   verifies fits, but not in the runner's 30s default on a loaded machine. */
const SLOW = { timeout: 30_000 };

test("a correct password verifies", SLOW, async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
});

test("a wrong password does not", SLOW, async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery stapl", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("the stored value contains neither the password nor a bare digest", SLOW, async () => {
  const stored = await hashPassword("hunter2-hunter2");
  assert.ok(!stored.includes("hunter2"), "plaintext leaked into the hash");
  assert.ok(stored.startsWith("scrypt$"), "scheme is not recorded");
  /* Parameters travel WITH the hash, which is what lets the cost be raised
     later without invalidating everything already stored. */
  const [, n, r, p] = stored.split("$");
  assert.ok(Number(n) >= 65536, `N too low: ${n}`);
  assert.ok(Number(r) >= 8 && Number(p) >= 1, `weak r/p: ${r}/${p}`);
});

test("the same password hashes differently every time", SLOW, async () => {
  const a = await hashPassword("identical passphrase");
  const b = await hashPassword("identical passphrase");
  assert.notEqual(a, b, "salt is not per-password — rainbow tables apply");
});

test("a corrupt stored value fails closed", async () => {
  for (const junk of ["", "nonsense", "bcrypt$x$y", "scrypt$$$$$"]) {
    assert.equal(
      await verifyPassword("anything", junk),
      false,
      `${JSON.stringify(junk)} should not verify`,
    );
  }
});

test("the password rule rejects what it says it rejects", () => {
  assert.ok(passwordProblem("short"), "too short was accepted");
  assert.ok(passwordProblem("password123"), "a top-common password was accepted");
  assert.ok(passwordProblem("aaaaaaaaaaaa"), "a repeated character was accepted");
  assert.equal(passwordProblem("a reasonable passphrase"), null);
});
