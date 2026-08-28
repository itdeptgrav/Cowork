"use client";

import { useId, useState, type ReactNode } from "react";
import { Panel } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";

/**
 * A panel that starts shut and opens when asked.
 *
 * ## Why these two panels close and the others do not
 *
 * Recorded audio and History are both **logs**: they grow without bound and
 * they are read on purpose, not in passing. A meeting with twenty-two clips
 * from four people put twenty-two rows in the rail, and the change log adds a
 * line every time anybody joins or leaves — between them they were most of the
 * page's height and none of its usual reading. Details, Participants and the
 * transcript are answers you want at a glance; these two are answers you go
 * looking for.
 *
 * It also fixed a rendering fault. Between `sm` and `deck` the rail is a
 * CSS-columns flow, and `break-inside: avoid` on a panel TALLER than the
 * column does not break it — it overflows, and the next panel is painted
 * underneath it. A twenty-two-row list was reliably taller than the column, so
 * Recorded audio was drawn on top of History. A shut panel is four lines tall
 * and cannot overflow anything.
 *
 * ## Shut is not silent
 *
 * The header keeps a `summary` — "22 files from 4 people" — so the closed
 * state still answers the question the panel exists for. Hiding the count as
 * well as the rows would mean opening it every time just to learn there was
 * nothing to see. Minimising should cost detail, never the headline.
 *
 * ## Mechanics
 *
 * The whole header is the button, so the target is the full width of the panel
 * rather than a chevron. `aria-expanded` and `aria-controls` are what make it a
 * disclosure to a screen reader instead of a mystery button, and the content is
 * unmounted rather than hidden with CSS — a shut panel should not be running
 * queries or holding a list of DOM nodes.
 */
export function CollapsiblePanel({
  title,
  sub,
  summary,
  defaultOpen = false,
  label,
  children,
}: {
  title: string;
  /** The line under the title, as `PanelHead` renders it. */
  sub?: string;
  /**
   * What the panel can say while shut — a count, a total, "nothing yet".
   * Rendered in place of the content, so the closed state is still an answer.
   */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Accessible name for the landmark. Defaults to the title. */
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <Panel label={label ?? title}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        /* `-m` then `p` so the pressable area covers the panel's own padding
           without the header appearing inset from the panel's other content. */
        className="-m-5 flex w-full items-start gap-3 rounded-card p-5 text-left transition-colors hover:bg-[var(--control)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-none font-medium tracking-[-0.02em] text-ink">
            {title}
          </span>
          {sub && <span className="mt-0.5 block text-xs text-ink-faint">{sub}</span>}
          {/* Only while shut: open, the content says it better than a count. */}
          {!open && summary !== undefined && (
            <span className="mt-2 block text-[12px] text-ink-faint">{summary}</span>
          )}
        </span>
        <span
          aria-hidden
          className="mt-0.5 shrink-0 text-ink-muted transition-transform duration-150"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          <Icon.chevronRight className="h-4 w-4" />
        </span>
      </button>

      {/* Unmounted, not hidden — a shut log should cost nothing to have. */}
      {open && (
        <div id={bodyId} className="mt-5">
          {children}
        </div>
      )}
    </Panel>
  );
}
