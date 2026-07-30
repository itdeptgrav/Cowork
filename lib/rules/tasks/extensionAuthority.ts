import type {
  DeadlineExtensionRecord,
  TimeBudgetExtensionRecord,
} from "./extensionRecords.ts";

/**
 * Whose turn it is, and what they may do. **One function, both conversations.**
 *
 * ## The bug this closes
 *
 * The product had **two** budget state machines and neither could express the
 * step a user reported missing:
 *
 *  · The engine's `budgetNegotiation` — assignor ↔ assignee, symmetric, looping,
 *    transactional, with `waitingFor` as the permission. Complete.
 *  · Our `cowork_task_budget_extensions` record — assignee → primary manager,
 *    with `pending | approved | rejected` and nothing else. **Approval was
 *    terminal**, so "the manager granted your hours, now confirm them" was not a
 *    state the record could hold. The manager's approval applied the budget
 *    unilaterally.
 *
 * Two machines answering "whose turn is it on the budget" is one too many, and
 * the reported symptom — a waiting sentence with no button under it — came from
 * the seam between them.
 *
 * ## The other cause of the same symptom, which needed its own answer
 *
 * A live turn whose owner cannot be resolved. `waitingOnLabel` rendered
 * *"Waiting for the assignee to accept"* whenever the id was missing, while
 * `canAccept` was false for **everybody including that assignee**. The screen
 * named an action nobody could take.
 *
 * That is now `actionType: "unowned"` — a distinct, rendered, named fault rather
 * than a wait that happens to have no buttons. **An unowned turn is a bug in the
 * data, and it has to look like one**, because the fix is an administrator
 * completing a reporting line and no amount of waiting will produce it.
 *
 * ## Exactly one live turn
 *
 * Resolved in priority order and the order is deliberate:
 *
 *  1. **A live budget extension record.** The most specific thing happening.
 *  2. **The engine's negotiation.** The standing agreement about the figure.
 *  3. **The deadline record.** Raised only once the hours question is settled.
 *
 * Two live turns on one task is how somebody comes to be shown two cards that
 * disagree about what happens next.
 *
 * ## Used by the screens AND by the writes
 *
 * Every card asks this what to render, and every repository transition asks it
 * whether the caller may act. That is the point: a control cannot be offered to
 * somebody the write will refuse, and a write cannot accept somebody the screen
 * would not have offered it to.
 */

export type ExtensionActionType =
  /** A manager deciding an assignee's request for hours. */
  | "decide_budget"
  /**
   * The assignee confirming the figure their manager granted.
   *
   * **The state that did not exist.** A manager may grant fewer hours than were
   * asked for, so approval is an offer rather than a conclusion, and the person
   * doing the work has to agree to it before it binds them.
   */
  | "confirm_budget"
  /** An assignor deciding a manager's request to move the date. */
  | "decide_deadline"
  /** Whoever asked, answering a counter-offer that came back. */
  | "accept_counter"
  /** A live turn whose owner the record does not name. A fault, not a wait. */
  | "unowned"
  /** Nothing outstanding. */
  | "none";

export interface ExtensionActions {
  /** May this viewer agree to what is on the table? */
  canAccept: boolean;
  /** May this viewer put a different figure or date forward? */
  canNegotiate: boolean;
  /**
   * May this viewer end it with a refusal?
   *
   * False on every BUDGET turn, and that is a rule rather than an omission: a
   * refusal that ends an hours negotiation leaves work carrying a figure one
   * side never agreed to. Disagreeing means countering. A manager declining the
   * original request is the one exception — there is nothing yet to be bound by.
   */
  canReject: boolean;
  /** Who must act. Null only when nobody can, which is either "none" or a fault. */
  nextActor: string | null;
  /** One sentence naming the ACTION, so it reads from either side. */
  statusLabel: string;
  actionType: ExtensionActionType;
  /** Seconds on the table, where the turn is about a budget. */
  currentSecs: number;
  /** Which round of the loop this is. 0 where not applicable. */
  round: number;
}

const NOTHING: ExtensionActions = {
  canAccept: false,
  canNegotiate: false,
  canReject: false,
  nextActor: null,
  statusLabel: "",
  actionType: "none",
  currentSecs: 0,
  round: 0,
};

/** What the engine's negotiation document looks like once mapped. */
export interface NegotiationInput {
  state: string;
  currentSecs: number;
  proposedById: string;
  waitingForId: string | null;
  round: number;
}

export interface ExtensionState {
  /** The engine's standing budget agreement, where one is running. */
  negotiation?: NegotiationInput | null;
  /** A live request for MORE hours than were agreed. */
  budget?: TimeBudgetExtensionRecord | null;
  /** A live request to move the committed date. */
  deadline?: DeadlineExtensionRecord | null;
}

