/**
 * PROVISIONAL CONFIGURATION
 *
 * Every value here stands in for a rule the owner has NOT confirmed. The brief
 * is explicit: unresolved rules must be represented through typed provisional
 * configuration and labelled clearly, never silently resolved.
 *
 * Anything reading from `PROVISIONAL` must surface `ProvisionalBadge` (or the
 * equivalent disclosure) next to the figure it produces. `isProvisional` on a
 * ledger entry propagates from here.
 *
 * Confirmed rules do NOT live here — they live in `lib/scoring/rules.ts`.
 * The split is deliberate: it must always be obvious which numbers are real.
 */

import { isOverridden, ruleNumber, ruleValue } from "./settings.ts";

export interface ProvisionalRule {
  /** Owner-decision reference from docs/architecture/MIGRATION_DECISIONS.md §3. */
  decisionId: string;
  label: string;
  /** What legacy did, for context — NOT an endorsement. */
  legacyBehaviour: string;
  /** The placeholder used so the prototype can run. */
  value: number | string;
  unit: string;
  note: string;
}

export const PROVISIONAL_RULES: Record<string, ProvisionalRule> = {
  /* ── C1 · Task Execution ────────────────────────────────────────────────── */
  deadlineMissDeduction: {
    decisionId: "O6",
    label: "Missed-deadline deduction",
    legacyBehaviour:
      "Two conflicting defaults: 0.5 in c1Service, 0.2 in BandConfig",
    value: 0.2,
    unit: "points per miss",
    note: "Placeholder. Legacy disagreed with itself; neither value is approved.",
  },
  extensionDeduction: {
    decisionId: "O6",
    label: "Charged-extension deduction",
    legacyBehaviour:
      "Configured at 0.2 but multiplied by ZERO in code, so it never applied",
    value: 0.2,
    unit: "points per charged extension",
    note: "Legacy's implementation was broken. Applied here so the workflow is visible.",
  },
  rejectionDeduction: {
    decisionId: "O4",
    label: "Rejection deduction",
    legacyBehaviour: "Zeroed the entire scoring unit (taskScore = 0)",
    value: 0.4,
    unit: "points per rejection",
    note: "OWNER EXPLICITLY WITHHELD APPROVAL of the legacy rule. This placeholder is NOT a recommendation.",
  },
  lateSubmissionDeduction: {
    decisionId: "O6",
    label: "Late-submission deduction",
    legacyBehaviour: "Not separate from the deadline miss",
    value: 0,
    unit: "points",
    note: "Set to 0 so it does not double-count with the deadline miss until decided.",
  },
  cancellationTreatment: {
    decisionId: "O6",
    label: "Cancelled-task treatment",
    legacyBehaviour:
      "Designed as excluded (isExcluded) but the function was never called",
    value: "exclude",
    unit: "exclude | zero",
    note: "Excluded here, matching legacy intent rather than legacy behaviour.",
  },

  /* ── C2 · Goal Attainment ───────────────────────────────────────────────── */
  goalPartialCredit: {
    decisionId: "O8",
    label: "Goal partial credit",
    legacyBehaviour: "Binary per component — late or not-done earns zero",
    value: "binary",
    unit: "binary | proportional",
    note: "Binary retained pending a decision on partial credit.",
  },
  goalLateDeduction: {
    decisionId: "O8",
    label: "Late goal-activity deduction",
    legacyBehaviour: "Full forfeit of the component's points",
    value: 1,
    unit: "fraction of component points forfeited",
    note: "Full forfeit matches legacy; unconfirmed.",
  },

  /* ── C3 · Conduct & Policy ──────────────────────────────────────────────── */
  conductMinor: {
    decisionId: "O7",
    label: "Conduct deduction — minor",
    legacyBehaviour: "Values lived in the missing PDF §3.4 C3 table",
    value: 0.2,
    unit: "points",
    note: "The authoritative table is not in either repository.",
  },
  conductModerate: {
    decisionId: "O7",
    label: "Conduct deduction — moderate",
    legacyBehaviour: "Missing PDF §3.4",
    value: 0.5,
    unit: "points",
    note: "Placeholder.",
  },
  conductSerious: {
    decisionId: "O7",
    label: "Conduct deduction — serious",
    legacyBehaviour: "Missing PDF §3.4",
    value: 1,
    unit: "points",
    note: "Placeholder.",
  },
  conductFalsification: {
    decisionId: "O7",
    label: "Conduct deduction — falsification",
    legacyBehaviour: "Missing PDF §3.4",
    value: 2,
    unit: "points",
    note: "Placeholder. Exceeds a single unit maximum, so it spans units.",
  },
  conductIdlePool: {
    decisionId: "O7",
    label: "Conduct deduction — idle pool",
    legacyBehaviour: "Missing PDF §3.4",
    value: 0.3,
    unit: "points",
    note: "Placeholder.",
  },

  /* ── C4 · Attendance ────────────────────────────────────────────────────── */
  latenessRatePerMinute: {
    decisionId: "O5",
    label: "Lateness rate",
    legacyBehaviour: "Flat 1 point per late instance, regardless of duration",
    value: 0.01,
    unit: "points per minute late",
    note: "Proportional lateness IS owner-confirmed; the RATE is not. 0.01/min reaches a full point at 100 minutes.",
  },
  latenessGracePeriodMins: {
    decisionId: "O5",
    label: "Grace period",
    legacyBehaviour: "15 minutes, defined in three different places",
    value: 10,
    unit: "minutes",
    note: "Placeholder. Legacy's three definitions disagreed.",
  },
  absenceDeduction: {
    decisionId: "O5",
    label: "Absence deduction",
    legacyBehaviour: "3 points per absent day",
    value: 1,
    unit: "points per absent day",
    note: "Capped at the unit maximum here so a day cannot go below 0.",
  },
  halfDayDeduction: {
    decisionId: "O5",
    label: "Half-day deduction",
    legacyBehaviour: "An env var existed but C4 never used it",
    value: 0.5,
    unit: "points",
    note: "Placeholder.",
  },
  earlyDepartureRatePerMinute: {
    decisionId: "O5",
    label: "Early-departure rate",
    legacyBehaviour: "Flat 1 point per instance",
    value: 0.01,
    unit: "points per minute early",
    note: "Mirrors the lateness rate for symmetry. Unconfirmed.",
  },
  attendanceCredits: {
    decisionId: "O5",
    label: "Attendance credits and overtime bonuses",
    legacyBehaviour: "A reward direction existed in the ledger",
    value: "none",
    unit: "none | overtime | manual",
    note: "Explicitly NOT invented. No credits are issued in the prototype.",
  },

  /* ── Aggregation ────────────────────────────────────────────────────────── */
  componentWeighting: {
    decisionId: "O2",
    label: "Component weights across C1–C4",
    legacyBehaviour:
      "Unweighted mean of C1/C2/C4 plus raw C3, configurable at two layers",
    value: "unit_count_pool",
    unit: "unit_count_pool | weighted",
    note:
      "docs/architecture/PRODUCT.md says weights are fixed and non-configurable but never states them. " +
      "CORRECTED: an earlier note here claimed that pooling every unit into one " +
      "points-over-points total 'asserts no weighting'. That was wrong, and the " +
      "error propagated into the UI. Pooling weights each component BY ITS UNIT " +
      "COUNT: an employee with 18 attendance days and 1 completed task gets a " +
      "composite that is 67% attendance and 3.7% execution. That is a weighting — " +
      "an accidental one, driven by data volume rather than by product opinion. " +
      "The composite therefore rests on THIS unresolved decision and must be " +
      "labelled provisional wherever it is shown, and its point decomposition must " +
      "never be displayed (docs/architecture/PRODUCT.md:87, :107 and The No Weighting Rule).",
  },
  reportingPeriod: {
    decisionId: "O3",
    label: "Reporting period",
    legacyBehaviour: "Quarterly with a 10/20/30/40 annual roll-up",
    value: "quarter",
    unit: "quarter | month | continuous",
    note: "Quarterly retained so period bucketing works. Unconfirmed.",
  },
  scoreFinalisation: {
    decisionId: "O17",
    label: "Score finalisation",
    legacyBehaviour: "Never finalised; recomputed on every read",
    value: "never",
    unit: "never | period_close",
    note: "Nothing is finalised in the prototype.",
  },
  multiAssigneeAttribution: {
    decisionId: "O9",
    label: "Multi-assignee score attribution",
    legacyBehaviour: "Only assigneeIds[0] scored; other assignees unmeasured",
    value: "primary_only",
    unit: "primary_only | all | split",
    note: "Primary-only retained so behaviour is visible, flagged in the UI wherever a task has more than one assignee.",
  },

  /* ── Priority ───────────────────────────────────────────────────────────── */
  priorityMaxRank: {
    decisionId: "O13",
    label: "Priority range",
    legacyBehaviour: "Frontend clamped 1–10; backend was unbounded",
    value: 10,
    unit: "maximum rank",
    note: "Clamped consistently at both layers here, unlike legacy.",
  },
  p1Exclusive: {
    decisionId: "O10",
    label: "P1 exclusivity per employee",
    legacyBehaviour: "No constraint — duplicate P1s were possible",
    value: "warn",
    unit: "warn | enforce | allow",
    note: "Conflicts are DETECTED and surfaced, not blocked, pending a decision.",
  },
  priorityRenumbering: {
    decisionId: "O11",
    label: "Reorder renumbering semantic",
    legacyBehaviour:
      "Drag renumbered contiguously; PrioritySwapPanel preserved the number set",
    value: "contiguous",
    unit: "contiguous | preserve_set",
    note: "ONE semantic is used everywhere, resolving the legacy FE/FE contradiction.",
  },
  priorityDownwardAllowed: {
    decisionId: "O12",
    label: "Downward re-prioritisation",
    legacyBehaviour: "Silently blocked in drag, allowed in the direct setter",
    value: "allow",
    unit: "allow | block",
    note: "Allowed with a mandatory reason. Silent rejection is a usability defect.",
  },
  priorityScoreEffect: {
    decisionId: "T6",
    label: "Does priority affect score?",
    legacyBehaviour: "No — nothing in C1–C4 reads priority",
    value: "none",
    unit: "none | modifier",
    note: "Score-neutral, matching legacy.",
  },

  /* ── Deadlines ──────────────────────────────────────────────────────────── */
  extensionPenaltyThresholdPercent: {
    decisionId: "O14",
    label: "Extension penalty threshold",
    legacyBehaviour:
      "Hard-coded zones: <50% button disabled, 50–70% no penalty, 70%+ penalty",
    value: 70,
    unit: "percent elapsed",
    note: "Retained so the workflow is demonstrable. Undocumented outside legacy code.",
  },
  extensionRequestFloorPercent: {
    decisionId: "O14",
    label: "Earliest point an extension may be requested",
    legacyBehaviour: "Below 50% elapsed the control was disabled",
    value: 50,
    unit: "percent elapsed",
    note: "Placeholder.",
  },
  proposalExpiryHours: {
    decisionId: "O15",
    label: "Deadline-proposal expiry",
    legacyBehaviour: "None — a proposal could stall indefinitely",
    value: 48,
    unit: "hours",
    note: "Introduced so the stalled state is visible. Unconfirmed.",
  },
  extensionApprover: {
    decisionId: "O16",
    label: "Who may approve an extension",
    legacyBehaviour:
      "Creator via one mechanism; any CEO/TL via the other. The two disagreed",
    value: "manager_chain",
    unit: "creator | manager_chain",
    note: "One mechanism, approved by the assignee's management chain.",
  },

  /* ── Review ─────────────────────────────────────────────────────────────── */
  reworkWaiverAllowed: {
    decisionId: "O18",
    label: "Rework-deduction waiver",
    legacyBehaviour: "Any non-employee could waive, silently and unaudited",
    value: "audited",
    unit: "none | audited | free",
    note: "Permitted but requires a reason and writes a ledger entry.",
  },
  rejectionResubmission: {
    decisionId: "O19",
    label: "Resubmission after rejection",
    legacyBehaviour: "Allowed silently — rejection was not final",
    value: "allow",
    unit: "allow | block",
    note: "Allowed, but surfaced explicitly rather than silently.",
  },
  submissionRequiresStart: {
    decisionId: "T16",
    label: "Must a task be started before submission?",
    legacyBehaviour: "No check on status at all",
    value: "require",
    unit: "require | allow",
    note: "Required here. Submitting an unstarted task is almost certainly an error.",
  },
  submissionMessageRequired: {
    decisionId: "T17",
    label: "Is a completion message mandatory?",
    legacyBehaviour: "Optional; defaulted to an empty string",
    value: "require",
    unit: "require | optional",
    note: "Required. A review with no statement of work is not reviewable.",
  },

  /* ── Projects ───────────────────────────────────────────────────────────── */
  projectProgressRule: {
    decisionId: "P1",
    label: "Project progress calculation",
    legacyBehaviour: "No project concept existed in legacy",
    value: "weighted_completion",
    unit: "task_count | weighted_completion | milestone",
    note: "Derived from connected tasks (60% task completion, 30% milestones, 10% overdue penalty). Never manually entered.",
  },
  projectHealthAtRiskPercent: {
    decisionId: "P2",
    label: "Project at-risk threshold",
    legacyBehaviour: "n/a",
    value: 15,
    unit: "percent of tasks overdue",
    note: "Placeholder.",
  },
  projectHealthOffTrackPercent: {
    decisionId: "P2",
    label: "Project off-track threshold",
    legacyBehaviour: "n/a",
    value: 30,
    unit: "percent of tasks overdue",
    note: "Placeholder.",
  },
  projectCreationPermission: {
    decisionId: "P3",
    label: "Who may create a project",
    legacyBehaviour: "n/a",
    value: "manager_and_above",
    unit: "anyone | manager_and_above | admin",
    note: "OWNER DECISION REQUIRED (brief §8.6, §8.7).",
  },
};

