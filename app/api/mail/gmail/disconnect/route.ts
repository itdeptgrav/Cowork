import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/session";
import { disconnectAccount } from "@/lib/integrations/mail/gmail/gmailClient";

/** Revokes at Google, then forgets locally. Order matters — see the client. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await currentSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  await disconnectAccount(session.employeeId);
  return NextResponse.json({ ok: true });
}
