import assert from "node:assert/strict";
import { test } from "node:test";
import { reachesViewer, resolveInboundParty } from "./inbound.ts";
import type { MailParty } from "../../domain/index.ts";

/**
 * Why synced Gmail did not appear in the inbox.
 *
 * A silent failure: import succeeded, the count was reported, and every message
 * was invisible. These tests pin the cause so it cannot come back quietly.
 */

const ext = (address: string): MailParty => ({
  kind: "external",
  employeeId: null,
  address,
  displayName: address,
});

const CTX = {
  mailboxAddress: "soumya.work@gmail.com",
  viewerEmployeeId: "e-1001",
  viewerDisplayName: "Soumya",
  directory: new Map([
    ["maya@grav.in", { id: "e-01", email: "maya@grav.in", displayName: "Maya" }],
  ]),
};

test("mail to the connected mailbox belongs to the viewer", () => {
  /* THE BUG. The connected Gmail is not `Employee.email`, so the directory
     could not match it and the message became invisible to its own recipient. */
  const p = resolveInboundParty(ext("soumya.work@gmail.com"), CTX);
  assert.equal(p.employeeId, "e-1001");
  assert.equal(p.kind, "employee");
});

test("a message addressed to the mailbox reaches the inbox", () => {
  const message = {
    from: ext("client@vendor.com"),
    to: [resolveInboundParty(ext("soumya.work@gmail.com"), CTX)],
    cc: [],
  };
  assert.ok(
    reachesViewer(message, "e-1001"),
    "an inbound message must reach the person whose mailbox it arrived in",
  );
});

test("without the mailbox address it would be invisible — the regression", () => {
  /* The exact pre-fix behaviour, kept as a demonstration of what broke. */
  const p = resolveInboundParty(ext("soumya.work@gmail.com"), {
    ...CTX,
    mailboxAddress: "",
  });
  assert.equal(p.employeeId, null);
  assert.equal(
    reachesViewer({ from: ext("c@v.com"), to: [p], cc: [] }, "e-1001"),
    false,
    "this is what made a synced inbox look empty",
  );
});

test("a colleague still resolves through the directory", () => {
  const p = resolveInboundParty(ext("MAYA@GRAV.IN"), CTX);
  assert.equal(p.employeeId, "e-01");
  assert.equal(p.displayName, "Maya");
});

test("the mailbox wins over the directory", () => {
  /* A connected Gmail that also appears in the directory must resolve to the
     person who connected it, not to whoever else holds that address. */
  const ctx = {
    ...CTX,
    directory: new Map([
      ["soumya.work@gmail.com", { id: "e-99", email: "soumya.work@gmail.com", displayName: "Someone else" }],
    ]),
  };
  assert.equal(resolveInboundParty(ext("soumya.work@gmail.com"), ctx).employeeId, "e-1001");
});

test("a stranger stays external", () => {
  const p = resolveInboundParty(ext("client@vendor.com"), CTX);
  assert.equal(p.kind, "external");
  assert.equal(p.employeeId, null);
  assert.equal(reachesViewer({ from: p, to: [], cc: [] }, "e-1001"), false);
});

test("mail the viewer sent from Gmail is theirs", () => {
  const from = resolveInboundParty(ext("soumya.work@gmail.com"), CTX);
  assert.ok(reachesViewer({ from, to: [ext("c@v.com")], cc: [] }, "e-1001"));
});
