import type { ChannelBreakdown, ScoreOverview } from "@/lib/domain";

/**
 * How a score is PRESENTED. No arithmetic that decides a score lives here.
 *
 * `lib/rules/scoring/engine.ts` owns the formulas and this file must never
 * duplicate one — the whole point is that a screen and an appraisal cannot
 * disagree. What this decides is narrower and entirely about reading: which
 * figures are safe to show together, which are unknown rather than zero, and
 * what each number means in a sentence an employee can act on.
 *
 * ---
 *
 * **Three presentation faults this exists to fix.**
 *
 * 1. **"0 units measured" beside a real percentage.** The legacy engine sends no
 *    unit count, and the adapter wrote `0` for it. Zero is a measurement — it
 *    says nothing was scored — so the overview asserted two things that cannot
 *    both be true. The count is now `null` where it is unknown, and unknown is
 *    said rather than counted.
 *
 * 2. **"90 / 40" read as a fraction.** It is not one. The adapter is explicit
 *    that the channel percentage is the engine's own pre-normalised figure and
 *    is *never* `earned / possible` — recomputing it once produced C1 at 200%
 *    against the old app's 80%. Rendering the two beside a percentage invites a
 *    division that gives a different, wrong answer. So they are only shown
 *    together when they actually reconcile.
 *
 * 3. **A percentage with nothing behind it.** A channel the engine has not
 *    scored arrives as zeros, which renders as a confident 0% — indistinguishable
 *    from genuinely scoring nothing.
 */

/** How far `earned/possible` may sit from the reported percentage and still be shown. */
const RECONCILE_TOLERANCE = 1;

export type ChannelState =
  /** The engine scored this channel and the figures agree. */
  | "measured"
  /** Scored, but the point totals do not explain the percentage — show the percentage alone. */
  | "measured_points_unavailable"
  /** Nothing has been scored in this channel this period. */
  | "no_data";

export interface ChannelPresentation {
  state: ChannelState;
  /** The score to lead with, or null when there is nothing to report. */
  percentage: number | null;
  /** Shown only when `pointsReconcile`. */
  earnedPoints: number | null;
  possiblePoints: number | null;
  /** Null when the provider does not report a count — NOT zero. */
  measuredCount: number | null;
  /** One sentence an employee can act on. Never mentions a field name. */
  explanation: string;
}

/**
 * Do the point totals actually produce the reported percentage?
 *
 * The guard against presenting "90 of 40 points" beside "90%". A reader who
 * divides gets 225%, and being unable to reconcile what is on screen is worse
 * than being shown less.
 */
export function pointsReconcile(channel: {
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
}): boolean {
  if (!(channel.possiblePoints > 0)) return false;
  const derived = (channel.earnedPoints / channel.possiblePoints) * 100;
  return Math.abs(derived - channel.percentage) <= RECONCILE_TOLERANCE;
}

/**
 * What each channel contributes, in the employee's own terms.
 *
 * No implementation detail: nobody outside the team knows what C1 is, so the
 * sentence names the behaviour that moves it.
 */
const EXPLANATION: Record<string, string> = {
  C1: "Moves when your tasks are approved. Missed deadlines, rework and rejections reduce it.",
  C2: "Moves when the goals set for you are completed on time.",
  C3: "Only ever reduces your score, and only when a conduct or policy breach is recorded.",
  C4: "Moves with your attendance — being present, on time, and for the full day.",
};

/**
 * Channels whose DETAIL lives in a system this app cannot reach.
 *
 * C3 and C4 have no breakdown endpoint on the engine, and attendance records
 * sit behind the HR token this repository does not hold. The channel's own
 * figure still arrives on the dashboard and is shown; what is absent is the
 * itemisation beneath it. Saying which is the difference between a page that
 * looks broken and one that has told you where the rest of the answer is.
 */
export const DETAIL_ELSEWHERE: Record<string, string> = {
  C4: "Attendance detail — late arrivals, absences and leave — is held in the HR system and is not available here.",
};

/** The explanation for a channel, or a neutral one for a code we do not know. */
export function explanationFor(code: string): string {
  return (
    EXPLANATION[code] ??
    "Contributes to your overall score for this period."
  );
}

