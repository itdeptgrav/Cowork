import assert from "node:assert/strict";
import { test } from "node:test";
import { employees, roles, reporting, departments, workflows } from "./seed.ts";

/**
 * Referential integrity of the fixture.
 *
 * These exist because of a real bug: employee `e-08` held role id
 * `role-people_ops` while the role was defined as `role-people-ops`. A dangling
 * reference resolves to no role, so People Operations silently had ZERO
 * permissions — and nothing noticed for as long as nothing consulted
 * permissions. The moment enforcement was wired in, that person lost access to
 * screens they were supposed to administer.
 *
 * A typo in a fixture is not usually worth a test. A typo that silently removes
 * someone's entire permission set is.
 */

test("every role a person holds actually exists", () => {
  const ids = new Set(roles.map((r) => r.id));
  for (const e of employees) {
    for (const rid of e.roleIds) {
      assert.ok(
        ids.has(rid),
        `${e.displayName} holds "${rid}", which is not a defined role`,
      );
    }
  }
});

test("somebody can administer roles, or the system is unadministrable", () => {
  const admins = employees.filter((e) =>
    roles.some(
      (r) =>
        e.roleIds.includes(r.id) &&
        r.permissions.some((p) => p.capability === "people.change_role"),
    ),
  );
  assert.ok(admins.length > 0, "no seeded person can grant a role");
});

test("every reporting relationship points at real people", () => {
  const ids = new Set(employees.map((e) => e.id));
  for (const r of reporting) {
    assert.ok(ids.has(r.employeeId), `reporting from unknown ${r.employeeId}`);
    assert.ok(ids.has(r.managerId), `reporting to unknown ${r.managerId}`);
    assert.notEqual(r.employeeId, r.managerId, "nobody reports to themselves");
  }
});

test("the reporting graph is acyclic", () => {
  for (const start of employees) {
    const seen = new Set<string>([start.id]);
    let cur: string | null = start.id;
    for (let i = 0; i < 50; i++) {
      const rel = reporting.find(
        (r) => r.employeeId === cur && !r.effectiveTo && r.type === "primary",
      );
      if (!rel) break;
      assert.ok(
        !seen.has(rel.managerId),
        `reporting cycle through ${rel.managerId}`,
      );
      seen.add(rel.managerId);
      cur = rel.managerId;
    }
  }
});

test("every department head is a real employee", () => {
  const ids = new Set(employees.map((e) => e.id));
  for (const d of departments) {
    if (d.hodEmployeeId)
      assert.ok(ids.has(d.hodEmployeeId), `${d.name} has an unknown head`);
  }
});

test("every employee's department exists", () => {
  const ids = new Set(departments.map((d) => d.id));
  for (const e of employees) {
    if (e.departmentId)
      assert.ok(
        ids.has(e.departmentId),
        `${e.displayName} is in unknown department "${e.departmentId}"`,
      );
  }
});

test("an active workflow always has at least one stage", () => {
  for (const w of workflows) {
    if (w.isActive)
      assert.ok(
        w.stages.length > 0,
        `"${w.name}" is active with no stages — it would approve everything`,
      );
  }
});
