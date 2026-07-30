import assert from "node:assert/strict";
import test from "node:test";

import { assignmentRelationship } from "./assignment.ts";
import { departmentSlug, toEmployee } from "../repositories/legacy/map.ts";
import { buildReportingTree, descendantsOf, type LegacyManagers } from "../legacy/hierarchy.ts";

/**
 * The reporting line is the source of truth; the department is not.
 *
 * These pin the rule the brief asks for: a manager reaches their reports
 * regardless of which department either sits in, and sharing a department with
 * somebody grants nothing on its own.
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

/* Rakesh manages Soumya across a department boundary; Chandra shares Rakesh's
   department but reports elsewhere; Priya is Soumya's report, two levels under
   Rakesh. */
const TREE = treeOf({
  RAKESH: null,
  SOUMYA: "RAKESH",
  PRIYA: "SOUMYA",
  CHANDRA: "OTHER",
  OTHER: null,
});

const DEPT: Record<string, string> = {
  RAKESH: "operations",
  SOUMYA: "finance",
  PRIYA: "finance",
  CHANDRA: "operations",
  OTHER: "operations",
};

const relationship = (creator: string, assignees: string[]) =>
  assignmentRelationship({
    creatorId: creator,
    assigneeIds: assignees,
    hierarchyIds: descendantsOf(TREE, creator),
    directReportIds: TREE.byEmployee.get(creator)?.directReportIds ?? [],
    creatorDepartmentId: DEPT[creator],
    departmentOf: (id: string) => DEPT[id] ?? "",
  });

/* ── Case 1 · Manager and report in different departments ──────────────── */

test("Case 1: a cross-department direct report is inside the reporting line", () => {
  assert.deepEqual(TREE.byEmployee.get("RAKESH")!.directReportIds, ["SOUMYA"]);
  /* Team filters the directory by this list, so it is what makes Soumya
     appear on Rakesh's Team page. Departments are not consulted. */
  assert.ok(descendantsOf(TREE, "RAKESH").includes("SOUMYA"));
});

test("Case 1: assigning to a cross-department direct report raises no gate", () => {
  const r = relationship("RAKESH", ["SOUMYA"]);
  assert.equal(r.insideHierarchy, true);
  /* The departments genuinely differ — and it must NOT count as crossing,
     because Rakesh is her manager. Legacy skips its own gate on exactly this
     condition (`assignerIsTargetsManager`). */
  assert.equal(r.crossesDepartment, false);
  assert.equal(r.relation, "in_line");
  /* A budget, negotiable — not a fixed deadline imposed across a boundary
     that a reporting line already spans. */
  assert.equal(r.deadlineMode, "timer");
});

/* ── Case 2 · Same department, no reporting line ───────────────────────── */

test("Case 2: sharing a department grants nothing", () => {
  assert.equal(DEPT.CHANDRA, DEPT.RAKESH);
  /* Not in the closure, so not on Team and not covered by a hierarchy-scoped
     permission. */
  assert.equal(descendantsOf(TREE, "RAKESH").includes("CHANDRA"), false);

  const r = relationship("RAKESH", ["CHANDRA"]);
  assert.equal(r.insideHierarchy, false);
  /* Same department, so no cross-department gate either — but the deadline is
     fixed, because there is no shared management line to negotiate along. */
  assert.equal(r.crossesDepartment, false);
  assert.equal(r.relation, "outside_line");
  assert.equal(r.deadlineMode, "fixed");
});

test("Case 2: assignment is still permitted — it is consent, not permission", () => {
  /* Cowork does not stop you asking. `listAssignableEmployees` offers everyone
     but yourself; what changes is what has to happen before work starts. */
  const r = relationship("RAKESH", ["CHANDRA"]);
  assert.ok(r.relation);
});

/* ── Case 3 · Indirect report ──────────────────────────────────────────── */

test("Case 3: an indirect report is in the closure", () => {
  /* RAKESH → SOUMYA → PRIYA. */
  assert.deepEqual(descendantsOf(TREE, "RAKESH"), ["PRIYA", "SOUMYA"]);
  assert.equal(TREE.byEmployee.get("PRIYA")!.depth, 2);
});

test("Case 3: a skip-level assignment across a department still needs the heads", () => {
  const r = relationship("RAKESH", ["PRIYA"]);
  /* Inside the line, so the deadline is a budget… */
  assert.equal(r.insideHierarchy, true);
  assert.equal(r.deadlineMode, "timer");
  /* …but Rakesh is not Priya's DIRECT manager, and the departments differ, so
     the gate applies. Being two levels up is not the same as being the person
     accountable for that individual. */
  assert.equal(r.crossesDepartment, true);
});

/* ── The department id itself ──────────────────────────────────────────── */

test("department id comes from the name, normalised", () => {
  /* It was `""` for everyone, so `departmentsDiffer` could never be true and
     the cross-department gate could not fire in the UI at all. */
  const soumya = toEmployee({
    employeeId: "GR0067",
    name: "Soumya Ranjan ",
    role: "employee",
    department: "IT",
  } as never);
  assert.equal(soumya.departmentId, "it");
  assert.equal(soumya.departmentName, "IT");
  assert.notEqual(soumya.departmentId, "");
});

test("hand-entered spelling variants are one department", () => {
  /* A stray space or a capital must not become a departmental boundary
     between two colleagues. */
  assert.equal(departmentSlug("IT"), departmentSlug(" it "));
  assert.equal(
    departmentSlug("SR. MERCHANDISER"),
    departmentSlug("Sr.  Merchandiser"),
  );
  assert.notEqual(departmentSlug("IT"), departmentSlug("HR"));
});

test("no department raises no boundary", () => {
  /* Legacy's gate requires BOTH sides non-empty. An unknown department must
     not invent a boundary. */
  assert.equal(departmentSlug(null), "");
  assert.equal(departmentSlug(undefined), "");

  const r = assignmentRelationship({
    creatorId: "A",
    assigneeIds: ["B"],
    hierarchyIds: [],
    directReportIds: [],
    creatorDepartmentId: "",
    departmentOf: () => "finance",
  });
  assert.equal(r.crossesDepartment, false);
});
