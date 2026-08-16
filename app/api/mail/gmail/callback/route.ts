import { NextResponse } from "next/server";
import { mailPrincipal } from "@/lib/server/mailPrincipal";
import { mailDebug } from "@/lib/integrations/mail/debug";
import { identityStore } from "@/lib/server/store";
import { seal } from "@/lib/server/secretBox";
import {
  exchangeCode,
  fetchConnectedEmail,
  gmailConfig,
  verifyState,
} from "@/lib/integrations/mail/gmail/gmailAuth";
import { callbackOrigin } from "@/lib/server/requestOrigin";

/**
 * Where Google returns.
 *
 * Verifies the state before spending the code: an unverified callback is a URL
 * anybody can hand somebody, and honouring it would connect an attacker's
 * mailbox to the victim's Cowork account.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Back to settings, on the origin the callback actually arrived at.
 *
 * NOT `NEXT_PUBLIC_APP_URL`. The session cookie is host-scoped — no `domain` is
 * set — and Google redirects to whatever `GOOGLE_REDIRECT_URI` says. If those
 * two names disagree (`localhost` vs `127.0.0.1`, which browsers and Google
 * both treat as different origins) the person lands on a host that never sees
 * their cookie and appears signed out, with a connection that silently did not
 * happen. Using the request's own origin makes the flow correct whichever name
 * they browse under.
 */
function back(request: Request, reason: string, ok = false) {
  /* `request.url` is NOT "the origin the request arrived at": under
     `next dev -H 0.0.0.0` it reports the BIND address, and the flow's last hop
     sent the person to `http://0.0.0.0:3000/settings` — ERR_ADDRESS_INVALID on
     an otherwise finished connection. The browser's own Host header is the
     faithful source; see `callbackOrigin` for the fallbacks. */
  const origin = callbackOrigin({
    requestUrl: request.url,
    hostHeader: request.headers.get("host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    configuredRedirectUri: gmailConfig()?.redirectUri ?? null,
  });
  return NextResponse.redirect(
    new URL(
      `/settings?gmail=${ok ? "connected" : "error"}&reason=${encodeURIComponent(reason)}`,
      origin,
    ),
  );
}

export async function GET(request: Request) {
  const principal = await mailPrincipal(request);
  if (!principal) return back(request, "Not authenticated.");

  const config = gmailConfig();
  if (!config) return back(request, "Gmail is not configured on this server.");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  if (denied) return back(request, "Consent was declined.");
  if (!code || !state) return back(request, "Google returned an incomplete response.");
  if (!verifyState(state, principal.stateKey, Date.now()))
    return back(request, "That connection link is no longer valid. Try again.");

  try {
    const tokens = await exchangeCode(config, code);
    const email = await fetchConnectedEmail(tokens.accessToken);
    const now = new Date().toISOString();
    const existing = await identityStore.findGmailConnection(
      principal.employeeId,
    );
    await identityStore.upsertGmailConnection({
      id: existing?.id ?? `gc-${principal.employeeId}`,
      employeeId: principal.employeeId,
      email,
      accessTokenEnc: seal(tokens.accessToken),
      refreshTokenEnc: seal(tokens.refreshToken!),
      expiryDate: tokens.expiryDate,
      scopes: tokens.scopes,
      status: "active",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    mailDebug("callback", {
      sessionEmployeeId: principal.employeeId,
      storedConnectionEmployeeId: principal.employeeId,
      connectedEmail: email,
      connectionStatus: "active",
      scopes: tokens.scopes.length,
    });
    return back(request, email, true);
  } catch (e) {
    return back(request, e instanceof Error ? e.message : "The connection failed.");
  }
}
