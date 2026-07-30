"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/features/dashboard/Card";
import { QueryError, Skeleton } from "@/components/ui/Primitives";

/**
 * Shared furniture for the monitoring panels.
 *
 * Built on the dashboard's `Card` rather than beside it, so the monitoring
 * surface inherits the card material, radius, heading size and link affordance
 * the rest of the product already uses. The only thing added here is the state
 * machine every panel needs: six independent feeds mean six independent ways to
 * be loading, empty or broken, and writing that out per panel is how a page
 * ends up with three different opinions about what a failure looks like.
 */

export function MonitorCard({
  title,
  href,
  hrefLabel,
  headerRight,
  /** Any query this panel depends on. A failure in one shows the retry. */
  queries = [],
  loading = false,
  /** What to say when the feed answered and had nothing. */
  empty,
  children,
  className = "",
  errorMessage = "This feed could not be read.",
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  headerRight?: ReactNode;
  queries?: { error: string | null; refetch: () => void }[];
  loading?: boolean;
  empty?: { when: boolean; title: string; body?: string };
  children: ReactNode;
  className?: string;
  errorMessage?: string;
}) {
  const failed = queries.some((q) => q.error);

  return (
    <Card
      title={title}
      href={href}
      hrefLabel={hrefLabel}
      headerRight={headerRight}
      className={className}
    >
      {failed ? (
        <QueryError queries={queries} message={errorMessage} compact />
      ) : loading ? (
        <PanelSkeleton />
      ) : empty?.when ? (
        <div className="py-6">
          <p className="text-sm font-medium text-ink">{empty.title}</p>
          {empty.body && (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {empty.body}
            </p>
          )}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2.5 py-1.5" role="status" aria-label="Loading">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-3.5 w-1/2" />
      <Skeleton className="h-3.5 w-3/5" />
    </div>
  );
}

/** A label/value pair on one line. The monitoring page's densest unit. */
export function Fact({
  label,
  value,
  tone = "default",
  title,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "muted" | "alert" | "positive";
  title?: string;
}) {
  const ink =
    tone === "alert"
      ? "text-[var(--state-overdue-ink)]"
      : tone === "positive"
        ? "text-[var(--state-positive-ink)]"
        : tone === "muted"
          ? "text-ink-muted"
          : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-xs ${ink}`}
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

/** A figure with its name underneath. Used in rows of three or four. */
export function Metric({
  label,
  value,
  unit,
  tone = "default",
}: {
  label: string;
  value: string;
  unit?: string | null;
  tone?: "default" | "alert" | "positive";
}) {
  const ink =
    tone === "alert"
      ? "text-[var(--state-overdue-ink)]"
      : tone === "positive"
        ? "text-[var(--state-positive-ink)]"
        : "text-ink";
  return (
    <div className="min-w-0">
      <p className="flex items-baseline gap-1">
        <span
          data-figure
          className={`text-[22px] leading-none tracking-[-0.025em] ${ink}`}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-ink-faint">{unit}</span>}
      </p>
      <p className="mt-1.5 truncate text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}

/**
 * A trend line for a short trailing window.
 *
 * Neutral ink, never a channel hue: The Four Channels Rule reserves saturated
 * colour for C1–C4, and a productivity trend is a composite of all four.
 */
export function Sparkline({
  points,
  label,
  className = "",
}: {
  points: number[];
  label: string;
  className?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 100;
  const h = 28;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const lastX = w;
  const lastY = h - ((points[points.length - 1] - min) / span) * (h - 4) - 2;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`h-7 w-full ${className}`}
      role="img"
      aria-label={label}
    >
      <path
        d={d}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.7"
      />
      <circle cx={lastX} cy={lastY} r="1.6" fill="var(--color-ink)" />
    </svg>
  );
}

/** Elapsed seconds as `4h 12m`. Never `4.2h` — nobody reads a decimal hour. */
export function duration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** A time of day in the subject's own zone, so "their 4pm" reads correctly. */
export function clockTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}
