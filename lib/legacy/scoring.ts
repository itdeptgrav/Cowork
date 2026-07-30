import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";

/**
 * Scores, read from the legacy engine.
 *
 * **Nothing here computes a score.** `services/pmpService.js` and
 * `services/c1Service.js` own every formula, and they cite an authoritative
 * spec — `CW-DEV-PMP-01 v1.0` (June 2026) — which is **in neither repository**.
 * Reimplementing a formula whose specification we do not have would produce
 * numbers that look right and disagree with the engine's, which is the worst
 * possible failure for a score somebody's appraisal depends on.
 *
 * So: fetch, map, display. If a figure is not in the response, it is not shown.
 *
 * ## Sources
 *
 * | Component | Computed by | From |
 * |---|---|---|
 * | C1 · Task Execution | `c1Service.js` | `cowork_tasks`, commits, timer events |
 * | C2 · Goal Attainment | `c2Band.routes.js` | Goal tasks, gold tasks |
 * | C3 · Conduct & Policy | SOP ledger | `Employee.sopPoints[]` |
 * | C4 · Attendance | `Policy` / `C4Config` | Attendance + overtime |
 * | Aggregate | `pmpService.getDashboardData` | All of the above + `BandConfig` |
 *
 * The owner-confirmed model, for reading the numbers rather than producing
 * them: every unit maxes at 1.0; rework deducts 0.2;
 * `clamp(max − deductions + credits, 0, max)`; the aggregate is
 * **points-over-points, never an average of percentages**.
 */

export type ComponentKey = "c1" | "c2" | "c3" | "c4";

/** The four components' display names, exactly as the product labels them. */
export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  c1: "C1 · Task Execution",
  c2: "C2 · Goal Attainment",
  c3: "C3 · Conduct & Policy",
  c4: "C4 · Attendance",
};

/**
 * `GET /cowork/pmp/:employeeId/dashboard?quarter&year`.
 *
 * Typed loosely on purpose. The engine's response is assembled across several
 * `pmpService` functions (`computeQuarterScore`, `computeAnnualScores`,
 * `computePaceScore`, `computeGapToNextRating`, `computeFlags`) and its exact
 * shape is not declared anywhere. Narrow types here would break silently when a
 * field is absent for one employee and present for another.
 */
export interface LegacyDashboardDoc {
  employeeId?: string;
  quarter?: number;
  year?: number;
  totalEarned?: number;
  rawQuarterScore?: number;
  c1?: unknown;
  c2?: unknown;
  c3?: unknown;
  c4?: unknown;
  pace?: unknown;
  rating?: string;
  flags?: unknown;
  [key: string]: unknown;
}

export interface LegacyScoreComponent {
  key: ComponentKey;
  label: string;
  /** The engine's own percentage. Already normalised — never recompute it. */
  percentage: number | null;
  /** Points earned, as the engine reports them. Null when it reported none. */
  earned: number | null;
  /** The ceiling — from the employee's band, or the global default. */
  max: number | null;
}

/**
 * One quarter of the annual strip, as `annual.quarters[]` sends it.
 *
 * **Not uniform.** A future quarter carries only `quarter`, `status` and
 * `weight` — no `score`, no channels at all. Reading `q.c4` on Q4 is a
 * `TypeError` waiting for December, so every field here is optional and every
 * absent one stays null rather than becoming zero.
 */
export interface LegacyQuarterScore {
  quarter: number | null;
  /** Null for a quarter the engine has not scored. Never coerce to 0. */
  score: number | null;
  /** Present only on the live quarter. */
  projectedScore: number | null;
  /** `closed` · `live` · `future`, in the engine's own words. */
  status: string | null;
  /** The quarter's share of the annual score. Q1 0.1 → Q4 0.4. */
  weight: number | null;
  c1: number | null;
  c2: number | null;
  c3: number | null;
  c4: number | null;
}

export interface LegacyScoreDashboard {
  employeeId: string | null;
  quarter: number | null;
  year: number | null;
  /** Days elapsed in the quarter — the engine's count, not this clock's. */
  dayInQuarter: number | null;
  /** The engine's aggregate. Never recomputed from the components. */
  totalEarned: number | null;
  rawQuarterScore: number | null;
  /**
   * `annual.live` — the year-to-date figure, weighted across scored quarters.
   *
   * The engine's own number. It is NOT the quarter score and NOT an average of
   * the quarters: on the captured payload a 92.5 quarter yields 46.25 annual,
   * because the engine divides the weighted contribution by the weight of the
   * quarters that have run. Recomputing that here would be re-deriving a
   * formula from one observation.
   */
  annualLive: number | null;
  /** `annual.projected` — the engine's year-end projection. */
  annualProjected: number | null;
  /** `annual.rating.label` — the band the annual score falls in. */
  annualRating: string | null;
  /** `annual.quarters[]` — the year, quarter by quarter. */
  quarters: LegacyQuarterScore[];
  /** `gap.gap` — points to the next rating band. */
  gapToNext: number | null;
  /** `gap.nextRating` — the band that gap would reach. */
  nextRating: string | null;
  /**
   * The engine's composite quarter score, as a percentage.
   *
   * `d.pace.score` — what the old PMP page displays as the overall figure. It is
   * NOT points-over-points: the engine composes it from weighted contributions
   * (`pace.breakdown`) minus the C3 deduction (`pace.c3Net`), by a formula it
   * publishes in `pace.formula`. Recomputing it from channel points produced 14%
   * where the engine says 90%.
   */
  overallPercentage: number | null;
  /** The engine's own words for how it composed the score. */
  formula: string | null;
  rating: string | null;
  components: LegacyScoreComponent[];
  /**
   * Everything the engine returned that this mapper did not name.
   *
   * Kept rather than discarded: the response shape is undeclared and varies, and
   * a field we do not yet render is better preserved than silently dropped —
   * it is the difference between "we have not built that" and "the data is
   * gone".
   */
  raw: LegacyDashboardDoc;
}

