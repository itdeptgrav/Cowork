"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icons";
import { formatClock, formatDate } from "@/lib/utils/format";

/**
 * A "submitted for review" event, rendered as an event — not the personal
 * bubble the engine's message came in as.
 *
 * The engine posts the submission AS the submitter, so it arrives with read
 * ticks and reads like something they typed. It is a milestone in the task, not
 * a line in the conversation, so it is drawn as an event: a check, the note they
 * wrote, whatever they attached as proof, and who and when — the same shape the
 * rework card uses on the other side of the cycle.
 *
 * **It takes a side, though, and that is the point of `mine`.** These cards were
 * centred, which said "the room announced this" about something one specific
 * person did — and left you reading the 11px name at the bottom to work out
 * which of you it was. A handover and a return are two people answering each
 * other, so they sit where their messages sit: yours on the trailing edge,
 * theirs on the leading edge. See `eventByViewer`, which owns the harder half of
 * that question for the rework line.
 *
 * The proof attachments are passed in already rendered (`attachments`), so this
 * card does not need to know how a chat draws media — it just gives it a place.
 */
export function SubmissionEventCard({
  byName,
  note,
  at,
  attachments,
  mine = false,
}: {
  byName: string;
  note: string;
  at?: string | null;
  /** The message's attachments, rendered by the caller. */
  attachments?: ReactNode;
  /** The viewer submitted this. Puts the card on the trailing edge, and the
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
            ? { borderInlineEndColor: "var(--state-positive-ink)" }
            : { borderInlineStartColor: "var(--state-positive-ink)" }
        }
      >
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)]"
            style={{ color: "var(--state-positive-ink)" }}
          >
            <Icon.check className="h-3.5 w-3.5" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">
              Submitted for review
            </p>

            {note && (
              <p className="mt-1 text-[13px] break-words text-ink-muted">{note}</p>
            )}

            {attachments && <div className="mt-2">{attachments}</div>}

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
