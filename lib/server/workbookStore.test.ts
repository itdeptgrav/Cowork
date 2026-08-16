import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createWorkbook } from "@/lib/spreadsheet/model";
import { serializeWorkbook } from "@/lib/spreadsheet/persistence";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import {
  FileWorkbookStore,
  WorkbookConflict,
  roleAllows,
  type ShareRole,
} from "@/lib/server/workbookStore";

let counter = 0;
function freshStore() {
  const path = join(tmpdir(), `cowork-wb-test-${process.pid}-${Date.now()}-${counter++}.json`);
  return { store: new FileWorkbookStore(path), cleanup: () => rm(path, { force: true }) };
}

const sampleData = () => serializeWorkbook(createWorkbook(), new StyleRegistry());

test("create then load round-trips a workbook, owned by its creator", async () => {
  const { store, cleanup } = freshStore();
  try {
    const created = await store.create({ ownerId: "u1", title: "Budget", data: sampleData() });
    assert.match(created.id, /^wb-/);
    assert.equal(created.revision, 1);

    const loaded = await store.load(created.id);
    assert.equal(loaded?.title, "Budget");
    assert.equal(loaded?.ownerId, "u1");
    assert.deepEqual(loaded?.data, created.data);
    assert.equal(await store.load("wb-nope"), null, "an unknown id loads null");
  } finally {
    await cleanup();
  }
});

test("save bumps the revision and stores new content; a stale base revision conflicts", async () => {
  const { store, cleanup } = freshStore();
  try {
    const created = await store.create({ ownerId: "u1", title: "S", data: sampleData() });
    const next = sampleData();
    next.sheets[0].cells.push({ ref: "A1", value: "42" });

    const saved = await store.save({ id: created.id, data: next, baseRevision: created.revision });
    assert.equal(saved?.revision, 2);
    assert.equal((await store.load(created.id))?.data.sheets[0].cells[0]?.value, "42");

    // A second save built on the OLD revision is refused.
    await assert.rejects(
      () => store.save({ id: created.id, data: next, baseRevision: 1 }),
      (e) => e instanceof WorkbookConflict && e.currentRevision === 2,
    );
    // Saving a workbook that does not exist returns null.
    assert.equal(await store.save({ id: "wb-gone", data: next, baseRevision: 1 }), null);
  } finally {
    await cleanup();
  }
});

test("rename changes the title; delete removes it", async () => {
  const { store, cleanup } = freshStore();
  try {
    const created = await store.create({ ownerId: "u1", title: "Old", data: sampleData() });
    const renamed = await store.rename(created.id, "New name");
    assert.equal(renamed?.title, "New name");
    assert.equal((await store.load(created.id))?.title, "New name");

    assert.equal(await store.remove(created.id), true);
    assert.equal(await store.load(created.id), null);
    assert.equal(await store.remove(created.id), false, "removing twice is false");
  } finally {
    await cleanup();
  }
});

test("listForOwner returns ONLY the owner's workbooks (authorization boundary)", async () => {
  const { store, cleanup } = freshStore();
  try {
    await store.create({ ownerId: "u1", title: "A", data: sampleData() });
    await store.create({ ownerId: "u1", title: "B", data: sampleData() });
    const otherOwned = await store.create({ ownerId: "u2", title: "C", data: sampleData() });

    const mine = await store.listForPrincipal("u1");
    assert.deepEqual(mine.map((w) => w.title).sort(), ["A", "B"]);
    assert.ok(!mine.some((w) => w.id === otherOwned.id), "u2's workbook is not in u1's list");

    // The listing carries no content — only metadata.
    assert.ok(!("data" in mine[0]));
    assert.deepEqual(await store.listForPrincipal("u3"), [], "a user with none lists nothing");
  } finally {
    await cleanup();
  }
});

test("a shared workbook appears in the recipient's list, stamped with their role", async () => {
  const { store, cleanup } = await freshStore();
  try {
    const wb = await store.create({ ownerId: "u1", title: "Shared", data: sampleData() });
    await store.setShares(wb.id, [{ principalId: "u2", role: "viewer" }]);

    const owners = await store.listForPrincipal("u1");
    assert.equal(owners[0].access, "owner");

    const theirs = await store.listForPrincipal("u2");
    assert.equal(theirs.length, 1);
    assert.equal(theirs[0].id, wb.id);
    assert.equal(theirs[0].access, "viewer", "the recipient sees their own standing");

    assert.deepEqual(await store.listForPrincipal("u3"), [], "a stranger still sees nothing");
  } finally {
    await cleanup();
  }
});

test("shares dedupe per principal, and the owner can never be demoted by a grant", async () => {
  const { store, cleanup } = await freshStore();
  try {
    const wb = await store.create({ ownerId: "u1", title: "S", data: sampleData() });
    const updated = await store.setShares(wb.id, [
      { principalId: "u2", role: "viewer" },
      { principalId: "u2", role: "editor" }, // last wins
      { principalId: "u1", role: "viewer" }, // the owner — must be ignored
    ]);
    assert.deepEqual(updated?.shares, [{ principalId: "u2", role: "editor" }]);
    /* The owner still lists it as owner, not as the viewer they "granted". */
    assert.equal((await store.listForPrincipal("u1"))[0].access, "owner");
  } finally {
    await cleanup();
  }
});

test("clearing every share makes a workbook private again", async () => {
  const { store, cleanup } = await freshStore();
  try {
    const wb = await store.create({ ownerId: "u1", title: "S", data: sampleData() });
    await store.setShares(wb.id, [{ principalId: "u2", role: "editor" }]);
    assert.equal((await store.listForPrincipal("u2")).length, 1);

    const cleared = await store.setShares(wb.id, []);
    assert.equal(cleared?.shares, undefined, "no empty array left behind");
    assert.deepEqual(await store.listForPrincipal("u2"), [], "access is gone");
  } finally {
    await cleanup();
  }
});

test("roleAllows ranks the three roles, and setShares drops an unknown one", async () => {
  assert.equal(roleAllows("editor", "viewer"), true);
  assert.equal(roleAllows("viewer", "editor"), false);
  assert.equal(roleAllows("commenter", "commenter"), true);

  const { store, cleanup } = await freshStore();
  try {
    const wb = await store.create({ ownerId: "u1", title: "S", data: sampleData() });
    const updated = await store.setShares(wb.id, [
      { principalId: "u2", role: "admin" as unknown as ShareRole }, // not a role
    ]);
    assert.equal(updated?.shares, undefined, "an unrecognised role is never granted");
  } finally {
    await cleanup();
  }
});
