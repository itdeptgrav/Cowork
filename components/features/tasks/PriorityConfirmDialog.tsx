"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, Field, InlineError, Textarea } from "@/components/ui/Primitives";
import { formatStamp } from "@/lib/utils/format";
import {
  diffQueues,
  subjectOf,
  summariseDiff,
  type QueueSnapshotRow,
} from "@/lib/rules/tasks/priorityPreview";

/**
 * Confirm a priority change before anything is written.
 *
 * ## Ported, not invented
 *
 * Legacy had exactly this dialog — "Confirm Priority Change", `Moving "{title}"`,
 * a list of `P{old} → P{new}`, a **mandatory** reason with the placeholder
 * "e.g. Client escalation, needs to ship today", and Cancel beside Confirm. Its
 * wording is reused rather than reworded, because half the people who will see
 * this have seen the old one and a renamed control reads as a different control.
 *
 * ## What is added, and why
 *
 * Legacy listed only the rows whose rank changed, and showed no dates at all. It
 * therefore could not answer the question somebody actually has at this moment:
 * *what will my week look like after I press this*. So the list is the WHOLE
 * queue, before and after, each row carrying the date that order produces.
 *
 * ## The dates are the engine's, not this component's
 *
 * Both columns come from `previewDeadlineFeasibility` — one call, one clock —
 * and the difference between them is `diffQueues`, the same rule the employee's
 * receipt reads. Nothing here computes a date, and the two dialogs cannot
 * describe one reorder differently.
 *
 * **Expected completion is not the committed deadline**, and the two are in
 * separate columns under separate labels. Collapsing them into one column
 * headed "deadline" would tell somebody their commitment had moved when only
 * the projection had.
 */
export function PriorityConfirmDialog({
  subjectName,
  before,
  after,
  reason,
  onReason,
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  /** Whose queue this is. Named, because a priority belongs to a person. */
  subjectName: string | null;
  before: QueueSnapshotRow[];
  after: QueueSnapshotRow[];
  reason: string;
  onReason: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
  error?: string | null;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      /* Escape cancels. This dialog HAS a way out — unlike the employee's
         receipt, where the change has already happened and there is nothing to
         decline. */
      if (e.key === "Escape" && !pending) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  if (typeof document === "undefined") return null;

  const rows = diffQueues(before, after);
  const summary = summariseDiff(rows);
  const moved = subjectOf(rows);
  const blank = reason.trim().length === 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prio-confirm-title"
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => !pending && onCancel()}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative flex max-h-[88vh] w-[min(640px,96vw)] flex-col rounded-panel">
        <div className="shrink-0 px-6 pt-5 pb-3">
          <h2
            id="prio-confirm-title"
            className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
          >
            Confirm priority change
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            {moved ? (
              <>
                Moving <span className="text-ink">&ldquo;{moved.title}&rdquo;</span>
                {moved.previousRank !== null && moved.newRank !== null && (
                  <>
                    {" "}
                    from P{moved.previousRank} to P{moved.newRank}
                  </>
                )}
                {subjectName ? ` in ${subjectName}’s queue.` : "."}
              </>
            ) : (
              "Nothing has moved."
            )}{" "}
            {/* Positions and deadlines are counted separately on purpose: a
                reorder can move five rows and no deadline at all, and saying
                otherwise is the defect the cascade rule was rewritten over. */}
            {summary.delayed === 0
              ? "No deadline moves."
              : summary.delayed === 1
                ? "One deadline moves later."
                : `${summary.delayed} deadlines move later.`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 scroll-slim">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 border-b border-hairline pb-1.5">
            <span className="text-[10px] tracking-[0.09em] text-ink-faint uppercase">
              Now
            </span>
            <span aria-hidden />
            <span className="text-[10px] tracking-[0.09em] text-ink-faint uppercase">
              After this change
            </span>
          </div>

          <ol className="divide-y divide-hairline">
            {rows.map((row) => {
              const isSubject = moved?.taskId === row.taskId;
              return (
                <li
                  key={row.taskId}
                  className={`grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 py-2 ${
                    isSubject ? "bg-[var(--control)]" : ""
                  }`}
                >
                  <QueueCell
                    rank={row.previousRank}
                    title={row.title}
                    dueAt={row.previousDueAt}
                    muted
                  />
                  <span
                    aria-hidden
                    className={`text-[11px] ${
                      row.moved ? "text-ink" : "text-ink-faint/50"
                    }`}
                  >
                    →
                  </span>
                  <div>
                    <QueueCell
                      rank={row.newRank}
                      title={row.title}
                      dueAt={row.newDueAt}
                    />
                    {/* Said either way. "No change" is the reassurance somebody
                        weighing this is actually looking for. */}
                    <p
                      data-figure
                      className={`mt-0.5 text-[10.5px] ${
                        row.shiftedBySecs > 0
                          ? "text-[var(--state-overdue-ink)]"
                          : row.shiftedBySecs < 0
                            ? "text-[var(--state-positive-ink)]"
                            : "text-ink-faint/70"
                      }`}
                    >
                      {row.shiftedBySecs > 0
                        ? `later by ${describeShift(row.shiftedBySecs)}`
                        : row.shiftedBySecs < 0
                          ? `earlier by ${describeShift(-row.shiftedBySecs)}`
                          : "no change"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-3">
            <Field
              label="Reason for this change"
              hint="Recorded on the tasks and shown to the person whose queue this is."
            >
              <Textarea
                rows={2}
                autoFocus
                value={reason}
                placeholder="e.g. Client escalation, needs to ship today"
                onChange={(e) => onReason(e.target.value)}
              />
            </Field>
          </div>

          {error && (
            <div className="mt-2">
              <InlineError message={error} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pt-3 pb-5">
          <Button size="sm" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            tone="primary"
            size="sm"
            data-help="priority-confirm"
            /* Same rule as every other priority change: the person whose queue
               moved is told who moved it and why. Legacy required this on a drag
               and this does too. */
            disabled={pending || blank}
            onClick={onConfirm}
          >
            {pending ? "Applying…" : "Confirm"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function QueueCell({
  rank,
  title,
  dueAt,
  muted = false,
}: {
  rank: number | null;
  title: string;
  dueAt: string | null;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5">
        <span
          data-figure
          className={`shrink-0 text-[11px] ${muted ? "text-ink-faint" : "text-ink"}`}
        >
          {rank === null ? "—" : `P${rank}`}
        </span>
        <span
          className={`min-w-0 truncate text-[12px] ${muted ? "text-ink-faint" : "text-ink"}`}
          title={title}
        >
          {title}
        </span>
      </div>
      <p
        data-figure
        className={`mt-0.5 text-[10.5px] ${muted ? "text-ink-faint/70" : "text-ink-muted"}`}
      >
        {dueAt ? formatStamp(dueAt) : "No date"}
      </p>
    </div>
  );
}

/**
 * A shift, in the coarsest honest unit.
 *
 * Rounded to hours above a day and to minutes below an hour, because the figure
 * is WALL-CLOCK slip through a working calendar — a task can move "later by 21h"
 * on six hours of added work, since it spills past closing and resumes the next
 * morning. Displaying that to the second implies a precision the calendar does
 * not have.
 */
function describeShift(secs: number): string {
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}
