import { NextResponse } from "next/server";
import { mailPrincipal } from "@/lib/server/mailPrincipal";
import { getGmailConnection, isGmailUsable } from "@/lib/integrations/mail/gmail/gmailClient";
import { syncInbox, syncSent } from "@/lib/integrations/mail/gmail/gmailSyncService";
import { mailDebug } from "@/lib/integrations/mail/debug";

/**
 * Pull Gmail into the unified mailbox.
 *
 * **The wire that was missing.** `gmailSyncService` was written
 * "background-ready" and then nothing ever called it, so external mail never
 * entered the mailbox at all — the inbox showed only what this browser had
 * sent. A service with no caller is a service that does not run.
 *
 * Deliberately a plain request rather than a cron: the same function serves a
 * Refresh button today and a scheduled worker later, and neither needs the
 * other to exist. `since` is passed straight through as Gmail's own query
 * filter, so a delta sync asks Google for the delta instead of fetching
 * everything and discarding most of it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const principal = await mailPrincipal(request);
  if (!principal)
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const connection = await getGmailConnection(principal.employeeId);
  if (!(await isGmailUsable(principal.employeeId))) {
    const c = connection;
    return NextResponse.json(
      {
        error:
          c?.status === "revoked"
            ? "Gmail access was revoked. Reconnect the account in Settings."
            : "No Gmail account is connected.",
      },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    since?: string;
  } | null;

  try {
    /* Sent as well as inbox: a unified mailbox that showed only what arrived
       would put your own replies in a different place from the thread they
       belong to. */
    const [inbox, sent] = await Promise.all([
      syncInbox(principal.employeeId, body?.since),
      syncSent(principal.employeeId, body?.since),
    ]);
    mailDebug("sync", {
      sessionEmployeeId: principal.employeeId,
      mailboxAddress: connection?.email ?? null,
      inboxCount: inbox.length,
      sentCount: sent.length,
      since: body?.since ?? null,
    });
    /* The client needs this to decide which parties are the person who synced.
       Without it every imported message resolves to an external party and
       becomes invisible to its own recipient. */
    return NextResponse.json({
      ok: true,
      inbox,
      sent,
      mailboxAddress: connection!.email,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gmail refused the request." },
      { status: 502 },
    );
  }
}
