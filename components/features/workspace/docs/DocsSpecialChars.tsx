"use client";

import { useMemo, useRef, useState } from "react";
import {
  groupSpecialChars,
  searchSpecialChars,
} from "@/lib/rules/documents/specialChars";

/**
 * The special-character picker.
 *
 * **It stays open after you insert.** Somebody opening this panel is usually
 * adding a degree sign and then another one, or building a row of arrows; a
 * dialog that closes on the first click makes the second insertion cost four
 * actions. Escape and the Close button are how it ends.
 *
 * **Search matches what people call things**, not only the Unicode name —
 * "temperature" finds the degree sign. That is `searchSpecialChars`, tested on
 * its own; this file only draws the result.
 */
export function DocsSpecialChars({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (char: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [inserted, setInserted] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groups = useMemo(
    () => groupSpecialChars(searchSpecialChars(query)),
    [query],
  );

  if (!open) return null;

  const insert = (char: string) => {
    onInsert(char);
    /* A brief confirmation on the tile itself, because the caret is behind the
       panel and nothing else tells you the click landed. */
    setInserted(char);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setInserted(null), 600);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Special characters"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="frost-panel flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-hairline shadow-[var(--deck-seat)]"
      >
        <div className="flex items-center gap-2 border-b border-hairline p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — try arrow, rupee, degree, dash"
            aria-label="Search special characters"
            className="flex-1 rounded-full bg-[var(--control)] px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {groups.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12px] text-ink-faint">
              Nothing matches “{query}”.
            </p>
          ) : (
            groups.map(({ group, chars }) => (
              <section key={group} className="mb-4 last:mb-0">
                <h3 className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-ink-faint">
                  {group}
                </h3>
                <div className="grid grid-cols-8 gap-1 sm:grid-cols-10">
                  {chars.map((c) => (
                    <button
                      key={c.char}
                      type="button"
                      title={c.name}
                      aria-label={c.name}
                      onClick={() => insert(c.char)}
                      className={`flex h-9 items-center justify-center rounded-lg text-[16px] transition-colors ${
                        inserted === c.char
                          ? "bg-[var(--state-positive)] text-[var(--state-positive-ink)]"
                          : "text-ink hover:bg-[var(--control)]"
                      }`}
                    >
                      {c.char}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <p className="border-t border-hairline px-3 py-2 text-[11px] text-ink-faint">
          Click to insert at the caret. The panel stays open so you can add more.
        </p>
      </div>
    </div>
  );
}

export default DocsSpecialChars;
