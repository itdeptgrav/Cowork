import "server-only";
import { identityStore, type GmailConnection } from "@/lib/server/store";
import { open, seal } from "@/lib/server/secretBox";
import {
  GmailRevokedError,
  gmailConfig,
  refreshAccessToken,
  revokeToken,
} from "./gmailAuth";

/**
 * An authorised Gmail request, and the token bookkeeping behind it.
 *
 * Everything above this — send, sync — asks for a URL and gets an answer. The
 * refresh dance, the sealed storage and the revocation bookkeeping live here so
 * they exist once.
 *
 * **Refreshes once, on demand.** An access token lasts an hour and a sync may
 * outlive it. Rather than a scheduler, a 401 triggers exactly one refresh and
 * one retry; a second failure is a real failure. Legacy refreshed eagerly on
 * every call, which spent a token request per operation.
 */

export class GmailNotConnectedError extends Error {}

/** What a caller may know about a connection. Never a token. */
export interface GmailConnectionView {
  connected: boolean;
  email: string | null;
  status: GmailConnection["status"] | null;
  connectedAt: string | null;
}

/**
 * **THE** Gmail connection lookup. One function, every caller.
 *
 * Settings, the compose banner and the send route all resolve availability
 * through this, so they cannot disagree about whether a mailbox is connected.
 * They did once: the settings page asked here and said "Connected", while
 * `sendMail` asked a stand-in — `!!input.gmail`, meaning "has a Gmail send
 * already succeeded" — which was never true because nothing sent. Two different
 * questions, one of them a placeholder, and the UI contradicted itself.
 *
 * Returns the record including sealed tokens, so it is server-only. Anything
 * that needs to tell a BROWSER about the connection uses `connectionView`,
 * which is this with the credentials stripped.
 */
export async function getGmailConnection(
  employeeId: string,
): Promise<GmailConnection | null> {
  return identityStore.findGmailConnection(employeeId);
}

/** Whether this employee can actually send external mail right now. */
export async function isGmailUsable(employeeId: string): Promise<boolean> {
  if (!gmailConfig()) return false;
  const c = await getGmailConnection(employeeId);
  return c?.status === "active";
}

export async function connectionView(
  employeeId: string,
): Promise<GmailConnectionView> {
  const c = await getGmailConnection(employeeId);
  if (!c)
    return { connected: false, email: null, status: null, connectedAt: null };
  return {
    connected: c.status === "active",
    email: c.email,
    status: c.status,
    connectedAt: c.createdAt,
  };
}

/**
 * A valid access token for this employee.
 *
 * Refreshes when the stored one is within a minute of expiry — a token that
 * expires mid-request is a failure that looks random.
 */
async function accessTokenFor(employeeId: string): Promise<string> {
  const config = gmailConfig();
  if (!config)
    throw new GmailNotConnectedError(
      "Gmail is not configured on this server.",
    );

  const c = await getGmailConnection(employeeId);
  if (!c || c.status === "revoked")
    throw new GmailNotConnectedError(
      "No Gmail account is connected. Connect one in your settings.",
    );

  const stillValid =
    Date.parse(c.expiryDate) - Date.now() > 60_000 && c.status === "active";
  if (stillValid) {
    const token = open(c.accessTokenEnc);
    if (token) return token;
    /* Unsealed to nothing — wrong key or a tampered record. Fall through and
       refresh rather than failing: the refresh token may still open. */
  }

  const refresh = open(c.refreshTokenEnc);
  if (!refresh) {
    await identityStore.upsertGmailConnection({
      ...c,
      status: "revoked",
      updatedAt: new Date().toISOString(),
    });
    throw new GmailNotConnectedError(
      "The stored Gmail credentials could not be read. Connect the account again.",
    );
  }

  try {
    const fresh = await refreshAccessToken(config, refresh);
    await identityStore.upsertGmailConnection({
      ...c,
      accessTokenEnc: seal(fresh.accessToken),
      /* Google does not reissue the refresh token on a refresh. Keeping the
         existing one is correct; overwriting with null would end the
         connection at the next expiry. */
      refreshTokenEnc: fresh.refreshToken
        ? seal(fresh.refreshToken)
        : c.refreshTokenEnc,
      expiryDate: fresh.expiryDate,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
    return fresh.accessToken;
  } catch (e) {
    if (e instanceof GmailRevokedError) {
      /* Recorded, so the UI can say "reconnect" rather than failing every send
         with the same opaque error. */
      await identityStore.upsertGmailConnection({
        ...c,
        status: "revoked",
        updatedAt: new Date().toISOString(),
      });
    }
    throw e;
  }
}

/** An authorised call against the Gmail REST API. */
export async function gmailFetch(
  employeeId: string,
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<unknown> {
  const token = await accessTokenFor(employeeId);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401 && !retried) {
    /* Expired between the check and the call. Force a refresh by marking the
       stored token stale, then try exactly once more. */
    const c = await getGmailConnection(employeeId);
    if (c)
      await identityStore.upsertGmailConnection({
        ...c,
        expiryDate: new Date(0).toISOString(),
        updatedAt: new Date().toISOString(),
      });
    return gmailFetch(employeeId, path, init, true);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message ===
        "string"
        ? (body as { error: { message: string } }).error.message
        : `Gmail refused the request (${res.status}).`;
    throw new Error(message);
  }
  return body;
}

/**
 * Disconnect.
 *
 * Revokes at Google FIRST. Deleting locally first would leave a live grant on
 * somebody's Google account that Cowork can no longer see or undo.
 */
export async function disconnectAccount(employeeId: string): Promise<void> {
  const c = await getGmailConnection(employeeId);
  if (!c) return;
  const refresh = open(c.refreshTokenEnc);
  if (refresh) await revokeToken(refresh);
  await identityStore.deleteGmailConnection(employeeId);
}
