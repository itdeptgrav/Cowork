"use client";

import { Icon } from "@/components/ui/Icons";
import { parseChangeSummary } from "@/lib/rules/tasks/taskChangeLog";
import { formatClock, formatDate } from "@/lib/utils/format";

/**
 * A requirement/ET change, rendered as a card people actually notice.
 *
 * ## Why this is not the quiet system line
 *
 * "Task approved" belongs to neither side of the thread and is fine as a small
 * centred whisper. A change to *what the work is* and *how long it is worth* is
 * different: it rewrites the brief of something somebody is part-way through, so
 * it has to read as an event, not a footnote. Reported against the 11px grey
 * line the summary first shipped as — accurate, and easy to miss.
 *
 * ## Parsed, with a fallback that cannot break
 *
 * The parts come from `parseChangeSummary`, which splits on the ` · ` separators
 * the summary is built with — never on a requirement's own words. Anything it
 * does not recognise returns null and this renders the plain line instead, so a
 * message shape it has not seen degrades to the old behaviour rather than to a
 * broken card. That is also why the raw `text` is the fallback here.
 *
 * ## Who and when, like a message
 *
 * `by` and `at` come from the system message itself — its sender and its
 * timestamp — so the card reads like the rest of the thread: a name and a time.
 * They are trustworthy for the same reason the message is: the engine stamped
 * both, attributing the change to the verified caller. A card without them is
 * an event nobody is accountable for, which is exactly what a change to live
 * work must not be.
 */
export function ChangeEventCard({
  text,
  by,
  at,
}: {
  text: string;
  /** The person who made the change — the message's sender. */
  by?: string | null;
  /** When — the message's ISO timestamp. */
  at?: string | null;
}) {
  const change = parseChangeSummary(text);

  /* Not one of ours — an approval, a deadline decision. The quiet centred line,
     unchanged. */
  if (!change) {
    return (
      <p className="my-2 text-center text-[11px] leading-relaxed text-ink-faint">
        {text}
      </p>
    );
  }

  const verb =
    change.action === "added"
      ? "Requirement added"
      : change.action === "removed"
        ? "Requirement removed"
        : "Requirement edited";

  /* The accent follows the direction of the change: adding work reads positive,
     removing reads as the overdue/withdrawn colour, editing is neutral. It is a
     hairline and an icon tint only — never a filled block, which would shout. */
  const accent =
    change.action === "added"
      ? "var(--state-positive-ink)"
      : change.action === "removed"
        ? "var(--state-overdue-ink)"
        : "var(--state-extension-ink)";

  const Glyph =
    change.action === "added"
      ? Icon.plus
      : change.action === "removed"
        ? Icon.close
        : Icon.rename;

  return (
    <div className="my-3 flex justify-center">
      <div className="w-full max-w-[440px] rounded-panel bg-[var(--surface-raised)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-hairline)]">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)]"
            style={{ color: accent }}
          >
            <Glyph className="h-3.5 w-3.5" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">{verb}</p>

            {/* The requirement itself. For an edit, the old text struck through
                above the new, so "what it became" is legible at a glance. */}
            {change.action === "edited" && change.before ? (
              <div className="mt-0.5 space-y-0.5">
                <p className="text-[13px] text-ink-faint line-through decoration-hairline">
                  {change.before}
                </p>
                <p className="text-[13px] text-ink-muted">{change.requirement}</p>
              </div>
            ) : (
              <p className="mt-0.5 text-[13px] text-ink-muted break-words">
                “{change.requirement}”
              </p>
            )}

            {/* The numbers, as chips — the part the reader most wants: how the
                estimate moved, and by how much. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {change.time && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium tabular-nums"
                  style={{ color: accent }}
                >
                  <Icon.clock className="h-3 w-3" />
                  {change.time}
                </span>
              )}
              {change.etFrom && change.etTo ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] text-ink tabular-nums">
                  ET {change.etFrom}
                  <span aria-hidden className="text-ink-faint">→</span>
                  <span className="font-medium">{change.etTo}</span>
                </span>
              ) : change.etUnchanged ? (
                <span className="inline-flex items-center rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] text-ink-faint tabular-nums">
                  ET unchanged · {change.etUnchanged}
                </span>
              ) : null}
            </div>

            {/* Who and when — the same two things every message carries. The
                name leads, the time closes, separated by the middot the rest of
                the thread uses. Rendered only when known: an old event written
                before this carried an actor should say nothing rather than
                "undefined". */}
            {(by || at) && (
              <p className="mt-2 text-[11px] text-ink-faint">
                {by ? <span className="text-ink-muted">{by}</span> : null}
                {by && at ? " · " : null}
                {at ? (
                  <span data-figure className="tabular-nums">
                    {formatDate(at)} · {formatClock(at)}
                  </span>
                ) : null}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
