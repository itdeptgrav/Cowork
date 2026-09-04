import type { EmployeeId } from "./identity";
import type { MessageAttachment } from "./work";

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

export type MailFolder = "inbox" | "sent" | "drafts" | "trash" | "spam";

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

  /**
   * Per-VIEWER list conveniences — computed on every read, never stored, and
   * optional so a legacy or partially-written thread without them simply reads
   * as "not unread / no attachment". They belong here for the same reason
   * `lastMessagePreview` does: the thread list must not fetch every message's
   * state to draw a row. In SQL these become a computed column / a join count.
   */
  /** The thread holds a message in the viewer's inbox they have not read. */
  unread?: boolean;
  /** Some message in the thread carries an attachment — for the paperclip. */
  hasAttachments?: boolean;
  /** The viewer has starred some message in the thread. */
  starred?: boolean;
  /** The viewer has flagged some message in the thread Important. */
  important?: boolean;
}

export interface MailMessage {
  id: string;
  threadId: string;
  transport: MailTransport;

  from: MailParty;
  to: MailParty[];
  cc: MailParty[];
  /**
   * Blind copies. Stored, and redacted on every read but the sender's.
   *
   * On the message rather than in a side table because the SENDER has to be
   * able to see who they copied — a blind copy nobody can audit afterwards is a
   * different problem. `lib/rules/mail/blindCopy.ts` holds the invariant and
   * every read path goes through its `redactBcc`; a reader who may not see it
   * gets `[]`, indistinguishable from a message that had none, because "there
   * was no bcc" and "you may not see the bcc" must not be tellable apart.
   */
  bcc: MailParty[];

  subject: string;
  /**
   * The message text, PLAIN. Always present, and the source of truth for search,
   * the grammar check, the thread preview and any plain-text fallback — so none
   * of those has to understand HTML. For a rich message this is the editor's
   * text content; `bodyHtml` carries the formatting alongside it.
   */
  body: string;
  /**
   * The rich body, as HTML, when the sender formatted it. Optional and defaulted
   * away on read, so a plain message (and every legacy or Gmail one) simply has
   * none and renders from `body`. Rendered ONLY through the mail schema's
   * sanitiser (`MailRichText`), never raw — see the note there.
   */
  bodyHtml?: string;
  /**
   * File ids, for an attachment stored in the separate `cowork_mail_attachments`
   * collection (the SQL-migration shape). Kept for Gmail-synced messages and the
   * migration target.
   */
  attachmentIds: string[];
  /**
   * Attachments carried INLINE on the message, exactly as a chat message carries
   * them — the file goes to Drive first (public, resumable, no size cap) and its
   * `MessageAttachment` rides the one send. Optional and defaulted to `[]` on
   * read, so a stored doc written before this field never crashes; and written
   * only with non-`undefined` values, because Firestore rejects `undefined`.
   *
   * Chosen over the separate-collection write because it reuses the chat upload
   * and render path wholesale and touches only `cowork_mails`, whose write rules
   * already permit an internal message.
   */
  attachments?: MessageAttachment[];

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
  /**
   * Per-person flags added on top of the originals, each a set of employee ids
   * so they read exactly like `starredBy`/`trashedBy`. Optional-by-default at
   * the read boundary (`readMailMessage` defaults them to `[]`) so a stored doc
   * written before these fields existed is not garbled — it simply has neither.
   */
  /** Moved to Spam by this person — a per-person view, like Trash. */
  spamBy: EmployeeId[];
  /** Flagged Important by this person — a personal marker, like Star. */
  importantBy: EmployeeId[];
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
