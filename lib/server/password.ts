import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";
/* Relative and extensioned, not the `@/` alias: this module has a unit test and
   the runner is plain `node --test`, which resolves neither. */
import { PASSWORD_MIN_LENGTH } from "../auth/passwordRule.ts";

/* `promisify` collapses scrypt's overloads onto the three-argument one, which
   drops the options parameter — and the options are the entire security
   configuration. Asserted back to the shape actually being called. */
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * Deliberately NOT marked `server-only`, unlike `store.ts` and `session.ts`.
 * Those two touch the filesystem, the cookie jar and the signing secret and
 * must never reach a bundle; this is pure computation over its arguments with
 * nothing secret in it, and the `node:crypto` import already fails a client
 * build on its own. Dropping the marker is what makes the properties below
 * testable, and an untested hash is the worse trade.
 *
 * scrypt from Node's own crypto rather than a dependency: it is memory-hard,
 * it is what the Node documentation itself reaches for, and adding an npm
 * package to a security boundary is a supply-chain decision that should be made
 * deliberately rather than because it was the first search result.
 *
 * Parameters are stored IN the hash string, not read from a constant at verify
 * time. That is what makes the cost raisable later: today's hashes keep
 * verifying with today's N while new ones are written with tomorrow's, and
 * nobody has to migrate a table before they can turn the dial.
 *
 * Format: `scrypt$N$r$p$saltB64$hashB64`
 */

/* OWASP's floor for scrypt is N=2^17, r=8, p=1 (or N=2^16 with r=8, p=2 when
   memory is tight). 2^16 with p=2 is used here: it is the sanctioned pair, and
   it keeps a signin under ~100ms on a laptop, which matters because a slow
   login is a login people disable. */
const N = 65536;
const R = 8;
const P = 2;
const KEY_LEN = 64;
const SALT_LEN = 16;

/**
 * scrypt's memory cost is roughly `128 * N * r` bytes — 64MB at these
 * parameters — and Node's default maxmem is 32MB, so it throws without this.
 * Doubling gives headroom rather than sitting exactly on the limit.
 */
const MAX_MEM = 256 * N * R;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(plain.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Verify, in constant time with respect to the hash contents.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt
 * row should fail the login, not 500 the endpoint and tell an attacker they
 * found something interesting.
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6) return false;
    const [scheme, n, r, p, saltB64, hashB64] = parts;
    if (scheme !== "scrypt") return false;

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");

    /* Every one of these is an authentication bypass if it is skipped, and the
       empty case is not hypothetical: `scrypt$$$$$` parses to a zero-length
       salt, a zero-length digest and N=0, and `timingSafeEqual` of two empty
       buffers is TRUE — so a corrupt row would accept any password at all. A
       unit test found it; nothing in the UI would have. */
    const N_ = Number(n);
    const R_ = Number(r);
    const P_ = Number(p);
    if (!Number.isInteger(N_) || N_ < 16384) return false;
    if (!Number.isInteger(R_) || R_ < 1) return false;
    if (!Number.isInteger(P_) || P_ < 1) return false;
    if (salt.length < 8 || expected.length < 16) return false;
    const actual = await scrypt(plain.normalize("NFKC"), salt, expected.length, {
      N: N_,
      r: R_,
      p: P_,
      maxmem: 256 * N_ * R_,
    });

    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

/**
 * Burn roughly one hash's worth of time against a throwaway value.
 *
 * Called when the email does not exist. Without it, "no such account" returns
 * in a millisecond while a real account takes ~80ms, and that difference is a
 * free account-enumeration oracle — an attacker learns which addresses are
 * registered without ever guessing a password. The endpoint's ANSWER is already
 * identical for both cases; this makes the timing identical too.
 */
export async function burnPasswordTime(): Promise<void> {
  await hashPassword("timing-equalisation-only");
}

/**
 * The password rule, stated once so the client and the server cannot disagree.
 *
 * Length first and length weighted heavily, per NIST SP 800-63B: a long
 * passphrase beats a short string with a symbol bolted on, and composition
 * rules mostly teach people to write `Password1!`. The rejection of the
 * obviously-terrible list is the one composition-ish check worth keeping.
 */
export { PASSWORD_MIN_LENGTH };

const TOO_COMMON = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "letmein123",
  "iloveyou1",
  "administrator",
  "cowork1234",
]);

export function passwordProblem(plain: string): string | null {
  if (plain.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters. Length matters more than symbols.`;
  if (plain.length > 200) return "That password is unreasonably long.";
  if (TOO_COMMON.has(plain.toLowerCase()))
    return "That password is one of the most commonly used. Choose something else.";
  if (/^(.)\1+$/.test(plain))
    return "That password is a single repeated character.";
  return null;
}
