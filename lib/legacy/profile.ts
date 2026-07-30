import type { LegacyIdentity } from "./auth.ts";
import type { LegacyError } from "./envelope";
import {
  type LegacyEmployee,
  type LegacyHierarchy,
  getEmployee,
  fetchHierarchy,
} from "./employees.ts";
import { type LegacyGate, allows } from "./permissions.ts";

/**
 * The whole answer to "who am I, and what can I reach".
 *
 * Identity alone is not enough for a screen to decide anything: the role comes
 * from Firestore, the department comes from the same record, and the reporting
 * lines come from MongoDB through a second call. This composes the three into
 * one shape so a screen asks once.
 *
 * Pure assembly plus two fetches. **No access decision is invented here** —
 * `permissions.ts` mirrors the engine's own predicates and this only applies
 * them.
 */

export interface LegacyProfile {
  identity: LegacyIdentity;
  /** The directory row, when it could be read. Carries the department. */
  employee: LegacyEmployee | null;
  /** Reporting lines, when they could be read. */
  hierarchy: LegacyHierarchy | null;
  /**
   * Why part of the profile is missing, when it is.
   *
   * A profile with an identity but no HR record is **usable** — the person can
   * work, they simply have no managers or department of record. Reporting the
   * reason separately keeps a partial answer from being thrown away as a
   * failure, which is what a single `ok`/`error` result would force.
   */
  problems: LegacyProfileProblem[];
}

export interface LegacyProfileProblem {
  part: "directory" | "hierarchy";
  message: string;
  kind: LegacyError["kind"] | "absent";
}

/** The department of record, from the directory row. */
export function departmentOf(profile: LegacyProfile): string | null {
  return profile.employee?.department ?? null;
}

/**
 * Whether this person has an HR record at all.
 *
 * `false` means no managers, no department of record, no attendance and no SOP
 * ledger — the engine reports it as a success, so a screen that does not check
 * will render "no managers" for somebody whose HR record is simply missing.
 */
export function isInHrSystem(profile: LegacyProfile): boolean {
  return profile.hierarchy?.inHrSystem ?? false;
}

/** Whether the engine would allow this gate for this person. */
export function profileCan(
  profile: LegacyProfile | null,
  gate: LegacyGate,
): boolean {
  return profile ? allows(gate, profile.identity.role) : false;
}

/**
 * What this person can reach, as a list, for a diagnostics or profile screen.
 *
 * Named after the surfaces rather than the endpoints, because the question
 * somebody actually asks is "can I see the directory", not "am I CEO or TL".
 * Each entry names the gate so the answer can be checked against the route file.
 */
export interface AccessLine {
  label: string;
  gate: LegacyGate;
  allowed: boolean;
}

export function accessSummary(profile: LegacyProfile | null): AccessLine[] {
  const lines: { label: string; gate: LegacyGate }[] = [
    { label: "Sign in to Cowork", gate: "employee" },
    { label: "See the full employee directory", gate: "ceo_or_tl" },
    { label: "Create employees", gate: "ceo_or_tl" },
    { label: "Change an employee's role", gate: "ceo" },
    { label: "Create and edit SOP rules", gate: "ceo_or_tl" },
    { label: "Approve or reject SOP rules", gate: "ceo" },
    { label: "Apply an SOP to somebody", gate: "ceo_or_tl" },
    { label: "Review SOP disputes", gate: "ceo_or_tl" },
    { label: "See everybody's scores", gate: "ceo_or_tl" },
    { label: "See the workload summary", gate: "ceo_or_tl" },
    { label: "Edit score bands", gate: "ceo" },
    { label: "Create groups and meetings", gate: "ceo_or_tl" },
  ];
  return lines.map((line) => ({
    ...line,
    allowed: profileCan(profile, line.gate),
  }));
}

/**
 * Fetch the profile for a signed-in identity.
 *
 * The two calls run **concurrently** and neither can fail the whole result. A
 * directory read refused for an ordinary employee — `/employee/:id` is not
 * gated, but the engine can still refuse — must not cost them their reporting
 * lines, and vice versa.
 */
export async function fetchProfile(input: {
  token: string;
  identity: LegacyIdentity;
}): Promise<LegacyProfile> {
  const id = String(input.identity.employeeId);

  const [employeeResult, hierarchyResult] = await Promise.all([
    getEmployee({ token: input.token, employeeId: id }),
    fetchHierarchy({ token: input.token, employeeId: id }),
  ]);

  const problems: LegacyProfileProblem[] = [];

  if (!employeeResult.ok) {
    problems.push({
      part: "directory",
      message: employeeResult.error.message,
      kind: employeeResult.error.kind,
    });
  }
  if (!hierarchyResult.ok) {
    problems.push({
      part: "hierarchy",
      message: hierarchyResult.error.message,
      kind: hierarchyResult.error.kind,
    });
  }

  const hierarchy = hierarchyResult.ok ? hierarchyResult.data : null;
  if (hierarchy && !hierarchy.inHrSystem) {
    problems.push({
      part: "hierarchy",
      message:
        "This person exists in Cowork but has no HR record, so they have no reporting line, department of record, attendance or SOP ledger.",
      kind: "absent",
    });
  }

  return {
    identity: input.identity,
    employee: employeeResult.ok ? employeeResult.data : null,
    hierarchy,
    problems,
  };
}
