import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  buildReportingTree,
  readAllManagers,
  type LegacyManagers,
} from "./hierarchy.ts";

/**
 * Does the bulk path actually produce the same tree? — RUN, not read.
 *
 * The companion file pins the wiring by reading source text. This one executes
 * the real functions against fixtures, because the risk that matters is not
 * "was the code written" but "does it answer the same".
 *
 * The fixtures cover the three states a reporting line can be in, all of which
 * exist in the engine's data:
 *
 *   · linked      — a real reference, so the tree can draw an edge
 *   · named only  — the reference is missing and a bare name survives
 *   · none        — no manager, or the person is absent from HR entirely
 */

/* ── The people ──────────────────────────────────────────────────────────── */

const CEO = "GR0001";
const HEAD = "GR0002";
const STAFF = "GR0003";
/** In the Cowork directory, absent from HR — the engine answers both null. */
const NO_HR = "GR0004";
/** Reports to a person who exists only as a name on their record. */
const ORPHAN = "GR0005";

const IDS = [CEO, HEAD, STAFF, NO_HR, ORPHAN];

function manager(id: string, name: string) {
  return {
    name,
    biometricId: id,
    department: "Operations",
    designation: "Manager",
    email: `${id.toLowerCase()}@grav.in`,
    profilePhotoUrl: null,
  };
}

/** Named but unlinkable, exactly as the engine returns it: empty id. */
const NAMED_ONLY = {
  name: "Someone Not In Mongo",
  biometricId: "",
  department: "",
  designation: "",
  email: "",
  profilePhotoUrl: null,
};

const NOBODY: LegacyManagers = {
  primaryManager: null,
  secondaryManager: null,
};

/* What each person's managers are, whichever way they are fetched. */
const TRUTH: Record<string, LegacyManagers> = {
  [CEO]: NOBODY,
  [HEAD]: { primaryManager: manager(CEO, "Chief Exec"), secondaryManager: null },
  [STAFF]: {
    primaryManager: manager(HEAD, "Dept Head"),
    secondaryManager: manager(CEO, "Chief Exec"),
  },
  [NO_HR]: NOBODY,
  [ORPHAN]: { primaryManager: NAMED_ONLY, secondaryManager: null },
};

/* ── The two paths, as the repository builds them ────────────────────────── */

/** Asking one at a time: an answer per person, absent ones read as nobody. */
function viaPerPerson(): Map<string, LegacyManagers> {
  const answers = new Map<string, LegacyManagers>();
  for (const id of IDS) answers.set(id, TRUTH[id] ?? NOBODY);
  return answers;
}

/**
 * Asking once: the engine's reply, then keyed off the DIRECTORY — which is what
 * keeps somebody the engine has no row for in the tree.
 */
function viaBulk(reply: Record<string, LegacyManagers>): Map<string, LegacyManagers> {
  const bulk = readAllManagers(reply);
  assert.ok(bulk, "the reply did not shape");
  const answers = new Map<string, LegacyManagers>();
  for (const id of IDS) answers.set(id, bulk.get(id) ?? NOBODY);
  return answers;
}

/* ─────────────────────────── the thing that matters ─────────────────────── */

test("both paths build an identical tree", () => {
  const single = buildReportingTree(viaPerPerson());
  const bulk = buildReportingTree(viaBulk(TRUTH));
  assert.deepEqual(bulk, single);
});

test("...including when the engine omits people it has no row for", () => {
  /**
   * The engine returns a row only for employees it holds. Keying the map off
   * the REPLY would drop `NO_HR` from the tree entirely; keying it off the
   * directory keeps them, with no managers — which is exactly what asking for
   * them one at a time answers.
   */
  const partial = { ...TRUTH };
  delete partial[NO_HR];

  const single = buildReportingTree(viaPerPerson());
  const bulk = buildReportingTree(viaBulk(partial));
  assert.deepEqual(bulk, single);
});

test("a named-but-unlinkable manager survives, and draws no edge", () => {
  const tree = buildReportingTree(viaBulk(TRUTH));
  const orphan = tree.byEmployee.get(ORPHAN);
  assert.ok(orphan);
  assert.equal(orphan.managerId, null, "an empty id became an edge");
  assert.equal(orphan.managerName, "Someone Not In Mongo");
});

