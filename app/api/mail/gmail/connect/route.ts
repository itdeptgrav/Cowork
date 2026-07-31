import { NextResponse } from "next/server";
import { mailPrincipal } from "@/lib/server/mailPrincipal";
import { consentUrl, gmailConfig, signState } from "@/lib/integrations/mail/gmail/gmailAuth";

/** Start the consent flow. Redirects to Google; issues nothing itself. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await mailPrincipal(request);
  if (!principal)
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const config = gmailConfig();
  if (!config)
    return NextResponse.json(
      {
        error:
          "Gmail is not configured on this server. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are required.",
      },
      { status: 503 },
    );

  /* Bound to THIS caller and expiring, so the callback cannot be replayed
     against somebody else's account. */
  const state = signState(principal.stateKey, Date.now());
  return NextResponse.redirect(consentUrl(config, state));
}
