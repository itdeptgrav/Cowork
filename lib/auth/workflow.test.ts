import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approverChain,
  resolveStage,
  resolveWorkflow,
  workflowFor,
} from "./workflow.ts";
import {
  employees as seedEmployees,
  roles as seedRoles,
  departments as seedDepartments,
  reporting as seedReporting,
  workflows as seedWorkflows,
} from "../seed/seed.ts";
import type { ResolveContext } from "./workflow.ts";
import type {
  ApprovalStage,
  ApprovalWorkflow,
  Employee,
} from "../domain/index.ts";

/**
 * The approval engine, locked.
 *
 * The behaviour that matters most here is the one the old `for (i < 3)` walk
 * got wrong: a chain that cannot find an approver must SAY SO, not quietly
 * finish early. A silently shortened chain means work reached "fully approved"
 * having passed fewer gates than the process required.
 */

function emp(id: string, name: string, dept: string | null): Employee {
  return {
    organisationId: "org-test",
    id,
    isFounder: false,
    userId: `u-${id}`,
    employeeCode: id,
    firstName: name,
    lastName: "X",
    displayName: name,
    email: null,
    initials: name.slice(0, 2),
    hue: 0,
    profilePictureUrl: null,
    departmentId: dept,
    departmentName: dept,
    designation: null,
    roleIds: [],
    timezone: "UTC",
    workCalendarId: "cal",
    joinedAt: "2025-01-01",
    exitedAt: null,
  };
}

