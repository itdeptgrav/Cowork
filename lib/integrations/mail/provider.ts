import type { MailMessage, MailParty, MailThread } from "@/lib/domain";

/**
 * One shape for both transports.
 *
 * The unified mail layer picks a provider with `transportFor(recipients)` and
 * then stops caring which one it got. That is what keeps a Gmail outage from
 * touching internal mail, and what makes background sync a matter of calling
 * `fetchThreads()` on a schedule rather than a rewrite.
 *
 * Neither implementation knows the other exists, and the UI knows neither — it
 * talks to the repository. Legacy had no seam here at all: the Gmail page called
 * the Gmail API and the internal page wrote Firestore, so the two could never
 * appear in one list.
 */
export interface SendMailInput {
  from: MailParty;
  to: MailParty[];
  cc: MailParty[];
  subject: string;
  body: string;
  attachmentIds: string[];
  /** Set when this is a reply, so the message joins its thread. */
  threadId: string | null;
}

export interface SendMailResult {
  ok: boolean;
  message: MailMessage | null;
  /** Why it did not send. Kept on the draft rather than discarded. */
  error: string | null;
}

export interface MailProvider {
  readonly id: "cowork" | "gmail";
  send(input: SendMailInput): Promise<SendMailResult>;
  /** Newest first. `since` lets a background sync ask only for the delta. */
  fetchThreads(opts: { employeeId: string; since?: string }): Promise<MailThread[]>;
  fetchMessages(threadId: string): Promise<MailMessage[]>;
}
