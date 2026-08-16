"use client";

import { useState } from "react";
import { formatStamp } from "@/lib/utils/format";
import {
  reworkDeadlineMessage,
  reworkGrantNote,
  type ReworkDeadlineHeld,
} from "@/lib/rules/tasks/reworkDeadline";
import type { TaskView } from "@/lib/repositories";
import { EntityAttachments } from "@/components/features/attachments/Attachments";

/**
 * What a reviewer asked to be corrected, and every time they have asked.
 *
 * The assignee's side of rework. Before this, work came back with a status
 * change and a note buried in the review tab — the person had to work out for
 * themselves which of the acceptance criteria had failed. The reviewer now
 * names them, and this is where they are read.
 *
 * **Only the criteria the reviewer selected.** Showing the full checklist would
 * bury the two things that need fixing among the ones that were accepted, which
 * is the state this replaces.
 */

/** A rough kind, from the metadata the engine stores. Never a claim about content. */
function fileGlyph(type: string, name: string): string {
  const t = `${type} ${name}`.toLowerCase();
  if (/(png|jpe?g|gif|webp|image)/.test(t)) return "🖼";
  if (/pdf/.test(t)) return "📄";
  if (/(docx?|word)/.test(t)) return "📝";
  return "📎";
}

function Attachments({
  files,
}: {
  files: TaskView["reworkHistory"][number]["attachments"];
}) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {files.map((f, i) => (
        <li key={`${f.url}-${i}`}>
          {/* `rel="noopener"` because these are reviewer-supplied URLs opening
              in a new tab — the target must not reach back into this page. */}
          <a
            href={f.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] text-ink underline decoration-[var(--hairline)] underline-offset-2 hover:decoration-current"
          >
            <span aria-hidden>{fileGlyph(f.type, f.name)}</span>
            <span className="truncate">{f.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ReworkPanel({ view }: { view: TaskView }) {
  const [showHistory, setShowHistory] = useState(false);

  const history = view.reworkHistory;
  const active = view.reworkRequested;
  /* The request that produced the outstanding criteria — the last one. It
     carries the note and the files, which the bare criteria list does not. */
  const latest = history.length > 0 ? history[history.length - 1] : null;

  /* Nothing has ever come back: no panel at all, rather than an empty one
     announcing a process that has not happened. */
  if (active.length === 0 && history.length === 0) return null;

  return (
    <section
      data-help="rework-requested"
      className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface-raised)] p-4 backdrop-blur-xl sm:p-5"
    >
      {active.length > 0 ? (
        <>
          <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            Changes requested
          </p>
          <p className="mt-0.5 text-[15px] leading-snug text-ink">
            Please fix the following before resubmitting
          </p>

          <ul className="mt-3 space-y-1.5">
            {active.map((text) => (
              <li key={text} className="flex items-start gap-2 text-[14px] text-ink">
                <span
                  aria-hidden
                  className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border border-[var(--hairline)] text-[10px] text-ink-muted"
                >
                  ☐
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>

          {/**
           * **What the rework did to the deadline.**
           *
           * Ordinarily nothing is said: the clock was reset to a fresh working
           * hour and the new date is already on the task, where deadlines
           * belong.
           *
           * The exception is the one that generates the support question. A
           * submission handed in AFTER its deadline does not earn the reset, so
           * the task comes back still overdue — and an overdue task refuses to
           * start its timer. Without this the person is asked to redo the work
           * and finds the Play button dead, with nothing on screen joining the
           * two facts. The message names the rule and the way out.
           */}
          {latest?.deadlineHeldReason ? (
            <div className="mt-3 border-t border-[var(--hairline)] pt-3">
              <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                Deadline
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                {reworkDeadlineMessage({
                  moved: false,
                  reason: latest.deadlineHeldReason as ReworkDeadlineHeld,
                })}
              </p>
            </div>
          ) : (
            /**
             * **The new deadline, named.**
             *
             * The facts panel shows Expected completion — a projection of when
             * the work will finish — and withholds the deadline itself by an
             * earlier decision, so nowhere on the task said what the date now
             * was. A rework moved the deadline by a full hour and the screen
             * looked identical, which was reported as the rule not working when
             * the engine had written it correctly.
             *
             * Both dates, because one alone cannot show that anything changed —
             * and the change is the whole question a person has when their work
             * comes back.
             */
            latest?.newDeadline &&
            latest.newDeadline !== latest.previousDeadline && (
              <div className="mt-3 border-t border-[var(--hairline)] pt-3">
                <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                  New deadline
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink">
                  <span data-figure>{formatStamp(latest.newDeadline)}</span>
                </p>
                {latest.previousDeadline && (
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    Was <span data-figure>{formatStamp(latest.previousDeadline)}</span>.{" "}
                    {/* No figure. The window is `previousDeadline − submittedAt`
                        and this entry does not carry the submission time, so
                        any number derived here would be a guess — and a wrong
                        number beside a correct date is worse than no number.
                        The two dates above already show what changed. */}
                    {reworkGrantNote(null)}
                  </p>
                )}
              </div>
            )
          )}

          {latest?.note && (
            <div className="mt-3 border-t border-[var(--hairline)] pt-3">
              <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                Reviewer note
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                {latest.note}
              </p>
            </div>
          )}

          <div className="mt-3 border-t border-[var(--hairline)] pt-3">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Correction files
            </p>
            {/* Private files, fetched through the authenticated route. The
                shared component renders nothing when there are none, so the
                heading is the only thing to guard. */}
            <EntityAttachments entityType="rework" entityId={view.task.id} />
            {/* Legacy metadata-only entries, from before private storage. Their
                URLs are public Google links and cannot be re-fetched privately,
                so they are still rendered as plain links rather than dropped —
                dropping them would lose references somebody was sent. */}
            {latest && latest.attachments.length > 0 && (
              <Attachments files={latest.attachments} />
            )}
          </div>
        </>
      ) : (
        /* Resubmitted: the warning goes, the record stays. Somebody looking at
           a task that was returned twice should still be able to see why. */
        <p className="text-[13px] text-ink-muted">
          This task was sent back{" "}
          <span data-figure>{history.length}</span>
          {history.length === 1 ? " time" : " times"} and has since been
          resubmitted.
        </p>
      )}

      {history.length > 0 && (
        <div className="mt-3 border-t border-[var(--hairline)] pt-3">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-[12px] text-ink-faint underline decoration-[var(--hairline)] underline-offset-2 hover:text-ink-muted"
          >
            {showHistory ? "Hide" : "Show"} rework history (
            <span data-figure>{history.length}</span>)
          </button>

          {showHistory && (
            <ol className="mt-3 space-y-3">
              {[...history].reverse().map((r) => (
                <li
                  key={`${r.attempt}-${r.requestedAt ?? ""}`}
                  className="rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3"
                >
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink">
                    <span>
                      Rework <span data-figure>#{r.attempt}</span>
                    </span>
                    {r.reviewerName && (
                      <span className="text-ink-muted">
                        · requested by {r.reviewerName}
                      </span>
                    )}
                  </p>
                  {r.requestedAt && (
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      {formatStamp(r.requestedAt)}
                    </p>
                  )}

                  {r.requirements.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {r.requirements.map((text) => (
                        <li key={text} className="text-[13px] text-ink-muted">
                          · {text}
                        </li>
                      ))}
                    </ul>
                  )}

                  {r.reason && (
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                      {r.reason}
                    </p>
                  )}
                  {r.note && (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                      {r.note}
                    </p>
                  )}
                  <Attachments files={r.attachments} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