/**
 * A number from a value that may be a number, a numeric string, or an object
 * carrying one.
 *
 * `pmpService` returns components sometimes as a bare number and sometimes as
 * `{ earned, max }` or `{ score }`. Reading only one form renders a real score
 * as blank.
 */
export function readScoreValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const key of ["earned", "score", "total", "points", "net", "value"]) {
      const n = readScoreValue(v[key]);
      if (n !== null) return n;
    }
  }
  return null;
}

/** The declared maximum on a component object, when it carries one. */
export function readScoreMax(value: unknown): number | null {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const key of ["max", "maxPoints", "maximum", "outOf"]) {
      const n = readScoreValue(v[key]);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * The dashboard, mapped for display.
 *
 * `c3` and `c4Net` are read from their own top-level fields because that is
 * where `pmpService` puts them — `c4Net` is already net of credits, so it must
 * not be adjusted again here.
 */
export function readDashboard(
  doc: LegacyDashboardDoc,
): LegacyScoreDashboard {
  const components: LegacyScoreComponent[] = (
    ["c1", "c2", "c3", "c4"] as const
  ).map((key) => {
    const channel = readChannel(doc[key]);
    return {
      key,
      label: COMPONENT_LABELS[key],
      /* `net` IS the percentage. Confirmed against the old PMP page, which
         renders it with a % suffix: `${fmt(d?.pace?.c3Net, 1)}%`. */
      percentage: channel.net,
      /* Points come from `sopPts`, a separate figure the engine also sends.
         Deriving points from a percentage and a maximum would be arithmetic
         this side of the engine. */
      earned: channel.sopPts,
      max: channel.max,
    };
  });

  const pace = asObject(doc.pace);
  const annual = asObject(doc.annual);
  const gap = asObject(doc.gap);

  return {
    employeeId: typeof doc.employeeId === "string" ? doc.employeeId : null,
    quarter: typeof doc.quarter === "number" ? doc.quarter : null,
    year: typeof doc.year === "number" ? doc.year : null,
    dayInQuarter: readScoreValue(doc.dayInQuarter),
    totalEarned: readScoreValue(doc.totalEarned),
    rawQuarterScore: readScoreValue(doc.rawQuarterScore),
    overallPercentage: readScoreValue(pace?.score),
    formula: typeof pace?.formula === "string" ? pace.formula : null,
    /* `pace.rating.label`, NOT `doc.rating`.
       The captured payload has no top-level `rating` key at all — this read
       `doc.rating` and so the band was null on every screen while the engine
       was sending "Strong". A key that never exists fails silently forever. */
    rating: readRatingLabel(pace?.rating),
    annualLive: readScoreValue(annual?.live),
    annualProjected: readScoreValue(annual?.projected),
    annualRating: readRatingLabel(annual?.rating),
    quarters: Array.isArray(annual?.quarters)
      ? annual.quarters.map(readQuarter)
      : [],
    gapToNext: readScoreValue(gap?.gap),
    nextRating: typeof gap?.nextRating === "string" ? gap.nextRating : null,
    components,
    raw: doc,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** A rating's display label. The engine sends `{label, color, bgColor, class}`. */
function readRatingLabel(value: unknown): string | null {
  if (typeof value === "string") return value;
  const r = asObject(value);
  return typeof r?.label === "string" ? r.label : null;
}

/**
 * One entry of `annual.quarters[]`.
 *
 * Absent is null, never zero — a future quarter has earned no score, and
 * rendering it as 0% would put a failure on screen for a quarter that has not
 * started.
 */
function readQuarter(raw: unknown): LegacyQuarterScore {
  const q = asObject(raw);
  return {
    quarter: readScoreValue(q?.quarter),
    score: readScoreValue(q?.score),
    projectedScore: readScoreValue(q?.projectedScore),
    status: typeof q?.status === "string" ? q.status : null,
    weight: readScoreValue(q?.weight),
    c1: readScoreValue(q?.c1),
    c2: readScoreValue(q?.c2),
    c3: readScoreValue(q?.c3),
    c4: readScoreValue(q?.c4),
  };
}

/**
 * One channel of the dashboard.
 *
 * **The payload is NESTED**, which two bugs came from assuming otherwise:
 *
 * ```
 * { c1: { net, max, sopPts },
 *   c2: { net, max, sopPts },
 *   c3: { net, breachCount, sopPts },
 *   c4: { net, breachCount, sopPts }, ... }
 * ```
 *
 * The shape is read off `cowork-old-frontend/app/coworking/pmp/page.js:225-236`,
 * which is the source of truth for what this endpoint returns.
 *
 * Two things it corrected:
 *
 * · **C4 read as `doc.c4Net`, a key that does not exist** — so attendance
 *   scored 0 in the new UI while the old showed 100%.
 * · **`net` was treated as points and divided by `max`** — so C1 showed
 *   80/40 = 200% where the old showed 80%.
 *
 * `net` is null-safe but NOT defaulted to zero: the engine returns `null` for an
 * unscored quarter, and zero is a different claim.
 */
function readChannel(raw: unknown): {
  net: number | null;
  max: number | null;
  sopPts: number | null;
} {
  if (!raw || typeof raw !== "object") {
    return { net: null, max: null, sopPts: null };
  }
  const r = raw as Record<string, unknown>;
  return {
    net: readScoreValue(r.net),
    max: readScoreValue(r.max),
    sopPts: readScoreValue(r.sopPts),
  };
}

/**
 * `GET /cowork/pmp/:employeeId/dashboard`.
 *
 * Quarter and year default to the current period on the engine's side
 * (`getQuarterFromDate`, `getCurrentYear`), so omitting them is correct rather
 * than lazy — computing "the current quarter" here could disagree with the
 * engine's own boundary.
 *
 * A TL is scoped to their own department by the engine; a request outside it
 * returns a permission error rather than an empty score.
 */
export async function fetchDashboard(input: {
  token: string;
  employeeId: string;
  quarter?: number;
  year?: number;
}): Promise<LegacyResult<LegacyScoreDashboard>> {
  const r = await legacyFetch<LegacyDashboardDoc>({
    path: `/cowork/pmp/${encodeURIComponent(input.employeeId)}/dashboard`,
    query: { quarter: input.quarter, year: input.year },
    token: input.token,
  });
  return r.ok ? { ok: true, data: readDashboard(r.data) } : r;
}

/** `GET /cowork/pmp/:employeeId/c1` — the C1 breakdown. */
export async function fetchC1(input: {
  token: string;
  employeeId: string;
  quarter?: number;
  year?: number;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/pmp/${encodeURIComponent(input.employeeId)}/c1`,
    query: { quarter: input.quarter, year: input.year },
    token: input.token,
  });
}

/** `GET /cowork/pmp/:employeeId/c2`. */
export async function fetchC2(input: {
  token: string;
  employeeId: string;
  quarter?: number;
  year?: number;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/pmp/${encodeURIComponent(input.employeeId)}/c2`,
    query: { quarter: input.quarter, year: input.year },
    token: input.token,
  });
}

/** `GET /cowork/pmp/employees` — the people this viewer may see scores for. */
export async function fetchScorableEmployees(
  token: string,
): Promise<LegacyResult<unknown>> {
  return legacyFetch({ path: "/cowork/pmp/employees", token });
}

/** `GET /cowork/c1/config` — the deduction constants the engine is using. */
export async function fetchC1Config(
  token: string,
): Promise<LegacyResult<unknown>> {
  return legacyFetch({ path: "/cowork/c1/config", token });
}

/** `GET /cowork/workload/summary` — CEO or TL. */
export async function fetchWorkloadSummary(
  token: string,
): Promise<LegacyResult<unknown>> {
  return legacyFetch({ path: "/cowork/workload/summary", token });
}

/**
 * Percentage for display, or null.
 *
 * Presentation only, and it deliberately refuses to invent a denominator: with
 * no reported maximum there is no honest percentage, and defaulting to 100
 * would render every score as complete.
 *
 * This is **not** the aggregate. The engine aggregates points-over-points and
 * `totalEarned` already carries the result; averaging these percentages would
 * be the exact mistake the scoring model warns against.
 */
export function percentOf(component: LegacyScoreComponent): number | null {
  /* The engine's own figure, returned as sent.
     It used to be `earned / max * 100`, and that was the 200% bug: `net` is
     ALREADY a percentage, so dividing it by a point maximum is not a
     conversion but a category error. C1 read 80/40 = 200% where the old app
     showed 80%, and C3/C4 read null because their channels carry no `max`. */
  return component.percentage;
}

/**
 * Whether the dashboard carried enough to render.
 *
 * An engine response with no aggregate and no components is a real state —
 * a new employee, or a quarter with no activity — and it needs an empty state,
 * not an error and not a row of zeros. Zero is a score somebody earned; blank
 * is the absence of one, and they must not look the same.
 */
export function hasScoreData(dashboard: LegacyScoreDashboard): boolean {
  return (
    dashboard.totalEarned !== null ||
    dashboard.components.some((c) => c.percentage !== null || c.earned !== null)
  );
}
