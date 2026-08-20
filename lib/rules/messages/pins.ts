/**
 * Pinning messages to the top of a conversation — the rule, held apart from
 * the two stores that apply it.
 *
 * A pin is the THREAD's bookmark where a star is a person's: everyone in the
 * conversation sees the same pinned banner, and any participant may pin or
 * unpin. The list is capped — a board of forty pins is a second conversation
 * nobody reads — and the cap refusal is worded here once so both stores and
 * the help corpus say the same sentence.
 */
import type { PinnedMessage } from "../../domain/work.ts";

/** How many messages one conversation may hold pinned at once. */
export const MAX_PINNED_MESSAGES = 5;

/** The quoted snippet a pin carries — the same cap a reply quote uses. */
export const PIN_TEXT_LIMIT = 120;

export const PIN_CAP_REFUSAL = `Up to ${MAX_PINNED_MESSAGES} messages can be pinned in a conversation. Unpin one first.`;

export type PinVerdict =
  | { ok: true; pins: PinnedMessage[] }
  | { ok: false; refusal: string };

/**
 * The pin list after adding one, oldest pin first.
 *
 * Pinning a message that is already pinned is answered with the list unchanged
 * rather than refused — "make this pinned" is already true, and an error for a
 * done thing is noise. The cap is the one real refusal.
 */
export function withPin(
  pins: readonly PinnedMessage[],
  pin: PinnedMessage,
): PinVerdict {
  if (pins.some((p) => p.messageId === pin.messageId))
    return { ok: true, pins: [...pins] };
  if (pins.length >= MAX_PINNED_MESSAGES)
    return { ok: false, refusal: PIN_CAP_REFUSAL };
  return {
    ok: true,
    pins: [...pins, { ...pin, text: pin.text.slice(0, PIN_TEXT_LIMIT) }],
  };
}

/** The pin list without one message. Unpinning what is not pinned is a no-op. */
export function withoutPin(
  pins: readonly PinnedMessage[],
  messageId: string,
): PinnedMessage[] {
  return pins.filter((p) => p.messageId !== messageId);
}

/** Whether a message is currently pinned. */
export function isPinned(
  pins: readonly PinnedMessage[] | undefined,
  messageId: string,
): boolean {
  return (pins ?? []).some((p) => p.messageId === messageId);
}
