import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The attachment card that was wider than the panel it was in.
 *
 * Reported from the meeting room: own messages were sliding off the right edge
 * of the chat panel and being cut in half.
 *
 * The card carried a DEFINITE width — `w-[19rem]`, 304px — chosen for the
 * Messages thread, where a document card needs to be wide enough to read a
 * filename. The meeting side panel is 340px, and after the list and bubble padding a card has about 292px to sit in. So the card was wider than its
 * whole column before the bubble's padding was counted, the list forced itself
 * wider than the panel, and `overflow-x-hidden` on that list then CLIPPED the
 * overflow rather than scrolling it — which is how an entire message can
 * disappear off the side with nothing to show it was ever there.
 *
 * `max-w-full` was already on that element and could not help: the bubble
 * around it is shrink-to-fit, so a percentage cap resolves against a width the
 * child is itself deciding.
 *
 * This component is shared by FOUR surfaces — the Messages thread, task chat,
 * internal mail and now the meeting room — so a width that suits the widest one
 * is a bug in the narrowest.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ATTACH = code("components/features/messages/MessageAttachments.tsx");
const CHAT = code("components/features/meetings/MeetingChat.tsx");

/* ── The card may cap its width; it may not fix it ───────────────────────── */

test("the card's width is a maximum, never a definite width", () => {
  assert.match(ATTACH, /max-w-\[19rem\]/, "the document cap is gone");
  assert.match(ATTACH, /max-w-\[200px\]/, "the image cap is gone");
  /* The lookbehind matters: `\b` alone matches INSIDE `max-w-[19rem]`, because
     a word boundary sits between the hyphen and the `w`. Without it this test
     fails on the very fix it is here to protect. */
  assert.doesNotMatch(
    ATTACH,
    /(?<!max-)w-\[19rem\]/,
    "a definite width is back — it overflows any column with less than 304px of usable width",
  );
  assert.doesNotMatch(
    ATTACH,
    /(?<!max-)w-\[200px\]/,
    "a definite width is back",
  );
});

test("and it has a shrinkable basis, so the cap can actually bite", () => {
  /**
   * `w-full` is what gives the card a width to shrink FROM. Without it, in a
   * shrink-to-fit bubble the card resolves to its max-content width and the cap
   * never applies — which is the state that shipped.
   */
  const wrapper = ATTACH.slice(ATTACH.indexOf("flex w-full flex-col gap-1.5"));
  assert.match(wrapper.slice(0, 200), /w-full/);
});

test("the wide thread still gets a readable document card", () => {
  /* The point of 19rem: boxing a file card into 200px truncated
     "GRAV_Scanner_v5_5_O…" to a name nobody could read. A cap keeps that in a
     wide thread and only gives way where there is genuinely no room. */
  assert.match(ATTACH, /max-w-\[19rem\]/);
});

/* ── The bubble cannot be widened from inside ────────────────────────────── */

test("the meeting bubble cannot be pushed past its parent's cap", () => {
  /**
   * The 85% cap sits on the bubble's PARENT. Without `min-w-0` on the bubble
   * itself, a child with a definite width sets the bubble's width and simply
   * overflows that capped parent — which is what happened here.
   */
  const bubble = CHAT.slice(CHAT.indexOf("rounded-2xl px-3 py-2"));
  assert.match(bubble.slice(-0), /./);
  assert.match(CHAT, /min-w-0 rounded-2xl px-3 py-2/);
});

test("the message list still clips rather than scrolling sideways", () => {
  /* Horizontal scrolling inside a chat column is worse than the bug: the
     reader has to find and drag a scrollbar to read a message. Clipping is
     right — it just has to have nothing to clip. */
  assert.match(CHAT, /overflow-x-hidden/);
});

test("own messages are still right-aligned within a capped width", () => {
  assert.match(CHAT, /mine \? "justify-end" : "justify-start"/);
  assert.match(CHAT, /min-w-0 max-w-\[85%\]/);
});

/* ── Every surface that shares the card ──────────────────────────────────── */

test("all four surfaces render the same card component", () => {
  /**
   * Named so the next person changing a width here knows what they are
   * changing. A definite width that suits the widest of these is a bug in the
   * narrowest, which is exactly how this one shipped.
   */
  const surfaces = [
    "components/features/messages/MessagesArea.tsx",
    "components/features/tasks/ChatPanel.tsx",
    "components/features/mail/MailThreadView.tsx",
    "components/features/meetings/MeetingChat.tsx",
  ];
  for (const path of surfaces) {
    assert.match(
      code(path),
      /<MessageAttachments/,
      `${path} no longer shares the card — check its width separately`,
    );
  }
});

test("the narrowest of them is the meeting panel, and it is narrower than the old width", () => {
  /* 340px, less ~44px of list and bubble padding, against a 304px card. The arithmetic that caused the report, kept
     here so a future width change has to face it. */
  const extras = code("components/features/meetings/RoomExtras.tsx");
  /* A CONTAINER query now (`@min-[40rem]:`) rather than a viewport one: the
     panel sits inside a room that is a page, a 340px corner window or a
     picture-in-picture document, so what matters is the room's width and not
     the screen's. The 340px the arithmetic below depends on is unchanged. */
  assert.match(
    extras,
    /@min-\[40rem\]:w-\[340px\]/,
    "the panel width moved; re-check the card cap against it",
  );
});
