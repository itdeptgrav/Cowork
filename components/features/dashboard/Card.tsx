"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icons";

/**
 * A dashboard card, from the `dashboard` reference.
 *
 * Its anatomy there is fixed and worth keeping literally: a title top-left at
 * a generous weight, a circular menu affordance top-right, then the card's own
 * content. Cards are frosted panels — Cowork's existing material — at an 18px
 * radius, which sits between the hero slab (28) and an inset (14) and matches
 * the reference's own corner.
 *
 * The reference's `…` opens a per-widget menu. Cowork has no widget system, so
 * that affordance becomes a single named link out to the surface the card
 * summarises: an icon that says "there is more of this elsewhere" without
 * pretending to a configurability the product does not have.
 */
export function Card({
  title,
  href,
  hrefLabel,
  children,
  className = "",
  headerRight,
  padded = true,
}: {
  title: string;
  /** Where the card's subject lives in full. */
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
  className?: string;
  /** Extra controls on the title row, left of the link. */
  headerRight?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={`frost-panel flex flex-col rounded-card ${className}`}
    >
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <h2 className="min-w-0 truncate text-[17px] leading-none font-medium tracking-[-0.02em] text-ink">
          {title}
        </h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {headerRight}
          {href && (
            <Link
              href={href}
              aria-label={hrefLabel ?? `Open ${title}`}
              title={hrefLabel ?? `Open ${title}`}
              className="grid h-7 w-7 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
            >
              <Icon.chevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
      <div
        className={`flex min-h-0 flex-1 flex-col ${padded ? "px-5 pb-4" : "pb-4"}`}
      >
        {children}
      </div>
    </section>
  );
}

/* ── Shared card furniture ────────────────────────────────────────────────── */

/** A big headline figure with an optional trend pill, per the reference's B card. */
export function Headline({
  value,
  delta,
  unit,
}: {
  value: string;
  delta?: number;
  unit?: string;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-2.5">
      <span
        data-figure
        className="text-[clamp(2rem,3.2vw,2.75rem)] leading-none font-light tracking-[-0.035em] text-ink"
      >
        {value}
      </span>
      {unit && <span className="text-xs text-ink-muted">{unit}</span>}
      {delta !== undefined && (
        <span
          data-figure
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            delta >= 0
              ? "bg-[color-mix(in_srgb,var(--state-positive)_20%,transparent)] text-[var(--state-positive-ink)]"
              : "bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)] text-[var(--state-overdue-ink)]"
          }`}
          aria-label={`${delta >= 0 ? "up" : "down"} ${Math.abs(delta)} against the previous period`}
        >
          <span aria-hidden="true">{delta >= 0 ? "▲" : "▼"}</span>
          {Math.abs(delta)}
        </span>
      )}
    </p>
  );
}

/**
 * A named row with a value and a proportional bar — the reference's Gross
 * Volume breakdown. The bar carries the halftone screen Cowork already uses on
 * the component band, which is also what the reference's hatched bars do.
 */
export function BarRow({
  label,
  value,
  percent,
  hue,
  sub,
  href,
}: {
  label: ReactNode;
  value: string;
  percent: number;
  hue: string;
  sub?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-ink-muted">{label}</span>
        <span data-figure className="shrink-0 text-sm text-ink">
          {value}
        </span>
      </span>
      <span className="mt-1.5 block h-[6px] overflow-hidden rounded-full bg-[var(--control-active)]">
        <span
          className="band-fill block h-full rounded-full"
          style={{
            width: `${Math.max(2, Math.min(100, percent))}%`,
            backgroundColor: hue,
          }}
        />
      </span>
      {sub && (
        <span className="mt-1 block truncate text-[11px] text-ink-faint">
          {sub}
        </span>
      )}
    </>
  );

  return href ? (
    <Link
      href={href}
      className="-mx-2 block rounded-inset px-2 py-1.5 transition-colors hover:bg-[var(--row-hover)]"
    >
      {body}
    </Link>
  ) : (
    <div className="py-1.5">{body}</div>
  );
}

/** A compact inline action. Named verbs, never a bare chevron. */
export function Action({
  href,
  onClick,
  children,
  icon,
  tone = "quiet",
  disabled,
  title,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  icon?: IconName;
  tone?: "quiet" | "strong";
  disabled?: boolean;
  title?: string;
}) {
  const Ico = icon ? Icon[icon] : null;
  const cls = `inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-45 ${
    tone === "strong"
      ? "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)]"
      : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
  }`;
  if (href) {
    return (
      <Link href={href} className={cls} title={title}>
        {Ico && <Ico className="h-3 w-3" />}
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cls}
    >
      {Ico && <Ico className="h-3 w-3" />}
      {children}
    </button>
  );
}
