/**
 * Inactive in HR = no Cowork access, nothing deleted (12 Oct 2026, owner).
 *
 * The engine refuses (grav-cms-backend services/coworkHrAccess.service.js);
 * these hold the app's half: the refusal is recognised and said in its own
 * words, an inactive directory row is "exited" (off every picker, still named
 * on old work), and the admin panel neither lists nor provisions them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  HR_INACTIVE_CODE,
  HR_INACTIVE_SIGN_IN_NOTICE,
  LOGIN_DISABLED_MESSAGE,
  HR_INACTIVE_ROW_LABEL,
  hrStatusQuery,
  isHrInactiveRefusal,
} from "./hrInactive.ts";
import { failure, readErrorCode } from "../../legacy/envelope.ts";
import { isInactiveDoc, readEmployee, readEmployees } from "../../legacy/employees.ts";
import { EXITED_DATE_UNKNOWN, toEmployee } from "../../repositories/legacy/map.ts";

const src = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the engine's refusal code rides on the error, and only a short code does", () => {
  const r = failure(403, { error: "Your account is inactive in HR…", code: "EMPLOYEE_INACTIVE" });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.kind, "permission");
    assert.equal(r.error.code, HR_INACTIVE_CODE);
    assert.equal(isHrInactiveRefusal(r.error), true);
  }
  const plain = failure(403, { error: "Employee not found in Firestore. Ask your CEO." });
  if (!plain.ok) {
    assert.equal(plain.error.code, undefined);
    assert.equal(isHrInactiveRefusal(plain.error), false);
  }
  assert.equal(readErrorCode({ code: "not a code <script>" }), undefined);
  assert.equal(readErrorCode("EMPLOYEE_INACTIVE"), undefined);
  assert.equal(isHrInactiveRefusal(null), false);
});

test("the words: what the person sees, and what a disabled login now means", () => {
  assert.match(HR_INACTIVE_SIGN_IN_NOTICE, /inactive in HR/);
  assert.match(HR_INACTIVE_SIGN_IN_NOTICE, /work and history are kept/);
  assert.match(LOGIN_DISABLED_MESSAGE, /Inactive in HR/);
  assert.equal(HR_INACTIVE_ROW_LABEL, "Inactive in HR · no access");
  assert.equal(hrStatusQuery("active"), undefined);
  assert.equal(hrStatusQuery("inactive"), "inactive");
  assert.equal(hrStatusQuery("all"), "all");
});

test("an inactive directory row is exited — still in the directory, so names still resolve", () => {
  const rows = readEmployees([
    { employeeId: "GR0124", name: "ASFIYA BATUL", status: "inactive", isActive: false, deactivatedAt: "2026-10-12T09:00:00.000Z" },
    { employeeId: "GR0121", name: "SANGEETA PRADHAN", isActive: false },
    { employeeId: "GR0099", name: "ANANTA PRASAD INDRAJIT" },
  ]);
  assert.equal(rows.length, 3, "nobody is dropped");
  const [a, b, c] = rows.map(toEmployee);
  assert.equal(a.exitedAt, "2026-10-12T09:00:00.000Z");
  assert.equal(a.displayName, "ASFIYA BATUL");
  assert.equal(b.exitedAt, EXITED_DATE_UNKNOWN);
  assert.equal(c.exitedAt, null);
  assert.equal(isInactiveDoc({ status: " Inactive " }), true);
  assert.equal(isInactiveDoc({ status: "active", isActive: true }), false);
  assert.equal(readEmployee({ employeeId: "E1" })!.inactive, false);
});

test("the session tells an HR-inactive refusal apart and leaves its own sentence", () => {
  const s = src("components/features/auth/SessionProvider.tsx");
  assert.match(s, /reason\?: "no-session" \| "refused" \| "inactive"/);
  assert.match(s, /isHrInactiveRefusal\(result\.error\) \? "inactive" : "refused"/);
  assert.match(s, /if \(data\.reason === "inactive"\) leaveSignInNotice\(HR_INACTIVE_SIGN_IN_NOTICE\)/);
  assert.match(src("components/features/auth/SignInForm.tsx"), /case "auth\/user-disabled":\s*return LOGIN_DISABLED_MESSAGE;/);
});

test("the admin panel lists people active in HR, and never offers an inactive one an account", () => {
  const p = src("components/features/admin/AddFromHrPanel.tsx");
  assert.match(p, /useState<HrStatusFilter>\("active"\)/);
  assert.match(p, /withoutAccount = visible\.filter\(\(e\) => !e\.hasCoworkAccount && !isHrInactive\(e\)\)/);
  assert.match(p, /!isHrInactive\(e\) &&\s*hrGaps\(e\)\.length === 0/);
  assert.match(p, /data-hr-inactive-row/);
  assert.match(p, /data-hr-status-filter/);
  /* An inactive row carries no action: the read-only branch returns before
     any Add / Send mail / Reset password is drawn. */
  const branch = p.slice(p.indexOf("if (isHrInactive(emp)) {"), p.indexOf("return (", p.indexOf("if (isHrInactive(emp)) {") + 40) + 2000);
  const row = branch.slice(0, branch.indexOf("</li>"));
  assert.doesNotMatch(row, /Reset password|Send mail|onClick/);
});
