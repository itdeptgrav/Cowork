import "server-only";
import { gmailFetch } from "./gmailClient";
import type { MailParty } from "@/lib/domain";

/**
 * Sending through Gmail.
 *
 * The MIME shape is legacy's `buildMimeMessage()`, which was correct: RFC-2822
 * headers, base64 subject for non-ASCII, and `In-Reply-To`/`References` so a
 * reply lands on its thread in the recipient's client rather than starting a
 * new one. What changed is where it runs and whose credentials it uses.
 */

function addr(p: MailParty): string {
  return p.displayName && p.displayName !== p.address
    ? `${p.displayName} <${p.address}>`
    : p.address;
}

/** Base64 with a `?B?` wrapper — the only safe way to put UTF-8 in a header. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildMime(input: {
  from: MailParty;
  to: MailParty[];
  cc: MailParty[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const lines = [
    `From: ${addr(input.from)}`,
    `To: ${input.to.map(addr).join(", ")}`,
    ...(input.cc.length ? [`Cc: ${input.cc.map(addr).join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    "",
    input.body,
  ];
  return lines.join("\r\n");
}

/** Gmail wants base64url with no padding. */
export function encodeRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}

export interface GmailSendResult {
  gmailMessageId: string;
  gmailThreadId: string;
}

export async function sendEmail(
  employeeId: string,
  input: Parameters<typeof buildMime>[0] & { gmailThreadId?: string | null },
): Promise<GmailSendResult> {
  const raw = encodeRaw(buildMime(input));
  const body = await gmailFetch(employeeId, "users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw,
      /* Threading on Gmail's side needs the thread id as well as the headers —
         the headers alone thread it for the RECIPIENT, this threads it in the
         sender's own Sent folder. */
      ...(input.gmailThreadId ? { threadId: input.gmailThreadId } : {}),
    }),
  });
  const r = body as { id?: string; threadId?: string };
  if (!r.id || !r.threadId)
    throw new Error("Gmail accepted the message but returned no identifiers.");
  return { gmailMessageId: r.id, gmailThreadId: r.threadId };
}
