import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accessSummary,
  departmentOf,
  isInHrSystem,
  profileCan,
  type LegacyProfile,
} from "./profile.ts";
import { readIdentity } from "./auth.ts";
import { readEmployee, readHierarchy } from "./employees.ts";

function profile(over: Partial<LegacyProfile> = {}): LegacyProfile {
  return {
    identity: readIdentity({
      authUid: "u", employeeId: "E001", role: "employee", name: "Rakesh",
      tempPassword: null, passwordChanged: true,
    }),
    employee: readEmployee({ employeeId: "E001", name: "Rakesh", department: "QC" }),
    hierarchy: readHierarchy("E001", { primaryManager: { biometricId: "M1", name: "Maya" } }),
    problems: [],
    ...over,
  };
}

test("the department comes from the directory row", () => {
  assert.equal(departmentOf(profile()), "QC");
  assert.equal(departmentOf(profile({ employee: null })), null);
});

test("a missing HR record is detectable, and is not the same as no manager", () => {
  /* The engine reports both as a success. A screen that does not check renders
     "no managers" for somebody whose HR record is simply absent. */
  const absent = profile({
    hierarchy: readHierarchy("E001", {
      success: true, primaryManager: null, message: "Employee not found in HR system",
    }),
  });
  assert.equal(isInHrSystem(absent), false);

  const noManager = profile({
    hierarchy: readHierarchy("E001", { success: true, primaryManager: null }),
  });
  assert.equal(isInHrSystem(noManager), true, "in HR, genuinely has no manager");
});

test("a profile with no hierarchy at all is not in HR", () => {
  assert.equal(isInHrSystem(profile({ hierarchy: null })), false);
});

test("access follows the engine's role predicates", () => {
  const employee = profile();
  assert.equal(profileCan(employee, "employee"), true);
  assert.equal(profileCan(employee, "ceo_or_tl"), false);
  assert.equal(profileCan(employee, "ceo"), false);

  const tl = profile({
    identity: readIdentity({
      authUid: "u", employeeId: "E9", role: "tl", name: "Maya",
      tempPassword: null, passwordChanged: true,
    }),
  });
  assert.equal(profileCan(tl, "ceo_or_tl"), true);
  assert.equal(profileCan(tl, "ceo"), false);

  const ceo = profile({
    identity: readIdentity({
      authUid: "u", employeeId: "E000", role: "ceo", name: "Owner",
      tempPassword: null, passwordChanged: true,
    }),
  });
  assert.equal(profileCan(ceo, "ceo"), true);
});

test("nobody is signed in means nothing is allowed", () => {
  assert.equal(profileCan(null, "employee"), false);
  assert.equal(profileCan(null, "public"), false, "no identity, no answer");
});

test("the access summary answers in surface terms, and marks each gate", () => {
  /* The question somebody asks is "can I see the directory", not "am I a TL". */
  const lines = accessSummary(profile());
  const directory = lines.find((l) => l.label.includes("directory"))!;
  assert.equal(directory.gate, "ceo_or_tl");
  assert.equal(directory.allowed, false);
  assert.equal(lines.find((l) => l.label.includes("Sign in"))!.allowed, true);
});

test("a CEO is allowed everything the summary lists", () => {
  const ceo = profile({
    identity: readIdentity({
      authUid: "u", employeeId: "E000", role: "ceo", name: "Owner",
      tempPassword: null, passwordChanged: true,
    }),
  });
  assert.equal(accessSummary(ceo).every((l) => l.allowed), true);
});

test("an unrecognised role is treated as an ordinary employee", () => {
  /* Matching the engine: anything that is not "ceo" or "tl" falls through. */
  const odd = profile({
    identity: readIdentity({
      authUid: "u", employeeId: "E5", role: "superadmin", name: "X",
      tempPassword: null, passwordChanged: true,
    }),
  });
  assert.equal(profileCan(odd, "ceo"), false);
  assert.equal(profileCan(odd, "employee"), true);
});
