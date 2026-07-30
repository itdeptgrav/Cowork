import type { Employee, EmployeeId, ReportingRelationship } from "@/lib/domain";

/**
 * The reporting tree, and the two questions everything asks it.
 *
 * Team visibility, monitoring, manager dashboards and assignment scope all
 * resolve through the closure below. It lived as a private method on the
 * repository, which made the product's most load-bearing permission rule the
 * one thing no test could reach. It is here so it can be asserted directly —
 * the repository delegates rather than keeping a second copy.
 *
 * **Only ACTIVE PRIMARY lines count.** A relationship is time-bounded on
 * purpose: a score computed last quarter must stay visible to whoever managed
 * that person then, so changing a manager closes the old row rather than
 * overwriting it. Reading a closed row as current would hand a former manager
 * live access to somebody who no longer reports to them. `secondary` and
 * `dotted` lines are collaboration, not authority, and confer no visibility.
 */

/** An active primary line. Anything else is history or a dotted relationship. */
function isLive(r: ReportingRelationship): boolean {
  return !r.effectiveTo && r.type === "primary";
}

/**
 * Everyone beneath this person, transitively. Excludes the person themselves.
 *
 * Self-exclusion is deliberate and load-bearing: the closure answers "whose
 * work am I responsible for", and including yourself would make every employee
 * their own manager for the purposes of monitoring.
 */
export function closureOf(
  reporting: ReportingRelationship[],
  managerId: EmployeeId,
  maxDepth = 10,
): EmployeeId[] {
  const out = new Set<EmployeeId>();
  const walk = (id: EmployeeId, depth: number) => {
    /* Cycle guard. Legacy had none, and a loop breaks the closure walk, the
       approval chain and score visibility at the same time. */
    if (depth > maxDepth) return;
    for (const r of reporting) {
      if (r.managerId !== id || !isLive(r)) continue;
      if (out.has(r.employeeId)) continue;
      out.add(r.employeeId);
      walk(r.employeeId, depth + 1);
    }
  };
  walk(managerId, 0);
  return [...out];
}

/**
 * Whether anybody is above this person.
 *
 * The question priority asks: your rank is set by your manager, so somebody
 * with no manager has nobody to set it and keeps it themselves. Reads the same
 * active-primary rule as `closureOf`, so "Rakesh is in Maya's closure" and
 * "Rakesh has a manager" can never disagree.
 */
export function hasManager(
  reporting: ReportingRelationship[],
  employeeId: EmployeeId,
): boolean {
  return reporting.some((r) => r.employeeId === employeeId && isLive(r));
}

/**
 * Employees the tree does not place.
 *
 * No active primary manager, still employed, and not the organisation's
 * founder. Derived on every read so the tree stays the single source of truth
 * and this cannot drift from it.
 *
 * The founder exclusion is what makes the list actionable: the top of an
 * organisation has no manager and never will, so reporting them as a gap would
 * train an administrator to ignore the one list that exists to be acted on.
 */
export function unattachedEmployees(
  employees: Employee[],
  reporting: ReportingRelationship[],
): Employee[] {
  const placed = new Set(
    reporting.filter(isLive).map((r) => r.employeeId),
  );
  return employees.filter(
    (e) => !e.exitedAt && !e.isFounder && !placed.has(e.id),
  );
}
