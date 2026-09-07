import type { MessageAttachment, StoredMeetingMessage } from "@/lib/domain";
import type { CoworkRepository } from "@/lib/repositories/types";
import { attachmentKind } from "@/lib/rules/messages/attachmentKind";
import { isPersistableMeetId } from "@/lib/rules/meetings/mergeChat";
import { putToSession } from "@/lib/legacy/driveUpload";

/**
 * The persistence + upload seam under the meeting-chat panel.
 *
 * ## Why an adapter and not a repository call in the component
 *
 * The one chat panel is rendered in two rooms. A signed-in employee reaches the
 * ledger through the `CoworkRepository` (a Firebase token on every call); a
 * guest has no such token and reaches the SAME ledger through routes gated by
 * the `guestSessionId` they were issued at the door — exactly how a guest already
 * uploads their audio. Rather than teach the component both, each room hands it
 * one of these, and the component only ever calls `list` / `record` / `upload`.
 *
 * ## Delivery is not here
 *
 * A meeting message is delivered by LiveKit's data channel, instantly and for
 * guests too. This is the LEDGER written underneath it: `record` saves what was
 * said so a refresh does not lose it, `list` reads it back. If any of it fails
 * or is absent, chat still works exactly as it did before — the panel checks
 * `canPersist` and simply stays ephemeral without it.
 */
