/**
 * Messages on the real backend — the pure half.
 *
 * The legacy repository stores messages exactly where the OLD Cowork frontend
 * wrote them: a direct thread is `cowork_direct_messages/{convId}` with a
 * `messages` subcollection, `convId` being the two employee ids sorted and
 * joined by "_"; a group is `cowork_groups/{groupId}` with the same subcollection.
 * Reading and writing that same shape browser-direct is what makes a conversation
 * started in either app appear in both — the security rules already permit it
 * because the old app relied on the same direct access.
 *
 * These functions carry no I/O. They coerce a stored document into the domain
 * `Conversation`/`Message` and shape a domain object back into the stored form,
 * so the read and write halves cannot drift on field names. Unread is DERIVED
 * from each message's `readBy` (the old app counts it the same way), so there is
 * no second counter to fall out of step.
 */
import type {
  Conversation,
  Message,
  MessageAttachment,
  MessageReply,
  PinnedMessage,
} from "../../domain/work.ts";
import { driveFileIdFrom } from "../../rules/media/driveUrls.ts";
import { attachmentKind } from "../../rules/messages/attachmentKind.ts";

export const DM_COLLECTION = "cowork_direct_messages";
export const GROUP_COLLECTION = "cowork_groups";

/** The direct-thread document id: the pair, order-independent, joined the way the
 *  old app writes it. Employee ids never contain "_", so the split is reversible. */
export function directDocId(a: string, b: string): string {
  return [a, b].sort().join("_");
}

/** The two employee ids a direct `convId` encodes. */
export function pairOf(convId: string): string[] {
  return convId.split("_").filter(Boolean).sort();
}

/** An ISO instant from a Firestore Timestamp | ISO string | epoch ms, or null.
 *  Firestore Timestamps arrive as `{seconds,nanoseconds}` over REST and as objects
 *  with `toDate()` through the SDK; a stored ISO string is taken as-is. */
export function instant(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (value && typeof value === "object") {
    const r = value as { seconds?: unknown; toDate?: unknown };
    if (typeof r.toDate === "function") {
      try {
        return (r.toDate as () => Date)().toISOString();
      } catch {
        /* fall through to the raw seconds */
      }
    }
    if (typeof r.seconds === "number") {
      return new Date(r.seconds * 1000).toISOString();
    }
  }
  return null;
}

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** A short preview for the conversation's last-message line, as the old app stores it. */
export function previewOf(text: string): string {
  return text.slice(0, 80);
}

/**
 * The Google Drive file id a URL points at, or null if it is not Drive-hosted.
 *
 * Host-checked, then delegated to `driveFileIdFrom` so the shapes this
 * recognises and the shapes the RENDERER recognises are one list. They used to
 * be two, in two files, and the failure that produces is silent: a URL one of
 * them parses and the other does not gives an image with a `fileId` nothing
 * draws, or a CDN link built from an id nobody stored.
 *
 * The host check stays here because this one has a job the shared helper does
 * not — a Cloudinary URL from the old application must yield null and be served
 * as-is, rather than having a `/d/` segment read out of some unrelated path.
 */
export function driveFileId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)(google\.com|googleusercontent\.com)$/.test(u.hostname))
      return null;
    return driveFileIdFrom(url);
  } catch {
    return null;
  }
}

/** One stored attachment → the inline `MessageAttachment`, or null if it has no
 *  URL to render. The old docs spell size as `bytes` or `size` and always carry a
 *  `type`; an unrecognised type renders as a generic file rather than vanishing.
 *  A Drive file id is captured (from an explicit field or parsed from the URL) so
 *  the UI can stream it through the media proxy that actually loads. */
export function readAttachment(a: unknown): MessageAttachment | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : "";
  if (!url) return null;
  const t = typeof o.type === "string" ? o.type : "";
  const name = typeof o.name === "string" ? o.name : null;
  /**
   * The stored type where it says something, the filename where it does not.
   *
   * **Two bugs met here.** `video` was missing from this list, so the kind the
   * upload path had just worked out was read straight back as `file` and every
   * clip rendered as a paperclip row — the player it was written for could
   * never be reached.
   *
   * And the kind is FROZEN at send time: `type` is written into the message
   * document, so every video sent before that existed is stored as `file` for
   * good. Whitelisting `video` alone would fix nothing already in a thread.
   *
   * So `file` gets a second look. It is the fallback bucket rather than a
   * positive claim — nothing ever meant "this is definitely not a video" by
   * writing it — whereas `image`, `pdf`, `voice` and `video` were each decided
   * deliberately and are taken at their word.
   */
  const stated =
    t === "image" || t === "pdf" || t === "voice" || t === "video" ? t : null;
  const kind: MessageAttachment["kind"] =
    stated ?? attachmentKind(name, null);
  const fileId =
    driveFileId(url) ?? (typeof o.fileId === "string" ? o.fileId : null);
  return {
    url,
    kind,
    name,
    sizeBytes:
      typeof o.bytes === "number"
        ? o.bytes
        : typeof o.size === "number"
          ? o.size
          : null,
    durationSecs: typeof o.duration === "number" ? o.duration : null,
    fileId,
  };
}

