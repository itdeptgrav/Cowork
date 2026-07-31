import { holdersOf } from "./resolveTaskPriority.ts";
import type { TaskView } from "../../repositories/types.ts";

/**
 * Has this person accepted the work, and if not, what can they do about it?
 *
 * ## The bug this closes
 *
 * A task said **"Waiting for Umung Arora — you"** and offered Umung nothing.
 *
 * The acceptance control lived in `TaskDetail` as an inline condition:
 *
 * ```tsx
 * {v.task.status === "assigned" && v.task.deadline.state === "agreed" && (
 *   <Button>Confirm receipt</Button>
 * )}
 * ```
 *
 * **That gate is stricter than the engine's.** `confirmTaskReceipt` skips the
 * deadline requirement entirely for `hasTimer === true` (a budget task) and for
 * `hasTimer === false` (a date the assignor set at creation); only a legacy task
 * with `hasTimer` absent has to have a deadline first. So on an ordinary budget
 * task whose window was still being agreed, the engine would have accepted the
 * confirmation and the screen would not offer it.
 *
 * Worse, the fallback was suppressed too — the generic "Go" link carried
 * `v.task.status !== "assigned"`, so all three branches were false at once and
 * the card rendered *"Your move"* above nothing at all.
 *
 * ## Two rules, in opposite directions
 *
 * **Do not be stricter than the engine.** Where a precondition is the engine's to
 * judge, offer the control and let its refusal speak — it returns actionable
 * sentences like *"Please propose a deadline and get it approved before
 * confirming."* Hiding the button converts a message somebody can act on into a
 * screen with nothing on it.
 *
 * **Do not be looser about WHO.** `confirmTaskReceipt` requires
 * `task.assigneeIds.includes(employeeId)` and 403s otherwise, and the inline
 * condition had no viewer check at all — so the task's creator was shown "Confirm
 * receipt" on a write the engine would refuse. Offering a control to somebody the
 * write rejects is the same defect as the dead end, seen from the other side.
 *
 * ## Declining is not a state the engine has
 *
 * There is **no assignee-side decline route.** `assignment_rejected` exists in
 * this product's status union, but it maps from legacy's `"rejected"`, which is a
 * cross-department APPROVER refusing a gate — not the assignee refusing the work.
 * Assignment here is consent rather than permission: anybody may assign to
 * anybody, and the approval gates hold the work.
 *
 * What the engine *does* offer is `reject-sender-timer` — the assignee refusing
 * the TERMS, with a required reason, which opens the budget negotiation and
 * leaves the task exactly where it was. That is the honest refusal, and it is
 * named for what it does rather than dressed up as a decline that would silently
 * fail.
 */

export type AssignmentActionType =
  /** The assignee has to accept the work. */
  | "accept_assignment"
  /** Somebody else has to accept it, and we can name them. */
  | "await_assignee"
  /** Live, and the record names nobody who could accept. A fault. */
  | "unowned"
  /** Nothing outstanding — accepted, or never in this state. */
  | "none";

export interface AssignmentActions {
  actionType: AssignmentActionType;
  /** May this viewer accept? */
  canAccept: boolean;
  /**
   * May this viewer refuse the terms?
   *
   * NOT "decline the task" — no such transition exists. This is
   * `reject-sender-timer`: the assignee saying the proposed working time is not
   * enough, which reopens the negotiation. False where there is no proposed
   * window to refuse, because refusing nothing is not an action.
   */
  canRefuseTerms: boolean;
  /** Whose move it is. Null when nobody's, or when the record names nobody. */
  nextActor: string | null;
  /** One sentence naming the ACTION, so it reads from either side. */
  statusLabel: string;
}

const NOTHING: AssignmentActions = {
  actionType: "none",
  canAccept: false,
  canRefuseTerms: false,
  nextActor: null,
  statusLabel: "",
};

/**
 * Who is being waited on for acceptance.
 *
 * `holdersOf` rather than `assigneeIds`, so somebody still behind a
 * cross-department gate is recognised — the engine's own routes resolve
 * `pendingAssigneeId || assigneeIds[0]` for exactly that reason, and reading
 * `assigneeIds` alone is the omission that has now produced this class of bug
 * four times.
 */
export function pendingAccepters(view: TaskView): string[] {
  /* Read PER ASSIGNMENT, not off a task-level flag. Legacy records `confirmedBy`
     as an array and the mapper turns it into `TaskAssignment.confirmedAt` — so on
     a task given to three people, one having accepted does not speak for the
     other two, and a task-level "is it confirmed" would let two of them drop out
     of the wait silently. */
  const unconfirmed = view.assignments
    .filter((a) => a.confirmedAt === null)
    .map((a) => String(a.employeeId));

  /* Plus anybody still behind a cross-department gate. They hold the work and
     have no assignment row yet — the engine's own routes resolve
     `pendingAssigneeId || assigneeIds[0]` for exactly that reason, and reading
     the assignment rows alone is the omission that has now produced this class of
     bug four times. */
  return holdersOf({
    assigneeIds: unconfirmed,
    pendingAssigneeIds: view.pendingAssignees.map((p) => String(p.id)),
  });
}

/**
 * Is the task in the state where acceptance is the outstanding step?
 *
 * `assigned` is the whole of it. `confirmed` and everything past it have been
 * accepted; `draft` and `pending_approval` have not reached anybody yet; and a
 * closed task is not waiting on a person.
 */
