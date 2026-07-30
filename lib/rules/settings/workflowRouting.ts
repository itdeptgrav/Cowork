/**
 * `cowork_settings/workflow_routing` — who answers, and what happens when nobody
 * does.
 *
 * ## What is NOT configurable here, and must not become so
 *
 * The two chains themselves are settled product, not settings:
 *
 * ```
 *   TIME BUDGET EXTENSION            DEADLINE EXTENSION
 *   assignee → primary manager       manager → assignor
 *   unit: WORKING SECONDS            unit: DATE/TIME
 * ```
 *
 * Hours are a decision about one employee's workload, and the reporting line
 * owns it. A date is a commitment the assignor made, possibly onward to somebody
 * else, and only they may move it. Making *those* configurable would let an
 * administrator route a date decision to a manager who cannot see the queue, or
 * an hours decision to somebody with no view of the person — which are the two
 * bugs `extensionRouting.ts` exists to have fixed.
 *
 * Nor is the order configurable. Hours are always asked first because they are
 * usually enough, and escalation is always the *manager's* act carrying the
 * earliest date their employee can actually achieve. An assignee guessing a date
 * is how the original defect looked.
 *
 * ## What IS configurable, because the code currently guesses
 *
 * Three things, each of which is today a silent fallback rather than a decision:
 *
 *  · **Who approves when there is no primary manager.** `budgetApproverId`
 *    returns `primaryManagerId ?? assigneeId` — the person approves their own
 *    hours. Defensible for a chief executive and wrong for a new joiner whose HR
 *    record has not been filled in, and the code cannot tell those apart.
 *  · **Whether a manager may grant hours the queue says do not fit.** Today
 *    escalation is automatic. Some organisations want the manager able to
 *    override and accept the slip; others want the assignor always consulted.
 *  · **How long a decision may sit before it is escalated or reported as stuck.**
 *    Today: forever, silently.
 */

export interface WorkflowRouting {
  /**
   * Who decides hours when HR names no primary manager.
   *
   * `self` is today's behaviour. `named_fallback` sends it to
   * `fallbackApproverId`, and `block` refuses the request with a reason rather
   * than routing it somewhere arbitrary — the honest answer when a reporting
   * line is simply missing.
   */
  budgetApproverWhenNoManager: "self" | "named_fallback" | "block";
  /**
   * Who decides a date when the task records no assignor.
   *
   * `block` is today's behaviour — `deadlineApproverId` returns null and no
   * control is offered.
   */
  deadlineApproverWhenNoAssignor: "named_fallback" | "block";
  /**
   * The employee id used by either `named_fallback` above.
   *
   * Deliberately one id and not a per-case pair: two fallbacks is two things to
   * keep correct, and an organisation that needs different people for the two
   * cases needs a reporting line, not a second setting.
   */
  fallbackApproverId: string | null;
  /**
   * Whether a manager may grant hours that the workload engine says will miss
   * the committed deadline.
   *
   * `escalate` is today's behaviour: the manager cannot grant it and must ask
   * the assignor. `allow_override` lets them grant it and accept the slip, which
   * is recorded either way.
   */
  infeasibleBudget: "escalate" | "allow_override";
  /**
   * Hours before an unanswered approval is reported as stuck. Zero disables it.
   *
   * **Reported, not reassigned.** Automatically moving a decision to somebody
   * else would mean an approval nobody consciously gave, which is the opposite
   * of what an approval is for. This surfaces the delay; a person still decides.
   */
  stuckAfterHours: number;
}

export const DEFAULT_WORKFLOW_ROUTING: WorkflowRouting = {
  budgetApproverWhenNoManager: "self",
  deadlineApproverWhenNoAssignor: "block",
  fallbackApproverId: null,
  infeasibleBudget: "escalate",
  stuckAfterHours: 0,
};

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function readWorkflowRouting(
  doc: Record<string, unknown> | null,
): WorkflowRouting {
  const n = Number(doc?.stuckAfterHours);
  return {
    budgetApproverWhenNoManager: oneOf(
      doc?.budgetApproverWhenNoManager,
      ["self", "named_fallback", "block"] as const,
      DEFAULT_WORKFLOW_ROUTING.budgetApproverWhenNoManager,
    ),
    deadlineApproverWhenNoAssignor: oneOf(
      doc?.deadlineApproverWhenNoAssignor,
      ["named_fallback", "block"] as const,
      DEFAULT_WORKFLOW_ROUTING.deadlineApproverWhenNoAssignor,
    ),
    fallbackApproverId:
      typeof doc?.fallbackApproverId === "string" && doc.fallbackApproverId.trim()
        ? doc.fallbackApproverId.trim()
        : null,
    infeasibleBudget: oneOf(
      doc?.infeasibleBudget,
      ["escalate", "allow_override"] as const,
      DEFAULT_WORKFLOW_ROUTING.infeasibleBudget,
    ),
    stuckAfterHours:
      Number.isFinite(n) && n >= 0
        ? Math.round(n)
        : DEFAULT_WORKFLOW_ROUTING.stuckAfterHours,
  };
}

