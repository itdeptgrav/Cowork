import { NextResponse } from "next/server";
import { mailPrincipal } from "@/lib/server/mailPrincipal";
import { connectionView, getGmailConnection } from "@/lib/integrations/mail/gmail/gmailClient";
import { mailDebug } from "@/lib/integrations/mail/debug";
import { gmailAvailable } from "@/lib/integrations/mail/gmail/gmailAuth";

/** What the client may know: whether a mailbox is connected. Never a token. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await mailPrincipal(request);
  if (!principal)
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const view = await connectionView(principal.employeeId);
  const stored = await getGmailConnection(principal.employeeId);
  mailDebug("status", {
    sessionEmployeeId: principal.employeeId,
    storedConnectionEmployeeId: stored?.employeeId ?? null,
    connectedEmail: view.email,
    connectionStatus: view.status,
    configured: gmailAvailable(),
  });
  return NextResponse.json(
    { configured: gmailAvailable(), ...view },
    { headers: { "Cache-Control": "no-store" } },
  );
}
