import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The chat extras — reactions, star, pin, in-thread search, swipe-to-reply,
 * long-press, and phone links — and the wiring decisions in them that fail
 * silently:
 *
 * · both stores implementing the same optional methods, so switching backend
 *   does not quietly lose a feature;
 * · the shared rules (`reactionChanges`, `withPin`) actually being what the
 *   stores apply, so the cap and the one-reaction rule cannot drift;
 * · the mappers reading the new fields, without which every write "works" and
 *   nothing ever renders;
 * · the touch gestures cooperating with scrolling rather than hijacking it.
 */

const AREA = "components/features/messages/MessagesArea.tsx";
const MENU = "components/features/messages/MessageContextMenu.tsx";
const TYPES = "lib/repositories/types.ts";
const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";
const MESSAGING = "lib/repositories/legacy/messaging.ts";
const LINKIFY = "lib/utils/linkify.tsx";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── Both stores, same contract ───────────────────────────────────────────── */

test("both repositories implement every chat extra the contract names", () => {
  for (const method of [
    "toggleMessageReaction",
    "toggleMessageStar",
    "pinMessage",
    "unpinMessage",
  ]) {
    assert.match(code(TYPES), new RegExp(`${method}\\?\\(`), `${method} is not in the contract`);
    for (const path of [LEGACY, MOCK]) {
      assert.match(
        code(path),
        new RegExp(`async ${method}\\(`),
        `${path} does not implement ${method}`,
      );
    }
  }
});

test("the one-reaction-per-person rule is the SHARED one in both stores", () => {
  assert.match(code(LEGACY), /reactionChanges\(readReactions\(data\.reactions\), emoji, me\)/);
  assert.match(code(MOCK), /toggleReaction\(m\.reactions, emoji, actingId\(\)\)/);
});

test("the Firestore reaction write is per-emoji sentinels, merged — not a map rewrite", () => {
  /* A whole-map write lets two people reacting in the same instant clobber
     each other; and `updateDoc` cannot take an emoji in a string field path. */
  const src = code(LEGACY);
  const at = src.indexOf("async toggleMessageReaction(");
  const body = src.slice(at, src.indexOf("async toggleMessageStar(", at));
  assert.match(body, /change === "add" \? arrayUnion\(me\) : arrayRemove\(me\)/);
  assert.match(body, /setDoc\(ref, \{ reactions \}, \{ merge: true \}\)/);
});

