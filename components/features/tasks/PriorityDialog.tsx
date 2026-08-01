"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Field, Select } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { FeasibilityPreview } from "./FeasibilityPreview";
import { usePermissions, useViewerId } from "@/lib/hooks/usePermissions";
import { reorderableAssignees } from "@/lib/rules/tasks/priorityAffordance";
import type { TaskView } from "@/lib/repositories";

/**
 * Reorder a person's task priorities by DRAGGING.
 *
 * Replaces the numeric "new rank" field this dialog used to carry. Priority is a
 * QUEUE, and it is now set the way a queue is understood: drag a row to where it
 * belongs and everything below shifts down to make room. It is an INSERT, never
 * a swap — moving P5 to P2 pushes the old P2 to P3, P3 to P4, P4 to P5.
 *
 * The drag surface, the live cascade preview, the reason and the write are
 * `FeasibilityPreview` in `selectable` mode — the same control the detail page
 * already uses, so the product has ONE drag-and-drop reorder rather than two,
 * and the write is the same `reorderPriorities` (a whole-queue renumber, which is
 * what makes the shift a cascade and not a two-row swap) with the same
 * permission check and acknowledgement.
 *
 * It reorders a NAMED person's queue rather than the viewer's own: priority is
 * per-assignee, so "this task's rank" is meaningless without saying whose list it
 * ranks in. The subject picker appears only when the viewer may reorder for more
 * than one of the task's assignees.
 */
export function PriorityDialog({
  view,
  onClose,
  onDone,
}: {
  view: TaskView;
  onClose: () => void;
  onDone: () => void;
}) {
  const me = useViewerId();
  const perms = usePermissions();
  const viewer = useQuery((repo) => repo.getViewer(), []);

  /* Whose queues this viewer may reorder for this task. Computed from the same
     predicate the repository refuses with, so the dialog cannot offer a subject
     the write will reject. */
  const subjects = reorderableAssignees({
    assignees: view.assignees,
    actorId: me ?? "",
    actorHasManager: viewer.data?.hasManager ?? true,
    canReorder: (id) => perms.can("task.priority.change", id),
  });

  const [subjectId, setSubjectId] = useState("");
  const subject =
    subjects.find((a) => a.id === subjectId) ?? subjects[0] ?? null;

  /* The queue is planned against working time, so a task with no budget has no
     place to compute — the preview needs one to simulate the order. */
  const workSecs =
    view.task.deadline.currentWindowSecs ?? view.task.estimatedEffortSecs ?? 0;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portals need a document — checked directly rather than via a mount effect.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prio-title"
      className="fixed inset-0 z-[90] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      {/* Bounded and scrolling INSIDE, because the panel is centred: a queue
          long enough to grow the panel re-centres it, which moves every row
          under a stationary pointer mid-drag and makes the measured offsets
          wrong. Native drag-and-drop auto-scrolls this container for free. */}
      <div className="frost-panel relative max-h-[85vh] w-[min(560px,96vw)] overflow-y-auto overscroll-contain rounded-panel px-6 py-5">
        <h2
          id="prio-title"
          className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
        >
          Reorder priorities
        </h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          Drag a task to move it — everything below shifts down to make room.
          Moving one up is an insert, not a swap.
        </p>

        {/* Whose queue. Only shown when there is a choice — a picker with one
            option is a label pretending to be a control. */}
        {subjects.length > 1 && (
          <Field label="Whose priority" className="mt-4">
            <Select
              value={subject?.id ?? ""}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              {subjects.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id === me ? `${a.displayName} (you)` : a.displayName}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {/* The reorder control itself: a draggable queue with a live cascade
            preview and its own Apply. `selectable` is what turns the read-only
            planning panel into the drag surface. */}
        {workSecs > 0 ? (
          <FeasibilityPreview
            employeeId={subject?.id ?? null}
            employeeName={subject && subject.id !== me ? subject.displayName : null}
            taskId={view.task.id}
            estimatedWorkSeconds={workSecs}
            committedDeadline={view.task.deadline.dueAt}
            subjectTitle={view.task.title}
            selectable
          />
        ) : (
          <p className="mt-4 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3 text-[12px] text-ink-faint">
            This task has no working-time budget yet, so its place in the queue
            cannot be planned. Set a time budget first.
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <Button tone="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
