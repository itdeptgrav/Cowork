/**
 * `cowork_settings/task_rules` — the gates a task passes through.
 *
 * ## Why only these five
 *
 * The brief said not to move every business rule into configuration, and most of
 * the task module correctly resists it. Statuses are legacy's vocabulary and
 * renaming one breaks the engine. Priority position is derived from a queue, not
 * chosen. The budget/deadline unit split is enforced by the type system because
 * mixing the two is always a bug. None of those is a value an administrator
 * changes; they are what the product *is*.
 *
 * What is left is a short list of **gates** — points where the product decides
 * whether to block somebody or let them through. Each one is a real policy
 * question with two defensible answers, each is currently a constant somebody
 * chose, and each is the kind of thing an organisation changes after a month of
 * use. That is the test a rule has to pass to be here.
 *
 * ## Defaults are today's behaviour, exactly
 *
 * Every default below reproduces what the code does now, so an unsaved document
 * changes nothing. This matters more than it sounds: the existing rule tests
 * assert exact behaviour, and a default that differed by one field would turn
 * them into assertions about a document nobody wrote.
 *
 * ## Enforced by Cowork only
 *
 * The legacy app does not read this document and never will. A rule tightened
 * here is tightened for people using this UI and not for anyone still on the old
 * one — which is a fact about a half-migrated product, and the console says so
 * rather than implying company-wide effect.
 */

export interface TaskRules {
  /**
   * Whether every acceptance criterion must be satisfied before a task may be
   * submitted.
   *
   * `block` is today's behaviour: `completionState.canComplete` is false while
   * anything is outstanding. `warn` lets the submission through and names what
   * is unfinished — appropriate where criteria are a checklist rather than a
   * contract.
   *
   * A task with **no** criteria is unaffected either way. Gating those would
   * turn an optional field into a mandatory one across the whole product.
   */
  requirementsBeforeSubmit: "block" | "warn";
  /**
   * Whether the timer must have run before work can be submitted.
   *
   * `allow` is today's behaviour. `require` closes the case where a task is
   * marked done with no recorded effort, which makes the time budget
   * unmeasurable — and unmeasurable effort is what makes a workload queue lie.
   */
  timerBeforeSubmit: "allow" | "require";
  /** Whether a submission must carry a note saying what was done. */
  submissionNote: "optional" | "required";
  /**
   * Whether a rejected task may be resubmitted, or must be reopened first.
   *
   * `allow` is today's behaviour.
   */
  afterRejection: "allow_resubmit" | "require_reopen";
  /**
   * How long an unanswered proposal stands before it lapses, in hours.
   *
   * Zero means it never lapses. A lapsed proposal is not a decision — it is the
   * absence of one, and the product says so rather than treating silence as
   * refusal.
   */
  proposalExpiryHours: number;
}

export const DEFAULT_TASK_RULES: TaskRules = {
  requirementsBeforeSubmit: "block",
  timerBeforeSubmit: "allow",
  submissionNote: "optional",
  afterRejection: "allow_resubmit",
  proposalExpiryHours: 48,
};

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function wholeNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  /* Negative and non-finite both fall back rather than clamping to zero: zero
     is a meaningful setting here ("never lapses"), so silently producing it from
     a corrupt value would be a real behaviour change disguised as a default. */
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/**
 * A stored document as rules, with today's behaviour for anything absent.
 *
 * An absent document is a workspace that has never opened this page, not a
 * fault — the same treatment `readOfficePolicy` gives its own document.
 */
export function readTaskRules(
  doc: Record<string, unknown> | null,
): TaskRules {
  return {
    requirementsBeforeSubmit: oneOf(
      doc?.requirementsBeforeSubmit,
      ["block", "warn"] as const,
      DEFAULT_TASK_RULES.requirementsBeforeSubmit,
    ),
    timerBeforeSubmit: oneOf(
      doc?.timerBeforeSubmit,
      ["allow", "require"] as const,
      DEFAULT_TASK_RULES.timerBeforeSubmit,
    ),
    submissionNote: oneOf(
      doc?.submissionNote,
      ["optional", "required"] as const,
      DEFAULT_TASK_RULES.submissionNote,
    ),
    afterRejection: oneOf(
      doc?.afterRejection,
      ["allow_resubmit", "require_reopen"] as const,
      DEFAULT_TASK_RULES.afterRejection,
    ),
    proposalExpiryHours: wholeNumber(
      doc?.proposalExpiryHours,
      DEFAULT_TASK_RULES.proposalExpiryHours,
    ),
  };
}

