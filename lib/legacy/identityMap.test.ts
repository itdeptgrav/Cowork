import assert from "node:assert/strict";
import test from "node:test";

import {
  IDENTITY_ALIASES,
  checkIdentity,
  describeIdentityProblem,
  fromHierarchyId,
  toHierarchyId,
} from "./identityMap.ts";
import { buildReportingTree, type LegacyManagers } from "./hierarchy.ts";

/**
 * The authentication identity → hierarchy identity join.
 *
 * Production, 2026-07-29: 15 of 16 Cowork employees have an HR record under the
 * same id. The CEO does not — `E000` signs in, `GR0000` is reported to, and the
 * two records share no key at all. `GR0000`'s HR record carries no email
 * (`email: ""`, `personalEmail: ""`), so there is nothing to join on.
 */

const mgr = (id: string) => ({
  name: id,
  biometricId: id,
  department: "",
  designation: "",
  email: "",
  profilePhotoUrl: null,
});

/** The live edges. */
const TREE = buildReportingTree(
  new Map<string, LegacyManagers>(
    Object.entries({
      E000: null,
      GR0002: "GR0000",
      GR0045: "GR0000",
      GR0067: "GR0045",
      GR0108: "GR0045",
    }).map(([id, m]) => [
      id,
      { primaryManager: m ? mgr(m) : null, secondaryManager: null },
    ]),
  ),
);

const KNOWN = new Set(TREE.byEmployee.keys());
const managerOf = (id: string) => TREE.byEmployee.get(id)?.managerId ?? null;

/* ── The mapping ───────────────────────────────────────────────────────── */

test("no alias is needed — the data was fixed instead", () => {
  /* `cowork_employees/GR0000` now exists with the CEO's Firebase uid, and
     `E000` no longer carries one, so sign-in resolves directly. Verified
     against production: exactly one document holds that uid, and it is
     GR0000. */
  assert.equal(toHierarchyId("E000"), "E000");
  assert.equal(toHierarchyId("GR0000"), "GR0000");
});

test("everyone consistent maps to themselves", () => {
  /* The identity function for 15 of 16 people — the alias is the exception,
     not the mechanism. */
  for (const id of ["GR0002", "GR0045", "GR0067", "GR0108"]) {
    assert.equal(toHierarchyId(id), id);
  }
});

test("nothing aliases onto anything", () => {
  assert.deepEqual(fromHierarchyId("GR0000"), []);
  assert.deepEqual(fromHierarchyId("GR0045"), []);
});

test("the alias table is empty", () => {
  /* The signal that the workaround is retired. An entry here means two stores
     disagree about one person; the fix belongs in the stores, as it did here. */
  assert.deepEqual(Object.keys(IDENTITY_ALIASES), []);
});

/* ── What the mapping actually buys ────────────────────────────────────── */

test("the CEO identity has real direct reports", () => {
  /* E000 remains a node nobody reports to — correct, it is a system account.
     GR0000 is the login now, and it has the reports. */
  assert.deepEqual(TREE.byEmployee.get("E000")!.directReportIds, []);
  assert.deepEqual(
    TREE.byEmployee.get("GR0000")!.directReportIds,
    ["GR0002", "GR0045"],
  );
});

test("Admin-as-TL still holds: direct reports only, no indirect", () => {
  /* GR0067 and GR0108 report to GR0045, who reports to GR0000. The CEO must
     see GR0045 and NOT the two beneath. The identity fix changes who the CEO
     is in the tree, not how far anyone sees. */
  const reach = TREE.byEmployee.get("GR0000")!.directReportIds;
  assert.ok(reach.includes("GR0045"));
  assert.equal(reach.includes("GR0067"), false);
  assert.equal(reach.includes("GR0108"), false);
});

/* ── Validation ────────────────────────────────────────────────────────── */

test("a resolved identity passes the consistency check", () => {
  /* GR0000 is the root, so it has no manager — reported as `no_manager`, which
     is correct at the top of an organisation. */
  const problem = checkIdentity({
    employeeId: "GR0000",
    knownHierarchyIds: KNOWN,
    managerOf,
  });
  assert.equal(problem?.kind, "no_manager");
});

test("an unmappable account is reported, never rendered as an empty team", () => {
  /* The failure this whole module exists to make visible. Without the alias,
     E000 resolves to a node with no reports and the screen says "you have no
     reports" — a claim about the organisation, when the truth is a broken
     join. */
  const problem = checkIdentity({
    employeeId: "GHOST",
    knownHierarchyIds: KNOWN,
    managerOf,
  });
  assert.equal(problem?.kind, "no_hierarchy_node");

  const message = describeIdentityProblem(problem!);
  assert.match(message, /GHOST/);
  /* Says what it is NOT, because the two look identical on screen. */
  assert.match(message, /not the same as having no reports/);
});

test("the message names both ids when they differ", () => {
  const message = describeIdentityProblem({
    kind: "no_hierarchy_node",
    employeeId: "E000",
    hierarchyId: "GR0000",
  });
  assert.match(message, /E000/);
  assert.match(message, /GR0000/);
});

test("a fully-placed employee has no problem at all", () => {
  assert.equal(
    checkIdentity({
      employeeId: "GR0067",
      knownHierarchyIds: KNOWN,
      managerOf,
    }),
    null,
  );
});
