import type { EmployeeId, MailMessage } from "@/lib/domain";

/**
 * What the SENDER is told about their own message's delivery.
 *
 * The four states the compose/thread UI shows, derived — never stored as a
 * separate field, so they cannot drift from the message. Only meaningful on a
 * message you sent; a message you received has no "seen by me" to report to you.
 *
 *  · `failed`  — an external send that Gmail refused. `deliveryError` is set and
 *                the message was kept (as a draft) rather than lost.
 *  · `draft`   — never sent (`sentAt` null) and not a failure. Still yours to
 *                finish and send.
 *  · `seen`    — INTERNAL only, and only once EVERY internal recipient has read
 *                it. Gmail cannot report whether an outside recipient opened a
 *                message, so an external send never becomes `seen` — saying it
 *                had been would be a lie the product cannot back up.
 *  · `sent`    — delivered, not yet (or not knowably) read.
 */
export type MailSendStatus = "failed" | "draft" | "sent" | "seen";

/** The internal recipient ids of a message, excluding the sender themselves. */
export function internalRecipientIds(m: MailMessage): EmployeeId[] {
  const from = m.from.employeeId;
  const ids = [...m.to, ...m.cc, ...m.bcc]
    .map((p) => p.employeeId)
    .filter((x): x is EmployeeId => !!x && x !== from);
  return [...new Set(ids)];
}

/**
 * The status to show the SENDER for their own message. Returns null when the
 * viewer is not the sender — the recipient's screen shows read state through the
 * unread list, not a per-message "seen" chip.
 */
export function mailSendStatus(
  m: MailMessage,
  viewerId: EmployeeId | null,
): MailSendStatus | null {
  if (!viewerId || m.from.employeeId !== viewerId) return null;
  if (m.deliveryError) return "failed";
  if (m.sentAt === null) return "draft";
  if (m.transport === "internal") {
    const recips = internalRecipientIds(m);
    if (recips.length > 0 && recips.every((id) => m.readBy.includes(id))) {
      return "seen";
    }
  }
  return "sent";
}

/** The short human label for a status chip. */
export const MAIL_STATUS_LABEL: Record<MailSendStatus, string> = {
  failed: "Not sent",
  draft: "Draft",
  sent: "Sent",
  seen: "Seen",
};
