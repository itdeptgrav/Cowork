import type { CompletionRequirement, Task, TaskStatus } from "@/lib/domain";

/**
 * When a project is done.
 *
 * The rule lives here rather than inside the repository because three callers
 * need the same answer and must not disagree: the repository refuses a
 * submission that would complete an unfinished project, the task view renders
 * the progress, and the subtask dialog decides what may be claimed. Three
 * copies of "is this satisfied" is three chances for the screen to say 3/5
 * while the server says 4/5.
 *
 * **Satisfaction is derived, never stored twice.** A requirement is satisfied
 * if the owner ticked it directly, OR if it has claiming subtasks and every one
 * of them has completed. The second half is computed from the subtasks' real
 * statuses on every read, so a subtask reopening un-satisfies its requirement
 * without anything having to remember to undo a flag.
 *
 * "Every one of them" rather than "any": splitting *Meeting system* across two
 * subtasks means both have to land. Treating one as sufficient would let half a
 * requirement close it, which is exactly the case somebody splits work to
 * avoid.
 */

/** A closed task can no longer contribute; a cancelled one never will. */
const DONE: TaskStatus = "completed";

/**
 * Who is answerable for a requirement.
 *
 * `delegated` the moment any live subtask claims it, and that is the whole rule:
 * handing an area of work to somebody is what transfers the authority to say it
 * is done. The parent's owner keeps oversight and loses the tick — they can see
 * the status and cannot assert it, because asserting it would let a project
 * close over work its own subtask says is still running.
 */
export type RequirementOwnership = "direct" | "delegated";

export interface RequirementState {
  requirement: CompletionRequirement;
  /** Subtasks claiming this requirement, in creation order. */
  claimants: Task[];
  /** Claimants that have completed. */
  completedClaimants: Task[];
  satisfiedDirectly: boolean;
  satisfiedByDelegation: boolean;
  isSatisfied: boolean;
  /**
   * `delegated` once anything claims it. Read this rather than re-deriving from
   * `claimants.length` at each call site — the UI decides whether to render a
   * control from it, and the repository decides whether to accept a tick, and
   * those two must not answer differently.
   */
  ownership: RequirementOwnership;
  /**
   * Whether a DIRECT tick is permitted at all, ignoring who is asking.
   *
   * The identity check stays in the repository; this is the state check. False
   * for anything delegated — nobody hand-ticks a delegated requirement, not the
   * parent's owner and not the subtask's assignee. The subtask satisfies it by
   * completing, which is the only route.
   */
  acceptsDirectTick: boolean;
}

export interface CompletionState {
  requirements: RequirementState[];
  satisfiedCount: number;
  total: number;
  /**
   * True once anything has been delegated. A task with requirements and no
   * subtasks is still an ordinary task with acceptance criteria — the container
   * is created by the act of breaking work down, not by writing a checklist.
   */
  isProject: boolean;
  /**
   * Whether this task may be submitted for completion.
   *
   * A task with NO requirements is unaffected — the overwhelming majority of
   * tasks, and gating them would turn an optional field into a mandatory one
   * across the whole product.
   */
  canComplete: boolean;
  /** Named for the refusal message, so the reader is told what is outstanding. */
  outstanding: string[];
}

export function completionState(
  task: Pick<Task, "requirements">,
  subtasks: Task[],
): CompletionState {
  const live = subtasks.filter((s) => s.status !== "cancelled" && !s.deletedAt);

  const requirements: RequirementState[] = [...task.requirements]
    .sort((a, b) => a.order - b.order)
    .map((requirement) => {
      const claimants = live.filter((s) =>
        s.satisfiesRequirementIds.includes(requirement.id),
      );
      const completedClaimants = claimants.filter((s) => s.status === DONE);
      const satisfiedDirectly = requirement.satisfiedAt !== null;
      const satisfiedByDelegation =
        claimants.length > 0 && completedClaimants.length === claimants.length;
      const ownership: RequirementOwnership =
        claimants.length > 0 ? "delegated" : "direct";
      return {
        requirement,
        claimants,
        completedClaimants,
        satisfiedDirectly,
        satisfiedByDelegation,
        isSatisfied: satisfiedDirectly || satisfiedByDelegation,
        ownership,
        acceptsDirectTick: ownership === "direct",
      };
    });

  const satisfiedCount = requirements.filter((r) => r.isSatisfied).length;
  const outstanding = requirements
    .filter((r) => !r.isSatisfied)
    .map((r) => r.requirement.text);

  return {
    requirements,
    satisfiedCount,
    total: requirements.length,
    isProject: live.length > 0,
    canComplete: requirements.length === 0 || outstanding.length === 0,
    outstanding,
  };
}

/**
 * Whether this task has stopped being work and become the container for it.
 *
 * The moment a task is broken down, execution moves to its children: they hold
 * the assignees, the time budget, the timer and the deadline, and the parent
 * holds the title, the brief and the requirements that say when the whole thing
 * is done. So a container shows no timer and no deadline of its own — not
 * because they are hidden, but because it has none. A budget on the parent and
 * budgets on each child would be two answers to "how long is this", and the
 * children's are the ones the engine actually counts.
 *
 * **Two signals, ORed, and neither alone is enough.** `isProject` is derived
 * from the children the repository read; `loadedSubtasks` is what the screen
 * has in hand. A read that returned the parent but not its children answers
 * false to the first and true to the second, and a screen that then rendered a
 * timer would offer the parent's owner a control that starts work nobody is
 * doing. Where they disagree, "there is something below this" wins.
 *
 * Deliberately NOT `subtaskCount`, which comes off the parent document's
 * `subtaskIds` array. That array is not pruned when a child is deleted, so a
 * task whose only subtask was removed would keep reading as a container and
 * would never get its own timer back.
 */
export function isProjectContainer(input: {
  /** `CompletionState.isProject` — from the children the read supplied. */
  isProject: boolean;
  /** Children this screen actually holds. */
  loadedSubtasks: number;
}): boolean {
  return input.isProject || input.loadedSubtasks > 0;
}

/**
 * Why a subtask cannot be created, or null.
 *
 * Separate from the repository so the dialog can refuse before a round trip and
 * the repository can refuse regardless — one rule, two enforcement points, and
 * the form never needs to guess at the wording.
 */
export function subtaskRefusal(input: {
  parent: Pick<Task, "requirements" | "status" | "parentTaskId">;
  satisfiesRequirementIds: string[];
}): string | null {
  const { parent, satisfiesRequirementIds } = input;

  if (parent.status === "completed")
    return "This task is already complete. Reopen it before delegating more work.";
  if (parent.status === "cancelled")
    return "This task was cancelled.";

  /* Depth of one. A subtask of a subtask makes "which project does this belong
     to" ambiguous, and every rule below — parent completion, requirement
     claiming, progress — assumes exactly two levels. Legacy allowed arbitrary
     depth and had none of these rules to break. */
  if (parent.parentTaskId)
    return "A subtask cannot be broken down further. Delegate from the project instead.";

  if (parent.requirements.length === 0)
    return "Add completion requirements to this task before breaking it down — a subtask has to contribute to one.";

  if (satisfiesRequirementIds.length === 0)
    return "Choose at least one completion requirement this subtask will satisfy.";

  const known = new Set(parent.requirements.map((r) => r.id));
  if (satisfiesRequirementIds.some((id) => !known.has(id)))
    return "One of the chosen requirements does not belong to this task.";

  return null;
}
