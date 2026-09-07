import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The speaker picker that showed an empty panel and a stray chevron.
 *
 * Reported as "the dropdown for audio options is not showing directly/properly"
 * with a screenshot of a large empty panel headed SPEAKER, a lone chevron in it,
 * and no devices anywhere.
 *
 * The cause was a popup inside a popup. Each section rendered LiveKit's
 * `<MediaDeviceMenu>`, which is not a list — it is a BUTTON that opens a popup
 * of its own. Nested in the overflow menu that gave two nested popups: the
 * trigger squeezed to a 1.15rem stub by `.lk-cowork-device-menu .lk-button` (a
 * rule written for the chevron beside the microphone, where a stub is correct),
 * and LiveKit's own popup positioned against the wrong element.
 *
 * One class was doing two contradictory jobs — the comment directly under that
 * rule says the overflow trigger should be "a full-width row, not a chevron",
 * while the rule above it sets the width of a chevron.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const BAR = code("components/features/meetings/MeetingControlBar.tsx");
const CSS = readFileSync("app/globals.css", "utf8");

/* ── The nesting is gone ─────────────────────────────────────────────────── */

test("the overflow menu lists devices instead of nesting a second popup", () => {
  for (const kind of ["audiooutput", "audioinput", "videoinput"]) {
    assert.match(
      BAR,
      new RegExp(`<DeviceOptions kind="${kind}"`),
      `${kind} still opens a nested menu`,
    );
  }
});

test("exactly one LiveKit device menu survives — the row chevron", () => {
  /**
   * The chevron beside the microphone IS a trigger, and a stub is the right
   * shape for it. That one keeps `MediaDeviceMenu` and keeps the CSS class; the
   * overflow sections no longer use either.
   */
  const uses = BAR.match(/<MediaDeviceMenu/g) ?? [];
  assert.equal(uses.length, 1, "a nested device menu is back in the overflow");
  assert.match(BAR, /<MediaDeviceMenu kind=\{deviceKind\} \/>/);
});

test("the section wrapper no longer carries the chevron class", () => {
  /* `.lk-cowork-device-menu .lk-button` sets `width: 1.15rem` — that rule IS
     the stray chevron in the report. It stays for the row trigger and must not
     reach the overflow sections again. */
  const section = BAR.slice(BAR.indexOf("function MenuSection("));
  assert.doesNotMatch(
    section.slice(0, 500),
    /lk-cowork-device-menu/,
    "the section is styling a LiveKit trigger it no longer renders",
  );
  assert.match(CSS, /\.lk-cowork-device-menu \.lk-button/, "the chevron rule is gone");
});

/* ── It uses the same machinery, only a different presentation ───────────── */

test("device enumeration and switching stay LiveKit's", () => {
  /* `useMediaDeviceSelect` is the hook LiveKit builds its own menu on, so
     permission handling, enumeration and switching are unchanged. Only the
     presentation is ours — which is what makes this a UI fix rather than a
     reimplementation of device handling. */
  assert.match(BAR, /useMediaDeviceSelect/);
  assert.match(BAR, /setActiveMediaDevice\(d\.deviceId\)/);
  assert.doesNotMatch(BAR, /navigator\.mediaDevices\.enumerateDevices/);
});

/* ── States the floor requires ───────────────────────────────────────────── */

test("no devices is a stated state, not a blank strip", () => {
  /**
   * Real and common: a browser that has not been granted the microphone
   * enumerates nothing, and so does a machine with no camera. Rendering nothing
   * leaves a section heading over empty space, which reads as broken — which is
   * exactly how the original bug read.
   */
  const fn = BAR.slice(BAR.indexOf("function DeviceOptions("));
  assert.match(fn.slice(0, 2500), /devices\.length === 0/);
  assert.match(fn.slice(0, 2500), /None found yet/);
});

test("the active device is marked, and marked with a drawn icon", () => {
  /* A "✓" character is a different typeface on every machine and would not
     match the stroke of the icons beside it. */
  assert.match(BAR, /aria-checked=\{active\}/);
  assert.match(BAR, /<CheckIcon \/>/);
  assert.match(BAR, /function CheckIcon\(\)/);
  assert.doesNotMatch(BAR, /✓/, "a glyph is standing in for the icon system");
});

test("the icon slot is drawn even when unchecked, so names share one edge", () => {
  const fn = BAR.slice(BAR.indexOf("function DeviceOptions("));
  assert.match(fn.slice(0, 3000), /active \? <CheckIcon \/> : null/);
});

test("a device the browser will not name is still distinguishable", () => {
  /* Before permission is granted, labels are empty strings — three identical
     blank rows without this. */
  const fn = BAR.slice(BAR.indexOf("function DeviceOptions("));
  assert.match(fn.slice(0, 3000), /d\.label \|\| `Device \$\{i \+ 1\}`/);
});

test("each option is a radio in the menu, not a plain button", () => {
  assert.match(BAR, /role="menuitemradio"/);
});

/* ── Responsive ──────────────────────────────────────────────────────────── */

test("a driver-named device cannot push the menu off a phone", () => {
  /**
   * Devices are named by their driver — "Speakers (Realtek(R) Audio)",
   * "Headset Earphone (Jabra Evolve2 65)". With `w-max` alone, one of those on
   * a 375px screen pushed the menu past the edge, taking the row that closes it
   * with it.
   */
  assert.match(BAR, /max-w-\[min\(17rem,calc\(100vw-2rem\)\)\]/);
  assert.match(BAR, /truncate/);
  assert.match(BAR, /title=\{name\}/, "the full name is unreachable when truncated");
});

test("a long device list cannot run off the top of the screen", () => {
  /* The menu opens UPWARDS from the control bar, so an uncapped list of eight
     audio devices — ordinary on a docked laptop — runs past the meeting. */
  assert.match(BAR, /max-h-\[min\(60vh,26rem\)\]/);
  assert.match(BAR, /overflow-y-auto/);
  assert.match(BAR, /overscroll-contain/, "scrolling the menu scrolls the page behind it");
});

/* ── And the menu still closes ───────────────────────────────────────────── */

test("choosing a device closes the menu, like every other row", () => {
  /* Every other row in this menu closes it. A device row that stayed open
     would be the only one that did not, and the person has finished. */
  const overflow = BAR.slice(BAR.indexOf("{overflow && ("));
  assert.match(
    overflow.slice(0, 3000),
    /onPick=\{\(\) => setOverflow\(false\)\}/,
  );
});
