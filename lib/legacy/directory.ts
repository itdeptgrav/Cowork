import type { LegacyError } from "./envelope";
import {
  type LegacyEmployee,
  type LegacyHierarchy,
  fetchHierarchy,
  listEmployees,
  listMembers,
} from "./employees.ts";
import { isCeoOrTl } from "./permissions.ts";

/**
 * The employee directory, assembled from what legacy actually exposes.
 *
 * ## What the directory endpoint does and does not carry
 *
 * `GET /cowork/employee/list` returns Firestore `cowork_employees` documents.
 * `createCoworkEmployee` writes exactly: `employeeId`, `authUid`, `role`,
 * `profilePicUrl`, `fcmTokens`, `passwordChanged`, `createdAt`, plus `name`,
 * `email`, `mobile`, `city` and `department` from the request body.
 *
 * **It does not carry `designation`, a reporting manager, or an employment
 * status.** Those live on the MongoDB `Employee` record:
 *
 * | Field | Where | Reached by |
 * |---|---|---|
 * | designation | `Employee.designation` | HR API — **HR JWT** |
 * | employment status | `Employee.status` / `isActive` | HR API — **HR JWT** |
 * | reporting manager | `Employee.primaryManager` | `/cowork/employee/my-managers/:id` — one call **per employee** |
 *
 * So a directory row showing all six requested columns needs two tokens and
 * N+1 requests. Rather than invent the missing fields or quietly drop the
 * columns, this module models them as **explicitly unavailable**, and the screen
 * says which source would supply them.
 *
 * The one status the directory genuinely knows is `passwordChanged: false` —
 * somebody who has not completed first sign-in. That is a real, useful state and
 * it is not the same as "inactive".
 */

/** Where a value could not be obtained, and why. */
export type Unavailable = {
  available: false;
  /** What would supply it. Shown to the reader rather than a blank cell. */
  source: string;
};

export type Available<T> = { available: true; value: T };
export type Field<T> = Available<T> | Unavailable;

export function available<T>(value: T): Available<T> {
  return { available: true, value };
}

export const NEEDS_HR_TOKEN: Unavailable = {
  available: false,
  source: "HR records (needs the HR sign-in, not the Cowork one)",
};

export const NEEDS_PER_EMPLOYEE_CALL: Unavailable = {
  available: false,
  source: "HR records — loaded on the employee's own page",
};

/** One row of the directory. */
export interface DirectoryRow {
  employeeId: string;
  name: string;
  email: string | null;
  department: string | null;
  role: string;
  /**
   * Whether the person has completed first sign-in.
   *
   * The only lifecycle state the Cowork directory carries. Deliberately **not**
   * called "status": `Employee.status` and `isActive` are different fields in a
   * different database, and conflating them would report somebody as inactive
   * because they had not yet changed a temporary password.
   */
  pendingFirstSignIn: boolean;
  /** Not in `cowork_employees`. */
  designation: Field<string>;
  /** Not in `cowork_employees`. */
  reportingManager: Field<string>;
  /** Not in `cowork_employees`. */
  employmentStatus: Field<string>;
}

export function toRow(employee: LegacyEmployee): DirectoryRow {
  return {
    employeeId: String(employee.employeeId),
    name: employee.name,
    email: employee.email,
    department: employee.department,
    role: employee.role,
    pendingFirstSignIn: employee.pendingFirstSignIn,
    designation: NEEDS_HR_TOKEN,
    reportingManager: NEEDS_PER_EMPLOYEE_CALL,
    employmentStatus: NEEDS_HR_TOKEN,
  };
}

/**
 * The directory, from whichever endpoint this viewer is allowed to use.
 *
 * `/employee/list` is gated to CEO and TL; `/employee/list-members` is not.
 * Choosing by role rather than trying one and falling back on a 403 means an
 * ordinary employee's first view is a list rather than an error that resolves
 * itself a moment later.
 */
export async function fetchDirectory(input: {
  token: string;
  role: string;
}): Promise<{ rows: DirectoryRow[]; error: LegacyError | null }> {
  const result = isCeoOrTl(input.role)
    ? await listEmployees(input.token)
    : await listMembers(input.token);

  if (!result.ok) return { rows: [], error: result.error };
  return { rows: result.data.map(toRow), error: null };
}

/** Case-insensitive search across the fields a person would actually type. */
export function filterRows(
  rows: readonly DirectoryRow[],
  query: string,
): DirectoryRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) =>
    [r.name, r.employeeId, r.department, r.email, r.role].some((v) =>
      v?.toLowerCase().includes(q),
    ),
  );
}

/**
 * Departments present in the directory, with a count.
 *
 * Derived from the employee rows rather than from the department master,
 * because those are two different questions: the master says which departments
 * exist, this says which have people in them. A department in one and not the
 * other is the drift `departments.unknownDepartments()` reports.
 */
export function departmentCounts(
  rows: readonly DirectoryRow[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.department ?? "No department";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* ── Employee detail ──────────────────────────────────────────────────────── */

export interface EmployeeDetail {
  row: DirectoryRow;
  hierarchy: LegacyHierarchy | null;
  /** Why part of the detail is missing, when it is. */
  problem: string | null;
}

/**
 * One employee's page.
 *
 * The reporting manager is fetched here — one call, for one person — rather than
 * for every row of the list. Legacy offers no bulk equivalent, so a list that
 * showed managers would issue one request per employee; doing it on the detail
 * page keeps that cost where somebody asked for it.
 */
export async function fetchEmployeeDetail(input: {
  token: string;
  employee: LegacyEmployee;
}): Promise<EmployeeDetail> {
  const row = toRow(input.employee);
  const result = await fetchHierarchy({
    token: input.token,
    employeeId: String(input.employee.employeeId),
  });

  if (!result.ok) {
    return { row, hierarchy: null, problem: result.error.message };
  }

  const hierarchy = result.data;
  return {
    row: {
      ...row,
      reportingManager: hierarchy.primaryManager
        ? available(hierarchy.primaryManager.name)
        : row.reportingManager,
    },
    hierarchy,
    problem: hierarchy.inHrSystem
      ? null
      : "This person exists in Cowork but has no HR record, so they have no reporting line, department of record, attendance or SOP history.",
  };
}
