/* Relative and extensioned: the test runner is plain `node --test`, which
   resolves neither the `@/` alias nor an extensionless path. The domain import
   below is type-only and therefore erased, so it may keep the alias. */
import { mayReorder } from "../../auth/priority.ts";
import type { Employee, EmployeeId } from "@/lib/domain";

/**
 * Whose queue this viewer may reorder for a given task.
 *
 * Priority is per-assignee, so a task assigned to three people has three ranks
 * and "change the priority" is not a complete instruction until it says whose.
 * This resolves the candidates, and it is the ONLY place that decides — the
 * dialog renders from it and the entry points gate on it, so a control can
 * never appear for a change the repository would refuse.
 *
 * Both halves of the rule are applied, in the order the repository applies
 * them:
 *
 *  1. **Capability** — `task.priority.change` must reach that person. An
 *     employee reaches nobody but themselves; a manager reaches their direct
 *     reports; an administrator reaches everyone.
 *  2. **Not your own** — you do not set the order of your own work unless
 *     nobody manages you. `can()` cannot express this, because its `reaches()`
 *     returns true for yourself before scope is consulted.
 */
export function reorderableAssignees(input: {
  assignees: Employee[];
  actorId: EmployeeId;
  /** Whether the ACTOR has a manager. From `Viewer.hasManager`. */
  actorHasManager: boolean;
  /** `perms.can("task.priority.change", id)` — injected so this stays pure. */
  canReorder: (employeeId: EmployeeId) => boolean;
}): Employee[] {
  return input.assignees.filter(
    (a) =>
      input.canReorder(a.id) &&
      mayReorder({
        actorId: input.actorId,
        subjectId: a.id,
        actorHasManager: input.actorHasManager,
      }),
  );
}
