/**
 * Mail on the real backend — the pure half.
 *
 * The legacy repository stores each message as one Firestore document in
 * `cowork_mails` — the same collection legacy's internal mail used, so the
 * Firestore security rules already permit it — but shaped like the `MailMessage`
 * domain type (parties as OBJECTS, not employee ids) so an EXTERNAL Gmail party,
 * which has an address and no employee id, can be stored at all. A `MailParty`
 * write is distinguished from a legacy id-based doc by shape: a legacy doc's
 * `from` is a string, so `readMailMessage` gives it `from.employeeId = null` and
 * it fails the visibility check — old records are simply invisible rather than
 * garbled, and the `participantIds` array (new) is what the reader queries, which
 * legacy docs do not carry. THREADS are not stored: they are derived from their
 * messages on every read, so there is no second record to fall out of step.
 *
 * These functions carry no I/O. They are the same rules the mock applies
 * (`#mailVisible`, `#inFolder`), lifted out so the two backends cannot drift on
 * what "in the inbox" or "visible to me" means.
 */
import type {
  MailFolder,
  MailMessage,
  MailParty,
  MailThread,
  MailTransport,
} from "../../domain/mail.ts";
import type { Employee } from "../../domain/identity.ts";

export const MAIL_COLLECTION = "cowork_mails";

/** One party, defaulted — a stored doc predating a field must not throw. */
function readParty(p: unknown): MailParty {
  const o = (p ?? {}) as Record<string, unknown>;
  return {
    kind: o.kind === "external" ? "external" : "employee",
    employeeId: typeof o.employeeId === "string" ? o.employeeId : null,
    address: typeof o.address === "string" ? o.address : "",
    displayName: typeof o.displayName === "string" ? o.displayName : "",
  };
}

/** Coerce a raw Firestore document into a `MailMessage`, defaulting every array
 *  and nullable so a partially-written or legacy doc never crashes a read. */
export function readMailMessage(
  id: string,
  d: Record<string, unknown>,
): MailMessage {
  const parties = (v: unknown): MailParty[] =>
    Array.isArray(v) ? v.map(readParty) : [];
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    id,
    threadId: typeof d.threadId === "string" ? d.threadId : id,
    transport: d.transport === "gmail" ? "gmail" : "internal",
    from: readParty(d.from),
    to: parties(d.to),
    cc: parties(d.cc),
    subject: typeof d.subject === "string" ? d.subject : "",
    body: typeof d.body === "string" ? d.body : "",
    attachmentIds: ids(d.attachmentIds),
    readBy: ids(d.readBy),
    starredBy: ids(d.starredBy),
    trashedBy: ids(d.trashedBy),
    archivedBy: ids(d.archivedBy),
    labels: ids(d.labels),
    sentAt: typeof d.sentAt === "string" ? d.sentAt : null,
    createdAt:
      typeof d.createdAt === "string"
        ? d.createdAt
        : new Date(0).toISOString(),
    gmailMessageId:
      typeof d.gmailMessageId === "string" ? d.gmailMessageId : null,
    deliveryError:
      typeof d.deliveryError === "string" ? d.deliveryError : null,
  };
}

/** Visible to you if you sent it, or you are a recipient. The same rule the
 *  mock enforces; an external party (no employee id) never matches. */
export function mailVisible(m: MailMessage, me: string): boolean {
  if (m.from.employeeId === me) return true;
  return [...m.to, ...m.cc].some((p) => p.employeeId === me);
}

/** Which folder a message sits in FOR YOU. Trash and drafts are per-person. */
export function inFolder(m: MailMessage, me: string, folder: MailFolder): boolean {
  const trashed = m.trashedBy.includes(me);
  if (folder === "trash") return trashed;
  if (trashed) return false;
  if (folder === "drafts") return m.sentAt === null && m.from.employeeId === me;
  if (m.sentAt === null) return false;
  if (folder === "sent") return m.from.employeeId === me;
  /* Inbox: addressed to me, not sent by me. */
  return m.from.employeeId !== me;
}

/** The employee ids on a message — the array a Firestore `array-contains` query
 *  needs to find "every message I am a party to" in one read. */
