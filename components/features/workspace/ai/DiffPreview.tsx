"use client";

import { wordDiff } from "@/lib/rules/workspace/ai/diff";

/**
 * Before/after, rendered inline — struck-through removals, underlined
 * additions, unchanged text plain. This is the thing a person actually reads
 * before deciding whether a rewrite is safe to apply; a preview that just
 * showed the new text next to the old one makes them re-read both in full to
 * find what changed.
 */
export function DiffPreview({ before, after }: { before: string; after: string }) {
  const ops = wordDiff(before, after);
  return (
    <p className="text-[13px] leading-relaxed text-ink">
      {ops.map((op, i) => {
        if (op.kind === "same") return <span key={i}>{op.text}</span>;
        if (op.kind === "remove")
          return (
            <span
              key={i}
              className="bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)] text-[var(--state-overdue-ink)] line-through"
            >
              {op.text}
            </span>
          );
        return (
          <span
            key={i}
            className="bg-[color-mix(in_srgb,var(--state-positive)_22%,transparent)] text-[var(--state-positive-ink)] underline decoration-1 underline-offset-2"
          >
            {op.text}
          </span>
        );
      })}
    </p>
  );
}
