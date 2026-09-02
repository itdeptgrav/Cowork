"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icons";
import { formatClock, formatDate } from "@/lib/utils/format";

/**
 * A "submitted for review" event, rendered as an event — not the personal
 * bubble the engine's message came in as.
 *
 * The engine posts the submission AS the submitter, so it arrives right-aligned
 * with read ticks and reads like something they typed. It is a milestone in the
 * task, not a line in the conversation, so it belongs in the centre as an event:
 * a check, the note they wrote, whatever they attached as proof, and who and
 * when — the same shape the rework card uses on the other side of the cycle.
 *
 * The proof attachments are passed in already rendered (`attachments`), so this
 * card does not need to know how a chat draws media — it just gives it a place.
 */
export function SubmissionEventCard({
  byName,
  note,
  at,
  attachments,
}: {
  byName: string;
  note: string;
  at?: string | null;
  /** The message's attachments, rendered by the caller. */
  attachments?: ReactNode;
}) {
  return (
    <div className="my-3 flex justify-center">
      <div
        className="w-full max-w-[460px] rounded-panel border-l-2 bg-[var(--surface-raised)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-hairline)]"
        style={{ borderLeftColor: "var(--state-positive-ink)" }}
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
