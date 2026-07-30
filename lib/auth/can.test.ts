import assert from "node:assert/strict";
import { test } from "node:test";
import { can, reachableIds, scopeFor } from "./can.ts";
import {
  assignmentRefusal,
  assignmentRelationship,
  upwardApprovers,
} from "./assignment.ts";
import type { PermissionContext } from "./can.ts";
import type { Capability, Role, Scope } from "../domain/index.ts";
import {
  employees as seedEmployees,
  roles as seedRoles,
  reporting as seedReporting,
} from "../seed/seed.ts";

/**
 * The permission rules, locked.
 *
 * These encode the two things the audit found missing and the one thing legacy
 * got dangerously wrong: that scope actually narrows a capability, that the
 * administrative floor stops a lower level acting on a higher one, and that
 * neither can be reached by holding more roles.
 */

function role(id: string, level: number, perms: [Capability, Scope][]): Role {
  return {
    organisationId: "org-test",
    id,
    key: id,
    displayName: id,
    archetype: "employee",
    administrativeLevel: level,
    isSystem: false,
    permissions: perms.map(([capability, scope], i) => ({
      id: `${id}-${i}`,
      capability,
      scope,
    })),
  };
}

const EMPLOYEE = role("employee", 10, [
  ["task.view", "self"],
  ["score.view", "self"],
]);
const MANAGER = role("manager", 30, [
  ["task.view", "direct_reports"],
  ["score.view", "direct_reports"],
  ["people.change_reporting", "direct_reports"],
]);
const PEOPLE_OPS = role("people_ops", 60, [
  ["people.reset_password", "organisation"],
  ["score.view", "organisation"],
]);
const ADMIN = role("admin", 100, [["people.change_role", "organisation"]]);

const LEVELS: Record<string, number> = {
  emp: 10,
  peer: 10,
  report: 10,
  mgr: 30,
  ops: 60,
  owner: 100,
};

function ctx(holding: Role[], me: string): PermissionContext {
  return {
    viewer: {
      employeeId: me,
      roles: holding,
      hierarchyIds: me === "mgr" ? ["report", "deep"] : [],
      directReportIds: me === "mgr" ? ["report"] : [],
      hasManager: false,
      administrativeLevel: Math.max(
        ...holding.map((r) => r.administrativeLevel),
      ),
    },
    roles: [EMPLOYEE, MANAGER, PEOPLE_OPS, ADMIN],
    directReportIds: me === "mgr" ? ["report"] : [],
    hierarchyIds: me === "mgr" ? ["report", "deep"] : [],
    levelOf: (id) => LEVELS[id] ?? 10,
  };
}

test("a capability nobody granted is denied, with the reason", () => {
  const d = can(ctx([EMPLOYEE], "emp"), "people.delete", "peer");
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "no_capability");
  assert.match(d.message, /does not include/i);
});

test("self scope reaches only the viewer", () => {
  const c = ctx([EMPLOYEE], "emp");
  assert.equal(can(c, "score.view", "emp").allowed, true);
  assert.equal(can(c, "score.view", "peer").allowed, false);
  assert.equal(can(c, "score.view", "peer").reason, "out_of_scope");
});

test("direct_reports reaches a report but not the wider hierarchy", () => {
  const c = ctx([MANAGER], "mgr");
  assert.equal(can(c, "score.view", "report").allowed, true);
  assert.equal(
    can(c, "score.view", "deep").allowed,
    false,
    "a skip-level report is outside direct_reports",
  );
});

test("the widest scope wins when two roles grant the same capability", () => {
  const c = ctx([EMPLOYEE, MANAGER], "mgr");
  assert.equal(scopeFor(c, "score.view"), "direct_reports");
  assert.equal(can(c, "score.view", "report").allowed, true);
});

test("organisation scope reaches everyone", () => {
  const c = ctx([PEOPLE_OPS], "ops");
  assert.equal(can(c, "score.view", "peer").allowed, true);
  assert.equal(can(c, "score.view", "owner").allowed, true);
});

/* ── The administrative floor — legacy defect P5 ──────────────────────────── */

test("nobody may act on someone at or above their own level", () => {
  const c = ctx([PEOPLE_OPS], "ops");
  // Organisation scope, so scope is satisfied — the floor is what stops it.
  assert.equal(scopeFor(c, "people.reset_password"), "organisation");
  const d = can(c, "people.reset_password", "owner");
  assert.equal(
    d.allowed,
    false,
    "People Ops cannot reset the owner's password",
  );
  assert.equal(d.reason, "administrative_floor");
});

