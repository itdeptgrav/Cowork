/**
 * `cowork_sop_settings/task_events` — the scoring values the Express engine reads.
 *
 * **This document already exists and is already load-bearing.** It is not a new
 * settings store and nothing here needed a backend change. The engine reads it
 * in seven places:
 *
 * | Field group | Read by |
 * |---|---|
 * | `c1*` | `services/c1Service.js` → `getC1Config`, and `soproute.js /all-categories` |
 * | `c2GlobalMaxPoints` | `services/pmpService.js`, `routes/task_routes/c2Band.routes.js` |
 * | `goal*` | `components/coworking/tasks/GoalTask.jsx` |
 * | `timer*` | `services/timerSop.service.js` → `evaluateTimerSop` |
 *
 * Legacy writes it straight from the browser in `app/coworking/sop/page.js`,
 * gated on `role === "ceo"` — the same documented exception class as the timer,
 * the duty document and `cowork_settings/office`: reads are Firestore, writes are
 * HTTP, *except* where the engine offers no route.
 *
 * ## The write has TWO halves and both are required
 *
 * ```
 *   setDoc(cowork_sop_settings/task_events)        ← Firestore. The engine reads this.
 *   POST /cowork/sop/settings/sync                 ← mirrors into MongoDB BandConfig.
 * ```
 *
 * `BandConfig.globalSettings.c1.*` is a separate copy of the same numbers, read
 * by band resolution. Legacy's own page does both, in that order. Writing only
 * the Firestore half leaves MongoDB stating the previous values, and the two are
 * read by different code paths — so a score would be computed from one copy and
 * explained from the other, with nothing reporting the divergence.
 *
 * ## Defaults are the ENGINE's, not ours
 *
 * `c1Service.js` falls back to `c1DeadlineDeduction: 0.5`. Our own
 * `PROVISIONAL_RULES.deadlineMissDeduction` says `0.2`, and legacy's Mongo sync
 * route says `0.2` again in *its* fallback. Three numbers for one rule.
 *
 * The values below are `c1Service.js`'s, because that is the function that
 * actually computes the score. The others are stale placeholders, and reading a
 * default from the wrong one would show an administrator a figure the engine
 * never used.
 */

export interface ScoringSettings {
  /* ── C1 · execution quality ─────────────────────────────────────────────── */
  /** The component's point pool. */
  c1MaxPoints: number;
  /** A task's score before deductions. */
  c1BaseScore: number;
  c1DeadlineDeduction: number;
  c1ExtensionDeduction: number;
  c1ReworkDeduction: number;
  /** The score a rejected task is overridden to — not a deduction. */
  c1RejectScore: number;

  /* ── C2 · goals ─────────────────────────────────────────────────────────── */
  /**
   * The organisation-wide C2 pool.
   *
   * A band configuration can override it per employee (`getBandMaxForEmployee`),
   * and does take precedence. So this is the figure for anybody without a band,
   * which the console says rather than implying it is universal.
   */
  c2GlobalMaxPoints: number;
  goalTotalPoints: number;
  goalFinalNodeWeightPct: number;
  goalBonusPoints: number;

  /* ── C3 · idle pool, from the timer ─────────────────────────────────────── */
  /**
   * The kill switch, and it is genuinely one.
   *
   * `evaluateTimerSop` checks it **first, before anything else runs**, and every
   * trigger path goes through that one function — the timer pause, the task
   * auto-stop, the daily cron and the CEO test tool. So `false` pauses point
   * cutting *and* adding for everybody, immediately.
   */
  timerSopEnabled: boolean;
  /** The daily target in hours. Used when the percentage below is zero. */
  timerMinDailyHrs: number;
  /**
   * The daily target as a percentage of that day's available hours.
   *
   * **Takes precedence over the hours figure when above zero.** Two fields for
   * one target is legacy's shape, not a choice — the percentage is the newer of
   * the two and the engine prefers it.
   */
  timerMinDailyPct: number;
  /** Accumulated shortfall, in hours, before the deduction fires. */
  timerDeficitThresholdHrs: number;
  timerDeficitPoints: number;
  timerOvertimeThresholdHrs: number;
  timerOvertimePoints: number;
}

/** `c1Service.js`'s `C1_DEFAULTS`, plus the engine's own fallbacks elsewhere. */
export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  c1MaxPoints: 35,
  c1BaseScore: 1,
  c1DeadlineDeduction: 0.5,
  c1ExtensionDeduction: 0.2,
  c1ReworkDeduction: 0.2,
  c1RejectScore: 0,
  c2GlobalMaxPoints: 30,
  goalTotalPoints: 0,
  goalFinalNodeWeightPct: 0,
  goalBonusPoints: 0,
  timerSopEnabled: true,
  timerMinDailyHrs: 8,
  timerMinDailyPct: 0,
  timerDeficitThresholdHrs: 1,
  timerDeficitPoints: 0.5,
  timerOvertimeThresholdHrs: 1,
  timerOvertimePoints: 0.5,
};

