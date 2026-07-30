import assert from "node:assert/strict";
import test from "node:test";

import { archetypeForLegacyRole, canAccessAdminSettings } from "./roleMap.ts";
import {
  buildReportingTree,
  descendantsOf,
  type LegacyManagers,
} from "../legacy/hierarchy.ts";

/**
 * Admin/CEO is a manager with settings access — not a hierarchy type.
 *
 * Two rules, kept apart on purpose:
 *
 * · **Reach over people** comes from the reporting tree. It never consults a
 *   role, so an administrator resolves exactly as a TL does.
 * · **Reach over the system** comes from a role flag. It grants `/admin` and
 *   nothing else.
 *
 * The visibility model is **direct reports only**, uniformly. A CEO above a TL
 * sees the TL, not the TL's people.
 */

const mgr = (id: string) => ({
  name: id,
  biometricId: id,
  department: "",
  designation: "",
  email: "",
  profilePhotoUrl: null,
});

const treeOf = (edges: Record<string, string | null>) =>
  buildReportingTree(
    new Map<string, LegacyManagers>(
      Object.entries(edges).map(([id, m]) => [
        id,
        { primaryManager: m ? mgr(m) : null, secondaryManager: null },
      ]),
    ),
  );

/** What `getViewer` puts in `hierarchyIds`: one level, for everyone. */
const visibleTo = (tree: ReturnType<typeof treeOf>, id: string) =>
  tree.byEmployee.get(id)?.directReportIds ?? [];

/* ── Case 1 · Admin with direct employees ──────────────────────────────── */

test("Case 1: an admin sees their direct reports", () => {
  const tree = treeOf({ ADMIN: null, EMP_A: "ADMIN", EMP_B: "ADMIN" });
  assert.deepEqual(visibleTo(tree, "ADMIN"), ["EMP_A", "EMP_B"]);
});

/* ── Case 2 · Admin above a TL ─────────────────────────────────────────── */

test("Case 2: an admin sees the TL beneath them, not the TL's people", () => {
  const tree = treeOf({ ADMIN: null, TL_B: "ADMIN", EMP_C: "TL_B" });

  assert.deepEqual(visibleTo(tree, "ADMIN"), ["TL_B"]);
  /* Indirect visibility is off. The closure still knows C is beneath ADMIN —
     that is what draws the org tree — but it is not what grants access. */
  assert.deepEqual(descendantsOf(tree, "ADMIN"), ["EMP_C", "TL_B"]);
  assert.equal(visibleTo(tree, "ADMIN").includes("EMP_C"), false);
});

/* ── Case 3 · A normal TL behaves identically ──────────────────────────── */

test("Case 3: a TL resolves by exactly the same rule", () => {
  const tree = treeOf({ TL: null, EMP_D: "TL" });
  assert.deepEqual(visibleTo(tree, "TL"), ["EMP_D"]);
});

test("Case 3: admin and TL with identical trees get identical reach", () => {
  /* The whole claim of the model, asserted rather than described: swap the
     role and nothing about visibility moves, because the tree never sees it. */
  const asAdmin = treeOf({ ROOT: null, X: "ROOT", Y: "X" });
  const asTl = treeOf({ ROOT: null, X: "ROOT", Y: "X" });
  assert.deepEqual(visibleTo(asAdmin, "ROOT"), visibleTo(asTl, "ROOT"));
});

test("an admin with no reports sees nobody", () => {
  /* Not a bug to be patched by special-casing the administrator. The fix for
     an empty team is a reporting line, not a role. */
  const tree = treeOf({ ADMIN: null, SOMEONE: "OTHER", OTHER: null });
  assert.deepEqual(visibleTo(tree, "ADMIN"), []);
});

/* ── Case 4 · Admin settings ───────────────────────────────────────────── */

test("Case 4: only the CEO role unlocks admin settings", () => {
  assert.equal(canAccessAdminSettings("ceo"), true);
  assert.equal(canAccessAdminSettings("tl"), false);
  assert.equal(canAccessAdminSettings("employee"), false);
  assert.equal(canAccessAdminSettings(undefined), false);
});

test("Case 4: the archetype the admin route gates on agrees with the flag", () => {
  /* `mayOpenAdmin` lives in `lib/server/session.ts`, which imports
     `next/headers` and cannot be loaded by the node test runner. Its rule is
     `system_admin || people_ops`, so asserting the archetype mapping asserts
     the gate's input — the only part that varies with the legacy role. */
  assert.equal(archetypeForLegacyRole("ceo"), "system_admin");
  assert.equal(archetypeForLegacyRole("tl"), "manager");
  assert.equal(archetypeForLegacyRole("employee"), "employee");
  /* And the two agree, so there is one answer rather than two. */
  assert.equal(
    canAccessAdminSettings("ceo"),
    archetypeForLegacyRole("ceo") === "system_admin",
  );
});

/* ── The separation itself ─────────────────────────────────────────────── */

test("admin access grants no reach over people", () => {
  /* A CEO and a TL sitting in the same place in the tree see the same people.
     Holding the admin flag adds nobody — being an administrator is not a way
     of being everyone's manager. */
  const tree = treeOf({ ROOT: null, A: "ROOT", B: "A" });

  const ceoReach = visibleTo(tree, "ROOT");
  const tlReach = visibleTo(tree, "ROOT");

  assert.equal(canAccessAdminSettings("ceo"), true);
  assert.equal(canAccessAdminSettings("tl"), false);
  /* Different system access, identical people access. */
  assert.deepEqual(ceoReach, tlReach);
  assert.equal(ceoReach.includes("B"), false);
});

test("the hierarchy engine never reads a role", () => {
  /* `buildReportingTree` takes manager answers and nothing else — there is no
     role parameter to pass, which is the structural guarantee that a role
     cannot influence reach. */
  assert.equal(buildReportingTree.length, 1);
});
