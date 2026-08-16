"use client";

/**
 * The insert/edit-link popover.
 *
 * It normalises what is typed the same way the engine does — a bare domain
 * becomes https, an address becomes mailto, an unsafe scheme is refused — so a
 * link can never be stored in a form the grid would not open. Editing shows the
 * current URL; Remove clears an explicit link.
 */

import { useEffect, useRef, useState } from "react";
import { normalizeUrl } from "@/lib/spreadsheet/hyperlink";

const field =
  "h-8 w-full rounded-md border border-hairline bg-[var(--surface-raised)] px-2 text-[13px] text-ink outline-none focus:border-[color-mix(in_srgb,var(--ink)_35%,transparent)]";

export function LinkEditor({
  x,
  y,
  initialUrl,
  onSubmit,
  onRemove,
  onClose,
}: {
  x: number;
  y: number;
  initialUrl: string;
  onSubmit: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialUrl);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  const normalized = normalizeUrl(text);
  const invalid = text.trim() !== "" && normalized === null;

  function submit() {
    if (normalized) {
      onSubmit(normalized);
      onClose();
    }
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 flex w-72 flex-col gap-2 rounded-card border border-hairline bg-[var(--surface-raised)] p-3 shadow-lg"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className={field}
        placeholder="Paste or type a URL"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      {invalid && <div className="text-[11px] text-red-500">Not a valid http, https or mailto link.</div>}
      <div className="flex items-center justify-between">
        {initialUrl ? (
          <button
            type="button"
            className="h-7 rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:text-ink"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            Remove
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-7 rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:text-ink"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!normalized}
            className="h-7 rounded-md bg-ink px-2.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
            onClick={submit}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
