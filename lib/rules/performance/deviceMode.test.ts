import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  DEVICE_MODES,
  heartbeatIntervalMs,
  mayThrottle,
  performanceProfile,
  readStoredMode,
  shouldSuggestLowMode,
  suggestionReason,
  type DeviceMode,
  type DeviceSignals,
} from "./deviceMode.ts";
import {
  HEARTBEAT_INTERVAL_MS,
  STALE_AFTER_MS,
} from "../presence/duty.ts";

/**
 * Performance mode: rendering only, never behaviour.
 *
 * The tests that matter here are the REFUSALS. It is easy to make an interface
 * cheaper by making it wrong, and every saving below had a version that would
 * have broken something — the presence heartbeat most of all.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const ALL: DeviceMode[] = ["high", "balanced", "low"];

const signals = (over: Partial<DeviceSignals> = {}): DeviceSignals => ({
  cores: null,
  memoryGb: null,
  prefersReducedMotion: false,
  saveData: false,
  ...over,
});

/* ── The line the mode must not cross ─────────────────────────────────────── */

test("no mode slows the presence heartbeat", () => {
  /* **The trap.** "Reduce polling frequency" is the obvious saving and it would
     mark working people as offline: `readDutyMode` treats a beat older than
     `STALE_AFTER_MS` as away, and the offline gate then refuses to start their
     timer. A performance setting that logs somebody out is not one. */
  for (const mode of ALL) {
    assert.equal(
      heartbeatIntervalMs(mode),
      HEARTBEAT_INTERVAL_MS,
      `${mode} changed the heartbeat`,
    );
  }
  /* And two beats still fit inside the staleness window, which is the property
     that makes 45s safe in the first place. */
  assert.ok(HEARTBEAT_INTERVAL_MS * 2 < STALE_AFTER_MS);
});

test("the profile has no field that could reach presence", () => {
  /* A reviewer should be able to satisfy themselves from the interface alone
     that no mode touches correctness. If somebody adds `heartbeatMs` here, this
     fails and points them at `heartbeatIntervalMs` and the reason. */
  const src = code("lib/rules/performance/deviceMode.ts");
  const iface = src.slice(
    src.indexOf("export interface PerformanceProfile {"),
    src.indexOf("const HIGH:"),
  );
  for (const banned of ["heartbeat", "stale", "duty", "presence"]) {
    assert.equal(
      new RegExp(banned, "i").test(iface),
      false,
      `PerformanceProfile has a "${banned}" field — the mode is reaching correctness`,
    );
  }
});

test("a correctness-critical interval cannot be throttled past the window", () => {
  /* Belt and braces: the profile has no such field, and if one is ever added
     this clamps it rather than letting somebody's presence expire. */
  assert.equal(mayThrottle({ ms: 10_000, affectsCorrectness: false }), 10_000);
  assert.ok(
    mayThrottle({ ms: 10 * 60_000, affectsCorrectness: true }) < STALE_AFTER_MS,
  );
  /* A value already inside the window is left alone. */
  assert.equal(mayThrottle({ ms: 1_000, affectsCorrectness: true }), 1_000);
});

