"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Field,
  InlineError,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useRepo } from "@/lib/hooks/useRepository";
import { formatDurationTimer, formatStamp } from "@/lib/utils/format";
import type { Feasibility } from "@/lib/rules/tasks/deadlineFeasibility";

/**
 * Will this land in time if it goes here?
 *
 * **This component calculates nothing.** It calls
 * `previewDeadlineFeasibility` and renders what comes back — the queue
 * simulation, the working calendar and the buffer all live in
 * `deadlineFeasibility.ts`, and a second opinion computed here would be a
 * second answer to the same question.
 *
 * It re-asks as the priority changes, debounced: somebody dragging through
 * five positions should not fire five queries, and an answer that arrives after
 * the one for the position they actually chose would render the wrong verdict.
 */

/** Long enough to skip the positions somebody passes through on the way. */
const SETTLE_MS = 350;

function Verdict({ result }: { result: Feasibility }) {
  const buffer = result.bufferSeconds;
  const ok = result.feasible;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span
        className={`inline-flex items-center gap-1.5 text-[13px] ${
          ok ? "text-ink" : "text-[var(--danger,#c4553d)]"
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            ok ? "bg-[var(--positive,#3f9d6b)]" : "bg-[var(--danger,#c4553d)]"
          }`}
        />
        {ok ? "\u2713 Deadline achievable" : "\u26a0 Deadline risk"}
      </span>
      {buffer !== null && (
        <span data-figure className="text-[12px] text-ink-faint">
          {buffer >= 0
            ? `${formatDurationTimer(buffer)} buffer remaining`
            : `misses by ${formatDurationTimer(-buffer)}`}
        </span>
      )}
    </div>
  );
}

