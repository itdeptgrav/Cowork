import type { GoalBasedConfig, GoalKind } from "@/lib/domain/projects";

/**
 * "Taskgoal" — marking a PROJECT as oriented around a measurable objective.
 *
 * ## Deliberately NOT the C2 goal task
 *
 * The product already has a "Goal task" — `Task.isGoal`, `goalConfig`
 * (`goalStatement`, `goalDeadline`, `c2WeightagePercent`), and a roadmap of
 * scored steps. That is C2 scoring machinery. **This is not that**, and the two
 * are kept apart on purpose so a change to one cannot reach the other:
 *
 *  · different fields — `isGoalBased` / `goalBased`, never `isGoal` /
 *    `goalConfig`;
 *  · no weightage, no points, no company pool, no roadmap;
 *  · nothing here feeds scoring, ordering, deadlines or permissions. It stores
 *    an objective and displays it, exactly as the "Important" tag does.
 *
 * The name on screen is "Taskgoal" (the owner's choice); the code name is
 * `goalBased`, so a reader grepping for the C2 concept never lands here.
 */

/** Raw form values, before either number is known to be a number. */
export interface GoalBasedInput {
  objective: string;
  goalType?: string;
  successCriteria?: string;
  currentStatus?: string;
  metric?: string;
  unit?: string;
  targetValue?: string | number;
  startValue?: string | number;
}

const trimmed = (v: unknown): string => String(v ?? "").trim();
const orNull = (v: unknown): string | null => (trimmed(v) === "" ? null : trimmed(v));

/** The four kinds, and the words shown for each. The keys are the whole set —
    anything else read from storage falls back to `numeric`. */
export const GOAL_TYPE_LABEL: Record<GoalKind, string> = {
  numeric: "Measurable (numeric)",
  milestone: "Milestone / deliverable",
  qualitative: "Qualitative / outcome",
  other: "Other",
};

/** A goal type from a typed value, defaulting to `numeric` — the kind the
    numeric fields belong to, and what every record made before types existed
    is. Never throws on an unknown string. */
function readGoalType(v: unknown): GoalKind {
  const s = trimmed(v);
  return s === "milestone" || s === "qualitative" || s === "other"
    ? s
    : "numeric";
}

/**
 * A non-negative number from a typed value, or null when it is blank or not a
 * number. Blank is a legitimate "not set", so it is null rather than an error —
 * only the objective is required.
 */
function readNumber(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Build the stored config from what was typed, or null when it should not be
 * marked at all.
 *
 * **The objective is the one required field.** A Taskgoal with no objective has
 * nothing to display and nothing to mean, so an empty objective returns null —
 * the caller then simply does not mark the project, rather than storing an
 * empty marker. Every other field is optional.
 */
export function buildGoalBased(input: GoalBasedInput): GoalBasedConfig | null {
  const objective = trimmed(input.objective);
  if (!objective) return null;
  const goalType = readGoalType(input.goalType);
  /* The numeric fields belong to a numeric goal. On any other kind they are
     dropped rather than stored blank, so a qualitative goal carries no stray
     zero-shaped numbers a reader would have to ignore. */
  const numeric = goalType === "numeric";
  return {
    objective,
    goalType,
    successCriteria: orNull(input.successCriteria),
    currentStatus: orNull(input.currentStatus),
    metric: numeric ? orNull(input.metric) : null,
    unit: numeric ? orNull(input.unit) : null,
    targetValue: numeric ? readNumber(input.targetValue) : null,
    startValue: numeric ? readNumber(input.startValue) : null,
  };
}

/**
 * The target as a person would read it, for the chip and the project card, or
 * null when there is no number to show (an objective with no target is still a
 * valid Taskgoal — the objective line carries it).
 *
 *   startValue + targetValue → "120 → 500 users"
 *   targetValue only         → "Target 500 users"
 */
export function formatGoalTarget(g: GoalBasedConfig | null | undefined): string | null {
  if (!g || g.targetValue == null) return null;
  const unit = g.unit ? ` ${g.unit}` : "";
  const metric = g.metric ? ` ${g.metric}` : "";
  const tail = `${unit}${metric}`;
  return g.startValue != null
    ? `${g.startValue} → ${g.targetValue}${tail}`
    : `Target ${g.targetValue}${tail}`;
}

/**
 * Normalise a config read back from storage, dropping anything malformed rather
 * than rendering it. A stored record with no objective is not a Taskgoal.
 */
export function readGoalBased(raw: unknown): GoalBasedConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const objective = trimmed(r.objective);
  if (!objective) return null;
  const goalType = readGoalType(r.goalType);
  const numeric = goalType === "numeric";
  return {
    objective,
    goalType,
    successCriteria: orNull(r.successCriteria),
    currentStatus: orNull(r.currentStatus),
    /* Same rule as the build: numbers belong to a numeric goal only, so a
       record whose type was later changed away from numeric stops showing
       them. A record made before types existed reads as numeric and keeps its
       numbers exactly as before. */
    metric: numeric ? orNull(r.metric) : null,
    unit: numeric ? orNull(r.unit) : null,
    targetValue: numeric ? readNumber(r.targetValue) : null,
    startValue: numeric ? readNumber(r.startValue) : null,
  };
}
