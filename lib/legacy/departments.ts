import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";

/**
 * Departments and designations, from HR.
 *
 * ## This module needs a different token from the rest of the adapter
 *
 * Everything under `/cowork/*` authenticates with a **Firebase ID token**
 * (`verifyCoworkToken`). Everything under `/api/hr/*` authenticates with a
 * **self-issued JWT** (`Middlewear/EmployeeAuthMiddlewear`), read from the
 * cookie `auth_token` or an `Authorization: Bearer` header, and signed with
 * `JWT_SECRET`.
 *
 * They are separate systems over separate identity stores. A Firebase token
 * presented to an HR route is rejected, and vice versa. So every function here
 * takes an `hrToken`, named differently from the `token` used elsewhere,
 * because passing the wrong one produces a 401 that looks like a session
 * problem rather than a wiring mistake.
 *
 * ⚠ `EmployeeAuthMiddlewear` falls back to a **hard-coded signing secret** when
 * `JWT_SECRET` is unset: `process.env.JWT_SECRET || "grav_clothing_secret_key"`.
 * If the deployment does not set it, HR tokens can be forged by anybody who has
 * read the repository. Worth checking before this module is pointed at
 * production; it is not something the adapter can fix from this side.
 *
 * ## Why departments are not modelled locally
 *
 * `Employee` carries both `department` (a string) and `departmentId` (an
 * ObjectId reference), and the two are free to disagree. The Firestore
 * `cowork_employees` mirror carries only the string. Since the directory and
 * the department master are reached through different databases, **the string
 * is what joins them** — so that is what this module matches on, and no
 * reconciliation is attempted here. Choosing a winner is a data decision, not
 * an adapter decision.
 */

/** `/api/hr/departments`. */
export interface LegacyDepartmentDoc {
  _id?: string;
  id?: string;
  name?: string;
  status?: "active" | "inactive";
  designations?: LegacyDesignationDoc[];
}

export interface LegacyDesignationDoc {
  name?: string;
  isActive?: boolean;
  managers?: unknown[];
}

export interface LegacyDepartment {
  id: string;
  name: string;
  isActive: boolean;
  designations: LegacyDesignation[];
}

export interface LegacyDesignation {
  name: string;
  isActive: boolean;
  /**
   * How many managers the department master lists for this designation.
   *
   * The count only. The nested manager records duplicate department and
   * designation names on every entry and are not the reporting hierarchy —
   * that lives on `Employee.primaryManager` and is served by
   * `employees.fetchHierarchy`. Surfacing them here would offer a second,
   * conflicting answer to "who manages whom".
   */
  managerCount: number;
}

export function readDepartment(
  doc: LegacyDepartmentDoc,
): LegacyDepartment | null {
  const id = doc._id ?? doc.id;
  if (!id || !doc.name) return null;

  return {
    id: String(id),
    name: doc.name.trim(),
    /* `status` is an enum with a default of "active", so an absent value means
       active rather than unknown. */
    isActive: doc.status !== "inactive",
    designations: (doc.designations ?? [])
      .filter((d) => d.name)
      .map((d) => ({
        name: d.name!.trim(),
        isActive: d.isActive !== false,
        managerCount: Array.isArray(d.managers) ? d.managers.length : 0,
      })),
  };
}

export function readDepartments(
  docs: readonly LegacyDepartmentDoc[],
): LegacyDepartment[] {
  return docs
    .map(readDepartment)
    .filter((d): d is LegacyDepartment => d !== null);
}

/** `GET /api/hr/departments`. */
export async function listDepartments(
  hrToken: string,
): Promise<LegacyResult<LegacyDepartment[]>> {
  const r = await legacyFetch<LegacyDepartmentDoc[]>({
    path: "/api/hr/departments",
    envelopeKey: "departments",
    token: hrToken,
  });
  return r.ok ? { ok: true, data: readDepartments(r.data) } : r;
}

/**
 * `GET /api/hr/departments/with-designations`.
 *
 * Active departments only, with their designation lists — what a picker needs.
 * The engine already filters to `status: "active"`, so this is not the full
 * master and must not be used to decide whether a department exists.
 */
export async function listDepartmentsWithDesignations(
  hrToken: string,
): Promise<LegacyResult<LegacyDepartment[]>> {
  const r = await legacyFetch<LegacyDepartmentDoc[]>({
    path: "/api/hr/departments/with-designations",
    envelopeKey: "data",
    token: hrToken,
  });
  return r.ok ? { ok: true, data: readDepartments(r.data) } : r;
}

/** `GET /api/hr/departments/:id`. */
export async function getDepartment(input: {
  hrToken: string;
  id: string;
}): Promise<LegacyResult<LegacyDepartment>> {
  const r = await legacyFetch<LegacyDepartmentDoc>({
    path: `/api/hr/departments/${encodeURIComponent(input.id)}`,
    envelopeKey: "department",
    token: input.hrToken,
  });
  if (!r.ok) return r;

  const dept = readDepartment(r.data);
  return dept
    ? { ok: true, data: dept }
    : {
        ok: false,
        error: {
          message: "That department record is incomplete.",
          status: 0,
          kind: "malformed",
        },
      };
}

/**
 * Every designation across every department, deduplicated.
 *
 * Needed because **an employee's designation determines their scoring band**
 * (`BandConfig.getBandMaxForEmployee`), and the band determines their maximum
 * score. A designation that exists on an employee but in no department is
 * therefore a person whose score ceiling comes from the global defaults without
 * anybody having decided that — worth being able to detect.
 */
export function allDesignations(
  departments: readonly LegacyDepartment[],
): string[] {
  const names = new Set<string>();
  for (const dept of departments) {
    for (const designation of dept.designations) {
      if (designation.isActive) names.add(designation.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Departments named on employees that the master does not list.
 *
 * Reporting, never repair. The two stores are joined by a free string, so drift
 * is expected; silently creating the missing department would write to the HR
 * master on the strength of a typo.
 */
export function unknownDepartments(input: {
  departments: readonly LegacyDepartment[];
  employeeDepartments: readonly (string | null)[];
}): string[] {
  const known = new Set(
    input.departments.map((d) => d.name.toLowerCase()),
  );
  const missing = new Set<string>();
  for (const name of input.employeeDepartments) {
    const trimmed = name?.trim();
    if (trimmed && !known.has(trimmed.toLowerCase())) missing.add(trimmed);
  }
  return [...missing].sort((a, b) => a.localeCompare(b));
}
