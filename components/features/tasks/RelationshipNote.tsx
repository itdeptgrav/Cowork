"use client";

import { Panel } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { assignmentRelationship } from "@/lib/auth/assignment";
import { RELATIONSHIP_COPY } from "./relationshipCopy";
import type { TaskView } from "@/lib/repositories";

/**
 * Why this task runs on a budget or a fixed date, on the task itself.
 *
 * The new-task form explained this and the task did not, so the reasoning was
 * available for exactly as long as it took to press Create. The assignee — who
 * never saw the form — had no way to learn why their deadline could not be
 * negotiated, and the creator had no way to check their own reasoning later.
 *
 * Resolved with `assignmentRelationship`, the same function `createTask`
 * decided with, against the CREATOR's reporting line rather than the viewer's.
 * That distinction is the whole reason this component fetches anything: the
 * relationship that shaped the task is the one between the person who made it
 * and the people it went to, and a viewer who is neither would otherwise be
 * shown their own relationship to the assignees, which decided nothing.
 *
 * It states the rule and nothing about permissions. Whether the reader may
 * change any of it is a separate question, answered by the controls that do it.
 */
export function RelationshipNote({ view }: { view: TaskView }) {
  const creatorId = view.task.createdById;

  /* The CREATOR's reporting line, not the viewer's — resolved by the
     repository for that specific person. `getViewer` takes an id precisely so
     server-side and after-the-fact callers can ask about somebody other than
     the acting user, and it returns both the closure and the direct reports,
     which the resolver needs separately. */
  const hierarchy = useQuery((r) => r.getViewer(creatorId), [creatorId]);

  /* Nothing is rendered until the closure is known. A relationship computed
     against an empty hierarchy reads "outside your reporting line" for every
     task, which is a confident wrong answer rather than a slow one. */
  if (!hierarchy.data) return null;

  /* Held-back people count for describing the relationship: the task was
     shaped by who it is FOR, and during a cross-department gate they are not
     assignees yet. */
  const people = view.assignees.length ? view.assignees : view.pendingAssignees;

  const relationship = assignmentRelationship({
    creatorId,
    assigneeIds: people.map((e) => e.id),
    hierarchyIds: hierarchy.data.hierarchyIds,
    directReportIds: hierarchy.data.directReportIds,
    creatorDepartmentId: view.owner?.departmentId ?? null,
    departmentOf: (id) => people.find((e) => e.id === id)?.departmentId ?? null,
  });

  /* A task with nobody on it yet has no relationship to describe. */
  if (people.length === 0) return null;

  const copy = RELATIONSHIP_COPY[relationship.relation];
  const pending = view.task.status === "pending_approval";

  return (
    <Panel>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-sm font-medium text-ink">{copy.label}</h2>
        <span className="text-[11px] text-ink-faint">
          {view.owner?.displayName ?? "Someone"} →{" "}
          {people.map((e) => e.displayName).join(", ")}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        {copy.record}
      </p>

      {/* Which rule produced the gate the task is currently sitting behind.
          The approval panel says who and how far along; this says what about
          the assignment caused it, which is the part a reader cannot infer
          from a list of approvers. */}
      {pending && (
        <p className="mt-2.5 rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
          <span className="text-ink">Rule that applied:</span> {copy.rule}
        </p>
      )}
    </Panel>
  );
}
