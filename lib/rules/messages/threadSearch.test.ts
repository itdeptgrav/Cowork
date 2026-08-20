import assert from "node:assert/strict";
import { test } from "node:test";

import { searchThread } from "./threadSearch.ts";
import type { Message } from "@/lib/domain";

const msg = (
  id: string,
  text: string,
  over: Partial<Message> = {},
): Message => ({
  id,
  conversationId: "c1",
  senderId: "E001",
  senderName: "A",
  text,
  attachmentIds: [],
  replyToId: null,
  createdAt: `2026-08-20T10:00:0${id.length}.000Z`,
  readBy: [],
  ...over,
});

test("matches are case-insensitive substrings, in thread order", () => {
  const thread = [
    msg("a", "the Budget is due"),
    msg("b", "lunch?"),
    msg("c", "budget approved"),
  ];
  assert.deepEqual(
    searchThread(thread, { query: "budget", viewerId: "me" }),
    ["a", "c"],
  );
});

test("a blank query matches nothing — not everything", () => {
  assert.deepEqual(
    searchThread([msg("a", "hello")], { query: "  ", viewerId: "me" }),
    [],
  );
});

test("deleted messages never match", () => {
  const thread = [
    msg("a", "This message was deleted.", { isDeleted: true }),
    msg("b", "deleted the file"),
  ];
  assert.deepEqual(
    searchThread(thread, { query: "deleted", viewerId: "me" }),
    ["b"],
  );
});

test("the star filter alone lists the viewer's bookmarks", () => {
  const thread = [
    msg("a", "one", { starredBy: ["me"] }),
    msg("b", "two", { starredBy: ["someone-else"] }),
    msg("c", "three"),
  ];
  assert.deepEqual(
    searchThread(thread, { query: "", starredOnly: true, viewerId: "me" }),
    ["a"],
  );
});

test("query and star filter intersect", () => {
  const thread = [
    msg("a", "budget one", { starredBy: ["me"] }),
    msg("b", "budget two"),
  ];
  assert.deepEqual(
    searchThread(thread, {
      query: "budget",
      starredOnly: true,
      viewerId: "me",
    }),
    ["a"],
  );
});

test("with no viewer, the star filter matches nothing rather than guessing", () => {
  assert.deepEqual(
    searchThread([msg("a", "x", { starredBy: ["me"] })], {
      query: "",
      starredOnly: true,
      viewerId: null,
    }),
    [],
  );
});
