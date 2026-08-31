import { forwardRef } from "react";
import type { ReactNode } from "react";

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

/**
 * A frosted panel — the same material and corner as the dashboard's cards.
 *
 * The dashboard settled the card language: `frost-panel` at the 18px card
 * radius, with a 17px medium heading. `Panel` carries it to every other page,
 * so a task list, a score breakdown and a meeting all read as the same product
 * without any of them copying the dashboard's layout.
 */
export function Panel({
  children,
  className = "",
  style,
  padded = true,
  label,
  ...drag
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Tables and rails manage their own edges. */
  padded?: boolean;
  /**
   * Accessible name. An unnamed `<section>` is not exposed as a landmark, so a
   * screen-reader or keyboard user cannot jump between panels or skip one —
   * which on a dashboard of eleven panels is the difference between navigating
   * and tabbing through everything. Always pass it when the panel has a
   * heading; the value should match that heading.
   */
  label?: string;
} & /**
 * Drag-and-drop only, rather than the whole of `HTMLAttributes`.
 *
 * A panel is sometimes a drop target — a conversation takes files dropped
 * anywhere on it — and that needs four handlers on the `<section>` itself.
 * Spreading every DOM attribute instead would quietly turn this primitive into
 * a `div` with a border, and the constraint that it renders a LABELLED
 * `<section>` is the reason it exists.
 */
Pick<
    React.HTMLAttributes<HTMLElement>,
    "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
  >) {
  return (
    <section
      aria-label={label}
      className={`frost-panel rounded-card ${padded ? "px-5 py-4" : ""} ${className}`}
      style={style}
      {...drag}
    >
      {children}
    </section>
  );
}

