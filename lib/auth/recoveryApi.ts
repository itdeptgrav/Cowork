import { joinUrl, readConfig } from "@/lib/legacy/config";
import { PUBLIC_ENV } from "@/lib/legacy/publicEnv";

/**
 * The two ways into an account that do not involve remembering a password:
 * a mailed reset code, and a scanned sign-in code.
 *
 * **Why these talk to the Express backend and not to `app/api/auth/*`.**
 * Everything under `app/api/auth` operates on this app's own scrypt identity
 * store (`lib/server/store.ts`). CoWork sign-in does not use it — it is Firebase
 * Auth, and the only way to change one of those passwords or mint a session for
 * one is the Admin SDK with a service account. This app does not have one:
 * `lib/auth/firebaseToken.ts` exists precisely because verification could be
 * done without it, and its header states the credential is still missing.
 * `grav-backend` has it, already mints Firebase custom tokens for the CMS's SSO
 * handoff, and already has a working mail sender. So these endpoints live
 * there, and this file is the client for them.
 *
 * **Everything here is unauthenticated except `issueQrCode`/`revokeQrCode`.**
 * That is not an oversight — somebody who has forgotten their password or is
 * signing in on a new laptop has no token to send. What protects each endpoint
 * is written down at the endpoint: see `coworkPasswordReset.js` and
 * `coworkQrSignIn.js`.
 */

/** The shared shape of every reply from these endpoints. */
export interface RecoveryResult {
  success: boolean;
  message?: string;
  /** Only ever present when the backend runs outside production. */
  _devOtp?: string;
}

/**
 * A network failure reads as a failed request, not as a thrown page.
 *
 * These calls all happen inside a form somebody is standing in front of. An
 * unhandled rejection there leaves a spinner running forever, which is the one
 * outcome worse than "could not reach the server" — it gives no next move.
 */
async function post<T extends RecoveryResult>(
  path: string,
  body: unknown,
  init?: { idToken?: string },
): Promise<T> {
  let url: string;
  try {
    url = joinUrl(readConfig(PUBLIC_ENV).apiUrl, path);
  } catch {
    return {
      success: false,
      message: "Cowork is not connected to its backend. Ask an administrator.",
    } as T;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.idToken ? { Authorization: `Bearer ${init.idToken}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    /* Parsed regardless of status: these endpoints put their reason in the
       body, and reading it only on 2xx would replace every specific message
       ("3 attempts remaining") with a generic one. */
    const data = (await res.json().catch(() => null)) as T | null;
    if (data && typeof data.success === "boolean") return data;

    return {
      success: false,
      message: res.ok
        ? "The server sent something unexpected. Try again."
        : `The server refused that request (${res.status}).`,
    } as T;
  } catch {
    return {
      success: false,
      message: "Could not reach the server. Check your connection.",
    } as T;
  }
}

/* ── Forgot password ──────────────────────────────────────────────────────── */

/**
 * Ask for a 4-digit code.
 *
 * Always reports success for a well-formed address, whether or not an account
 * exists — the endpoint refuses to confirm who is registered, for the same
 * reason `SignInForm` refuses to say which half of a wrong sign-in was wrong.
 * The UI must not try to be more helpful than this; doing so would reintroduce
 * exactly the enumeration the endpoint spent its uniform reply avoiding.
 */
export function requestResetCode(email: string): Promise<RecoveryResult> {
  return post("/cowork/auth/forgot-password/request-otp", { email });
}

/** Verify a code without spending it on a password that may be rejected. */
export function checkResetCode(email: string, otp: string): Promise<RecoveryResult> {
  return post("/cowork/auth/forgot-password/check-otp", { email, otp });
}

/** Verify the code and set the new password. Ends every other session. */
export function resetPasswordWithCode(
  email: string,
  otp: string,
  newPassword: string,
): Promise<RecoveryResult> {
  return post("/cowork/auth/forgot-password/reset-password", {
    email,
    otp,
    newPassword,
  });
}

/* ── QR sign-in ───────────────────────────────────────────────────────────── */

export interface QrCodeIssued extends RecoveryResult {
  /** The plaintext code. It is returned once and cannot be read back. */
  token?: string;
  expiresAt?: string;
  ttlMs?: number;
}

/** Mint a short-lived sign-in code for the signed-in caller. */
export function issueQrCode(idToken: string): Promise<QrCodeIssued> {
  return post<QrCodeIssued>("/cowork/auth/qr/issue", {}, { idToken });
}

/** Drop the caller's outstanding code — called when the panel closes. */
export function revokeQrCode(idToken: string): Promise<RecoveryResult> {
  return post("/cowork/auth/qr/revoke", {}, { idToken });
}

export interface QrRedeemed extends RecoveryResult {
  /** A Firebase custom token, for `signInWithToken`. */
  token?: string;
}

/** Exchange a scanned code for a Firebase custom token. */
export function redeemQrCode(token: string): Promise<QrRedeemed> {
  return post<QrRedeemed>("/cowork/auth/qr/redeem", { token });
}

/* ── The QR payload ───────────────────────────────────────────────────────── */

/**
 * What the QR image actually encodes.
 *
 * A URL rather than a bare token, and the choice matters in both directions:
 *
 *  · Scanned by this app's own scanner, the token is pulled back out of the
 *    `qr` parameter — see `readQrPayload`.
 *  · Scanned by the phone's ordinary camera app, which is what most people will
 *    reach for first, it opens the sign-in page and completes the same journey
 *    instead of showing 43 characters of base64 and no way to act on them.
 *
 * The origin comes from the browser displaying it, never from configuration:
 * this app is reached on localhost, on a tunnel and on a production hostname,
 * and a configured base would produce QR codes pointing at a host the scanner
 * cannot reach — with no symptom until somebody tries it.
 */
export function buildQrPayload(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/signin?qr=${encodeURIComponent(token)}`;
}

/**
 * The token inside a scanned string, or null.
 *
 * Accepts the URL form above and a bare token, because a scanner will
 * eventually meet both — an older code, or somebody pasting one. Anything else
 * is rejected rather than guessed at.
 *
 * **The host is deliberately NOT checked.** Requiring it to match this origin
 * would break the ordinary case of a QR generated on the production hostname
 * and scanned by a laptop on the tunnel — and it would buy nothing, because a
 * token from a foreign host simply fails to redeem. The server decides what is
 * valid; this only has to find the string.
 */
export function readQrPayload(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  if (/^https?:\/\//i.test(text)) {
    try {
      const token = new URL(text).searchParams.get("qr");
      return token && token.trim() ? token.trim() : null;
    } catch {
      return null;
    }
  }

  /* A bare token: base64url, and long enough to be one of ours. The server
     generates 32 bytes, which is 43 characters. */
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : null;
}
