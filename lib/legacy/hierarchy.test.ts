import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportingTree,
  descendantsOf,
  readDepth,
  type LegacyManagers,
} from "./hierarchy.ts";

/**
 * The derived reporting tree.
 *
 * The fixture is the real shape of production, read on 2026-07-29: 16 Cowork
 * employees, `GR0000` at the root, four TLs beneath, employees beneath those.
 * Ids and edges are the live ones; nothing here is invented.
 */

const manager = (biometricId: string, name = biometricId) => ({
  name,
  biometricId,
  department: "",
  designation: "",
  email: "",
  profilePhotoUrl: null,
});

const answers = (
  edges: Record<string, string | null>,
): Map<string, LegacyManagers> =>
  new Map(
    Object.entries(edges).map(([id, mgr]) => [
      id,
      {
        primaryManager: mgr ? manager(mgr) : null,
        secondaryManager: null,
      },
    ]),
  );

/* The live edges, trimmed to one branch per shape. */
const LIVE = answers({
  GR0000: null,
  GR0002: "GR0000",
  GR0045: "GR0000",
  GR0063: "GR0000",
  GR0003: "GR0002",
  GR0065: "GR0002",
  GR0067: "GR0045",
  GR0069: "GR0063",
});

test("the root is the employee with no manager", () => {
  const tree = buildReportingTree(LIVE);
  assert.deepEqual(tree.rootIds, ["GR0000"]);
  assert.equal(tree.byEmployee.get("GR0000")!.depth, 0);
});

test("depth counts levels from the root", () => {
  const tree = buildReportingTree(LIVE);
  assert.equal(tree.byEmployee.get("GR0045")!.depth, 1);
  assert.equal(tree.byEmployee.get("GR0067")!.depth, 2);
});

test("direct reports are the inverted primary edges", () => {
  const tree = buildReportingTree(LIVE);
  assert.deepEqual(tree.byEmployee.get("GR0000")!.directReportIds, [
    "GR0002",
    "GR0045",
    "GR0063",
  ]);
  assert.deepEqual(tree.byEmployee.get("GR0045")!.directReportIds, ["GR0067"]);
  assert.deepEqual(tree.byEmployee.get("GR0067")!.directReportIds, []);
});

test("the closure reaches every level beneath, excluding self", () => {
  const tree = buildReportingTree(LIVE);
  /* What a CEO's `hierarchyIds` must contain. */
  assert.deepEqual(descendantsOf(tree, "GR0000"), [
    "GR0002",
    "GR0003",
    "GR0045",
    "GR0063",
    "GR0065",
    "GR0067",
    "GR0069",
  ]);
  /* A TL sees only their own branch — this is the whole point of the closure,
     and the reason an empty one under-shows rather than leaking. */
  assert.deepEqual(descendantsOf(tree, "GR0045"), ["GR0067"]);
  assert.deepEqual(descendantsOf(tree, "GR0067"), []);
});

/* ── The two ways a manager fails to resolve ───────────────────────────── */

test("a named but unlinkable manager makes no edge and keeps the name", () => {
  /* The handler falls back to a bare `managerName` when the Mongo ObjectId ref
     is missing, returning `biometricId: ""`. That is NOT "no manager", and a
     profile should still be able to say who someone reports to. */
  const tree = buildReportingTree(
    new Map([
      [
        "E1",
        {
          primaryManager: { ...manager(""), name: "Jordan Vale" },
          secondaryManager: null,
        },
      ],
    ]),
  );
  const node = tree.byEmployee.get("E1")!;
  assert.equal(node.managerId, null);
  assert.equal(node.managerName, "Jordan Vale");
  /* No edge means it reads as a root. Truthful: we cannot place them. */
  assert.equal(node.depth, 0);
});

test("an employee absent from HR has no manager, not an error", () => {
  /* Legacy returns `success: true` with both null for somebody not in HR. */
  const tree = buildReportingTree(answers({ E1: null }));
  assert.equal(tree.byEmployee.get("E1")!.managerId, null);
  assert.equal(tree.byEmployee.get("E1")!.managerName, null);
});

/* ── Bad data is contained, never trusted ──────────────────────────────── */

test("a self-referencing manager is discarded", () => {
  const tree = buildReportingTree(answers({ E1: "E1" }));
  assert.equal(tree.byEmployee.get("E1")!.managerId, null);
  assert.equal(tree.byEmployee.get("E1")!.depth, 0);
});

test("a cycle reports unresolvable depth rather than a wrong one", () => {
  /* Null, not 0. Depth 0 would place them beside the CEO — a specific and
     wrong claim, rather than an absence of one. */
  const tree = buildReportingTree(answers({ A: "B", B: "A" }));
  assert.equal(tree.byEmployee.get("A")!.depth, null);
  assert.equal(tree.byEmployee.get("B")!.depth, null);
  assert.deepEqual(tree.rootIds, []);
});

test("a manager outside the directory becomes a node, keeping the tree connected", () => {
  /* GR9999 manages GR0004 but has no Cowork account, so we never asked them
     anything. They are still a real link in the chain — inventing no node for
     them used to leave GR0004 at an unresolvable depth and gave the manager no
     `directReportIds` to read, which is how the CEO's team came to be empty
     while eight people reported to them. */
  const tree = buildReportingTree(answers({ GR0004: "GR9999" }));
  const child = tree.byEmployee.get("GR0004")!;
  assert.equal(child.managerId, "GR9999");
  assert.equal(child.depth, 1);

  const inferred = tree.byEmployee.get("GR9999")!;
  assert.ok(inferred, "the named manager must exist as a node");
  assert.deepEqual(inferred.directReportIds, ["GR0004"]);
  assert.equal(inferred.depth, 0);
  /* Marked as inferred from an edge rather than answered for: they manage
     somebody but cannot sign in. */
  assert.equal(inferred.isDirectoryMember, false);
  assert.equal(child.isDirectoryMember, true);
});

test("descendantsOf terminates on a cycle", () => {
  const tree = buildReportingTree(answers({ A: "B", B: "A" }));
  assert.deepEqual(descendantsOf(tree, "A"), ["B"]);
});

/* ── Secondary managers are recorded, but form no edge ─────────────────── */

test("a secondary manager does not create a parent-child edge", () => {
  /* Legacy stores both and `resolveDepartmentApprover` consults only the
     primary. Two edges would put one person in two branches and make depth
     ambiguous. */
  const tree = buildReportingTree(
    new Map([
      [
        "E1",
        {
          primaryManager: manager("M1"),
          secondaryManager: manager("M2"),
        },
      ],
      ["M1", { primaryManager: null, secondaryManager: null }],
      ["M2", { primaryManager: null, secondaryManager: null }],
    ]),
  );
  assert.deepEqual(tree.byEmployee.get("M1")!.directReportIds, ["E1"]);
  assert.deepEqual(tree.byEmployee.get("M2")!.directReportIds, []);
  assert.equal(tree.byEmployee.get("E1")!.secondaryManagerId, "M2");
});

test("readDepth is null for an employee not in the tree", () => {
  const tree = buildReportingTree(answers({ E1: null }));
  assert.equal(readDepth(tree.byEmployee, "NOBODY"), null);
});
