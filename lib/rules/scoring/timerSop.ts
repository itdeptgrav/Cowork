/**
 * The Timer SOP Point Engine — ported from the legacy cowork
 * (`services/timerSop.service.js`).
 *
 * It judges an employee's tracked WORK TIME day by day against a daily target
 * and moves points when accumulated shortfall or overtime crosses a threshold:
 *
 *  - DEFICIT: each working day, `shortfall = max(0, requiredHours − workedHours)`
 *    accumulates. Every time the running total reaches the deficit threshold it
 *    cuts `deficitPoints` and subtracts the threshold — the remainder carries
 *    forward, exactly as legacy did.
 *  - OVERTIME: worked time AFTER the day's office close (and all worked time on
 *    an off day) accumulates the same way and adds `overtimePoints` per
 *    threshold crossing.
 *
 * The two rules are independent: one day can add to both counters.
 *
 * This is the pure arithmetic. `bucketWorkByDay` (workTime.ts) turns real work
 * commits + the office policy into the per-day input; the repository feeds real
 * data in, never a fabricated figure. The daily target and both point rates are
 * unconfirmed (O5), so anything derived is disclosed as provisional.
 */

export interface TimerSopConfig {
  /** Master switch. Off = paused: no points are cut or added for anyone. */
  enabled: boolean;
  /** Flat daily target in hours. Ignored while `dailyMinPercent` is above 0. */
  dailyMinHours: number;
  /**
   * Daily target as a percentage of that day's office span (minus breaks).
   * Above 0 this REPLACES the flat hours; 0 keeps the flat figure.
   */
  dailyMinPercent: number;
  deficitThresholdHours: number;
  deficitPoints: number;
  overtimeThresholdHours: number;
  overtimePoints: number;
}

export const DEFAULT_TIMER_SOP_CONFIG: TimerSopConfig = {
  enabled: false,
  dailyMinHours: 7.5,
  dailyMinPercent: 90,
  deficitThresholdHours: 1,
  deficitPoints: 0.1,
  overtimeThresholdHours: 1,
  overtimePoints: 0.1,
};

/** One day of tracked work, already resolved against the office calendar. */
export interface DayWork {
  date: string;
  workedHours: number;
  /** Worked time after office close, plus all worked time on an off day. */
  afterOfficeHours: number;
  isOff: boolean;
  /** Office span minus breaks for that day — the base for a percentage target. */
  expectedHours: number;
}

export interface DayEvaluation {
  date: string;
  workedHours: number;
  requiredHours: number;
  shortfallHours: number;
  afterOfficeHours: number;
  isOff: boolean;
}

export interface TimerSopResult {
  /** True when the engine is switched off — nothing accumulates or applies. */
  paused: boolean;
  /** Remainder carried toward the next deficit trigger. */
  deficitAccumHours: number;
  /** Remainder carried toward the next overtime trigger. */
  overtimeAccumHours: number;
  deficitTriggers: number;
  overtimeTriggers: number;
  pointsDeducted: number;
  pointsAdded: number;
  /** pointsAdded − pointsDeducted. */
  netPoints: number;
  days: DayEvaluation[];
}

const PAUSED: TimerSopResult = {
  paused: true,
  deficitAccumHours: 0,
  overtimeAccumHours: 0,
  deficitTriggers: 0,
  overtimeTriggers: 0,
  pointsDeducted: 0,
  pointsAdded: 0,
  netPoints: 0,
  days: [],
};

export function requiredHoursFor(day: DayWork, config: TimerSopConfig): number {
  return config.dailyMinPercent > 0
    ? (config.dailyMinPercent / 100) * day.expectedHours
    : config.dailyMinHours;
}

export function evaluateTimerSop(
  days: DayWork[],
  config: TimerSopConfig,
): TimerSopResult {
  if (!config.enabled) return { ...PAUSED };

  let deficitAccum = 0;
  let overtimeAccum = 0;
  let deficitTriggers = 0;
  let overtimeTriggers = 0;
  let pointsDeducted = 0;
  let pointsAdded = 0;
  const evals: DayEvaluation[] = [];

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of sorted) {
    const required = requiredHoursFor(d, config);
    const shortfall = d.isOff ? 0 : Math.max(0, required - d.workedHours);

    if (
      !d.isOff &&
      required > 0 &&
      config.deficitThresholdHours > 0 &&
      config.deficitPoints > 0 &&
      shortfall > 0
    ) {
      deficitAccum += shortfall;
      while (deficitAccum >= config.deficitThresholdHours) {
        deficitTriggers++;
        pointsDeducted = round2(pointsDeducted + config.deficitPoints);
        deficitAccum -= config.deficitThresholdHours;
      }
    }

    if (
      config.overtimeThresholdHours > 0 &&
      config.overtimePoints > 0 &&
      d.afterOfficeHours > 0
    ) {
      overtimeAccum += d.afterOfficeHours;
      while (overtimeAccum >= config.overtimeThresholdHours) {
        overtimeTriggers++;
        pointsAdded = round2(pointsAdded + config.overtimePoints);
        overtimeAccum -= config.overtimeThresholdHours;
      }
    }

    evals.push({
      date: d.date,
      workedHours: round2(d.workedHours),
      requiredHours: round2(required),
      shortfallHours: round2(shortfall),
      afterOfficeHours: round2(d.afterOfficeHours),
      isOff: d.isOff,
    });
  }

  return {
    paused: false,
    deficitAccumHours: round4(deficitAccum),
    overtimeAccumHours: round4(overtimeAccum),
    deficitTriggers,
    overtimeTriggers,
    pointsDeducted: round2(pointsDeducted),
    pointsAdded: round2(pointsAdded),
    netPoints: round2(pointsAdded - pointsDeducted),
    days: evals,
  };
}

/* ── Today's live target ──────────────────────────────────────────────────── */

/** The live "Today's Work" figures — the target, and how far off it you are. */
export interface TodayTarget {
  date: string;
  isOff: boolean;
  loginMinute: number | null;
  closeMinute: number;
  /** Your window today, in hours (login → close, minus breaks). */
  windowHours: number;
  /** Percentage of the window used, when a percentage target is set. */
  percent: number;
  usesPercent: boolean;
  targetHours: number;
  workedHours: number;
  remainingHours: number;
  met: boolean;
}

export function computeTodayTarget(
  window: {
    date: string;
    isOff: boolean;
    loginMinute: number | null;
    closeMinute: number;
    windowHours: number;
    workedHours: number;
  },
  config: TimerSopConfig,
): TodayTarget {
  const usesPercent = config.dailyMinPercent > 0;
  const targetHours = window.isOff
    ? 0
    : usesPercent
      ? (config.dailyMinPercent / 100) * window.windowHours
      : config.dailyMinHours;
  const remainingHours = Math.max(0, targetHours - window.workedHours);
  return {
    date: window.date,
    isOff: window.isOff,
    loginMinute: window.loginMinute,
    closeMinute: window.closeMinute,
    windowHours: round2(window.windowHours),
    percent: config.dailyMinPercent,
    usesPercent,
    targetHours: round2(targetHours),
    workedHours: round2(window.workedHours),
    remainingHours: round2(remainingHours),
    met: !window.isOff && window.workedHours >= targetHours,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
