import assert from "node:assert/strict";
import { test } from "node:test";
import { wheelPan, type WheelInput } from "./wheelPan.ts";

/* A rail 400px wide holding 700px of tabs: 300px of travel, scrolled to the
   start. Every case below varies one thing off this. */
const RAIL: WheelInput = {
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  scrollLeft: 0,
  scrollWidth: 700,
  clientWidth: 400,
};

const at = (scrollLeft: number, over: Partial<WheelInput> = {}): WheelInput => ({
  ...RAIL,
  scrollLeft,
  ...over,
});

test("a wheel mouse pans the rail — this is the whole bug", () => {
  /* deltaY only, which is all a wheel mouse ever emits. */
  const r = wheelPan(at(0, { deltaY: 120 }));
  assert.equal(r.delta, 120);
  assert.equal(r.preventDefault, true);
});

test("wheeling back pans back", () => {
  const r = wheelPan(at(200, { deltaY: -120 }));
  assert.equal(r.delta, -120);
  assert.equal(r.preventDefault, true);
});

test("a trackpad's horizontal swipe is left to the browser", () => {
  /* The browser already applies deltaX. Adding our own would double it. */
  assert.deepEqual(wheelPan(at(0, { deltaX: 80, deltaY: 4 })), {
    delta: 0,
    preventDefault: false,
  });
});

test("a diagonal trackpad swipe still belongs to the browser at equal magnitude", () => {
  assert.equal(wheelPan(at(0, { deltaX: 40, deltaY: 40 })).delta, 0);
  assert.equal(wheelPan(at(0, { deltaX: 40, deltaY: 60 })).delta, 60, "vertical wins");
});

test("a rail that fits is not touched", () => {
  const fits = wheelPan({ ...RAIL, deltaY: 120, scrollWidth: 400, clientWidth: 400 });
  assert.deepEqual(fits, { delta: 0, preventDefault: false });
});

test("at the end the page gets the gesture — a sticky bar must not trap the scroll", () => {
  /* This is the rule that keeps the top bar usable: the pointer sits over it
     for the whole of an ordinary read. */
  assert.deepEqual(wheelPan(at(300, { deltaY: 120 })), {
    delta: 0,
    preventDefault: false,
  });
  assert.deepEqual(wheelPan(at(0, { deltaY: -120 })), {
    delta: 0,
    preventDefault: false,
  });
});

test("the last notch lands exactly on the end rather than being discarded", () => {
  const r = wheelPan(at(250, { deltaY: 120 }));
  assert.equal(r.delta, 50, "clamped to the travel left, not dropped for overshooting");
  assert.equal(r.preventDefault, true);
});

test("line and page deltas are converted, not read as pixels", () => {
  /* Firefox on Windows reports lines. Three lines is a notch, not three pixels. */
  assert.equal(wheelPan(at(0, { deltaY: 3, deltaMode: 1 })).delta, 48);
  assert.equal(wheelPan(at(0, { deltaY: 1, deltaMode: 2 })).delta, 300, "a page, clamped");
});

test("a sub-pixel tick is not a scroll", () => {
  assert.deepEqual(wheelPan(at(0, { deltaY: 0.4 })), {
    delta: 0,
    preventDefault: false,
  });
  assert.deepEqual(wheelPan(at(0, { deltaY: 0 })), { delta: 0, preventDefault: false });
});

test("delta and preventDefault never disagree", () => {
  /* A prevented event that scrolls nothing is a dead gesture: the page stops
     moving and nothing takes its place. */
  const cases: WheelInput[] = [
    at(0, { deltaY: 120 }),
    at(300, { deltaY: 120 }),
    at(0, { deltaX: 80, deltaY: 4 }),
    at(0, { deltaY: 0.4 }),
    { ...RAIL, deltaY: 120, scrollWidth: 400 },
  ];
  for (const c of cases) {
    const r = wheelPan(c);
    assert.equal(r.preventDefault, r.delta !== 0);
  }
});
