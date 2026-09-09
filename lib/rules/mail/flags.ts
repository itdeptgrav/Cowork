/**
 * The per-person mail flags, and the message field each lives on.
 *
 * One table, imported by BOTH backends, so a flag can never map to two
 * different fields between the mock and the real store. Each flag is a set of
 * employee ids on the message (`starredBy`, `trashedBy`, `spamBy`,
 * `importantBy`) — the same per-person shape the mailbox has always used for
 * read/star/trash.
 */
export type MailFlag =
  | "starred"
  | "trashed"
  | "spam"
  | "important"
  /**
   * Out of the Inbox, and nowhere else.
   *
   * `archivedBy` has been on the message since the mailbox was built and was
   * never read by anything — the field existed, the behaviour did not. It is
   * the quiet counterpart to `trashed`: the message is not deleted, not spam
   * and not going anywhere, it has simply been dealt with. Gmail is untouched
   * by it, because the connection is `gmail.readonly` and cannot change a
   * label even if we wanted it to.
   */
  | "archived";

export type MailFlagField =
  | "starredBy"
  | "trashedBy"
  | "spamBy"
  | "importantBy"
  | "archivedBy";

export const MAIL_FLAG_FIELD = {
  starred: "starredBy",
  trashed: "trashedBy",
  spam: "spamBy",
  important: "importantBy",
  archived: "archivedBy",
} as const satisfies Record<MailFlag, MailFlagField>;