/**
 * Why this routing cannot be saved, or null.
 *
 * The load-bearing check is the last one: selecting `named_fallback` without
 * naming anybody would produce a route to `null`, and a request routed to nobody
 * is indistinguishable on screen from one waiting on a person who will never
 * answer.
 */
export function validateWorkflowRouting(
  routing: WorkflowRouting,
): string | null {
  if (routing.stuckAfterHours < 0 || !Number.isFinite(routing.stuckAfterHours)) {
    return "The stuck-approval threshold must be zero or more hours. Zero turns the report off.";
  }
  if (routing.stuckAfterHours > 8760) {
    return "The stuck-approval threshold cannot be longer than a year.";
  }
  const needsFallback =
    routing.budgetApproverWhenNoManager === "named_fallback" ||
    routing.deadlineApproverWhenNoAssignor === "named_fallback";
  if (needsFallback && !routing.fallbackApproverId) {
    return "Name a fallback approver, or choose another option. A request routed to nobody looks exactly like one waiting on somebody who will never answer.";
  }
  return null;
}

export function writeWorkflowRouting(
  routing: WorkflowRouting,
  updatedBy: string,
): Record<string, unknown> {
  return {
    budgetApproverWhenNoManager: routing.budgetApproverWhenNoManager,
    deadlineApproverWhenNoAssignor: routing.deadlineApproverWhenNoAssignor,
    fallbackApproverId: routing.fallbackApproverId,
    infeasibleBudget: routing.infeasibleBudget,
    stuckAfterHours: routing.stuckAfterHours,
    updatedBy,
    updatedAt: new Date(),
  };
}

/**
 * The budget approver under this routing.
 *
 * **Wraps `budgetApproverId` rather than replacing it.** That function is the
 * rule — the primary manager owns an employee's hours — and this only decides
 * the case it cannot: no manager named. Passing routing into it would put a
 * settings read inside the rule, and the rule is asserted by tests that must
 * keep testing the rule.
 */
export function routedBudgetApproverId(input: {
  routing: WorkflowRouting;
  primaryManagerId: string | null;
  assigneeId: string | null;
}): string | null {
  if (input.primaryManagerId) return input.primaryManagerId;
  switch (input.routing.budgetApproverWhenNoManager) {
    case "self":
      return input.assigneeId ?? null;
    case "named_fallback":
      /* Never falls through to self: choosing a fallback and getting
         self-approval because the id was cleared would be the silent widening
         this setting exists to prevent. */
      return input.routing.fallbackApproverId ?? null;
    case "block":
      return null;
  }
}

/** The deadline approver under this routing. */
export function routedDeadlineApproverId(input: {
  routing: WorkflowRouting;
  createdById: string | null;
}): string | null {
  if (input.createdById) return input.createdById;
  return input.routing.deadlineApproverWhenNoAssignor === "named_fallback"
    ? (input.routing.fallbackApproverId ?? null)
    : null;
}

/**
 * Why an hours request cannot be routed at all, or null.
 *
 * A named refusal rather than a missing button. "Nothing happens when I press
 * it" is the single hardest state to report, and a reporting line nobody filled
 * in is a fixable cause worth naming.
 */
export function routingRefusal(input: {
  routing: WorkflowRouting;
  primaryManagerId: string | null;
  assigneeId: string | null;
}): string | null {
  if (routedBudgetApproverId(input)) return null;
  if (input.routing.budgetApproverWhenNoManager === "block") {
    return "This request has nobody to decide it: HR records no primary manager for the assignee. Ask an administrator to complete the reporting line.";
  }
  return "This request has nobody to decide it. A fallback approver is configured but not named.";
}

/**
 * Whether the manager may grant hours the queue says will not fit.
 *
 * Called *in addition to* `routeExtensionRequest`, never instead of it: that
 * function's `escalate_deadline` verdict is the workload engine's answer, and
 * this is a policy question about what to do with it. Conflating them would let
 * a setting change what the engine reported.
 */
export function mayOverrideInfeasibleBudget(
  routing: WorkflowRouting,
): boolean {
  return routing.infeasibleBudget === "allow_override";
}

/** Whether a decision raised at this time is now overdue. */
export function isApprovalStuck(input: {
  routing: WorkflowRouting;
  raisedAt: string | null;
  nowMs: number;
}): boolean {
  if (input.routing.stuckAfterHours <= 0) return false;
  if (!input.raisedAt) return false;
  const raised = Date.parse(input.raisedAt);
  if (!Number.isFinite(raised)) return false;
  return input.nowMs - raised >= input.routing.stuckAfterHours * 3600_000;
}
