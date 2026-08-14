/**
 * The universal earned-points scoring model (docs/specs/SCORING_LOGIC_SPEC.md §5,
 * owner-confirmed).
 *
 *   earnedPoints = clamp(maximumPoints − Σdeductions + Σcredits, 0, maximumPoints)
 *
 *   componentPercentage = Σ earned ÷ Σ possible × 100
 *   overallPercentage   = Σ earned ÷ Σ possible × 100
 *
 * NEVER average percentages when possible points differ. That is the specific
 * defect in legacy's `computeBaseScore`, which averaged C1/C2/C4 and added raw
 * C3 with no floor and no cap.
 */

import type { EmployeeId } from "./identity";

export type ChannelId = "c1" | "c2" | "c3" | "c4";

/** Labels are fixed (docs/architecture/MIGRATION_DECISIONS.md D14). Code always shown WITH label. */
export const CHANNEL_LABEL: Record<ChannelId, string> = {
  c1: "Task Execution",
  c2: "Goal Attainment",
  c3: "Conduct & Policy",
  c4: "Attendance",
};

export const CHANNEL_CODE: Record<ChannelId, string> = {
  c1: "C1",
  c2: "C2",
  c3: "C3",
  c4: "C4",
};

export type ScoreSourceType =
  "task" | "goal_activity" | "conduct_event" | "attendance_day";

export interface ScoringRule {
  id: string;
  key: string;
  component: ChannelId;
  displayName: string;
  description: string;
  currentVersionId: string;
  /**
   * An inactive rule is not applied. Distinct from archiving: a rule can be
   * switched off for a period and switched back on, and the ledger entries it
   * already wrote stay exactly as they were.
   */
  isActive: boolean;
  /** Archived rules are hidden and never applied. Never hard-deleted — a
   *  deleted rule would orphan every ledger entry that cites it. */
  archivedAt: string | null;
  /** Who the rule applies to. Empty lists mean "everyone". */
  appliesTo: {
    departmentIds: string[];
    roleIds: string[];
  };
  /**
   * The engine keys this rule writes. A rule with no bound keys is documentation
   * — the editor says so rather than implying the value is in force.
   */
  engineKeys: string[];
}

export interface ScoringRuleVersion {
  id: string;
  ruleId: string;
  version: string;
  parameters: Record<string, number>;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdById: EmployeeId | "system";
  createdAt: string;
  supersedesVersionId: string | null;
  /**
   * True when the parameter values are NOT owner-confirmed and exist only so
   * the prototype can run. Every surface that displays a figure derived from a
   * provisional rule must say so.
   */
  isProvisional: boolean;
  provisionalNote: string | null;
}

/** One measurable unit. Maximum is 1.0 unless an approved rule says otherwise. */
export interface ScoreUnit {
  id: string;
  employeeId: EmployeeId;
  component: ChannelId;
  sourceType: ScoreSourceType;
  sourceId: string;
  sourceLabel: string;
  periodKey: string;
  maximumPoints: number;
  earnedPoints: number;
  isExcluded: boolean;
  exclusionReason: string | null;
  /** OWNER DECISION O17 — legacy never finalised anything. */
  finalisedAt: string | null;
  effectiveDate: string;
}

export type ScoreEventType =
  | "task_completed"
  | "rework_applied"
  | "deadline_missed"
  | "extension_charged"
  | "extension_waived"
  | "rejection_applied"
  | "goal_activity_completed"
  | "goal_activity_late"
  | "conduct_breach"
  | "attendance_present"
  | "late_arrival"
  | "early_departure"
  | "absence"
  | "overtime_credit"
  | "manual_adjustment"
  | "reversal";

export interface ScoreEvent {
  id: string;
  scoreUnitId: string;
  eventType: ScoreEventType;
  deduction: number;
  credit: number;
  ruleId: string;
  ruleVersionId: string;
  effectiveDate: string;
  createdAt: string;
}

/**
 * The immutable ledger. Append-only: no update, no delete. Corrections are
 * reversals that reference what they reverse.
 *
 * `ruleVersion` + `configSnapshot` are what make a historical score
 * REPRODUCIBLE after a rule change — the single most important property the
 * legacy `Employee.sopPoints` array lacked.
 */
export interface ScoreLedgerEntry {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  employeeId: EmployeeId;
  component: ChannelId;
  sourceType: ScoreSourceType | "manual";
  sourceId: string;
  sourceLabel: string;
  scoreUnitId: string;
  eventType: ScoreEventType;

  maximumPoints: number;
  deduction: number;
  credit: number;
  pointsBefore: number;
  pointsAfter: number;

  reason: string;
  actorId: EmployeeId | "system";
  actorLabel: string;

  /** Decides the period. `createdAt` never does. */
  effectiveDate: string;
  periodKey: string;
  createdAt: string;

  ruleId: string;
  ruleVersion: string;
  configSnapshot: Record<string, number>;

  isManualAdjustment: boolean;
  adjustmentReason: string | null;
  reversalOf: string | null;
  /** Mirrors the rule version that produced it, surfaced for labelling. */
  isProvisional: boolean;

  /**
   * The argument about this entry, where there has been one.
   *
   * Optional because only C3 entries can be disputed and only the engine
   * records it — everything else leaves these absent rather than claiming a
   * dispute that cannot exist.
   *
   * **Without them the row could not tell the truth about itself.** It offered
   * "Ask for a recheck" to somebody who had already asked, because it had no
   * way to know; and when the manager decided, they wrote a reason that reached
   * nobody — the person whose score it was never saw why. Both were reported.
   *
   * `status` is the engine's own word: `"none"`, `"pending"`, `"confirmed"`
   * (the deduction was REVERSED — the employee was right) or `"rejected"` (it
   * stands). That vocabulary is inverted for a reader, so nothing renders it
   * raw; see `disputeOutcome` in `lib/rules/scoring/conduct.ts`.
   */
  disputeStatus?: string | null;
  /** What the person said when they asked for the recheck. */
  disputeNote?: string | null;
  /** What the reviewer wrote when they decided it. */
  disputeReviewNote?: string | null;
  /** Who decided it. */
  disputeReviewedBy?: string | null;
}

/** Derived cache. Must be rebuildable from the ledger alone. */
export interface ScoreSnapshot {
  id: string;
  employeeId: EmployeeId;
  periodKey: string;
  component: ChannelId | "overall";
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
  unitCount: number;
  computedAt: string;
  ledgerHighWaterMark: string;
}

/** What a score surface renders: one channel, fully traceable. */
export interface ChannelBreakdown {
  id: ChannelId;
  code: string;
  label: string;
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
  /**
   * How many things were measured, or **null when the provider does not say**.
   *
   * Null and zero are different claims and the difference is visible on screen:
   * zero means "nothing has been measured yet", null means "we were not told".
   * The legacy engine sends no count at all, so writing zero there produced
   * "0 units measured" beside a real percentage — two statements that cannot
   * both be true, and the reason the overview reads as broken.
   */
  unitCount: number | null;
  /** C3 hangs downward per The Deduction Hangs Rule. */
  direction: "up" | "down";
  /** Bar extent 0–100, independent of the other channels (No Weighting Rule). */
  extent: number;
  caption: string;
  hasProvisionalRules: boolean;
}

export interface ScoreOverview {
  employeeId: EmployeeId;
  periodKey: string;
  /** Points over points across all included components. Never an average of %. */
  overallPercentage: number;
  earnedPoints: number;
  possiblePoints: number;
  /** Change in percentage points against the previous period. */
  delta: number;
  channels: ChannelBreakdown[];
  hasProvisionalRules: boolean;
}
