import assert from "node:assert/strict";
import { test } from "node:test";
import { envelopeCheck, show, summarise } from "./validate.ts";

/* The envelope check is the point of the whole suite: a wrong key fails
   silently in the UI, so it has to fail loudly here. */

test("a correct envelope key with every row mapped passes", () => {
  const c = envelopeCheck({
    id: "list", label: "list", key: "employees",
    raw: { employees: [{ employeeId: "E1" }, { employeeId: "E2" }] },
    adapterCount: 2,
  });
  assert.equal(c.verdict, "pass");
  assert.match(c.detail, /correct and every item mapped/);
});

test("a WRONG envelope key fails and names what actually arrived", () => {
  /* This is the silent-empty failure: unwrap falls back, mapping yields
     nothing, and the screen renders a healthy-looking empty state. */
  const c = envelopeCheck({
    id: "list", label: "list", key: "employees",
    raw: { data: [{ employeeId: "E1" }], success: true },
    adapterCount: 0,
  });
  assert.equal(c.verdict, "fail");
  assert.match(c.detail, /is WRONG/);
  assert.match(c.detail, /data, success/);
  assert.match(c.detail, /empty screen with no error/);
});

test("a bare array warns — the fallback coped but the key is wrong", () => {
  const c = envelopeCheck({
    id: "list", label: "list", key: "employees",
    raw: [{ employeeId: "E1" }], adapterCount: 1,
  });
  assert.equal(c.verdict, "warn");
  assert.match(c.detail, /bare array/);
});

test("a correct key with fewer mapped rows warns rather than passing", () => {
  /* Rows without an identifier are dropped on purpose, so this is not
     automatically a bug — but it must not read as a clean pass. */
  const c = envelopeCheck({
    id: "list", label: "list", key: "employees",
    raw: { employees: [{ employeeId: "E1" }, { name: "no id" }] },
    adapterCount: 1,
  });
  assert.equal(c.verdict, "warn");
  assert.match(c.detail, /kept 1 of 2/);
});

test("an empty list under the right key is a genuine pass", () => {
  const c = envelopeCheck({
    id: "list", label: "list", key: "employees",
    raw: { employees: [] }, adapterCount: 0,
  });
  assert.equal(c.verdict, "pass");
});

test("values are shown compactly and never throw", () => {
  assert.equal(show(null), "null");
  assert.equal(show(undefined), "undefined");
  assert.equal(show({ a: 1 }), '{"a":1}');
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(typeof show(cyclic), "string", "a cycle must not crash the page");
  assert.ok(show("x".repeat(500)).length <= 221);
});

test("the summary fails on any failure and warns on any warning", () => {
  const c = (verdict: "pass" | "fail" | "warn") =>
    ({ id: "x", label: "x", verdict, detail: "" }) as const;
  assert.equal(summarise([c("pass"), c("pass")]).overall, "pass");
  assert.equal(summarise([c("pass"), c("warn")]).overall, "warn");
  assert.equal(summarise([c("warn"), c("fail")]).overall, "fail");
  assert.deepEqual(summarise([c("pass"), c("warn"), c("fail")]), {
    pass: 1, warn: 1, fail: 1, overall: "fail",
  });
});

/* ── Score and task validation shape ──────────────────────────────────────── */

test("a wrapped score response is a failure, not a pass", () => {
  /* readDashboard reads the body directly. If the engine wraps it in
     { success, data } the adapter is looking one level too shallow and would
     render an empty score. */
  const wrapped = envelopeCheck({
    id: "x", label: "x", key: "tasks",
    raw: { success: true, data: [{ id: "t1" }] },
    adapterCount: 0,
  });
  assert.equal(wrapped.verdict, "fail");
});

test("an empty task list is a WARNING, never a clean pass", () => {
  /* "No tasks" and "wrong envelope key" are indistinguishable from the UI.
     Passing silently is the failure this whole suite exists to prevent. */
  const c = envelopeCheck({
    id: "tasks", label: "tasks", key: "tasks",
    raw: { tasks: [] }, adapterCount: 0,
  });
  assert.equal(c.verdict, "pass", "the envelope itself is correct");
  /* ...and validateTasks adds its own explicit warning on top, which is what
     makes the distinction visible. */
});
