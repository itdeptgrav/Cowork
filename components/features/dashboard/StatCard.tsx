"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icons";
import { InlineError, SkeletonRows } from "@/components/ui/Primitives";

/**
 * The compact figure card — the reference's Income and Expense pair.
 *
 * Its anatomy there is exact and worth keeping: a small muted label, one large
 * figure, a caption line beneath, and a pill at the top right carrying the
 * movement. Two of them stack in the middle column at about a third of the
 * hero's height, which is what makes the hero read as the hero.
 *
 * One figure per card, and the caption is the only place a sentence is allowed.
 * Anything that needs two figures needs two cards, or a different card.
 */
export function StatCard({
  label,
  value,
  caption,
  pill,
  tone = "plain",
  href,
  hrefLabel,
  loading = false,
  error = null,
  onRetry,
  mark,
}: {
  label: string;
  value: string;
  caption?: ReactNode;
  /** The movement, top right. Short: a delta, a count, a state. */
  pill?: { text: string; tone?: "up" | "down" | "warn" | "quiet" };
  /**
   * `tinted` gives the card a wash, as the reference gives its Income card.
   * Reserved for the one card in the pair that carries the better news, so the
   * tint stays meaningful.
   */
  tone?: "plain" | "tinted";
  href?: string;
  hrefLabel?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** A small dot before the caption — health, state, presence. */
  mark?: string;
}) {
  const body = (
    <>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 truncate text-xs text-ink-muted">
          {label}
        </p>
        {pill && !loading && !error && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              pill.tone === "up"
                ? "bg-[color-mix(in_srgb,var(--state-positive)_20%,transparent)] text-[var(--state-positive-ink)]"
                : pill.tone === "down"
                  ? "bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)] text-[var(--state-overdue-ink)]"
                  : pill.tone === "warn"
                    ? "bg-[color-mix(in_srgb,var(--state-risk)_24%,transparent)] text-[var(--state-risk-ink)]"
                    : "bg-[var(--control)] text-ink-muted"
            }`}
          >
            <span data-figure>{pill.text}</span>
          </span>
        )}
        {href && (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-faint transition-colors group-hover:bg-[var(--control)] group-hover:text-ink">
            <Icon.chevronRight className="h-3 w-3" />
          </span>
        )}
      </div>

      {error ? (
        <div className="mt-3">
          <InlineError compact message={error} onRetry={onRetry} />
        </div>
      ) : loading ? (
        <div className="mt-3">
          <SkeletonRows rows={2} />
        </div>
      ) : (
        <>
          <p
            data-figure
            className="mt-2 text-[clamp(1.75rem,2.6vw,2.25rem)] leading-none font-light tracking-[-0.035em] text-ink"
          >
            {value}
          </p>
          {caption && (
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
              {mark && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: mark }}
                />
              )}
              <span className="min-w-0 truncate">{caption}</span>
            </p>
          )}
        </>
      )}
    </>
  );

  const shell = `frost-panel flex min-h-[116px] flex-col justify-center rounded-card px-5 py-4 ${
    tone === "tinted"
      ? "bg-[color-mix(in_srgb,var(--state-positive)_10%,var(--frost-panel))]"
      : ""
  }`;

  return href ? (
    <Link
      href={href}
      aria-label={hrefLabel ?? label}
      className={`group ${shell} transition-colors hover:bg-[var(--row-hover)]`}
    >
      {body}
    </Link>
  ) : (
    <section aria-label={label} className={shell}>
      {body}
    </section>
  );
}
