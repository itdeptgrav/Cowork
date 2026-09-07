import assert from "node:assert/strict";
import { test } from "node:test";

import {
  betterStatus,
  isPersistableMeetId,
  mergeChat,
  newestStoredMs,
  oldestStoredMs,
  type ChannelMessage,
  type StoredMessage,
} from "./mergeChat.ts";

/**
 * One conversation out of two transports.
 *
 * A meeting message arrives twice — instantly on LiveKit's data channel, and
 * durably from the ledger — carrying the same id on both. These pin the two
 * things that decide whether the result is a conversation or a mess: which copy
 * wins, and that the answer does not depend on which arrived first.
 */

const ME = "GR0001";
const THEM = "GR0002";

const chan = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: "m1",
  senderId: THEM,
  senderName: "Asha",
  text: "hello",
  createdAtMs: 1_000,
  ...over,
});

const store = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  messageId: "m1",
  senderId: THEM,
  senderName: "Asha",
  senderKind: "employee",
  text: "hello",
  createdAtMs: 1_000,
  ...over,
});

/* ── One message, two transports ─────────────────────────────────────────── */

test("a message on both transports appears once", () => {
  const out = mergeChat({ channel: [chan()], stored: [store()], meId: ME });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "m1");
});

test("the order of arrival does not change the result", () => {
  /**
   * A message can arrive stored-first (history loaded after a refresh, then the
   * channel replays it) or channel-first (sent live, stored a moment later).
   * Both are normal, so both must produce the same row — which is why the merge
   * keys on id and merges fields rather than letting the last one win.
   */
  const a = mergeChat({ channel: [chan()], stored: [store()], meId: ME });
  const b = mergeChat({ channel: [], stored: [store()], meId: ME });
  const c = mergeChat({ channel: [chan()], stored: [], meId: ME });

  assert.equal(a[0].text, b[0].text);
  assert.equal(a[0].createdAtMs, b[0].createdAtMs);
  assert.equal(a[0].stored, true);
  assert.equal(c[0].stored, false, "a channel-only message claimed to be saved");
});

test("the SERVER clock wins, so everybody sees the same order", () => {
  /**
   * The channel copy carries the sender's clock. A laptop minutes fast is
   * ordinary, and if that decided the order, one person with a wrong clock
   * would pin their messages to the top or bottom of everybody else's
   * conversation — differently for each reader.
   */
  const out = mergeChat({
    channel: [chan({ createdAtMs: 9_999_999 })],
    stored: [store({ createdAtMs: 1_000 })],
    meId: ME,
  });
  assert.equal(out[0].createdAtMs, 1_000, "the sender's clock won");
});

test("the ledger supplies what the channel never carried", () => {
  /* Attachments ride the ledger, not the data channel. */
  const out = mergeChat({
    channel: [chan()],
    stored: [
      store({
        attachments: [
          {
            url: "u",
            name: "plan.pdf",
            kind: "pdf",
            sizeBytes: 12,
            durationSecs: null,
            fileId: null,
          },
        ],
      }),
    ],
    meId: ME,
  });
  assert.equal(out[0].attachments.length, 1);
  assert.equal(out[0].attachments[0].name, "plan.pdf");
});

test("history from before this reader joined is included", () => {
  const out = mergeChat({
    channel: [chan({ id: "m2", createdAtMs: 2_000 })],
    stored: [store({ messageId: "m1", createdAtMs: 1_000 })],
    meId: ME,
  });
  assert.deepEqual(out.map((m) => m.id), ["m1", "m2"]);
});

/* ── Ordering ────────────────────────────────────────────────────────────── */

test("oldest first, with a total order even on a shared timestamp", () => {
  /* Two messages CAN share a server timestamp. Without the id tiebreak the
     order would differ between readers for the same conversation. */
  const out = mergeChat({
    channel: [],
    stored: [
      store({ messageId: "b", createdAtMs: 5_000 }),
      store({ messageId: "a", createdAtMs: 5_000 }),
      store({ messageId: "c", createdAtMs: 1_000 }),
    ],
    meId: ME,
  });
  assert.deepEqual(out.map((m) => m.id), ["c", "a", "b"]);
});

test("ordering survives a reconnect that replays the channel", () => {
  /* The same messages arriving again, in a different order, must not reorder
     the conversation. */
  const stored = [
    store({ messageId: "a", createdAtMs: 1_000 }),
    store({ messageId: "b", createdAtMs: 2_000 }),
  ];
  const first = mergeChat({ channel: [chan({ id: "a", createdAtMs: 1_000 })], stored, meId: ME });
  const replay = mergeChat({
    channel: [chan({ id: "b", createdAtMs: 2_000 }), chan({ id: "a", createdAtMs: 1_000 })],
    stored,
    meId: ME,
  });
  assert.deepEqual(first.map((m) => m.id), replay.map((m) => m.id));
});

/* ── Delivery status ─────────────────────────────────────────────────────── */

test("a status improves but never regresses", () => {
  /* A late channel echo of a message already confirmed stored must not drag it
     back to "sending", and a retry that succeeds must clear a failure. */
  assert.equal(betterStatus("sending", "sent"), "sent");
  assert.equal(betterStatus("sent", "sending"), "sent");
  assert.equal(betterStatus("failed", "sent"), "sent");
  assert.equal(betterStatus("failed", "sending"), "sending");
  assert.equal(betterStatus("sent", "failed"), "sent");
});

