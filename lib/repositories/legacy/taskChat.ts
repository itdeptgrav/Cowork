import type { EmployeeId } from "../../domain/identity.ts";
import type { MessageAttachment, MessageReply } from "../../domain/work.ts";
import type { TaskChatMessage, TaskId } from "../../domain/tasks.ts";
import { attachmentKind } from "../../rules/messages/attachmentKind.ts";
/* One reader for reactions, shared with the message thread — the shape is
   identical and two copies of it is two places to drift. */
import { readReactions } from "./messaging.ts";

/**
 * A stored task-chat document, turned into a `TaskChatMessage`.
 *
 * **Split out of `listTaskChat` so it can be tested.** It was 86 lines inside a
 * `.map()` inside an async method that needs Firestore to reach — which meant
 * the one part with real decisions in it (what kind is this attachment, which
 * of two storage shapes is this, who has read it) was the part nothing could
 * exercise.
 *
 * ## Two shapes, one reader
 *
 * The subcollection `cowork_tasks/{taskId}/chat` is written by two
 * applications. This one writes `attachments: [{type, url, name, fileId, …}]`.
 * The older single-media path wrote flat `mediaUrl` / `pdfUrl` fields. Both are
 * normalised here so nothing downstream has to know which wrote a given row.
 *
 * ## Everything added for parity is OPTIONAL
 *
 * Reply, edit, delete, reactions, read receipts and stars are all absent from
 * every document written before they existed, and the older application still
 * writes rows without them. So each is read defensively and each has a
 * meaningful absent value — an unreacted message and one whose `reactions` map
 * was never written are the same message, and must read the same.
 */

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** A list of employee ids, from a field that may be anything at all. */
function ids(v: unknown): EmployeeId[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is EmployeeId => typeof x === "string" && x !== "");
}

/** The quoted message on a reply, where one was stored. */
export function readReplyTo(v: unknown): MessageReply | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const id = str(r.messageId) ?? str(r.id);
  if (!id) return null;
  return {
    messageId: id,
    senderName: str(r.senderName) ?? "",
    text: str(r.text) ?? "",
  };
}

/** Attachments, from either storage shape, normalised. */
export function readTaskChatAttachments(
  m: Record<string, unknown>,
  messageType: string,
): MessageAttachment[] {
  const raw: Record<string, unknown>[] = Array.isArray(m.attachments)
    ? (m.attachments as unknown[]).filter(
        (a): a is Record<string, unknown> => !!a && typeof a === "object",
      )
    : [];

  /* The older single-media shape, only where the array is absent — a row that
     has both would otherwise render its one media file twice. */
  if (!raw.length && (typeof m.mediaUrl === "string" || typeof m.pdfUrl === "string")) {
    if (typeof m.mediaUrl === "string")
      raw.push({
        type: messageType === "voice" ? "voice" : "image",
        url: m.mediaUrl,
        voiceDuration: m.voiceDuration,
      });
    if (typeof m.pdfUrl === "string")
      raw.push({ type: "pdf", url: m.pdfUrl, name: m.pdfFileName, fileId: m.pdfFileId });
  }

  return raw
    .map((o) => {
      const stored = typeof o.type === "string" ? o.type : "";
      const name = str(o.name);
      /**
       * **`video` was unreachable here.** This mapper accepted only
       * `image`, `pdf` and `voice` and filed everything else as `file`, so a
       * clip sent into a task discussion rendered as a paperclip row while the
       * identical clip in a direct message got a player. `attachmentKind` is
       * the same reader the message thread uses: it trusts a stated kind and
       * falls back to the filename, which also recovers every video already
       * stored as `file` before the kind existed.
       */
      const positive =
        stored === "image" || stored === "pdf" || stored === "voice" || stored === "video"
          ? (stored as MessageAttachment["kind"])
          : null;
      return {
        url: str(o.url) ?? "",
        kind: positive ?? attachmentKind(name, null),
        name,
        sizeBytes: typeof o.sizeBytes === "number" ? o.sizeBytes : null,
        durationSecs:
          typeof o.durationSecs === "number"
            ? o.durationSecs
            : typeof o.voiceDuration === "number"
              ? o.voiceDuration
              : null,
        fileId: str(o.fileId) ?? str(o.pdfFileId),
      } satisfies MessageAttachment;
    })
    .filter((a) => a.url || a.fileId);
}

export function readTaskChatMessage(
  taskId: TaskId,
  docId: string,
  m: Record<string, unknown>,
  createdAtIso: string,
): TaskChatMessage {
  const type = typeof m.messageType === "string" ? m.messageType : "text";
  const parsed = readTaskChatAttachments(m, type);
  const deleted = m.isDeleted === true;

  return {
    id: str(m.messageId) ?? docId,
    taskId,
    thread: "chat",
    senderId:
      type === "system"
        ? ("system" as const)
        : ((str(m.senderId) ?? "") as EmployeeId),
    senderName: str(m.senderName) ?? "",
    /* A tombstone carries no text and no files, whatever the document still
       holds — the row keeps its place and says only that it was deleted. */
    text: deleted ? "" : (str(m.text) ?? ""),
    attachmentIds: deleted ? [] : parsed.map((a) => a.url).filter(Boolean),
    attachments: deleted || !parsed.length ? undefined : parsed,
    messageType:
      type === "system"
        ? ("system" as const)
        : parsed.length && !deleted
          ? ("attachment" as const)
          : ("text" as const),
    createdAt: createdAtIso,

    replyToId: str(m.replyToId),
    replyTo: deleted ? null : readReplyTo(m.replyTo),
    editedAt: str(m.editedAt),
    isDeleted: deleted || undefined,
    readBy: ids(m.readBy),
    reactions: deleted ? undefined : readReactions(m.reactions),
    starredBy: ids(m.starredBy),
  };
}
