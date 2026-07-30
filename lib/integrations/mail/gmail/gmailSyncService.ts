import "server-only";
import { gmailFetch } from "./gmailClient";
import { parseGmailMessage, type GmailRawMessage } from "./parse";

/**
 * Pulling Gmail into the unified mailbox.
 *
 * **Background-ready, and not background-coupled.** Nothing here reaches for a
 * timer, a socket or a React hook: `syncInbox`/`syncSent` are functions that
 * take an employee and a cursor and return domain records. A cron, a queue
 * worker or a route handler can drive them without any of them knowing about
 * the others — which is the whole reason the UI never touches the Gmail API.
 *
 * The `since` cursor is Gmail's own query syntax rather than a stored watermark,
 * so a delta sync asks Google for the delta instead of fetching everything and
 * discarding most of it.
 */

const PAGE = 25;

async function listIds(
  employeeId: string,
  query: string,
): Promise<string[]> {
  const body = await gmailFetch(
    employeeId,
    `users/me/messages?maxResults=${PAGE}&q=${encodeURIComponent(query)}`,
  );
  const r = body as { messages?: { id: string }[] };
  return (r.messages ?? []).map((m) => m.id);
}

async function fetchFull(
  employeeId: string,
  id: string,
): Promise<GmailRawMessage> {
  return (await gmailFetch(
    employeeId,
    `users/me/messages/${id}?format=full`,
  )) as GmailRawMessage;
}

async function syncQuery(employeeId: string, query: string, since?: string) {
  const q = since ? `${query} after:${since.slice(0, 10).replace(/-/g, "/")}` : query;
  const ids = await listIds(employeeId, q);
  /* Sequential rather than parallel: Gmail rate-limits per user, and a burst of
     twenty-five concurrent gets is the fastest way to a 429 on a sync nobody is
     watching. */
  const out = [];
  for (const id of ids) {
    out.push(parseGmailMessage(await fetchFull(employeeId, id)));
  }
  return out;
}

export function syncInbox(employeeId: string, since?: string) {
  return syncQuery(employeeId, "in:inbox", since);
}

export function syncSent(employeeId: string, since?: string) {
  return syncQuery(employeeId, "in:sent", since);
}
