"use client";

import { Icon } from "@/components/ui/Icons";
import { Chip } from "@/components/ui/Primitives";
import { formatClock, formatDate } from "@/lib/utils/format";

/**
 * A rework, rendered as an event people notice — not the 11px grey whisper the
 * engine's system line rendered as before.
 *
 * A rework is a decision about somebody's work AND their score: it sends the
 * task back, and it either costs points or, where the reviewer waived it, does
 * not. Both facts belong on screen. The reason comes from the chat line; the
 * deduction outcome comes from the rework record matched to it, so the card can
 * say plainly "−0.2 pts, deducted" or "deduction waived — no points cut".
 *
 * `deductionWaived` is null when no record could be matched (an old line, a
 * number that did not line up): the card still shows the reason and who sent it
 * back, and simply omits the score line rather than guessing at it.
 *
 * **It sits on the reviewer's side, not in the middle.** A rework is one person
 * answering another, so it takes the side their messages take. The engine posts
 * this line as `system`, so the reviewer is named in the sentence rather than
 * carried as a sender id — `eventByViewer` is what resolves that name back to a
 * person, and it answers "not yours" rather than guessing when it cannot.
 */
export function ReworkEventCard({
  byName,
  occurrence,
  reason,
  at,
  deductionWaived,
  deductionPoints,
  waiverReason,
  mine = false,
}: {
  byName: string;
  occurrence: number;
  reason: string;
  at?: string | null;
  /** From the matched rework record; null when none was matched. */
  deductionWaived: boolean | null;
  /** Points a rework costs when it is not waived. */
  deductionPoints: number;
  waiverReason?: string | null;
  /** The viewer sent this back. Puts the card on the trailing edge, and the
   *  accent on the outer edge so it mirrors rather than pointing inward. */
  mine?: boolean;
}) {
  return (
    <div className={`my-3 flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`w-full max-w-[460px] rounded-panel bg-[var(--event-card)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-hairline)] ${
          mine ? "border-e-2" : "border-s-2"
        }`}
        style={
          mine
            ? { borderInlineEndColor: "var(--state-rework-ink)" }
            : { borderInlineStartColor: "var(--state-rework-ink)" }
        }
      >
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)]"
            style={{ color: "var(--state-rework-ink)" }}
          >
            <Icon.sync className="h-3.5 w-3.5" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-medium text-ink">
                Sent back for rework
              </p>
              {occurrence > 0 && <Chip tone="rework">Rework #{occurrence}</Chip>}
            </div>

            <p className="mt-1 text-[13px] break-words text-ink-muted">
              <span className="text-ink-faint">Reason: </span>
              {reason || "—"}
            </p>

            {/* The score outcome — the point of the waiver checkbox. */}
            {deductionWaived !== null && (
              <div className="mt-2">
                {deductionWaived ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--state-positive)_22%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--state-positive-ink)]">
                    <Icon.check className="h-3 w-3" />
                    Deduction waived · no points cut
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--state-overdue)_22%,transparent)] px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--state-overdue-ink)]">
                    −{deductionPoints} pt{deductionPoints === 1 ? "" : "s"} ·
                    deducted from this task&rsquo;s score
                  </span>
                )}
                {deductionWaived && waiverReason && (
                  <p className="mt-1 text-[11px] text-ink-faint">
                    Waiver: {waiverReason}
                  </p>
                )}
              </div>
            )}

            {(byName || at) && (
              <p className="mt-2 text-[11px] text-ink-faint">
                {byName ? <span className="text-ink-muted">{byName}</span> : null}
                {byName && at ? " · " : null}
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