test("a message the ledger confirmed reads as sent", () => {
  const out = mergeChat({ channel: [chan()], stored: [store()], meId: ME });
  assert.equal(out[0].delivery, "sent");
  assert.equal(out[0].stored, true);
});

test("a message only on the channel is still sending", () => {
  const out = mergeChat({ channel: [chan()], stored: [], meId: ME });
  assert.equal(out[0].delivery, "sending");
});

test("a failed write is marked, and the message still renders", () => {
  /* A message that vanished is the bug this whole feature exists to end. */
  const out = mergeChat({
    channel: [chan()],
    stored: [],
    meId: ME,
    failedIds: ["m1"],
  });
  assert.equal(out.length, 1, "a failed message disappeared");
  assert.equal(out[0].delivery, "failed");
});

test("a failure that later succeeds reads as sent", () => {
  const out = mergeChat({
    channel: [chan()],
    stored: [store()],
    meId: ME,
    failedIds: ["m1"],
  });
  assert.equal(out[0].delivery, "sent", "a successful retry stayed failed");
});

/* ── Who said it ─────────────────────────────────────────────────────────── */

test("mine is decided by id, never by name", () => {
  const mine = mergeChat({ channel: [chan({ senderId: ME })], stored: [], meId: ME });
  assert.equal(mine[0].mine, true);
  const theirs = mergeChat({ channel: [chan()], stored: [], meId: ME });
  assert.equal(theirs[0].mine, false);
});

test("an empty viewer id owns nothing", () => {
  /* A guest before their identity resolves must not be shown every message as
     their own. */
  const out = mergeChat({ channel: [chan({ senderId: "" })], stored: [], meId: "" });
  assert.equal(out[0].mine, false);
});

test("a guest is marked as one, and only the ledger may say so", () => {
  /* A guest's display name is self-typed and unverified; the bubble has to be
     able to say so, and a reader cannot tell from the name. */
  const out = mergeChat({
    channel: [chan()],
    stored: [store({ senderKind: "guest" })],
    meId: ME,
  });
  assert.equal(out[0].senderKind, "guest");

  const channelOnly = mergeChat({ channel: [chan()], stored: [], meId: ME });
  assert.equal(channelOnly[0].senderKind, "employee");
});

test("the live name is preferred over the stored one", () => {
  /* So somebody who changes their display name does not leave old bubbles
     under the old one. */
  const out = mergeChat({
    channel: [chan({ senderName: "Asha Rao" })],
    stored: [store({ senderName: "Asha" })],
    meId: ME,
  });
  assert.equal(out[0].senderName, "Asha Rao");
});

/* ── Cursors ─────────────────────────────────────────────────────────────── */

test("the newest STORED instant is what asks for anything newer", () => {
  /**
   * Deliberately not the newest message on screen. A channel message that is
   * not confirmed yet must still come back from the server, or a reader who was
   * offline while it was written would never receive the confirmed copy.
   */
  const merged = mergeChat({
    channel: [chan({ id: "m9", createdAtMs: 9_000 })],
    stored: [store({ messageId: "m1", createdAtMs: 1_000 })],
    meId: ME,
  });
  assert.equal(newestStoredMs(merged), 1_000);
});

test("paging backwards starts at the oldest stored message", () => {
  const merged = mergeChat({
    channel: [chan({ id: "m0", createdAtMs: 10 })],
    stored: [
      store({ messageId: "m1", createdAtMs: 1_000 }),
      store({ messageId: "m2", createdAtMs: 2_000 }),
    ],
    meId: ME,
  });
  assert.equal(oldestStoredMs(merged), 1_000);
});

test("with nothing stored, both cursors ask for the most recent page", () => {
  const merged = mergeChat({ channel: [chan()], stored: [], meId: ME });
  assert.equal(newestStoredMs(merged), 0);
  assert.equal(oldestStoredMs(merged), 0);
});

/* ── Junk ────────────────────────────────────────────────────────────────── */

test("a row with no id is dropped rather than merged into nothing", () => {
  const out = mergeChat({
    channel: [chan({ id: "" })],
    stored: [store({ messageId: "" })],
    meId: ME,
  });
  assert.equal(out.length, 0);
});

test("an empty conversation merges to an empty list", () => {
  assert.deepEqual(mergeChat({ channel: [], stored: [], meId: ME }), []);
});

/* ── Which rooms may persist ─────────────────────────────────────────────── */

test("a real meeting id persists; a task room's name does not", () => {
  /**
   * Mirrors `isRoomName` in the engine, on the client, so the panel never fires
   * a write the ledger will refuse. A task room's LiveKit name is
   * `meet-task-<id>` — a derived string, not a stored-meeting document id — and
   * a row written under it would live under a parent that does not exist.
   */
  for (const id of ["mt_8f2a91", "MEET123", "abc-meet-1", "m-1"]) {
    assert.equal(isPersistableMeetId(id), true, `${id} was refused`);
  }
  for (const id of ["meet-task-T206", "meet-anything", "meet-"]) {
    assert.equal(isPersistableMeetId(id), false, `${id} was allowed to persist`);
  }
  assert.equal(isPersistableMeetId(""), false);
  assert.equal(isPersistableMeetId(null), false);
  assert.equal(isPersistableMeetId(undefined), false);
});
