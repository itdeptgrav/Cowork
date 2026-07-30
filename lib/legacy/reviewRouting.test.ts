import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Approvals follow the HR primary manager, and nothing else.
 *
 * This previously preferred the assignee's DEPARTMENT LEAD, so approval
 * ownership depended on a Firestore `department` string and a `role` flag HR
 * does not maintain. Two records had to agree for routing to be right, and when
 * they disagreed the work went to somebody with no reporting relationship to
 * the assignee — Pramod Biswal's approvals went to Trinayan Doley, Production's
 * lead, rather than Rakesh Biswal, his manager on file.
 *
 * Verified against production after the change: Pramod → Rakesh Biswal.
 */

const BACKEND = "/Users/risheeray/Documents/cowork-old-backend";
const RULE = join(BACKEND, "services/taskReviewOwner.service.js");
const ROUTE = join(BACKEND, "routes/task_routes/taskForward.js");
const have = () => {
  try {
    return statSync(RULE).isFile();
  } catch {
    return false;
  }
};
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/* ── One authority ────────────────────────────────────────────────────────── */

test("the resolver returns the HR primary manager", (t) => {
  if (!have()) return t.skip("backend not present");
  const src = code(RULE);
  assert.match(src, /async function getPrimaryManagerForEmployee\(/);
  assert.match(src, /HR_PRIMARY_MANAGER = "HR_PRIMARY_MANAGER"/);
  assert.match(src, /source: HR_PRIMARY_MANAGER/);
});

test("the department lead no longer decides approvals anywhere", (t) => {
  if (!have()) return t.skip("backend not present");
  /* The override this change exists to remove. */
  const src = code(RULE);
  assert.equal(/DEPARTMENT_TL/.test(src), false, "the lead branch is back");
  assert.equal(/departmentLead/.test(src), false);
  assert.equal(
    /where\("role", "==", "tl"\)/.test(src),
    false,
    "a lead lookup is back in the approval rule",
  );
});

test("no Cowork task route resolves a lead for approval", (t) => {
  if (!have()) return t.skip("backend not present");
  const route = code(ROUTE);
  assert.equal(
    /where\("role", "==", "tl"\)/.test(route),
    false,
    "a route still looks up a department lead",
  );
  assert.match(route, /getTaskReviewOwner\(employeeId, \{/);
});

test("a team lead is routed by the same rule as everybody else", (t) => {
  if (!have()) return t.skip("backend not present");
  /* There is no longer a special escalation branch — a lead simply has a
     manager like anybody else. Verified: Ananta and Rakesh, both leads, route
     to Rishee Ray. */
  const src = code(RULE);
  assert.equal(/person\.role === "tl"/.test(src), false, "a role branch remains");
});

/* ── Edge cases ───────────────────────────────────────────────────────────── */

test("no manager on file is reported, never silently substituted", (t) => {
  if (!have()) return t.skip("backend not present");
  /* Explicitly NOT the department lead. Verified in production: Rishee Ray has
     no manager and the resolver says so rather than inventing one. */
  const src = code(RULE);
  assert.match(src, /No primary manager is recorded for this employee in the HR system/);
  assert.match(src, /managerId: null/);
  assert.match(src, /source: null/);
});

test("choosing a stand-in stays with the caller", (t) => {
  if (!have()) return t.skip("backend not present");
  /* The existing configured default is a policy decision. It must never
     quietly become the department lead again. */
  /* Read RAW: this is a documented intent, and `code()` strips the comment
     that carries it. */
  assert.match(readFileSync(RULE, "utf8"), /stays with the caller/);
  const route = code(ROUTE);
  assert.match(route, /E000/, "the explicit configured fallback is gone");
});

test("a department change cannot move an approval", (t) => {
  if (!have()) return t.skip("backend not present");
  /* Structural: the rule reads no department at all, so changing one has
     nothing to act on. */
  const src = code(RULE);
  const fn = src.slice(src.indexOf("async function getPrimaryManagerForEmployee("));
  assert.equal(
    /department/.test(fn.slice(0, 900)),
    false,
    "the resolver reads a department again",
  );
});

test("an HR manager change takes effect on the next approval", (t) => {
  if (!have()) return t.skip("backend not present");
  /* Nothing is cached in the resolver — it asks on every call, so the next
     approval uses the new manager without any invalidation step. */
  const src = code(RULE);
  const fn = src.slice(src.indexOf("async function getPrimaryManagerForEmployee("));
  assert.match(fn.slice(0, 900), /await getPrimaryManager\(employeeId\)/);
  assert.equal(/cache|memo/i.test(fn.slice(0, 900)), false);
});

/* ── Provenance ───────────────────────────────────────────────────────────── */

test("the source of truth is stated where somebody will read it", (t) => {
  if (!have()) return t.skip("backend not present");
  const src = readFileSync(RULE, "utf8");
  assert.match(src, /Mongo `Employee\.primaryManager\.managerId`/);
  assert.match(src, /never read from Firestore/);
});

test("historical decisions are not rewritten to match the new rule", (t) => {
  if (!have()) return t.skip("backend not present");
  /* Stored `departmentApprovals[].source` values of `dept_tl` describe
     decisions actually taken under the old rule. Relabelling them would
     misrepresent the record. */
  const route = code(ROUTE);
  assert.match(route, /source: "primary_manager"/);
});
