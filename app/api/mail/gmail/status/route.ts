import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/session";
import { connectionView, getGmailConnection } from "@/lib/integrations/mail/gmail/gmailClient";
import { mailDebug } from "@/lib/integrations/mail/debug";
import { gmailAvailable } from "@/lib/integrations/mail/gmail/gmailAuth";

/** What the client may know: whether a mailbox is connected. Never a token. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const view = await connectionView(session.employeeId);
  const stored = await getGmailConnection(session.employeeId);
  mailDebug("status", {
    sessionEmployeeId: session.employeeId,
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