function rel(employeeId: string, managerId: string) {
  return {
    organisationId: "org-test",
    id: `${employeeId}-${managerId}`,
    employeeId,
    managerId,
    type: "primary" as const,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    createdBy: "sys",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

/*  ana → bo → cy      Product has a head (cy). Platform has none.  */
const CTX: ResolveContext = {
  employees: [
    emp("ana", "Ana", "product"),
    emp("bo", "Bo", "product"),
    emp("cy", "Cy", "product"),
    emp("di", "Di", "platform"),
  ],
  reporting: [rel("ana", "bo"), rel("bo", "cy"), rel("di", "cy")],
  departments: [
    {
      organisationId: "org-test",
      id: "product",
      name: "Product",
      hodEmployeeId: "cy",
      parentDepartmentId: null,
      isActive: true,
    },
    {
      organisationId: "org-test",
      id: "platform",
      name: "Platform",
      hodEmployeeId: null,
      parentDepartmentId: null,
      isActive: true,
    },
  ],
  roles: [],
};

function stage(
  id: string,
  name: string,
  order: number,
  rule: ApprovalStage["rule"],
  extra: Partial<ApprovalStage> = {},
): ApprovalStage {
  return {
    id,
    name,
    order,
    rule,
    levelsUp: null,
    roleId: null,
    employeeId: null,
    onUnresolved: "block",
    allowOverride: false,
    ...extra,
  };
}

function wf(
  id: string,
  stages: ApprovalStage[],
  extra: Partial<ApprovalWorkflow> = {},
): ApprovalWorkflow {
  return {
    organisationId: "org-test",
    id,
    name: id,
    description: "",
    trigger: "task_completion",
    stages,
    appliesTo: { departmentIds: [], crossDepartmentOnly: false },
    order: 10,
    isActive: true,
    isSystem: false,
    ...extra,
  };
}

test("the four-stage chain the owner described resolves end to end", () => {
  const flow = wf("w", [
    stage("s1", "Supervisor", 1, "reporting_manager", { levelsUp: 1 }),
    stage("s2", "HOD", 2, "department_hod"),
    stage("s3", "Manager", 3, "reporting_manager", { levelsUp: 2 }),
  ]);
  const { chain, blockedBy } = approverChain(CTX, flow, "ana");
  assert.equal(blockedBy, null);
  // bo is the supervisor; cy is both the HOD and two levels up, so it appears once.
  assert.deepEqual(chain, ["bo", "cy"]);
});

test("one person satisfying two stages is asked once, not twice", () => {
  const flow = wf("w", [
    stage("s1", "HOD", 1, "department_hod"),
    stage("s2", "Manager", 2, "reporting_manager", { levelsUp: 2 }),
  ]);
  assert.deepEqual(approverChain(CTX, flow, "ana").chain, ["cy"]);
});

test("a department with no head falls back to the person's own manager", () => {
  /* Legacy resolved this as a chain — `resolveDepartmentApprover` tried the
     department's lead, then the person's `primaryManager`, then a default
     approver, and hard-failed only when all were absent. Stopping at the first
     link turned one unfilled field on a department record into a refusal for
     everybody in it. */
  const flow = wf("w", [
    stage("s1", "HOD", 1, "department_hod"),
    stage("s2", "Manager", 2, "reporting_manager", { levelsUp: 1 }),
  ]);
  // Di is in Platform, which has no head — but Di reports to Cy.
  const { chain, blockedBy, stages } = approverChain(CTX, flow, "di");
  assert.equal(blockedBy, null, "a reachable manager is not a dead end");
  assert.equal(stages[0].approverId, "cy");
  assert.equal(
    stages[0].resolvedVia,
    "manager",
    "recorded as a stand-in, not as a head of department",
  );
  assert.ok(chain.includes("cy"));
});

test("a genuine dead end still blocks, and says what is missing", () => {
  /* The fallback must not become a way for work to pass ungated. Somebody in a
     headless department who also reports to nobody has no approver at any link
     in the chain, and that has to stop rather than quietly resolve. */
  const orphan = emp("orphan", "Orphan", "platform");
  const ctx: ResolveContext = {
    ...CTX,
    employees: [...CTX.employees, orphan],
    /* no reporting row for `orphan` */
  };
  const flow = wf("w", [stage("s1", "HOD", 1, "department_hod")]);
  const { chain, blockedBy } = approverChain(ctx, flow, "orphan");
  assert.ok(blockedBy, "the dead end is reported");
  assert.match(
    blockedBy?.unresolvedReason ?? "",
    /no head of department, and nobody in it has a manager/i,
  );
  assert.deepEqual(chain, [], "nothing is approvable until it is configured");
});

test("a stage set to skip continues past an unresolved approver", () => {
  const flow = wf("w", [
    stage("s1", "HOD", 1, "department_hod", { onUnresolved: "skip" }),
    stage("s2", "Manager", 2, "reporting_manager", { levelsUp: 1 }),
  ]);
  const { chain, blockedBy } = approverChain(CTX, flow, "di");
  assert.equal(blockedBy, null);
  assert.deepEqual(chain, ["cy"], "the skipped stage drops out, the rest runs");
});

test("nobody is ever their own approver", () => {
  const flow = wf("w", [stage("s1", "HOD", 1, "department_hod")]);
  // Cy IS the head of Product, so the stage resolves to themselves.
  const [resolved] = resolveWorkflow(CTX, flow, "cy");
  assert.equal(resolved.approverId, null);
  assert.match(resolved.unresolvedReason ?? "", /their own approver/i);
});

test("running out of reporting levels is named, not silently ignored", () => {
  const flow = wf("w", [
    stage("s1", "Skip", 1, "reporting_manager", { levelsUp: 3 }),
  ]);
  const [resolved] = resolveWorkflow(CTX, flow, "ana");
  assert.equal(resolved.approverId, null);
  assert.match(resolved.unresolvedReason ?? "", /fewer than 3 levels/i);
});

/* ── Selection ────────────────────────────────────────────────────────────── */

test("the most specific matching workflow wins", () => {
  const general = wf("general", [], { order: 1 });
  const departmental = wf("dept", [], {
    order: 99,
    appliesTo: { departmentIds: ["product"], crossDepartmentOnly: false },
  });
  const picked = workflowFor([general, departmental], "task_completion", {
    departmentId: "product",
  });
  assert.equal(
    picked?.id,
    "dept",
    "a workflow naming the department beats a lower-order general one",
  );
});

test("a cross-department workflow does not match same-department work", () => {
  const cross = wf("cross", [], {
    appliesTo: { departmentIds: [], crossDepartmentOnly: true },
  });
  assert.equal(
    workflowFor([cross], "task_completion", { crossDepartment: false }),
    null,
  );
  assert.equal(
    workflowFor([cross], "task_completion", { crossDepartment: true })?.id,
    "cross",
  );
});

test("selection is deterministic when everything else ties", () => {
  const a = wf("a", []);
  const b = wf("b", []);
  assert.equal(workflowFor([b, a], "task_completion")?.id, "a");
  assert.equal(
    workflowFor([a, b], "task_completion")?.id,
    "a",
    "input order never changes the answer — legacy's unordered limit(1) did",
  );
});

test("an inactive workflow is never selected", () => {
  const off = wf("off", [], { isActive: false });
  assert.equal(workflowFor([off], "task_completion"), null);
});

test("no matching workflow means an empty chain, not a crash", () => {
  const { chain, stages, blockedBy } = approverChain(CTX, null, "ana");
  assert.deepEqual(chain, []);
  assert.deepEqual(stages, []);
  assert.equal(blockedBy, null);
});

/* ── Consent stages versus review stages ──────────────────────────────────── */

/** The real fixture, so this fails if the seeded workflow or the HODs move. */
function seedResolveCtx(): ResolveContext {
  return {
    employees: seedEmployees,
    roles: seedRoles,
    departments: seedDepartments,
    reporting: seedReporting,
  };
}

test("the receiver is never asked to approve their own intake", () => {
  /* The bug this pins. Hanne (Operations) assigns to Maya (Product). Maya HEADS
     Product, so a chain routed to the receiving department's head asked Maya to
     approve work being sent to Maya. Being sent work is not authority over
     being sent it.

     Routing to MANAGERS instead: Hanne's manager consents to the work leaving,
     the receiver's manager consents to it arriving, and the receiver is not in
     the chain at all. */
  const wf = seedWorkflows.find((w) => w.trigger === "cross_department")!;
  const plan = approverChain(seedResolveCtx(), wf, "e-05", "product", "e-01");

  assert.ok(
    !plan.chain.includes("e-01"),
    "Maya is the assignee and must not approve her own intake",
  );
  assert.equal(plan.blockedBy, null);
  assert.deepEqual(
    plan.stages.map((st) => st.rule),
    ["reporting_manager", "target_reporting_manager"],
  );
});

test("self-approval still blocks where the stage reviews work", () => {
  /* The exception must not leak. A stage that did not opt in keeps the strict
     rule — legacy defect P1, the one thing that survives every configuration. */
  const reviewStage: ApprovalStage = {
    id: "st-test",
    name: "Manager review",
    order: 1,
    rule: "department_hod",
    levelsUp: null,
    roleId: null,
    employeeId: null,
    onUnresolved: "block",
    allowOverride: false,
  };
  const resolved = resolveStage(seedResolveCtx(), reviewStage, "e-01");
  assert.equal(resolved.selfSatisfied, false);
  assert.equal(resolved.blocked, true);
  assert.match(resolved.unresolvedReason ?? "", /their own approver/);
});

/* ── Cross-department lifecycle ───────────────────────────────────────────── */

/* ── Cross-department routing: managers, not heads ────────────────────────── */

test("an employee's crossing asks both managers, sender first", () => {
  /* Tobias (Product) → Idris (Platform). Tobias reports to Maya; Idris reports
     to Renata. The sending manager consents to the work leaving, then the
     receiving manager to it arriving. */
  const wf = seedWorkflows.find((w) => w.trigger === "cross_department")!;
  const plan = approverChain(seedResolveCtx(), wf, "e-02", "platform", "e-04");
  assert.deepEqual(plan.chain, ["e-01", "e-03"], "Maya, then Renata");
  assert.equal(plan.blockedBy, null);
});

test("the side of an approval comes from its stage, not its position", () => {
  /* `createTask` labelled the first chain entry "sender" and the rest
     "receiver" — true only while every stage resolves. The rule on the stage is
     the durable answer. */
  const wf = seedWorkflows.find((w) => w.trigger === "cross_department")!;
  const plan = approverChain(seedResolveCtx(), wf, "e-02", "platform", "e-04");
  const receiving = plan.stages.find(
    (st) => st.rule === "target_reporting_manager",
  );
  assert.equal(receiving?.approverId, "e-03", "Idris's manager, not Tobias's");
  assert.equal(plan.stages[0].rule, "reporting_manager");
});

test("ownership, reporting line and approval stay three separate answers", () => {
  /* Hanne (Operations) → Maya (Product):
       ownership → the sender's department, Operations
       reporting → nothing; Maya is not beneath Hanne
       approval  → the two managers, neither of whom is Maya */
  const wf = seedWorkflows.find((w) => w.trigger === "cross_department")!;
  const plan = approverChain(seedResolveCtx(), wf, "e-05", "product", "e-01");
  assert.ok(!plan.chain.includes("e-01"), "the receiver is not an authority");
  assert.ok(
    !plan.chain.includes("e-05"),
    "the requester is not their own approver",
  );
  assert.ok(plan.chain.length > 0, "somebody must still agree");
});

test("neither approval stage ever resolves to the assignee", () => {
  /* Maya (Product) → Hanne (Operations). Hanne HEADS Operations, so a receiving
     stage routed to the department head asked the assignee to approve her own
     intake — and the effort stage that follows did the same, independently.
     Both must route to the receiver's MANAGER instead. */
  const wf = seedWorkflows.find((w) => w.trigger === "cross_department")!;
  const plan = approverChain(
    seedResolveCtx(),
    wf,
    "e-01",
    "operations",
    "e-05",
  );
  assert.ok(
    !plan.chain.includes("e-05"),
    "Hanne is the assignee and must not appear in her own approval chain",
  );
  assert.ok(plan.chain.length > 0, "somebody must still agree");
});

test("both sides are asked, and one person may satisfy both", () => {
  /* Maya and Hanne both report to Priya, so the sending and receiving stages
     resolve to the same person. `approverChain` dedupes rather than asking her
     twice — that is one approval covering two stages, not a stage being lost. */
  const wf = seedWorkflows.find((w) => w.trigger === "cross_department")!;
  const plan = approverChain(
    seedResolveCtx(),
    wf,
    "e-01",
    "operations",
    "e-05",
  );
  assert.deepEqual(
    plan.stages.map((st) => st.approverId),
    ["e-07", "e-07"],
  );
  assert.deepEqual(plan.chain, ["e-07"], "asked once, covering both stages");
  assert.equal(plan.stages.length, 2, "both stages still exist in the record");
});

test("a chain of distinct approvers does not terminate early", () => {
  /* Tobias → Idris resolves to two different managers. The second must remain
     `waiting`, not be dropped, so approving the first advances rather than
     completes. */
  const wf = seedWorkflows.find((w) => w.trigger === "cross_department")!;
  const plan = approverChain(seedResolveCtx(), wf, "e-02", "platform", "e-04");
  assert.deepEqual(plan.chain, ["e-01", "e-03"]);
  assert.equal(new Set(plan.chain).size, 2, "two people, two approvals");
});
