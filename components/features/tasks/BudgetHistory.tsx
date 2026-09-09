"use client";

import { useState } from "react";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime, formatDuration } from "@/lib/utils/format";
import {
  budgetHistoryView,
  creditCause,
  CREDIT_CAUSE_SHORT_LABEL,
  deadlineMoveEntries,
  deadlineTimelineChains,
  type CreditCause,
  type DeadlineMoveEntry,
} from "@/lib/rules/tasks/budgetHistory";
import { referenceTimes } from "@/lib/rules/tasks/deadlineOrigin";
import { Icon } from "@/components/ui/Icons";
import type { TaskId } from "@/lib/domain";

/**
 * Where a task's hours came from.
 *
 * A budget grows on its own — a break credited back, an offline span, an
 * approved emergency, a meeting attended — and until this existed the only
 * account of it was the number itself. "I was given nine hours and it says
 * 10:26:53" was an unanswerable question.
 *
 * ## It must reconcile with the figure beside it
 *
 * This sits under Time budget, so the two are read together. Every second of
 * the current budget is either the original grant, a listed credit, or named as
 * unaccounted — there is no fourth category and nothing is rounded away. A
 * panel whose rows quietly failed to add up to the number above it would be
 * worse than no panel, because a reader could not tell which figure to trust.
 *
 * Receipts only began recently, so on older tasks the unaccounted line is the
 * common case rather than the exception. It says what it is.
 */
