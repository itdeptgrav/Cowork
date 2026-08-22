/**
 * Workbook store audit — durability across instances, revision discipline under
 * concurrent saves, and share-list validation.
 *
 * Pure Node tests against the file adapter with a temp path — no server needed.
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { createWorkbook, setCellValue } from "@/lib/spreadsheet/model";
import { serializeWorkbook } from "@/lib/spreadsheet/persistence";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import {
  FileWorkbookStore,
  WorkbookConflict,
  type ShareRole,
} from "@/lib/server/workbookStore";

let counter = 0;
function freshPath(): string {
  return join(tmpdir(), `cowork-wb-audit-${process.pid}-${Date.now()}-${counter++}.json`);
}

function sampleData(cellValue?: string) {
  let wb = createWorkbook();
  if (cellValue !== undefined) {
    wb = { ...wb, worksheets: [setCellValue(wb.worksheets[0], 0, 0, cellValue)] };
  }
  return serializeWorkbook(wb, new StyleRegistry());
}

test("AUDIT: data written by one store instance is read intact by a fresh one (restart)", async () => {
  const path = freshPath();
  try {
    const a = new FileWorkbookStore(path);
    const created = await a.create({ ownerId: "u1", title: "Durable", data: sampleData("persisted") });
    await a.save({ id: created.id, data: sampleData("rev2"), baseRevision: 1 });

    const b = new FileWorkbookStore(path); // a new process, in effect
    const loaded = await b.load(created.id);
    assert.equal(loaded?.title, "Durable");
    assert.equal(loaded?.revision, 2);
    assert.equal(loaded?.data.sheets[0].cells[0]?.value, "rev2");
    assert.equal(loaded?.createdAt, created.createdAt);
  } finally {
    await rm(path, { force: true });
  }
});

test("AUDIT: two concurrent saves from the same base — exactly one wins, one conflicts", async () => {
  const path = freshPath();
  try {
    const store = new FileWorkbookStore(path);
    const created = await store.create({ ownerId: "u1", title: "Race", data: sampleData() });

    const results = await Promise.allSettled([
      store.save({ id: created.id, data: sampleData("tab A"), baseRevision: 1 }),
      store.save({ id: created.id, data: sampleData("tab B"), baseRevision: 1 }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one save lands");
    assert.equal(rejected.length, 1, "the other is refused, not silently lost");
    const err = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(err instanceof WorkbookConflict);
    assert.equal(err.currentRevision, 2, "the conflict names the revision that won");

    const final = await store.load(created.id);
    assert.equal(final?.revision, 2, "no double bump");
  } finally {
    await rm(path, { force: true });
  }
});

test("AUDIT: sequential saves bump the revision one at a time with no gaps", async () => {
  const path = freshPath();
  try {
    const store = new FileWorkbookStore(path);
    const created = await store.create({ ownerId: "u1", title: "Steps", data: sampleData() });
    let revision = created.revision;
    for (let i = 0; i < 5; i++) {
      const saved = await store.save({ id: created.id, data: sampleData(`v${i}`), baseRevision: revision });
      assert.equal(saved?.revision, revision + 1);
      revision = saved!.revision;
    }
    assert.equal(revision, 6);
  } finally {
    await rm(path, { force: true });
  }
});

test("AUDIT: a corrupt or wrong-version store file reads as empty, never crashes reads", async () => {
  const path = freshPath();
  try {
    await writeFile(path, "{ this is not json", "utf8");
    const store = new FileWorkbookStore(path);
    assert.deepEqual(await store.listForPrincipal("u1"), []);
    // And the store can still WRITE over it.
    const created = await store.create({ ownerId: "u1", title: "Fresh", data: sampleData() });
    assert.equal((await store.load(created.id))?.title, "Fresh");
  } finally {
    await rm(path, { force: true });
  }
});

test("AUDIT: create trims the title and defaults an empty one", async () => {
  const path = freshPath();
  try {
    const store = new FileWorkbookStore(path);
    const spaced = await store.create({ ownerId: "u1", title: "  Budget  ", data: sampleData() });
    assert.equal(spaced.title, "Budget");
    const blank = await store.create({ ownerId: "u1", title: "   ", data: sampleData() });
    assert.equal(blank.title, "Untitled workbook");
    // Rename to blank keeps the old title rather than blanking it.
    const renamed = await store.rename(spaced.id, "   ");
    assert.equal(renamed?.title, "Budget");
  } finally {
    await rm(path, { force: true });
  }
});

test("AUDIT: object-prototype key names are not accepted as share roles", async () => {
  const path = freshPath();
  try {
    const store = new FileWorkbookStore(path);
    const wb = await store.create({ ownerId: "u1", title: "S", data: sampleData() });
    // The store's own contract (its comment): "unknown role — drop it, never
    // default up". "constructor" is an unknown role.
    const updated = await store.setShares(wb.id, [
      { principalId: "u2", role: "constructor" as unknown as ShareRole },
    ]);
    // Role validation is an OWN-property lookup (Object.hasOwn), so prototype
    // key names ("constructor"/"toString"/"__proto__") are unknown roles and
    // are dropped. The upstream shares route also validates with a Set; the
    // store holds its own documented guarantee as defence-in-depth.
    assert.equal(updated?.shares, undefined, "a prototype key is not a role and must be dropped");
  } finally {
    await rm(path, { force: true });
  }
});

test("AUDIT: a shared listing hides the share list from non-owners but stamps access", async () => {
  const path = freshPath();
  try {
    const store = new FileWorkbookStore(path);
    const wb = await store.create({ ownerId: "u1", title: "Shared", data: sampleData() });
    await store.setShares(wb.id, [
      { principalId: "u2", role: "editor" },
      { principalId: "u3", role: "viewer" },
    ]);
    const mine = await store.listForPrincipal("u2");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].access, "editor");
    assert.equal(mine[0].shares, undefined, "a recipient cannot enumerate other recipients");
    const owners = await store.listForPrincipal("u1");
    assert.equal(owners[0].shares?.length, 2, "the owner still sees the full list");
  } finally {
    await rm(path, { force: true });
  }
});

test("AUDIT: remove deletes durably — a fresh instance no longer sees the workbook", async () => {
  const path = freshPath();
  try {
    const a = new FileWorkbookStore(path);
    const created = await a.create({ ownerId: "u1", title: "Doomed", data: sampleData() });
    assert.equal(await a.remove(created.id), true);
    const b = new FileWorkbookStore(path);
    assert.equal(await b.load(created.id), null);
    assert.equal(await b.remove(created.id), false);
  } finally {
    await rm(path, { force: true });
  }
});