/**
 * One channel, ready to render.
 *
 * The caller passes the count separately because it lives on the breakdown as
 * `unitCount` and this keeps the rule free of that name.
 */
export function presentChannel(
  channel: ChannelBreakdown,
): ChannelPresentation {
  const measuredCount = channel.unitCount;
  const scored =
    channel.possiblePoints > 0 ||
    channel.earnedPoints !== 0 ||
    channel.percentage !== 0 ||
    (measuredCount ?? 0) > 0;

  if (!scored) {
    return {
      state: "no_data",
      percentage: null,
      earnedPoints: null,
      possiblePoints: null,
      measuredCount,
      explanation: explanationFor(channel.code),
    };
  }

  const reconciles = pointsReconcile(channel);
  return {
    state: reconciles ? "measured" : "measured_points_unavailable",
    percentage: channel.percentage,
    earnedPoints: reconciles ? channel.earnedPoints : null,
    possiblePoints: reconciles ? channel.possiblePoints : null,
    measuredCount,
    explanation: explanationFor(channel.code),
  };
}

/**
 * How many items were measured across every channel, or null.
 *
 * Null when **no** channel reports a count — summing nulls as zeros would put
 * "0 measured" under a real overall score, which is the original fault at the
 * overview level.
 */
export function totalMeasured(overview: ScoreOverview): number | null {
  const counts = overview.channels
    .map((c) => c.unitCount)
    .filter((n): n is number => typeof n === "number");
  if (counts.length === 0) return null;
  return counts.reduce((sum, n) => sum + n, 0);
}

export interface OverviewPresentation {
  /** Null when nothing has been scored — never a confident 0%. */
  percentage: number | null;
  measuredCount: number | null;
  /** Channels the engine has scored. */
  contributing: ChannelBreakdown[];
  /** Channels with nothing in them yet, named so the absence is explained. */
  awaiting: ChannelBreakdown[];
  /** True when there is genuinely nothing to show. */
  isEmpty: boolean;
  periodLabel: string;
}

/**
 * `2026-Q3` → `July–September 2026`.
 *
 * Employees do not think in period keys. Falls back to the key itself when it
 * is not the shape we know, rather than showing a wrong quarter.
 */
export function periodLabel(periodKey: string): string {
  const m = /^(\d{4})-?Q([1-4])$/.exec(periodKey.trim());
  if (!m) return periodKey;
  const [year, q] = [m[1], Number(m[2])];
  const spans = [
    "January–March",
    "April–June",
    "July–September",
    "October–December",
  ];
  return `${spans[q - 1]} ${year}`;
}

export function presentOverview(overview: ScoreOverview): OverviewPresentation {
  const contributing = overview.channels.filter((c) => hasDataOn(c));
  const awaiting = overview.channels.filter((c) => !hasDataOn(c));
  const isEmpty = contributing.length === 0;

  return {
    /* Null rather than 0 when nothing is scored. A confident zero on somebody's
       performance page is a claim, and the wrong one. */
    percentage: isEmpty ? null : overview.overallPercentage,
    measuredCount: totalMeasured(overview),
    contributing,
    awaiting,
    isEmpty,
    periodLabel: periodLabel(overview.periodKey),
  };
}

/** The same predicate `presentChannel` uses, without building the whole shape. */
export function hasDataOn(channel: ChannelBreakdown): boolean {
  return (
    channel.possiblePoints > 0 ||
    channel.earnedPoints !== 0 ||
    channel.percentage !== 0 ||
    (channel.unitCount ?? 0) > 0
  );
}

/* ── The ledger ───────────────────────────────────────────────────────────── */

/**
 * What each ledger event is called, in the employee's own terms.
 *
 * The raw `eventType` was rendered with its underscores swapped for spaces —
 * `task_completed` became "task completed", which is readable and still not an
 * explanation. Each entry now says what happened and, through `reason`, why.
 *
 * `rule 3` and a rule id are deliberately NOT presented: an employee cannot act
 * on a rule version, and it is the sort of internal detail that makes a
 * performance page read as a debug log.
 */
