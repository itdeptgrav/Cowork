import type { EmployeeId } from "./identity";

/**
 * One mailbox, two transports.
 *
 * **The product change this schema exists to make.** Legacy ran two mail
 * systems side by side: `/coworking/mail` (1,376 lines) wrote a `cowork_mails`
 * Firestore collection from the browser, and `/coworking/mail/gmail` (1,593
 * lines) drove the Gmail API through per-employee OAuth tokens. Two inboxes,
 * two sent folders, two search boxes, and a person had to know which system a
 * message lived in before they could look for it.
 *
 * Here there is ONE thread list and one message shape. `transport` records how
 * a message travelled, because the difference is real — an internal message
 * stays inside Cowork and an external one leaves it — but it is a property of
 * the message, not a partition of the mailbox.
 *
 * **Designed to survive the move to a real database.** Every relationship is an
 * id rather than an embedded object, timestamps are ISO strings, and nothing
 * depends on client-side ordering. A `MailThread` row, a `MailMessage` row and
 * a `MailAttachment` row map onto three tables with two foreign keys and no
 * rewriting — see docs/architecture/MAIL_MIGRATION_SPEC.md.
 */

/** How a message travelled. Decided by the recipient, never chosen by hand. */
export type MailTransport = "internal" | "gmail";

/**
 * What kind of party this is.
 *
 * An internal party is an employee with a profile, an avatar and a department.
 * An external party is an address and, at best, a display name. Keeping both in
 * one shape is what lets a thread mix them without the UI branching everywhere.
 */
export type MailPartyKind = "employee" | "external";

export interface MailParty {
  kind: MailPartyKind;
  /** Set only for `employee`. The join back to the workspace directory. */
  employeeId: EmployeeId | null;
  /**
   * Always present. For an employee this is their work address, which is what
   * makes a reply from outside land back on the same thread.
   */
  address: string;
  displayName: string;
}

export type MailFolder = "inbox" | "sent" | "drafts" | "trash";

/**
 * A conversation, whatever it travelled over.
 *
 * `transport` here is the thread's ORIGIN, not a filter: a thread started
 * internally that later includes an external address stays one thread. The
 * sidebar's Internal and External views read `transport`, and the Inbox does
 * not — which is the whole point.
 */
export interface MailThread {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  subject: string;
  participants: MailParty[];
  /** Denormalised for the list. Cheap here, essential in SQL. */
  lastMessageAt: string;
  lastMessagePreview: string;
  messageCount: number;
  transport: MailTransport;
  /**
   * Which Gmail thread this mirrors, when it mirrors one.
   *
   * Null for internal threads. It is what lets a Gmail reply arriving later be
   * attached to the thread it belongs to rather than starting a new one.
   */
  gmailThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailMessage {
  id: string;
  threadId: string;
  transport: MailTransport;

  from: MailParty;
  to: MailParty[];
  cc: MailParty[];

  subject: string;
  /** Plain text in this prototype. HTML is a rendering decision, not a schema one. */
  body: string;
  attachmentIds: string[];

  /**
   * Per-recipient state.
   *
   * On the message rather than in a join table because a Cowork mailbox is
   * per-employee and the reads are always "mine". In SQL this becomes a
   * `mail_message_state` table keyed by (messageId, employeeId) — the migration
   * spec records that mapping.
   */
  readBy: EmployeeId[];
  starredBy: EmployeeId[];
  /** Soft, per-person. Trash is a view, never a delete. */
  trashedBy: EmployeeId[];
  archivedBy: EmployeeId[];
  labels: string[];

  /** Null until sent. A draft is a message that has not left. */
  sentAt: string | null;
  createdAt: string;

  /** Gmail's own id, when this message came from or went to Gmail. */
  gmailMessageId: string | null;
  /**
   * Why an external send did not happen, when it did not.
   *
   * A message that could not be delivered is kept, not discarded — the person
   * wrote it and needs to know it did not go. Null on every internal message
   * and on a successful external one.
   */
  deliveryError: string | null;
}

export interface MailAttachment {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Synthetic in this prototype, like every other attachment in Cowork. */
  storageKey: string;
  uploadedAt: string;
}
