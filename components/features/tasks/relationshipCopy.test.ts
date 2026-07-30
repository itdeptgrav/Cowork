import assert from "node:assert/strict";
import { test } from "node:test";
import { RELATIONSHIP_COPY } from "./relationshipCopy.ts";
import { assignmentRelationship } from "../../../lib/auth/assignment.ts";
import {
  employees as seedEmployees,
  reporting as seedReporting,
} from "../../../lib/seed/seed.ts";

/**
 * The words and the rule cannot drift apart.
 *
 * `RELATIONSHIP_COPY` is typed `Record<AssignmentRelation, …>`, so a new
 * relationship added to the resolver fails the build here rather than rendering
 * an empty panel. What the type cannot check is that each entry SAYS the right
 * thing — that the "Budget task" label sits on the relationships that actually
 * produce a budget. A copy edit that swapped two entries would type-check
 * perfectly and tell every reader the opposite of the truth.
 */

function relationFor(creatorId: string, assigneeIds: string[]) {
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

test("every relationship has copy, and none of it is empty", () => {
  for (const [relation, copy] of Object.entries(RELATIONSHIP_COPY)) {
    for (const [field, value] of Object.entries(copy)) {
      assert.ok(
        value.trim().length > 10,
        `${relation}.${field} is empty or a stub`,
      );
    }
  }
});

test("the label matches the deadline mode the resolver produces", () => {
  /* The pairing that matters: a reader is told "Budget task" exactly when the
     task will actually run on a budget. */
  const cases: [string, string[]][] = [
    ["e-07", ["e-01"]], // Priya → Maya, manager to report across departments
    ["e-01", ["e-02"]], // Maya → Tobias, same department
    ["e-01", ["e-07"]], // Maya → Priya, upward
    ["e-07", ["e-08"]], // Priya → Adaeze, unrelated
    ["e-02", ["e-02"]], // Tobias → himself
    ["e-02", ["e-06"]], // Tobias → Jonas, peers
  ];
  for (const [creator, assignees] of cases) {
    const r = relationFor(creator, assignees);
    const copy = RELATIONSHIP_COPY[r.relation];
    const expected =
      r.deadlineMode === "timer" ? "Budget task" : "Deadline task";
    assert.equal(
      copy.label,
      expected,
      `${creator} → ${assignees.join(",")} resolves ${r.relation} / ${r.deadlineMode} but is labelled "${copy.label}"`,
    );
  }
});

test("only the cross-department relationship promises two department heads", () => {
  /* The forecast for a relationship must not describe a gate that relationship
     does not trigger — the reason this file exists is that those sentences used
     to be chosen by a conditional written separately in each component. */
  for (const [relation, copy] of Object.entries(RELATIONSHIP_COPY)) {
    const mentionsHeads = /department heads/.test(
      copy.forecast + " " + copy.record,
    );
    assert.equal(
      mentionsHeads,
      relation === "cross_department",
      `${relation} ${mentionsHeads ? "mentions" : "does not mention"} department heads`,
    );
  }
});

test("Priya assigning to Maya is described as inside the hierarchy", () => {
  /* The regression that started this: a manager assigning to her own direct
     report across a department boundary was told the opposite. */
  const r = relationFor("e-07", ["e-01"]);
  assert.equal(r.relation, "in_line");
  const copy = RELATIONSHIP_COPY[r.relation];
  assert.match(copy.forecast, /within your reporting hierarchy/);
  assert.doesNotMatch(copy.forecast, /outside/);
});