test("the floor blocks equal levels too, not only higher ones", () => {
  const c = ctx([PEOPLE_OPS], "ops");
  const peerOps = can(c, "people.reset_password", "ops2");
  // "ops2" is unknown to LEVELS, so it defaults to 10 — below ops. Allowed.
  assert.equal(peerOps.allowed, true);
  // An equal level is refused.
  const equal = can({ ...c, levelOf: () => 60 }, "people.reset_password", "x");
  assert.equal(equal.allowed, false);
  assert.equal(equal.reason, "administrative_floor");
});

test("the floor never applies to acting on yourself", () => {
  const c = ctx([PEOPLE_OPS], "ops");
  assert.equal(can(c, "people.reset_password", "ops").allowed, true);
});

test("the floor does not apply to work capabilities, only to person ones", () => {
  const c = ctx([MANAGER], "mgr");
  // `task.view` targets work; a high-level target is still readable in scope.
  assert.equal(can(c, "task.view", "report").allowed, true);
});

test("scope is checked before the floor, and the floor never widens scope", () => {
  const c = ctx([MANAGER], "mgr");
  // Manager holds change_reporting at direct_reports only.
  const outside = can(c, "people.change_reporting", "peer");
  assert.equal(outside.allowed, false);
  assert.equal(
    outside.reason,
    "out_of_scope",
    "a low-level target outside scope is still refused",
  );
});

test("reachableIds filters a candidate list by the same rules", () => {
  const c = ctx([MANAGER], "mgr");
  assert.deepEqual(
    reachableIds(c, "score.view", ["report", "deep", "peer", "mgr"]),
    ["report", "mgr"],
    "direct reports and oneself, nobody else",
  );
  assert.deepEqual(
    reachableIds(c, "people.delete", ["report"]),
    [],
    "a capability they lack reaches nobody",
  );
});

test("a capability with no target is allowed on the capability alone", () => {
  const c = ctx([ADMIN], "owner");
  assert.equal(can(c, "people.change_role").allowed, true);
  assert.equal(
    can(ctx([EMPLOYEE], "emp"), "people.change_role").allowed,
    false,
  );
});

/* ── The seeded roles, checked against the profiles the switcher offers ─────
   A matrix test rather than six assertions: the point is that each profile
   gets a DIFFERENT answer, which is what makes the switcher a real test of
   the permission system rather than a costume. */

test("each seeded profile resolves a distinct administrative reach", () => {
  const EMP = role("employee", 10, [["task.view", "self"]]);
  const MGR = role("manager", 30, [["task.view", "direct_reports"]]);
  const OPS = role("people_ops", 60, [
    ["people.change_reporting", "organisation"],
  ]);
  const SYS = role("system_admin", 100, [
    ["people.change_role", "organisation"],
    ["integration.configure", "organisation"],
  ]);

  const reach = (holding: Role[]) => {
    const c: PermissionContext = {
      viewer: {
        employeeId: "x",
        roles: holding,
        hierarchyIds: [],
        directReportIds: [],
        hasManager: false,
        administrativeLevel: Math.max(
          ...holding.map((r) => r.administrativeLevel),
        ),
      },
      roles: [EMP, MGR, OPS, SYS],
      directReportIds: [],
      hierarchyIds: [],
      levelOf: () => 10,
    };
    return {
      roles: can(c, "people.change_role").allowed,
      reporting: can(c, "people.change_reporting").allowed,
      config: can(c, "integration.configure").allowed,
    };
  };

  assert.deepEqual(reach([EMP]), {
    roles: false,
    reporting: false,
    config: false,
  });
  assert.deepEqual(reach([EMP, MGR]), {
    roles: false,
    reporting: false,
    config: false,
  });
  assert.deepEqual(
    reach([EMP, OPS]),
    { roles: false, reporting: true, config: false },
    "People Ops manages reporting lines but never grants roles",
  );
  assert.deepEqual(
    reach([EMP, SYS]),
    { roles: true, reporting: false, config: true },
    "the system administrator grants roles and configures workflows",
  );
});

/* ── Task scoping — the "all" hole ─────────────────────────────────────────
   `scope: "all"` used to fall through the repository's if/else chain to an
   unfiltered list: the widest reach was the only one with no check. These lock
   the rule that decides it. */

