import type { MailMessage, MailParty } from "@/lib/domain";

/**
 * Gmail's message shape → Cowork's.
 *
 * Pure and separate from the fetching so it can be tested without a network or
 * a credential — the parsing is where the bugs live, not the HTTP.
 *
 * Everything Gmail returns becomes an `external` party. Resolving an address
 * back to an employee happens ONE layer up, against the directory, because only
 * that layer knows who works here — and getting it wrong in both directions is
 * how a colleague's mail ends up looking like it came from outside.
 */

export interface GmailRawMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    mimeType?: string;
    body?: { data?: string; size?: number };
    parts?: GmailRawMessage["payload"][];
  };
}

function header(raw: GmailRawMessage, name: string): string {
  const h = raw.payload?.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

/** `Maya Ferreira <maya@grav.in>` → a party. Bare addresses work too. */
export function parseAddress(value: string): MailParty | null {
  const v = value.trim();
  if (!v) return null;
  const angled = v.match(/^(.*?)\s*<([^>]+)>$/);
  const address = (angled ? angled[2] : v).trim();
  if (!address.includes("@")) return null;
  const displayName = angled ? angled[1].replace(/^"|"$/g, "").trim() : "";
  return {
    kind: "external",
    employeeId: null,
    address,
    displayName: displayName || address,
  };
}

export function parseAddressList(value: string): MailParty[] {
  /* Split on commas outside angle brackets — a display name may contain one. */
  return value
    .split(/,(?![^<]*>)/)
    .map(parseAddress)
    .filter((p): p is MailParty => p !== null);
}

/** Depth-first for the first text/plain part. Gmail nests these arbitrarily. */
export function extractBody(payload: GmailRawMessage["payload"]): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data)
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  for (const part of payload.parts ?? []) {
    const found = extractBody(part);
    if (found) return found;
  }
  return "";
}

export function parseGmailMessage(raw: GmailRawMessage): MailMessage {
  const from = parseAddress(header(raw, "From"));
  const sentAt = raw.internalDate
    ? new Date(Number(raw.internalDate)).toISOString()
    : new Date().toISOString();

  return {
    id: `gm-${raw.id}`,
    threadId: `gt-${raw.threadId}`,
    transport: "gmail",
    from: from ?? {
      kind: "external",
      employeeId: null,
      address: "unknown",
      displayName: "Unknown sender",
    },
    to: parseAddressList(header(raw, "To")),
    cc: parseAddressList(header(raw, "Cc")),
    /* Usually empty, and that is the header working. Gmail strips Bcc before
       delivery, so a message you RECEIVED never carries one — this only ever
       finds anything on a copy of something you SENT, which is exactly where
       the sender is entitled to see it. */
    bcc: parseAddressList(header(raw, "Bcc")),
    subject: header(raw, "Subject") || "(no subject)",
    body: extractBody(raw.payload) || (raw.snippet ?? ""),
    attachmentIds: [],
    readBy: [],
    starredBy: [],
    trashedBy: [],
    archivedBy: [],
    spamBy: [],
    importantBy: [],
    labels: [],
    sentAt,
    createdAt: sentAt,
    gmailMessageId: raw.id,
    deliveryError: null,
  };
}
