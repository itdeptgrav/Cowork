import type { MessageAttachment } from "@/lib/domain";

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
 * ## Only images
 *
 * A PDF, a video or a voice note has no clipboard representation that survives
 * being pasted — the platform formats for "a file" are not what
 * `navigator.clipboard` writes, and a filename pasted where somebody expected a
 * file is worse than the action being unavailable. So those messages keep the
 * old refusal, with a sentence that now names what is missing rather than
 * mentioning only text.
 */

/** The label the menu shows, which names exactly what will be copied. */
export type CopyLabel = "Copy" | "Copy text" | "Copy image";

export interface CopyPlan {
  /** The caption, or null when the message is only a picture. */
  text: string | null;
  /** The picture to put on the clipboard, or null when there is none. */
  image: MessageAttachment | null;
  label: CopyLabel;
  disabled: boolean;
  /** Why it is unavailable — shown under the greyed item, never on its own. */
  reason: string | null;
}

export const DELETED_REASON = "This message was deleted.";
export const NOTHING_REASON = "This message has no text or image to copy.";

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
      label: "Copy",
      disabled: true,
      reason: DELETED_REASON,
    };
  }

  if (!text && !image) {
    return {
      text: null,
      image: null,
      label: "Copy",
      disabled: true,
      reason: NOTHING_REASON,
    };
  }

  return {
    text,
    image,
    label: text && image ? "Copy" : image ? "Copy image" : "Copy text",
    disabled: false,
    reason: null,
  };
}
