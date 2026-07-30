import assert from "node:assert/strict";
import { test } from "node:test";
import { can } from "./can.ts";
import {
  administrativeLevelForLegacyRole,
  directoryRoleIdsFor,
  systemRoleIdsFor,
  systemRoles,
  systemRolesFor,
} from "./systemRoles.ts";
import type { PermissionContext } from "./can.ts";
import type { Capability, EmployeeId } from "../domain/index.ts";

/**
 * The role table, locked.
 *
 * `can.test.ts` proves the ENGINE decides correctly from a role table; this
 * proves the table this product actually ships is the one the spec describes,
 * and that it is not empty. Those are different failures: the engine was
 * correct and fully tested the whole time the product denied everything to
 * everybody, because `listRoles()` returned `[]` and nothing asserted otherwise.
 */

const ORG = "org-test";

function ctxFor(
  legacyRole: string,
  opts: {
    hasDirectReports?: boolean;
    directReportIds?: EmployeeId[];
    levels?: Record<string, number>;
  } = {},
): PermissionContext {
  const roles = systemRolesFor({
    organisationId: ORG,
    legacyRole,
    hasDirectReports: opts.hasDirectReports ?? (opts.directReportIds?.length ?? 0) > 0,
  });
  return {
    viewer: {
      employeeId: "me",
      roles,
      /* Direct reports only, for everyone including the chief executive —
         `LegacyRepository.getViewer` narrows it that way deliberately. */
      hierarchyIds: opts.directReportIds ?? [],
      directReportIds: opts.directReportIds ?? [],
      hasManager: true,
      administrativeLevel: administrativeLevelForLegacyRole(legacyRole),
    },
    roles: systemRoles(ORG),
    directReportIds: opts.directReportIds ?? [],
    hierarchyIds: opts.directReportIds ?? [],
    levelOf: (id) =>
      id === "me"
        ? administrativeLevelForLegacyRole(legacyRole)
        : (opts.levels?.[id] ?? 10),
  };
}

/* ── The table exists ─────────────────────────────────────────────────────── */

test("every system role grants at least one capability", () => {
  /* A role with no permissions is indistinguishable from not holding it, and
     would present as a screen that is dark for no stated reason. */
  for (const r of systemRoles(ORG)) {
    assert.ok(r.permissions.length > 0, `${r.id} grants nothing`);
    assert.equal(r.organisationId, ORG, `${r.id} is untenanted`);
    assert.ok(r.isSystem, `${r.id} is editable, but there is no store to save it to`);
  }
});

test("the table is per-tenant and never shared by reference", () => {
  /* Two tenants mutating one array of permissions would be one organisation
     silently rewriting another's. */
  const a = systemRoles("org-a");
  const b = systemRoles("org-b");
  assert.notEqual(a[0], b[0]);
  assert.notEqual(a[0].permissions, b[0].permissions);
  assert.equal(b[0].organisationId, "org-b");
});

test("administrative levels are strictly ordered, employee lowest", () => {
  /* Only the order carries meaning. Two roles at one level would make the
     floor's `theirs >= mine` refuse between equals in both directions. */
  const levels = systemRoles(ORG).map((r) => r.administrativeLevel);
  assert.deepEqual(levels, [...levels].sort((x, y) => x - y));
  assert.equal(new Set(levels).size, levels.length, "levels collide");
  assert.equal(Math.min(...levels), levels[0]);
});

/* ── Who holds what ───────────────────────────────────────────────────────── */

test("holding a role is earned from the tree, or from the title", () => {
  assert.deepEqual(
    systemRoleIdsFor({ legacyRole: "employee", hasDirectReports: false }),
    ["role-employee"],
  );
  assert.deepEqual(
    systemRoleIdsFor({ legacyRole: "employee", hasDirectReports: true }),
    ["role-employee", "role-manager"],
    "a report makes you a manager whatever HR calls you",
  );
  assert.deepEqual(
    systemRoleIdsFor({ legacyRole: "tl", hasDirectReports: false }),
    ["role-employee", "role-manager"],
    "a lead between assignments keeps their surfaces",
  );
  assert.deepEqual(
    systemRoleIdsFor({ legacyRole: "ceo", hasDirectReports: true }),
    ["role-employee", "role-manager", "role-admin"],
  );
});

test("an unrecognised role maps down, never up", () => {
  /* Matches the engine: anything that is not "ceo" or "tl" fails both checks
     (`coworkAuth.js:78-80`). Guessing upward grants access the engine refuses. */
  for (const odd of ["superadmin", "TL", "", null, undefined, 7]) {
    assert.deepEqual(
      systemRoleIdsFor({ legacyRole: odd, hasDirectReports: false }),
      ["role-employee"],
      `${String(odd)} was promoted`,
    );
    assert.equal(administrativeLevelForLegacyRole(odd), 10);
  }
});

