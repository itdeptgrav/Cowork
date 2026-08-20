import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conversationsNeedingDelivery,
  messageStatus,
} from "./messageStatus.ts";
import type { EmployeeId } from "@/lib/domain";

const ME = "E001" as EmployeeId;
const THEM = "E002" as EmployeeId;
const THIRD = "E003" as EmployeeId;

const T0 = "2026-08-20T10:00:00.000Z";
const T1 = "2026-08-20T10:00:05.000Z";
const T2 = "2026-08-20T10:00:10.000Z";

/* ── The three states ─────────────────────────────────────────────────────── */

test("a message nobody has received yet is only sent", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME],
      recipientIds: [THEM],
      deliveredAt: {},
    }),
    "sent",
  );
});

test("a recipient whose client was live AFTER the message has received it", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME],
      recipientIds: [THEM],
      deliveredAt: { [THEM]: T2 },
    }),
    "delivered",
  );
});

test("a delivery stamp OLDER than the message proves nothing", () => {
  /* They were online, then went away, then this was written. */
  assert.equal(
    messageStatus({
      createdAt: T2,
      readBy: [ME],
      recipientIds: [THEM],
      deliveredAt: { [THEM]: T0 },
    }),
    "sent",
  );
});

test("delivery at exactly the same instant counts", () => {
  /* `>=`, not `>`. Both people online is the common case, and strictly-after
     would drop precisely that one. */
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME],
      recipientIds: [THEM],
      deliveredAt: { [THEM]: T1 },
    }),
    "delivered",
  );
});

test("a recipient in readBy has read it", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME, THEM],
      recipientIds: [THEM],
      deliveredAt: {},
    }),
    "read",
  );
});

test("read wins over delivered — it is the later state, not a separate one", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME, THEM],
      recipientIds: [THEM],
      deliveredAt: { [THEM]: T2 },
    }),
    "read",
  );
});

test("read does not need a delivery stamp at all", () => {
  /* Somebody who has demonstrably opened the thread received it, whatever the
     conversation document happens to say. Requiring both would show a single
     tick against a message the reader has visibly answered. */
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME, THEM],
      recipientIds: [THEM],
      deliveredAt: undefined,
    }),
    "read",
  );
});

/* ── Groups: every recipient, never any recipient ─────────────────────────── */

test("a group is read only when EVERYONE has read it", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME, THEM],
      recipientIds: [THEM, THIRD],
      deliveredAt: {},
    }),
    "sent",
    "one reader out of two must not turn the group blue",
  );
});

test("a group is delivered only when EVERYONE has received it", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME],
      recipientIds: [THEM, THIRD],
      deliveredAt: { [THEM]: T2 },
    }),
    "sent",
  );
});

test("a group where one has read and the other only received is delivered", () => {
  /* The furthest state EVERY recipient has reached. `THIRD` has not read it, so
     the answer cannot be read; both have received it, so it is delivered. */
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME, THEM],
      recipientIds: [THEM, THIRD],
      deliveredAt: { [THEM]: T2, [THIRD]: T2 },
    }),
    "delivered",
  );
});

test("a group everybody has read is read", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME, THEM, THIRD],
      recipientIds: [THEM, THIRD],
      deliveredAt: {},
    }),
    "read",
  );
});

/* ── Degenerate input never invents a state ───────────────────────────────── */

test("a thread with nobody else in it is sent, not delivered", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME],
      recipientIds: [],
      deliveredAt: { [ME]: T2 },
    }),
    "sent",
    "there is nobody for it to have reached",
  );
});

test("an unreadable message timestamp falls back to sent", () => {
  assert.equal(
    messageStatus({
      createdAt: "not a date",
      readBy: [ME],
      recipientIds: [THEM],
      deliveredAt: { [THEM]: T2 },
    }),
    "sent",
  );
});

test("an unreadable delivery stamp is not a delivery", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME],
      recipientIds: [THEM],
      deliveredAt: { [THEM]: "whenever" },
    }),
    "sent",
  );
});

test("a null delivery stamp is not a delivery", () => {
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME],
      recipientIds: [THEM],
      deliveredAt: { [THEM]: null },
    }),
    "sent",
  );
});

test("the sender's own presence in readBy cannot make it read", () => {
  /* Every message is written with `readBy: [senderId]`, so a rule that counted
     the sender would show every message blue the instant it was sent. */
  assert.equal(
    messageStatus({
      createdAt: T1,
      readBy: [ME],
      recipientIds: [THEM],
      deliveredAt: {},
    }),
    "sent",
  );
});

/* ── Which conversations need a fresh stamp ───────────────────────────────── */

test("a conversation with a newer message than my stamp needs one", () => {
  assert.deepEqual(
    conversationsNeedingDelivery(
      [{ id: "c1", lastMessageAt: T2, deliveredAt: { [ME]: T1 } }],
      ME,
    ),
    ["c1"],
  );
});

test("a conversation already stamped past its newest message does not", () => {
  /* This is what stops the loop: the stamp lives on the watched document, so an
     unconditional write would trigger a read that triggers a write. */
  assert.deepEqual(
    conversationsNeedingDelivery(
      [{ id: "c1", lastMessageAt: T1, deliveredAt: { [ME]: T2 } }],
      ME,
    ),
    [],
  );
});

test("a conversation I have never stamped needs one", () => {
  assert.deepEqual(
    conversationsNeedingDelivery([{ id: "c1", lastMessageAt: T1 }], ME),
    ["c1"],
  );
});

test("an empty conversation is skipped — nothing has been said to receive", () => {
  assert.deepEqual(
    conversationsNeedingDelivery([{ id: "c1", lastMessageAt: null }], ME),
    [],
  );
});

test("somebody else's stamp is not mine", () => {
  assert.deepEqual(
    conversationsNeedingDelivery(
      [{ id: "c1", lastMessageAt: T2, deliveredAt: { [THEM]: T2 } }],
      ME,
    ),
    ["c1"],
  );
});

test("only the conversations that need it are returned", () => {
  assert.deepEqual(
    conversationsNeedingDelivery(
      [
        { id: "stale", lastMessageAt: T2, deliveredAt: { [ME]: T0 } },
        { id: "fresh", lastMessageAt: T1, deliveredAt: { [ME]: T2 } },
        { id: "never", lastMessageAt: T1 },
        { id: "empty", lastMessageAt: null },
      ],
      ME,
    ),
    ["stale", "never"],
  );
});
