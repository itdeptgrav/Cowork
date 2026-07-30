import type { Feasibility } from "./deadlineFeasibility.ts";
import { extensionFromAddition, type Extension } from "./deadlineExtension.ts";

/**
 * Who decides an extension, and what they are actually deciding.
 *
 * **Two different questions, and the product asked only the second.** An
 * assignee who needs longer raised a DATE proposal straight to the assignor —
 * so every "I need two more hours" arrived as "move your deadline", and the one
 * person who could tell whether the extra hours even fit was not consulted.
 *
 * The two questions, and their owners:
 *
 *   *How many hours does this person get?*  — their PRIMARY MANAGER. It is a
 *     decision about one employee's workload, and the reporting line owns it.
 *     Measured in working seconds.
 *
 *   *When is this work due?*  — the ASSIGNOR. It is a commitment they made,
 *     possibly onward to somebody else. Measured as a date.
 *
 * They are never the same field and never the same approval. Mixing them is
 * how a manager came to move a commitment they did not make, and how an
 * assignee came to negotiate a date with somebody who could not see their
 * queue.
 *
 * ## The order matters
 *
 * The first question is always asked first, because it is usually enough.
 * Somebody a queue position ahead of a deadline can absorb two extra hours
 * without anybody's commitment moving — and escalating that to the assignor
 * spends their attention on a decision that was never needed.
 *
 * Only when the workload genuinely cannot fit does this become a date
 * negotiation, and then it is the MANAGER who escalates — carrying the
 * earliest date their employee can actually achieve, rather than the assignee
 * guessing one.
 */

/** What the manager's decision turns out to be. */
export type ExtensionOutcome =
  /** The hours fit inside the existing commitment. The manager may simply grant them. */
  | "approve_budget"
  /** They do not. The manager must ask the assignor to move the date. */
  | "escalate_deadline"
  /** Not answerable — no committed date, or the queue could not be measured. */
  | "unknown";

export interface ExtensionRoute {
  outcome: ExtensionOutcome;
  /** The budget arithmetic: previous, added, total. */
  extension: Extension;
  /** Earliest this person can finish it at the requested budget. */
  earliestCompletion: string | null;
  /** The commitment being measured against. */
  committedDeadline: string | null;
  /** Slack in seconds. Negative is the amount by which it misses. */
  bufferSeconds: number | null;
  /** The date the manager should ask the assignor for. Null when none is needed. */
  proposedDeadline: string | null;
  /** One sentence, for the screen. */
  explanation: string;
}

/**
 * Rounding for a date somebody has to state out loud.
 *
 * A request for "31 Jul 15:27:11" invites a counter-offer about seconds. The
 * next half hour is the smallest unit anybody negotiates in, and asking for
 * slightly more than the engine's exact answer is honest — it is the margin
 * that makes the commitment keepable.
 */
export function roundUpToHalfHour(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const half = 30 * 60 * 1000;
  return new Date(Math.ceil(ms / half) * half).toISOString();
}

/**
 * Decide the route from the workload engine's own answer.
 *
 * **Nothing is computed here.** `feasibility` comes from
 * `calculateDeadlineFeasibility` run at the REQUESTED budget and the task's
 * current position — the same engine the planner and the operational due date
 * use. This function only reads its verdict and says who is next.
 */
export function routeExtensionRequest(input: {
  feasibility: Pick<
    Feasibility,
    "feasible" | "estimatedCompletionTime" | "bufferSeconds" | "deadline"
  >;
  previousWindowSecs: number;
  addedSecs: number;
}): ExtensionRoute {
  const extension = extensionFromAddition({
    previousWindowSecs: input.previousWindowSecs,
    addedSecs: input.addedSecs,
  });

  const earliestCompletion = input.feasibility.estimatedCompletionTime ?? null;
  const committedDeadline = input.feasibility.deadline ?? null;
  const bufferSeconds = input.feasibility.bufferSeconds ?? null;

  /* No commitment to measure against, or no queue answer. Saying "approve" here
     would claim a fit nobody checked; saying "escalate" would send the assignor
     a date derived from nothing. */
  if (!committedDeadline || !earliestCompletion) {
    return {
      outcome: "unknown",
      extension,
      earliestCompletion,
      committedDeadline,
      bufferSeconds,
      proposedDeadline: null,
      explanation: !committedDeadline
        ? "No deadline has been committed for this task, so there is nothing the extra time has to fit inside."
        : "This person’s queue could not be measured, so whether the extra time fits is not known.",
    };
  }

  if (input.feasibility.feasible) {
    return {
      outcome: "approve_budget",
      extension,
      earliestCompletion,
      committedDeadline,
      bufferSeconds,
      /* None needed. The commitment does not move, which is the point. */
      proposedDeadline: null,
      explanation:
        "The extra time fits inside the deadline already committed. Granting it changes the budget and nothing else.",
    };
  }

  return {
    outcome: "escalate_deadline",
    extension,
    earliestCompletion,
    committedDeadline,
    bufferSeconds,
    /* The earliest achievable date, rounded up — asked for, not assumed. */
    proposedDeadline: roundUpToHalfHour(earliestCompletion),
    explanation:
      "The extra time cannot fit inside the committed deadline. Moving it is the assignor’s decision, so this has to be asked rather than granted.",
  };
}

/**
 * Who owns each half of this, by name.
 *
 * Kept here rather than in a component so that a screen cannot quietly offer a
 * control to somebody the rule would refuse.
 */
export function budgetApproverId(input: {
  /** The assignee's primary manager, from HR. Never a department lead. */
  primaryManagerId: string | null;
  assigneeId: string | null;
}): string | null {
  /* Somebody with nobody above them approves their own hours — the same
     exception the priority rules make, and for the same reason: there is no
     one else to ask. */
  return input.primaryManagerId ?? input.assigneeId ?? null;
}

/** The assignor. A deadline is their commitment and nobody else's to move. */
export function deadlineApproverId(input: {
  createdById: string | null;
}): string | null {
  return input.createdById ?? null;
}

/** May this person decide the hours? */
export function mayApproveBudget(input: {
  viewerId: string | null;
  primaryManagerId: string | null;
  assigneeId: string | null;
}): boolean {
  if (!input.viewerId) return false;
  return input.viewerId === budgetApproverId(input);
}

/** May this person move the date? */
export function mayApproveDeadline(input: {
  viewerId: string | null;
  createdById: string | null;
}): boolean {
  if (!input.viewerId) return false;
  return input.viewerId === deadlineApproverId(input);
}

/**
 * The refusal an assignee gets for going straight to the assignor.
 *
 * Quoted verbatim by the help corpus, so the words on screen and the words in
 * the answer are the same string.
 */
export const DIRECT_DEADLINE_REFUSAL =
  "Ask your manager for the time you need. They will check whether it fits the deadline, and take it to the assignor only if it does not.";