/** Coerce a stored message doc into the domain `Message`. Every field is defaulted
 *  so a partially-written or old-shape doc never crashes a read. A soft-deleted
 *  message keeps its slot but shows the tombstone; a media message with no caption
 *  AND no renderable attachment falls back to a placeholder, so the bubble is
 *  never blank. */
export function readMessageDoc(
  id: string,
  conversationId: string,
  d: Record<string, unknown>,
): Message {
  const type =
    typeof d.messageType === "string"
      ? d.messageType
      : typeof d.type === "string"
        ? d.type
        : "text";
  const attachments = Array.isArray(d.attachments)
    ? d.attachments
        .map(readAttachment)
        .filter((x): x is MessageAttachment => x !== null)
    : [];
  let text =
    d.isDeleted === true
      ? "This message was deleted."
      : typeof d.text === "string"
        ? d.text
        : "";
  /* Only when there is genuinely nothing to show — no caption and no attachment
     the bubble can render — does the type stand in for the body. */
  if (!text && type !== "text" && attachments.length === 0) {
    text =
      type === "image"
        ? "📷 Photo"
        : type === "pdf"
          ? "📄 Document"
          : type === "voice"
            ? "🎤 Voice note"
            : "";
  }
  const reply = readReply(d.replyTo);
  return {
    id: typeof d.messageId === "string" ? d.messageId : id,
    conversationId,
    senderId: typeof d.senderId === "string" ? d.senderId : "",
    senderName: typeof d.senderName === "string" ? d.senderName : "",
    text,
    attachmentIds: [],
    attachments,
    replyToId: reply ? reply.messageId : null,
    replyTo: reply,
    editedAt: instant(d.editedAt),
    isDeleted: d.isDeleted === true,
    createdAt: instant(d.createdAt) ?? new Date(0).toISOString(),
    readBy: strArray(d.readBy),
    reactions: readReactions(d.reactions),
    starredBy: strArray(d.starredBy),
  };
}

/**
 * The stored reactions map — `{ [emoji]: employeeId[] }` — with anything
 * malformed dropped and EMPTY entries removed. An emoji everyone has taken
 * back leaves an empty array behind in the document (`arrayRemove` does not
 * delete the field), and reading that as a chip with a count of zero would
 * draw reactions nobody holds.
 */
export function readReactions(
  v: unknown,
): Record<string, string[]> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [emoji, ids] of Object.entries(v as Record<string, unknown>)) {
    const list = strArray(ids);
    if (list.length) out[emoji] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The conversation's pinned messages, oldest pin first, malformed entries
 * dropped. A pin without a `messageId` has nothing to jump to and is not a
 * pin; the rest of the fields default so a partial record still renders.
 */
export function readPinnedMessages(v: unknown): PinnedMessage[] {
  if (!Array.isArray(v)) return [];
  const out: PinnedMessage[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.messageId !== "string" || !o.messageId) continue;
    out.push({
      messageId: o.messageId,
      senderName: typeof o.senderName === "string" ? o.senderName : "",
      text: typeof o.text === "string" ? o.text : "",
      pinnedById: typeof o.pinnedById === "string" ? o.pinnedById : "",
      pinnedAt: instant(o.pinnedAt) ?? new Date(0).toISOString(),
    });
  }
  return out;
}

/** The quoted message on a reply, defaulted so a partial record never throws. */
export function readReply(v: unknown): MessageReply | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.messageId !== "string") return null;
  return {
    messageId: o.messageId,
    senderName: typeof o.senderName === "string" ? o.senderName : "",
    text: typeof o.text === "string" ? o.text : "",
  };
}

/**
 * Each participant's delivery stamp, as ISO instants.
 *
 * Stored as `delivery: { [employeeId]: Timestamp }` on the conversation
 * document. Read through `instant()` like every other stored time, so a
 * Firestore `Timestamp`, an ISO string and an epoch number all arrive the same
 * way — the field is written by clients and there is no single spelling to rely
 * on.
 *
 * Entries that cannot be read are DROPPED rather than defaulted. A delivery
 * stamp that fell back to "now" would report every message delivered the moment
 * it was drawn, which is the one wrong answer this whole feature exists to
 * avoid; absent is honest and shows a single tick.
 */
export function readDeliveryMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [id, at] of Object.entries(v as Record<string, unknown>)) {
    const iso = instant(at);
    if (iso) out[id] = iso;
  }
  return out;
}

/** A stored direct-message doc → domain `Conversation`, WITHOUT `unreadCount`
 *  (derived from the messages) and WITHOUT participants (resolved against the
 *  directory). Both are filled by the repository. */
