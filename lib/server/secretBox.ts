import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encryption at rest for credentials the server holds on somebody's behalf.
 *
 * A Gmail refresh token is not a password. A password is hashed because nobody
 * ever needs it back; a refresh token has to be REPLAYED to Google, so it must
 * be recoverable — which means encryption, not hashing, and a key that lives
 * outside the store it protects.
 *
 * Legacy kept these in Firestore in plaintext (`cowork_employees/{id}.gmailToken`).
 * Anyone with read access to that collection could send mail as any connected
 * employee, indefinitely, with no trace in Cowork. That is the single most
 * important thing this module exists to fix.
 *
 * **AES-256-GCM, not CBC.** GCM authenticates: a tampered ciphertext fails to
 * open rather than decrypting to rubbish that then gets posted to Google's
 * token endpoint. A random 96-bit IV per message, stored alongside — reusing an
 * IV under one key is the way GCM breaks.
 *
 * **A derived key, not the session secret itself.** HKDF with a distinct `info`
 * label means the mail key and the session-signing key are different keys from
 * one secret, so a leaked session signature reveals nothing about a mailbox and
 * rotating one does not silently re-key the other.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
const INFO = "cowork/mail/gmail-credentials/v1";

/**
 * The encryption key.
 *
 * Refuses to run in production on the development fallback, the same hard stop
 * `lib/server/session.ts` makes — encrypting every refresh token in the world
 * with a string that is in the repository is worse than not encrypting them,
 * because it looks safe.
 */
function key(): Buffer {
  const fromEnv = process.env.COWORK_SESSION_SECRET;
  const material =
    fromEnv && fromEnv.length >= 32
      ? fromEnv
      : (() => {
          if (process.env.NODE_ENV === "production") {
            throw new Error(
              "COWORK_SESSION_SECRET is missing or shorter than 32 characters. " +
                "Gmail credentials cannot be encrypted safely without it.",
            );
          }
          return "cowork-development-session-secret-not-for-production";
        })();

  return Buffer.from(
    hkdfSync("sha256", Buffer.from(material, "utf8"), "", INFO, KEY_LEN),
  );
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. Versioned so it can be rotated. */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

/**
 * Open a sealed value, or null.
 *
 * Null rather than a throw: a credential that cannot be opened — wrong key,
 * tampered record, a format from a future version — is a connection that has to
 * be re-established, which is a state the product handles. An exception here
 * would take down whatever was merely listing mailboxes.
 */
export function open(sealed: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const enc = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_LEN || tag.length !== 16) return null;
    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    /* Authentication failure, or a corrupt record. Both mean the same thing to
       the caller: this credential is not usable. */
    return null;
  }
}