test("the directory's roleIds never depend on the tree", () => {
  /* `#reportingTree()` is built FROM the directory, so a directory row that
     needed the tree would be a cycle — and reading the directory would start
     paying for N `my-managers` calls it does not need. */
  assert.deepEqual(directoryRoleIdsFor("employee"), ["role-employee"]);
  assert.deepEqual(directoryRoleIdsFor("tl"), ["role-employee", "role-manager"]);
});

test("the roles resolved are the same records listRoles returns", () => {
  /* `can()` intersects the viewer's roles with the table by id. Two tables
     would silently grant nothing at all. */
  const held = systemRolesFor({ organisationId: ORG, legacyRole: "ceo", hasDirectReports: false });
  const table = systemRoles(ORG);
  for (const r of held) {
    assert.ok(table.some((t) => t.id === r.id), `${r.id} is not in the table`);
  }
});

/* ── What the table actually decides ──────────────────────────────────────── */

test("an administrator may open the administration area", () => {
  /* The exact disjunction `AdminCapabilityGuard` tests. It resolved false for
     everybody, including the chief executive, who got "your roles do not
     include" in place of every admin screen. */
  const ceo = ctxFor("ceo");
  const may = (c: Capability) => can(ceo, c).allowed;
  assert.ok(
    may("people.change_role") ||
      may("people.change_reporting") ||
      may("integration.configure") ||
      may("score.configure"),
  );
});

test("an ordinary employee may not open the administration area", () => {
  const staff = ctxFor("employee");
  for (const c of [
    "people.change_role",
    "people.change_reporting",
    "integration.configure",
    "score.configure",
  ] as Capability[]) {
    assert.equal(can(staff, c).allowed, false, c);
  }
});

test("a manager sees their own reports' work and nobody else's", () => {
  const mgr = ctxFor("employee", { directReportIds: ["r1", "r2"] });
  assert.ok(can(mgr, "task.view", "r1").allowed);
  assert.ok(can(mgr, "task.view", "me").allowed);
  assert.equal(can(mgr, "task.view", "stranger").allowed, false);
  /* The refusal has to say why. "Denied" against a colleague's name is the
     kind of message that sends somebody to argue with a correct system. */
  assert.match(can(mgr, "task.view", "stranger").message, /outside it/);
});

test("an individual contributor sees only their own work", () => {
  const staff = ctxFor("employee");
  assert.ok(can(staff, "task.view", "me").allowed);
  assert.equal(can(staff, "task.view", "someone").allowed, false);
});

test("anyone may be offered as an assignee — consent, not permission", () => {
  /* The one place the table deliberately departs from §4.3, because a later
     owner decision overrides it: the approval gates in `assignment.ts` hold
     the work rather than the picker refusing to list the person. Narrowing
     this produced "You can only create task for yourself" against a picker
     that had just offered them. */
  const staff = ctxFor("employee");
  assert.ok(can(staff, "task.create", "anybody").allowed);
  assert.ok(can(ctxFor("tl"), "task.create", "anybody").allowed);
});

test("the spec's tightenings are in force", () => {
  /* §4.4 records these three as legacy defects — the engine has no check at
     all on any of them. Following the spec means the control is absent here
     for somebody whose write the engine would still accept. */
  const staff = ctxFor("employee");
  assert.equal(can(staff, "review.decide", "someone").allowed, false, "P1");
  assert.equal(
    can(staff, "task.priority.change", "someone").allowed,
    false,
    "P6 — own tasks only",
  );
  assert.equal(can(staff, "deadline.decide", "someone").allowed, false);
});

test("no manager may reset a password, and no lower level may act upward", () => {
  /* Legacy let any team lead reset the chief executive's password and revoke
     their sessions (`cowork.js:379`). Two separate barriers here: managers
     hold no such capability at all, and the floor would stop them anyway. */
  const mgr = ctxFor("tl", { directReportIds: ["r1"] });
  assert.equal(can(mgr, "people.reset_password", "r1").allowed, false);
  assert.equal(can(mgr, "people.reset_password", "r1").reason, "no_capability");

  const ceoLevel = administrativeLevelForLegacyRole("ceo");
  const peopleOps: PermissionContext = {
    ...ctxFor("employee"),
    viewer: {
      ...ctxFor("employee").viewer,
      roles: systemRoles(ORG).filter((r) => r.id === "role-people-ops"),
    },
    levelOf: (id) => (id === "boss" ? ceoLevel : id === "me" ? 60 : 10),
  };
  assert.ok(can(peopleOps, "people.reset_password", "someone").allowed);
  assert.equal(
    can(peopleOps, "people.reset_password", "boss").reason,
    "administrative_floor",
    "People Operations holds organisation scope, and still cannot reach upward",
  );
});

test("an administrator cannot act on themselves through the floor", () => {
  /* The floor exempts the viewer's own id, so an administrator can still act
     on their own account — which for the top level is the only account they
     can act on that is not below them. */
  const ceo = ctxFor("ceo", { levels: { other: 10 } });
  assert.ok(can(ceo, "people.change_role", "me").allowed);
  assert.ok(can(ceo, "people.change_role", "other").allowed);
});
