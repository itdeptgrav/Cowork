import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPersonFilter,
  pathTo,
  personIdsIn,
  type PersonNode,
} from "./peopleFilter.ts";
import type { PersonBucket } from "./peopleRollup.ts";
import type { ReportingNode } from "../../legacy/hierarchy.ts";

/**
 * The organisation used throughout:
 *
 *   CEO ─┬─ TL_A ─┬─ DEV_1
 *        │        └─ DEV_2
 *        └─ TL_B ─── DEV_3
 *
 * `SOLO` is employed and reports to the CEO but manages nobody.
 */
const node = (
  employeeId: string,
  managerId: string | null,
  directReportIds: string[] = [],
): ReportingNode => ({
  employeeId,
  managerId,
  managerName: managerId,
  secondaryManagerId: null,
  secondaryManagerName: null,
  directReportIds,
  depth: null,
  isDirectoryMember: true,
});

const REPORTING: ReportingNode[] = [
  node("CEO", null, ["TL_A", "TL_B", "SOLO"]),
  node("TL_A", "CEO", ["DEV_1", "DEV_2"]),
  node("TL_B", "CEO", ["DEV_3"]),
  node("DEV_1", "TL_A"),
  node("DEV_2", "TL_A"),
  node("DEV_3", "TL_B"),
  node("SOLO", "CEO"),
];

const EMPLOYEES = [
  { id: "CEO", displayName: "Chief" },
  { id: "TL_A", displayName: "Anita Lead" },
  { id: "TL_B", displayName: "Bruno Lead" },
  { id: "DEV_1", displayName: "Dev One" },
  { id: "DEV_2", displayName: "Dev Two" },
  { id: "DEV_3", displayName: "Dev Three" },
  { id: "SOLO", displayName: "Solo Worker" },
];

/** A bucket carrying `n` tasks for that person. Only the count is read. */
const bucket = (id: string, n: number): PersonBucket => ({
  id,
  person: null,
  name: EMPLOYEES.find((e) => e.id === id)?.displayName ?? id,
  tasks: Array.from({ length: n }, (_, i) => ({ task: { id: `${id}-${i}` } })) as PersonBucket["tasks"],
});

const names = (nodes: PersonNode[]) => nodes.map((n) => n.name);

/* ── An ordinary employee ─────────────────────────────────────────────────── */

test("an employee with no reports and no work raised gets no control at all", () => {
  /* Their own tasks are theirs; there is nobody to compare. An empty array is
     the caller's signal to render nothing, not an empty menu. */
  assert.deepEqual(
    buildPersonFilter({
      scope: "self",
      viewerId: "DEV_1",
      reporting: REPORTING,
      employees: EMPLOYEES,
      buckets: [bucket("DEV_1", 4)],
    }),
    [],
  );
});

test("an employee who raised work for others gets those people", () => {
  /* Read off the list in front of them — none of these people reports to
     them, so the tree does not connect them and would answer nothing. */
  const out = buildPersonFilter({
    scope: "self",
    viewerId: "DEV_1",
    reporting: REPORTING,
    employees: EMPLOYEES,
    buckets: [bucket("DEV_1", 2), bucket("DEV_3", 1), bucket("DEV_2", 3)],
  });
  assert.deepEqual(names(out), ["Dev Three", "Dev Two"]);
  /* Never themselves: "my own tasks" is not a filter within their own list. */
  assert.ok(!out.some((n) => n.id === "DEV_1"));
  assert.equal(out.every((n) => n.children.length === 0), true);
});

/* ── A team lead ──────────────────────────────────────────────────────────── */

test("a lead gets their direct reports, flat and in name order", () => {
  const out = buildPersonFilter({
    scope: "direct_reports",
    viewerId: "TL_A",
    reporting: REPORTING,
    employees: EMPLOYEES,
    buckets: [bucket("DEV_2", 5)],
  });
  assert.deepEqual(names(out), ["Dev One", "Dev Two"]);
  assert.equal(out.every((n) => n.children.length === 0), true);
});

test("a lead is not offered themselves, nor anybody else's team", () => {
  const out = buildPersonFilter({
    scope: "direct_reports",
    viewerId: "TL_A",
    reporting: REPORTING,
    employees: EMPLOYEES,
    buckets: [],
  });
  const ids = personIdsIn(out);
  assert.ok(!ids.includes("TL_A"));
  assert.ok(!ids.includes("DEV_3"), "Bruno's report must not appear");
  assert.ok(!ids.includes("CEO"));
});

/* ── Chief level ──────────────────────────────────────────────────────────── */

test("a chief gets a nested tree, so a branch opens onto its team", () => {
  const out = buildPersonFilter({
    scope: "organisation",
    viewerId: "CEO",
    reporting: REPORTING,
    employees: EMPLOYEES,
    buckets: [],
  });
  assert.deepEqual(names(out), ["Anita Lead", "Bruno Lead", "Solo Worker"]);
  assert.deepEqual(names(out[0].children), ["Dev One", "Dev Two"]);
  assert.deepEqual(names(out[1].children), ["Dev Three"]);
  /* Somebody who manages nobody is a leaf, so no expander is drawn for them. */
  assert.deepEqual(out[2].children, []);
});