/** Panel heading. More space above than below, so groups read by proximity. */
export function PanelHead({
  title,
  aside,
  sub,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-3 flex items-baseline justify-between gap-4 ${className}`}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[17px] leading-none font-medium tracking-[-0.02em] text-ink">
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-xs text-ink-faint">{sub}</p>}
      </div>
      {aside && <div className="shrink-0 text-xs text-ink-faint">{aside}</div>}
    </div>
  );
}

/* ── Chips ────────────────────────────────────────────────────────────────── */

export function Chip({
  children,
  tone = "neutral",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?:
    | "neutral"
    | "risk"
    | "rework"
    | "extension"
    | "blocked"
    | "overdue"
    | "positive"
    | "solid";
  className?: string;
  title?: string;
}) {
  // Each tinted tone pairs a wash with an ink value tuned per theme, so a chip
  // stays ≥4.5:1 in both. Neutral stays untinted on purpose: tinting the normal
  // case makes the exceptions invisible.
  const tones: Record<string, string> = {
    neutral: "bg-[var(--control)] text-ink-muted",
    solid: "bg-ink text-[var(--body-bg)]",
    risk: "bg-[color-mix(in_srgb,var(--state-risk)_24%,transparent)] text-[var(--state-risk-ink)]",
    rework:
      "bg-[color-mix(in_srgb,var(--state-rework)_26%,transparent)] text-[var(--state-rework-ink)]",
    extension:
      "bg-[color-mix(in_srgb,var(--state-extension)_26%,transparent)] text-[var(--state-extension-ink)]",
    blocked:
      "bg-[color-mix(in_srgb,var(--state-blocked)_26%,transparent)] text-[var(--state-blocked-ink)]",
    overdue:
      "bg-[color-mix(in_srgb,var(--state-overdue)_26%,transparent)] text-[var(--state-overdue-ink)]",
    positive:
      "bg-[color-mix(in_srgb,var(--state-positive)_24%,transparent)] text-[var(--state-positive-ink)]",
  };
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-[5px] text-xs whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Chip on a dark slab. */
export function SlabChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-white/10 px-3.5 py-1.5 text-xs text-slab-ink">
      {children}
    </span>
  );
}

/* ── Figures ──────────────────────────────────────────────────────────────── */

/** A label/value/unit triple. */
export function StatPair({
  label,
  value,
  unit,
  onSlab = false,
  size = "md",
}: {
  label: string;
  value: string;
  unit?: string;
  onSlab?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div className="min-w-0">
      <p
        className={`truncate text-xs ${onSlab ? "text-slab-ink-muted" : "text-ink-faint"}`}
      >
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span
          data-figure
          className={`${size === "sm" ? "text-[17px]" : "text-[22px]"} leading-none tracking-[-0.025em] ${
            onSlab ? "text-slab-ink" : "text-ink"
          }`}
        >
          {value}
        </span>
        {unit && (
          <span
            className={`truncate text-xs ${onSlab ? "text-slab-ink-muted" : "text-ink-faint"}`}
          >
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * A slim neutral progress track. Deliberately NOT one of the C1–C4 hues: per
 * The Four Channels Rule, saturated colour in Cowork means "score component",
 * so goal, task and project progress read in ink.
 */
export function Meter({
  value,
  label,
  announce,
  className = "",
  tone,
}: {
  value: number;
  label: string;
  announce?: number;
  className?: string;
  /** Only for health, where the state palette applies — never a channel hue. */
  tone?: "default" | "risk" | "overdue";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill =
    tone === "overdue"
      ? "bg-[var(--state-overdue)]"
      : tone === "risk"
        ? "bg-[var(--state-risk)]"
        : "bg-ink/70";
  return (
    <div
      className={`h-1 overflow-hidden rounded-full bg-[var(--control-active)] ${className}`}
      role="meter"
      aria-valuenow={announce ?? clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span
        className={`block h-full rounded-full ${fill}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/**
 * A composition bar: one track divided into named segments, with a dot legend.
 *
 * `Task_overview`'s first KPI cell pairs a figure with a bar of this shape —
 * the figure says "how many", the bar says "made of what". A bare number in a
 * large cell is the low-information block the brief warns against.
 *
 * Segment tones come from the state palette or from ink, never from a C1–C4
 * hue: saturated colour in Cowork means "score component" and nothing else.
 */
export interface BarSegment {
  label: string;
  value: number;
  /** A CSS colour or var(). Neutral or state palette only. */
  tone: string;
}

export function SegmentBar({
  segments,
  legend = true,
  className = "",
}: {
  segments: BarSegment[];
  legend?: boolean;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const shown = segments.filter((s) => s.value > 0);

  return (
    <div className={className}>
      <div
        className="flex h-1.5 gap-px overflow-hidden rounded-full bg-[var(--control-active)]"
        role="img"
        aria-label={
          shown.map((s) => `${s.value} ${s.label}`).join(", ") ||
          "Nothing to show"
        }
      >
        {shown.map((s) => (
          <span
            key={s.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${total ? (s.value / total) * 100 : 0}%`,
              backgroundColor: s.tone,
            }}
          />
        ))}
      </div>

      {legend && shown.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {shown.slice(0, 3).map((s) => (
            <li
              key={s.label}
              className="flex items-center gap-1.5 text-[11px] text-ink-faint"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.tone }}
              />
              <span data-figure>{s.value}</span> {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A progress ring. The reference's fourth KPI cell uses one to show elapsed
 * against expected, where a bar would read as "more is better" — a ring reads
 * as a budget being consumed, which is the correct meaning for a timer.
 *
 * Over 100% the ring completes and switches to the overdue tone rather than
 * wrapping, so "over budget" is a state, not an ambiguous partial arc.
 */
export function Ring({
  value,
  label,
  size = 44,
  children,
}: {
  value: number;
  label: string;
  size?: number;
  /** Optional glyph or figure inside the ring. */
  children?: ReactNode;
}) {
  const over = value > 100;
  const clamped = Math.max(0, Math.min(100, value));
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;

  return (
    <span
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="3"
          className="stroke-[var(--control-active)]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          style={{ stroke: over ? "var(--state-overdue)" : "var(--color-ink)" }}
        />
      </svg>
      {children && (
        <span className="absolute inset-0 grid place-items-center">
          {children}
        </span>
      )}
    </span>
  );
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */

/** Hairline row separator. The system separates with hairlines and space. */
export function Rows({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`divide-y divide-hairline ${className}`}>{children}</div>
  );
}

/* ── Buttons ──────────────────────────────────────────────────────────────── */

type ButtonTone = "primary" | "secondary" | "ghost" | "destructive";

export function Button({
  children,
  tone = "secondary",
  size = "md",
  className = "",
  ...rest
}: {
  children: ReactNode;
  tone?: ButtonTone;
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const tones: Record<ButtonTone, string> = {
    // The filled control uses deck ink against the body background, so it
    // inverts correctly in dark mode without a second token.
    primary:
      "bg-ink text-[var(--body-bg)] hover:opacity-90 disabled:opacity-40",
    secondary:
      "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)] disabled:opacity-45",
    ghost:
      "text-ink-muted hover:bg-[var(--control)] hover:text-ink disabled:opacity-45",
    // Destructive is a tinted wash, not a saturated red — a red button would
    // read as a fifth channel colour.
    destructive:
      "bg-[color-mix(in_srgb,var(--state-overdue)_22%,transparent)] text-[var(--state-overdue-ink)] hover:bg-[color-mix(in_srgb,var(--state-overdue)_32%,transparent)] disabled:opacity-45",
  };
  return (
    <button
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium tracking-[-0.012em] transition-[background-color,opacity,color] duration-[180ms] ease-[var(--ease-deck)] disabled:cursor-not-allowed ${
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-[15px]"
      } ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

/* ── Segmented control ────────────────────────────────────────────────────── */

/**
 * A radiogroup, not a row of buttons: the options are named alternatives and
 * the control must announce which is active. Roving tabindex so the group is
 * one tab stop, arrow keys to move within it.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: {
  options: { id: T; label: string; count?: number; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === value);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? options.length - 1
          : (i + (forward ? 1 : -1) + options.length) % options.length;
    onChange(options[next].id);
    (e.currentTarget as HTMLElement)
      .querySelectorAll<HTMLButtonElement>("[role=radio]")
      [next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      /* `max-w-full` + internal scroll instead of `shrink-0`. The group could
         neither shrink nor wrap, so a long option set — the task scope reads
         "Mine · My team · Assigned out · Everyone" — pushed the pill outside
         its rounded container and past the header. Identical at any width where
         it already fitted; it only stops overflowing where it previously did.
         `rail` hides the scrollbar chrome, as it does on the icon tabs. */
      className="rail inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-[var(--surface-sunken)] p-[3px]"
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.hint}
            onClick={() => onChange(o.id)}
            className={`inline-flex items-center gap-1.5 rounded-full font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
              size === "sm" ? "px-3 py-1 text-sm" : "px-4 py-[7px] text-[15px]"
            } ${active ? "bg-ink text-[var(--body-bg)]" : "text-ink-muted hover:text-ink"}`}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                data-figure
                className={`text-[11px] ${active ? "opacity-70" : "text-ink-faint"}`}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────────────── */

/** Pill tabs. Nothing in this system underlines. */
export function Tabs({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="rail flex items-center gap-1 overflow-x-auto"
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[15px] font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
              active
                ? "bg-[var(--control)] text-ink"
                : "text-ink-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
            }`}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && (
              <span
                data-figure
                className={`rounded-full px-1.5 py-px text-[11px] ${
                  active
                    ? "bg-[var(--control-active)] text-ink"
                    : "bg-[var(--control)] text-ink-faint"
                }`}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Inputs ───────────────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-sm font-medium text-ink">{label}</span>
        {required && (
          <span className="text-[11px] text-ink-faint">Required</span>
        )}
      </span>
      {children}
      {hint && !error && (
        <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>
      )}
      {error && (
        <span
          role="alert"
          className="mt-1.5 block text-xs text-[var(--state-overdue-ink)]"
        >
          {error}
        </span>
      )}
    </label>
  );
}

const inputBase =
  "w-full rounded-inset bg-[var(--surface-raised)] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint " +
  "shadow-[inset_0_0_0_1px_var(--color-hairline)] transition-shadow duration-[180ms] " +
  "focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none disabled:opacity-50";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className={`${inputBase} ${props.className ?? ""}`} />
  );
}

/**
 * `forwardRef` so a caller can measure the element — the composer's auto-grow
 * sets its height from `scrollHeight`. Callers that pass no ref are unaffected;
 * this is purely additive.
 */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={`${inputBase} resize-y ${props.className ?? ""}`}
    />
  );
});

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${inputBase} appearance-none pr-9 ${props.className ?? ""}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23888' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 14px center",
        ...props.style,
      }}
    />
  );
}