export function readDirectConversationDoc(
  id: string,
  d: Record<string, unknown>,
  orgId: string,
): Conversation {
  const last = (d.lastMessage ?? null) as Record<string, unknown> | null;
  return {
    organisationId: orgId,
    id,
    kind: "direct",
    participantIds: strArray(d.participantIds),
    title: null,
    groupId: null,
    lastMessageAt: instant(d.updatedAt) ?? instant(last?.sentAt),
    lastMessagePreview:
      last && typeof last.text === "string" ? last.text : null,
    unreadCount: 0,
    deliveredAt: readDeliveryMap(d.delivery),
    pinned: readPinnedMessages(d.pinnedMessages),
  };
}

/** A stored group doc → domain `Conversation`. The old app writes the group's
 *  last-message line either as a bare string or as an object; both are read. */
export function readGroupConversationDoc(
  id: string,
  d: Record<string, unknown>,
  orgId: string,
): Conversation {
  const last = d.lastMessage ?? null;
  const preview =
    typeof last === "string"
      ? last
      : last && typeof (last as Record<string, unknown>).text === "string"
        ? ((last as Record<string, unknown>).text as string)
        : null;
  /* Admins run the group. Old groups predate the field, so their creator is
     treated as the one admin — never leaving a group without anyone able to
     manage it. */
  const admins = strArray(d.adminIds);
  const createdBy = typeof d.createdBy === "string" ? d.createdBy : null;
  return {
    organisationId: orgId,
    id,
    kind: "group",
    participantIds: strArray(d.memberIds),
    title: typeof d.name === "string" ? d.name : "Group",
    groupId: id,
    adminIds: admins.length ? admins : createdBy ? [createdBy] : [],
    lastMessageAt:
      instant(d.updatedAt) ??
      instant(d.lastMessageTime) ??
      instant((last as Record<string, unknown>)?.sentAt),
    lastMessagePreview: preview,
    unreadCount: 0,
    deliveredAt: readDeliveryMap(d.delivery),
    pinned: readPinnedMessages(d.pinnedMessages),
  };
}

/** One outgoing attachment in the STORED shape — `type`, `bytes`, `duration`,
 *  `fileId` — so a file sent here reads back in the old app unchanged. Undefined
 *  fields are dropped: Firestore rejects `undefined`. */
export function toStoredAttachment(a: MessageAttachment): Record<string, unknown> {
  const o: Record<string, unknown> = { url: a.url, type: a.kind };
  if (a.name) o.name = a.name;
  if (a.sizeBytes != null) o.bytes = a.sizeBytes;
  if (a.durationSecs != null) o.duration = a.durationSecs;
  if (a.fileId) o.fileId = a.fileId;
  return o;
}

/** The last-message line for a message carrying media but no caption. */
export function attachmentPreview(kind: MessageAttachment["kind"]): string {
  return kind === "image"
    ? "📷 Image"
    : kind === "pdf"
      ? "📄 Document"
      : kind === "voice"
        ? "🎤 Voice note"
        : "📎 Attachment";
}

/** The stored form of a new outgoing message — the shape the OLD app reads, so a
 *  message sent here renders there unchanged. The message type follows the first
 *  attachment where there is one. `createdAt` is added by the caller with a
 *  `serverTimestamp()`. */
export function messageWriteBody(input: {
  messageId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  threadType: "direct" | "group";
  attachments?: MessageAttachment[];
  replyTo?: MessageReply | null;
}): Record<string, unknown> {
  const attachments = input.attachments ?? [];
  const messageType = attachments.length ? attachments[0].kind : "text";
  const body: Record<string, unknown> = {
    messageId: input.messageId,
    threadType: input.threadType,
    threadId: input.conversationId,
    senderId: input.senderId,
    senderName: input.senderName,
    text: input.text,
    attachments: attachments.map(toStoredAttachment),
    messageType,
    type: messageType,
    readBy: [input.senderId],
  };
  if (input.replyTo) {
    /* The quote is denormalised and capped, exactly as the old app wrote it, so
       it stays readable without loading the original. */
    body.replyTo = {
      messageId: input.replyTo.messageId,
      senderName: input.replyTo.senderName,
      text: input.replyTo.text.slice(0, 120),
    };
  }
  return body;
}

/** Count of messages in a loaded set that are unread FOR ME: not mine, and my id
 *  is not yet in `readBy`. The rule the old list applied, lifted out so the list
 *  and the badge cannot disagree. */
export function unreadIn(
  messages: { senderId: string; readBy: string[] }[],
  me: string,
): number {
  return messages.filter((m) => m.senderId !== me && !m.readBy.includes(me))
    .length;
}

/** Trailing debounce with a `cancel`. Realtime snapshots arrive in bursts — a
 *  send writes the message AND bumps the parent, and a batch read-receipt fires
 *  once per message — so the refresh they drive is coalesced into one. */
export function debounce(
  fn: () => void,
  ms: number,
): (() => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
  run.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return run;
}