/**
 * A number from the document, or the engine's default.
 *
 * **Zero has to survive.** `Number(d.x) || fallback` — which is what legacy
 * writes — turns a deliberate zero into the default, and zero is meaningful for
 * every deduction here: it is how an administrator switches one off. So the
 * check is finiteness, not truthiness.
 */
function figure(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function readScoringSettings(
  doc: Record<string, unknown> | null,
): ScoringSettings {
  const d = doc ?? {};
  return {
    c1MaxPoints: figure(d.c1MaxPoints, DEFAULT_SCORING_SETTINGS.c1MaxPoints),
    c1BaseScore: figure(d.c1BaseScore, DEFAULT_SCORING_SETTINGS.c1BaseScore),
    c1DeadlineDeduction: figure(
      d.c1DeadlineDeduction,
      DEFAULT_SCORING_SETTINGS.c1DeadlineDeduction,
    ),
    c1ExtensionDeduction: figure(
      d.c1ExtensionDeduction,
      DEFAULT_SCORING_SETTINGS.c1ExtensionDeduction,
    ),
    c1ReworkDeduction: figure(
      d.c1ReworkDeduction,
      DEFAULT_SCORING_SETTINGS.c1ReworkDeduction,
    ),
    c1RejectScore: figure(d.c1RejectScore, DEFAULT_SCORING_SETTINGS.c1RejectScore),
    c2GlobalMaxPoints: figure(
      d.c2GlobalMaxPoints,
      DEFAULT_SCORING_SETTINGS.c2GlobalMaxPoints,
    ),
    goalTotalPoints: figure(
      d.goalTotalPoints,
      DEFAULT_SCORING_SETTINGS.goalTotalPoints,
    ),
    goalFinalNodeWeightPct: figure(
      d.goalFinalNodeWeightPct,
      DEFAULT_SCORING_SETTINGS.goalFinalNodeWeightPct,
    ),
    goalBonusPoints: figure(
      d.goalBonusPoints,
      DEFAULT_SCORING_SETTINGS.goalBonusPoints,
    ),
    /* Only an explicit `false` disables it. An absent field is a workspace that
       has never opened the page, and the engine treats that as enabled — so
       defaulting to off here would silently stop every deduction in the company
       on first read. */
    timerSopEnabled: d.timerSopEnabled !== false,
    timerMinDailyHrs: figure(
      d.timerMinDailyHrs,
      DEFAULT_SCORING_SETTINGS.timerMinDailyHrs,
    ),
    timerMinDailyPct: figure(
      d.timerMinDailyPct,
      DEFAULT_SCORING_SETTINGS.timerMinDailyPct,
    ),
    timerDeficitThresholdHrs: figure(
      d.timerDeficitThresholdHrs,
      DEFAULT_SCORING_SETTINGS.timerDeficitThresholdHrs,
    ),
    timerDeficitPoints: figure(
      d.timerDeficitPoints,
      DEFAULT_SCORING_SETTINGS.timerDeficitPoints,
    ),
    timerOvertimeThresholdHrs: figure(
      d.timerOvertimeThresholdHrs,
      DEFAULT_SCORING_SETTINGS.timerOvertimeThresholdHrs,
    ),
    timerOvertimePoints: figure(
      d.timerOvertimePoints,
      DEFAULT_SCORING_SETTINGS.timerOvertimePoints,
    ),
  };
}

/** Every numeric field, for validation and for the editor's field list. */
const NUMERIC_FIELDS: {
  key: keyof ScoringSettings;
  label: string;
  /** Deductions are bounded by the base score; pools are not. */
  max?: number;
}[] = [
  { key: "c1MaxPoints", label: "C1 maximum points" },
  { key: "c1BaseScore", label: "C1 base score", max: 10 },
  { key: "c1DeadlineDeduction", label: "Missed-deadline deduction", max: 10 },
  { key: "c1ExtensionDeduction", label: "Extension deduction", max: 10 },
  { key: "c1ReworkDeduction", label: "Rework deduction", max: 10 },
  { key: "c1RejectScore", label: "Rejected-task score", max: 10 },
  { key: "c2GlobalMaxPoints", label: "C2 global maximum points" },
  { key: "goalTotalPoints", label: "Goal total points" },
  { key: "goalFinalNodeWeightPct", label: "Goal final-node weight", max: 100 },
  { key: "goalBonusPoints", label: "Goal bonus points" },
  { key: "timerMinDailyHrs", label: "Daily target hours", max: 24 },
  { key: "timerMinDailyPct", label: "Daily target percentage", max: 100 },
  { key: "timerDeficitThresholdHrs", label: "Shortfall threshold hours" },
  { key: "timerDeficitPoints", label: "Shortfall deduction" },
  { key: "timerOvertimeThresholdHrs", label: "Overtime threshold hours" },
  { key: "timerOvertimePoints", label: "Overtime credit" },
];

export { NUMERIC_FIELDS as SCORING_NUMERIC_FIELDS };

/**
 * Why these settings cannot be saved, or null.
 *
 * Every value reaches a published score, so this validates before the write
 * rather than trusting the form. A negative deduction would *add* points for
 * missing a deadline — arithmetically valid, and the opposite of the rule.
 */
export function validateScoringSettings(
  settings: ScoringSettings,
): string | null {
  for (const field of NUMERIC_FIELDS) {
    const value = settings[field.key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${field.label} must be a number.`;
    }
    if (value < 0) {
      return `${field.label} cannot be negative. A negative deduction adds points for the thing it is meant to penalise.`;
    }
    if (field.max !== undefined && value > field.max) {
      return `${field.label} cannot be more than ${field.max}.`;
    }
  }
  if (settings.c1DeadlineDeduction > settings.c1BaseScore) {
    return "The missed-deadline deduction is larger than the base score, so one miss would take a task below zero on its own. Raise the base score or lower the deduction.";
  }
  return null;
}

/** The Firestore half of the write. Field names are legacy's. */
export function writeScoringSettings(
  settings: ScoringSettings,
  updatedBy: string,
  updatedByName: string,
): Record<string, unknown> {
  return {
    c1MaxPoints: settings.c1MaxPoints,
    c1BaseScore: settings.c1BaseScore,
    c1DeadlineDeduction: settings.c1DeadlineDeduction,
    c1ExtensionDeduction: settings.c1ExtensionDeduction,
    c1ReworkDeduction: settings.c1ReworkDeduction,
    c1RejectScore: settings.c1RejectScore,
    c2GlobalMaxPoints: settings.c2GlobalMaxPoints,
    goalTotalPoints: settings.goalTotalPoints,
    goalFinalNodeWeightPct: settings.goalFinalNodeWeightPct,
    goalBonusPoints: settings.goalBonusPoints,
    timerSopEnabled: settings.timerSopEnabled,
    timerMinDailyHrs: settings.timerMinDailyHrs,
    timerMinDailyPct: settings.timerMinDailyPct,
    timerDeficitThresholdHrs: settings.timerDeficitThresholdHrs,
    timerDeficitPoints: settings.timerDeficitPoints,
    timerOvertimeThresholdHrs: settings.timerOvertimeThresholdHrs,
    timerOvertimePoints: settings.timerOvertimePoints,
    updatedBy,
    updatedByName,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The MongoDB half — the body `POST /cowork/sop/settings/sync` expects.
 *
 * Only the fields that route reads. It ignores the timer and goal figures
 * entirely, which is correct: `BandConfig` holds band-relevant maximums, and the
 * timer SOP is evaluated from Firestore alone. Sending more would be silently
 * dropped and would suggest a mirror that is more complete than it is.
 *
 * The `*Desc` fields are legacy's per-value descriptions, shown in its own SOP
 * catalogue. Empty strings rather than omitted: the route writes whatever it is
 * given, and omitting them would blank descriptions somebody wrote in the old app.
 */
export function scoringSyncBody(
  settings: ScoringSettings,
  descriptions: Partial<Record<string, string>> = {},
): Record<string, unknown> {
  return {
    c1MaxPoints: settings.c1MaxPoints,
    c1MaxPointsDesc: descriptions.c1MaxPointsDesc ?? "",
    c1BaseScore: settings.c1BaseScore,
    c1BaseScoreDesc: descriptions.c1BaseScoreDesc ?? "",
    c1DeadlineDeduction: settings.c1DeadlineDeduction,
    c1DeadlineDesc: descriptions.c1DeadlineDesc ?? "",
    c1ExtensionDeduction: settings.c1ExtensionDeduction,
    c1ExtensionDesc: descriptions.c1ExtensionDesc ?? "",
    c1ReworkDeduction: settings.c1ReworkDeduction,
    c1ReworkDesc: descriptions.c1ReworkDesc ?? "",
    c1RejectScore: settings.c1RejectScore,
    c1RejectDesc: descriptions.c1RejectDesc ?? "",
    c2GlobalMaxPoints: settings.c2GlobalMaxPoints,
    c2GlobalMaxPointsDesc: descriptions.c2GlobalMaxPointsDesc ?? "",
  };
}

/**
 * Which daily target is actually in force.
 *
 * Stated as a function because the precedence is not obvious from the two
 * fields, and a console that showed both without saying which one applies would
 * leave an administrator adjusting the one the engine ignores.
 */
export function effectiveDailyTarget(settings: ScoringSettings): {
  kind: "percentage" | "hours";
  value: number;
  sentence: string;
} {
  if (settings.timerMinDailyPct > 0) {
    return {
      kind: "percentage",
      value: settings.timerMinDailyPct,
      sentence: `${settings.timerMinDailyPct}% of the day's available hours — your online-to-close window, minus breaks. The hours figure is ignored while this is above zero.`,
    };
  }
  return {
    kind: "hours",
    value: settings.timerMinDailyHrs,
    sentence: `${settings.timerMinDailyHrs}h a day. Set the percentage above zero to target a share of available hours instead.`,
  };
}