export function BudgetHistory({
  taskId,
  countedFrom = null,
  createdAt = null,
  countedFromSource = null,
}: {
  taskId: TaskId;
  /**
   * The instant the deadline was counted from — `TaskDeadline.clockStartsAt`.
   *
   * Shown here rather than under the deadline itself: the date stays a single
   * clean figure, and the reasoning behind it sits with the other workings
   * somebody opens on purpose. One line, no rule name and no arithmetic —
   * OWNER DECISION, 16 Aug 2026.
   *
   * Null on tasks written before the engine stamped it, and then nothing is
   * said at all rather than a half sentence.
   */
  countedFrom?: string | null;
  /**
   * The task’s own creation instant, and the rule that chose the anchor.
   *
   * Both are needed to answer the question a reader actually has: the deadline
   * counted from ONE of these, and without the other on screen there is no way
   * to see that it moved — or that it did not.
   */
  createdAt?: string | null;
  countedFromSource?: string | null;
}) {
  const [open, setOpen] = useState(false);
  /* Fetched only once opened. Every task detail would otherwise pay for a
     collection read that most readers never look at. */
  const history = useQuery(
    (r) => (open ? r.getBudgetHistory(taskId) : Promise.resolve(null)),
    [taskId, open],
  );

  /* Only the instant is rendered. `deadlineOrigin` also resolves which rule
     chose it and the window added — kept, tested and deliberately not shown:
     the owner asked for one line and nothing else. */
  const rows = referenceTimes({
    createdAt,
    clockStartsAt: countedFrom,
    clockStartsAtSource: countedFromSource,
  });

  /* Read straight off the record the engine already wrote. Nothing here
     decides anything about a deadline — see `deadlineMoveEntries`. */
  const moves = history.data ? deadlineMoveEntries(history.data.deadlineMoves) : [];

  const view = history.data
    ? budgetHistoryView({
        givenSecs: history.data.givenSecs,
        currentSecs: history.data.currentSecs,
        credits: history.data.credits,
      })
    : null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] text-ink-faint underline decoration-[var(--hairline)] underline-offset-2 hover:text-ink"
      >
        {open ? "Hide history" : "History"}
      </button>

      {open && (
        <div className="mt-2 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5">
          {/* Before the figures, because it is the only part here that is not a
              figure: it says when the clock started, which is what the rest is
              measured from. Rendered whatever the history read does, since it
              needs no request of its own. */}
          {rows.length > 0 && (
            <div className="mb-2 space-y-0.5 border-b border-hairline pb-2">
              {rows.map((r) => (
                <p
                  key={r.label}
                  className={
                    /* The instant the arithmetic USED is the answer; the other
                       is only context for it. Weight and colour carry that, so
                       a reader sees which one counted without a label saying
                       so — the same way the budget figures below are read. */
                    "flex items-baseline justify-between gap-3 text-[11px] " +
                    (r.isReference ? "font-medium text-ink" : "text-ink-faint")
                  }
                >
                  <span>{r.label}</span>
                  <span data-figure>{formatDateTime(r.at)}</span>
                </p>
              ))}
              <p className="pt-0.5 text-[11px] text-ink-faint">
                {rows.length > 1
                  ? "Counted from the time in bold."
                  : "Counted from this time."}
              </p>
            </div>
          )}
          {history.isLoading || !view ? (
            <p className="text-[11px] text-ink-faint">Reading the history…</p>
          ) : (
            <>
              <Row
                label="Given"
                value={
                  view.givenSecs > 0
                    ? formatDuration(view.givenSecs)
                    : "not recorded"
                }
                muted={view.givenSecs === 0}
              />

              {view.entries.map((e) => (
                <div key={e.id} className="mt-1.5">
                  <Row
                    label={e.label}
                    value={`+ ${formatDuration(e.deltaSecs)}`}
                  />
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    {/* The engine's own sentence — it names the minutes and the
                        cause more precisely than the label can. */}
                    {e.reason}
                    {e.at ? ` · ${formatDateTime(e.at)}` : ""}
                  </p>
                </div>
              ))}

              {/**
               * Budget with nothing explaining it.
               *
               * Credits were applied for a long time before anything recorded
               * them, so this is the ordinary case on an existing task rather
               * than a fault. Saying "cause not recorded" is the difference
               * between a history that is honest about its own age and one that
               * silently disagrees with the figure above it.
               */}
              {view.unaccountedSecs > 0 && (
                <div className="mt-1.5">
                  <Row
                    label="Credited earlier"
                    value={`+ ${formatDuration(view.unaccountedSecs)}`}
                  />
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    Applied before this history was kept, so the cause was not
                    recorded. Credits from now on are listed individually.
                  </p>
                </div>
              )}

              <div className="mt-2 border-t border-hairline pt-2">
                <Row
                  label="Now"
                  value={formatDuration(view.currentSecs)}
                  strong
                />
              </div>

              {view.entries.length === 0 && view.unaccountedSecs === 0 && (
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  Nothing has been credited — this is the budget it was given.
                </p>
              )}

              {/**
               * **The deadline's own history, which had nowhere to appear.**
               *
               * Going offline moves a due date and does not touch the budget:
               * the work does not get smaller, the day simply has fewer hours
               * left to do it in. So everything above stayed correct — "Nothing
               * has been credited" was true — while sitting directly under a
               * deadline the reader had just watched move. Two different facts,
               * and only one of them had a place on this panel.
               *
               * Its own section rather than mixed into the credits, because a
               * row reading "+ 20m" means two different things in the two
               * lists: twenty minutes MORE WORK ALLOWED, or twenty minutes
               * LATER IN THE DAY. Interleaving them would make the panel
               * ambiguous in exactly the place it is read for certainty.
               */}
              {moves.length > 0 && <DeadlineTimeline moves={moves} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-[11px] ${strong ? "text-ink" : "text-ink-muted"}`}>
        {label}
      </span>
      <span
        data-figure
        className={`shrink-0 text-[11px] ${
          muted ? "text-ink-faint" : strong ? "text-ink" : "text-ink-muted"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** One glyph per cause — the same classification the credits list above uses. */
const CAUSE_ICON: Record<CreditCause, keyof typeof Icon> = {
  break: "break",
  offline: "offline",
  emergency: "emergency",
  meeting: "meeting",
  extension: "extension",
  /* No cause the engine's own wording matches — the clock is what every node
     in this timeline already uses, so an unclassified segment reads as
     "something moved the deadline" rather than claiming a cause it does not
     have. */
  other: "clock",
};

/**
 * The deadline's own history, as a connected staircase.
 *
 * ## Replaces a flat list with the shape the reader is actually looking for
 *
 * Each move used to print on its own — a label, a signed duration, a sentence,
 * a recorded-at stamp — with no visual link to the move beside it. Reading
 * "the deadline moved from 13:54, and, separately, it moved to 15:38" left the
 * arithmetic to the reader. A staircase reads it in the order it happened:
 * where the deadline started, what pushed it, where it landed — and the next
 * push starts exactly where the last one left off, because it did.
 *
 * ## What is on it, and the one thing that deliberately is not
 *
 * Every date on the rail is `fromIso`/`toIso` off the engine's own
 * `DeadlineMove` record. What is NOT here: the actual clock window somebody
 * was offline or on a break for. That is never written anywhere — see
 * `deadlineTimelineChains` — so rather than print a time that looks exact and
 * is not, the segment says what the record actually proves: the cause, the
 * credited duration, and when it was recorded.
 */
function DeadlineTimeline({ moves }: { moves: readonly DeadlineMoveEntry[] }) {
  const chains = deadlineTimelineChains(moves);
  const lastChainIdx = chains.length - 1;

  return (
    <div className="mt-3 border-t border-hairline pt-2.5">
      <p className="mb-2 text-[11px] font-medium text-ink-muted">
        Deadline changes
      </p>
      <div className="space-y-3">
        {chains.map((chain, ci) => {
          const lastMoveIdx = chain.moves.length - 1;
          return (
            <div key={chain.moves[0].id} className="relative">
              {/* One rule per chain, running from the first node's centre to
                  the last's. Nodes and the cause icon both sit in a 16px rail
                  that centres them on this same x-position, so the line
                  passes cleanly behind whichever is drawn there. */}
              <div
                aria-hidden
                className="absolute left-2 top-2 bottom-2 w-px bg-hairline"
              />
              <ol className="relative">
                {chain.moves.map((m, i) => (
                  <li key={m.id}>
                    {i === 0 && (
                      <DeadlineNode
                        at={m.fromIso}
                        label={ci === 0 ? "Original deadline" : undefined}
                      />
                    )}
                    <DeadlineSegment move={m} />
                    <DeadlineNode
                      at={m.toIso}
                      label={
                        ci === lastChainIdx && i === lastMoveIdx
                          ? "Current deadline"
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One point on the rail: a date the deadline actually held. */
function DeadlineNode({ at, label }: { at: string; label?: string }) {
  return (
    <div className="relative flex items-center gap-2.5 py-1">
      <span className="grid h-4 w-4 shrink-0 place-items-center">
        <span
          className="h-2 w-2 rounded-full bg-ink-muted shadow-[0_0_0_3px_var(--surface-sunken)]"
          aria-hidden
        />
      </span>
      <p className="text-[11px] leading-tight">
        {label && <span className="font-medium text-ink">{label}</span>}
        {label && <br />}
        <span
          data-figure
          className={label ? "text-ink-muted" : "text-ink"}
        >
          {formatDateTime(at)}
        </span>
      </p>
    </div>
  );
}

/** One push on the rail: what moved the deadline, and by how much. */
function DeadlineSegment({ move: m }: { move: DeadlineMoveEntry }) {
  const cause = creditCause(m.reason || "");
  const later = m.deltaSecs > 0;
  const CauseIcon = Icon[CAUSE_ICON[cause]];

  return (
    <div className="relative flex gap-2.5 py-1">
      <span className="grid h-4 w-4 shrink-0 place-items-center bg-[var(--surface-sunken)]">
        <CauseIcon className="h-3.5 w-3.5 text-ink-faint" />
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium text-ink-muted">
            {CREDIT_CAUSE_SHORT_LABEL[cause]}
          </span>
          <span data-figure className="shrink-0 text-[11px] text-ink-muted">
            {later ? "+" : "−"} {formatDuration(Math.abs(m.deltaSecs))}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {/* The engine's own sentence — it names the cause and the minutes
              more precisely than the short label above can. */}
          {m.reason ||
            (m.automatic ? "Applied automatically." : "Approved change.")}
        </p>
        <p className="text-[11px] text-ink-faint/80">
          Recorded <span data-figure>{formatDateTime(m.at)}</span>
        </p>
      </div>
    </div>
  );
}
