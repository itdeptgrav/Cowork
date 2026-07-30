import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NEEDS_HR_TOKEN,
  NEEDS_PER_EMPLOYEE_CALL,
  available,
  departmentCounts,
  filterRows,
  toRow,
} from "./directory.ts";
import { readEmployee } from "./employees.ts";

const emp = (over: Record<string, unknown> = {}) =>
  readEmployee({
    employeeId: "E001", name: "Maya", email: "maya@grav.in",
    department: "QC", role: "tl", ...over,
  })!;

test("a row carries what the Cowork directory actually stores", () => {
  const row = toRow(emp());
  assert.equal(row.employeeId, "E001");
  assert.equal(row.name, "Maya");
  assert.equal(row.department, "QC");
  assert.equal(row.role, "tl");
  assert.equal(row.pendingFirstSignIn, false);
});

test("fields legacy does not store are marked unavailable, never invented", () => {
  /* cowork_employees carries no designation, no manager and no employment
     status. Rendering a blank cell would read as "none"; naming the source
     reads as "not here". */
  const row = toRow(emp());
  assert.equal(row.designation.available, false);
  assert.equal(row.reportingManager.available, false);
  assert.equal(row.employmentStatus.available, false);
  assert.match(
    row.designation.available === false ? row.designation.source : "",
    /HR/,
  );
});

test("designation and employment status name the HR sign-in as their source", () => {
  /* They need the other token entirely — a different auth system, not just a
     different endpoint. */
  assert.equal(toRow(emp()).designation, NEEDS_HR_TOKEN);
  assert.equal(toRow(emp()).employmentStatus, NEEDS_HR_TOKEN);
});

test("the reporting manager is a per-employee call, not an HR-token one", () => {
  /* Legacy offers no bulk manager lookup, so a list showing managers would make
     one request per row. */
  assert.equal(toRow(emp()).reportingManager, NEEDS_PER_EMPLOYEE_CALL);
});

test("pending first sign-in is not employment status", () => {
  /* Conflating them would report somebody as inactive because they had not yet
     changed a temporary password. */
  const pending = toRow(emp({ passwordChanged: false }));
  assert.equal(pending.pendingFirstSignIn, true);
  assert.equal(pending.employmentStatus.available, false, "still unknown");
});

test("an available field carries its value", () => {
  const field = available("Head of QC");
  assert.equal(field.available, true);
  assert.equal(field.value, "Head of QC");
});

/* ── Search ───────────────────────────────────────────────────────────────── */

test("search matches the fields somebody would actually type", () => {
  const rows = [
    toRow(emp()),
    toRow(emp({ employeeId: "E002", name: "Rakesh", department: "Sales", email: "r@grav.in" })),
  ];
  assert.equal(filterRows(rows, "maya").length, 1);
  assert.equal(filterRows(rows, "E002").length, 1);
  assert.equal(filterRows(rows, "sales").length, 1, "case-insensitive");
  assert.equal(filterRows(rows, "grav.in").length, 2);
  assert.equal(filterRows(rows, "").length, 2, "empty query returns everything");
  assert.equal(filterRows(rows, "   ").length, 2);
  assert.equal(filterRows(rows, "nobody").length, 0);
});

test("search survives rows with missing fields", () => {
  const rows = [toRow(emp({ department: undefined, email: undefined }))];
  assert.equal(filterRows(rows, "maya").length, 1);
  assert.equal(filterRows(rows, "qc").length, 0);
});

/* ── Department counts ────────────────────────────────────────────────────── */

test("departments are counted from the people actually in them", () => {
  /* A different question from "which departments exist" — that is the HR
     master, and the difference between the two is real data drift. */
  const rows = [
    toRow(emp({ employeeId: "E1", department: "QC" })),
    toRow(emp({ employeeId: "E2", department: "QC" })),
    toRow(emp({ employeeId: "E3", department: "Sales" })),
  ];
  assert.deepEqual(departmentCounts(rows), [
    { name: "QC", count: 2 },
    { name: "Sales", count: 1 },
  ]);
});

test("people with no department are grouped, not dropped", () => {
  const rows = [
    toRow(emp({ employeeId: "E1", department: undefined })),
    toRow(emp({ employeeId: "E2", department: "QC" })),
  ];
  const counts = departmentCounts(rows);
  assert.deepEqual(counts.find((c) => c.name === "No department"), {
    name: "No department",
    count: 1,
  });
});

test("equal counts sort alphabetically so the order is stable", () => {
  const rows = [
    toRow(emp({ employeeId: "E1", department: "Sales" })),
    toRow(emp({ employeeId: "E2", department: "QC" })),
  ];
  assert.deepEqual(departmentCounts(rows).map((c) => c.name), ["QC", "Sales"]);
});
