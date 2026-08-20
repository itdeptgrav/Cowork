/* Type-only imports, so this module carries no runtime dependency on the
   repository barrel and can be unit-tested under plain `node --test`. */
import type { TaskView } from "@/lib/repositories";
import { mayReview } from "./reviewChain.ts";
import { budgetTurn } from "./budgetNegotiation.ts";

/**
 * What "waiting on me" actually means.
 *
 * The Actionable inbox used to be populated by `nextAction(view, me).actor ===
 * "you"`, and that predicate answers a different question: *whose move is it*.
 * On a task you are already carrying the answer is always "yours" — "Start
 * work", "Submit when ready" — so every in-progress task you owned appeared in
 * an inbox meant for things that are stuck. The inbox became a second copy of
 * the task list, which is worse than not having one: two lists of the same work
 * teaches people to trust neither.
 *
 * The distinction this module draws instead:
 *
 *   **A decision is required from me, or the work cannot move until I respond.**
 *
 * Doing the work is not a decision. "Submit when ready" is an invitation with
 * no deadline attached to the answer; nothing is blocked by it and nobody is
 * waiting. Accepting a proposed window IS a decision — somebody asked, the task
 * sits in negotiation until you answer, and your silence holds it there.
 *
 * The test to apply to any new case: *if I never open this task, is anything
 * stuck?* If the only cost is that my own work does not advance, it belongs in
 * Tasks. If somebody else is waiting, or the task cannot change state without
 * me, it belongs here.
 *
 * **One resolver, many consumers.** The repository decides membership with this
 * function and the UI renders what it is handed — the same arrangement as
 * `assignmentRelationship`, and for the same reason: a list that filtered
 * client-side would eventually disagree with the count on the tab.
 */

export type ActionableReason =
  /** A workflow decision — approve, reject, set an effort estimate. */
  | "approval"
  /** Submitted work on my desk. */
  | "review"
  /** A deadline to decide, propose, accept or answer. */
  | "deadline"
  /** Intake: the work cannot start until I accept it. */
  | "intake"
  /** Stuck, and I am one of the people who can unstick it. */
  | "blocked"
  /**
   * I ran the timer on this today and have not filed a report.
   *
   * Not decided by `actionableFor` — this one is not a property of the task's
   * OWN state (status, deadline, approvals) but of TODAY'S timer activity
   * against it, which lives in `cowork_work_commits` / `cowork_task_timers`,
   * not on the task. The repository appends these separately; see
   * `lib/rules/tasks/dailyReport.ts`'s `isReportPending`.
   */
  | "daily_report";

export interface ActionableVerdict {
  reason: ActionableReason;
  /** The call to action, in the same words the task's own screen uses. */
  label: string;
  href: string;
}

/**
 * Is the assignor's proposed working window still awaiting an answer?
 *
 * Lives here rather than beside the status chips because the repository needs
 * the same answer and must not import from a component. `statusMeta` re-exports
 * it so its existing callers are unchanged.
 *
 * The five conditions are legacy's, from `page.js:8818`:
 *   !hasDueDate && status === "open" && hasTimer === true && !isSelfAssigned
 *   … and … senderSecs > 0 && !senderTimerRejected
 */
export function windowOnOffer(task: TaskView["task"]): boolean {
  return (
    !task.deadline.dueAt &&
    /*
     * An offer is open only while NOTHING has been said about it.
     *
     * This excluded `agreed` alone, which left `proposed` passing — so an
     * assignee who had just asked for more time was shown the accept card
     * again, on top of their own outstanding request. `pending_deadline_approval`
     * maps to status `assigned` and state `proposed`, so every other clause
     * here still passed and the card came straight back.
     *
     * `unset` is the whole of the open case. `proposed` and `countered` mean a
     * decision is sitting with somebody else, `extension_pending` likewise, and
     * `agreed` is settled — in none of them is there an offer for this person
     * to accept, and in the first two the person who would be accepting is the
     * one who asked.
     */
    task.deadline.state === "unset" &&
    task.status === "assigned" &&
    task.deadline.mode === "timer" &&
    task.type !== "self_assigned" &&
    (task.deadline.currentWindowSecs ?? 0) > 0 &&
    !task.deadline.assignorWindowRejection
  );
}

/**
 * The one place that decides whether a task belongs in the action inbox.
 *
 * Returns `null` for everything else, including work that is genuinely mine to
 * get on with. Order is significant: the checks run from the most specific
 * obligation to the least, so a task lands in exactly one section and cannot be
 * listed twice. A blocked task that also needs my approval is an approval — the
 * approval is the concrete thing I can do about it.
 */