test("the pin cap and dedupe are the shared rule in both stores", () => {
  for (const path of [LEGACY, MOCK]) {
    assert.match(code(path), /withPin\(/, `${path} does not apply withPin`);
    assert.match(code(path), /withoutPin\(/, `${path} does not apply withoutPin`);
  }
});

/* ── The mappers read what the writes store ───────────────────────────────── */

test("a stored message's reactions and stars are read back", () => {
  const src = code(MESSAGING);
  assert.match(src, /reactions: readReactions\(d\.reactions\)/);
  assert.match(src, /starredBy: strArray\(d\.starredBy\)/);
});

test("both conversation readers carry the pinned list", () => {
  const src = code(MESSAGING);
  const matches = src.match(/pinned: readPinnedMessages\(d\.pinnedMessages\)/g);
  assert.equal(
    matches?.length,
    2,
    "direct and group conversation docs must BOTH read pinnedMessages",
  );
});

/* ── Phone links ──────────────────────────────────────────────────────────── */

test("the bubble renders through linkifyMessage, so phone numbers link", () => {
  assert.match(code(AREA), /linkifyMessage\(/);
  assert.doesNotMatch(
    code(AREA),
    /[^y]linkify\(/,
    "the bubble reverted to the URL-only linkifier",
  );
});

test("phone detection runs only over the text BETWEEN urls", () => {
  /* Digits inside a pasted URL must never be re-read as a phone number. */
  const src = code(LINKIFY);
  const at = src.indexOf("export function linkifyMessage");
  const body = src.slice(at);
  assert.match(body, /typeof part !== "string"/);
  assert.match(body, /detectPhoneNumbers\(part\)/);
});

/* ── Touch gestures ───────────────────────────────────────────────────────── */

test("swiping left far enough replies — and never on a tombstone", () => {
  const src = code(AREA);
  assert.match(src, /const swiped = t\.horizontal && t\.dx <= -56;/);
  assert.match(src, /if \(swiped && m\.isDeleted !== true\) onReply\(m\);/);
});

test("the swipe leaves vertical scrolling to the browser", () => {
  const src = code(AREA);
  assert.match(src, /touchAction: "pan-y"/);
  /* The drag engages only once decisively horizontal, so a wobbly scroll
     cannot become a reply. */
  assert.match(src, /Math\.abs\(dx\) > 12 && Math\.abs\(dx\) > Math\.abs\(dy\) \* 1\.4/);
});

test("a long press opens the menu, and its release cannot immediately close it", () => {
  const src = code(AREA);
  assert.match(src, /t\.longPressed = true;/);
  assert.match(src, /onContextMenu\(m, t\.x, t\.y\)/);
  const at = src.indexOf("function onRowTouchEnd");
  const body = src.slice(at, src.indexOf("function onRowTouchCancel", at));
  assert.match(body, /if \(t\.longPressed\) \{\s*e\.preventDefault\(\);/);
});

test("any real movement cancels the long-press timer", () => {
  assert.match(
    code(AREA),
    /if \(t\.timer && \(Math\.abs\(dx\) > 8 \|\| Math\.abs\(dy\) > 8\)\) \{\s*clearTimeout\(t\.timer\);/,
  );
});

/* ── The menu ─────────────────────────────────────────────────────────────── */

test("star and pin appear only where the backend can honour them", () => {
  const src = code(AREA);
  assert.match(src, /\.\.\.\(repo\.toggleMessageStar\s*\?/);
  assert.match(src, /\.\.\.\(repo\.pinMessage\s*\?/);
});

test("the reaction bar is withheld from a deleted message", () => {
  assert.match(
    code(AREA),
    /repo\.toggleMessageReaction && menu\.message\.isDeleted !== true/,
  );
  /* And the menu closes before running the pick, like every other item. */
  const menuSrc = code(MENU);
  const at = menuSrc.indexOf("reactions.emojis.map");
  assert.ok(at > 0, "the reaction bar is gone from the menu");
  assert.match(menuSrc.slice(at, at + 600), /onClose\(\);\s*reactions\.onPick\(emoji\)/);
});

/* ── Jumping and searching ────────────────────────────────────────────────── */

test("jumping to an unloaded message pages history with the guarded machinery", () => {
  const src = code(AREA);
  const at = src.indexOf("async function jumpToMessage");
  assert.ok(at > 0, "jumpToMessage is gone");
  const body = src.slice(at, src.indexOf("function jumpToMatch", at));
  /* Bounded — a wrong id must not read a whole archive. */
  assert.match(body, /for \(let hop = 0; hop < 8; hop\+\+\)/);
  /* Each page restores the reader's place exactly like scroll-back does. */
  assert.match(body, /prevScrollHeightRef\.current = el\.scrollHeight;/);
  assert.match(body, /loadingOlderRef\.current = true;/);
  assert.match(body, /setOlderPages\(\(prev\) => \[fresh, \.\.\.prev\]\)/);
  /* Honest when the target is further back than the bound. */
  assert.match(body, /further back in this conversation/);
});

test("in-thread search reads the shared rule over the LOADED thread", () => {
  const src = code(AREA);
  assert.match(src, /searchThread\(list, \{/);
  /* Enter walks matches; the bar can widen what search sees. */
  assert.match(src, /jumpToMatch\(searchAt \+ 1\)/);
  assert.match(src, /Search earlier/);
});
