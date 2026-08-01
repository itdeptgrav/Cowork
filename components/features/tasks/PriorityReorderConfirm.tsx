"use client";

import { useState } from "react";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { PriorityConfirmDialog } from "./PriorityConfirmDialog";
import type { QueueSnapshotRow } from "@/lib/rules/tasks/priorityPreview";
import type { SimulatedEntry } from "@/lib/rules/tasks/deadlineFeasibility";

/**
 * The confirmation for a reorder made by dragging a row in the task LIST.
 *
 * The list's drag used to write the moment a row was dropped, with a reason
 * nobody typed — `"Reordered from the task list"` — so somebody's whole week
 * could be rearranged by an accidental drag, and the person whose queue it was
 * received a receipt citing a sentence no human had written. Both halves of that
 * are fixed here: nothing is written until Confirm, and the reason is theirs.
 *
 * ## Why the dates are fetched rather than read off the rows
 *
 * The table already knows each task's stored deadline, so a before column could
 * be assembled locally. The AFTER column could not: a new order re-chains every
 * date through the office calendar, and that is the engine's arithmetic. Asking
 * for both from one `previewDeadlineFeasibility` call is what keeps the two
 * columns comparable — same clock, same calendar, same rule the write itself
 * runs when it re-schedules the queue.
 */
export function PriorityReorderConfirm({
  employeeId,
  employeeName,
  subject,
  orderedTaskIds,
  onCancel,
  onDone,
}: {
  employeeId: string;
  employeeName: string | null;
  /** The row that was dragged. Its budget is what the preview is anchored on. */
  subject: {
    taskId: string;
    title: string;
    workSecs: number;
    committedDeadline: string | null;
  };
  /** The order the drop produced, front to back. */
  orderedTaskIds: string[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");

  const preview = useQuery(
    (r) =>
      r.previewDeadlineFeasibility({
        taskId: subject.taskId,
        employeeId,
        estimatedWorkSeconds: subject.workSecs,
        committedDeadline: subject.committedDeadline,
        /* The dragged order. `baselineQueue` comes back alongside it as the
           queue stands today, so one call answers both columns. */
        orderOverride: orderedTaskIds,
      }),
    [employeeId, subject.taskId, subject.workSecs, orderedTaskIds.join(",")],
  );

  const [apply, applyState] = useAction((r) =>
    r.reorderPriorities(employeeId, orderedTaskIds, reason.trim()),
  );

  /* The preview is what makes the dialog worth confirming, so it waits for it
     rather than showing an empty table. A failure is reported rather than
     silently rendering a change nobody can see the consequences of. */
  if (preview.isLoading || preview.error || !preview.data) {
    return (
      <PriorityConfirmDialog
        subjectName={employeeName}
        before={[]}
        after={[]}
        reason={reason}
        onReason={setReason}
        pending={preview.isLoading}
        error={
          preview.error
            ? `The new dates could not be worked out: ${preview.error}`
            : null
        }
        onCancel={onCancel}
        onConfirm={onCancel}
      />
    );
  }

  const title = (e: SimulatedEntry) =>
    e.taskId === subject.taskId ? subject.title : e.title;

  return (
    <PriorityConfirmDialog
      subjectName={employeeName}
      before={snapshot(preview.data.baselineQueue, title)}
      after={snapshot(preview.data.simulatedQueue, title)}
      reason={reason}
      onReason={setReason}
      pending={applyState.isPending}
      error={applyState.error}
      onCancel={onCancel}
      onConfirm={async () => {
        const r = await apply();
        if (r.ok) onDone();
      }}
    />
  );
}

function snapshot(
  entries: readonly SimulatedEntry[],
  titleFor: (entry: SimulatedEntry) => string,
): QueueSnapshotRow[] {
  return entries.map((e, i) => ({
    taskId: e.taskId,
    title: titleFor(e),
    rank: i + 1,
    dueAt: e.completionTime,
  }));
}
