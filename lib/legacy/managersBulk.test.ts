import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The reporting tree, asked for once instead of once per person.
 *
 * There is no org chart in the engine — the only relationship surface answers
 * for ONE employee — so the tree has always been derived by asking everybody
 * and inverting the answers. That cost one request per person, in batches of
 * eight, rebuilt whenever the directory cache expired, in every open tab. The
 * bandwidth dashboard measured it: **288,406 calls in a week, about 1,717 an
 * hour**, for a set of answers that changes a handful of times a year.
 *
 * These pin the two things that make the fix safe rather than merely smaller:
 * the per-person path still exists and still works, and nothing about what the
 * tree CONTAINS depends on which path filled it.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const HIERARCHY = "lib/legacy/hierarchy.ts";
const REPO = "lib/repositories/legacy/index.ts";
const ROUTE = "D:/GRAV_Project/grav-cms-backend/routes/task_routes/cowork.js";

/* ─────────────────────────────── one request ────────────────────────────── */

test("the tree asks the engine once", () => {
  const src = code(REPO);
  assert.match(src, /const bulk = await fetchAllManagers\(\{ token \}\);/);
  assert.match(code(HIERARCHY), /path: "\/cowork\/employee\/my-managers-bulk"/);
});

test("the bulk reply is revalidated, so an unchanged tree costs a 304", () => {
  const src = code(HIERARCHY);
  const fn = src.slice(src.indexOf("export async function fetchAllManagers"));
  assert.match(fn.slice(0, 600), /revalidate: true/);
});

/* ──────────────────────── and the old path still works ──────────────────── */

test("asking one at a time is kept, not replaced", () => {
  /**
   * The bulk route is an addition. A deployment older than it answers 404, and
   * the tree must still build — otherwise shipping this ahead of the engine
   * would empty every reporting line in the product.
   */
  const src = code(REPO);
  assert.match(src, /fetchMyManagers\(\{ token, employeeId: id \}\)/);
  assert.match(src, /const BATCH = 8;/);
});

test("a bulk failure is a fallback, never an error", () => {
  /* `fetchAllManagers` returns null rather than a refusal precisely so the
     caller has one branch to write and cannot accidentally surface a 404 to
     somebody as a broken page. */
  const src = code(HIERARCHY);
  const fn = src.slice(src.indexOf("export async function fetchAllManagers"));
  assert.match(fn.slice(0, 1200), /if \(!r\.ok\) return null;/);
  assert.match(
    fn.slice(0, 400),
    /Promise<Map<string, LegacyManagers> \| null>/,
  );
});

/* ─────────────────── the two paths must agree about people ──────────────── */

test("somebody missing from the reply still gets an entry", () => {
  /**
   * Asking one at a time answers `success: true` with both managers null for
   * an employee absent from HR. Keying the map off the REPLY instead of off the
   * directory would drop those people from the tree entirely — a different
   * answer depending on which path ran, which is the one thing this must not
   * do.
   */
  const src = code(REPO);
  assert.match(src, /for \(const id of ids\)/);
  assert.match(
    src,
    /bulk\.get\(id\) \?\? \{ primaryManager: null, secondaryManager: null \}/,
  );
});

test("a named but unlinkable manager survives the bulk path", () => {
  /**
   * The engine falls back to a bare `managerName` when the reference is
   * missing, returning an empty `biometricId`. That is NOT the same as having
   * no manager: a tree cannot draw an edge to a name, but a profile still says
   * who somebody reports to. Collapsing the two would silently empty those
   * lines.
   */
  const route = readFileSync(ROUTE, "utf8");
  const fn = route.slice(route.indexOf("function _managerShape"));
  assert.match(fn.slice(0, 1400), /if \(side && side\.managerName\)/);
  assert.match(fn.slice(0, 1400), /biometricId: ""/);
});

test("the bulk route reports the same per-manager fields as the single one", () => {
  /* Two shapes for one answer is how the tree comes to differ depending on
     which path filled it. */
  const route = readFileSync(ROUTE, "utf8");
  const fn = route.slice(route.indexOf("function _managerShape"), route.indexOf("router.get(\n  \"/employee/my-managers-bulk\""));
  for (const field of [
    "name",
    "biometricId",
    "department",
    "designation",
    "phone",
    "email",
    "profilePhotoUrl",
  ]) {
    assert.match(fn, new RegExp(`\\b${field}:`), `bulk drops ${field}`);
  }
});

/* ────────────────────────── nothing else moved ──────────────────────────── */

test("the single-employee route is untouched", () => {
  const route = readFileSync(ROUTE, "utf8");
  assert.match(route, /router\.get\("\/employee\/my-managers\/:employeeId"/);
  assert.match(route, /console\.error\("\[my-managers\]", e\.message\)/);
});

test("the cache stamp and its expiry are unchanged", () => {
  /* The saving here is the NUMBER of requests, not how long an answer is kept.
     Changing the expiry as well would trade freshness for bytes, which is a
     different decision and not this one. */
  const src = code(REPO);
  assert.match(src, /this\.#peopleFetchedAtMs = Date\.now\(\);/);
  assert.match(src, /return buildReportingTree\(answers\);/);
});

test("the bulk route answers with an ETag, like its neighbour", () => {
  const route = readFileSync(ROUTE, "utf8");
  const handler = route.slice(route.indexOf('"/employee/my-managers-bulk"'));
  assert.match(
    handler.slice(0, 2000),
    /sendJsonCached\(req, res, \{ success: true, managers \}\)/,
  );
});
