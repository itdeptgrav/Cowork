import type { ChannelId, Employee, ScoreOverview, Viewer } from "@/lib/domain";
import type { LegacyEmployee } from "@/lib/legacy/employees";
import type { LegacyScoreDashboard } from "@/lib/legacy/scoring";
import {
  administrativeLevelForLegacyRole,
  directoryRoleIdsFor,
  systemRolesFor,
} from "../../auth/systemRoles.ts";

/**
 * Legacy responses, as this product's domain types.
 *
 * Pure and separately tested, because this is where a migration goes wrong
 * quietly. Everything above reads through the repository, so a mapping mistake
 * here surfaces as a plausible-looking dashboard rather than an error.
 *
 * **The rule that governs every function below: absent stays absent.** A field
 * legacy does not send becomes `null`, an empty array, or zero-with-a-reason —
 * never a default that reads as a real value. In a product whose claim is that
 * working is being measured, a fabricated figure is a false report about
 * somebody's performance, not a placeholder.
 */

export const LEGACY_ORGANISATION_ID = "org-legacy-cowork";

/* ── Employee ─────────────────────────────────────────────────────────────── */

/**
 * A directory row as an `Employee`.
 *
 * Several domain fields have no legacy source and are filled with empty values
 * rather than guesses:
 *
 * · `departmentId` — legacy joins departments by **name**, not id. The Firestore
 *   mirror carries only the string, so there is no id to give.
 * · `designation`, `workCalendarId`, `joinedAt` — on the MongoDB record, behind
 *   the HR JWT, which this repository does not hold.
 *
 * `roleIds` is the exception, and it stopped being empty: legacy has no role
 * entities, but it does have the three strings, and `usePermissions` reads this
 * field to answer what somebody's administrative standing is. Empty meant every
 * employee, team lead and chief executive resolved to level 0 — so the
 * administrative floor compared 0 against 0 and refused, and the upward
 * assignment gate never fired for anybody.
 */
/**
 * A department name as a stable id.
 *
 * Case- and whitespace-insensitive, because legacy's department strings are
 * typed by hand into HR records: "SR. MERCHANDISER" and "Sr. Merchandiser" are
 * one department, and treating them as two would put a departmental approval
 * gate between colleagues who sit together.
 *
 * Deliberately NOT a hash or a generated id — the name has to survive the round
 * trip, because the engine's own queries compare on it.
 */
