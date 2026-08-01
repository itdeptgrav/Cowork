"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DocIcon } from "./DocsIcons";

/**
 * Menus and popovers for the document surface.
 *
 * ## Why these are not the product's `Segmented` / `Select`
 *
 * A word processor's chrome is thirty controls that each need a panel of their
 * own: a colour grid, a font list, a table-size picker, a nine-item File menu.
 * Native `<select>` cannot hold a swatch grid, and building each panel where it
 * is used would produce thirty different ideas about how a panel closes. There
 * is one idea here, and every panel in this folder uses it.
 *
 * ## Closing is the part that goes wrong
 *
 * Three ways out, all of them required: Escape, a click anywhere else, and
 * choosing something. Miss the second and the panel follows the reader around
 * the page; miss the third and every item needs to remember to close its own
 * menu, which one of them eventually will not.
 *
 * `pointerdown` rather than `click` for the outside dismissal, so a panel that
 * covers a toolbar button does not swallow the press that was meant to close
 * it and then fire it on the button underneath.
 */

const CloseContext = createContext<() => void>(() => {});

/** Close the panel this item sits in. Items call it; they never track state. */
export function useCloseMenu(): () => void {
  return useContext(CloseContext);
}

export function MenuPanel({
  children,
  width,
  align = "start",
  onClose,
  className = "",
  holdsSubmenus = false,
}: {
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
  onClose: () => void;
  className?: string;
  /**
   * This panel contains submenus, so it must not clip.
   *
   * A submenu opens BESIDE its parent, and the parent's scroll container would
   * cut it off at its own edge — leaving a menu that opens somewhere the reader
   * cannot see. Panels that say so lose their scrolling, which is why it is a
   * flag rather than the default: only short menus can afford it.
   */
  holdsSubmenus?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  /* Flipped up when there is not room below. A menu that opens off the bottom
     of the window is a menu whose last three items do not exist. */
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setFlip(box.bottom > window.innerHeight - 8 && box.top > box.height + 16);
  }, []);

  return (
    <CloseContext.Provider value={onClose}>
      <div
        ref={ref}
        role="menu"
        className={`absolute z-50 rounded-inset border border-hairline bg-[var(--surface-raised)] py-1 shadow-[var(--shadow-deck-seat)] ${
          holdsSubmenus
            ? "overflow-visible"
            : "max-h-[min(70vh,520px)] overflow-y-auto overflow-x-hidden scroll-slim"
        } ${align === "end" ? "right-0" : "left-0"} ${
          flip ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"
        } ${className}`}
        style={{ width, minWidth: width ?? 180 }}
      >
        {children}
      </div>
    </CloseContext.Provider>
  );
}

/**
 * A button with a panel under it.
 *
 * `render` receives `close` so a panel can dismiss itself after an action that
 * is not a plain `MenuItem` — a colour swatch, a table-size grid.
 */
export function Popover({
  label,
  children,
  render,
  width,
  align = "start",
  className = "",
  panelClassName = "",
  disabled,
  title,
}: {
  label: string;
  /** The button's face. */
  children: ReactNode;
  render: (close: () => void) => ReactNode;
  width?: number;
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={host} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 items-center gap-1 rounded-inset px-1.5 text-[12px] transition-colors disabled:opacity-35 ${
          open
            ? "bg-[var(--control)] text-ink"
            : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
        }`}
      >
        {children}
      </button>
      {open && (
        <MenuPanel width={width} align={align} onClose={close} className={panelClassName}>
          {render(close)}
        </MenuPanel>
      )}
    </div>
  );
}

export function MenuItem({
  label,
  shortcut,
  onSelect,
  icon,
  active,
  disabled,
  note,
  danger,
}: {
  label: string;
  shortcut?: string;
  onSelect: () => void;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** A second line. Used where an item's limits need saying, not for flavour. */
  note?: string;
  danger?: boolean;
}) {
  const close = useCloseMenu();
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect();
        close();
      }}
      className={`flex w-full items-start gap-2.5 px-2.5 py-1.5 text-left text-[12.5px] transition-colors disabled:opacity-35 ${
        danger ? "text-[var(--state-overdue-ink)]" : "text-ink"
      } enabled:hover:bg-[var(--row-hover)]`}
    >
      <span className="mt-[1px] grid h-4 w-4 shrink-0 place-items-center text-ink-muted">
        {active ? <CheckMark /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {note && <span className="mt-0.5 block text-[10.5px] text-ink-faint">{note}</span>}
      </span>
      {shortcut && (
        <span className="shrink-0 pt-[1px] text-[10.5px] text-ink-faint">{shortcut}</span>
      )}
    </button>
  );
}

/** A submenu — the item opens a panel beside it rather than doing something. */
export function SubMenu({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCloseMenu();
  return (
    <div
      className="relative"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--row-hover)]"
      >
        <span className="grid h-4 w-4 shrink-0 place-items-center text-ink-muted">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="-rotate-90 text-ink-faint">
          <DocIcon.chevronDown className="h-3.5 w-3.5" />
        </span>
      </button>
      {open && (
        <div className="absolute left-[calc(100%-4px)] top-0 z-50 w-max min-w-[180px] rounded-inset border border-hairline bg-[var(--surface-raised)] py-1 shadow-[var(--shadow-deck-seat)]">
          <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
        </div>
      )}
    </div>
  );
}

export function MenuSeparator() {
  return <div aria-hidden="true" className="my-1 h-px bg-hairline" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-[0.09em] text-ink-faint">
      {children}
    </div>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.4l3.2 3.2L13 4.8" />
    </svg>
  );
}
