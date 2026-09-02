import type { MessageAttachment } from "@/lib/domain";

/**
 * Every image in a whole conversation, in order — the list the gallery walks.
 *
 * WhatsApp opens an image into a strip of EVERY image in the chat, not just the
 * ones in the message you tapped. A message only knows its own attachments, so
 * that strip has to be assembled one level up, from the message list the thread
 * already holds. This is that assembly, kept pure so the ordering — and which
 * messages contribute — is one fact a test can pin without a chat on screen.
 *
 * **Only real, visible images.** A soft-deleted message shows a tombstone and
 * contributes nothing; a `system` change-card is not a person's message and has
 * no media; a non-image attachment (a PDF, a voice note, a video) is not part of
 * the image strip. Videos keep their own player for now.
 */

/** The minimum a message must expose to contribute to the gallery. Both the
    Messages `Message` and the task `TaskChatMessage` satisfy it structurally. */
export interface GalleryMessage {
  id: string;
  /** `"system"` for a change-card; a real employee id otherwise. */
  senderId: string;
  /** Denormalised sender name, shown in the viewer header. */
  senderName: string;
  createdAt: string;
  attachments?: MessageAttachment[];
  isDeleted?: boolean;
}

/** One image in the conversation, tagged with where it came from. */
export interface GalleryMediaItem {
  /** `"${messageId}#${imageIndexWithinMessage}"` — unique even when the same
      file appears in two messages, which matching on fileId could not tell
      apart. This is how a clicked thumbnail finds its place in the whole list. */
  key: string;
  messageId: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  attachment: MessageAttachment;
}

/** The image index WITHIN a message — the same order `MessageAttachments`
    lays its thumbnails out in, so a click on its i-th image lines up here. */
export function galleryKey(messageId: string, imageIndex: number): string {
  return `${messageId}#${imageIndex}`;
}

export function collectConversationImages(
  messages: readonly GalleryMessage[],
): GalleryMediaItem[] {
  const out: GalleryMediaItem[] = [];
  for (const m of messages) {
    if (m.isDeleted) continue;
    if (m.senderId === "system") continue;
    const images = (m.attachments ?? []).filter((a) => a.kind === "image");
    images.forEach((attachment, imageIndex) => {
      out.push({
        key: galleryKey(m.id, imageIndex),
        messageId: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        createdAt: m.createdAt,
        attachment,
      });
    });
  }
  return out;
}

/**
 * Where a clicked image sits in the whole-conversation list, or null if it is
 * not there (a stale click after the list changed under it — the caller then
 * simply does not open). Matched on the composite key, never on the file.
 */
export function galleryIndexOf(
  items: readonly GalleryMediaItem[],
  messageId: string,
  imageIndex: number,
): number | null {
  const key = galleryKey(messageId, imageIndex);
  const i = items.findIndex((it) => it.key === key);
  return i >= 0 ? i : null;
}
