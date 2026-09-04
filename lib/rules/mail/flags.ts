/**
 * The per-person mail flags, and the message field each lives on.
 *
 * One table, imported by BOTH backends, so a flag can never map to two
 * different fields between the mock and the real store. Each flag is a set of
 * employee ids on the message (`starredBy`, `trashedBy`, `spamBy`,
 * `importantBy`) — the same per-person shape the mailbox has always used for
 * read/star/trash.
 */
export type MailFlag = "starred" | "trashed" | "spam" | "important";

export type MailFlagField =
  | "starredBy"
  | "trashedBy"
  | "spamBy"
  | "importantBy";

export const MAIL_FLAG_FIELD = {
  starred: "starredBy",
  trashed: "trashedBy",
  spam: "spamBy",
  important: "importantBy",
} as const satisfies Record<MailFlag, MailFlagField>;
