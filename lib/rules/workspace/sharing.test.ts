import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SHARE_ROLES,
  SHARE_ROLE_LABEL,
  shareRoleHints,
  sortByRole,
  type ShareRole,
} from "./sharing.ts";

test("the hint names the thing being shared", () => {
  assert.equal(shareRoleHints("document").editor, "Can edit the document.");
  assert.equal(shareRoleHints("mindmap").editor, "Can edit the mindmap.");
});

test("the document wording is unchanged", () => {
  /* Pins the sentences documents already show, so generalising this could not
     quietly reword a screen people have already read. */
  const hints = shareRoleHints("document");
  assert.equal(hints.owner, "Can edit, share and delete.");
  assert.equal(hints.editor, "Can edit the document.");
  assert.equal(hints.viewer, "Can read it. Cannot change anything.");
});

test("labels do not vary by noun — one word learned once", () => {
  assert.deepEqual(SHARE_ROLE_LABEL, {
    owner: "Owner",
    editor: "Editor",
    viewer: "Viewer",
  });
});

test("members sort owner, editor, viewer", () => {
  const members: { employeeId: string; role: ShareRole }[] = [
    { employeeId: "c", role: "viewer" },
    { employeeId: "a", role: "editor" },
    { employeeId: "b", role: "owner" },
  ];
  assert.deepEqual(
    sortByRole(members).map((m) => m.employeeId),
    ["b", "a", "c"],
  );
});

test("sorting does not mutate the record it was handed", () => {
  /* The array belongs to a query cache. Sorting it where it lies changes what
     the next reader sees with no re-render to announce it. */
  const members: { employeeId: string; role: ShareRole }[] = [
    { employeeId: "c", role: "viewer" },
    { employeeId: "b", role: "owner" },
  ];
  const before = members.map((m) => m.employeeId);
  sortByRole(members);
  assert.deepEqual(
    members.map((m) => m.employeeId),
    before,
  );
});

test("every role has a label and a hint", () => {
  const hints = shareRoleHints("mindmap");
  for (const role of SHARE_ROLES) {
    assert.ok(SHARE_ROLE_LABEL[role], `no label for ${role}`);
    assert.ok(hints[role], `no hint for ${role}`);
  }
});