test("a count is the person's own, never their branch's total", () => {
  /* A lead carrying nothing over a team of two must read 0, not 2 — the
     number beside a name would otherwise read as that person's workload. */
  const out = buildPersonFilter({
    scope: "organisation",
    viewerId: "CEO",
    reporting: REPORTING,
    employees: EMPLOYEES,
    buckets: [bucket("DEV_1", 3), bucket("DEV_2", 1)],
  });
  const anita = out.find((n) => n.id === "TL_A")!;
  assert.equal(anita.count, 0);
  assert.deepEqual(
    anita.children.map((c) => c.count),
    [3, 1],
  );
});

test("everybody in the closure appears, including those carrying nothing", () => {
  /* "Nobody has given this person anything" is the finding an audit is for,
     and a control that hides them cannot report it. */
  const out = buildPersonFilter({
    scope: "organisation",
    viewerId: "CEO",
    reporting: REPORTING,
    employees: EMPLOYEES,
    buckets: [],
  });
  assert.deepEqual(personIdsIn(out).sort(), [
    "DEV_1",
    "DEV_2",
    "DEV_3",
    "SOLO",
    "TL_A",
    "TL_B",
  ]);
});

test("hierarchy scope walks down from the viewer, not from the top", () => {
  const out = buildPersonFilter({
    scope: "hierarchy",
    viewerId: "TL_A",
    reporting: REPORTING,
    employees: EMPLOYEES,
    buckets: [],
  });
  assert.deepEqual(personIdsIn(out).sort(), ["DEV_1", "DEV_2"]);
});

test("an organisation-scoped viewer outside the tree still sees the company", () => {
  /* A system administrator holds the scope from a role rather than a position,
     so nobody reports to them and the walk down finds nothing. */
  const out = buildPersonFilter({
    scope: "organisation",
    viewerId: "ADMIN",
    reporting: REPORTING,
    employees: [...EMPLOYEES, { id: "ADMIN", displayName: "Admin" }],
    buckets: [],
  });
  assert.deepEqual(names(out), ["Chief"]);
  assert.deepEqual(names(out[0].children), [
    "Anita Lead",
    "Bruno Lead",
    "Solo Worker",
  ]);
});

test("hierarchy scope does NOT fall back to the whole company", () => {
  /* The fallback is organisation-only. Widening it here would hand somebody
     reach their permission does not carry. */
  assert.deepEqual(
    buildPersonFilter({
      scope: "hierarchy",
      viewerId: "DEV_1",
      reporting: REPORTING,
      employees: EMPLOYEES,
      buckets: [],
    }),
    [],
  );
});

/* ── Robustness ───────────────────────────────────────────────────────────── */

test("a cycle in the tree terminates instead of recursing forever", () => {
  const looped: ReportingNode[] = [
    node("A", null, ["B"]),
    node("B", "A", ["C"]),
    node("C", "B", ["A"]),
  ];
  const out = buildPersonFilter({
    scope: "organisation",
    viewerId: "TOP",
    reporting: [node("TOP", null, ["A"]), ...looped],
    employees: [
      { id: "A", displayName: "A" },
      { id: "B", displayName: "B" },
      { id: "C", displayName: "C" },
      { id: "TOP", displayName: "Top" },
    ],
    buckets: [],
  });
  assert.deepEqual(personIdsIn(out), ["A", "B", "C"]);
});

test("somebody no name can be found for is dropped, not rendered blank", () => {
  const out = buildPersonFilter({
    scope: "direct_reports",
    viewerId: "TL_A",
    reporting: REPORTING,
    employees: [{ id: "DEV_1", displayName: "Dev One" }],
    buckets: [],
  });
  assert.deepEqual(names(out), ["Dev One"]);
});

test("the roll-up can name somebody the directory read has not returned", () => {
  const out = buildPersonFilter({
    scope: "direct_reports",
    viewerId: "TL_A",
    reporting: REPORTING,
    employees: [],
    buckets: [bucket("DEV_2", 1)],
  });
  assert.deepEqual(names(out), ["Dev Two"]);
});

test("nothing is offered while permissions or the viewer are still loading", () => {
  assert.deepEqual(
    buildPersonFilter({
      scope: null,
      viewerId: "CEO",
      reporting: REPORTING,
      employees: EMPLOYEES,
      buckets: [],
    }),
    [],
  );
  assert.deepEqual(
    buildPersonFilter({
      scope: "organisation",
      viewerId: null,
      reporting: REPORTING,
      employees: EMPLOYEES,
      buckets: [],
    }),
    [],
  );
});

/* ── Opening the tree onto a selection ────────────────────────────────────── */

test("pathTo names every branch that must be open to reveal a person", () => {
  const out = buildPersonFilter({
    scope: "organisation",
    viewerId: "CEO",
    reporting: REPORTING,
    employees: EMPLOYEES,
    buckets: [],
  });
  assert.deepEqual(pathTo(out, "DEV_3"), ["TL_B", "DEV_3"]);
  assert.deepEqual(pathTo(out, "TL_A"), ["TL_A"]);
  assert.deepEqual(pathTo(out, "NOBODY"), []);
});
