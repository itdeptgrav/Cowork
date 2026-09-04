"use client";

import { mentionSegments } from "@/lib/rules/messages/mentions";

/**
 * Message text with @-mentions highlighted.
 *
 * The `@DisplayName` tokens live in the text; `mentionTokens` names which runs
 * are real mentions (built from the message's `mentionIds` and the local people
 * map by the caller), so a stray "@" in prose is never highlighted. With no
 * tokens it renders the text unchanged, which is every message that mentions
 * nobody — the common case, and one allocation.
 */
export function MessageText({
  text,
  mentionTokens,
}: {
  text: string;
  mentionTokens?: readonly string[];
}) {
  const tokens = mentionTokens ?? [];
  if (tokens.length === 0) return <>{text}</>;
  const segments = mentionSegments(text, tokens);
  return (
    <>
      {segments.map((s, i) =>
        s.mention ? (
          <span
            key={i}
            className="rounded-[3px] bg-[color-mix(in_srgb,var(--accent,#1a73e8)_16%,transparent)] px-0.5 font-medium text-ink"
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** The `@DisplayName` tokens for a message, from its mention ids and a
 *  name lookup. Empty (so `MessageText` renders plain) when nothing is
 *  mentioned or a name cannot be resolved. */
export function mentionTokensFor(
  mentionIds: readonly string[] | undefined,
  nameOf: (id: string) => string | undefined,
): string[] {
  if (!mentionIds || mentionIds.length === 0) return [];
  const out: string[] = [];
  for (const id of mentionIds) {
    const name = nameOf(id);
    if (name) out.push(`@${name}`);
  }
  return out;
}
