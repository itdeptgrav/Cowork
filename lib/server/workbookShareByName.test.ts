import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createWorkbook } from "@/lib/spreadsheet/model";
import { serializeWorkbook } from "@/lib/spreadsheet/persistence";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import { FileWorkbookStore } from "@/lib/server/workbookStore";

/**
 * Sharing a sheet with a colleague BY NAME actually admits them.
 *
 * A workbook is OWNED by whichever principal created it — `fb:<uid>` on the
 * Firebase path — but the people directory the share panel searches speaks
 * EMPLOYEE ids. So a share is granted by employee id, and the caller must be
 * matched by BOTH the id that owns their own sheets and the employee id a share
 * names them by. Owned by the owner id; reached-when-shared by the employee id.
 *
 * The store's matching is exercised directly here. `standingOn` and
 * `accessWorkbook` live in a `server-only` module the test runner cannot import,
 * so their wiring is pinned by source assertion, in the style of the repo's
 * other wiring tests.
 */

let counter = 0;
function freshStore() {
  const path = join(tmpdir(), `cowork-wb-share-${process.pid}-${Date.now()}-${counter++}.json`);
  return { store: new FileWorkbookStore(path), cleanup: () => rm(path, { force: true }) };
}
const sampleData = () => serializeWorkbook(createWorkbook(), new StyleRegistry());

test("a sheet shared with an employee id lists for that person, as their role", async () => {
  const { store, cleanup } = freshStore();
  try {
    /* Owner reaches their sheets by the id that owns them — a `fb:<uid>`. */
    const wb = await store.create({ ownerId: "fb:owner", title: "Budget", data: sampleData() });
    await store.setShares(wb.id, [{ principalId: "emp-B", role: "editor" }]);

    /* The recipient presents two ids at once: their own `fb:<uid>` (which owns
       nothing here) and their directory employee id, which the share names. */
    const forB = await store.listForPrincipal(["fb:B", "emp-B"]);
    assert.equal(forB.length, 1, "the shared sheet is in the recipient's list");
    assert.equal(forB[0].access, "editor", "stamped with the granted role, not owner");
    assert.equal(forB[0].shares, undefined, "a recipient never learns who else holds it");
  } finally {
    await cleanup();
  }
});

test("the owner still reaches it as owner, and sees the share list", async () => {
  const { store, cleanup } = freshStore();
  try {
    const wb = await store.create({ ownerId: "fb:owner", title: "Budget", data: sampleData() });
    await store.setShares(wb.id, [{ principalId: "emp-B", role: "editor" }]);

    const owned = await store.listForPrincipal("fb:owner"); // a single id still works
    assert.equal(owned.length, 1);
    assert.equal(owned[0].access, "owner");
    assert.deepEqual(owned[0].shares, [{ principalId: "emp-B", role: "editor" }]);
  } finally {
    await cleanup();
  }
});

test("someone the sheet was NOT shared with sees nothing", async () => {
  const { store, cleanup } = freshStore();
  try {
    const wb = await store.create({ ownerId: "fb:owner", title: "Budget", data: sampleData() });
    await store.setShares(wb.id, [{ principalId: "emp-B", role: "editor" }]);
    assert.deepEqual(await store.listForPrincipal(["fb:C", "emp-C"]), []);
  } finally {
    await cleanup();
  }
});

/* ── Wiring (source, because the module is server-only) ────────────────────── */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("the caller's employee id is resolved the way mail's is", () => {
  const src = strip("lib/server/workbookPrincipal.ts");
  assert.match(src, /export async function workbookEmployeeId/);
  /* Session carries it; the Firebase path asks the legacy `/cowork/me`. */
  assert.match(src, /return session\.employeeId \|\| null;/);
  assert.match(src, /\/cowork\/me/);
});

test("access checks ownership first, and only then resolves the employee id", () => {
  /* Owning your own sheet — the autosave path — must not pay a `/cowork/me`
     round trip; only a non-owner falls through to the shared-access check. */
  const src = strip("lib/server/workbookAccess.ts");
  assert.match(src, /let access = standingOn\(record, principal\.ownerId\);/);
  assert.match(
    src,
    /if \(!access && record\.shares\?\.length\) \{[\s\S]*?const employeeId = await workbookEmployeeId\(request\);/,
  );
  assert.match(src, /standingOn\(record, \[principal\.ownerId, employeeId\]\)/);
});

test("the listing spans both ids, and carries access and shares back", () => {
  const src = strip("app/api/spreadsheet/workbooks/route.ts");
  assert.match(src, /const employeeId = await workbookEmployeeId\(request\);/);
  assert.match(src, /listForPrincipal\(ids\)/);
  assert.match(src, /access: w\.access,/);
  assert.match(src, /\.\.\.\(w\.shares \? \{ shares: w\.shares \} : \{\}\)/);
});
