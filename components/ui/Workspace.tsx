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
  actionPlacement = "title",
}: {
  title: string;
  /** Inline, in muted ink, on the same baseline as the title. */
  count?: ReactNode;
  scope?: ReactNode;
  action?: ReactNode;
  tabs?: ReactNode;
  toolbar?: ReactNode;
  breadcrumb?: ReactNode;
  /**
   * Which row the primary action rides on.
   *
   * `title` is the original reading — the action at the far edge of the title
   * line, opposite the page name. On a header with no visible heading, that
   * line holds nothing else, and a row drawn to float one button in is a band
   * of empty page above the tabs. `tabs` puts the action at the right end of
   * the tab row instead, and the title row collapses.
   *
   * Opt-in, so the surfaces that still read well the first way are untouched.
   * There is no matching option for `scope`: the one page whose scope control
   * needed to move put it in its own list toolbar instead, next to the filter
   * that asks the next question about the same rows.
   */
  actionPlacement?: "title" | "tabs";
}) {
  const actionOnTabs = actionPlacement === "tabs" && !!action;

  return (
    <div className="mb-4">
      {breadcrumb && <div className="mb-2">{breadcrumb}</div>}

      {/**
       * **The page title is read, not seen.**
       *
       * A workspace page said its own name twice over: the navigation rail
       * already has the section lit, the tab row underneath opens with the same
       * word, and then a display-scale heading above both repeated it. Somebody
       * who has just clicked Tasks does not need to be told they are in Tasks —
       * that is a line of the tallest type on the page spent confirming what the
       * click already did, and it pushed the first real row further down every
       * screen in the product.
       *
       * `sr-only` rather than deleted. A page with no `h1` has no name for a
       * screen reader and nothing to jump to by heading, and the visible chrome
       * that replaces it — an active pill in a rail — is not a heading and does
       * not announce as one. The word is gone from the design, not from the
       * document.
       *
       * The home page is the exception and keeps its heading, because there
       * "Overview" is not the name of the thing you clicked — it is a statement
       * about the page. It has its own `h1` in the dashboard chrome and never
       * used this header.
       */}
      <h1 className="sr-only">{title}</h1>

      {/* Whatever else the title row held. It is skipped entirely when it would
          be empty — with the heading gone, most pages have nothing left to put
          on this line, and an empty flex row is still a band of blank page
          above the tabs.

          `Task_overview` puts the scope control INLINE, immediately after the
          title and its count — the three are read as one sentence: "Tasks, 3
          jobs, whose?". Only the primary action is pushed to the far edge. An
          earlier pass right-aligned the scope control and broke that reading. */}
      {(count || scope || (action && !actionOnTabs)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* `ink-muted`, not `ink-faint`: this line sits on the raw field, where
              faint ink measures 4.10:1 against the flat body and less under a
              blob. `ink-faint` is a panel-only token — see docs/architecture/DESIGN.md. */}
          {count && <span className="text-sm text-ink-muted">{count}</span>}
          {scope && <div className="flex items-center gap-2">{scope}</div>}
          {action && !actionOnTabs && <div className="ml-auto">{action}</div>}
        </div>
      )}

      {(tabs || toolbar || actionOnTabs) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline pb-2">
          <div className="min-w-0 flex-1">{tabs}</div>
          {actionOnTabs && <div className="shrink-0">{action}</div>}
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
    /**
     * Something is new here but cannot be counted.
     *
     * A dot, not a number. The engine itemises some kinds of activity and only
     * timestamps others, and rendering "1" for the second kind would be a
     * figure nobody could check. Ignored when `count` is set — a number says
     * everything a dot would.
     */
    dot?: boolean;
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
            {t.count !== undefined && t.count > 0 ? (
              <span
                data-figure
                aria-label={`${t.count} new`}
                className={`rounded-full px-1.5 text-[11px] ${
                  on
                    ? "bg-[var(--control-active)]"
                    : "bg-[var(--state-extension)] text-[var(--state-extension-ink)]"
                }`}
              >
                {t.count}
              </span>
            ) : (
              t.dot && (
                /* Something changed and there is no honest number for it. */
                <span
                  aria-label="new"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--state-extension)]"
                />
              )
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
