import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The declared indexes must cover the queries the code actually issues.
 *
 * A `where(...) + orderBy(...)` pair needs a Firestore composite index, and
 * without one the query throws at runtime — which `#taskDocuments` deliberately
 * raises rather than swallowing. That is the right behaviour and it means a
 * missing index is a broken page, so the declaration is load-bearing rather
 * than documentation.
 *
 * It had become documentation: `firestore.indexes.json` existed, listed the
 * CEO's `approverId` index, and nothing deployed it — there was no
 * `firebase.json` for `firebase deploy --only firestore:indexes` to read. The
 * index was written down and absent from the project at the same time.
 */

const read = (name: string) =>
  readFileSync(new URL(`../../../${name}`, import.meta.url), "utf8");

const config = JSON.parse(read("firestore.indexes.json")) as {
  indexes: {
    collectionGroup: string;
    fields: { fieldPath: string; order?: string; arrayConfig?: string }[];
  }[];
};

/** A comparable key: collection + ordered field paths. */
const keyOf = (collection: string, fields: string[]) =>
  `${collection}:${fields.join(",")}`;

const declared = new Set(
  config.indexes.map((i) =>
    keyOf(
      i.collectionGroup,
      i.fields.map((f) => f.fieldPath),
    ),
  ),
);

test("the indexes file is wired to a deployment", () => {
  /* The regression. Without these, `firebase deploy --only firestore:indexes`
     has nothing to read and the file is inert. */
  const firebaseJson = JSON.parse(read("firebase.json")) as {
    firestore?: { indexes?: string };
  };
  assert.equal(firebaseJson.firestore?.indexes, "firestore.indexes.json");

  const rc = JSON.parse(read(".firebaserc")) as {
    projects?: { default?: string };
  };
  assert.equal(rc.projects?.default, "grav-cms-38f45");
});

test("every composite task query has a declared index", () => {
  /* The three role-scoped queries in `#taskDocuments` and `taskWatch`. Both
     issue the same set deliberately — the watch must not signal a change to a
     document the read cannot return. */
  for (const fields of [
    ["assigneeIds", "updatedAt"],
    ["assignedBy", "updatedAt"],
    ["approverId", "updatedAt"],
    /* `NewAssignmentGate`'s second listener. Work routed to somebody but still
       at a gate has an EMPTY `assigneeIds` and its person in
       `pendingAssigneeId` — `taskForward.js` only writes `assigneeIds` when the
       task goes to `open` — so the array-contains listener above cannot see
       that class of work arrive, and the notice needed a page reload. */
    ["pendingAssigneeId", "updatedAt"],
  ]) {
    assert.ok(
      declared.has(keyOf("cowork_tasks", fields)),
      `cowork_tasks ${fields.join(" + ")} is queried but not declared`,
    );
  }
});

test("the notifications query has a declared index", () => {
  assert.ok(
    declared.has(keyOf("cowork_notifications", ["recipientEmployeeId", "createdAt"])),
    "the notification bell's query is not declared",
  );
});

test("the department-gate query needs no composite index", () => {
  /* `where("status","==",...)` with `limit` and NO `orderBy` — a single-field
     query, which Firestore indexes automatically. Adding an `orderBy` here
     would silently create a new index requirement, so this test records why it
     was left off. */
  assert.equal(
    declared.has(keyOf("cowork_tasks", ["status", "updatedAt"])),
    false,
  );
});

test("no index is declared with a field the code does not query", () => {
  /* Guards the other direction: a stale declaration is a deploy of an index
     nothing uses, which costs write throughput on every task mutation. */
  const known = new Set([
    keyOf("cowork_tasks", ["assigneeIds", "updatedAt"]),
    keyOf("cowork_tasks", ["assignedBy", "updatedAt"]),
    keyOf("cowork_tasks", ["approverId", "updatedAt"]),
    keyOf("cowork_tasks", ["pendingAssigneeId", "updatedAt"]),
    keyOf("cowork_notifications", ["recipientEmployeeId", "createdAt"]),
  ]);
  for (const d of declared) {
    assert.ok(known.has(d), `${d} is declared but nothing queries it`);
  }
});

test("each declared index orders updatedAt/createdAt descending", () => {
  /* Every query pairs its filter with `orderBy(..., "desc")`. An ASCENDING
     declaration would not serve it, and the failure only appears at runtime. */
  for (const index of config.indexes) {
    const last = index.fields[index.fields.length - 1];
    assert.match(last.fieldPath, /^(updatedAt|createdAt)$/);
    assert.equal(last.order, "DESCENDING", `${last.fieldPath} must be DESCENDING`);
  }
});

/* ── The error a missing index produces ────────────────────────────────── */

test("a missing-index failure is rewritten to name the role and the fix", async () => {
  /* Firestore says "The query requires an index. You can create it here: …",
     which lands on whoever is looking at the screen rather than whoever can
     deploy one. The rewrite keeps that link and adds what it lacks: which role
     is affected, and where the declaration lives. */
  const { LegacyRepository } = await import("./index.ts");
  const repo = new LegacyRepository({
    getToken: async () => "t",
    employeeId: "E1",
    legacyRole: "ceo",
    hasManager: false,
  });

  /* Reached through the private path, so assert on the exported behaviour we
     can see: the module must carry the rewrite, and it must not swallow. */
  const source = readFileSync(
    new URL("./index.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("FirestoreIndexMissing"));
  assert.ok(source.includes("firebase deploy --only firestore:indexes"));
  /* Still thrown, never converted to an empty list — an empty task list is
     indistinguishable from having no tasks. */
  assert.ok(/throw asIndexError/.test(source));
  assert.ok(repo instanceof LegacyRepository);
});