/* ── States ───────────────────────────────────────────────────────────────── */

export function Skeleton({
  className = "",
  block = false,
  style,
}: {
  className?: string;
  block?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`skeleton ${block ? "skeleton-block" : ""} block ${className}`}
    />
  );
}

/** The standard loading shape for a list surface. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 py-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 shrink-0" />
          <Skeleton
            className="h-4"
            style={{ width: `${45 + ((i * 13) % 35)}%` }}
          />
          <Skeleton className="ml-auto h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  compact = false,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`text-center ${compact ? "py-8" : "py-14"}`}>
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {body && (
        <p className="mx-auto mt-1.5 max-w-[46ch] text-sm text-ink-muted">
          {body}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "That didn't load",
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="py-12 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {body && (
        <p className="mx-auto mt-1.5 max-w-[46ch] text-sm text-ink-muted">
          {body}
        </p>
      )}
      {onRetry && (
        <div className="mt-4 flex justify-center">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}

/**
 * Permission denied is a first-class state, not an error. It explains the
 * boundary rather than implying a failure — a manager who cannot see a peer's
 * score has not hit a bug.
 */
export function PermissionDenied({
  what = "this",
  reason,
}: {
  what?: string;
  reason?: string;
}) {
  return (
    <div className="py-12 text-center">
      <p className="text-[15px] font-medium text-ink">
        You don&rsquo;t have access to {what}
      </p>
      <p className="mx-auto mt-1.5 max-w-[52ch] text-sm text-ink-muted">
        {reason ??
          "Visibility follows the reporting hierarchy — you can see the people who report to you, and your own record."}
      </p>
    </div>
  );
}

