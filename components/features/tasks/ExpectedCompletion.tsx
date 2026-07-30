"use client";

import { useEffect, useState } from "react";
import { useRepo } from "@/lib/hooks/useRepository";
import { formatDurationTimer, formatStamp } from "@/lib/utils/format";
import type { Feasibility } from "@/lib/rules/tasks/deadlineFeasibility";
import type { TaskView } from "@/lib/repositories";

/**
 * When this will realistically be finished, beside when it was asked for.
 *
 * **Two different facts, and the page showed only one.** The deadline on a task
 * is what the assignor typed; it says nothing about the queue the work actually
 * sits in. A task third in line behind sixteen hours of other work does not
 * become due sooner because somebody wrote an earlier date on it.
 *
 * So both are shown and each is labelled for what it is:
 *
 *   *Requested deadline* — the commitment. A constraint to be measured against.
 *   *Expected completion* — the answer, from this person's real queue.
 *
 * **Nothing is calculated here.** The figure comes from
 * `previewDeadlineFeasibility`, the same engine that powers the priority
 * preview — so the date on the detail page and the date in the planner cannot
 * disagree, which they certainly would if this component did its own sum.
 */

export function ExpectedCompletion({ view }: { view: TaskView }) {
  const repo = useRepo();
  /* Already chained by the repository for the assignee whose queue was
     fetched. Preferred over asking again: it is the SAME calculation, computed
     once for the whole queue, so the date here and the date on their list
     cannot drift apart. The query below is the fallback for a task whose queue
     was not fetched — a viewer who is neither the assignee nor first in line. */
  const chained = view.task.deadline.operationalDueAt;
  const [result, setResult] = useState<Feasibility | null>(null);
  const [failed, setFailed] = useState(false);

  /* The person who will DO it. A held cross-department task keeps them in
     `pendingAssigneeIds`, so that is checked first — otherwise the one stage
     where the question matters most would measure nobody. */
  const subject =
    view.pendingAssignees[0]?.id ?? view.assignees[0]?.id ?? null;
  const budgetSecs =
    view.task.deadline.currentWindowSecs ?? view.task.estimatedEffortSecs ?? 0;
  /*
   * NOT a position. This asks "when will it be done?", so where the task sits
   * is the rule's to answer from the employee's own queue.
   *
   * It used to be `view.myRank ?? view.myStoredRank ?? 1`, and both of those
   * are null unless the VIEWER is an assignee. A manager opening a
   * cross-department task is never an assignee, so it fell to 1 — the task was
   * previewed at the FRONT of the assignee's queue, nothing was ahead of it,
   * and it started now. On a task assigned to somebody with two jobs ahead of
   * it, this reported a 09:30 start and a completion three hours early.
   *
   * The assignee's real rank is not readable here — `myRank` is the viewer's —
   * so the honest move is to not answer a question this component cannot see
   * the answer to.
   */
  const requested = view.task.deadline.dueAt;

  useEffect(() => {
    if (chained) return;
    if (!subject || budgetSecs <= 0) return;
    let cancelled = false;
    void repo
      .previewDeadlineFeasibility({
        taskId: view.task.id,
        employeeId: subject,
        estimatedWorkSeconds: budgetSecs,
        committedDeadline: requested,
      })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        /* The requested deadline is still shown by the caller, so a failure
           here costs the extra fact rather than the whole field. */
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, view.task.id, subject, budgetSecs, requested, chained]);

  /* Nothing to compute against: no assignee, or no agreed budget. The requested
     deadline stands alone, which is honest — there is no queue answer yet. */
  if (!subject || budgetSecs <= 0 || failed) return null;

  const completion = chained ?? result?.estimatedCompletionTime ?? null;
  /* Measured against the commitment. With the chained date there is no engine
     answer to take a buffer from, so it is computed here — a subtraction of
     two timestamps, not a second opinion about when the work lands. */
  const buffer =
    chained && requested
      ? Math.round((Date.parse(requested) - Date.parse(chained)) / 1000)
      : (result?.bufferSeconds ?? null);

  if (!completion) {
    return (
      <p className="text-[12px] text-ink-faint">Working out completion…</p>
    );
  }

  return (
    <div>
      <p data-figure className="text-sm text-ink">
        {formatStamp(completion)}
      </p>
      {/* The comparison, which is the reason both dates are on screen. Without
          it a reader has to subtract two timestamps in their head. */}
      {buffer !== null && (
        <p
          className={`mt-0.5 text-[12px] ${
            buffer >= 0 ? "text-ink-faint" : "text-[var(--danger,#c4553d)]"
          }`}
        >
          {buffer >= 0 ? "✓ Finishes " : "⚠ Misses the requested deadline by "}
          <span data-figure>{formatDurationTimer(Math.abs(buffer))}</span>
          {buffer >= 0 ? " before the requested deadline" : ""}
        </p>
      )}
    </div>
  );
}
