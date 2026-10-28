/**
 * Your profile shows your email, mobile, city and reporting line (27 Oct 2026).
 *
 * Mobile and city were on every `cowork_employees` record and read by nobody;
 * the reporting line was already resolved for score visibility and never
 * shown. These hold the path from the record to the page, and that a
 * colleague's profile still does not show their phone or city.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { readEmployee } from "./employees.ts";
import { toEmployee } from "../repositories/legacy/map.ts";

test("mobile and city travel from the employee record to the employee", () => {
  const row = readEmployee({
    employeeId: "GR0000",
    name: "RISHEE RAY",
    email: "ray@grav.in",
    mobile: " 9000000000 ",
    city: "Bhubaneswar ",
    department: "Corporate",
    role: "ceo",
  })!;
  const e = toEmployee(row);
  assert.equal(e.email, "ray@grav.in");
  assert.equal(e.mobile, "9000000000");
  assert.equal(e.city, "Bhubaneswar");
});

test("a record without them reads as absent, not as an empty string", () => {
  const e = toEmployee(readEmployee({ employeeId: "GR0001", name: "A B" })!);
  assert.equal(e.mobile, null);
  assert.equal(e.city, null);
});

test("your profile shows them and your reporting line; a colleague's does not show phone or city", () => {
  const own = readFileSync("components/features/settings/UserAreas.tsx", "utf8");
  for (const label of ["Email", "Mobile", "City"]) assert.match(own, new RegExp(`<Row label="${label}"`));
  assert.match(own, /<ReportingPanel employeeId=\{p\.id\} \/>/);
  assert.match(own, /r\.listReportingLines\(\)/);
  const colleague = readFileSync("components/features/team/TeamArea.tsx", "utf8");
  assert.doesNotMatch(colleague, /p\.mobile|p\.city/);
});

test("the help article describes the profile", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /id: "general-profile-details"/);
});