export function FeasibilityPreview({
  employeeId,
  employeeName,
  taskId,
  proposedPriority,
  estimatedWorkSeconds,
  committedDeadline,
  selectable = false,
  onBudgetChange,
}: {
  /** Whose week this is measured against — the assignee, never the viewer. */
  employeeId: string | null;
  /** Named on the card, so it is never ambiguous whose workload was used. */
  employeeName?: string | null;
  /**
   * Whether the reader may move the task while previewing.
   *
   * Off where the position is decided elsewhere in the flow — offering a
   * control that does not persist would read as setting the priority.
   */
  selectable?: boolean;
  /**
   * Lets the panel drive the budget too.
   *
   * The parent keeps ownership — this reports a choice rather than holding one,
   * so the dropdown above and the chips here can never show different numbers.
   */
  onBudgetChange?: (seconds: number) => void;
  taskId?: string;
  /**
   * Where the reader is CONSIDERING putting it, 1-based.
   *
   * Optional, and omitting it is right wherever nobody is choosing. The rule
   * then uses where the task already sits in the assignee's queue, or the back
   * for one not in it yet. Passing a stand-in — `myRank ?? myStoredRank ?? 1`
   * was the one that shipped, and both are null unless the VIEWER is an
   * assignee — previewed every cross-department task at P1, so nothing was
   * ahead of it and it appeared to start immediately.
   */
  proposedPriority?: number | null;
  estimatedWorkSeconds: number;
  committedDeadline: string | null;
}) {
  const repo = useRepo();
  /* The position being PREVIEWED, which is not necessarily the one that will be
     saved — this card asks "what if", and the answer must be explorable
     without committing to it. Reset by the prop changing, so a real priority
     change elsewhere still leads. */
  const [tryPosition, setTryPosition] = useState<number | null>(null);
  /* Null means "wherever it really is" — passed straight through, never
     replaced with a guess. Only a reader who has pressed a chip or dragged a
     row has expressed a position. */
  const position = tryPosition ?? proposedPriority ?? null;

  /* The DRAGGED order: task ids front to back, or null for "however the engine
     ranks them". Null rather than a copy of the engine's order, so a queue that
     changes underneath — somebody finishes a task while this is open — is
     picked up instead of being pinned to a stale list. */
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [applied, setApplied] = useState(false);
  const subjectId = taskId ?? "__proposed__";

  /* Keyed by the inputs. A verdict computed for four hours must never be shown
     beside a dropdown reading twelve — so the answer carries the question it
     answers, and anything else reads as "still checking". */
  const key = `${employeeId}|${position}|${estimatedWorkSeconds}|${committedDeadline}|${order?.join(",") ?? ""}`;
  const [answer, setAnswer] = useState<{ key: string; result: Feasibility } | null>(
    null,
  );
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  /* The engine's answer for the CURRENT inputs, or nothing. An answer computed
     for four hours must never be shown beside a dropdown reading twelve. */
  const result = answer?.key === key ? answer.result : null;

  /* What "apply" would write: the employee's REAL tasks in the order on
     screen. A task not yet assigned to them cannot be in their queue, so it is
     dropped — its position is carried by the estimate this form is setting,
     not by a reorder of work it is not yet part of. Derived, not held: a stale
     copy would send an order the reader is no longer looking at. */
  const applyIds = (
    order ??
    result?.simulatedQueue.map((e) => e.taskId) ??
    []
  ).filter((id) => id !== "__proposed__");

  /* The ONE write this panel can make, and only from the button below.
     `reorderPriorities` is the same call the priority dialog uses, so a manager
     reordering from here goes through the same permission check, the same
     cascade and the same acknowledgement as anywhere else. */
  const [applyOrder, applyState] = useAction((r) =>
    r.reorderPriorities(employeeId ?? "", applyIds, reason.trim()),
  );
  const applying = applyState.isPending;
  const applyError = applyState.error;

  useEffect(() => {
    if (!employeeId || estimatedWorkSeconds <= 0) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      void repo
        .previewDeadlineFeasibility({
          taskId,
          employeeId,
          proposedPriority: position,
          estimatedWorkSeconds,
          committedDeadline,
          orderOverride: order,
        })
        .then((r) => {
          if (!cancelled) setAnswer({ key, result: r });
        })
        .catch(() => {
          /* A preview is an aid, not a gate. If it cannot be computed the form
             still works — saying so is better than a spinner that never
             resolves or a verdict nothing produced. */
          if (!cancelled) setFailedKey(key);
        });
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    repo,
    key,
    employeeId,
    taskId,
    position,
    estimatedWorkSeconds,
    committedDeadline,
    order,
  ]);

  if (!employeeId || estimatedWorkSeconds <= 0) return null;

  const failed = failedKey === key;

  if (failed) {
    return (
      <p className="mt-3 text-[12px] text-ink-faint">
        The deadline preview is unavailable. You can still set the priority.
      </p>
    );
  }

  if (!result) {
    /* Named rather than a bare skeleton: the reader has just changed a number
       and needs to know the figure below it is being redone, not that something
       is broken. */
    return (
      <p className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3 text-[12px] text-ink-faint">
        Checking deadline impact…
      </p>
    );
  }

  /* Dragging is offered only where trying a position is — the same rule, since
     both do the same thing by different means. A queue of one has no order to
     rearrange, so the handles would be decoration. */
  const reorderable = selectable && result.simulatedQueue.length > 1;

  const endDrag = () => {
    setDragId(null);
    setOverIndex(null);
  };

  /* Move the dragged row to where the gap is, and hand the WHOLE resulting
     order to the engine. The component decides where rows sit; it never works
     out what that means for a date. */
  const commitDrag = () => {
    if (!dragId || overIndex === null) return endDrag();
    const ids = result.simulatedQueue.map((e) => e.taskId);
    const from = ids.indexOf(dragId);
    if (from === -1) return endDrag();
    /* The gap index counts the dragged row while it is still in place, so a
       downward move lands one short without this. */
    const to = overIndex > from ? overIndex - 1 : overIndex;
    if (to !== from) {
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      setOrder(next);
      /* The chips read the same order, so the two controls cannot disagree
         about where this task now sits. */
      setTryPosition(next.indexOf(subjectId) + 1);
    }
    endDrag();
  };

  /* A chip is a drag by other means. It must move the task within whatever
     order is currently on screen — setting `tryPosition` alone would be
     ignored the moment an override exists, so the button would look broken. */
  const moveSubjectTo = (p: number) => {
    setTryPosition(p);
    if (!order) return;
    const from = order.indexOf(subjectId);
    if (from === -1) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, p - 1)), 0, subjectId);
    setOrder(next);
  };

  /* What "apply" would actually write: the employee's REAL tasks in the dragged
     order. A task not yet assigned to them cannot be in their queue, so it is
     dropped from the payload — its position is carried by the estimate this
     form is setting, not by a reorder of work it is not part of yet. */
  const changed = order !== null;

  /* Bars are drawn against the longest task, so the queue reads as relative
     effort. Against the TOTAL, every bar on a busy queue becomes a sliver. */
  const longest = Math.max(
    1,
    ...result.simulatedQueue.map((e) => e.estimatedDuration),
  );

  return (
    <div
      data-help="feasibility-preview"
      className="mt-3 rounded-inset border border-[var(--hairline)] bg-[var(--surface-sunken)] px-3.5 py-3"
    >
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Deadline feasibility
      </p>

      {/* WHOSE week. On a cross-department task the reader is a manager in a
          different department, and "based on the workload" without a name
          invites them to assume it is their own. */}
      <p className="mt-0.5 text-[12px] text-ink-faint">
        Based on {employeeName ? `${employeeName}\u2019s` : "the assignee\u2019s"}{" "}
        workload · queue position{" "}
        <span data-figure>P{result.simulatedPosition}</span>
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {result.estimatedStartTime && (
          <div>
            <dt className="text-[11px] text-ink-faint">Estimated start</dt>
            <dd data-figure className="text-[12px] text-ink-muted">
              {formatStamp(result.estimatedStartTime)}
            </dd>
          </div>
        )}
        {result.estimatedCompletionTime && (
          <div>
            <dt className="text-[11px] text-ink-faint">Estimated completion</dt>
            <dd data-figure className="text-[12px] text-ink">
              {formatStamp(result.estimatedCompletionTime)}
            </dd>
          </div>
        )}
        {result.deadline && (
          <div>
            <dt className="text-[11px] text-ink-faint">Required deadline</dt>
            <dd data-figure className="text-[12px] text-ink-muted">
              {formatStamp(result.deadline)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-2 border-t border-[var(--hairline)] pt-2">
        <Verdict result={result} />
      </div>

      {/*
        THE ASSIGNEE'S REAL QUEUE, in the order this placement would produce.
        Straight from `simulatedQueue`, which the engine built from
        `assigneePriorities[employeeId]` through the same builder production
        sorts on — no second list is assembled here, and none could be, because
        the component never sees a raw task.

        This is the context the decision actually needs: a buffer figure says
        whether it fits, and only the queue says what it displaces.
      */}
      {result.simulatedQueue.length > 0 && (
        <div className="mt-2 border-t border-[var(--hairline)] pt-2">
          <p className="text-[11px] text-ink-faint">
            {employeeName ? `${employeeName}\u2019s queue` : "Priority queue"}
          </p>

          <ol
            className="mt-1.5 space-y-1"
            onDragOver={(ev) => {
              /* Required, or the browser refuses the drop outright. */
              if (dragId) ev.preventDefault();
            }}
          >
            {result.simulatedQueue.map((e, i) => {
              const isThis = e.taskId === subjectId;
              const width = longest > 0 ? (e.estimatedDuration / longest) * 100 : 0;
              const dragging = dragId === e.taskId;
              /* The gap opens ABOVE this row when the pointer is over its top
                 half, and above the next one otherwise — so the placeholder
                 sits exactly where the row will land, not near it. */
              const gapAbove = dragId !== null && overIndex === i;
              return (
                <li key={e.taskId}>
                  {gapAbove && (
                    <div
                      aria-hidden
                      className="mb-1 h-7 rounded-[6px] border border-dashed border-ink/30 bg-ink/[0.04] transition-all"
                    />
                  )}
                  <div
                    draggable={reorderable}
                    onDragStart={(ev) => {
                      setDragId(e.taskId);
                      setOverIndex(i);
                      ev.dataTransfer.effectAllowed = "move";
                      /* Firefox drops the drag immediately without payload. */
                      ev.dataTransfer.setData("text/plain", e.taskId);
                    }}
                    onDragEnd={endDrag}
                    onDragOver={(ev) => {
                      if (!dragId) return;
                      ev.preventDefault();
                      const box = ev.currentTarget.getBoundingClientRect();
                      const above = ev.clientY < box.top + box.height / 2;
                      setOverIndex(above ? i : i + 1);
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      commitDrag();
                    }}
                    className={`rounded-[6px] px-1.5 py-1 transition-[opacity,background-color] duration-150 ${
                      isThis ? "bg-[var(--control)]" : ""
                    } ${dragging ? "opacity-40" : ""} ${
                      reorderable ? "cursor-grab active:cursor-grabbing" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {reorderable && (
                        <span
                          aria-hidden
                          className="w-2 shrink-0 self-center text-[11px] leading-none text-ink-faint/60 select-none"
                        >
                          {"\u22ee\u22ee"}
                        </span>
                      )}
                      <span
                        data-figure
                        className={`w-7 shrink-0 text-[11px] ${
                          isThis ? "text-ink" : "text-ink-faint"
                        }`}
                      >
                        P{e.position}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-[12px] ${
                          isThis ? "text-ink" : "text-ink-muted"
                        }`}
                      >
                        {isThis ? "This task" : e.title}
                      </span>
                      <span data-figure className="text-[11px] text-ink-faint">
                        {formatDurationTimer(e.estimatedDuration)}
                      </span>
                    </div>

                    <div
                      className={`mt-0.5 flex flex-wrap items-center gap-x-2 ${
                        reorderable
                          ? "pl-[calc(2.25rem+1rem)]"
                          : "pl-[calc(1.75rem+0.5rem)]"
                      }`}
                    >
                      {/* Effort as a bar, so the queue reads as a shape rather
                          than a column of numbers. */}
                      <span
                        aria-hidden
                        style={{ width: `${Math.max(4, width)}%` }}
                        className={`h-1 max-w-[45%] rounded-full transition-all duration-200 ${
                          isThis ? "bg-ink/70" : "bg-ink/20"
                        }`}
                      />
                      {/* WHEN it lands — the column the table was missing. */}
                      {e.completionTime && (
                        <span data-figure className="text-[11px] text-ink-faint">
                          {formatStamp(e.completionTime)}
                        </span>
                      )}
                      {/* Said either way: "no change" is the reassurance a reader
                          weighing a placement is actually looking for.

                          Worded "delayed", because the figure is WALL-CLOCK slip
                          and not extra effort. Six more hours of budget can delay
                          the task behind it by twenty-one — it spills past 18:00
                          and resumes next morning. That is the honest answer, but
                          a bare "+21:00:00" beside a four-hour task reads as the
                          budget having tripled. */}
                      {isThis ? (
                        <span className="text-[11px] text-ink-faint/70">
                          Added here
                        </span>
                      ) : (
                        <span
                          data-figure
                          className={`text-[11px] ${
                            e.movedLaterSeconds > 0
                              ? "text-[var(--danger,#c4553d)]"
                              : "text-ink-faint/70"
                          }`}
                        >
                          {e.movedLaterSeconds > 0
                            ? `delayed +${formatDurationTimer(e.movedLaterSeconds)}`
                            : "no change"}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* The gap after the last row, for a drop at the very end. */}
                  {dragId !== null &&
                    overIndex === i + 1 &&
                    i === result.simulatedQueue.length - 1 && (
                      <div
                        aria-hidden
                        className="mt-1 h-7 rounded-[6px] border border-dashed border-ink/30 bg-ink/[0.04] transition-all"
                      />
                    )}
                </li>
              );
            })}
          </ol>

          {selectable && (
            <div className="mt-2 space-y-1.5">
              {result.simulatedQueue.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-14 shrink-0 text-[11px] text-ink-faint">
                    Priority
                  </span>
                  {result.simulatedQueue.map((_, i) => {
                    const p = i + 1;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => moveSubjectTo(p)}
                        data-figure
                        /* Lit from the ENGINE's answer, not from `position` —
                           which is null until somebody chooses, and would
                           otherwise leave every chip dark on a task that
                           plainly sits somewhere. */
                        className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                          result.simulatedPosition === p
                            ? "bg-ink text-[var(--body-bg)]"
                            : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)]"
                        }`}
                      >
                        P{p}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Budget beside position, because the two trade off against each
                  other and a planner testing one without the other is guessing
                  at half the problem. */}
              {onBudgetChange && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-14 shrink-0 text-[11px] text-ink-faint">
                    Budget
                  </span>
                  {[1, 2, 4, 8, 12, 16].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => onBudgetChange(h * 3600)}
                      data-figure
                      className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                        estimatedWorkSeconds === h * 3600
                          ? "bg-ink text-[var(--body-bg)]"
                          : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)]"
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              )}

              {/* Nothing above this line has been saved. The panel is a
                  "what if" — and a planner who has just rearranged somebody's
                  week needs telling which of the two states they are in. */}
              {reorderable && (
                <div className="mt-1 border-t border-[var(--hairline)] pt-2">
                  {changed ? (
                    <>
                      <p className="text-[12px] text-ink-muted">
                        This order is a preview.{" "}
                        {employeeName ? `${employeeName}\u2019s` : "The"} real
                        queue is unchanged until you apply it.
                      </p>
                      {applyError && (
                        <div className="mt-2">
                          <InlineError message={applyError} />
                        </div>
                      )}
                      {applied ? (
                        <p className="mt-2 text-[12px] text-ink">
                          {"\u2713"} Priority applied.
                        </p>
                      ) : (
                        <div className="mt-2">
                          {/* Required by the same rule that governs every other
                              priority change: the person affected is shown who
                              moved their work and why. A planner reordering
                              from here is not exempt from that. */}
                          <Field
                            label="Why this order?"
                            hint="Recorded on the tasks and shown to the person whose queue this is."
                          >
                            <Textarea
                              rows={2}
                              value={reason}
                              onChange={(ev) => setReason(ev.target.value)}
                            />
                          </Field>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              tone="primary"
                              size="sm"
                              data-help="feasibility-apply-order"
                              disabled={applying || reason.trim().length === 0}
                              onClick={async () => {
                                const r = await applyOrder();
                                if (r.ok) setApplied(true);
                              }}
                            >
                              Apply this priority
                            </Button>
                            <Button
                              size="sm"
                              disabled={applying}
                              onClick={() => {
                                setOrder(null);
                                setTryPosition(null);
                                setReason("");
                              }}
                            >
                              Reset
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-[12px] text-ink-faint">
                      Drag a row to try a different order. Nothing is saved
                      until you apply it.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Named consequences, because a reader deciding between P1 and P3 is
          weighing exactly this. Kept as a sentence rather than only the "+4h"
          markers above, which are easy to miss while scanning. */}
      {result.affectedTasks.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-muted">
          Placing it at P{result.simulatedPosition} delays{" "}
          {result.affectedTasks
            .slice(0, 3)
            .map((t) => `${t.title} +${formatDurationTimer(t.movedLaterSeconds)}`)
            .join(", ")}
          {result.affectedTasks.length > 3 &&
            ` and ${result.affectedTasks.length - 3} more`}
          .
        </p>
      )}

      {/* Only where it misses — a feasible placement needs no advice, and
          offering some would imply something is wrong with it. */}
      {!result.feasible && result.suggestions.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--hairline)] pt-2">
          {result.suggestions.map((s) => (
            <li key={s.action} className="text-[12px] text-ink-muted">
              · {s.reason}
            </li>
          ))}
        </ul>
      )}

      {result.calculationTrace.length > 0 && (
        <div className="mt-2 border-t border-[var(--hairline)] pt-2">
          <button
            type="button"
            onClick={() => setShowTrace((v) => !v)}
            className="text-[11px] text-ink-faint underline decoration-[var(--hairline)] underline-offset-2 hover:text-ink-muted"
          >
            {showTrace ? "Hide" : "Why?"}
          </button>
          {showTrace && (
            <ol className="mt-1.5 space-y-0.5">
              {result.calculationTrace.map((line, i) => (
                <li key={`${i}-${line}`} className="text-[11px] text-ink-faint">
                  {line}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
