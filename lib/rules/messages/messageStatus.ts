import type { EmployeeId } from "@/lib/domain";

/**
 * How far one of your own messages has got: sent, delivered, or read.
 *
 * The three states everybody already knows from every messaging product, and
 * the reason they are worth having is that the two failure modes look identical
 * without them. A message nobody has answered might be one they have not seen,
 * or one they have read and ignored — and those call for completely different
 * next actions. A tick is the cheapest possible way to tell them apart.
 *
 * ## Why this is derived rather than stored
 *
 * There is no `status` field anywhere, and there must not be one. Status is a
 * fact about the RECIPIENTS at the moment you look, not about the message: the
 * same message is "delivered" to one member of a group and "read" by another,
 * and it changes without the message being touched. Storing it would mean the
 * sender writing a field about somebody else's behaviour, which is both a lie
 * waiting to happen and a permission the rules should never grant.
 *
 * So it is computed from two things the recipients own:
 *
 *  · **`readBy`** — already on every message, written by the reader when they
 *    open the thread. This is the blue tick, and it is exact.
 *  · **`deliveredAt`** — a per-person timestamp on the CONVERSATION, stamped by
 *    each participant's own client while it is live. A message is delivered to
 *    somebody if their client was live at or after the moment it was written.
 *
 * ## Why delivery is a conversation stamp and not a per-message flag
 *
 * The obvious design is an array on each message, mirroring `readBy`. It costs
 * one write per message per recipient — 173 writes to open one of the threads
 * this product already has — and it only records anything while that person has
 * that exact conversation open, which is not what "delivered" means. One stamp
 * per conversation costs a single write per session, is updated by the watcher
 * already running app-wide, and answers for every message in the thread at once.
 *
 * The trade is honest: this cannot distinguish "their app received it" from
 * "their app was running and would have received it". Nothing a client can
 * observe distinguishes those either.
 */

export type MessageStatus = "sent" | "delivered" | "read";

export interface MessageStatusInput {
  /** When the message was written. */
  createdAt: string;
  /** Who has opened the thread since — `readBy` from the message document. */
  readBy: readonly EmployeeId[];
  /**
   * Everyone the message is FOR: the conversation's participants without its
   * sender. Empty for a thread with nobody else in it.
   */
  recipientIds: readonly EmployeeId[];
  /**
   * Each participant's "my client was live at" stamp, from the conversation.
   * Missing, or missing an entry, simply means not yet delivered to them.
   */
  deliveredAt: Readonly<Record<string, string | null | undefined>> | undefined;
}

/** Milliseconds, or null where the value is absent or unparseable. */
function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * The status of one of your own messages.
 *
 * **Every recipient, not any recipient.** A group message is read when everyone
 * has read it, matching the convention every other messaging product uses — a
 * blue tick that appears once the first of nine people has looked is worse than
 * no tick, because it says the thing the reader most wants to know and says it
 * wrongly.
 *
 * Never call this for somebody else's message. Their copy has ticks for them,
 * and what you would compute is whether YOU have read it, which you plainly
 * have — the caller decides this, since only it knows who is looking.
 */
export function messageStatus(input: MessageStatusInput): MessageStatus {
  /* Nobody to deliver to — a thread with one person in it, or participants that
     could not be resolved. "Sent" is the only claim that is definitely true. */
  if (input.recipientIds.length === 0) return "sent";

  const readers = new Set(input.readBy);
  if (input.recipientIds.every((id) => readers.has(id))) return "read";

  const sentAt = ms(input.createdAt);
  /* A message with no readable timestamp cannot be compared against a delivery
     stamp. It is sent; claiming more would be a guess. */
  if (sentAt === null) return "sent";

  const delivered = input.deliveredAt ?? {};
  const reached = (id: EmployeeId): boolean => {
    const at = ms(delivered[id]);
    return at !== null && at >= sentAt;
  };
  /* `>=` rather than `>`: a client that stamps delivery in the same millisecond
     the message lands has received it. Strictly-after would drop exactly the
     case where both people are online, which is the common one. */
  if (input.recipientIds.every(reached)) return "delivered";

  return "sent";
}

/**
 * Which conversations this viewer should stamp a fresh delivery time on.
 *
 * Only the ones where it would change an answer: a conversation whose newest
 * message is older than our existing stamp is already fully delivered, and
 * writing again would cost a round trip to say the same thing.
 *
 * That is also what stops the obvious loop. The stamp lives on the conversation
 * document, the document is watched, and the watcher refreshes this list — so an
 * unconditional write would trigger a read that triggers a write. Narrowing to
 * "something arrived since last time" makes the second pass a no-op and the loop
 * terminates after one.
 */
export function conversationsNeedingDelivery(
  conversations: readonly {
    id: string;
    lastMessageAt?: string | null;
    deliveredAt?: Readonly<Record<string, string | null | undefined>>;
  }[],
  me: EmployeeId,
): string[] {
  return conversations
    .filter((c) => {
      const last = ms(c.lastMessageAt);
      /* Nothing has ever been said here, so there is nothing to have received. */
      if (last === null) return false;
      const mine = ms(c.deliveredAt?.[me]);
      return mine === null || mine < last;
    })
    .map((c) => c.id);
}
