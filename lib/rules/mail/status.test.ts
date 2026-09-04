import assert from "node:assert/strict";
import { test } from "node:test";
import type { MailMessage, MailParty } from "@/lib/domain";
import { mailSendStatus, internalRecipientIds } from "./status.ts";

/**
 * What the sender is told about their own message — derived, never stored, so
 * the chip cannot drift from the message. The load-bearing honesty is that a
 * Gmail send never becomes "Seen": the API cannot report an outside recipient's
 * read, and a "Seen" the product could not back up would be a lie.
 */

const emp = (id: string): MailParty => ({
  kind: "employee",
  employeeId: id,
  address: `${id}@cowork.local`,
  displayName: id,
});

function msg(over: Partial<MailMessage>): MailMessage {
  return {
    id: "m1",
    threadId: "t1",
    transport: "internal",
    from: emp("A"),
    to: [emp("B")],
    cc: [],
    bcc: [],
    subject: "s",
    body: "b",
    attachmentIds: [],
    readBy: ["A"],
    starredBy: [],
    trashedBy: [],
    archivedBy: [],
    spamBy: [],
    importantBy: [],
    labels: [],
    sentAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    gmailMessageId: null,
    deliveryError: null,
    ...over,
  };
}

test("only the sender gets a status; a recipient's own read is not a chip", () => {
  assert.equal(mailSendStatus(msg({}), "B"), null);
  assert.equal(mailSendStatus(msg({}), null), null);
});

test("a delivery error reads Not sent, over everything else", () => {
  assert.equal(
    mailSendStatus(msg({ deliveryError: "Gmail refused it", sentAt: null }), "A"),
    "failed",
  );
});

test("never sent and not failed is a draft", () => {
  assert.equal(mailSendStatus(msg({ sentAt: null }), "A"), "draft");
});

test("sent-but-unread is Sent; every internal recipient having read is Seen", () => {
  assert.equal(mailSendStatus(msg({ readBy: ["A"] }), "A"), "sent");
  assert.equal(mailSendStatus(msg({ readBy: ["A", "B"] }), "A"), "seen");
});

test("Seen needs EVERY internal recipient, not just one", () => {
  const m = msg({ to: [emp("B"), emp("C")], readBy: ["A", "B"] });
  assert.equal(mailSendStatus(m, "A"), "sent");
  assert.equal(mailSendStatus({ ...m, readBy: ["A", "B", "C"] }, "A"), "seen");
});

test("a Gmail send is never Seen, even if readBy somehow lists the recipient", () => {
  const m = msg({ transport: "gmail", to: [emp("B")], readBy: ["A", "B"] });
  assert.equal(mailSendStatus(m, "A"), "sent");
});

test("internalRecipientIds excludes the sender and dedups across fields", () => {
  const m = msg({ to: [emp("B")], cc: [emp("B"), emp("C")], bcc: [emp("A")] });
  assert.deepEqual(internalRecipientIds(m).sort(), ["B", "C"]);
});
