/**
 * The universal earned-points scoring engine.
 *
 * OWNER-CONFIRMED (docs/specs/SCORING_LOGIC_SPEC.md §5):
 *   earnedPoints = clamp(max − Σdeductions + Σcredits, 0, max)
 *   componentPercentage = Σ earned ÷ Σ possible × 100
 *   overallPercentage   = Σ earned ÷ Σ possible × 100
 *
 * Points over points, ALWAYS. Never an average of percentages — that is the
 * exact defect in legacy's `computeBaseScore`, which averaged C1/C2/C4, added
 * raw C3, and applied neither a floor nor a cap.
 *
 * Confirmed constants live here. Everything unconfirmed is read through
 * `lib/config/provisional.ts` so it can be labelled at the point of display.
 */

import type {
  ChannelBreakdown,
  ChannelId,
  ScoreEventType,
  ScoreLedgerEntry,
  ScoreOverview,
  ScoreUnit,
} from "../../domain/scoring.ts";
import { CHANNEL_CODE, CHANNEL_LABEL } from "../../domain/scoring.ts";
import {
  confirmedNumber,
  isOverridden,
  ruleNumber,
} from "../../config/settings.ts";
import { PROVISIONAL_RULES, provisionalNumber } from "../../config/provisional.ts";

/* ── Confirmed constants ──────────────────────────────────────────────────── */

/** Every measurable unit has a maximum of 1.0 unless a rule says otherwise. */
export const UNIT_MAXIMUM = 1.0;

/** Owner-confirmed: each rework deducts 0.2. Legacy already matched this. */
/**
 * The one owner-CONFIRMED deduction. It is not in `PROVISIONAL_RULES` because
 * it is not provisional — but it is still configurable, because "confirmed"
 * means the owner chose 0.2, not that 0.2 can never change. `reworkDeduction`
 * resolves through the same override layer with this as its default.
 */
export const REWORK_DEDUCTION = 0.2;

/* ── The clamp ────────────────────────────────────────────────────────────── */

export function clampPoints(
  raw: number,
  maximumPoints: number = UNIT_MAXIMUM,
): number {
  return round2(Math.max(0, Math.min(maximumPoints, raw)));
}

