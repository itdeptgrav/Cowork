import type { MailParty, MailTransport } from "@/lib/domain";

/**
 * Which transport a message takes, and who decides.
 *
 * **The recipient decides. Never the sender, and never a toggle.** This is the
 * one rule the unified mailbox rests on: a person composing a message picks who
 * it is for, and the system works out whether that stays inside Cowork or
 * leaves through Gmail. Legacy made the human choose first — they opened either
 * `/mail` or `/mail/gmail` — which meant picking the wrong door was a mistake
 * you could only fix by starting again.
 *
 * Pure, so the compose window can show "Internal message" or "Sending via
 * Gmail" from the same function that routes the send. A banner computed
 * separately from the routing is a banner that will eventually lie.
 */

/** A very small, deliberate address check. */
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAddress(value: string): boolean {
  return ADDRESS.test(value.trim());
}

/**
 * The transport for a set of recipients.
 *
 * Internal only when EVERY recipient is an employee. One external address makes
 * the whole message external, because the message is one artefact and it cannot
 * half-leave the building — and because a mixed send that quietly dropped the
 * outside recipient would be the worst possible outcome.
 */
export function transportFor(recipients: MailParty[]): MailTransport {
  if (recipients.length === 0) return "internal";
  return recipients.every((r) => r.kind === "employee") ? "internal" : "gmail";
}

/**
 * What to tell the person composing.
 *
 * Said plainly, because it is the one thing about a unified mailbox they do
 * need to know: whether what they are writing stays inside the company.
 */
export function transportNotice(recipients: MailParty[]): {
  transport: MailTransport;
  label: string;
  detail: string;
} {
  const transport = transportFor(recipients);
  const external = recipients.filter((r) => r.kind === "external");
  if (transport === "internal") {
    return {
      transport,
      label: "Internal message",
      detail:
        "This stays inside Cowork. Everyone on it has a profile, and it will not touch Gmail.",
    };
  }
  return {
    transport,
    label: "Sending via Gmail",
    detail:
      external.length === recipients.length
        ? "This leaves the company through Gmail."
        : `This leaves the company through Gmail, because ${external.length} of ${recipients.length} recipients are outside Cowork.`,
  };
}

/**
 * Resolve typed text into a party.
 *
 * An address that belongs to an employee resolves to that EMPLOYEE, not to an
 * external party — so typing a colleague's work address by hand sends
 * internally rather than routing their own mail out through Gmail and back.
 * Matching is case-insensitive because addresses are.
 */
export function resolveParty(
  input: string,
  directory: { employeeId: string; address: string; displayName: string }[],
): MailParty | null {
  const value = input.trim();
  if (!value) return null;
  const found = directory.find(
    (d) => d.address.toLowerCase() === value.toLowerCase(),
  );
  if (found) {
    return {
      kind: "employee",
      employeeId: found.employeeId,
      address: found.address,
      displayName: found.displayName,
    };
  }
  if (!isAddress(value)) return null;
  return {
    kind: "external",
    employeeId: null,
    address: value,
    displayName: value,
  };
}

/**
 * Why this message cannot be sent, or null.
 *
 * Shared by the compose window and the repository, so the form never offers a
 * send the server refuses.
 */
export function sendRefusal(input: {
  recipients: MailParty[];
  subject: string;
  /** Whether the Gmail transport is actually usable right now. */
  gmailAvailable: boolean;
}): string | null {
  if (input.recipients.length === 0) return "Choose at least one recipient.";
  if (!input.subject.trim()) return "Give the message a subject.";
  if (transportFor(input.recipients) === "gmail" && !input.gmailAvailable)
    return "Gmail is not connected, so this cannot be sent outside Cowork. It will be kept as a draft.";
  return null;
}