/**
 * Is this record still in play?
 *
 * `approved` is **not** terminal for a budget record any more: it means the
 * manager has answered and the assignee has not. `accepted` is the terminal
 * agreement, and `rejected` the terminal refusal.
 */
function budgetIsLive(record: TimeBudgetExtensionRecord): boolean {
  return (
    record.status === "pending" ||
    record.status === "approved" ||
    record.status === "counter_proposed"
  );
}

/**
 * The turn on a budget extension record.
 *
 * Three live states, and the owner alternates — which is what makes it a loop
 * rather than a request:
 *
 * | status | owner | what they may do |
 * |---|---|---|
 * | `pending` | the approver (manager) | grant, grant a different figure, or decline |
 * | `approved` | the requester (assignee) | accept it, or ask again |
 * | `counter_proposed` | the approver (manager) | the assignee asked again; answer again |
 */
function budgetActions(
  record: TimeBudgetExtensionRecord,
  viewerId: string | null,
): ExtensionActions {
  const me = viewerId ?? "";

  if (record.status === "pending" || record.status === "counter_proposed") {
    const owner = record.approverId;
    const mine = me !== "" && owner === me;
    return {
      canAccept: mine,
      canNegotiate: mine,
      /* Only on the FIRST answer. Once the assignee has been offered a figure
         and asked again, the conversation is a negotiation and ending it by
         refusal would leave the work on terms nobody settled. */
      canReject: mine && record.status === "pending",
      nextActor: owner,
      statusLabel:
        record.status === "pending"
          ? "review the request for additional working time"
          : "answer the revised request for working time",
      actionType: owner ? "decide_budget" : "unowned",
      currentSecs: agreedOrRequestedSecs(record),
      round: record.round,
    };
  }

  /* `approved` — the manager has answered and the ASSIGNEE has the move. This
     is the state the reported bug was about. */
  const owner = record.requestedBy || null;
  const mine = me !== "" && owner === me;
  return {
    canAccept: mine,
    canNegotiate: mine,
    /* An assignee does not refuse hours they asked for. Disagreeing is asking
       for a different number, which keeps the conversation open. */
    canReject: false,
    nextActor: owner,
    statusLabel: "confirm the working time their manager granted",
    actionType: owner ? "confirm_budget" : "unowned",
    currentSecs: agreedOrRequestedSecs(record),
    round: record.round,
  };
}

/**
 * The figure on the table.
 *
 * `approvedSecs` when the manager named one — they may grant fewer hours than
 * were asked for, and it is their figure the assignee is being asked to accept.
 * Falling back to what was requested would show the assignee their own number
 * and hide the change they are supposed to be confirming.
 */
export function agreedOrRequestedSecs(
  record: TimeBudgetExtensionRecord,
): number {
  return record.approvedSecs ?? record.newBudgetSecs;
}

/** The turn on the engine's standing negotiation. */
function negotiationActions(
  negotiation: NegotiationInput,
  viewerId: string | null,
): ExtensionActions {
  const me = viewerId ?? "";

  if (!negotiation.state || negotiation.state === "ACCEPTED") return NOTHING;

  const owner = negotiation.waitingForId;
  /* The turn IS the permission, and it is the engine's own field — set to the
     OTHER side on every counter, so "you cannot decide your own proposal" is a
     consequence of the state rather than a second rule that could disagree. */
  const mine = me !== "" && owner !== null && owner === me;
  const waitingForAssignor = negotiation.state === "WAITING_FOR_ASSIGNOR";

  return {
    canAccept: mine,
    /* Symmetric: whoever is waited on may accept or counter. */
    canNegotiate: mine,
    /* The engine has no reject. Agreement is the only exit. */
    canReject: false,
    nextActor: owner,
    statusLabel: waitingForAssignor
      ? "decide the time budget"
      : "accept the time budget",
    /* A live state with nobody named is the reported fault, and it is now
       distinguishable from an ordinary wait. */
    actionType: owner ? (waitingForAssignor ? "decide_budget" : "confirm_budget") : "unowned",
    currentSecs: negotiation.currentSecs,
    round: negotiation.round,
  };
}

/** The turn on a deadline record. Dates only. */
function deadlineActions(
  record: DeadlineExtensionRecord,
  viewerId: string | null,
): ExtensionActions {
  /* A pre-migration row is a record of something that already happened. It has
     no live turn and must never claim one. */
  if (record.isHistorical) return NOTHING;
  const me = viewerId ?? "";

  if (record.status === "pending") {
    const owner = record.approverId;
    const mine = me !== "" && owner === me;
    return {
      canAccept: mine,
      canNegotiate: mine,
      /* The assignor MAY refuse a date outright — the commitment is theirs, and
         declining leaves it exactly where it was. Nothing is left half-agreed. */
      canReject: mine,
      nextActor: owner,
      statusLabel: "approve the revised deadline",
      actionType: owner ? "decide_deadline" : "unowned",
      currentSecs: 0,
      round: 0,
    };
  }

  if (record.status === "counter_proposed") {
    const owner = record.requestedBy || null;
    const mine = me !== "" && owner === me;
    return {
      canAccept: mine,
      canNegotiate: mine,
      canReject: false,
      nextActor: owner,
      statusLabel: "accept the revised deadline",
      actionType: owner ? "accept_counter" : "unowned",
      currentSecs: 0,
      round: 0,
    };
  }

  return NOTHING;
}

