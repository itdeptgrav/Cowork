import assert from "node:assert/strict";
import { test } from "node:test";
import { closureOf, unattachedEmployees } from "./hierarchy.ts";
import type { Employee, ReportingRelationship } from "../domain/index.ts";

/**
 * The reporting tree is the single source of truth for team visibility,
 * monitoring, manager dashboards and assignment scope. These tests assert the
 * shape the onboarding work exists to guarantee:
 *
 *     Maya (founder, root)
 *       ├── Rakesh
 *       │     └── Soumya
 *       └── Tobias
 *
 * They are written against the org from the reported bug rather than abstract
 * ids, because the failure being guarded is concrete: an employee who could
 * sign in perfectly well and was reachable by nobody.
 */

function rel(
  employeeId: string,
  managerId: string,
  over: Partial<ReportingRelationship> = {},
): ReportingRelationship {
  return {
    organisationId: "org-test",
    id: `rel-${employeeId}-${managerId}`,
    employeeId,
    managerId,
    type: "primary",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    createdBy: "maya",
    createdAt: "2026-01-01",
    ...over,
  };
}

function emp(id: string, over: Partial<Employee> = {}): Employee {
  return {
    organisationId: "org-test",
    id,
    isFounder: false,
    userId: `u-${id}`,
    employeeCode: id,
    firstName: id,
    lastName: "X",
    displayName: id,
    initials: "XX",
    hue: 0,
    profilePictureUrl: null,
    email: null,
    departmentId: null,
    departmentName: null,
    designation: null,
    roleIds: [],
    timezone: "UTC",
    workCalendarId: "cal-standard",
    joinedAt: "2026-01-01",
    exitedAt: null,
    ...over,
  };
}

const TREE = [rel("rakesh", "maya"), rel("tobias", "maya"), rel("soumya", "rakesh")];

/* ── Monitoring behaviour after the fix ───────────────────────────────────── */

test("Maya sees her whole line, transitively", () => {
  const seen = closureOf(TREE, "maya");
  assert.deepEqual(seen.sort(), ["rakesh", "soumya", "tobias"]);
});

test("Rakesh sees his own reports and nothing above him", () => {
  const seen = closureOf(TREE, "rakesh");
  assert.deepEqual(seen, ["soumya"]);
  assert.ok(!seen.includes("maya"), "monitoring must never look upwards");
  assert.ok(!seen.includes("tobias"), "a sibling's line is not Rakesh's");
});

test("Soumya monitors nobody", () => {
  assert.deepEqual(closureOf(TREE, "soumya"), []);
});

test("nobody is inside their own closure", () => {
  /* The closure answers "whose work am I answerable for". Including yourself
     would make every employee their own manager for monitoring. */
  for (const id of ["maya", "rakesh", "soumya"]) {
    assert.ok(!closureOf(TREE, id).includes(id), `${id} contains themselves`);
  }
});

/* ── What does and does not confer visibility ─────────────────────────────── */

test("a closed reporting line stops conferring visibility", () => {
  /* Changing a manager closes the old row rather than deleting it, so last
     quarter's score stays attributable. Reading a closed row as current would
     leave a former manager watching somebody who left their team. */
  const moved = [rel("soumya", "rakesh", { effectiveTo: "2026-06-01" })];
  assert.deepEqual(closureOf(moved, "rakesh"), []);
});

test("dotted and secondary lines confer no visibility", () => {
  /* Collaboration, not authority. The closure previously ignored `type`, so a
     dotted line granted the same reach as a real reporting line. */
  for (const type of ["dotted", "secondary"] as const) {
    const soft = [rel("soumya", "rakesh", { type })];
    assert.deepEqual(
      closureOf(soft, "rakesh"),
      [],
      `${type} must not grant monitoring`,
    );
  }
});

test("a reporting loop terminates instead of hanging", () => {
  const cycle = [rel("a", "b"), rel("b", "a")];
  assert.deepEqual(closureOf(cycle, "a").sort(), ["a", "b"]);
});

/* ── Unattached employees ─────────────────────────────────────────────────── */

const PEOPLE = [
  emp("maya", { isFounder: true }),
  emp("rakesh"),
  emp("soumya"),
];

test("a fully placed organisation reports no gaps", () => {
  assert.deepEqual(unattachedEmployees(PEOPLE, TREE), []);
});

test("somebody with no manager is reported as unplaced", () => {
  /* The reported bug: Soumya could sign in and was in nobody's line. */
  const gaps = unattachedEmployees(PEOPLE, [rel("rakesh", "maya")]);
  assert.deepEqual(
    gaps.map((e) => e.id),
    ["soumya"],
  );
});

test("the founder is never reported as a gap", () => {
  /* The top of the organisation has no manager and never will. Listing them
     would train an administrator to ignore the list. */
  const gaps = unattachedEmployees(PEOPLE, []);
  assert.ok(!gaps.some((e) => e.isFounder));
  assert.deepEqual(
    gaps.map((e) => e.id),
    ["rakesh", "soumya"],
  );
});

test("a non-founder with no manager IS a gap, however senior", () => {
  /* Seniority is roles; placement is the tree. An admin who is not the founder
     still has to be placed, or nobody above them can see their line. */
  const gaps = unattachedEmployees([emp("rakesh")], []);
  assert.deepEqual(
    gaps.map((e) => e.id),
    ["rakesh"],
  );
});

test("a departed employee is not a gap to fix", () => {
  const gaps = unattachedEmployees([emp("gone", { exitedAt: "2026-05-01" })], []);
  assert.deepEqual(gaps, []);
});

test("a closed line puts the person back in the unplaced list", () => {
  /* Removing somebody's manager without choosing a new one is exactly the
     state this list exists to surface. */
  const gaps = unattachedEmployees(
    [emp("soumya")],
    [rel("soumya", "rakesh", { effectiveTo: "2026-06-01" })],
  );
  assert.deepEqual(
    gaps.map((e) => e.id),
    ["soumya"],
  );
});
