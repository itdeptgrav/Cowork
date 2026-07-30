import type { ReportingTree } from "@/lib/legacy/hierarchy";

/**
 * Can this manager see this task?
 *
 * **Reporting line only. Never workflow state.**
 *
 * The bug this exists to fix: a cross-department task was visible to the
 * receiving manager ONLY because the engine surfaces every
 * `pending_department_approval` task org-wide for its approvers. Approving it
 * changes the status, that query stops matching, and the task vanished from
 * their view — at exactly the moment their reportee started work on it.
 *
 * So visibility was never really reporting-based; it was approval-based, and
 * approving is the one action guaranteed to end it. The two questions are
 * different and must stay separate:
 *
 *   *Who needs to act now?* — the workflow's business, and it moves.
 *   *Whose work is this to oversee?* — the reporting line's, and it does not.
 *
 * Both can be true at once: Pramod needs to start the work, and Rakesh still
 * oversees it because Pramod reports to him.
 */

/**
 * Everyone at or below this person in the primary reporting line.
 *
 * Breadth-first with a seen-set, because a cycle in HR data — A reports to B
 * reports to A — would otherwise hang the page rather than merely be wrong.
 */
export function reportingSubtree(
  tree: ReportingTree,
  managerId: string,
): Set<string> {
  const out = new Set<string>();
  const queue: string[] = [String(managerId)];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    const node = tree.byEmployee.get(id);
    for (const child of node?.directReportIds ?? []) {
      if (!out.has(child)) queue.push(child);
    }
  }
  return out;
}

/**
 * Does any assignee report to this manager?
 *
 * Includes a PENDING assignee: a cross-department task held at the gate keeps
 * the person in `pendingAssigneeIds`, and that is precisely the stage the
 * receiving manager most needs to see it. Waiting until the handover would hide
 * the task through the whole approval it is their job to make.
 *
 * The manager's own tasks count too — `reportingSubtree` includes them — so a
 * team view never omits its owner's work.
 */
export function canManagerViewTask(
  managerId: string | null,
  task: { assigneeIds: string[]; pendingAssigneeIds?: string[] },
  tree: ReportingTree,
): boolean {
  if (!managerId) return false;
  const reach = reportingSubtree(tree, managerId);
  const people = [...task.assigneeIds, ...(task.pendingAssigneeIds ?? [])];
  return people.some((id) => reach.has(String(id)));
}
