import assert from "node:assert/strict";
import { test } from "node:test";
import {
  directReports,
  readEmployee,
  readEmployees,
  readHierarchy,
  readManager,
  reportingChain,
} from "./employees.ts";
import { readIdentity } from "./auth.ts";
import {
  allDesignations,
  readDepartment,
  unknownDepartments,
} from "./departments.ts";
import {
  allows,
  gateRefusal,
  isCeo,
  isCeoOrTl,
  isForbiddenPath,
  readRole,
  tlSharesDepartment,
} from "./permissions.ts";

/* ── Identity ─────────────────────────────────────────────────────────────── */

test("the identity carries the engine's employee id, which is the biometric id", () => {
  const id = readIdentity({
    authUid: "uid-1", employeeId: "E001", role: "tl", name: "Maya",
    tempPassword: null, passwordChanged: true,
  });
  assert.equal(id.employeeId, "E001");
  assert.equal(id.role, "tl");
  assert.equal(id.mustChangePassword, false);
});

test("passwordChanged:false forces a password change", () => {
  /* Legacy blocks the app until it is changed. A UI that ignores this lets
     somebody work in a state the engine considers incomplete. */
  const id = readIdentity({
    authUid: "u", employeeId: "E002", role: "employee", name: "Rakesh",
    tempPassword: "temp123", passwordChanged: false,
  });
  assert.equal(id.mustChangePassword, true);
});

/* ── Permissions — legacy's three predicates ──────────────────────────────── */

test("an unrecognised role reads as the least privilege", () => {
  /* Legacy's own predicates behave this way: anything not "ceo" or "tl" falls
     through to the employee case. A role we do not recognise must never be
     treated as more powerful than one we do. */
  assert.equal(readRole("admin"), "employee");
  assert.equal(readRole(undefined), "employee");
  assert.equal(readRole(null), "employee");
  assert.equal(isCeo("admin"), false);
  assert.equal(isCeoOrTl("superuser"), false);
});

test("the gates match verifyCeoToken and verifyCeoOrTL", () => {
  assert.equal(allows("ceo", "ceo"), true);
  assert.equal(allows("ceo", "tl"), false);
  assert.equal(allows("ceo_or_tl", "tl"), true);
  assert.equal(allows("ceo_or_tl", "employee"), false);
  assert.equal(allows("employee", "employee"), true);
  assert.equal(allows("public", undefined), true);
});

test("refusals use legacy's exact wording", () => {
  /* What the UI predicts and what the network returns must be the same
     sentence — otherwise a support conversation quotes one and sees the other. */
  assert.equal(gateRefusal("ceo", "tl"), "CEO only");
  assert.equal(gateRefusal("ceo_or_tl", "employee"), "CEO or TL only");
  assert.equal(gateRefusal("ceo", "ceo"), null);
});

test("a TL is confined to their own department, a CEO is not", () => {
  /* The one real scope check in the model — POST /cowork/sop/bleach. */
  assert.equal(tlSharesDepartment({ actorRole: "tl", actorDepartment: "QC", targetDepartment: "QC" }), true);
  assert.equal(tlSharesDepartment({ actorRole: "tl", actorDepartment: "QC", targetDepartment: "Sales" }), false);
  assert.equal(tlSharesDepartment({ actorRole: "ceo", actorDepartment: null, targetDepartment: "Sales" }), true);
});

test("a missing department never grants access", () => {
  assert.equal(tlSharesDepartment({ actorRole: "tl", actorDepartment: null, targetDepartment: null }), false);
});

test("the unauthenticated debug routes are refused by path", () => {
  assert.equal(isForbiddenPath("/cowork/task/force-repair-self-assign"), true);
  assert.equal(isForbiddenPath("/cowork/task/self-assign-debug/E001"), true);
  assert.equal(isForbiddenPath("/cowork/task/create"), false);
});

/* ── Directory ────────────────────────────────────────────────────────────── */

test("an employee reads from the Firestore document", () => {
  const e = readEmployee({
    employeeId: "E001", name: " Maya ", email: "maya@x.com",
    department: "QC", role: "tl", passwordChanged: true,
  })!;
  assert.equal(e.employeeId, "E001");
  assert.equal(e.name, "Maya");
  assert.equal(e.department, "QC");
  assert.equal(e.role, "tl");
  assert.equal(e.pendingFirstSignIn, false);
});

test("the document id stands in when employeeId is absent", () => {
  /* The engine seeds the CEO at document id E000, where the two are the same. */
  assert.equal(readEmployee({ id: "E000", name: "CEO" })!.employeeId, "E000");
});

test("a row with no identifier is dropped, not rendered as a person", () => {
  assert.equal(readEmployee({ name: "Nobody" }), null);
  assert.deepEqual(readEmployees([{ name: "Nobody" }, { employeeId: "E1" }]).length, 1);
});

test("a name falls back to the id rather than rendering blank", () => {
  assert.equal(readEmployee({ employeeId: "E007" })!.name, "E007");
});

test("pendingFirstSignIn is true only on an explicit false", () => {
  /* Absent means the engine has nothing to say, not that the person is stuck. */
  assert.equal(readEmployee({ employeeId: "E1" })!.pendingFirstSignIn, false);
  assert.equal(
    readEmployee({ employeeId: "E1", passwordChanged: false })!.pendingFirstSignIn,
    true,
  );
});