/** Why these rules cannot be saved, or null. */
export function validateTaskRules(rules: TaskRules): string | null {
  if (!Number.isFinite(rules.proposalExpiryHours) || rules.proposalExpiryHours < 0) {
    return "The proposal expiry must be zero or more hours. Zero means a proposal never lapses.";
  }
  /* A year. Not a technical limit — a figure this large means somebody typed a
     date into an hours field, and accepting it would produce a proposal that
     appears to expire and never does. */
  if (rules.proposalExpiryHours > 8760) {
    return "The proposal expiry cannot be longer than a year. If a proposal should never lapse, set it to zero.";
  }
  return null;
}

/** The document to merge. */
export function writeTaskRules(
  rules: TaskRules,
  updatedBy: string,
): Record<string, unknown> {
  return {
    requirementsBeforeSubmit: rules.requirementsBeforeSubmit,
    timerBeforeSubmit: rules.timerBeforeSubmit,
    submissionNote: rules.submissionNote,
    afterRejection: rules.afterRejection,
    proposalExpiryHours: rules.proposalExpiryHours,
    updatedBy,
    updatedAt: new Date(),
  };
}

/**
 * Whether a task may be submitted under these rules.
 *
 * **Additive by design.** `completionState` still computes `canComplete` from
 * the criteria alone, and this decides what to do about it. Threading the
 * setting into that function instead would have made every existing caller pass
 * a document, and the callers that could not would have got a default — which is
 * the shape where a rule silently stops applying.
 */
export function submissionRefusal(input: {
  rules: TaskRules;
  /** From `completionState`. */
  outstandingRequirements: string[];
  /** Seconds the timer has recorded against this task. */
  loggedSecs: number;
  /** The note the person is submitting with, if any. */
  note: string | null;
}): string | null {
  if (
    input.rules.requirementsBeforeSubmit === "block" &&
    input.outstandingRequirements.length > 0
  ) {
    return `This task cannot be submitted while ${input.outstandingRequirements.length === 1 ? "an acceptance criterion is" : "acceptance criteria are"} outstanding: ${input.outstandingRequirements.join(", ")}.`;
  }
  if (input.rules.timerBeforeSubmit === "require" && input.loggedSecs <= 0) {
    return "Start the timer before submitting. A task submitted with no recorded time leaves its budget unmeasurable, and the workload queue is computed from measured time.";
  }
  if (input.rules.submissionNote === "required" && !input.note?.trim()) {
    return "Add a note saying what was done. The reviewer sees this before the work itself.";
  }
  return null;
}

/**
 * The warning to show when criteria are outstanding and the rule permits it
 * anyway. Null when there is nothing to warn about.
 *
 * Separate from the refusal because `warn` and `block` are different products:
 * one informs, the other stops. Returning a refusal string for both and letting
 * the caller decide whether to obey it is how a gate becomes advisory by
 * accident.
 */
export function submissionWarning(input: {
  rules: TaskRules;
  outstandingRequirements: string[];
}): string | null {
  if (input.rules.requirementsBeforeSubmit !== "warn") return null;
  if (input.outstandingRequirements.length === 0) return null;
  return `Submitting with ${input.outstandingRequirements.length} acceptance ${input.outstandingRequirements.length === 1 ? "criterion" : "criteria"} outstanding: ${input.outstandingRequirements.join(", ")}.`;
}

/** When a proposal raised now would lapse, or null if it never does. */
export function proposalExpiresAt(
  rules: TaskRules,
  raisedAtMs: number,
): string | null {
  if (rules.proposalExpiryHours <= 0) return null;
  return new Date(
    raisedAtMs + rules.proposalExpiryHours * 3600_000,
  ).toISOString();
}
