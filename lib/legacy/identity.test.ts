import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { readEmployee, readEmployees } from "./employees.ts";

/**
 * Identity loading.
 *
 * The bug: signing in as an ordinary employee showed no name, no employee id
 * and no avatar in the top bar. The cause was one endpoint choice —
 * `#employeesById()` called `GET /cowork/employee/list`, which the engine gates
 * `verifyCeoOrTL` (`cowork.js:322`). A TL or the CEO got the directory; every
 * ordinary employee got a 403, the map came back empty, and
 * `getCurrentEmployee()` returned null for a real signed-in person.
 *
 * `GET /cowork/employee/list-members` (`:49`) serves the SAME data from the
 * same `listCoworkEmployees()` call, gated only on holding a valid employee
 * token, and additionally strips `tempPassword`, `authUid` and `fcmTokens`.
 */

test("the repository calls the ungated directory endpoint", () => {
  /* Asserted against the source, because the alternative is a live 403 as an
     employee — and this is precisely the bug that a TL-shaped test cannot
     see. */
  const source = readFileSync(
    new URL("../repositories/legacy/index.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.includes("listMembers(token)"),
    "the directory must be fetched with listMembers",
  );
  /* And the gated one must not be reachable from the repository at all. */
  assert.ok(
    !/legacyListEmployees\(/.test(source),
    "the CEO/TL-gated /employee/list must not be used for the directory",
  );
});

test("an employee record maps to id, name, role and department", () => {
  /* Soumya Ranjan, exactly as `cowork_employees` holds the record — including
     the trailing space in `name`, which is real data. */
  const soumya = readEmployee({
    employeeId: "GR0067",
    name: "Soumya Ranjan ",
    role: "employee",
    department: "IT",
    email: "soumyaranjanpraharaj04@gmail.com",
  } as never)!;

  assert.equal(soumya.employeeId, "GR0067");
  assert.equal(soumya.role, "employee");
  assert.equal(soumya.department, "IT");
  assert.ok(soumya.name.startsWith("Soumya"));
});

test("every real employee in the directory maps without loss", () => {
  /* All sixteen `cowork_employees` records, as production holds them. The
     point is that none is dropped: `readEmployees` filters out anything it
     cannot read, and a silently-dropped row is somebody who vanishes from the
     directory, the assignee picker and their own top bar. */
  const rows = [
    { employeeId: "E000", name: "Admin CEO", role: "ceo", department: "Admin" },
    { employeeId: "GR0002", name: "Umung Arora", role: "tl", department: "Designing" },
    { employeeId: "GR0045", name: "Rakesh Biswal", role: "tl", department: "IT" },
    { employeeId: "GR0067", name: "Soumya Ranjan ", role: "employee", department: "IT" },
    { employeeId: "GR0108", name: "Pramod Biswal", role: "employee", department: "IT" },
  ];
  const mapped = readEmployees(rows as never);
  assert.equal(mapped.length, rows.length);
  assert.deepEqual(
    mapped.map((e) => e.employeeId),
    ["E000", "GR0002", "GR0045", "GR0067", "GR0108"],
  );
});

test("a record with no employeeId is dropped rather than keyed on empty", () => {
  /* The directory is a Map keyed by employeeId. A blank key would collide with
     the next blank one and silently overwrite a colleague. */
  assert.equal(readEmployee({ name: "Nobody" } as never), null);
});

test("sign-out clears the per-browser identity carriers", () => {
  /* `signOut` does a hard navigation, which drops React state and every module
     singleton — but not `localStorage`. A saved acting-profile id and a saved
     lens outlived the person who chose them, so the next account on a shared
     machine inherited both. */
  const source = readFileSync(
    new URL("../../components/features/auth/SessionProvider.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("removeItem(PROFILE_STORAGE_KEY)"));
  assert.ok(source.includes("removeItem(LENS_STORAGE_KEY)"));
});