/** Inline banner for an action-level failure, including offline. */
export function InlineError({
  message,
  code,
  onRetry,
  compact = false,
  onSlab = false,
}: {
  message: string;
  code?: string | null;
  onRetry?: () => void;
  /** For card interiors, where a full-height error state would break the row. */
  compact?: boolean;
  /** For the dark iridescent surfaces, where the overdue wash cannot be read. */
  onSlab?: boolean;
}) {
  const offline = code === "offline";
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-inset ${
        onSlab
          ? "bg-black/35 backdrop-blur-sm"
          : "bg-[color-mix(in_srgb,var(--state-overdue)_16%,transparent)]"
      } ${compact ? "px-3 py-2" : "px-3.5 py-2.5"}`}
    >
      <p
        className={`flex-1 ${compact ? "text-xs" : "text-sm"} ${
          onSlab ? "text-white" : "text-[var(--state-overdue-ink)]"
        }`}
      >
        {offline ? "You appear to be offline. " : ""}
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
            onSlab
              ? "bg-white/15 text-white hover:bg-white/25"
              : "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)]"
          }`}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * The error branch for a surface that would otherwise show an empty state.
 *
 * The distinction matters more than it looks: "there is nothing here" tells
 * someone they can stop looking, and a failed read that renders as emptiness
 * tells them that falsely. Every list in Cowork that can be empty can also
 * fail, so both answers have to be available at the same place.
 *
 * Returns null when nothing failed, so it can sit above the normal render.
 */
export function QueryError({
  queries,
  message,
  compact = false,
  onSlab = false,
}: {
  queries: { error: string | null; refetch: () => void }[];
  message: string;
  compact?: boolean;
  onSlab?: boolean;
}) {
  const failed = queries.find((q) => q.error);
  if (!failed) return null;
  return (
    <InlineError
      compact={compact}
      onSlab={onSlab}
      message={message}
      code={failed.error}
      onRetry={() => {
        for (const q of queries) if (q.error) q.refetch();
      }}
    />
  );
}

/**
 * Marks any figure derived from an unconfirmed rule. The brief is explicit:
 * provisional rules must be labelled, never silently applied.
 */
export function ProvisionalBadge({
  decisionId,
  label,
  className = "",
}: {
  decisionId?: string;
  label?: string;
  className?: string;
}) {
  return (
    <span
      title={
        label
          ? `${label} — provisional. Owner decision ${decisionId ?? ""} is unresolved; this figure uses a placeholder rule.`
          : "This figure uses a placeholder rule pending an owner decision."
      }
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--control)] px-2 py-0.5 text-[11px] text-ink-faint ${className}`}
    >
      <span
        aria-hidden="true"
        className="h-1 w-1 rounded-full bg-[var(--state-extension)]"
      />
      Provisional
      {decisionId && <span className="opacity-70">{decisionId}</span>}
    </span>
  );
}

/* ── Layout helpers ───────────────────────────────────────────────────────── */

export function PageHead({
  title,
  kicker,
  sub,
  actions,
  children,
}: {
  title: string;
  /** The single tracked uppercase kicker for the view. */
  kicker?: string;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-[clamp(18px,2.4vw,28px)]">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {kicker && (
            <p className="mb-1.5 text-[11px] leading-tight font-medium tracking-[0.09em] text-ink-muted uppercase">
              {kicker}
            </p>
          )}
          <h1 className="truncate text-[clamp(1.5rem,2.6vw,2.125rem)] leading-[1.08] font-light tracking-[-0.03em] text-ink">
            {title}
          </h1>
          {sub && <div className="mt-1.5 text-sm text-ink-muted">{sub}</div>}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
      <div className="mt-[clamp(14px,1.8vw,20px)] h-px bg-hairline" />
    </div>
  );
}

/** A dense KPI strip — hairline-separated cells inside one panel. */
export function StatStrip({
  items,
}: {
  items: {
    label: string;
    value: string;
    unit?: string;
    tone?: "default" | "alert";
  }[];
}) {
  return (
    <Panel padded={false}>
      <div className="grid grid-cols-2 divide-x divide-y divide-hairline sm:grid-cols-4 sm:divide-y-0">
        {items.map((it) => (
          <div key={it.label} className="px-5 py-4">
            <p className="truncate text-xs text-ink-faint">{it.label}</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span
                data-figure
                className={`text-[22px] leading-none tracking-[-0.025em] ${
                  it.tone === "alert"
                    ? "text-[var(--state-overdue-ink)]"
                    : "text-ink"
                }`}
              >
                {it.value}
              </span>
              {it.unit && (
                <span className="truncate text-xs text-ink-faint">
                  {it.unit}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