export function earnedPoints({
  maximumPoints = UNIT_MAXIMUM,
  deductions = 0,
  credits = 0,
}: {
  maximumPoints?: number;
  deductions?: number;
  credits?: number;
}): number {
  return clampPoints(maximumPoints - deductions + credits, maximumPoints);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── Percentages ──────────────────────────────────────────────────────────── */

export function unitPercentage(unit: ScoreUnit): number {
  if (unit.maximumPoints <= 0) return 0;
  return round2((unit.earnedPoints / unit.maximumPoints) * 100);
}

/**
 * Points over points across the units supplied. Excluded units drop out of BOTH
 * numerator and denominator — an excluded unit is not a zero.
 */
export function aggregate(units: ScoreUnit[]): {
  earned: number;
  possible: number;
  percentage: number;
  count: number;
} {
  const included = units.filter((u) => !u.isExcluded);
  const earned = round2(included.reduce((s, u) => s + u.earnedPoints, 0));
  const possible = round2(included.reduce((s, u) => s + u.maximumPoints, 0));
  return {
    earned,
    possible,
    percentage: possible > 0 ? round2((earned / possible) * 100) : 0,
    count: included.length,
  };
}

/* ── Deduction resolution ─────────────────────────────────────────────────── */

export interface DeductionResult {
  amount: number;
  ruleKey: string | null;
  isProvisional: boolean;
  label: string;
}

/**
 * Resolves the deduction for a score event.
 *
 * Only `rework_applied` is owner-confirmed. Everything else reads a provisional
 * rule and is flagged so the UI can disclose it.
 */
export function deductionFor(
  eventType: ScoreEventType,
  context: {
    lateMinutes?: number;
    earlyMinutes?: number;
    severity?: string;
  } = {},
): DeductionResult {
  switch (eventType) {
    case "rework_applied": {
      const amount = confirmedNumber("reworkDeduction", REWORK_DEDUCTION);
      return {
        amount,
        ruleKey: "reworkDeduction",
        isProvisional: false,
        label: `Rework — owner-confirmed ${amount} per occurrence`,
      };
    }

    case "deadline_missed":
      return prov("deadlineMissDeduction");

    case "extension_charged":
      return prov("extensionDeduction");

    case "rejection_applied":
      return prov("rejectionDeduction");

    case "goal_activity_late": {
      const r = PROVISIONAL_RULES.goalLateDeduction;
      return {
        amount: Number(r.value),
        ruleKey: "goalLateDeduction",
        isProvisional: true,
        label: r.label,
      };
    }

    case "conduct_breach": {
      const key =
        context.severity === "falsification"
          ? "conductFalsification"
          : context.severity === "serious"
            ? "conductSerious"
            : context.severity === "moderate"
              ? "conductModerate"
              : context.severity === "idle_pool"
                ? "conductIdlePool"
                : "conductMinor";
      return prov(key);
    }

    case "late_arrival": {
      // Proportional lateness IS confirmed; the rate is not.
      const grace = provisionalNumber("latenessGracePeriodMins");
      const rate = provisionalNumber("latenessRatePerMinute");
      const chargeable = Math.max(0, (context.lateMinutes ?? 0) - grace);
      return {
        amount: round2(chargeable * rate),
        ruleKey: "latenessRatePerMinute",
        isProvisional: true,
        label: `Lateness — ${chargeable} chargeable min × ${rate}/min`,
      };
    }

    case "early_departure": {
      const rate = provisionalNumber("earlyDepartureRatePerMinute");
      return {
        amount: round2((context.earlyMinutes ?? 0) * rate),
        ruleKey: "earlyDepartureRatePerMinute",
        isProvisional: true,
        label: "Early departure",
      };
    }

    case "absence":
      return prov("absenceDeduction");

    default:
      return { amount: 0, ruleKey: null, isProvisional: false, label: "" };
  }
}

/**
 * A provisional deduction, at its EFFECTIVE value.
 *
 * This read `PROVISIONAL_RULES[key].value` directly, which meant it bypassed
 * the override layer entirely — an administrator could publish a new
 * missed-deadline deduction, the rule card would show it, and this function
 * would carry on returning the seeded number with nothing reporting the
 * divergence. The label still comes from the constant, because the label
 * describes what the rule IS; only the value is configurable.
 */
function prov(key: string): DeductionResult {
  const rule = PROVISIONAL_RULES[key];
  return {
    amount: ruleNumber(key),
    ruleKey: key,
    /* Publishing a value resolves the open decision, so an overridden rule is
       no longer provisional and must stop being badged as one. */
    isProvisional: !isOverridden(key),
    label: rule.label,
  };
}

/* ── Channel and overview assembly ────────────────────────────────────────── */

const CAPTION: Record<ChannelId, string> = {
  c1: "On-time completion, rework and extensions",
  c2: "Attainment against assigned goals",
  c3: "Deduction only — never adds to a score",
  c4: "Recorded attendance against expected",
};

export function buildChannel(
  id: ChannelId,
  units: ScoreUnit[],
  ledger: ScoreLedgerEntry[],
): ChannelBreakdown {
  const mine = units.filter((u) => u.component === id);
  const agg = aggregate(mine);
  const hasProvisional = ledger.some(
    (e) => e.component === id && e.isProvisional,
  );

  // C3 is deduction-only, so its percentage reads as "how much was lost".
  // The Deduction Hangs Rule: it fills DOWNWARD, so direction carries the
  // semantics and a large deduction can never be misread as a strong result.
  const isDeduction = id === "c3";
  const lostPercent =
    agg.possible > 0
      ? round2(((agg.possible - agg.earned) / agg.possible) * 100)
      : 0;

  return {
    id,
    code: CHANNEL_CODE[id],
    label: CHANNEL_LABEL[id],
    earnedPoints: agg.earned,
    possiblePoints: agg.possible,
    percentage: isDeduction ? -lostPercent : agg.percentage,
    unitCount: agg.count,
    direction: isDeduction ? "down" : "up",
    // Independent baseline per The No Weighting Rule — never sized against
    // the other channels.
    extent: isDeduction ? Math.min(100, lostPercent) : agg.percentage,
    caption: CAPTION[id],
    hasProvisionalRules: hasProvisional,
  };
}

export function buildOverview(
  employeeId: string,
  periodKey: string,
  units: ScoreUnit[],
  ledger: ScoreLedgerEntry[],
  previousPeriodPercentage: number | null,
): ScoreOverview {
  const channels: ChannelBreakdown[] = (
    ["c1", "c2", "c3", "c4"] as ChannelId[]
  ).map((id) => buildChannel(id, units, ledger));

  /**
   * Overall is points over points across every included unit in every
   * component. Deliberately NOT an average of the four channel percentages —
   * that would weight a component with one unit the same as one with fifty.
   *
   * But pooling is not neutral either, and an earlier comment here claimed it
   * was. Pooling weights each component BY ITS UNIT COUNT: 18 attendance days
   * against 1 completed task produces a composite that is 67% attendance. That
   * is a weighting the product has not chosen (O2, docs/architecture/PRODUCT.md:87).
   *
   * Both available aggregations therefore assert something. Pooling is kept
   * because it is at least traceable to real events, but the figure it produces
   * is PROVISIONAL, and `earnedPoints`/`possiblePoints` must not be rendered as
   * a decomposition — that is the form that publishes the split. Callers get
   * them for the ledger and for arithmetic, not for display.
   */
  const overall = aggregate(units);

  return {
    employeeId,
    periodKey,
    overallPercentage: overall.percentage,
    earnedPoints: overall.earned,
    possiblePoints: overall.possible,
    delta:
      previousPeriodPercentage === null
        ? 0
        : round2(overall.percentage - previousPeriodPercentage),
    channels,
    hasProvisionalRules: channels.some((c) => c.hasProvisionalRules),
  };
}

/* ── Ledger construction ──────────────────────────────────────────────────── */

export interface AppendLedgerInput {
  /** Owning tenant, carried from the caller's request context. */
  organisationId: string;
  employeeId: string;
  component: ChannelId;
  sourceType: ScoreLedgerEntry["sourceType"];
  sourceId: string;
  sourceLabel: string;
  scoreUnitId: string;
  eventType: ScoreEventType;
  maximumPoints: number;
  pointsBefore: number;
  deduction: number;
  credit: number;
  reason: string;
  actorId: string;
  actorLabel: string;
  effectiveDate: string;
  periodKey: string;
  ruleId: string;
  ruleVersion: string;
  configSnapshot: Record<string, number>;
  isProvisional: boolean;
  reversalOf?: string | null;
  isManualAdjustment?: boolean;
  adjustmentReason?: string | null;
}

/**
 * Builds one immutable ledger entry.
 *
 * The invariant `pointsAfter === clamp(before − deduction + credit, 0, max)` is
 * enforced here rather than trusted, so a row can always be verified.
 */
export function makeLedgerEntry(
  id: string,
  input: AppendLedgerInput,
  createdAt: string,
): ScoreLedgerEntry {
  const pointsAfter = clampPoints(
    input.pointsBefore - input.deduction + input.credit,
    input.maximumPoints,
  );

  return {
    /* Stamped from the entry's own employee context. The ledger is immutable and
       per-tenant; an entry that could not name its organisation could not be
       isolated by one. */
    organisationId: input.organisationId,
    id,
    employeeId: input.employeeId,
    component: input.component,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    scoreUnitId: input.scoreUnitId,
    eventType: input.eventType,
    maximumPoints: input.maximumPoints,
    deduction: round2(input.deduction),
    credit: round2(input.credit),
    pointsBefore: round2(input.pointsBefore),
    pointsAfter,
    reason: input.reason,
    actorId: input.actorId,
    actorLabel: input.actorLabel,
    effectiveDate: input.effectiveDate,
    periodKey: input.periodKey,
    createdAt,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    configSnapshot: input.configSnapshot,
    isManualAdjustment: input.isManualAdjustment ?? false,
    adjustmentReason: input.adjustmentReason ?? null,
    reversalOf: input.reversalOf ?? null,
    isProvisional: input.isProvisional,
  };
}

/** Verifies the ledger invariant. Used by the ledger view and by tests. */
export function verifyLedgerEntry(entry: ScoreLedgerEntry): boolean {
  const expected = clampPoints(
    entry.pointsBefore - entry.deduction + entry.credit,
    entry.maximumPoints,
  );
  return Math.abs(expected - entry.pointsAfter) < 0.001;
}

/* ── Periods ──────────────────────────────────────────────────────────────── */

/** Quarterly bucketing — PROVISIONAL (O3). `effectiveDate` decides, never now. */
export function periodKeyFor(isoDate: string): string {
  const d = new Date(isoDate);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

export function previousPeriodKey(periodKey: string): string {
  const [yearStr, qStr] = periodKey.split("-Q");
  const year = Number(yearStr);
  const q = Number(qStr);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

export function formatPeriod(periodKey: string): string {
  const [year, q] = periodKey.split("-Q");
  return `Q${q} ${year}`;
}