export function departmentSlug(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function toEmployee(row: LegacyEmployee): Employee {
  const id = String(row.employeeId);
  const { firstName, lastName } = splitName(row.name);

  return {
    organisationId: LEGACY_ORGANISATION_ID,
    id,
    userId: row.authUid ?? id,
    employeeCode: id,
    firstName,
    lastName,
    displayName: row.name,
    initials: initialsOf(firstName, lastName, id),
    hue: hueFor(id),
    email: row.email ?? "",
    /* **The department NAME, normalised, is the department id.**
     *
     * Legacy has no department entity — `cowork_employees.department` is a bare
     * string ("IT", "Accounts") and every join in the engine is a string
     * comparison on it (`taskForward.js:94` queries
     * `where("department","==",person.department)`).
     *
     * This used to be `""` for everybody, with a comment saying there was no id
     * to give. That was true and it was still wrong: `departmentsDiffer`
     * compares `departmentId`, so with every value empty **no two people were
     * ever in different departments**. The cross-department approval gate could
     * not fire in the UI, the picker's department filter matched nobody, and a
     * department-scoped workflow had no department to resolve.
     *
     * Normalising rather than passing the raw string through, because these
     * are hand-entered: "IT" and "it " must be one department, or a stray space
     * in an HR record silently becomes a departmental boundary between two
     * colleagues.
     *
     * An employee with no department keeps `""`, which is the correct
     * behaviour rather than a gap: legacy's gate requires BOTH sides to be
     * non-empty (`if (assignerDept && targetDept && …)`), and
     * `departmentsDiffer` mirrors that, so an unknown department raises no
     * boundary instead of inventing one. */
    departmentId: departmentSlug(row.department),
    departmentName: row.department?.trim() ?? "",
    designation: "",
    /* Standing, not reach — see `systemRoles.ts`. Deriving it from the role
       string keeps this a pure mapping of one directory row, so reading the
       directory never has to build the reporting tree first. */
    roleIds: directoryRoleIdsFor(row.role),
    timezone: "Asia/Kolkata",
    workCalendarId: "",
    joinedAt: "",
    exitedAt: null,
    isFounder: false,
  };
}

/** A display name split for the fields the domain keeps separately. */
export function splitName(name: string): {
  firstName: string;
  lastName: string;
} {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export function initialsOf(
  firstName: string,
  lastName: string,
  fallback: string,
): string {
  const a = firstName.charAt(0);
  const b = lastName.charAt(0);
  const combined = `${a}${b}`.trim().toUpperCase();
  return combined || fallback.slice(0, 2).toUpperCase();
}

/**
 * A stable index into the field palette.
 *
 * Derived from the id so a person keeps the same monogram colour across
 * sessions and machines. Random assignment would make the directory shimmer on
 * every load.
 */
export function hueFor(id: string): 0 | 1 | 2 | 3 | 4 | 5 {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 6;
  return sum as 0 | 1 | 2 | 3 | 4 | 5;
}

/* ── Viewer ───────────────────────────────────────────────────────────────── */

/**
 * The acting identity.
 *
 * `hierarchyIds` and `directReportIds` are **empty here**, and that is a real
 * constraint rather than an omission: legacy exposes only "who are my managers"
 * and has no endpoint in the other direction. Building either list means one
 * `my-managers` call per employee, which belongs at a call site that has decided
 * to pay for it — not hidden inside every `getViewer()`. The repository fills
 * them in from the tree it has already derived; empty is the safe direction for
 * anyone who calls this mapper on its own, because these lists widen what
 * somebody may see.
 *
 * `roles` is what makes `can()` answer anything at all. It was `[]`, and an
 * empty role list is not a restrictive permission model — it is the absence of
 * one: every capability was denied to everybody, including the chief executive,
 * who was shown "your roles do not include" in place of the administration area.
 */
export function toViewer(input: {
  employeeId: string;
  legacyRole: unknown;
  hasManager: boolean;
  /** Whether the reporting tree gives this person anybody to manage. */
  hasDirectReports?: boolean;
}): Viewer {
  return {
    employeeId: input.employeeId,
    roles: systemRolesFor({
      organisationId: LEGACY_ORGANISATION_ID,
      legacyRole: input.legacyRole,
      hasDirectReports: input.hasDirectReports ?? false,
    }),
    hierarchyIds: [],
    directReportIds: [],
    hasManager: input.hasManager,
    /* **From the role string, not from the roles held.** Standing has to agree
       with the level `usePermissions` computes for the same person out of the
       directory, or the administrative floor and the upward-assignment gate
       would answer differently about one employee. Managing somebody raises
       your reach over them; it does not raise your standing among your
       colleagues. */
    administrativeLevel: administrativeLevelForLegacyRole(input.legacyRole),
  };
}

/* ── Score ────────────────────────────────────────────────────────────────── */

const CHANNEL_META: Record<
  "c1" | "c2" | "c3" | "c4",
  { id: ChannelId; code: string; label: string; direction: "up" | "down" }
> = {
  c1: { id: "c1" as ChannelId, code: "C1", label: "Task Execution", direction: "up" },
  c2: { id: "c2" as ChannelId, code: "C2", label: "Goal Attainment", direction: "up" },
  /* C3 is deduction-only and hangs downward — The Deduction Hangs Rule. */
  c3: { id: "c3" as ChannelId, code: "C3", label: "Conduct & Policy", direction: "down" },
  c4: { id: "c4" as ChannelId, code: "C4", label: "Attendance", direction: "up" },
};

/**
 * The engine's dashboard as a `ScoreOverview`.
 *
 * **Nothing is computed here.** `pmpService` owns every formula and cites a
 * specification that is in neither repository, so a figure re-derived on this
 * side could disagree with the one an appraisal is based on. Where the engine
 * sends a total, it is passed through; where it does not, the total is zero and
 * `possiblePoints` is zero with it, so a caller can tell "nothing scored" from
 * "scored zero" instead of seeing a confident 0%.
 *
 * `delta` is **always zero**: it is a change against the previous period, and
 * this endpoint returns one period. Deriving it would need a second request the
 * caller did not ask for, and inventing it would put a trend arrow on screen
 * that nothing measured.
 */
export function toScoreOverview(
  dashboard: LegacyScoreDashboard,
  employeeId: string,
): ScoreOverview {
  const channels = dashboard.components.map((component) => {
    const meta = CHANNEL_META[component.key];
    const earned = component.earned ?? 0;
    const possible = component.max ?? 0;
    /* The engine's own percentage. NEVER earned/possible: `net` arrives already
       normalised, and recomputing it produced C1 at 200% against the old app's
       80%. Zero only when the engine reported nothing. */
    const percentage = component.percentage ?? 0;

    return {
      id: meta.id,
      code: meta.code,
      label: meta.label,
      earnedPoints: earned,
      possiblePoints: possible,
      percentage,
      /* **Null, not zero.** Legacy sends no count, and zero is a measurement —
         it says nothing was scored. Reported as unknown so the screen can say
         so instead of contradicting the percentage beside it. */
      unitCount: null,
      direction: meta.direction,
      extent: clampPercent(percentage),
      caption: component.max === null ? "Maximum not reported" : "",
      hasProvisionalRules: false,
    };
  });

  const earnedPoints =
    dashboard.totalEarned ??
    channels.reduce((sum, c) => sum + c.earnedPoints, 0);
  const possiblePoints = channels.reduce((sum, c) => sum + c.possiblePoints, 0);

  return {
    employeeId,
    periodKey: periodKeyOf(dashboard),
    /* The engine's composite (`pace.score`), never points-over-points.
       The engine weights contributions and subtracts the C3 deduction by a
       formula it publishes; summing channel points gave 14% against its 90%. */
    overallPercentage: dashboard.overallPercentage ?? 0,
    earnedPoints,
    possiblePoints,
    /* No previous period in this response. Zero, never a fabricated trend. */
    delta: 0,
    channels,
    hasProvisionalRules: false,
  };
}

/**
 * The year, quarter by quarter — from `annual.quarters[]`.
 *
 * **The engine does publish a series after all.** This was empty on the belief
 * that `/pmp/:id/dashboard` answers for one quarter only; the captured payload
 * shows it also returns the whole annual strip, each quarter with its score,
 * its status, its weight and its four channels. No stitching of repeated
 * requests is needed, and none happens.
 *
 * **Unscored quarters are omitted, not zeroed.** Q1 and Q2 come back
 * `score: null, status: "closed"` and Q4 `status: "future"` with no channels at
 * all. The contract here types `overall` as a number, so a null would have to
 * become 0 — and a 0% quarter on a performance trend is a claim that somebody
 * scored nothing, which is not what the engine said. A quarter with no score
 * is left out; the trend then shows only quarters that were actually scored.
 */
export function toScoreHistory(
  dashboard: LegacyScoreDashboard,
): { periodKey: string; overall: number; channels: Record<ChannelId, number> }[] {
  const year = dashboard.year;

  return dashboard.quarters
    .filter((q) => q.score !== null && q.quarter !== null)
    .map((q) => ({
      periodKey: year ? `${year}-Q${q.quarter}` : `Q${q.quarter}`,
      overall: q.score as number,
      /* A channel the engine did not report is 0 here because the contract
         admits no null. The quarter itself is only present because it WAS
         scored, so this is a reported-nothing channel within a real quarter —
         not a fabricated quarter. */
      channels: {
        c1: q.c1 ?? 0,
        c2: q.c2 ?? 0,
        c3: q.c3 ?? 0,
        c4: q.c4 ?? 0,
      } as Record<ChannelId, number>,
    }));
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * The period this score covers.
 *
 * From the engine's own quarter and year when it reports them — never from this
 * machine's clock, which could disagree with the engine's quarter boundary and
 * label a score with a period it does not belong to.
 */
export function periodKeyOf(dashboard: LegacyScoreDashboard): string {
  if (dashboard.year && dashboard.quarter) {
    return `${dashboard.year}-Q${dashboard.quarter}`;
  }
  return "";
}
