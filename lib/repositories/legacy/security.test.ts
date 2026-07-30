import assert from "node:assert/strict";
import test from "node:test";

import { buildReportingTree, descendantsOf, type LegacyManagers } from "../../legacy/hierarchy.ts";
import { readTask } from "../../legacy/tasks.ts";

/**
 * Two security regressions, pinned to production data read on 2026-07-29.
 *
 * · **Team showed nobody** for a manager who has two reports.
 * · **T620** was reported as visible to GR0045, who is party to it in no way.
 */

/* ── The real reporting edges ──────────────────────────────────────────── */

/**
 * Every employee in `cowork_employees`, mapped to their HR primary manager.
 *
 * Read from production. Note `GR0000` — the person a third of the company
 * reports to — **is not a key**, because they are not in `cowork_employees` at
 * all. That is why the roots below are not what an org chart would suggest.
 */
const EDGES: Record<string, string | null> = {
  E000: null,
  GR0002: "GR0000",
  GR0003: "GR0002",
  GR0004: "GR0081",
  GR0025: "GR0000",
  GR0045: "GR0000",
  GR0050: "GR0000",
  GR0063: "GR0000",
  GR0065: "GR0002",
  GR0067: "GR0045",
  GR0069: "GR0063",
  GR0081: "GR0000",
  GR0099: "GR0000",
  GR0108: "GR0045",
  GR0110: "GR0000",
  GR0114: "GR0000",
};

const TREE = buildReportingTree(
  new Map<string, LegacyManagers>(
    Object.entries(EDGES).map(([id, mgr]) => [
      id,
      {
        primaryManager: mgr
          ? {
              name: mgr,
              biometricId: mgr,
              department: "",
              designation: "",
              email: "",
              profilePhotoUrl: null,
            }
          : null,
        secondaryManager: null,
      },
    ]),
  ),
);

test("GR0045 has two direct reports, so Team must not be empty", () => {
  /* The reported bug: "You don't have access to a team view — 0 in your
     reporting line". `TeamArea` filters the directory by
     `viewer.hierarchyIds`, which `toViewer` hardcoded to `[]`. The data was
     never missing; the closure was never computed. */
  assert.deepEqual(TREE.byEmployee.get("GR0045")!.directReportIds, [
    "GR0067",
    "GR0108",
  ]);
  assert.deepEqual(descendantsOf(TREE, "GR0045"), ["GR0067", "GR0108"]);
});

test("the closure stays a closure — a peer manager's reports are not included", () => {
  /* GR0002 also manages people. A TL must see their own branch and no other,
     which is the whole reason this list gates Team and monitoring. */
  assert.deepEqual(descendantsOf(TREE, "GR0002"), ["GR0003", "GR0065"]);
  assert.equal(descendantsOf(TREE, "GR0045").includes("GR0003"), false);
  assert.equal(descendantsOf(TREE, "GR0067").length, 0);
});

test("GR0000 is not in the directory but is still the root of the tree", () => {
  /* Eight people name GR0000 as their manager and GR0000 has no
     `cowork_employees` record. The node is now inferred from those edges, so
     the tree is connected and the CEO has reports to read — which is the whole
     identity fix. */
  assert.equal(TREE.byEmployee.get("GR0045")!.managerId, "GR0000");
  assert.equal(TREE.byEmployee.get("GR0045")!.depth, 1);

  const root = TREE.byEmployee.get("GR0000")!;
  assert.ok(root, "GR0000 must exist as an inferred node");
  assert.equal(root.isDirectoryMember, false, "GR0000 cannot sign in");
  assert.ok(root.directReportIds.includes("GR0045"));

  /* Two roots: the real one everybody hangs off, and E000 — the Cowork CEO
     account, which nobody reports to. That E000 is a root at all IS the
     identity defect, stated rather than hidden. */
  assert.deepEqual(TREE.rootIds, ["E000", "GR0000"]);
});

/* ── T620 must not be visible to GR0045 ────────────────────────────────── */

/** T620 exactly as production holds it. */
const T620 = {
  id: "T620",
  taskId: "T620",
  title: "coworknw",
  status: "open",
  assigneeIds: ["GR0002"],
  assignedBy: "E000",
  approverId: null,
  visibleTo: [],
  pendingAssigneeId: "GR0002",
  tlHoursSetBy: "GR0002",
  isSelfAssigned: false,
  parentTaskId: null,
};

/**
 * The four Firestore queries `#taskDocuments` runs for a TL, as predicates.
 *
 * A task reaches the list only if one of these matches — the filtering is at
 * the data layer, not the UI. Expressed here so the boundary is testable
 * without Firestore.
 */
const reachesList = (t: ReturnType<typeof readTask>, me: string) => {
  if (!t) return false;
  if (t.createdById === me) return true; // assignedBy == me
  if (t.assigneeIds.includes(me)) return true; // assigneeIds array-contains me
  if (t.approverId === me) return true; // approverId == me (ceo only)
  // status == pending_department_approval, then scoped to the three parties
  if (t.status === "pending_department_approval") {
    return (
      t.createdById === me ||
      t.pendingAssigneeId === me ||
      t.departmentApproverIds.includes(me)
    );
  }
  return false;
};

test("T620 is not reachable by GR0045 through any query", () => {
  /* Verified against Firestore directly: `assignedBy==GR0045` returns 3 docs
     (none T620), `assigneeIds array-contains GR0045` returns 0, and the
     department-gate query returns 0 rows in the whole collection. */
  assert.equal(reachesList(readTask(T620 as never), "GR0045"), false);
});

test("T620 IS reachable by the people party to it", () => {
  const t = readTask(T620 as never);
  assert.equal(reachesList(t, "GR0002"), true, "the assignee");
  assert.equal(reachesList(t, "E000"), true, "the creator");
});

test("an assigned task is visible; a task created by me is visible", () => {
  const assignedToMe = readTask({
    ...T620,
    assigneeIds: ["GR0045"],
  } as never);
  assert.equal(reachesList(assignedToMe, "GR0045"), true);

  const createdByMe = readTask({ ...T620, assignedBy: "GR0045" } as never);
  assert.equal(reachesList(createdByMe, "GR0045"), true);
});

test("a report's task is NOT visible merely because I manage them", () => {
  /* GR0067 reports to GR0045, and their task still does not enter GR0045's
     list. Legacy's task queries do not consult the reporting tree at all —
     only `My team` does, and it does so by employee, not by widening the task
     queries. Widening them here would be a permission change wearing a parity
     fix's clothes. */
  const reportsTask = readTask({
    ...T620,
    assigneeIds: ["GR0067"],
    assignedBy: "GR0002",
    pendingAssigneeId: null,
    tlHoursSetBy: null,
  } as never);
  assert.equal(reachesList(reportsTask, "GR0045"), false);
});

test("a held task reaches only its parties, never the whole organisation", () => {
  /* The gate query is org-wide by necessity — Firestore cannot filter inside
     `departmentApprovals[]` — so the scoping predicate is what stands between
     it and a company-wide leak of held task titles. */
  const held = readTask({
    ...T620,
    status: "pending_department_approval",
    assigneeIds: [],
    assignedBy: "GR0002",
    pendingAssigneeId: "GR0067",
    departmentApprovals: [{ approverId: "GR0081" }],
  } as never);
  assert.equal(reachesList(held, "GR0002"), true, "sender");
  assert.equal(reachesList(held, "GR0067"), true, "pending assignee");
  assert.equal(reachesList(held, "GR0081"), true, "approver");
  assert.equal(reachesList(held, "GR0045"), false, "an unrelated TL");
});
