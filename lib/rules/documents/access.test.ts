import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEdit,
  canManage,
  canView,
  editRefusal,
  memberChangeRefusal,
  readMembers,
  roleOf,
  writeMembers,
} from "./access.ts";
import type { DocumentMember } from "../../domain/documents.ts";

const m = (employeeId: string, role: "owner" | "editor" | "viewer"): DocumentMember => ({
  employeeId,
  role,
  addedAt: "2026-08-01T00:00:00.000Z",
});

const doc = (members: DocumentMember[]) => ({ members });

const BASE = doc([m("OWNER", "owner"), m("ED", "editor"), m("VIEW", "viewer")]);

/* ── Who may do what ──────────────────────────────────────────────────────── */

test("roles grant in order", () => {
  assert.equal(canView(BASE, "VIEW"), true);
  assert.equal(canEdit(BASE, "VIEW"), false);
  assert.equal(canEdit(BASE, "ED"), true);
  assert.equal(canManage(BASE, "ED"), false);
  assert.equal(canManage(BASE, "OWNER"), true);
});

test("a stranger has nothing", () => {
  assert.equal(roleOf(BASE, "NOBODY"), null);
  assert.equal(canView(BASE, "NOBODY"), false);
  assert.equal(canView(BASE, null), false);
});

test("a viewer is told WHY, not left with a dead editor", () => {
  /* "Nothing happens when I type" is the hardest state to report. */
  assert.match(editRefusal(BASE, "VIEW") ?? "", /view access/i);
  assert.equal(editRefusal(BASE, "ED"), null);
  assert.match(editRefusal(BASE, "NOBODY") ?? "", /do not have access/i);
});

/* ── The last owner ───────────────────────────────────────────────────────── */

test("the last owner cannot be demoted", () => {
  /* A document with no owner cannot be shared, renamed or deleted by anybody,
     and no screen in the product can repair it. */
  const why = memberChangeRefusal({
    doc: BASE,
    actorId: "OWNER",
    targetId: "OWNER",
    nextRole: "editor",
  });
  assert.match(why ?? "", /no owner/i);
});

test("the last owner cannot remove themselves", () => {
  const why = memberChangeRefusal({
    doc: BASE,
    actorId: "OWNER",
    targetId: "OWNER",
    nextRole: null,
  });
  assert.match(why ?? "", /no owner/i);
});

test("but they can once somebody else owns it too", () => {
  /* Leaving a document you were added to is ordinary — it is only blocked
     while you are the sole administrator. */
  const two = doc([m("OWNER", "owner"), m("SECOND", "owner")]);
  assert.equal(
    memberChangeRefusal({
      doc: two,
      actorId: "OWNER",
      targetId: "OWNER",
      nextRole: null,
    }),
    null,
  );
});

test("only an owner may change access", () => {
  for (const actor of ["ED", "VIEW", "NOBODY", null]) {
    const why = memberChangeRefusal({
      doc: BASE,
      actorId: actor,
      targetId: "ED",
      nextRole: "viewer",
    });
    assert.match(why ?? "", /only an owner/i, `${actor} could change access`);
  }
});

/* ── Writing the two lists ────────────────────────────────────────────────── */

test("members and the id index are written together", () => {
  /* Firestore cannot query inside an array of objects, so `memberIds` is the
     `array-contains` index. Letting them drift gives somebody a role and no way
     to find the document, or the reverse. */
  const next = writeMembers(BASE.members, {
    employeeId: "NEW",
    role: "editor",
    at: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(next.members.length, 4);
  assert.deepEqual(
    next.memberIds.slice().sort(),
    ["ED", "NEW", "OWNER", "VIEW"],
  );
});

test("a role change keeps the date they were added", () => {
  /* Otherwise changing somebody's role reads as a re-invitation. */
  const next = writeMembers(BASE.members, {
    employeeId: "ED",
    role: "viewer",
    at: "2027-01-01T00:00:00.000Z",
  });
  assert.equal(next.members.find((x) => x.employeeId === "ED")!.addedAt, "2026-08-01T00:00:00.000Z");
});

test("removal drops them from both lists", () => {
  const next = writeMembers(BASE.members, {
    employeeId: "VIEW",
    role: null,
    at: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(next.members.some((x) => x.employeeId === "VIEW"), false);
  assert.equal(next.memberIds.includes("VIEW"), false);
});

/* ── Documents written before roles existed ───────────────────────────────── */

test("pre-roles members become EDITORS, not viewers", () => {
  /* They had full access when the document was written. Silently demoting them
     on upgrade takes away something nobody chose to take away. */
  const members = readMembers({
    memberIds: ["A", "B"],
    createdById: "A",
    createdAt: "2026-07-30T00:00:00.000Z",
  });
  assert.equal(members.find((x) => x.employeeId === "A")!.role, "owner");
  assert.equal(members.find((x) => x.employeeId === "B")!.role, "editor");
});

test("the creator is reinstated if no owner survives", () => {
  /* A document nobody can administer is unrecoverable, so this repairs rather
     than faithfully reproducing a broken record. */
  const members = readMembers({
    members: [{ employeeId: "B", role: "editor", addedAt: "x" }],
    createdById: "A",
    createdAt: "2026-07-30T00:00:00.000Z",
  });
  assert.equal(members.find((x) => x.employeeId === "A")?.role, "owner");
});

test("an unrecognised stored role reads as viewer", () => {
  /* The least access, not the most: a corrupt value must not grant editing. */
  const members = readMembers({
    members: [
      { employeeId: "A", role: "owner", addedAt: "x" },
      { employeeId: "B", role: "superuser", addedAt: "x" },
    ],
    createdById: "A",
  });
  assert.equal(members.find((x) => x.employeeId === "B")!.role, "viewer");
});
