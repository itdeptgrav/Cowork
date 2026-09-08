import type { MessageAttachment } from "@/lib/domain";
import { driveFileIdFrom, driveViewUrl } from "./driveUrls";

/**
 * What "Copy" puts on the clipboard for one message, and what the menu says.
 *
 * ## Why this is a rule rather than a line in each menu
 *
 * The same decision is made in two places — `MessagesArea` for a conversation
 * and `ChatPanel` for a task's discussion — and they had drifted into two
 * copies of one rule already: both greyed the item out on `!m.text` with the
 * same sentence written twice. A message carrying a picture and no caption is
 * the ordinary case for a screenshot, and both of them refused it.
 *
 * ## Text AND image, in one clipboard write
 *
 * A `ClipboardItem` holds several representations of ONE thing, and the target
 * chooses: paste into a document and the picture lands, paste into a plain-text
 * box and the caption does. That is why this returns both rather than making
 * the person choose which they meant — there is no choice to make, and the two
 * cannot be separated by anything the person does afterwards.
 *
 * ## A PDF, a video or a voice note copies its LINK
 *
 * None of those has a clipboard form that survives being pasted — the platform
 * formats for "a file" are not what `navigator.clipboard` writes, and a
 * filename pasted where somebody expected a file would be worse than the
 * action being unavailable. That is not the same as having nothing to offer,
 * though: the message still opens somewhere, and that address is exactly what
 * "Copy link" hands over — a plain string, which every clipboard implementation
 * accepts. `shareableLink` resolves the same URL `mediaOpenUrl` in
 * `MessageAttachments.tsx` already opens the file at, so a copied link and a
 * clicked attachment go to the same place. What is still refused is a message
 * with truly nothing on it — no words, no picture, no attachment at all.
 */

/** The label the menu shows, which names exactly what will be copied. */
export type CopyLabel = "Copy" | "Copy text" | "Copy image" | "Copy link";

export interface CopyPlan {
  /** The caption, or null when the message is only a picture or a file. */
  text: string | null;
  /** The picture to put on the clipboard, or null when there is none. */
  image: MessageAttachment | null;
  /** The URL to put on the clipboard as text, for a file that is not a picture. */
  link: string | null;
  label: CopyLabel;
  disabled: boolean;
  /** Why it is unavailable — shown under the greyed item, never on its own. */
  reason: string | null;
}

export const DELETED_REASON = "This message was deleted.";
export const NOTHING_REASON = "This message has nothing to copy.";

/**
 * The first image on a message, which is the one that gets copied.
 *
 * **First rather than all of them.** One clipboard write holds one picture: a
 * second `image/png` entry in the same `ClipboardItem` replaces the first, and
 * writing several items is supported almost nowhere. Copying the first is
 * predictable — it is the one at the top of the bubble — where copying "some
 * of them" would not be.
 */
export function firstImage(
  attachments: readonly MessageAttachment[] | null | undefined,
): MessageAttachment | null {
  for (const a of attachments ?? []) {
    if (a.kind === "image") return a;
  }
  return null;
}

/**
 * The URL "Copy link" would put on the clipboard for one attachment, or null.
 *
 * Mirrors `mediaOpenUrl` in `MessageAttachments.tsx` — same id extraction, same
 * fallback to the stored URL — so the copied address is the one the attachment
 * already opens to, not a second address that happens to look similar. Kept as
 * its own small function here (rather than imported) because that file is a
 * component and this module is deliberately framework-free and testable with
 * no DOM; the two are re-asserted equal in the test file.
 *
 * Correct only for attachments granted `role: reader, type: anyone` — chat and
 * message attachments, which is everything a message's own `copyPlan` is ever
 * called on. A private attachment would produce a Drive link showing "you need
 * access"; nothing reachable from `copyPlan` is one of those.
 */
export function shareableLink(
  attachment: Pick<MessageAttachment, "fileId" | "url">,
): string | null {
  const id = attachment.fileId || driveFileIdFrom(attachment.url);
  const url = id ? driveViewUrl(id) : attachment.url;
  return url ? url : null;
}

/**
 * The first attachment worth a "Copy link", or null.
 *
 * Only reached when there is no caption and no picture — a picture always
 * wins, matching `firstImage`: a screenshot IS the message, and a link to it
 * on Drive would be a worse copy of the same thing. Among what is left, first
 * rather than all of them, for the same reason `firstImage` picks one — it is
 * the attachment at the top of the bubble, and predictable.
 */
export function firstLinkable(
  attachments: readonly MessageAttachment[] | null | undefined,
): MessageAttachment | null {
  for (const a of attachments ?? []) {
    if (a.kind !== "image" && shareableLink(a)) return a;
  }
  return null;
}

export function copyPlan(message: {
  text?: string | null;
  attachments?: readonly MessageAttachment[] | null;
  isDeleted?: boolean;
}): CopyPlan {
  const text = (message.text ?? "").trim() ? (message.text as string) : null;
  const image = firstImage(message.attachments);

  /* A deleted message keeps its place in the thread but has nothing left to
     copy. Checked before the rest so the reason names the deletion rather than
     the emptiness that follows from it. */
  if (message.isDeleted === true) {
    return {
      text: null,
      image: null,
      link: null,
      label: "Copy",
      disabled: true,
      reason: DELETED_REASON,
    };
  }

  if (!text && !image) {
    /* No words, no picture — but a PDF, a video or a voice note still opens
       somewhere, and that address is worth having on the clipboard even though
       the file's own bytes are not. */
    const linkable = firstLinkable(message.attachments);
    if (linkable) {
      return {
        text: null,
        image: null,
        link: shareableLink(linkable),
        label: "Copy link",
        disabled: false,
        reason: null,
      };
    }
    return {
      text: null,
      image: null,
      link: null,
      label: "Copy",
      disabled: true,
      reason: NOTHING_REASON,
    };
  }

  return {
    text,
    image,
    link: null,
    label: text && image ? "Copy" : image ? "Copy image" : "Copy text",
    disabled: false,
    reason: null,
  };
}
