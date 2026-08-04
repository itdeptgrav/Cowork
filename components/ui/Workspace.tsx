"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";

/**
 * Workspace chrome — the compact two-row header both layout references use.
 *
 * Row 1: title · inline count · scope control · primary action.
 * Row 2: icon tabs · right-aligned toolbar.
 *
 * Target height ≤120px for both rows. The earlier build spent ~250px getting
 * to the same place, which is what pushed real data below the fold. Title sits
 * at Headline rather than Display: a workspace header is wayfinding, not a
 * greeting, and Display is spent once per view on the home greeting.
 */

export function WorkspaceHead({
  title,
  count,
  scope,
  action,
  tabs,
  toolbar,
  breadcrumb,
}: {
  title: string;
  /** Inline, in muted ink, on the same baseline as the title. */
  count?: ReactNode;
  scope?: ReactNode;
  action?: ReactNode;
  tabs?: ReactNode;
  toolbar?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-4">
      {breadcrumb && <div className="mb-2">{breadcrumb}</div>}

      {/* `Task_overview` puts the scope control INLINE, immediately after the
          title and its count — the three are read as one sentence: "Tasks, 3
          jobs, whose?". Only the primary action is pushed to the far edge. An
          earlier pass right-aligned the scope control and broke that reading. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[clamp(1.375rem,2vw,1.75rem)] leading-none font-light tracking-[-0.03em] text-ink">
          {title}
        </h1>
        {/* `ink-muted`, not `ink-faint`: this line sits on the raw field, where
            faint ink measures 4.10:1 against the flat body and less under a
            blob. `ink-faint` is a panel-only token — see docs/architecture/DESIGN.md. */}
        {count && <span className="text-sm text-ink-muted">{count}</span>}
        {scope && <div className="flex items-center gap-2">{scope}</div>}
        {action && <div className="ml-auto">{action}</div>}
      </div>

      {(tabs || toolbar) && (
        <div className="mt-3 flex items-center gap-3 border-b border-hairline pb-2">
          <div className="min-w-0 flex-1">{tabs}</div>
          {toolbar && (
            <div className="flex shrink-0 items-center gap-1.5">{toolbar}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Breadcrumb. Compact, one line, last segment is the current page. */
export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden="true" className="text-ink-faint opacity-50">
              /
            </span>
          )}
          {it.href ? (
            <Link
              href={it.href}
              className="text-ink-muted transition-colors hover:text-ink"
            >
              {it.label}
            </Link>
          ) : (
            <span className="text-ink">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Icon tabs. Pills, never underlines — nothing in this system underlines. */
export function IconTabs({
  items,
  active,
}: {
  items: {
    id: string;
    label: string;
    href: string;
    icon: IconName;
    count?: number;
  }[];
  active: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Views"
      className="rail flex items-center gap-0.5 overflow-x-auto"
    >
      {items.map((t) => {
        const on = t.id === active;
        const Ico = Icon[t.icon];
        return (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={on}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
              on
                ? "bg-[var(--control)] text-ink"
                : "text-ink-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
            }`}
          >
            <Ico className={on ? "" : "opacity-70"} />
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span
                data-figure
                className={`rounded-full px-1.5 text-[11px] ${
                  on
                    ? "bg-[var(--control-active)]"
                    : "bg-[var(--control)] text-ink-faint"
                }`}
              >
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** Compact icon button for a toolbar. */
export function ToolButton({
  icon,
  label,
  active = false,
  count,
  onClick,
  children,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
  /** Optional visible text; icon-only when absent. */
  children?: ReactNode;
}) {
  const Ico = Icon[icon];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={children ? undefined : label}
      aria-pressed={onClick ? active : undefined}
      title={label}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium transition-colors duration-[180ms] ${
        active
          ? "bg-[var(--control-active)] text-ink"
          : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
      }`}
    >
      <Ico />
      {children}
      {count !== undefined && count > 0 && (
        <span
          data-figure
          className="rounded-full bg-ink px-1.5 text-[11px] text-[var(--body-bg)]"
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Inline search that stays narrow — it never claims a whole row. */
export function ToolSearch({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint">
        <Icon.search />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-[168px] rounded-full bg-[var(--surface-sunken)] pr-3 pl-8 text-sm text-ink placeholder:text-ink-faint focus:w-[220px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      />
    </div>
  );
}

/**
 * A popover anchored to its trigger. Used for filters, grouping and row menus,
 * so a dense toolbar stays one row instead of becoming a stack of selects.
 */
export function Popover({
  trigger,
  children,
  align = "right",
  label,
  solid = false,
  insetEnd = false,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  label: string;
  /**
   * Opaque instead of frosted.
   *
   * For a popover that lands on top of a form CONTROL rather than on the page.
   * At frost's 0.92 alpha the field's border shows through and the two read as
   * one widget — see `.frost-bar-solid`.
   */
  solid?: boolean;
  /**
   * Hold the panel clear of the field's trailing control column.
   *
   * A form whose fields each carry a trailing button — the AI sparkle sits at
   * `right-1.5` on Title, Description and Acceptance criteria alike — stacks
   * those buttons in one column. A panel anchored flush to its trigger covers
   * the NEXT field's button exactly, so opening one and then clicking the next
   * takes two clicks: the first is swallowed by the panel.
   *
   * Flipping the panel above does not help; it covers the button above instead.
   * Offsetting it sideways is what actually clears the column, whichever way it
   * opens. 2.5rem clears the 24px button plus its 6px inset with room to spare;
   * 2rem cleared it by only 2px, which sub-pixel rounding would eat.
   */
  insetEnd?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`${solid ? "frost-bar-solid" : "frost-bar"} absolute top-[calc(100%+6px)] z-50 min-w-[220px] rounded-panel p-2 ${
            align === "right"
              ? insetEnd
                ? "right-10"
                : "right-0"
              : insetEnd
                ? "left-10"
                : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A row inside a popover. */
export function MenuItem({
  children,
  onClick,
  selected = false,
  icon,
  danger = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  icon?: IconName;
  danger?: boolean;
}) {
  const Ico = icon ? Icon[icon] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm transition-colors ${
        danger
          ? "text-[var(--state-overdue-ink)] hover:bg-[color-mix(in_srgb,var(--state-overdue)_18%,transparent)]"
          : selected
            ? "bg-[var(--control)] text-ink"
            : "text-ink-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
      }`}
    >
      {Ico && <Ico />}
      <span className="flex-1 truncate">{children}</span>
      {selected && <Icon.check className="h-3.5 w-3.5" />}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
      {children}
    </p>
  );
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-hairline" />;
}