test("real reporting lines come through", () => {
  const tree = buildReportingTree(viaBulk(TRUTH));
  assert.equal(tree.byEmployee.get(STAFF)?.managerId, HEAD);
  assert.equal(tree.byEmployee.get(HEAD)?.managerId, CEO);
  assert.equal(tree.byEmployee.get(CEO)?.managerId, null);
  assert.deepEqual(tree.byEmployee.get(HEAD)?.directReportIds, [STAFF]);
  assert.equal(tree.byEmployee.get(STAFF)?.secondaryManagerId, CEO);
});

/* ───────────────────────────── malformed replies ────────────────────────── */

test("a reply that is not an object is refused, so the loop takes over", () => {
  for (const bad of [null, undefined]) {
    assert.equal(readAllManagers(bad), null);
  }
});

test("a junk row is skipped rather than shaped into a broken node", () => {
  const shaped = readAllManagers({
    [STAFF]: TRUTH[STAFF],
    [HEAD]: null as unknown as LegacyManagers,
    "": TRUTH[CEO],
  });
  assert.ok(shaped);
  assert.equal(shaped.size, 1, "a junk row was kept");
  assert.ok(shaped.has(STAFF));
});

test("a row missing one side reads as no manager on that side", () => {
  const shaped = readAllManagers({
    [STAFF]: { primaryManager: manager(HEAD, "Dept Head") } as LegacyManagers,
  });
  assert.equal(shaped?.get(STAFF)?.secondaryManager, null);
});

/* ──────────────── the engine's own shaping, executed ────────────────────── */

test("the backend builds each manager exactly as the single route does", () => {
  /**
   * `_managerShape` lives inside an Express router that cannot be imported here
   * — it pulls in mongoose models and a live connection. So the function's real
   * source is lifted out of the deployed file and RUN, which tests the code
   * that will actually answer rather than a copy of it.
   */
  const route = readFileSync(
    "D:/GRAV_Project/grav-cms-backend/routes/task_routes/cowork.js",
    "utf8",
  );
  const at = route.indexOf("function _managerShape");
  assert.ok(at > 0, "the bulk shaper is gone");
  const end = route.indexOf("\nrouter.get(", at);
  const src = route.slice(at, end);

  const shape = new Function(`${src}; return _managerShape;`)() as (
    side: unknown,
  ) => Record<string, unknown> | null;

  /* Linked: name assembled from the three parts, id and photo carried. */
  assert.deepEqual(
    shape({
      managerId: {
        firstName: "Asha",
        middleName: "",
        lastName: "Rao",
        biometricId: "GR0002",
        department: "Ops",
        designation: "",
        jobTitle: "Head",
        phone: "123",
        email: "asha@grav.in",
        profilePhoto: { url: "https://x/a.jpg" },
      },
    }),
    {
      name: "Asha Rao",
      biometricId: "GR0002",
      department: "Ops",
      designation: "Head",
      phone: "123",
      email: "asha@grav.in",
      profilePhotoUrl: "https://x/a.jpg",
    },
    "designation must fall back to jobTitle, as the single route does",
  );

  /* Named only: an EMPTY id, which is what stops the tree drawing an edge. */
  assert.deepEqual(shape({ managerName: "Plain Name" }), {
    name: "Plain Name",
    biometricId: "",
    department: "",
    designation: "",
    phone: "",
    email: "",
    profilePhotoUrl: null,
  });

  /* No manager at all, and an absent record. */
  assert.equal(shape({}), null);
  assert.equal(shape(null), null);
  assert.equal(shape(undefined), null);
});

test("a linked manager with no name parts falls back to the stored name", () => {
  const route = readFileSync(
    "D:/GRAV_Project/grav-cms-backend/routes/task_routes/cowork.js",
    "utf8",
  );
  const at = route.indexOf("function _managerShape");
  const src = route.slice(at, route.indexOf("\nrouter.get(", at));
  const shape = new Function(`${src}; return _managerShape;`)() as (
    side: unknown,
  ) => Record<string, unknown> | null;

  assert.equal(
    shape({
      managerName: "Stored Name",
      managerId: { biometricId: "GR0009" },
    })?.name,
    "Stored Name",
    "an empty populate must not produce a nameless manager",
  );
});
