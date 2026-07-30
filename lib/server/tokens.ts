import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { identityStore } from "./store";

/**
 * One-time credential tokens — invitations and password resets.
 *
 * **They are the same primitive.** An invitation says "no account exists for
 * this address; set the first password". A reset says "one does; set a new
 * one". The difference is a label on the screen and whether an account is
 * created on redemption — the token, its lifetime, its storage and its
 * redemption path are identical, and splitting them into two mechanisms would
 * mean two chances to get expiry or single-use wrong.
 *
 * **Nothing here sends mail.** There is no mail service in this product and
 * inventing a fake "invitation sent" would be worse than useless — somebody
 * would wait for an email that was never going to arrive. The token comes back
 * to the administrator as a link to hand over. That is a real pattern for
 * internal tools, and it is honest about the delivery gap.
 *
 * Two properties worth stating:
 *
 *  · **Only a HASH is stored.** The plaintext exists once, in the response to
 *    the administrator who asked for it. A leaked identity store therefore
 *    yields no usable tokens — the same reason passwords are hashed.
 *  · **Redemption is single-use and atomic.** The record is deleted before the
 *    password is set, so a replayed link finds nothing.
 */

export type TokenPurpose = "invite" | "reset";

export interface CredentialToken {
  /** SHA-256 of the plaintext. The plaintext is never written down. */
  tokenHash: string;
  purpose: TokenPurpose;
  /** The address this token is FOR. Binds it to one person. */
  email: string;
  /** The workspace identity to attach on redemption, for an invite. */
  employeeId: string;
  displayName: string;
  organisationId: string;
  expiresAt: string;
  createdAt: string;
  createdByAccountId: string;
}

/**
 * Short, because a credential-setting link is a bearer credential.
 *
 * Seven days for an invitation — somebody joining may not look at it until
 * Monday. One hour for a reset, which is requested because it is needed now.
 */
const LIFETIME_MS: Record<TokenPurpose, number> = {
  invite: 7 * 86400_000,
  reset: 60 * 60_000,
};

export function hashToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export function issueToken(input: {
  purpose: TokenPurpose;
  email: string;
  employeeId: string;
  displayName: string;
  organisationId: string;
  createdByAccountId: string;
}): { plaintext: string; record: CredentialToken } {
  /* 32 bytes of CSPRNG. Long enough that guessing is not a strategy, so no
     rate limit on redemption is load-bearing. */
  const plaintext = randomBytes(32).toString("base64url");
  return {
    plaintext,
    record: {
      tokenHash: hashToken(plaintext),
      purpose: input.purpose,
      email: input.email.trim().toLowerCase(),
      employeeId: input.employeeId,
      displayName: input.displayName,
      organisationId: input.organisationId,
      expiresAt: new Date(
        Date.now() + LIFETIME_MS[input.purpose],
      ).toISOString(),
      createdAt: new Date().toISOString(),
      createdByAccountId: input.createdByAccountId,
    },
  };
}

/**
 * Find a live token for this plaintext, without leaking which part failed.
 *
 * Compares the hash in constant time. `===` on a hash is not the vulnerability
 * `===` on an HMAC is — the attacker cannot iterate toward a match because they
 * do not control the stored value — but the cost is one function call and the
 * habit is worth keeping uniform across the file.
 */
export async function findLiveToken(
  plaintext: string,
): Promise<CredentialToken | null> {
  const wanted = hashToken(plaintext);
  const all = await identityStore.listTokens();
  const now = new Date().toISOString();

  for (const t of all) {
    const a = Buffer.from(t.tokenHash);
    const b = Buffer.from(wanted);
    if (a.length !== b.length || !timingSafeEqual(a, b)) continue;
    if (t.expiresAt <= now) {
      /* Expired tokens are cleared on the way past rather than left to
         accumulate as a list of addresses somebody once invited. */
      await identityStore.deleteToken(t.tokenHash);
      return null;
    }
    return t;
  }
  return null;
}