export interface ChatLedger {
  /** History survives a refresh and late joiners can read it. False for a task
      room (its id is refused by the engine) and when the backend lacks the
      method — the panel stays ephemeral, as it was. */
  readonly canPersist: boolean;
  /** Files can be attached. Employees always; a guest through the guest routes. */
  readonly canUpload: boolean;
  /** A page of stored history, oldest-last. Empty (never throws) when there is
      nothing, or the meeting cannot persist. */
  list(opts: {
    beforeMs?: number;
    afterMs?: number;
    limit?: number;
  }): Promise<{ messages: StoredMeetingMessage[]; hasMore: boolean }>;
  /** Save a message the data channel has ALREADY delivered, keyed by its LiveKit
      stream id so a retry is idempotent. Resolves true on success. */
  record(input: {
    messageId: string;
    text: string;
    attachments?: MessageAttachment[];
  }): Promise<boolean>;
  /** Upload one file straight to Drive (browser → Google, any size) and return
      what it takes to render it, or null on failure. */
  upload(
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<MessageAttachment | null>;
}

/** A ledger that persists nothing — the honest shape for a task room or a
    backend without the methods. Chat stays live-only. */
export function ephemeralLedger(): ChatLedger {
  return {
    canPersist: false,
    canUpload: false,
    async list() {
      return { messages: [], hasMore: false };
    },
    async record() {
      return false;
    },
    async upload() {
      return null;
    },
  };
}

/** The signed-in path: through the repository, with a Firebase token on every
    call. `listMeetingMessages` / `recordMeetingMessage` are OPTIONAL on the
    repository — a backend without them yields a non-persisting ledger. */
export function employeeLedger(
  repo: CoworkRepository,
  meetId: string,
): ChatLedger {
  const persistable =
    isPersistableMeetId(meetId) &&
    typeof repo.listMeetingMessages === "function" &&
    typeof repo.recordMeetingMessage === "function";

  return {
    canPersist: persistable,
    canUpload: typeof repo.uploadMessageAttachment === "function",
    async list(opts) {
      if (!persistable || !repo.listMeetingMessages) {
        return { messages: [], hasMore: false };
      }
      try {
        return await repo.listMeetingMessages(meetId, opts);
      } catch {
        /* History is a nicety layered on live chat: a read that fails leaves the
           channel messages on screen rather than emptying the panel. */
        return { messages: [], hasMore: false };
      }
    },
    async record(input) {
      if (!persistable || !repo.recordMeetingMessage) return false;
      try {
        const r = await repo.recordMeetingMessage({ meetingId: meetId, ...input });
        return r.ok;
      } catch {
        return false;
      }
    },
    async upload(file, onProgress) {
      if (!repo.uploadMessageAttachment) return null;
      try {
        const r = await repo.uploadMessageAttachment(file, onProgress);
        return r.ok ? r.data : null;
      } catch {
        return null;
      }
    },
  };
}

/** The base the guest routes live under. Same env var the guest audio upload
    and the media proxy read, so all three agree about where the engine is. */
function guestBase(): string {
  return (process.env.NEXT_PUBLIC_LEGACY_API_URL ?? "").replace(/\/+$/, "");
}

/** The guest path: the SAME ledger, reached through routes gated by the
    `guestSessionId` issued at join instead of a Firebase token. */
export function guestLedger(
  meetId: string,
  guestSessionId: string,
): ChatLedger {
  const persistable = isPersistableMeetId(meetId) && !!guestSessionId;
  const base = guestBase();

  return {
    canPersist: persistable,
    canUpload: persistable,
    async list(opts) {
      if (!persistable) return { messages: [], hasMore: false };
      const qs = new URLSearchParams({ guestSessionId });
      if (opts.beforeMs) qs.set("beforeMs", String(opts.beforeMs));
      if (opts.afterMs) qs.set("afterMs", String(opts.afterMs));
      if (opts.limit) qs.set("limit", String(opts.limit));
      try {
        const res = await fetch(
          `${base}/cowork/schedule-meet/${encodeURIComponent(meetId)}/guest-messages?${qs.toString()}`,
        );
        if (!res.ok) return { messages: [], hasMore: false };
        const data = (await res.json()) as {
          messages?: unknown[];
          hasMore?: boolean;
        };
        const rows = Array.isArray(data.messages) ? data.messages : [];
        return {
          messages: rows
            .map(readStoredRow)
            .filter((m): m is StoredMeetingMessage => m !== null),
          hasMore: data.hasMore === true,
        };
      } catch {
        return { messages: [], hasMore: false };
      }
    },
    async record(input) {
      if (!persistable) return false;
      try {
        const res = await fetch(
          `${base}/cowork/schedule-meet/${encodeURIComponent(meetId)}/guest-messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guestSessionId,
              messageId: input.messageId,
              text: input.text,
              attachments: input.attachments ?? [],
            }),
          },
        );
        return res.ok;
      } catch {
        return false;
      }
    },
    async upload(file, onProgress) {
      if (!persistable) return null;
      try {
        /* 1 — open a resumable session (no bytes). Gated by the guest session. */
        const sessionRes = await fetch(
          `${base}/cowork/upload/guest/drive-session`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guestSessionId,
              meetId,
              fileName: file.name || "upload.bin",
              mimeType: file.type || "application/octet-stream",
              fileSize: file.size,
            }),
          },
        );
        if (!sessionRes.ok) return null;
        const { sessionUrl } = (await sessionRes.json()) as {
          sessionUrl?: string;
        };
        if (!sessionUrl) return null;

        /* 2 — the BROWSER streams the bytes straight to Google. Same resumable
           transfer the signed-in path uses (progress, stall recovery, any
           size); only the two metadata calls differ. */
        const put = await putToSession(sessionUrl, file, onProgress);
        if ("expired" in put || !put.ok) return null;

        /* 3 — finalize: make it readable and read back its metadata. */
        const finRes = await fetch(
          `${base}/cowork/upload/guest/drive-finalize`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guestSessionId, meetId, fileId: put.data.id }),
          },
        );
        if (!finRes.ok) return null;
        const d = (await finRes.json()) as Record<string, unknown>;
        return toAttachment(d, file, put.data.id);
      } catch {
        return null;
      }
    },
  };
}

/** A finalize response → the inline attachment the thread renders. Mirrors what
    the repository's `uploadMessageAttachment` builds for the signed-in path. */
function toAttachment(
  d: Record<string, unknown>,
  file: File,
  fallbackId: string,
): MessageAttachment {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;
  const name = str(d.fileName) ?? str(d.name) ?? file.name ?? null;
  const mime = str(d.mimeType) ?? file.type ?? "";
  return {
    url: str(d.url) ?? str(d.thumbnailUrl) ?? str(d.viewUrl) ?? "",
    kind: attachmentKind(name, mime),
    name,
    sizeBytes: Number(d.size ?? d.sizeBytes) || file.size || null,
    durationSecs: null,
    fileId: str(d.fileId) ?? fallbackId ?? null,
  };
}

/** One raw row from the guest history route → a `StoredMeetingMessage`, or null
    if it carries no id. Defensive because it crosses the network as JSON. */
function readStoredRow(raw: unknown): StoredMeetingMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const messageId = typeof r.messageId === "string" ? r.messageId : "";
  if (!messageId) return null;
  const atts = Array.isArray(r.attachments) ? r.attachments : [];
  return {
    messageId,
    senderId: typeof r.senderId === "string" ? r.senderId : "",
    senderName: typeof r.senderName === "string" ? r.senderName : "",
    senderKind: r.senderKind === "guest" ? "guest" : "employee",
    text: typeof r.text === "string" ? r.text : "",
    attachments: atts.filter(
      (a): a is MessageAttachment => !!a && typeof a === "object",
    ),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    createdAtMs: Number(r.createdAtMs) || 0,
  };
}