export function actionableFor(
  view: TaskView,
  viewerId: string,
): ActionableVerdict | null {
  const { task } = view;
  const id = task.id;

  /* A closed task can hold no obligation. Guarded rather than assumed: a
     stale pending approval on a cancelled task would otherwise sit in
     somebody's inbox forever with no screen able to clear it. */
  if (
    task.status === "completed" ||
    task.status === "cancelled" ||
    task.status === "assignment_rejected" ||
    task.deletedAt
  )
    return null;

  const mine = view.assignments.some((a) => a.employeeId === viewerId);
  const isCreator = task.createdById === viewerId;

  /* 1 — a workflow decision addressed to me by name. */
  if (view.pendingApprovals.some((a) => a.approverId === viewerId)) {
    const kind = view.pendingApprovals.find(
      (a) => a.approverId === viewerId,
    )?.kind;
    return {
      reason: "approval",
      label: kind === "effort_estimate" ? "Set effort" : "Review",
      href: `/tasks/${id}`,
    };
  }

  /* 2 — submitted work whose current stage is mine. Later stages are not my
     turn yet, and putting them here would ask people to act out of order. */
  if (
    task.status === "in_review" &&
    view.latestSubmission !== null &&
    mayReview({
      chain: view.latestSubmission.reviewChain,
      currentStage: view.latestSubmission.currentStage,
      viewerId,
      submittedById: view.latestSubmission.submittedById,
    })
  )
    return {
      reason: "review",
      label: "Review submission",
      href: `/tasks/${id}/review`,
    };

  /* 3 — deadline decisions. Every branch here has somebody waiting on the
     other side of it: a proposal needs a verdict, a counter needs an answer,
     an offered window is held open, and an unset deadline stops the task
     being schedulable at all. */
  if (
    (task.deadline.state === "proposed" ||
      task.deadline.state === "extension_pending") &&
    isCreator
  )
    return {
      reason: "deadline",
      label:
        task.deadline.state === "extension_pending"
          ? "Decide the extension"
          : "Decide deadline",
      href: `/tasks/${id}/deadline`,
    };

  if (task.deadline.state === "countered" && mine)
    return {
      reason: "deadline",
      label: "Respond to counter",
      href: `/tasks/${id}/deadline`,
    };

  if (windowOnOffer(task) && mine)
    return {
      reason: "deadline",
      label: "Accept or discuss the time",
      href: `/tasks/${id}`,
    };

  if (task.deadline.state === "unset" && mine)
    return {
      reason: "deadline",
      label: "Propose a deadline",
      href: `/tasks/${id}/deadline`,
    };

  /*
   * 3e — a TIME BUDGET whose turn is mine, wherever the branches above missed
   * it. Every one of them decides "whose turn" from the task's own fields, and
   * two live cases are not expressible that way:
   *
   *  · **A self-assigned task.** The person who decides the hours is the
   *    assignee's MANAGER, who is neither an assignee nor the creator — the
   *    creator is the assignee, because they raised it themselves. So
   *    `isCreator` was false for the one person being waited on, and the task
   *    said "Waiting for {manager} to decide" while their Actionable tab said
   *    "Nothing waiting on you". `windowOnOffer` cannot help either: it
   *    excludes `self_assigned` outright.
   *  · **An ordinary task the assignee has countered.** The counter goes back
   *    to the ASSIGNOR, and `countered && mine` names the assignee.
   *
   * `budgetTurn` already answers this exactly — it is the one authority on
   * whose move a budget is, and `statusMeta`, `BudgetNegotiationCard` and the
   * task-flow diagram all defer to it. Recomputing the judgement here is how
   * this list and those screens would come to disagree, which is the fault
   * being fixed rather than a new way to have it.
   *
   * Placed LAST in this section deliberately: anything the branches above
   * already handle returns before reaching here, so nothing that works today
   * changes label or ordering. This only fills what fell through.
   */
  const budget = budgetTurn(view, viewerId);
  if (
    budget.ownerId === viewerId &&
    /* Not `unowned`: a turn the record cannot assign to anybody is a fault with
       its own notice, and putting it here would offer an action that no screen
       behind the link can actually perform. */
    !budget.unowned &&
    (budget.canAccept || budget.canPropose)
  )
    return {
      reason: "deadline",
      label:
        budget.state === "waiting_for_assignor"
          ? "Decide the time budget"
          : "Accept or discuss the time",
      href: `/tasks/${id}`,
    };

  /* 4 — intake. Confirming receipt is not busywork: the task holds at
     `assigned` until it happens, so the sender cannot tell whether the work has
     landed. It is the last obligation with somebody on the other side of it. */
  if (task.status === "assigned" && mine)
    return {
      reason: "intake",
      label: "Confirm receipt",
      href: `/tasks/${id}`,
    };

  /* 5 — blocked, and I am close enough to it to act. The model records that a
     task is blocked and why, but not who owns the blocker, so the honest reach
     is the two people already accountable for it: whoever is carrying it and
     whoever raised it. Anyone else seeing it in their inbox could not act. */
  if (task.isBlocked && (mine || isCreator))
    return {
      reason: "blocked",
      label: "Resolve the blocker",
      href: `/tasks/${id}`,
    };

  /* Everything else is work, not a decision:
       · `confirmed`   → "Start work"
       · `in_progress` → "Submit when ready"
     Both are mine to do and nothing is stuck behind them. They live in Tasks,
     Projects and Timeline, which is where you go to work rather than to unblock.
     This is the return that shrank the inbox. */
  return null;
}