const EVENT_LABEL: Record<string, string> = {
  task_completed: "Task approved",
  rework_applied: "Rework requested",
  deadline_missed: "Deadline missed",
  extension_charged: "Extension charged",
  extension_waived: "Extension waived",
  rejection_applied: "Submission rejected",
  goal_activity_completed: "Goal activity completed",
  goal_activity_late: "Goal activity late",
  conduct_breach: "Conduct or policy breach",
  attendance_present: "Attendance recorded",
  late_arrival: "Late arrival",
  early_departure: "Early departure",
  absence: "Absence",
  manual_adjustment: "Manual adjustment",
  reversal: "Entry reversed",
};

export function eventLabel(eventType: string): string {
  return (
    EVENT_LABEL[eventType] ??
    eventType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

export interface LedgerPresentation {
  title: string;
  /** Signed, so a credit and a deduction are never confused. */
  signedPoints: number;
  direction: "credit" | "deduction" | "neutral";
  /** Why it happened, when the entry carries a reason worth showing. */
  reason: string | null;
  /** What it happened to — a task, a goal, a day. */
  subject: string | null;
  /** Who did it, when that is a person rather than the engine. */
  actor: string | null;
}

/**
 * One ledger entry, ready to read.
 *
 * `credit` and `deduction` are separate non-negative fields on the record. A
 * single signed number is what a reader needs, and deriving it here is the only
 * place that decision is made — the previous render inferred the sign from
 * `credit > 0`, which prints "−0" for an entry that is genuinely neither.
 */
export function presentLedgerEntry(entry: {
  eventType: string;
  credit: number;
  deduction: number;
  reason: string;
  sourceLabel: string;
  actorId: string;
  actorLabel: string;
}): LedgerPresentation {
  /* `|| 0` normalises negative zero. `-entry.deduction` with a deduction of 0
     yields `-0`, which formats as "−0" — the exact minus-zero this function
     exists to stop, reintroduced one line lower down. */
  const signedPoints =
    entry.credit > 0 ? entry.credit : -entry.deduction || 0;
  return {
    title: eventLabel(entry.eventType),
    signedPoints,
    direction:
      signedPoints > 0 ? "credit" : signedPoints < 0 ? "deduction" : "neutral",
    reason: entry.reason.trim() ? entry.reason.trim() : null,
    subject: entry.sourceLabel.trim() ? entry.sourceLabel.trim() : null,
    /* The engine acting on its own is not a person to name. Saying "system"
       adds nothing a reader can use. */
    actor:
      entry.actorId === "system" || !entry.actorLabel.trim()
        ? null
        : entry.actorLabel.trim(),
  };
}

/* ── Trend ────────────────────────────────────────────────────────────────── */

export interface Trend {
  /** Percentage points, signed. Null when there is no prior period to compare. */
  change: number | null;
  previousLabel: string | null;
  direction: "up" | "down" | "flat" | "unknown";
}

/**
 * The change against the previous scored period.
 *
 * **Not `ScoreOverview.delta`** — that field is documented as always zero,
 * because the dashboard answers for one period and deriving a change would
 * need a second request. It does not: the same response carries the annual
 * strip, every quarter with its own score, and comparing two figures the engine
 * reported is reading rather than inventing.
 *
 * Null when there is nothing to compare against, which is the first quarter
 * somebody is measured in. A trend arrow there would be a claim about a period
 * that does not exist.
 */
export function trendFrom(
  history: { periodKey: string; overall: number }[],
  currentPeriodKey: string,
): Trend {
  const index = history.findIndex((h) => h.periodKey === currentPeriodKey);
  /* The current period must be found AND have something before it. A missing
     current period means the strip and the overview disagree about which
     period this is, and guessing which is right would put a wrong arrow on
     somebody's record. */
  if (index <= 0) {
    return { change: null, previousLabel: null, direction: "unknown" };
  }
  const previous = history[index - 1];
  const change = history[index].overall - previous.overall;
  return {
    change,
    previousLabel: periodLabel(previous.periodKey),
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}
