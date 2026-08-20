import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_PINNED_MESSAGES,
  PIN_CAP_REFUSAL,
  PIN_TEXT_LIMIT,
  isPinned,
  withPin,
  withoutPin,
} from "./pins.ts";
import type { PinnedMessage } from "@/lib/domain";

const pin = (id: string, over: Partial<PinnedMessage> = {}): PinnedMessage => ({
  messageId: id,
  senderName: "Ada",
  text: `text of ${id}`,
  pinnedById: "E001",
  pinnedAt: "2026-08-20T10:00:00.000Z",
  ...over,
});

test("a pin is appended, oldest pin first", () => {
  const v = withPin([pin("a")], pin("b"));
  assert.ok(v.ok);
  assert.deepEqual(v.pins.map((p) => p.messageId), ["a", "b"]);
});

test("pinning what is already pinned is a quiet success, not a duplicate", () => {
  const v = withPin([pin("a")], pin("a", { text: "different words" }));
  assert.ok(v.ok);
  assert.equal(v.pins.length, 1);
  /* The original pin stands — re-pinning must not rewrite its record. */
  assert.equal(v.pins[0].text, "text of a");
});

test("the cap refuses with the sentence the product shows", () => {
  const five = Array.from({ length: MAX_PINNED_MESSAGES }, (_, i) =>
    pin(`p${i}`),
  );
  const v = withPin(five, pin("one-more"));
  assert.ok(!v.ok);
  assert.equal(v.refusal, PIN_CAP_REFUSAL);
});

test("the carried quote is capped like a reply quote", () => {
  const v = withPin([], pin("a", { text: "x".repeat(500) }));
  assert.ok(v.ok);
  assert.equal(v.pins[0].text.length, PIN_TEXT_LIMIT);
});

test("unpinning removes exactly one, and a missing id is a no-op", () => {
  const pins = [pin("a"), pin("b")];
  assert.deepEqual(withoutPin(pins, "a").map((p) => p.messageId), ["b"]);
  assert.deepEqual(withoutPin(pins, "zz").map((p) => p.messageId), ["a", "b"]);
});

test("isPinned answers for a list, and for its absence", () => {
  assert.equal(isPinned([pin("a")], "a"), true);
  assert.equal(isPinned([pin("a")], "b"), false);
  assert.equal(isPinned(undefined, "a"), false);
});
