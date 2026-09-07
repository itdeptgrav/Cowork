import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The meeting chat that did not fit its own panel.
 *
 * Reported with a screenshot: own messages sliced in half at the right edge of
 * the panel, and the Send button cut off beside the input.
 *
 * Every one of those is the same CSS rule — **a flex item defaults to
 * `min-width: auto`**, which means it may not shrink below its own min-content.
 * Three separate places relied on shrinking that was never going to happen:
 *
 *   · the composer's `<textarea>`, whose min-content comes from `cols` and
 *     therefore demanded roughly TWENTY characters of width however narrow the
 *     panel got — pushing Send off the edge
 *   · the message list, which could not be narrower than its widest child, so
 *     one over-wide message widened the column and every right-aligned bubble
 *     aligned to an edge that was off screen
 *   · the panel itself, whose declared 340px a wide child could simply exceed
 *
 * `flex-1` does not fix any of them. It decides how spare space is SHARED, not
 * whether an item may shrink below its content. `min-w-0` is the opt-in, and it
 * is invisible until a column gets narrow — which is why this only showed up on
 * the meeting panel and never in the wide Messages thread.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CHAT = code("components/features/meetings/MeetingChat.tsx");
const EXTRAS = code("components/features/meetings/RoomExtras.tsx");

/* ── The composer ────────────────────────────────────────────────────────── */

test("the input may shrink, so Send stays on screen", () => {
  const box = CHAT.slice(CHAT.indexOf('id="meeting-chat-input"'));
  assert.match(
    box.slice(0, 1200),
    /min-w-0/,
    "the textarea cannot shrink below ~20 characters and pushes Send off the edge",
  );
});

test("Send and the attach button never shrink", () => {
  /* The elastic thing on that row is the input. A Send button squeezed to
     nothing is not a smaller button, it is an unusable one. */
  const form = CHAT.slice(CHAT.indexOf("<form"));
  const row = form.slice(0, 3000);
  assert.match(row, /h-\[34px\] shrink-0 rounded-lg bg-white\/15/, "Send may shrink");
  assert.match(row, /h-\[34px\] w-\[34px\] shrink-0/, "the attach button may shrink");
});

/* ── The message list ────────────────────────────────────────────────────── */

test("the list may be narrower than its widest message", () => {
  /**
   * Without this, one over-wide child sets the column's width and every
   * right-aligned bubble aligns to that invisible wider edge — where
   * `overflow-x-hidden` then clips it. The message is not scrolled off; it is
   * cut off, with no scrollbar to reach it.
   */
  const list = CHAT.slice(CHAT.indexOf('aria-label="Meeting chat"') - 600);
  assert.match(list.slice(0, 700), /min-h-0 min-w-0 flex-1/);
});

test("the list clips sideways rather than scrolling", () => {
  /* Deliberate: a horizontal scrollbar inside a chat column means finding and
     dragging it to read a message. Clipping is right — there just has to be
     nothing to clip. */
  assert.match(CHAT, /overflow-x-hidden/);
});

/* ── The panel ───────────────────────────────────────────────────────────── */

test("the panel's declared width is the width it gets", () => {
  /* As a flex item it too defaults to `min-width: auto`, so a wide child could
     push it past 340px and over the stage beside it. */
  assert.match(EXTRAS, /w-full min-w-0 shrink-0 flex-col/);
  /* The 340px column is a CONTAINER rule now, not a viewport one — see the
     next test for why. */
  assert.match(EXTRAS, /@min-\[40rem\]:w-\[340px\]/);
});

test("the panel covers the stage on a narrow ROOM, decided by the room's width", () => {
  /**
   * **This used to pin `md:` — a viewport breakpoint — and that was the bug.**
   *
   * The room is drawn at three widths on the same screen: ~830px docked on a
   * desk, 340px in the corner window on that desk, ~350px docked on a phone.
   * A viewport rule put the 340px corner window on a 1440px screen into the
   * side-by-side layout — a 340px panel beside a 340px window, off the edge
   * of the frame, clipped by its `overflow-hidden`. Pressing Chat drew
   * nothing, and the stage shrank for a panel nobody could see. Measured on
   * the running dev server at 375px: the panel sat at x=298→649 inside a
   * 351px frame.
   *
   * So the rule reads the ROOM's width through a `@container` root, and below
   * 40rem the panel lays itself over the stage rather than beside it — the
   * control bar is outside that row, so the microphone and Leave stay
   * reachable and the × brings the picture back.
   */
  assert.match(EXTRAS, /absolute inset-0 z-20/, "the panel no longer overlays the stage");
  assert.match(EXTRAS, /@min-\[40rem\]:static/, "the wide layout is not a container rule");
  assert.match(EXTRAS, /@min-\[40rem\]:border-l/);
  assert.doesNotMatch(
    EXTRAS,
    /(?<!@)\bmd:w-\[340px\]/,
    "the panel is back on a viewport breakpoint, which the corner window cannot satisfy",
  );
  /* Every room mounts the container root around its stage row, or the rule
     above has nothing to read. */
  const interior = code("components/features/meetings/RoomInterior.tsx");
  const guest = code("components/features/meetings/GuestRoom.tsx");
  assert.match(interior, /@container flex min-h-0 min-w-0 flex-1 flex-col/);
  assert.match(guest, /@container flex min-h-0 min-w-0 flex-1 flex-col/);
});

/* ── The bubble ──────────────────────────────────────────────────────────── */

test("a long name shrinks, and the time and Guest badge do not", () => {
  /**
   * Whose message it is and when they sent it are what that row is FOR. A long
   * name is the only elastic part, so it is the only part allowed to give — and
   * a guest's badge must survive, because it is the only thing telling a reader
   * the name above it is self-typed and unverified.
   */
  const header = CHAT.slice(CHAT.indexOf("m.senderName || m.senderId") - 400);
  const row = header.slice(0, 1400);
  assert.match(row, /min-w-0 truncate text-\[11px\]/, "a long name cannot shrink");
  assert.match(row, /shrink-0 rounded bg-white\/10[^"]*Guest|Guest/, "the badge is missing");
  assert.match(row, /shrink-0 text-\[10px\] tabular-nums/, "the timestamp may shrink");
  assert.match(row, /title=\{m\.senderName/, "the full name is unreachable once truncated");
});

test("the bubble cannot be widened from inside", () => {
  assert.match(CHAT, /min-w-0 max-w-\[85%\]/);
  assert.match(CHAT, /min-w-0 rounded-2xl px-3 py-2/);
});

test("message text wraps rather than widening the bubble", () => {
  /* A pasted URL or a token with no spaces is the ordinary case that would
     otherwise set the column's width on its own. */
  assert.match(CHAT, /whitespace-pre-wrap break-words/);
});

/* ── The shared card, which started this ─────────────────────────────────── */

test("the attachment card caps its width instead of fixing it", () => {
  /* Covered in full by attachmentWidth.test.ts; asserted here too because it is
     the child that first exposed every missing `min-w-0` above. */
  const attach = code("components/features/messages/MessageAttachments.tsx");
  assert.doesNotMatch(attach, /(?<!max-)w-\[19rem\]/);
  assert.match(attach, /max-w-\[19rem\]/);
});
