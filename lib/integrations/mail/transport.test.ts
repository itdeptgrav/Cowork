import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAddress,
  resolveParty,
  sendRefusal,
  transportFor,
  transportNotice,
} from "./transport.ts";
import type { MailParty } from "../../domain/index.ts";

/**
 * The recipient decides the transport.
 *
 * Legacy made the human decide by choosing a page — `/mail` or `/mail/gmail` —
 * before they had typed anything. These tests hold the rule that replaces it,
 * and in particular the two cases where getting it wrong would leak a message
 * out of the company or strand one inside it.
 */

const emp = (id: string, address: string): MailParty => ({
  kind: "employee",
  employeeId: id,
  address,
  displayName: id,
});
const ext = (address: string): MailParty => ({
  kind: "external",
  employeeId: null,
  address,
  displayName: address,
});

const DIRECTORY = [
  { employeeId: "e-01", address: "maya@grav.in", displayName: "Maya Ferreira" },
];

test("all-employee recipients stay internal", () => {
  assert.equal(transportFor([emp("e-01", "a@x.com"), emp("e-02", "b@x.com")]), "internal");
});

test("one external recipient makes the whole message external", () => {
  /* A message cannot half-leave the building. Sending internally and silently
     dropping the outside recipient is the worst available outcome. */
  assert.equal(transportFor([emp("e-01", "a@x.com"), ext("client@vendor.com")]), "gmail");
});

test("typing a colleague's own address sends internally", () => {
  /* Otherwise a colleague's mail would route out through Gmail and back in,
     losing their profile and their notification on the way. */
  const p = resolveParty("MAYA@GRAV.IN", DIRECTORY);
  assert.equal(p?.kind, "employee");
  assert.equal(p?.employeeId, "e-01");
  assert.equal(transportFor([p!]), "internal");
});

test("an unknown address resolves to an external party", () => {
  const p = resolveParty("client@vendor.com", DIRECTORY);
  assert.equal(p?.kind, "external");
  assert.equal(p?.employeeId, null);
});

test("nonsense is not a recipient", () => {
  for (const v of ["", "   ", "not-an-address", "@x.com", "a@b"]) {
    assert.equal(resolveParty(v, DIRECTORY), null, `${v} must not resolve`);
  }
  assert.equal(isAddress("a@b.co"), true);
});

test("the notice and the routing come from one function", () => {
  /* A banner computed separately from the send is a banner that will
     eventually disagree with what actually happened. */
  const internal = transportNotice([emp("e-01", "a@x.com")]);
  assert.equal(internal.transport, "internal");
  assert.match(internal.label, /Internal message/);

  const mixed = transportNotice([emp("e-01", "a@x.com"), ext("c@v.com")]);
  assert.equal(mixed.transport, "gmail");
  assert.match(mixed.label, /Sending via Gmail/);
  assert.match(mixed.detail, /1 of 2 recipients are outside/);
});

test("an external send is refused when Gmail is not connected", () => {
  /* The current credential state. Refusing with a reason and keeping the draft
     is honest; pretending it sent is not. */
  const r = sendRefusal({
    recipients: [ext("client@vendor.com")],
    subject: "Quote",
    gmailAvailable: false,
  });
  assert.match(r ?? "", /Gmail is not connected/);
  assert.match(r ?? "", /kept as a draft/);
});

test("an internal send is unaffected by Gmail being down", () => {
  /* The whole reason the transports are separate services. */
  assert.equal(
    sendRefusal({
      recipients: [emp("e-01", "a@x.com")],
      subject: "Standup",
      gmailAvailable: false,
    }),
    null,
  );
});

test("a message needs recipients and a subject", () => {
  assert.match(
    sendRefusal({ recipients: [], subject: "x", gmailAvailable: true }) ?? "",
    /at least one recipient/,
  );
  assert.match(
    sendRefusal({ recipients: [emp("e-01", "a@x.com")], subject: "  ", gmailAvailable: true }) ?? "",
    /subject/,
  );
});

/* ── The connection-state inconsistency, pinned ───────────────────────────── */

test("a connected mailbox is not refused", () => {
  /* THE REGRESSION. Settings said "Connected" while the composer refused every
     external send, because the two asked different questions: Settings looked
     up the real connection, and `sendMail` checked `!!input.gmail` — "has a
     Gmail send already succeeded" — which was never true because the send route
     did not exist. Both now resolve from `getGmailConnection`. */
  assert.equal(
    sendRefusal({
      recipients: [ext("client@vendor.com")],
      subject: "Quote",
      gmailAvailable: true,
    }),
    null,
    "a connected account must be able to send externally",
  );
});

test("availability is per-transport, not global", () => {
  /* The same call, the same Gmail state, two answers — decided by who the
     message is for. This is what keeps a Gmail outage away from internal mail. */
  for (const available of [true, false]) {
    assert.equal(
      sendRefusal({
        recipients: [emp("e-01", "a@x.com")],
        subject: "Standup",
        gmailAvailable: available,
      }),
      null,
      "internal is never gated on Gmail",
    );
  }
  assert.equal(
    sendRefusal({ recipients: [ext("c@v.com")], subject: "Q", gmailAvailable: true }),
    null,
  );
  assert.ok(
    sendRefusal({ recipients: [ext("c@v.com")], subject: "Q", gmailAvailable: false }),
  );
});

test("a mixed message is gated by Gmail, because it leaves the building", () => {
  assert.ok(
    sendRefusal({
      recipients: [emp("e-01", "a@x.com"), ext("c@v.com")],
      subject: "Q",
      gmailAvailable: false,
    }),
    "one external recipient makes the whole send external",
  );
});
