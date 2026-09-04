"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

/**
 * The popup behind @mentions and slash commands.
 *
 * One component for both, because they are the same interaction: a trigger
 * character opens a list that narrows as you type, arrows move, Enter picks,
 * Escape closes. Tiptap's suggestion plugin owns the typing and the position;
 * this owns only what is drawn and which row is lit.
 *
 * Positioned by the caller from the plugin's `clientRect`, fixed to the
 * viewport, so it follows the caret rather than the scroll container.
 */

export interface SuggestionItem {
  id: string;
  label: string;
  hint?: string;
  /** A small glyph or emoji drawn before the label. */
  glyph?: string;
}

export interface SuggestionMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SuggestionMenu = forwardRef<
  SuggestionMenuHandle,
  {
    items: SuggestionItem[];
    command: (item: SuggestionItem) => void;
    title?: string;
    empty?: string;
  }
>(function SuggestionMenu({ items, command, title, empty = "Nothing matches." }, ref) {
  const [index, setIndex] = useState(0);

  /* A new list starts at the top — the lit row must never point at a row
     that no longer exists. Keyed on the items rather than reset in an effect. */
  const [seen, setSeen] = useState(items);
  if (seen !== items) {
    setSeen(items);
    setIndex(0);
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index];
        if (item) command(item);
        return Boolean(item);
      }
      return false;
    },
  }));

  useEffect(() => {
    document.getElementById(`suggestion-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div
      role="listbox"
      aria-label={title ?? "Suggestions"}
      className="frost-bar-solid max-h-72 w-[280px] overflow-y-auto rounded-inset border border-hairline p-1 shadow-[var(--shadow-deck-seat)] scroll-slim"
    >
      {title && <p className="px-2 pt-1 pb-1.5 text-[10.5px] font-medium tracking-[0.04em] text-ink-faint uppercase">{title}</p>}
      {items.length === 0 && <p className="px-2 py-1.5 text-[12px] text-ink-faint">{empty}</p>}
      {items.map((item, i) => (
        <button
          key={item.id}
          id={`suggestion-${i}`}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            /* Keep the editor's selection where it is; the command inserts at
               the trigger. */
            e.preventDefault();
            command(item);
          }}
          className={`flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left ${
            i === index ? "bg-[var(--control-active)]" : "hover:bg-[var(--control)]"
          }`}
        >
          {item.glyph && (
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-[var(--control)] text-[13px] leading-none" aria-hidden="true">
              {item.glyph}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] text-ink">{item.label}</span>
            {item.hint && <span className="block truncate text-[10.5px] text-ink-faint">{item.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
});