test("only organisation scope may see every task", () => {
  const EMP = role("employee", 10, [["task.view", "self"]]);
  const MGR = role("manager", 30, [["task.view", "direct_reports"]]);
  const SKIP = role("skip", 50, [["task.view", "hierarchy"]]);
  const SYS = role("sys", 100, [["task.view", "organisation"]]);

  const scopeOf = (holding: Role[]) =>
    scopeFor(
      {
        viewer: {
          employeeId: "x",
          roles: holding,
          hierarchyIds: [],
          directReportIds: [],
          hasManager: false,
          administrativeLevel: 10,
        },
        roles: [EMP, MGR, SKIP, SYS],
        directReportIds: [],
            hierarchyIds: [],
        levelOf: () => 10,
      },
      "task.view",
    );

  assert.equal(scopeOf([EMP]), "self");
  assert.equal(scopeOf([MGR]), "direct_reports");
  assert.equal(scopeOf([SKIP]), "hierarchy");
  assert.equal(scopeOf([SYS]), "organisation");
  assert.equal(
    scopeOf([EMP, MGR]),
    "direct_reports",
    "holding both roles gives the wider reach, never the narrower",
  );
});

test("creating work for someone is checked against that person", () => {
  const c = ctx([MANAGER], "mgr");
  assert.equal(
    can(c, "task.create", "report").allowed,
    false,
    "manager fixture holds no task.create — the capability is what decides",
  );

  /* Built inline rather than through `ctx`, because `permissionsOf` counts a
     role only when it is BOTH held by the viewer and present in the registry —
     an unknown role grants nothing, which is the safe direction. */
  const CREATOR = role("creator", 30, [["task.create", "direct_reports"]]);
  const c2: PermissionContext = {
    viewer: {
      employeeId: "mgr",
      roles: [CREATOR],
      hierarchyIds: ["report", "deep"],
      directReportIds: ["report"],
      hasManager: false,
      administrativeLevel: 30,
    },
    roles: [CREATOR],
    directReportIds: ["report"],
    hierarchyIds: ["report", "deep"],
    levelOf: (id) => LEVELS[id] ?? 10,
  };
  assert.equal(can(c2, "task.create", "report").allowed, true);
  assert.equal(
    can(c2, "task.create", "peer").allowed,
    false,
    "assigning outside the reporting line is refused",
  );
  assert.equal(
    can(c2, "task.create", "mgr").allowed,
    true,
    "creating work for yourself always resolves",
  );
});

/* ── Who may be offered as an assignee ────────────────────────────────────── */

/**
 * The assignee picker, against the real fixture.
 *
 * This exists because of a reported bug: the picker listed every employee and
 * `createTask` refused afterwards, so somebody with `self` scope could select a
 * colleague, complete the form, and only then be told "You can only create task
 * for yourself." A list you are not allowed to choose from is not a list.
 *
 * `listAssignableEmployees` scopes with `reachableIds(ctx, "task.create", …)`,
 * which is what this asserts. Testing the rule rather than the repository
 * method is deliberate — the repository cannot be imported here (its `@/`
 * aliases do not resolve under type stripping), and the rule is the part that
 * must not drift. It runs on the seeded roles and reporting lines, so a change
 * to either that widens or narrows who can be assigned work fails here.
 */
function seedCtx(employeeId: string): PermissionContext {
  const me = seedEmployees.find((e) => e.id === employeeId)!;
  const held = seedRoles.filter((r) => me.roleIds.includes(r.id));
  const direct = seedReporting
    .filter((r) => r.managerId === me.id && !r.effectiveTo)
    .map((r) => r.employeeId);
  const closure = (id: string, depth = 0): string[] => {
    if (depth > 10) return [];
    const kids = seedReporting
      .filter((r) => r.managerId === id && !r.effectiveTo)
      .map((r) => r.employeeId);
    return kids.flatMap((k) => [k, ...closure(k, depth + 1)]);
  };
  return {
    viewer: {
      employeeId: me.id,
      roles: held,
      hierarchyIds: closure(me.id),
      directReportIds: direct,
      hasManager: false,
      administrativeLevel: Math.max(...held.map((r) => r.administrativeLevel)),
    },
    roles: seedRoles,
    directReportIds: direct,
    hierarchyIds: closure(me.id),
    levelOf: (id) => {
      const e = seedEmployees.find((x) => x.id === id);
      if (!e) return 0;
      const ls = seedRoles
        .filter((r) => e.roleIds.includes(r.id))
        .map((r) => r.administrativeLevel);
      return ls.length ? Math.max(...ls) : 0;
    },
  };
}

