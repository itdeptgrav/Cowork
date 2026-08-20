import assert from "node:assert/strict";
import { test } from "node:test";

import {
  myReaction,
  reactionChanges,
  reactionSummary,
  toggleReaction,
} from "./reactions.ts";

const PALETTE = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/* ── The one-per-person rule ──────────────────────────────────────────────── */

test("a first reaction adds you", () => {
  assert.deepEqual(toggleReaction(undefined, "👍", "me"), { "👍": ["me"] });
});

test("picking the same emoji again takes it back", () => {
  assert.deepEqual(toggleReaction({ "👍": ["me"] }, "👍", "me"), {});
});

test("picking a different emoji REPLACES yours, never adds a second", () => {
  const next = toggleReaction({ "👍": ["me", "other"] }, "❤️", "me");
  assert.deepEqual(next, { "👍": ["other"], "❤️": ["me"] });
});

test("other people's reactions are never touched", () => {
  const next = toggleReaction({ "😂": ["a", "b"] }, "😂", "me");
  assert.deepEqual(next, { "😂": ["a", "b", "me"] });
});

test("an emoji everyone took back disappears rather than lingering at zero", () => {
  assert.deepEqual(toggleReaction({ "🙏": ["me"], "👍": ["x"] }, "🙏", "me"), {
    "👍": ["x"],
  });
});

/* ── The write intents the stores turn into sentinels ─────────────────────── */

test("changes name only what changes", () => {
  assert.deepEqual(reactionChanges({ "👍": ["other"] }, "❤️", "me"), {
    "❤️": "add",
  });
});

test("switching emojis is one remove and one add", () => {
  assert.deepEqual(reactionChanges({ "👍": ["me"] }, "❤️", "me"), {
    "👍": "remove",
    "❤️": "add",
  });
});

test("re-picking your emoji is a remove", () => {
  assert.deepEqual(reactionChanges({ "❤️": ["me", "x"] }, "❤️", "me"), {
    "❤️": "remove",
  });
});

test("the intents and the map agree — one rule, two spellings", () => {
  /* Applying the intents to the current map must land on toggleReaction's
     answer, or the Firestore store and the prototype drift. */
  const current = { "👍": ["me", "a"], "😂": ["b"] };
  const changes = reactionChanges(current, "😂", "me");
  const applied: Record<string, string[]> = {};
  for (const [e, ids] of Object.entries(current)) applied[e] = [...ids];
  for (const [e, change] of Object.entries(changes)) {
    const ids = (applied[e] ?? []).filter((id) => id !== "me");
    applied[e] = change === "add" ? [...ids, "me"] : ids;
    if (applied[e].length === 0) delete applied[e];
  }
  assert.deepEqual(applied, toggleReaction(current, "😂", "me"));
});

/* ── Reading ──────────────────────────────────────────────────────────────── */

test("myReaction names the emoji you hold, or null", () => {
  assert.equal(myReaction({ "👍": ["a"], "😢": ["me"] }, "me"), "😢");
  assert.equal(myReaction({ "👍": ["a"] }, "me"), null);
  assert.equal(myReaction(undefined, "me"), null);
});

test("chips sort by count, ties by palette order, and mark yours", () => {
  const chips = reactionSummary(
    { "🙏": ["a"], "👍": ["me"], "❤️": ["b", "c"] },
    "me",
    PALETTE,
  );
  assert.deepEqual(chips, [
    { emoji: "❤️", count: 2, mine: false },
    { emoji: "👍", count: 1, mine: true },
    { emoji: "🙏", count: 1, mine: false },
  ]);
});

test("empty entries never become chips", () => {
  assert.deepEqual(reactionSummary({ "👍": [] }, "me", PALETTE), []);
  assert.deepEqual(reactionSummary(undefined, "me", PALETTE), []);
});
