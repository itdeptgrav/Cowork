import type { TaskView } from "@/lib/repositories";
import { getExtensionActions } from "./extensionAuthority.ts";

/**
 * Whose turn it is on a time budget, and what they may do about it.
 *
 * One place, because the alternative is what this replaces: each card carrying
 * its own conditions, which is how an assignee came to be shown an accept
 * control over their own outstanding proposal.
 *
 * **A symmetric loop.** Either side may counter, and whoever is waited on may
 * also simply accept. The engine's `budgetNegotiation` service owns the state
 * and passes the turn to the OTHER party on every counter, so this reads
 * `waitingForId` rather than deciding anything itself — one field, checked
 * identically here and inside the endpoint's transaction.
 *
 * **There is no reject.** A refusal that ends the negotiation leaves work
 * carrying a budget one side never agreed to, which is the state the loop
 * exists to make impossible. Disagreeing means countering, and agreement is the
 * only exit.
 */

export type BudgetState =
  /** The assignor's opening figure, waiting on the assignee. */
  | "waiting_for_assignee"
  /** The assignee has asked for something else; the assignor decides. */
  | "waiting_for_assignor"
  /** Settled. The task has a deadline and work can start. */
  | "agreed"
  /** No budget in play — a fixed-deadline task, or nothing proposed yet. */
  | "none";

export interface BudgetTurn {
  state: BudgetState;
  /** The employee id whose move it is, where the record names one. */
  ownerId: string | null;
  /** What is on the table right now. */
  currentSecs: number;
  /** How many times a figure has been put forward. */
  round: number;
  /** May THIS viewer accept what stands? */
  canAccept: boolean;
  /**
   * May this viewer put a different figure forward?
   *
   * The same answer as `canAccept`, and deliberately: whoever is waited on may
   * do either. That symmetry is what makes it a loop rather than a request.
   */
  canPropose: boolean;
  /**
   * A live turn the record assigns to nobody.
   *
   * Distinguished from an ordinary wait because it is a FAULT: no amount of
   * waiting resolves it, and the fix is an administrator completing a reporting
   * line. Rendering it as a wait is the bug this field exists to make
   * impossible.
   */
  unowned: boolean;
}

/**
 * Read the turn off the task.
 *
 * `proposedById` is the engine's own record of who asked, so the "you cannot
 * decide your own request" rule cannot drift from what the endpoint enforces.
 */
export function budgetTurn(view: TaskView, viewerId: string | null): BudgetTurn {
  const n = view.budgetNegotiation ?? null;

  if (!n || !n.state) {
    return {
      state: "none",
      ownerId: null,
      currentSecs: 0,
      round: 0,
      canAccept: false,
      canPropose: false,
      unowned: false,
    };
  }

  if (n.state === "ACCEPTED") {
    return {
      state: "agreed",
      ownerId: null,
      currentSecs: n.currentSecs,
      round: n.round,
      canAccept: false,
      canPropose: false,
      unowned: false,
    };
  }

  /*
   * **Delegated, not decided here.** `getExtensionActions` is the one place that
   * answers "whose turn is it and what may they do", and it answers for the
   * extension records as well. This module used to compute `mine` itself from
   * `waitingForId`, which was a second copy of that judgement — and the two
   * disagreeing is precisely how a state came to have a label and no surface.
   *
   * The shape is kept so existing callers are untouched.
   */
  const actions = getExtensionActions(viewerId, { negotiation: n });

  return {
    state:
      n.state === "WAITING_FOR_ASSIGNOR"
        ? "waiting_for_assignor"
        : "waiting_for_assignee",
    ownerId: actions.nextActor,
    currentSecs: actions.currentSecs,
    round: actions.round,
    canAccept: actions.canAccept,
    /* Whoever is waited on may do either. That symmetry is the loop. */
    canPropose: actions.canNegotiate,
    /* A live turn the record cannot assign to anybody. Surfaced so a screen can
       say it is a fault; previously this rendered as an ordinary wait. */
    unowned: actions.actionType === "unowned",
  };
}

/**
 * Whose turn it is, for a reader who is not them.
 *
 * Returns null once settled, and where the record names nobody — a sentence
 * naming "someone" tells a reader less than saying nothing.
 */
export function waitingOnLabel(
  turn: BudgetTurn,
  nameOf: (id: string) => string | null,
): string | null {
  if (turn.state === "agreed" || turn.state === "none") return null;

  /* **Null for an unowned turn, and this is the reported bug.** This branch used
     to return "Waiting for the assignee to accept" whenever the id was missing —
     a sentence naming an action while `canAccept` was false for everybody,
     including the assignee reading it. There was no surface behind the prompt.

     An unowned turn now has its own notice, which says it is a fault and names
     the fix. Returning a wait here would put the misleading sentence back. */
  if (turn.unowned || !turn.ownerId) return null;

  /* An owner whose NAME we cannot resolve is still an owner, and is still
     described by role — "the assignee" reads better than a raw employee id, and
     there genuinely is somebody who can act.

     The distinction that matters is the one above: a turn with no owner at all.
     That is what used to reach this fallback and produce a sentence naming an
     action nobody could take. */
  const name = nameOf(turn.ownerId);
  if (!name) {
    return turn.state === "waiting_for_assignor"
      ? "Waiting for the task's creator to decide"
      : "Waiting for the assignee to accept";
  }
  return turn.state === "waiting_for_assignor"
    ? `Waiting for ${name} to decide`
    : `Waiting for ${name} to accept`;
}
