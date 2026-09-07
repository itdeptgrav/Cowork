/**
 * One conversation out of two transports.
 *
 * Meeting chat arrives twice: instantly on LiveKit's data channel, and durably
 * from the ledger the sender also wrote it to. Both carry the same identity —
 * the document id IS the LiveKit stream id — so this merges them into the one
 * list a reader sees.
 *
 * ## Which copy wins, and why it is the stored one
 *
 * The channel copy carries the SENDER'S clock. The stored copy carries the
 * server's. Clocks disagree — a laptop minutes fast is ordinary — and if the
 * sender's time decided the order, one person with a wrong clock would pin
 * their messages to the top or bottom of everybody else's conversation, and
 * the order would differ per reader.
 *
 * So the stored `createdAt` supersedes the channel's whenever both exist. The
 * channel copy is what makes a message appear instantly; the stored copy is
 * what makes everybody agree about when it happened.
 *
 * ## Why de-duplication cannot be "the last one wins"
 *
 * A message can arrive stored-first (history loaded after a refresh, then the
 * channel replays it) or channel-first (sent live, stored a moment later). Both
 * orders are normal. Keying on the id and merging FIELDS rather than replacing
 * the row is what makes the result the same either way.
 */

import type { MessageAttachment } from "@/lib/domain";

/**
 * Whether a meeting id can carry a saved chat.
 *
 * Mirrors `isRoomName` in the engine's `coworkMeetingChat.service.js`, on the
 * client, so the panel does not fire a write it knows will be refused. A task
 * room's LiveKit name is `meet-task-<taskId>` — a DERIVED string, not a
 * `cowork_scheduled_meets` document id — and the ledger refuses anything shaped
 * like one, because a row written under it would live under a parent that does
 * not exist: invisible to every query and to the retention sweep. A task
 * meeting therefore stays chat-as-before (LiveKit only), with no history and no
 * failed writes; a real meeting id persists.
 */
export function isPersistableMeetId(meetId: string | null | undefined): boolean {
  return typeof meetId === "string" && meetId.length > 0 && !/^meet-/.test(meetId);
}

/** How far a message has got. Only ever improves — see `betterStatus`. */
export type ChatDelivery =
  /** Written to the channel, not yet known to be stored. */
  | "sending"
  /** In the ledger. It survives a refresh. */
  | "sent"
  /** The store refused or could not be reached. It is queued, not lost. */
  | "failed";

export interface MergedChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  /** "guest" only where the ledger said so — a guest's name is self-typed. */
  senderKind: "employee" | "guest";
  text: string;
  attachments: MessageAttachment[];
  /** Milliseconds. The server's where there is one, the sender's otherwise. */
  createdAtMs: number;
  /** True once the ledger has confirmed it. */
  stored: boolean;
  delivery: ChatDelivery;
  mine: boolean;
}

/** What the data channel gives, normalised. */
export interface ChannelMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAtMs: number;
}

/** What the ledger gives, normalised. */
export interface StoredMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  senderKind: "employee" | "guest";
  text: string;
  attachments?: MessageAttachment[];
  createdAtMs: number;
}

/**
 * A status may improve but never regress.
 *
 * A late channel echo of a message already confirmed as stored must not drag it
 * back to "sending", and a retry that succeeds must clear a previous failure.
 */
export function betterStatus(a: ChatDelivery, b: ChatDelivery): ChatDelivery {
  const rank: Record<ChatDelivery, number> = { failed: 0, sending: 1, sent: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * The list a reader sees.
 *
 * `failedIds` are messages whose ledger write is known to have failed; they
 * still render, marked, because a message that vanished is the bug this whole
 * feature exists to end.
 */
export function mergeChat(input: {
  channel: ChannelMessage[];
  stored: StoredMessage[];
  meId: string;
  failedIds?: string[];
}): MergedChatMessage[] {
  const failed = new Set(input.failedIds ?? []);
  const byId = new Map<string, MergedChatMessage>();

  /* Channel first, so a message appears the instant it is spoken. */
  for (const c of input.channel) {
    if (!c.id) continue;
    byId.set(c.id, {
      id: c.id,
      senderId: c.senderId,
      senderName: c.senderName,
      senderKind: "employee",
      text: c.text,
      attachments: [],
      createdAtMs: c.createdAtMs,
      stored: false,
      delivery: failed.has(c.id) ? "failed" : "sending",
      mine: !!c.senderId && c.senderId === input.meId,
    });
  }

  /* Then the ledger, which supersedes the sender's clock and adds anything the
     channel never carried — attachments, and every message sent before this
     reader joined. */
  for (const s of input.stored) {
    if (!s.messageId) continue;
    const existing = byId.get(s.messageId);
    byId.set(s.messageId, {
      id: s.messageId,
      senderId: s.senderId,
      /* The channel's name is the live participant's; the stored one is what
         they were called when they said it. Prefer the live one where we have
         it, so a rename does not leave old bubbles under an old name. */
      senderName: existing?.senderName || s.senderName,
      senderKind: s.senderKind === "guest" ? "guest" : "employee",
      text: s.text,
      attachments: Array.isArray(s.attachments) ? s.attachments : [],
      createdAtMs: s.createdAtMs || existing?.createdAtMs || 0,
      stored: true,
      delivery: betterStatus(existing?.delivery ?? "sent", "sent"),
      mine: !!s.senderId && s.senderId === input.meId,
    });
  }

  /* Oldest first. Ties broken by id so the order is total and identical for
     every reader — two messages CAN share a server timestamp. */
  return [...byId.values()].sort(
    (a, b) => a.createdAtMs - b.createdAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * The instant to ask the ledger for anything newer than.
 *
 * Deliberately the newest STORED message, not the newest message on screen: a
 * channel message that has not been confirmed yet must still come back from the
 * server, or a reader who was offline while it was written would never see the
 * confirmed copy.
 *
 * Zero when nothing is stored, which asks for the most recent page instead.
 */
export function newestStoredMs(merged: MergedChatMessage[]): number {
  let newest = 0;
  for (const m of merged) {
    if (m.stored && m.createdAtMs > newest) newest = m.createdAtMs;
  }
  return newest;
}

/**
 * The instant to page backwards from — the oldest stored message.
 *
 * Cursors on the server are INCLUSIVE, because a server timestamp is not
 * unique and an exclusive cursor silently drops every row sharing the boundary
 * instant. The overlap that produces is removed by `mergeChat` keying on id.
 */
export function oldestStoredMs(merged: MergedChatMessage[]): number {
  let oldest = 0;
  for (const m of merged) {
    if (m.stored && (oldest === 0 || m.createdAtMs < oldest)) oldest = m.createdAtMs;
  }
  return oldest;
}
