"use client";

import { EntityAttachments } from "@/components/features/attachments/Attachments";
import { useQuery } from "@/lib/hooks/useRepository";
import type { TaskView } from "@/lib/repositories";

/**
 * A task's files, kept in the groups they mean.
 *
 * **Three lists, not one.** Reference material the creator supplied, the
 * assignee's deliverables, and a reviewer's correction files answer different
 * questions — "what am I working from", "what did they hand in", "what has to
 * change" — and merging them loses that. The engine already separates them by
 * `entityType`; this renders the same separation.
 *
 * Every group is fetched through the authenticated attachment route. Nothing
 * here builds a storage URL, so a file is visible exactly to the people the
 * engine will serve it to.
 */

const GROUPS = [
  {
    entityType: "task" as const,
    title: "Reference files",
    hint: "Supplied when the task was created.",
  },
  {
    entityType: "rework" as const,
    title: "Correction files",
    hint: "Attached by a reviewer when work was sent back.",
  },
];

export function TaskFiles({ view }: { view: TaskView }) {
  const taskId = view.task.id;
  /*
   * Submissions are listed one at a time, not pooled.
   *
   * Each attempt's files hang off THAT submission's id, so a resubmission after
   * rework does not overwrite or merge with what came before — "Submission #1
   * had the old document, #2 has the corrected one" is the audit trail a
   * reviewer needs, and a single flat list destroys it.
   */
  const submissions = useQuery(
    (r) => r.listSubmissions(taskId),
    [taskId, view.task.updatedAt],
  );
  /*
   * The wrapper is always rendered and each group hides itself when empty.
   *
   * That leaves a bordered panel containing nothing on a task with no files at
   * all — accepted deliberately over the alternative, which is asking the
   * parent to know three counts it would have to fetch itself. The panel reads
   * as "this task has a place for files", which is true.
   */
  return (
    <section
      data-help="task-files"
      className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface-raised)] p-4 backdrop-blur-xl sm:p-5"
    >
      <p className="text-[15px] leading-snug text-ink">Files</p>
      <div className="mt-3 space-y-4">
        {/* Reference material from the creator. */}
        <EntityAttachments
          entityType="task"
          entityId={taskId}
          title={GROUPS[0].title}
          hint={GROUPS[0].hint}
        />

        {/* Oldest first, so the story reads forward. Each renders nothing when
            that attempt carried no files. */}
        {[...(submissions.data ?? [])].reverse().map((sub, i) => (
          <EntityAttachments
            key={sub.id}
            entityType="submission"
            entityId={sub.id}
            title={`Submitted work · attempt ${i + 1}`}
            hint="Handed in by the assignee."
          />
        ))}

        {/* Correction files from a reviewer. */}
        <EntityAttachments
          entityType="rework"
          entityId={taskId}
          title={GROUPS[1].title}
          hint={GROUPS[1].hint}
        />
      </div>
    </section>
  );
}
