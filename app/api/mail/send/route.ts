import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/session";
import { getGmailConnection, isGmailUsable } from "@/lib/integrations/mail/gmail/gmailClient";
import { sendEmail } from "@/lib/integrations/mail/gmail/gmailSendService";
import { transportFor } from "@/lib/integrations/mail/transport";
import { mailDebug } from "@/lib/integrations/mail/debug";
import type { MailParty } from "@/lib/domain";

/**
 * The external half of a send.
 *
 * **Why this route is the fix.** `sendMail` lives in the client-side repository
 * and therefore cannot read `GmailConnection`, which is server-side because it
 * holds credentials. Rather than teach the client about the connection — which
 * would mean shipping the answer to the browser and trusting it — the send goes
 * through here, where `getGmailConnection` is reachable. The client then stores
 * the RESULT.
 *
 * Internal mail never touches this route. That is the point of the transport
 * split: a Gmail outage cannot stop a colleague from receiving a message.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    to?: MailParty[];
    cc?: MailParty[];
    subject?: string;
    body?: string;
    gmailThreadId?: string | null;
  } | null;
  if (!body?.to?.length)
    return NextResponse.json({ error: "No recipients." }, { status: 400 });

  const to = body.to;
  const cc = body.cc ?? [];
  const transport = transportFor([...to, ...cc]);

  /* Belt and braces: an internal message reaching this route is a bug in the
     caller, and sending it through Gmail would take a private conversation
     outside the company. */
  if (transport === "internal")
    return NextResponse.json(
      { error: "That message is internal and must not go through Gmail." },
      { status: 400 },
    );

  const connection = await getGmailConnection(session.employeeId);
  const usable = await isGmailUsable(session.employeeId);

  mailDebug("send", {
    sessionEmployeeId: session.employeeId,
    storedConnectionEmployeeId: connection?.employeeId ?? null,
    connectedEmail: connection?.email ?? null,
    connectionStatus: connection?.status ?? null,
    usable,
    transport,
  });

  if (!usable)
    return NextResponse.json(
      {
        error:
          connection?.status === "revoked"
            ? "Gmail access was revoked. Reconnect the account in Settings."
            : "No Gmail account is connected. Connect one in Settings.",
      },
      { status: 409 },
    );

  try {
    const result = await sendEmail(session.employeeId, {
      from: {
        kind: "employee",
        employeeId: session.employeeId,
        address: connection!.email,
        displayName: session.displayName ?? connection!.email,
      },
      to,
      cc,
      subject: body.subject ?? "",
      body: body.body ?? "",
      gmailThreadId: body.gmailThreadId ?? null,
    });
    return NextResponse.json({ ok: true, gmail: result });
  } catch (e) {
    /* Reported, not swallowed. The client keeps the message as a draft with
       this reason attached — somebody wrote it, and losing it would be worse
       than not sending it. */
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gmail refused the message." },
      { status: 502 },
    );
  }
}
