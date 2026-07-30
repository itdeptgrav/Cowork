import type { TaskType } from "@/lib/domain";

/**
 * How many people a task may be assigned to.
 *
 * **The rule is per TYPE, not global.** A standard task is one person's
 * responsibility, and the multi-assignee behaviour it inherited created a
 * question nobody could answer cleanly: when two people hold one task, whose
 * score does it move? Owner decision O9 answers that today with
 * `primary_only` — the first assignee is measured and the rest are invisible,
 * which is a reporting gap rather than a design.
 *
 * Restricting the types that do not need several people removes the question
 * instead of answering it.
 *
 * `recurring` genuinely does need several: a repeating obligation — a weekly
 * report, a rota — is held by a group, and each occurrence falls to whoever is
 * on it. That is the one type where more than one assignee is the point.
 */

/**
 * Types that may hold more than one assignee.
 *
 * **Exactly one: `recurring`.** Owner decision, 2026-07-28. A repeating
 * obligation — a rota, a weekly report — is genuinely held by a group, and each
 * occurrence falls to whoever is on it. Every other type is one person's
 * responsibility, which is what removes the "whose score moves" question that
 * O9 currently answers with `primary_only`.
 *
 * A list rather than a comparison so the policy is data, not control flow.
 */
export const MULTI_ASSIGNEE_TYPES: readonly TaskType[] = ["recurring"];

export function allowsMultipleAssignees(type: TaskType): boolean {
  return MULTI_ASSIGNEE_TYPES.includes(type);
}

/**
 * Why this set of assignees is not acceptable for this task type, or null.
 *
 * Pure, and the single authority: the creation form renders from it, the
 * repository refuses with it, and a server route will re-run it. Three
 * enforcement points, one rule — so a form can never submit something the
 * write rejects, and a client that bypasses the form is refused anyway.
 */
export function assigneeCountRefusal(input: {
  type: TaskType;
  assigneeIds: readonly string[];
  /**
   * Whether this task requires an assignee at all.
   *
   * A draft may legitimately have none. The caller decides; this only holds the
   * COUNT rule, not the lifecycle rule about when one becomes mandatory.
   */
  required?: boolean;
}): string | null {
  const count = new Set(input.assigneeIds).size;

  if (input.required !== false && count === 0)
    return "Choose at least one assignee.";

  if (!allowsMultipleAssignees(input.type) && count > 1)
    return `A ${label(input.type)} task is one person's responsibility. Choose a single assignee.`;

  return null;
}

/**
 * Why this assignee is not acceptable on a self-assigned task, or null.
 *
 * A self-assigned task is somebody taking work on themselves, with an approver
 * signing it off. Naming a DIFFERENT person turns it into an ordinary
 * assignment wearing the self-assignment approval route — which would let
 * somebody route work to a colleague through a gate designed for their own.
 *
 * Enforced in the domain, not the form: the type and the assignee arrive
 * together on one input, and only this layer sees both.
 */
export function selfAssignmentRefusal(input: {
  type: TaskType;
  assigneeIds: readonly string[];
  /** The person creating the task. */
  creatorId: string;
}): string | null {
  if (input.type !== "self_assigned") return null;
  const others = input.assigneeIds.filter((id) => id !== input.creatorId);
  if (others.length > 0)
    return "A self-assigned task is work you take on yourself. Choose a standard task to assign somebody else.";
  return null;
}

/** Whether adding another assignee is permitted right now. */
export function canAddAssignee(
  type: TaskType,
  currentCount: number,
): boolean {
  return allowsMultipleAssignees(type) || currentCount < 1;
}

function label(type: TaskType): string {
  return type === "self_assigned" ? "self-assigned" : type;
}

/**
 * Existing records that break the rule.
 *
 * Reporting, never repair. Silently dropping somebody from a task they were
 * assigned removes work from their queue and their score with no record of it
 * having happened — a migration must surface those rows and let a human decide.
 */
export function overAssignedTasks<
  T extends { id: string; type: TaskType },
>(input: {
  tasks: readonly T[];
  assigneeIdsFor: (taskId: string) => readonly string[];
}): { task: T; assigneeIds: readonly string[] }[] {
  return input.tasks
    .map((task) => ({ task, assigneeIds: input.assigneeIdsFor(task.id) }))
    .filter(
      ({ task, assigneeIds }) =>
        !allowsMultipleAssignees(task.type) &&
        new Set(assigneeIds).size > 1,
    );
}