/** Numeric accessor. Throws loudly rather than silently defaulting. */
/**
 * The EFFECTIVE value, not the seeded one.
 *
 * Both readers go through `lib/config/settings.ts`, which returns an
 * administrator's published value when one exists and the seeded default
 * otherwise. Keeping the indirection inside these two functions means the
 * engine's call sites did not change at all — every `provisionalNumber(...)`
 * in the scoring code now reads live configuration without knowing it.
 */
export function provisionalNumber(key: keyof typeof PROVISIONAL_RULES): number {
  return ruleNumber(key as string);
}

export function provisionalString(key: keyof typeof PROVISIONAL_RULES): string {
  return String(ruleValue(key as string));
}

/** Grouped for the admin surface. */
/**
 * Grouped for the admin surface, at EFFECTIVE values.
 *
 * This used to return the raw constants, which meant that after an
 * administrator published a value the open-decisions list carried on showing
 * the seeded one — the same two-sources-of-truth bug as the rule cards, just
 * one screen over. A decision that has been published is no longer open, and
 * `resolved` says so.
 */
export function provisionalByDecision(): [
  string,
  (ProvisionalRule & {
    key: string;
    effectiveValue: number | string;
    resolved: boolean;
  })[],
][] {
  const groups = new Map<
    string,
    (ProvisionalRule & {
      key: string;
      effectiveValue: number | string;
      resolved: boolean;
    })[]
  >();
  for (const [key, rule] of Object.entries(PROVISIONAL_RULES)) {
    const list = groups.get(rule.decisionId) ?? [];
    list.push({
      ...rule,
      key,
      effectiveValue: ruleValue(key),
      resolved: isOverridden(key),
    });
    groups.set(rule.decisionId, list);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** How many decisions are still genuinely open. */
export function openDecisionCount(): number {
  return Object.keys(PROVISIONAL_RULES).filter((k) => !isOverridden(k)).length;
}

export const PROVISIONAL_COUNT = Object.keys(PROVISIONAL_RULES).length;