export function participantIdsOf(
  from: MailParty,
  to: MailParty[],
  cc: MailParty[],
): string[] {
  const ids = [from, ...to, ...cc]
    .map((p) => p.employeeId)
    .filter((x): x is string => !!x);
  return [...new Set(ids)];
}

/** Transport a set of recipients implies — internal unless anyone is external.
 *  Kept here as well as in `integrations/mail/transport` so a stored message
 *  can be re-derived without importing the compose-time module. */
export function transportForParties(recipients: MailParty[]): MailTransport {
  if (recipients.length === 0) return "internal";
  return recipients.every((r) => r.kind === "employee") ? "internal" : "gmail";
}

const stamp = (m: MailMessage) => m.sentAt ?? m.createdAt;

/** Build the thread record from its messages. Newest message drives the
 *  summary; participants are the union across every message. */
export function deriveThread(
  threadId: string,
  msgs: MailMessage[],
  organisationId: string,
): MailThread {
  const sorted = [...msgs].sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const seen = new Map<string, MailParty>();
  for (const m of sorted)
    for (const p of [m.from, ...m.to, ...m.cc]) {
      const key = p.employeeId ?? p.address.toLowerCase();
      if (key && !seen.has(key)) seen.set(key, p);
    }
  const gmailMsg = sorted.find((m) => m.gmailMessageId);
  return {
    organisationId,
    id: threadId,
    subject: first?.subject ?? "",
    participants: [...seen.values()],
    lastMessageAt: last ? stamp(last) : (first ? stamp(first) : ""),
    lastMessagePreview: (last?.body ?? "").slice(0, 140),
    messageCount: sorted.length,
    /* Origin, not a running total: the sidebar's Internal/External split reads
       the first message's transport, so a thread does not switch columns when a
       reply happens to reach an outside address. */
    transport: first?.transport ?? "internal",
    gmailThreadId: gmailMsg ? gmailMsg.threadId.replace(/^gt-/, "") : null,
    createdAt: first?.createdAt ?? "",
    updatedAt: last ? stamp(last) : "",
  };
}

export function threadMatchesSearch(
  thread: MailThread,
  msgs: MailMessage[],
  needle: string,
): boolean {
  const n = needle.toLowerCase();
  if (thread.subject.toLowerCase().includes(n)) return true;
  if (
    thread.participants.some(
      (p) =>
        p.displayName.toLowerCase().includes(n) ||
        p.address.toLowerCase().includes(n),
    )
  )
    return true;
  return msgs.some((m) => m.body.toLowerCase().includes(n));
}

/** Resolve a raw party against the directory and the connected mailbox address.
 *  The mailbox address wins, because a person's Gmail address may differ from
 *  their Cowork work address and that is how "which of these is me" is decided
 *  when folding a synced message in. */
export function resolveParty(
  p: MailParty,
  byEmail: Map<string, Employee>,
  mailboxAddress: string,
  meEmp: Employee | null,
): MailParty {
  const address = p.address.toLowerCase();
  if (mailboxAddress && address === mailboxAddress && meEmp)
    return {
      kind: "employee",
      employeeId: meEmp.id,
      address: p.address,
      displayName: meEmp.displayName,
    };
  const emp = byEmail.get(address);
  return emp
    ? {
        kind: "employee",
        employeeId: emp.id,
        address: emp.email ?? p.address,
        displayName: emp.displayName,
      }
    : p;
}

/** A plain object safe to hand to `addDoc` — no `undefined` (Firestore rejects
 *  it) and no client id (the doc id is the message id). */
export function mailMessageBody(
  m: Omit<MailMessage, "id">,
  organisationId: string,
): Record<string, unknown> {
  return {
    organisationId,
    threadId: m.threadId,
    transport: m.transport,
    from: m.from,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    body: m.body,
    attachmentIds: m.attachmentIds,
    readBy: m.readBy,
    starredBy: m.starredBy,
    trashedBy: m.trashedBy,
    archivedBy: m.archivedBy,
    labels: m.labels,
    sentAt: m.sentAt,
    createdAt: m.createdAt,
    gmailMessageId: m.gmailMessageId,
    deliveryError: m.deliveryError,
    participantIds: participantIdsOf(m.from, m.to, m.cc),
  };
}
