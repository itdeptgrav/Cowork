import type {
  DeadlineExtensionRecord,
  TimeBudgetExtensionRecord,
} from "./extensionRecords.ts";
import {
  getExtensionActions,
  type ExtensionActionType,
  type ExtensionActions,
} from "./extensionAuthority.ts";

/**
 * Whose move is it, and is there anything for them to press?
 *
 * **The bug this exists to close.** A counter-offer set the pending action to
 * the person who had asked — correctly — and no surface rendered for them. The
 * task said "Waiting for Pramod" and Pramod had no card, no banner and no
 * button. The state machine advanced; the UI did not follow it.
 *
 * So "who is next" is answered HERE, once, and a test asserts that every answer
 * this can return has a component that renders it. A state nobody can act on is
 * not a state — it is a dead end with a label.
 *
 * ## Two shapes of the same conversation
 *
 * *Internal* — the assignee's primary manager IS the assignor. One person owns
 * both the hours and the date, so there is nothing to escalate: they answer
 * once and the task goes back to work. Routing this through the cross-department
 * path would have Rakesh sending a request to Rakesh.
 *
 * *Cross-department* — they are different people, and the two decisions are
 * genuinely separate: the manager grants hours, the assignor moves dates.
 *
 * The shape is decided by comparing the two ids, never by a department field. A
 * task assigned within one department to somebody whose manager sits elsewhere
 * is still two people, and a task crossing departments to somebody the assignor
 * happens to manage is still one.
 */

export type HierarchyKind = "internal" | "cross_department";

export function hierarchyKind(input: {
  assignorId: string | null;
  primaryManagerId: string | null;
}): HierarchyKind {
  if (!input.assignorId || !input.primaryManagerId) return "cross_department";
  return input.assignorId === input.primaryManagerId
    ? "internal"
    : "cross_department";
}

/**
 * What the person whose turn it is can actually do.
 *
 * **An alias now, not a second enumeration.** `ExtensionActionType` in
 * `extensionAuthority.ts` is the list, and this module keeps its own name for the
 * existing call sites. Two unions describing one state machine is how
 * `confirm_budget` came to be absent from one of them while the record could
 * reach it.
 */
export type PendingActionKind = ExtensionActionType;

export interface PendingAction {
  kind: PendingActionKind;
  /** Who must act. Null only when the answer is "nobody", or when it is a fault. */
  ownerId: string | null;
  /** One sentence for a banner, in the second person where we know who. */
  prompt: string;
}

const NOTHING: PendingAction = { kind: "none", ownerId: null, prompt: "" };

/** `ExtensionActions`, in this module's older shape. */
function asPendingAction(actions: ExtensionActions): PendingAction {
  if (actions.actionType === "none") return NOTHING;
  return {
    kind: actions.actionType,
    ownerId: actions.nextActor,
    prompt: actions.statusLabel,
  };
}

/**
 * The outstanding move on an hours request.
 *
 * **Delegated.** This decided for itself that anything other than `pending` had
 * no turn, which made `approved` terminal — so a manager's answer closed the
 * conversation and the assignee, who still had to agree to the figure, was given
 * nothing to press. The record now has the state and this reads it.
 *
 * Not viewer-aware, deliberately: it answers "whose move is it", and every
 * caller that needs "may *I* act" should ask `getExtensionActions` directly
 * rather than comparing ids itself.
 */
export function budgetAction(
  record: TimeBudgetExtensionRecord | null,
): PendingAction {
  if (!record) return NOTHING;
  return asPendingAction(getExtensionActions(null, { budget: record }));
}

/**
 * The outstanding move on a date request.
 *
 * A counter-offer hands the turn BACK to whoever asked. That is the state that
 * had no surface: the record was correct, the timeline said so, and the person
 * named had nothing to press.
 */
export function deadlineAction(
  record: DeadlineExtensionRecord | null,
): PendingAction {
  if (!record) return NOTHING;
  return asPendingAction(getExtensionActions(null, { deadline: record }));
}

/**
 * The single outstanding move across both conversations.
 *
 * Exactly one, always. Two live turns on one task is how a person comes to be
 * shown two cards that contradict each other about what happens next — and the
 * hours question is always settled before the date question is raised, so an
 * overlap would be a bug rather than a legitimate state.
 */
export function pendingAction(input: {
  budget: TimeBudgetExtensionRecord | null;
  deadline: DeadlineExtensionRecord | null;
}): PendingAction {
  return asPendingAction(
    getExtensionActions(null, {
      budget: input.budget,
      deadline: input.deadline,
    }),
  );
}

/**
 * Does an internal request need a second step at all?
 *
 * When one person owns both decisions, granting the hours and moving the date
 * are the same conversation with the same approver. Escalating would send them
 * a request they themselves raised, which is the loop that left the task
 * "waiting" for somebody with nothing to do.
 */
export function needsDeadlineEscalation(_input: {
  kind: HierarchyKind;
  /** Whether the workload engine said the hours fit the commitment. */
  feasible: boolean;
}): boolean {
  /* **Never — the assignee's PRIMARY MANAGER owns the date too.**
   *
   * A cross-department extension used to escalate the date to the ASSIGNOR: the
   * manager granted the hours, then handed the commitment to whoever set it. But
   * a change to the assignee's week is the manager's call — the assignor set the
   * original date, they do not own changes to it. So the manager who grants the
   * hours also moves the deadline, in one card, whether or not they are the
   * assignor. Nothing leaves the assignee's management chain, and the decision
   * card shows "Approve and move the deadline" for cross-department work exactly
   * as it always did for internal work. */
  return false;
}

/**
 * "Rakesh needs to review the request for additional working time."
 *
 * Never a bare "Waiting for Rakesh". A name with no verb tells a reader that
 * somebody is blocking them and not what that person is expected to do — and
 * it says nothing at all to the person named, who is usually the one reading
 * it. Every prompt is phrased as the action, so the sentence works from either
 * side.
 */
export function waitingSentence(
  action: PendingAction,
  nameOf: (id: string) => string,
): string | null {
  /* `unowned` returns null for the same reason `waitingOnLabel` does: a prompt
     naming an action nobody can take is the reported bug, and it has its own
     notice that says it is a fault. */
  if (action.kind === "none" || action.kind === "unowned") return null;
  if (!action.ownerId) return null;
  return `${nameOf(action.ownerId)} needs to ${action.prompt}`;
}

/** Is this viewer the one being waited on? */
export function isMyMove(
  action: PendingAction,
  viewerId: string | null,
): boolean {
  return (
    action.kind !== "none" &&
    action.kind !== "unowned" &&
    viewerId !== null &&
    action.ownerId === viewerId
  );
}
