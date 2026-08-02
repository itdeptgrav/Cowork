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
  /** login → close, before any break is taken off. */
  spanHours: number;
  /** Recurring office breaks inside that span. */
  breakHours: number;
  /** The daily personal break allowance, off the target as well. */
  allowanceHours: number;
  /** Your window today: span, less recurring breaks, less the allowance. */
  windowHours: number;
  /** Percentage of the window used, when a percentage target is set. */
  percent: number;
  usesPercent: boolean;
  targetHours: number;
  workedHours: number;
  remainingHours: number;
  met: boolean;
}

/**
 * How much of today's target has actually been worked, 0–100.
 *
 * The card carried `workedHours` from the first day it existed and never
 * rendered it, so the only evidence of tracked work on screen was the
 * remainder — and "17h 25m left" reads exactly the same whether a timer has
 * run for two hours or has never been started once. This is the figure the
 * progress bar shows.
 *
 * An off day has no target, so there is nothing to be a percentage OF. It
 * returns 0 and the card shows the worked total without a bar, because that
 * time is overtime rather than progress toward anything.
 */
/**
 * Today's figures with a currently-running timer folded in.
 *
 * A work commit is only written when a timer STOPS, so everything derived from
 * commits alone — the worked total, the remainder, whether the target is met —
 * ignores the run in progress. Somebody four minutes into a task saw `0m
 * tracked on task timers` and `15h 59m left`, both computed correctly from an
 * empty ledger and both wrong about their morning.
 *
 * Folded in HERE rather than in each place that reads a figure, so the worked
 * total, the bar and the banner cannot disagree about the same second. What
 * `liveSecs` may contain is `liveRunSecsForDay`'s decision, not this one.
 *
 * This changes what is DISPLAYED and nothing that is scored: the deficit
 * engine finalises a day only once it is over, by which time the run has
 * stopped and its seconds are committed like any other.
 */
export function withLiveRun(today: TodayTarget, liveSecs: number): TodayTarget {
  if (liveSecs <= 0) return today;
  const workedHours = today.workedHours + liveSecs / 3600;
  return {
    ...today,
    workedHours: round2(workedHours),
    remainingHours: round2(Math.max(0, today.targetHours - workedHours)),
    met: !today.isOff && workedHours >= today.targetHours,
  };
}

export function targetProgressPercent(today: TodayTarget): number {
  if (today.isOff || today.targetHours <= 0) return 0;
  const pct = (today.workedHours / today.targetHours) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function computeTodayTarget(
  window: {
    date: string;
    isOff: boolean;
    loginMinute: number | null;
    closeMinute: number;
    spanHours: number;
    breakHours: number;
    allowanceHours: number;
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
    spanHours: round2(window.spanHours),
    breakHours: round2(window.breakHours),
    allowanceHours: round2(window.allowanceHours),
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