/* ── Hierarchy ────────────────────────────────────────────────────────────── */

test("a manager needs a biometric id to be usable", () => {
  assert.equal(readManager({ name: "Ghost" }), null);
  assert.equal(readManager(null), null);
  assert.equal(readManager({ biometricId: "E9", name: "Asha" })!.name, "Asha");
});

test("designation falls back to jobTitle", () => {
  /* Legacy carries designation, jobPosition and jobTitle for one fact. */
  const m = readManager({ biometricId: "E9", jobTitle: "Head of QC" })!;
  assert.equal(m.designation, "Head of QC");
});

test("missing from HR is a distinct state from having no managers", () => {
  /* The endpoint returns success either way. Rendering both as "no managers"
     tells somebody their reporting line is empty when their HR record is
     actually absent — different words are needed. */
  const absent = readHierarchy("E001", {
    success: true, primaryManager: null, message: "Employee not found in HR system",
  });
  assert.equal(absent.inHrSystem, false);
  assert.equal(absent.primaryManager, null);

  const present = readHierarchy("E002", { success: true, primaryManager: null });
  assert.equal(present.inHrSystem, true, "in HR, genuinely has no manager");
});

test("direct reports come from PRIMARY lines only", () => {
  /* A secondary manager is an additional relationship, not a second reporting
     line — matching closureOf() and legacy's effective behaviour. */
  const hierarchies = [
    readHierarchy("E1", { primaryManager: { biometricId: "M1" } }),
    readHierarchy("E2", { primaryManager: { biometricId: "M1" } }),
    readHierarchy("E3", { secondaryManager: { biometricId: "M1" } }),
    readHierarchy("E4", { primaryManager: { biometricId: "M2" } }),
  ];
  assert.deepEqual(directReports({ managerId: "M1", hierarchies }), ["E1", "E2"]);
});

test("somebody reporting to themselves is not their own report", () => {
  const hierarchies = [readHierarchy("M1", { primaryManager: { biometricId: "M1" } })];
  assert.deepEqual(directReports({ managerId: "M1", hierarchies }), []);
});

test("the reporting chain walks upward, nearest first", () => {
  const hierarchies = [
    readHierarchy("E1", { primaryManager: { biometricId: "M1" } }),
    readHierarchy("M1", { primaryManager: { biometricId: "M2" } }),
    readHierarchy("M2", { primaryManager: { biometricId: "CEO" } }),
  ];
  assert.deepEqual(reportingChain({ employeeId: "E1", hierarchies }), ["M1", "M2", "CEO"]);
});

test("a cycle terminates instead of hanging the browser", () => {
  /* Legacy has NO constraint against cycles or self-reporting. This guard is
     the documented state of the data, not defensive programming. */
  const hierarchies = [
    readHierarchy("A", { primaryManager: { biometricId: "B" } }),
    readHierarchy("B", { primaryManager: { biometricId: "A" } }),
  ];
  assert.deepEqual(reportingChain({ employeeId: "A", hierarchies }), ["B"]);

  const selfLoop = [readHierarchy("A", { primaryManager: { biometricId: "A" } })];
  assert.deepEqual(reportingChain({ employeeId: "A", hierarchies: selfLoop }), []);
});

/* ── Departments ──────────────────────────────────────────────────────────── */

test("a department reads, defaulting to active", () => {
  /* `status` has a schema default of "active", so absent means active. */
  const d = readDepartment({ _id: "d1", name: " QC " })!;
  assert.equal(d.name, "QC");
  assert.equal(d.isActive, true);
  assert.equal(readDepartment({ _id: "d2", name: "Old", status: "inactive" })!.isActive, false);
});

test("designations carry a manager count, not the manager records", () => {
  /* The nested records are not the reporting hierarchy — offering them would
     give a second, conflicting answer to "who manages whom". */
  const d = readDepartment({
    _id: "d1", name: "QC",
    designations: [{ name: "Inspector", managers: [{}, {}] }, { name: "Lead" }],
  })!;
  assert.deepEqual(d.designations.map((x) => x.managerCount), [2, 0]);
});

test("a department with no name is dropped", () => {
  assert.equal(readDepartment({ _id: "d1" }), null);
});

test("active designations are collected across departments, deduplicated", () => {
  /* Designation determines the scoring band, so the full set is needed to spot
     a designation nobody has banded. */
  const depts = [
    readDepartment({ _id: "1", name: "QC", designations: [{ name: "Lead" }, { name: "Inspector" }] })!,
    readDepartment({ _id: "2", name: "Sales", designations: [{ name: "Lead" }, { name: "Retired", isActive: false }] })!,
  ];
  assert.deepEqual(allDesignations(depts), ["Inspector", "Lead"]);
});

test("departments named on employees but absent from the master are reported", () => {
  /* Reporting, never repair — the two stores join on a free string, so silently
     creating the missing one would write to HR on the strength of a typo. */
  const depts = [readDepartment({ _id: "1", name: "QC" })!];
  assert.deepEqual(
    unknownDepartments({ departments: depts, employeeDepartments: ["QC", "qc", "Sales", null, "  "] }),
    ["Sales"],
  );
});
