import { NextResponse } from "next/server";
import { mailPrincipal } from "@/lib/server/mailPrincipal";
import { disconnectAccount } from "@/lib/integrations/mail/gmail/gmailClient";

/** Revokes at Google, then forgets locally. Order matters — see the client. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const principal = await mailPrincipal(request);
  if (!principal)
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  await disconnectAccount(principal.employeeId);
  return NextResponse.json({ ok: true });
}
