import type { ScoreUnit } from "@/lib/domain";

/**
 * The C1 and C2 breakdown responses, as `ScoreUnit`s.
 *
 * **Written against live payloads captured at `/legacy/validate`**, not against
 * route files. Everything below quotes what the engine actually sent on
 * 2026-07-29:
 *
 * ```
 * C1  { success, employeeId, quarter, year, c1Net, c1Max,
 *       qualityRate, qualityPct, taskCount, rating{label,color,bgColor,class}, tasks }
 * C2  { success, employeeId, c2Net, c2Max, ptsEarned, ptsPastDeadline,
 *       hitRate, hitRatePct, taskCount, rating, tasks }
 * cfg { success, c1MaxPoints, c1BaseScore, c1DeadlineDeduction,
 *       c1ExtensionDeduction, c1ReworkDeduction, c1RejectScore }
 * ```
 *
 * ## Two things the real payloads settled
 *
 * **`c1Net` and `c2Net` arrive as `null`, not `0`.** Null means *not scored*;
 * zero means *scored, and earned nothing*. They are different facts about
 * somebody's quarter and this mapping keeps them apart — a null earns `null`,
 * never a confident zero on a performance screen.
 *
 * **C2 carries no `quarter` or `year`.** C1 does. So a C2 unit's period comes
 * from the caller's request rather than the response, and is empty when the
 * caller did not say — inventing "the current quarter" here could label a score
 * with a period the engine did not put it in.
 *
 * ## What this does not do
 *
 * **No arithmetic.** `pmpService` owns every formula and cites a specification
 * in neither repository. `c1Net`, `c2Net`, `c1Max`, `c2Max`, `ptsEarned` and
 * the rest are passed through exactly as sent. Nothing here derives a total,
 * a percentage or a deduction.
 */

/* ── C1 ───────────────────────────────────────────────────────────────────── */

export interface LegacyC1Response {
  success?: boolean;
  employeeId?: string;
  quarter?: number;
  year?: number;
  /** Null when the quarter has not been scored. Never coerce to 0. */
  c1Net?: number | null;
  c1Max?: number | null;
  qualityRate?: number | null;
  qualityPct?: number | null;
  taskCount?: number;
  rating?: { label?: string; color?: string; class?: string } | null;
  tasks?: {
    taskId?: string;
    title?: string;
    taskScore?: number | null;
    deadlinesMissed?: number;
    extensionsFiled?: number;
    reworksReceived?: number;
    c1Status?: string;
    isRejected?: boolean;
  }[];
}

/**
 * The C1 component, one unit per scored task.
 *
 * **This used to return a single synthetic row** — `"Task execution — 2
 * task(s)"` carrying `c1Net` over `c1Max` — and discard the `tasks` array
 * entirely. That is the reason an approved task never appeared in the
 * breakdown: the data arrived on every request and was thrown away, so the only
 * thing on the page was a channel total with nothing behind it to explain it.
 *
 * The old note justified that by saying splitting a total across tasks would
 * mean apportioning it, which is arithmetic that must not happen on this side.
 * The principle is right and it does not apply: **the engine sends
 * `taskScore` per task already**. Listing them is reading what it computed, not
 * dividing anything up. No figure below is derived.
 *
 * The channel totals stay where they belong — `getScoreOverview` reports
 * `c1Net`/`c1Max` for the header — so the summary and the breakdown come from
 * one response and cannot disagree.
 */
