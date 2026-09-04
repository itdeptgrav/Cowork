"use client";

import type { MessageCard } from "@/lib/domain";
import { Icon } from "@/components/ui/Icons";
import { pollVoterCount } from "@/lib/rules/messages/card";

/**
 * Renders a message's structured `card` — a shared location, a shared contact,
 * or a poll — inside the bubble, for both the conversation thread and the task
 * chat. One component so the two surfaces cannot drift apart.
 *
 * `mine` tints the card to sit on the sender's own (accent) bubble the same way
 * the file card does; polls call `onVote` where the surface can persist a vote,
 * and render read-only where it cannot.
 */
export function MessageCardView({
  card,
  mine,
  viewerId,
  onVote,
}: {
  card: MessageCard;
  mine: boolean;
  /** The reader, so a poll can mark the options they picked. */
  viewerId?: string;
  /** Toggle the reader's vote on a poll option. Omitted → the poll is
   *  read-only (the surface has no vote method). */
  onVote?: (optionId: string) => void;
}) {
  const shell = mine ? "bg-white/15" : "bg-[var(--control)]";
  const chip = mine ? "bg-white/20" : "bg-[var(--surface-raised)]";

  if (card.kind === "location") {
    const query = `${card.lat},${card.lng}`;
    const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-3 rounded-[10px] p-2.5 hover:opacity-90 ${shell}`}
      >
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[8px] ${chip}`}>
          <Icon.location className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {card.label ?? "Shared location"}
          </span>
          <span className="mt-0.5 block text-[11px] opacity-60">
            {card.lat.toFixed(5)}, {card.lng.toFixed(5)} · Open in Maps
          </span>
        </span>
      </a>
    );
  }

  if (card.kind === "contact") {
    const lines: { label: string; href: string; text: string }[] = [];
    if (card.email) lines.push({ label: "Email", href: `mailto:${card.email}`, text: card.email });
    if (card.phone) lines.push({ label: "Call", href: `tel:${card.phone}`, text: card.phone });
    return (
      <div className={`flex flex-col gap-2 rounded-[10px] p-2.5 ${shell}`}>
        <div className="flex items-center gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${chip}`}>
            <Icon.contact className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{card.name}</span>
            {card.role && (
              <span className="mt-0.5 block truncate text-[11px] opacity-60">{card.role}</span>
            )}
          </span>
        </div>
        {lines.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-current/10 pt-2">
            {lines.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="flex items-center justify-between gap-2 text-[12px] hover:opacity-80"
              >
                <span className="opacity-60">{l.label}</span>
                <span className="truncate">{l.text}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* poll */
  const total = pollVoterCount(card.options);
  return (
    <div className={`flex flex-col gap-2 rounded-[10px] p-3 ${shell}`}>
      <div className="flex items-start gap-2">
        <Icon.poll className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
        <span className="text-sm font-medium leading-snug">{card.question}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {card.options.map((o) => {
          const count = o.votes.length;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const picked = Boolean(viewerId && o.votes.includes(viewerId));
          return (
            <button
              key={o.id}
              type="button"
              onClick={onVote ? () => onVote(o.id) : undefined}
              disabled={!onVote}
              aria-pressed={picked}
              className={`relative block w-full overflow-hidden rounded-[8px] px-2.5 py-1.5 text-left text-[13px] ${chip} ${
                onVote ? "hover:opacity-90" : "cursor-default"
              }`}
            >
              {/* The result bar — a fill behind the label, widening with share. */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-[8px] bg-[color-mix(in_srgb,var(--accent,#1a73e8)_22%,transparent)] transition-[width]"
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {picked && <Icon.check className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{o.text}</span>
                </span>
                <span className="shrink-0 tabular-nums opacity-70">{count}</span>
              </span>
            </button>
          );
        })}
      </div>
      <span className="text-[11px] opacity-60">
        {total} {total === 1 ? "vote" : "votes"} · {card.multiple ? "Choose one or more" : "Choose one"}
      </span>
    </div>
  );
}