test("the timer is throttled in DISPLAY only, and derives its figure", () => {
  /* Safe precisely because `elapsedSecs` recomputes from `startedAt` and the
     wall clock — a slower tick shows a coarser number, never a wrong one. If the
     component ever accumulates instead, throttling would start losing seconds. */
  const src = code("components/features/tasks/TimerControl.tsx");
  assert.match(src, /setInterval\(\s*\n?\s*\(\) => setSecs\(elapsedSecs\(startedAtRealMs, Date\.now\(\)\)\),\s*\n?\s*timerTickMs,/);
  assert.equal(
    /setSecs\((?:s|prev|secs)\s*=>\s*(?:s|prev|secs)\s*\+/.test(src),
    false,
    "the timer accumulates ticks — throttling it would now lose seconds",
  );
});

/* ── What each mode actually changes ──────────────────────────────────────── */

test("low mode removes the costs, in the order they matter", () => {
  const low = performanceProfile("low");
  assert.equal(low.blur, false, "backdrop-filter survives low mode");
  assert.equal(low.animations, false);
  assert.equal(low.richCharts, false);
  assert.ok(low.timerTickMs > performanceProfile("high").timerTickMs);
  assert.ok(low.uiPollMs > performanceProfile("high").uiPollMs);

  /* Screen sharing is NOT disabled — presence depends on it, and a mode that
     turned it off would stop somebody being able to go online. Only the
     WATCHER's preview rate drops. */
  assert.equal(low.livePreview, true);
  assert.ok(low.previewFps < performanceProfile("high").previewFps);
});

test("high mode changes nothing", () => {
  const high = performanceProfile("high");
  assert.equal(high.blur, true);
  assert.equal(high.animations, true);
  assert.equal(high.richCharts, true);
  assert.equal(high.timerTickMs, 1000);
});

test("an unknown stored value falls back to balanced, never to low", () => {
  /* Corrupt storage must not silently downgrade somebody's interface. */
  for (const raw of ["", "fast", "LOW", null, "undefined"]) {
    assert.equal(readStoredMode(raw), null, `${String(raw)} was accepted`);
  }
  for (const raw of ["high", "balanced", "low"]) {
    assert.equal(readStoredMode(raw), raw);
  }
});

/* ── Detection suggests; it never imposes ────────────────────────────────── */

test("a missing signal is unknown, never a slow machine", () => {
  /* Safari reports no `deviceMemory` and some browsers no core count. Reading an
     absent value as zero would put half of Safari into low mode on no evidence. */
  assert.equal(shouldSuggestLowMode(signals()), false);
  assert.equal(suggestionReason(signals()), null);
});

test("the signals that do suggest low mode, and why", () => {
  /* An explicit accessibility preference is a decision somebody already made —
     honouring it is not a guess. */
  assert.equal(
    shouldSuggestLowMode(signals({ prefersReducedMotion: true })),
    true,
  );
  assert.equal(shouldSuggestLowMode(signals({ saveData: true })), true);
  assert.equal(shouldSuggestLowMode(signals({ cores: 2 })), true);
  assert.equal(shouldSuggestLowMode(signals({ memoryGb: 4 })), true);

  /* Four cores is an ordinary office laptop and would sweep in far too much. */
  assert.equal(shouldSuggestLowMode(signals({ cores: 4 })), false);
  assert.equal(shouldSuggestLowMode(signals({ memoryGb: 8 })), false);

  /* And every suggestion says WHY, so it is not a mystery. */
  for (const s of [
    signals({ prefersReducedMotion: true }),
    signals({ cores: 2 }),
    signals({ memoryGb: 4 }),
  ]) {
    assert.ok((suggestionReason(s) ?? "").length > 0);
  }
});

test("detection suggests rather than applies", () => {
  /* The signals say nothing about the GPU, which is what actually struggles with
     the blur. Downgrading on that evidence would be acting on a guess about
     somebody's hardware. */
  const ctx = code("components/layout/shell/DeviceModeContext.tsx");
  assert.match(ctx, /suggestion:/);
  /* No path from a signal to a mode change. Asserted as the ABSENCE of the call
     rather than with a pattern spanning the branch — an earlier version of this
     matched across the `useMemo` object literal, where `setMode` appears only as
     a passed-through value, and failed on code that was correct.

     `setMode("low")` exists in exactly one place: the button somebody presses. */
  assert.equal(
    /setMode\("low"\)/.test(ctx),
    false,
    "the provider selects low mode itself instead of offering it",
  );
  /* The offer is a rendered choice with both answers. */
  const ui = code("components/features/settings/DeviceModeSection.tsx");
  assert.match(ui, /setMode\("low"\)/);
  assert.match(ui, /dismissSuggestion/);
});

/* ── The saving is in CSS, so nothing has to remember ────────────────────── */

test("the stylesheet removes the costs without a component opting in", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const low = css.slice(css.indexOf(':root[data-perf="low"]'));
  assert.ok(low.length > 0, "no low-mode stylesheet layer");
  assert.match(low, /backdrop-filter: none/);
  assert.match(low, /transition-duration: 0\.01ms/);
  /* The background field — ten permanently-composited, blurred, endlessly
     animating layers, and the only thing that costs anything AT REST. */
  assert.match(low, /\.field-blob/);
  assert.match(low, /display: none/);
});

test("the field is not rendered at all in low mode, not merely hidden", () => {
  /* Hiding is not enough: `will-change: transform` asks the compositor for a
     layer whether or not the element paints, and on shared-memory graphics the
     layers are the cost. */
  const src = code("components/ui/IridescentField.tsx");
  assert.match(src, /useDeviceMode\(\)/);
  assert.match(src, /return null/);
});

test("the mode is applied before first paint", () => {
  /* Otherwise a weak machine paints one frosted, animated frame and drops it —
     the most expensive frame in the session, and the one the mode exists to
     avoid. */
  const layout = code("app/layout.tsx");
  assert.match(layout, /DEVICE_MODE_BOOT_SCRIPT/);
  const ctx = readFileSync(
    "components/layout/shell/DeviceModeContext.tsx",
    "utf8",
  );
  assert.match(ctx, /DEVICE_MODE_BOOT_SCRIPT = /);
  assert.match(ctx, /dataset\.perf/);
});

/* ── Everything still works ──────────────────────────────────────────────── */

test("no mode disables a feature the product depends on", () => {
  /* The brief's list, asserted as an absence: nothing in the profile can turn
     any of these off, because there is no field for it. */
  const src = code("lib/rules/performance/deviceMode.ts");
  const iface = src.slice(
    src.indexOf("export interface PerformanceProfile {"),
    src.indexOf("const HIGH:"),
  );
  for (const feature of [
    "notification",
    "deadline",
    "screenShare",
    "websocket",
    "listener",
  ]) {
    assert.equal(
      new RegExp(feature, "i").test(iface),
      false,
      `the profile can disable "${feature}"`,
    );
  }
});

test("the three modes are offered with what each one costs", () => {
  assert.deepEqual(
    DEVICE_MODES.map((m) => m.id),
    ["high", "balanced", "low"],
  );
  for (const m of DEVICE_MODES) {
    assert.ok(m.label.length > 0);
    assert.ok(m.hint.length > 20, `${m.id} has no explanation`);
  }
  /* And low mode's own copy promises that nothing stops working, because that is
     the question somebody choosing it is actually asking. */
  const low = DEVICE_MODES.find((m) => m.id === "low");
  assert.match(low?.hint ?? "", /Everything still works/);
});

test("the monitor does not run until asked", () => {
  /* An FPS counter sampling every frame on the machine least able to afford it
     is the observer changing what it observes. */
  const src = code("components/features/settings/PerformanceMonitor.tsx");
  assert.match(src, /useState\(false\)/);
  assert.match(src, /if \(!running\) return;/);
  assert.match(src, /cancelAnimationFrame/);
  /* Sampled once a second, not per frame — a counter re-rendering React sixty
     times a second is the cost it is measuring. */
  assert.match(src, /elapsed >= 1000/);
});