const assignableFor = (id: string) =>
  reachableIds(
    seedCtx(id),
    "task.create",
    seedEmployees.map((e) => e.id),
  );

test("an employee may be offered anyone — legacy restricted assignment to nobody", () => {
  /* `cowork-old-backend` /task/create is guarded by `verifyEmployeeToken`, which
     admits any authenticated user, and its only role test lists every role the
     product has. The service layer checks nothing and the old client loaded the
     whole employee collection into the picker. Narrowing this to `self` made the
     product stricter than the system it replaces and produced "You can only
     create task for yourself" against a name the picker had just offered. */
  assert.deepEqual(
    assignableFor("e-02").sort(),
    seedEmployees.map((e) => e.id).sort(),
  );
});

test("a manager may be offered anyone, including outside their reporting line", () => {
  const maya = assignableFor("e-01");
  assert.ok(maya.includes("e-04"), "Idris is in another department");
  assert.ok(maya.includes("e-07"), "Priya is Maya's own manager");
});

test("assigning upward requires the senior assignee's consent", () => {
  /* Legacy set `pending_tl_approval` when an employee assigned to a TL, and the
     TL accepted it themselves. Reproduced by administrative level rather than a
     role name, so it survives an organisation renaming its roles. */
  const tobias = seedCtx("e-02");
  assert.deepEqual(
    upwardApprovers(tobias, ["e-01"]),
    ["e-01"],
    "Maya is a manager; Tobias is not — she must consent",
  );
  assert.deepEqual(
    upwardApprovers(tobias, ["e-06"]),
    [],
    "Jonas is a peer, so nothing is gated",
  );
});

test("nobody needs their own permission to give themselves work", () => {
  for (const e of seedEmployees) {
    assert.deepEqual(
      upwardApprovers(seedCtx(e.id), [e.id]),
      [],
      `${e.displayName} was gated on a task for themselves`,
    );
  }
});

test("a narrowed scope is still enforced, so the model stays configurable", () => {
  /* The seeded grant is wide because legacy was wide, not because the check was
     removed. An organisation that narrows `task.create` in the role editor must
     actually be obeyed — by the picker and by the write, which both resolve
     through the same helper. */
  const narrowed: Role = {
    ...seedRoles.find((r) => r.id === "role-employee")!,
    permissions: [{ id: "n1", capability: "task.create", scope: "self" }],
  };
  const ctx = seedCtx("e-02");
  const strict: PermissionContext = {
    ...ctx,
    viewer: { ...ctx.viewer, roles: [narrowed] },
    roles: [narrowed],
  };
  assert.deepEqual(
    reachableIds(
      strict,
      "task.create",
      seedEmployees.map((e) => e.id),
    ),
    ["e-02"],
  );
  assert.equal(assignmentRefusal(strict, ["e-01"])?.allowed, false);
});

test("every profile can always create work for themselves", () => {
  /* `reaches` short-circuits on self, so this holds regardless of scope — an
     employee who could not file their own task would have no way to work. */
  for (const e of seedEmployees) {
    if (scopeFor(seedCtx(e.id), "task.create") === null) continue;
    assert.ok(
      assignableFor(e.id).includes(e.id),
      `${e.displayName} cannot create a task for themselves`,
    );
  }
});

/* ── Hierarchy versus department ──────────────────────────────────────────── */

/**
 * The reporting line decides; the department does not.
 *
 * The bug these pin: `crossesDepartment` was a plain department comparison and
 * the deadline rule read `crossesDepartment || !insideHierarchy`, so a boundary
 * outranked a reporting line that genuinely spanned it. Priya manages Maya from
 * a different department — assigning to her own direct report produced a fixed,
 * non-negotiable deadline and raised a cross-department approval asking two
 * heads to sanction a manager giving work to her own report.
 *
 * The closure was never wrong. The department test was allowed to speak over it.
 */