function awaitingAcceptance(view: TaskView): boolean {
  return view.task.status === "assigned";
}

/**
 * **The one answer.** Asked by the card before it renders a control, and by the
 * repository before it accepts the write.
 *
 * Deliberately viewer-aware: `canAccept` is a question about a person, and a
 * component that had to combine "the state" with "am I the assignee" itself is
 * how the creator came to be offered a confirmation.
 */
export function getAssignmentActions(
  viewerId: string | null,
  view: TaskView,
): AssignmentActions {
  if (!awaitingAcceptance(view)) return NOTHING;

  /* **The working time is still being decided by the OTHER side.**
   *
   * A self task is the case that exposed this. The assignee PROPOSES the budget
   * when they make the task, and it waits on their manager
   * (`WAITING_FOR_ASSIGNOR`). Until the manager settles it there is nothing for
   * the assignee to accept — and offering them "Accept task" let them take the
   * work on at a figure their manager never approved, bypassing the approval
   * the self-task flow exists to impose. The card and the write both ask this
   * function, so returning nothing here closes the control AND the endpoint.
   *
   * The same is true mid-negotiation on an ordinary task once the assignee has
   * countered: the assignor holds the turn, the figure is not agreed, and
   * acceptance waits for it. `WAITING_FOR_ASSIGNEE` — the assignor's opening,
   * the assignee's turn — is deliberately NOT gated: that is the standard
   * "accept the terms" moment and accepting the assignment settles it. */
  if (view.budgetNegotiation?.state === "WAITING_FOR_ASSIGNOR") return NOTHING;

  const pending = pendingAccepters(view);
  if (pending.length === 0) return NOTHING;

  const me = viewerId ?? "";
  const mine = me !== "" && pending.includes(me);

  /* A live acceptance step with nobody who could take it. Reported as a fault
     rather than as a wait, because no amount of waiting resolves it — the fix is
     an assignment that names somebody. */
  const nameable = pending.some((id) => id.length > 0);
  if (!nameable) {
    return {
      actionType: "unowned",
      canAccept: false,
      canRefuseTerms: false,
      nextActor: null,
      statusLabel: "accept the assignment",
    };
  }

  if (!mine) {
    return {
      actionType: "await_assignee",
      canAccept: false,
      canRefuseTerms: false,
      nextActor: pending[0],
      statusLabel: "accept the assignment",
    };
  }

  return {
    actionType: "accept_assignment",
    canAccept: true,
    /* Only where there is a proposed window to refuse. The engine requires a
       `senderTimerWindowSecs` and refuses otherwise, so offering it on a
       fixed-date task would be a control that cannot land. */
    canRefuseTerms:
      view.task.deadline.mode === "timer" &&
      (view.task.deadline.currentWindowSecs ?? 0) > 0 &&
      !view.task.deadline.assignorWindowRejection,
    nextActor: me,
    statusLabel: "accept the assignment",
  };
}

/**
 * Why this viewer cannot accept, or null.
 *
 * **The write's copy of the same question**, so a control that renders is a write
 * that lands and a write that is refused was never offered. Returns the sentence
 * rather than a boolean, because every call site would otherwise invent its own
 * wording.
 *
 * Note what is NOT checked here: whether a deadline exists. That is the engine's
 * judgement — it skips the requirement for budget tasks and for assignor-set
 * dates — and duplicating it is what hid the control in the first place. Its
 * refusal is actionable and is shown as it arrives.
 */
export function acceptanceRefusal(input: {
  viewerId: string | null;
  view: TaskView;
}): string | null {
  const actions = getAssignmentActions(input.viewerId, input.view);

  if (actions.actionType === "none") {
    return "This task is not waiting to be accepted.";
  }
  if (actions.actionType === "unowned") return UNASSIGNED_ACCEPTANCE_NOTICE;
  if (!actions.canAccept) {
    /* The words the engine uses, so the screen and the server agree. */
    return "Only the person this task is assigned to can accept it.";
  }
  return null;
}

/** Why the terms cannot be refused, or null. */
export function refuseTermsRefusal(input: {
  viewerId: string | null;
  view: TaskView;
}): string | null {
  const actions = getAssignmentActions(input.viewerId, input.view);
  if (!actions.canAccept) {
    return acceptanceRefusal(input) ?? "You cannot answer for this assignment.";
  }
  if (!actions.canRefuseTerms) {
    return "There is no proposed working time on this task to send back. Ask for a different deadline instead.";
  }
  return null;
}

/**
 * What a reader is told when a task is waiting to be accepted by nobody.
 *
 * Names the cause and the fix. A task in this state cannot move by itself, and
 * telling somebody to wait for it would be asking them to wait for nothing.
 */
export const UNASSIGNED_ACCEPTANCE_NOTICE =
  "This task is waiting to be accepted but names nobody to accept it. That is a fault rather than a delay — ask whoever created it to assign somebody.";

/**
 * The refusal a non-assignee gets, quoted by the help corpus.
 *
 * Matches the engine's own `"Not assigned to this task."` in intent while saying
 * which person it means, because the reader is usually a manager or the creator
 * wondering why they cannot move it along.
 */
export const NOT_YOURS_TO_ACCEPT =
  "Only the person this task is assigned to can accept it.";