/**
 * **The one answer.** Who acts next, and what they may do.
 *
 * Called by every card before it renders a control, and by every repository
 * transition before it accepts a write. Passing the viewer in rather than
 * returning a bare state is deliberate: `canAccept` is a question about a
 * person, and a component that had to combine "the state" with "am I the owner"
 * itself is exactly how an assignee came to be shown an accept control over
 * their own outstanding proposal.
 */
export function getExtensionActions(
  viewerId: string | null,
  state: ExtensionState,
): ExtensionActions {
  const budget = state.budget ?? null;
  if (budget && budgetIsLive(budget)) return budgetActions(budget, viewerId);

  const negotiation = state.negotiation ?? null;
  if (negotiation) {
    const fromEngine = negotiationActions(negotiation, viewerId);
    if (fromEngine.actionType !== "none") return fromEngine;
  }

  const deadline = state.deadline ?? null;
  if (deadline) return deadlineActions(deadline, viewerId);

  return NOTHING;
}

/**
 * "Rakesh Biswal needs to review the request for additional working time."
 *
 * Never a bare "Waiting for Rakesh". A name with no verb tells a reader that
 * somebody is blocking them and not what that person is expected to do — and it
 * says nothing at all to the person named, who is usually the one reading it.
 *
 * **Returns null for an unowned turn**, so no caller can render a wait on
 * somebody the record cannot name. That sentence was the reported bug. The
 * unowned case has its own surface, which says it is a fault.
 */
export function actionSentence(
  actions: ExtensionActions,
  nameOf: (id: string) => string | null,
): string | null {
  if (actions.actionType === "none" || actions.actionType === "unowned") {
    return null;
  }
  if (!actions.nextActor) return null;
  const name = nameOf(actions.nextActor);
  if (!name) return null;
  return `${name} needs to ${actions.statusLabel}`;
}

/**
 * What a reader is told when the turn has no owner.
 *
 * Names the cause and the fix. "Nothing is happening and I do not know why" is
 * the hardest state to report, and the cause here is always the same shape: a
 * record naming somebody the directory or the reporting line cannot resolve.
 */
export const UNOWNED_TURN_NOTICE =
  "This request is waiting on somebody the record does not name, so nobody can answer it. That is a fault rather than a delay — ask an administrator to check the assignee's reporting line.";

/** Is this viewer the one being waited on? */
export function isMyTurn(
  actions: ExtensionActions,
  viewerId: string | null,
): boolean {
  return (
    actions.actionType !== "none" &&
    actions.actionType !== "unowned" &&
    viewerId !== null &&
    actions.nextActor === viewerId
  );
}

/**
 * May this viewer make this transition? **The write's copy of the question.**
 *
 * Same function, same answer, so a control that renders is a write that lands
 * and a write that is refused is a control that was never offered. The
 * repository calls this before every extension mutation.
 *
 * Returns the refusal SENTENCE rather than a boolean, because the caller has to
 * say something and a boolean makes every call site invent its own wording.
 */
export function transitionRefusal(input: {
  viewerId: string | null;
  state: ExtensionState;
  intent: "accept" | "negotiate" | "reject";
}): string | null {
  const actions = getExtensionActions(input.viewerId, input.state);

  if (actions.actionType === "none") {
    return "There is nothing outstanding on this task to answer.";
  }
  if (actions.actionType === "unowned") return UNOWNED_TURN_NOTICE;

  if (actions.nextActor !== input.viewerId) {
    /* The one refusal that also delivers "you cannot decide your own request":
       after asking, you are never the one waited on. */
    return "It is not your turn — the other side is deciding.";
  }

  if (input.intent === "accept" && !actions.canAccept) {
    return "You cannot accept this.";
  }
  if (input.intent === "negotiate" && !actions.canNegotiate) {
    return "You cannot put a different figure forward on this.";
  }
  if (input.intent === "reject" && !actions.canReject) {
    /* Named, because it is a rule rather than a missing feature: ending an
       hours negotiation by refusal would leave the work carrying a figure one
       side never agreed to. */
    return "This cannot be declined outright. Put a different figure forward instead — a refusal would leave the work on terms nobody agreed to.";
  }
  return null;
}