function relationshipFor(creatorId: string, assigneeIds: string[]) {
  const closure = (id: string, depth = 0): string[] => {
    if (depth > 10) return [];
    return seedReporting
      .filter((r) => r.managerId === id && !r.effectiveTo)
      .flatMap((r) => [r.employeeId, ...closure(r.employeeId, depth + 1)]);
  };
  const deptOf = (id: string) =>
    seedEmployees.find((e) => e.id === id)?.departmentId ?? null;
  return assignmentRelationship({
    creatorId,
    assigneeIds,
    hierarchyIds: closure(creatorId),
    directReportIds: seedReporting
      .filter((r) => r.managerId === creatorId && !r.effectiveTo)
      .map((r) => r.employeeId),
    creatorDepartmentId: deptOf(creatorId),
    departmentOf: deptOf,
  });
}

test("Priya → Maya is inside the hierarchy, despite different departments", () => {
  /* e-01 Maya reports to e-07 Priya (seed r4). Priya is Operations, Maya is
     Product — the exact case that was reported broken. */
  const r = relationshipFor("e-07", ["e-01"]);
  assert.equal(r.insideHierarchy, true);
  assert.equal(
    r.crossesDepartment,
    false,
    "a reporting line spans the boundary",
  );
  assert.equal(r.deadlineMode, "timer", "manager to direct report is a Budget");
});

test("Maya → Priya is outside, and upward", () => {
  const r = relationshipFor("e-01", ["e-07"]);
  assert.equal(r.insideHierarchy, false);
  assert.equal(r.deadlineMode, "fixed");
  /* And it is the upward gate that applies, not a department one. */
  assert.deepEqual(upwardApprovers(seedCtx("e-01"), ["e-07"]), ["e-07"]);
});

test("Priya → Tobias: inside the line for the deadline, still gated for the crossing", () => {
  /* Tobias reports to Maya, who reports to Priya. The two questions diverge
     here, which is the point of C2:

       deadline model — follows the whole reporting line, so a Budget;
       approval gate  — follows the DIRECT manager only, and Priya is not it,
                        so the department heads still have their say.

     Legacy skipped its gate on `primaryManager` alone (`taskForward.js:180`);
     being two levels up is not the same as being the person accountable for
     that individual. */
  const r = relationshipFor("e-07", ["e-02"]);
  assert.equal(r.insideHierarchy, true, "the line reaches him");
  assert.equal(r.deadlineMode, "timer", "so he negotiates a budget");
  assert.equal(
    r.crossesDepartment,
    true,
    "but a skip-level crossing is not exempt from the department gate",
  );
});

test("Priya → Maya: her direct report, so the boundary is cleared", () => {
  /* The one case legacy exempts: the assigner IS the target's primaryManager.
     Different departments, and the gate does not fire. */
  const r = relationshipFor("e-07", ["e-01"]);
  assert.equal(r.insideHierarchy, true);
  assert.equal(r.crossesDepartment, false);
  assert.equal(r.deadlineMode, "timer");
});

test("Priya → Adaeze is outside: no line, different department", () => {
  /* e-08 Adaeze reports to nobody in the fixture and sits in People. */
  const r = relationshipFor("e-07", ["e-08"]);
  assert.equal(r.insideHierarchy, false);
  assert.equal(r.crossesDepartment, true);
  assert.equal(r.deadlineMode, "fixed");
});

test("sharing a department grants nothing on its own", () => {
  /* Tobias and Jonas are both Product and both report to Maya. Neither manages
     the other, so neither may treat the other as inside their line. */
  const r = relationshipFor("e-02", ["e-06"]);
  assert.equal(r.insideHierarchy, false);
  assert.equal(
    r.crossesDepartment,
    false,
    "same department, so there is no boundary to cross either",
  );
  assert.equal(r.deadlineMode, "fixed");
});

test("one assignee outside the line makes the whole task outside it", () => {
  /* Maya manages Tobias but not Adaeze. A budget negotiated with one and
     imposed on the other would be two different tasks. */
  const r = relationshipFor("e-01", ["e-02", "e-08"]);
  assert.equal(r.insideHierarchy, false);
  assert.equal(r.deadlineMode, "fixed");
});

test("a task you raise for yourself is inside your own line", () => {
  for (const e of seedEmployees) {
    const r = relationshipFor(e.id, [e.id]);
    assert.equal(
      r.insideHierarchy,
      true,
      `${e.displayName} was placed outside their own line`,
    );
    assert.equal(r.crossesDepartment, false);
  }
});
