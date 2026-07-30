import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  affectsDeadlines,
  auditEntry,
  describeField,
  diffFields,
} from "./audit.ts";
import { applySettingsChange } from "./service.ts";

/**
 * No settings change without a record of who made it.
 *
 * `setOfficePolicy` wrote the document and nothing else, so a change that moved
 * the expected completion of every live task left no trace of who moved it,
 * from what, or when.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const OFFICE = {
  schedule: {
    monday: { isOff: false, inTime: "09:30", outTime: "18:30" },
    tuesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  },
  breaks: [{ name: "Lunch", start: "13:00", end: "13:45" }],
};

/* ── What changed ─────────────────────────────────────────────────────────── */

test("only the fields that moved are recorded", () => {
  /* Recording the whole document makes "who changed Tuesday's closing time" a
     diffing exercise for whoever reads the log. */
  const after = {
    ...OFFICE,
    schedule: {
      ...OFFICE.schedule,
      tuesday: { isOff: false, inTime: "10:00", outTime: "19:00" },
    },
  };
  const fields = diffFields(OFFICE, after);
  assert.deepEqual(
    fields.map((f) => f.path),
    ["schedule.tuesday.inTime", "schedule.tuesday.outTime"],
  );
  assert.equal(fields[0].oldValue, "09:30");
  assert.equal(fields[0].newValue, "10:00");
  assert.equal(
    describeField(fields[1]),
    "schedule.tuesday.outTime: 18:30 → 19:00",
  );
});

test("a list is compared whole, not by index", () => {
  /* Removing the first of three holidays would otherwise report every entry
     after it as changed — true, and useless to read. */
  const before = { holidays: ["2026-08-15", "2026-10-02", "2026-12-25"] };
  const after = { holidays: ["2026-10-02", "2026-12-25"] };
  const fields = diffFields(before, after);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].path, "holidays");
});

test("saving without editing produces no entry", () => {
  /* A log full of "changed nothing" is a log nobody reads. */
  assert.equal(
    auditEntry({
      id: "a1",
      section: "office",
      changedById: "RAKESH",
      changedAt: "2026-07-30T10:00:00.000Z",
      before: OFFICE,
      after: { ...OFFICE },
    }),
    null,
  );
});

test("an entry names who, when, and both values", () => {
  const e = auditEntry({
    id: "a1",
    section: "office",
    changedById: "RAKESH",
    changedAt: "2026-07-30T10:00:00.000Z",
    before: OFFICE,
    after: {
      ...OFFICE,
      schedule: {
        ...OFFICE.schedule,
        monday: { isOff: false, inTime: "10:00", outTime: "19:00" },
      },
    },
    reason: "Shift change",
  })!;
  assert.equal(e.changedById, "RAKESH");
  assert.equal(e.changedAt, "2026-07-30T10:00:00.000Z");
  assert.equal(e.section, "office");
  assert.equal(e.reason, "Shift change");
  assert.equal(e.fields.length, 2);
  for (const f of e.fields) {
    assert.ok("oldValue" in f && "newValue" in f, "an entry lost a value");
  }
});

test("an unknown actor is recorded, not a reason to drop the entry", () => {
  const e = auditEntry({
    id: "a1",
    section: "office",
    changedById: null,
    changedAt: "2026-07-30T10:00:00.000Z",
    before: { a: 1 },
    after: { a: 2 },
  })!;
  assert.equal(e.changedById, "");
  assert.equal(e.fields.length, 1);
});

/* ── The service ──────────────────────────────────────────────────────────── */

const change = async (over: Record<string, unknown> = {}) => {
  const logged: unknown[] = [];
  const r = await applySettingsChange({
    section: "office",
    changedById: "RAKESH",
    changedAt: "2026-07-30T10:00:00.000Z",
    before: { open: "09:30" },
    after: { open: "10:00" },
    newId: () => "a1",
    write: async () => ({ ok: true }),
    log: async (e) => {
      logged.push(e);
    },
    ...over,
  });
  return { r, logged };
};

test("a successful change is written and logged", () => {
  return change().then(({ r, logged }) => {
    assert.equal(r.ok, true);
    assert.equal(logged.length, 1);
    assert.equal(r.entry?.fields[0].path, "open");
  });
});

test("a failed write logs nothing", async () => {
  /* A log claiming a change nobody can see is worse than a missing entry —
     somebody would trust it. */
  const { r, logged } = await change({
    write: async () => ({ ok: false, message: "Refused." }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Refused.");
  assert.equal(logged.length, 0);
  assert.equal(r.entry, null);
});

test("a write that lands with a failed log says so", async () => {
  /* The setting really did change. Pretending otherwise would leave the system
     describing itself wrongly, so the caller is told which half succeeded. */
  const { r } = await change({
    log: async () => {
      throw new Error("no");
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.unlogged, true);
  assert.equal(r.entry, null);
});

test("an unchanged save writes nothing at all", async () => {
  let wrote = false;
  const { r, logged } = await change({
    after: { open: "09:30" },
    write: async () => {
      wrote = true;
      return { ok: true };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(wrote, false, "an unchanged save still wrote");
  assert.equal(logged.length, 0);
});

/* ── Confirmation ─────────────────────────────────────────────────────────── */

test("changes that move deadlines are flagged for confirmation", () => {
  /* Saving office hours moves the expected completion of every live task. That
     is not something to discover afterwards from a log. */
  assert.equal(
    affectsDeadlines([{ path: "schedule.monday.outTime", oldValue: 1, newValue: 2 }]),
    true,
  );
  assert.equal(
    affectsDeadlines([{ path: "holidays", oldValue: [], newValue: ["x"] }]),
    true,
  );
  assert.equal(
    affectsDeadlines([{ path: "breaks", oldValue: [], newValue: ["x"] }]),
    true,
  );
  assert.equal(
    affectsDeadlines([{ path: "companyName", oldValue: "a", newValue: "b" }]),
    false,
  );
});

/* ── Access ───────────────────────────────────────────────────────────────── */

test("only an administrator archetype may open the admin area", () => {
  /* Read from source: `session.ts` imports `next/headers`, which the test
     runner cannot resolve. The predicate is one expression and pinning it here
     is the difference between "admins only" and "anybody with a session". */
  const src = code("lib/server/session.ts");
  /* It DELEGATES now — one definition, in `lib/rules/admin/access.ts`. It used
     to answer here with `system_admin || people_ops` while the settings
     repository separately inferred an administrator from `legacyRole`. */
  assert.match(src, /return canAccessAdminConsole\(\{ archetype \}\);/);
  assert.equal(
    /archetype === "people_ops"/.test(
      src.slice(src.indexOf("export function mayOpenAdmin")),
    ),
    false,
    "people_ops may open admin again",
  );
});

test("the gate is a SERVER component, not a client one", () => {
  /* A client guard ships the page, runs its queries and then renders a refusal
     over data it has already fetched. */
  const src = code("app/admin/layout.tsx");
  assert.match(src, /export default async function AdminLayout/);
  /* `adminConsoleAccess` rather than `currentSession` directly: the latter reads
     only the `cowork_session` cookie, which the Firebase sign-in path never
     issues — so asking it alone made `/admin` unreachable for every real
     employee. It still asks that question first, one layer down. */
  assert.match(src, /await adminConsoleAccess\(\)/);
  assert.match(src, /if \(!mayOpenConsole\) redirect/);
  assert.equal(
    src.includes('"use client"'),
    false,
    "the admin gate became a client component",
  );
});
