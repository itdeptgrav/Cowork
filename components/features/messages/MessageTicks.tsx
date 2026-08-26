import type { MessageStatus } from "@/lib/rules/messages/messageStatus";

/**
 * The delivery ticks, in the shape everybody already reads without being told.
 *
 * One tick, two ticks, two blue — the convention every messaging product shares,
 * so it needs no legend. Drawn as one SVG rather than two glyphs: a pair of "✓"
 * characters sit at whatever spacing the font decides, which on some faces reads
 * as one thick mark and on others as two unrelated ticks.
 *
 * **Shared, because the task discussion draws them too.** It had a pair of
 * literal "✓✓" characters in green — a third convention, in a colour that means
 * "positive" everywhere else in the product, for a state that is not a success.
 * One component means the two surfaces cannot disagree about what a tick looks
 * like or when it turns.
 *
 * The `label` is overridable because the two surfaces mean different things by
 * the middle state. A direct message has one recipient, so `delivered` is
 * literally "it reached their device". A task has several, and the same two grey
 * ticks mean "some of them have read it" — see `taskChatStatus`. Same picture,
 * honest words for each.
 */
export function MessageTicks({
  status,
  label,
}: {
  status: MessageStatus;
  /** What this state means here. Defaults to the direct-message wording. */
  label?: string;
}) {
  const read = status === "read";
  const double = status !== "sent";
  const said =
    label ??
    (status === "read" ? "Read" : status === "delivered" ? "Delivered" : "Sent");

  return (
    <span
      role="img"
      aria-label={said}
      title={said}
      className="ms-1 inline-flex shrink-0 align-[-1px]"
      /* Only the read state takes a colour. The other two inherit whatever the
         timestamp beside them is using, so they stay as quiet as the time. */
      style={{ color: read ? "var(--state-read)" : undefined }}
    >
      <svg
        width={double ? 15 : 10}
        height="10"
        viewBox={double ? "0 0 15 10" : "0 0 10 10"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M1 5.5 L3.6 8.2 L8.8 1.8" />
        {/* The second tick, set behind and to the right so the two read as a
            pair rather than as one thick mark. */}
        {double && <path d="M6.2 5.5 L8.8 8.2 L14 1.8" />}
      </svg>
    </span>
  );
}