export function toC1Units(body: LegacyC1Response): ScoreUnit[] {
  const employeeId = body.employeeId ?? "";
  if (!employeeId) return [];

  const periodKey =
    body.year && body.quarter ? `${body.year}-Q${body.quarter}` : "";

  const tasks = body.tasks ?? [];

  return tasks.map((t, index) => ({
    id: `c1-${employeeId}-${t.taskId ?? index}`,
    employeeId,
    component: "c1" as never,
    sourceType: "task" as never,
    sourceId: t.taskId ?? "",
    /* The task's own title. The synthetic row had no subject at all, so a
       reader could not tell which work produced which number. */
    sourceLabel: t.title?.trim() || (t.taskId ?? "Untitled task"),
    periodKey,
    /* **No per-task maximum is sent, and one is not invented.** `c1Max` is the
       CHANNEL's ceiling, not this task's share of it — using it here would put
       a denominator against every row that the engine never stated. Zero means
       unknown to the renderer, which then shows the points alone. */
    maximumPoints: 0,
    /* The engine's own per-task figure, passed through. Null stays null: a task
       the engine has not scored is not a task that scored zero. */
    earnedPoints: (t.taskScore ?? null) as never,
    /* A rejected task is excluded from the quality rate by the engine, and
       saying so is the difference between "scored badly" and "not counted". */
    isExcluded: t.isRejected === true,
    exclusionReason: t.isRejected === true ? "Rejected — not counted" : null,
    finalisedAt: null,
    effectiveDate: "",
    /* **The counters ride along.** They are what turns a number into a reason —
       "0 deadlines missed" is a field, "completed before the deadline" is an
       explanation, and the score page exists to give the second. Carried on the
       unit rather than refetched so the figure and its explanation come from
       one response and cannot disagree. */
    deadlinesMissed: Number(t.deadlinesMissed) || 0,
    extensionsFiled: Number(t.extensionsFiled) || 0,
    reworksReceived: Number(t.reworksReceived) || 0,
    isRejected: t.isRejected === true,
    c1Status: t.c1Status ?? "",
  }));
}

/* ── C2 ───────────────────────────────────────────────────────────────────── */

export interface LegacyC2Response {
  success?: boolean;
  employeeId?: string;
  c2Net?: number | null;
  c2Max?: number | null;
  ptsEarned?: number;
  ptsPastDeadline?: number;
  hitRate?: number | null;
  hitRatePct?: number | null;
  taskCount?: number;
  rating?: { label?: string } | null;
  tasks?: unknown[];
}

/**
 * The C2 component as a single unit.
 *
 * `periodKey` comes from the caller because the response has none — see the
 * note at the top of this file.
 */
export function toC2Units(
  body: LegacyC2Response,
  periodKey = "",
): ScoreUnit[] {
  const employeeId = body.employeeId ?? "";
  if (!employeeId) return [];

  return [
    {
      id: `c2-${employeeId}-${periodKey || "current"}`,
      employeeId,
      component: "c2" as never,
      sourceType: "goal_activity" as never,
      sourceId: "",
      sourceLabel: `Goal attainment — ${body.ptsEarned ?? 0} point(s) earned, ${body.ptsPastDeadline ?? 0} past deadline`,
      periodKey,
      maximumPoints: body.c2Max ?? 0,
      earnedPoints: (body.c2Net ?? null) as never,
      isExcluded: false,
      exclusionReason: null,
      finalisedAt: null,
      effectiveDate: "",
    },
  ];
}

/* ── Configuration ────────────────────────────────────────────────────────── */

export interface LegacyC1Config {
  maxPoints: number;
  baseScore: number;
  deadlineDeduction: number;
  extensionDeduction: number;
  reworkDeduction: number;
  rejectScore: number;
}

/**
 * The organisation-wide C1 constants, as the engine reports them.
 *
 * Worth reading rather than assuming: the live values differ from the defaults
 * in `models/BandConfig.js`. The model defaults extension to `0.1` and reject to
 * `0.3`; the running engine returns `c1ExtensionDeduction: 0.3` and
 * `c1RejectScore: 0.4`. Anything written from the model would have been wrong.
 */
export function toC1Config(raw: Record<string, unknown>): LegacyC1Config {
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  return {
    maxPoints: num(raw.c1MaxPoints),
    baseScore: num(raw.c1BaseScore),
    deadlineDeduction: num(raw.c1DeadlineDeduction),
    extensionDeduction: num(raw.c1ExtensionDeduction),
    reworkDeduction: num(raw.c1ReworkDeduction),
    rejectScore: num(raw.c1RejectScore),
  };
}
