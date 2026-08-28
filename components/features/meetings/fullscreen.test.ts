import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { nextFullscreenAction } from "@/lib/legacy-ui/useFullscreen";

/**
 * The meeting had two ways to get smaller and none to get bigger.
 *
 * A room sat in a card, in a page, beside a details panel and a transcript.
 * Somebody sharing their screen was sharing it into a rectangle a few hundred
 * pixels wide — legible as "a screen is being shared", useless as "read this".
 * The header offered pop-out (smaller) and picture-in-picture (smaller again).
 *
 * These cover the control itself, and the two things about it that are easy to
 * get wrong: what it does when something ELSE holds the screen, and staying
 * truthful when full screen ends without anybody pressing it.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROOM = "components/features/meetings/MeetingRoom.tsx";
const GUEST = "components/features/meetings/GuestMeetingArea.tsx";
const HOOK = "lib/legacy-ui/useFullscreen.ts";
const ICONS = "components/ui/Icons.tsx";

/* ---------------------------------------------------------------- decision */

test("pressing full screen on an element that has it exits", () => {
  const el = {} as Element;
  assert.equal(nextFullscreenAction(el, el), "exit");
});

test("pressing full screen when nothing has it enters", () => {
  const el = {} as Element;
  assert.equal(nextFullscreenAction(null, el), "enter");
});

test("pressing full screen while SOMETHING ELSE has it takes the screen", () => {
  /* The case that would be wrong as "none". A `<video>` can go full screen on
     its own; asking for the meeting frame then must replace it, which is what
     `requestFullscreen` does, and which is what the reader meant. */
  const meetingFrame = {} as Element;
  const someVideo = {} as Element;
  assert.equal(nextFullscreenAction(someVideo, meetingFrame), "enter");
});

test("no element yet means there is nothing to do", () => {
  assert.equal(nextFullscreenAction(null, null), "none");
  assert.equal(nextFullscreenAction({} as Element, null), "none");
});

/* -------------------------------------------------------------- the button */

test("the meeting room offers a full-screen control", () => {
  const src = code(ROOM);
  assert.match(src, /toggleFullscreen/);
  assert.match(src, /Icon\.expand/);
  assert.match(src, /Icon\.collapse/);
});

test("the full-screen control is labelled both ways round", () => {
  const src = readFileSync(ROOM, "utf8");
  assert.match(src, /"Exit full screen"/);
  assert.match(src, /Full screen"/);
});

test("the frame itself is what goes full screen, not the video grid", () => {
  /* A grid with no control bar is a meeting somebody cannot mute, cannot stop
     recording and cannot leave. The ref belongs on the section that holds the
     header and the controls too. */
  const src = code(ROOM);
  assert.match(src, /<section\s+ref=\{fullscreenRef\}/);
});

test("the corner window does not offer full screen", () => {
  /* `compact` is the 340px floating window and the picture-in-picture one.
     Neither has a screen of its own to fill; `Open` is the way out. */
  const src = code(ROOM);
  assert.match(src, /!compact && canFullscreen/);
});

test("the control is hidden where the browser cannot do it", () => {
  const src = code(ROOM);
  assert.match(src, /canFullscreen/);
});

test("guests get the same control", () => {
  const src = code(GUEST);
  assert.match(src, /useFullscreen\(\)/);
  assert.match(src, /toggleFullscreen/);
  assert.match(src, /ref=\{fullscreenRef\}/);
});

/* ------------------------------------------------------------ truthfulness */

test("the state comes from the browser, not from a flag set on click", () => {
  /* Escape, F11 and the operating system all end full screen without touching
     this button. A local boolean would then say "Exit full screen" over a
     window that is not full screen. */
  const src = code(HOOK);
  assert.match(src, /useSyncExternalStore/);
  assert.match(src, /"fullscreenchange"/);
  assert.doesNotMatch(src, /setIsFullscreen/);
});

test("the button reflects OUR element, not merely that something is full screen", () => {
  const src = code(HOOK);
  assert.match(src, /fullscreenElement === el/);
});

test("the server render says nothing is full screen", () => {
  /* Otherwise the first client paint disagrees with the server's and React
     reports a hydration mismatch — over an icon, which is a poor trade. */
  const src = code(HOOK);
  assert.match(src, /readNothingFullscreen/);
  assert.match(src, /return null;/);
});

test("Safari's prefixed names are handled", () => {
  const src = code(HOOK);
  assert.match(src, /webkitRequestFullscreen/);
  assert.match(src, /webkitExitFullscreen/);
  assert.match(src, /webkitFullscreenElement/);
  assert.match(src, /webkitfullscreenchange/);
});

test("a rejected request does not become an unhandled rejection", () => {
  /* Browsers reject `requestFullscreen` when they judge the click was not a
     real user gesture. There is nothing to tell the reader: the screen either
     filled or it did not, and pressing again is the whole recovery. */
  const src = readFileSync(HOOK, "utf8");
  assert.match(src, /catch\s*\{/);
});

test("the listener is removed when the room unmounts", () => {
  const src = code(HOOK);
  assert.match(src, /removeEventListener\("fullscreenchange"/);
  assert.match(src, /removeEventListener\("webkitfullscreenchange"/);
});

/* ------------------------------------------------------------------- looks */

test("the full screen is positioned in AUTHOR css, not left to the browser", () => {
  /* The one that would have shipped broken. A browser makes an element full
     screen with a UA rule — `:fullscreen { position: fixed; inset: 0 }` — and
     UA styles are the weakest origin in the cascade, so Tailwind's `relative`
     beats it. The result is an element lifted into the top layer, painted over
     everything, and laid out exactly where it was: card-sized, in the wrong
     place, over the page. Saying `fixed inset-0` in author CSS is what makes
     full screen actually fill the screen. */
  for (const path of [ROOM, GUEST]) {
    const src = code(path);
    assert.match(
      src,
      /isFullscreen\s*\n?\s*\?\s*"slab slab-flat fixed inset-0/,
      `${path} must position itself when full screen`,
    );
  }
});

test("the card loses its rounded corners on the full screen", () => {
  /* Rounded corners against the black backdrop a browser paints behind a
     full-screen element read as a photograph of a window rather than the
     screen itself. */
  const src = code(ROOM);
  assert.doesNotMatch(src, /fixed inset-0 flex h-full w-full[^"]*rounded-card/);
  assert.match(src, /relative flex h-full min-h-\[520px\][^"]*rounded-card/);
});

test("expand and collapse are distinct from the pop-out arrow", () => {
  /* They sit next to each other in the header. `external` means "open it
     somewhere else"; these mean "the same thing, bigger". */
  const src = readFileSync(ICONS, "utf8");
  assert.match(src, /expand: \(p: P\)/);
  assert.match(src, /collapse: \(p: P\)/);
});
