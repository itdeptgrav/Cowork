import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The OAuth half of the Gmail integration.
 *
 * Consent URL, code exchange, refresh, revoke — and nothing else. It does not
 * know what a mailbox is; `gmailClient` and the two services above it do.
 *
 * **No `googleapis` dependency.** Legacy pulled in the whole SDK to use four
 * REST endpoints. These are four `fetch` calls against documented URLs, which
 * is less to keep patched and less to audit for a module that handles
 * credentials.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** The minimum that sends mail and builds a unified inbox. Nothing more. */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * The configured OAuth client, or null.
 *
 * Null is a normal state — nobody has created the Web OAuth client yet — and
 * every caller treats it as "Gmail is not available", which the compose window
 * already knows how to say. Throwing would make an unconfigured install
 * crash on a page that has nothing to do with mail.
 */
export function gmailConfig(): GmailOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  if (process.env.GMAIL_ENABLED === "false") return null;
  return { clientId, clientSecret, redirectUri };
}

export function gmailAvailable(): boolean {
  return gmailConfig() !== null;
}

/* ── state: binds a callback to the session that started it ──────────────── */

const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret(): Buffer {
  const s = process.env.COWORK_SESSION_SECRET;
  if (s && s.length >= 32) return Buffer.from(s, "utf8");
  if (process.env.NODE_ENV === "production")
    throw new Error("COWORK_SESSION_SECRET is required to sign the OAuth state.");
  return Buffer.from("cowork-development-session-secret-not-for-production");
}

/**
 * A signed, expiring, account-bound `state`.
 *
 * Without this, a callback is a URL anybody can replay: an attacker completes
 * consent on their own Google account, hands the victim the resulting callback
 * link, and the victim's Cowork ends up sending mail through the attacker's
 * mailbox. Binding the state to the account id and checking it on return is
 * what closes that.
 */
export function signState(accountId: string, nowMs: number): string {
  const payload = `${accountId}.${nowMs}`;
  const mac = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export function verifyState(
  state: string,
  accountId: string,
  nowMs: number,
): boolean {
  const [body, mac] = state.split(".");
  if (!body || !mac) return false;
  const payload = Buffer.from(body, "base64url").toString("utf8");
  const expected = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const [signedAccount, issued] = payload.split(".");
  if (signedAccount !== accountId) return false;
  const at = Number(issued);
  return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at < STATE_TTL_MS;
}

/* ── the flow ─────────────────────────────────────────────────────────────── */

export function consentUrl(config: GmailOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    /* Both are required for a refresh token. `offline` asks for one at all;
       `consent` forces one on a RE-connect, which Google otherwise withholds
       because it already granted one. Legacy's own error message —
       "No refresh_token returned. Try disconnecting and reconnecting Gmail." —
       is what this pair prevents. */
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GmailTokens {
  accessToken: string;
  /** Absent on a refresh — Google only reissues it at first consent. */
  refreshToken: string | null;
  expiryDate: string;
  scopes: string[];
}

function toTokens(raw: Record<string, unknown>): GmailTokens {
  const expiresIn = Number(raw.expires_in ?? 3600);
  return {
    accessToken: String(raw.access_token ?? ""),
    refreshToken: raw.refresh_token ? String(raw.refresh_token) : null,
    expiryDate: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes: String(raw.scope ?? "").split(" ").filter(Boolean),
  };
}

export async function exchangeCode(
  config: GmailOAuthConfig,
  code: string,
): Promise<GmailTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const raw = (await res.json()) as Record<string, unknown>;
  if (!res.ok)
    throw new Error(
      `Google refused the authorisation: ${String(raw.error_description ?? raw.error ?? res.status)}`,
    );
  const tokens = toTokens(raw);
  if (!tokens.refreshToken)
    throw new Error(
      "Google returned no refresh token. Disconnect Gmail in your Google account and connect again.",
    );
  return tokens;
}

/**
 * Trade a refresh token for a new access token.
 *
 * `invalid_grant` means the person revoked Cowork in their Google account, or
 * the token expired through disuse. It is reported distinctly so the connection
 * can be marked `revoked` and the UI can say "reconnect" instead of failing
 * every send with the same opaque message.
 */
export class GmailRevokedError extends Error {}

export async function refreshAccessToken(
  config: GmailOAuthConfig,
  refreshToken: string,
): Promise<GmailTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const raw = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    if (raw.error === "invalid_grant")
      throw new GmailRevokedError(
        "Gmail access was revoked. Connect the account again.",
      );
    throw new Error(
      `Gmail refused the token refresh: ${String(raw.error_description ?? raw.error ?? res.status)}`,
    );
  }
  return toTokens(raw);
}

/** Which mailbox was actually connected. Read from Google, never typed. */
export async function fetchConnectedEmail(
  accessToken: string,
): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not read the connected Google account.");
  const raw = (await res.json()) as { email?: string };
  if (!raw.email) throw new Error("Google returned no address for that account.");
  return raw.email;
}

/**
 * Revoke at Google.
 *
 * Called BEFORE the local record is deleted. Deleting first would leave a live
 * grant on somebody's Google account that Cowork can no longer see or undo.
 */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => {
    /* Already revoked, or Google unreachable. The local record still goes —
       leaving it would show a connection the person cannot use. */
  });
}
