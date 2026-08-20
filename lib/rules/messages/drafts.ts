import type { MessageAttachment, MessageReply } from "@/lib/domain";

/**
 * An unsent message, kept per conversation.
 *
 * Switching threads remounts the composer — `Thread` is keyed by conversation
 * id — so everything typed but not sent was discarded by React before anybody
 * could notice it had gone. Somebody half-way through a reply who clicks
 * another name to check something loses the reply, and there is no undo,
 * because as far as the application is concerned nothing ever existed.
 *
 * ## What is kept, and what deliberately is not
 *
 *  · **The text**, obviously.
 *  · **The attachments** — but as METADATA, not as bytes. A file is uploaded to
 *    Drive the moment it is picked, so by the time it is staged in the composer
 *    it is already a `MessageAttachment` with a URL: a few hundred bytes of
 *    JSON that survive a refresh perfectly. A `File` object cannot be stored at
 *    all, which is what makes "where technically possible" the honest wording —
 *    a file that FAILED to upload has no URL yet and can only live in memory.
 *  · **The reply being composed**, because a draft that comes back detached
 *    from the message it answers is a different message.
 *
 * An in-progress EDIT is not a draft and is not kept. `startEdit` overwrites the
 * composer with an existing message's text; persisting that would restore
 * somebody's edit of an old message as a new draft the next time they opened
 * the thread.
 *
 * ## Pure on purpose
 *
 * This module knows the SHAPE of a draft and nothing about where it is put.
 * `lib/rules/` may not do I/O — the storage lives in the messages feature and
 * calls these — which is what lets every rule below be tested against a string
 * rather than against a browser.
 */

/**
 * The key prefix, and the reason it is a prefix.
 *
 * There is one key per conversation, so the set is unbounded and cannot be
 * cleared by naming its members. Signing in as somebody else has to leave
 * nothing behind — a colleague's half-written message appearing in the next
 * person's composer is a genuine disclosure, not an untidiness — so the prefix
 * is what makes a sweep possible. See `draftKeysIn`.
 */
export const DRAFT_KEY_PREFIX = "cowork.draft.";

/** The storage key for one conversation's draft. */
export function draftKey(conversationId: string): string {
  return `${DRAFT_KEY_PREFIX}${conversationId}`;
}

/**
 * Every draft key among these, so a caller can clear them all.
 *
 * Takes the key list rather than reading storage itself, again because this
 * file does no I/O — and it makes "what counts as a draft key" testable.
 */
export function draftKeysIn(keys: readonly string[]): string[] {
  return keys.filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
}

export interface ConversationDraft {
  text: string;
  attachments: MessageAttachment[];
  replyTo: MessageReply | null;
}

/**
 * The stored shape, versioned.
 *
 * A draft is written by one build and read by the next, so a shape change has
 * to be survivable. An unrecognised version is DISCARDED rather than coerced:
 * losing an unsent message is bad, and restoring a mangled one into somebody's
 * composer where they might send it is worse.
 */
const VERSION = 1;

/** Nothing worth keeping — no text, no files, and so nothing to restore. */
export function isDraftEmpty(draft: ConversationDraft): boolean {
  return draft.text.trim() === "" && draft.attachments.length === 0;
}

export function serializeDraft(draft: ConversationDraft): string {
  return JSON.stringify({
    v: VERSION,
    text: draft.text,
    attachments: draft.attachments,
    replyTo: draft.replyTo,
  });
}

const str = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

/**
 * One stored attachment, or null if it could not be trusted.
 *
 * A `url` is required because that is what makes an attachment sendable; the
 * rest is defaulted. Anything that fails is dropped from the draft rather than
 * failing the whole draft — losing one thumbnail is better than losing the
 * paragraph somebody wrote beside it.
 */
function readAttachment(v: unknown): MessageAttachment | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const url = str(o.url);
  if (!url) return null;
  const kind = str(o.kind);
  return {
    url,
    kind:
      kind === "image" || kind === "pdf" || kind === "voice" ? kind : "file",
    name: str(o.name),
    sizeBytes: typeof o.sizeBytes === "number" ? o.sizeBytes : null,
    durationSecs: typeof o.durationSecs === "number" ? o.durationSecs : null,
    fileId: str(o.fileId),
  };
}

function readReply(v: unknown): MessageReply | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const messageId = str(o.messageId);
  if (!messageId) return null;
  return {
    messageId,
    senderName: str(o.senderName) ?? "",
    text: str(o.text) ?? "",
  };
}

/**
 * A stored string back into a draft, or null where there is nothing usable.
 *
 * Every branch returns null rather than throwing. This runs while a thread is
 * being drawn, and a corrupt entry — a half-written record, a value from a
 * future build, something another tab left — must cost the draft and nothing
 * else. Throwing here would take the conversation down with it.
 */
export function parseDraft(raw: string | null | undefined): ConversationDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (o.v !== VERSION) return null;

  const draft: ConversationDraft = {
    text: str(o.text) ?? "",
    attachments: Array.isArray(o.attachments)
      ? o.attachments
          .map(readAttachment)
          .filter((a): a is MessageAttachment => a !== null)
      : [],
    replyTo: readReply(o.replyTo),
  };
  /* An empty draft is the same as no draft. Returning one would put a reply
     quote above an empty composer with nothing to reply with. */
  return isDraftEmpty(draft) ? null : draft;
}
