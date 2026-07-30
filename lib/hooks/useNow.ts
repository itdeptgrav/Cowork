"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, safe to render.
 *
 * Three components used to read `NOW` from the seed fixtures — a clock frozen
 * at 2026-07-25 — so that "2 days ago" lined up with the seeded data. Against
 * **real** data that is a live defect: a message sent this morning is described
 * relative to a date months in the past.
 *
 * Reading `Date.now()` during render is not the fix either. The server renders
 * one instant and the browser another, which React reports as a hydration
 * mismatch and a reader sees as a flicker.
 *
 * `useSyncExternalStore` is the one API that lets the two render *deliberately*
 * different things: the server has no business guessing the reader's clock, so
 * it returns `null` and the relative time appears on hydration.
 *
 * The snapshot is quantised to the minute. `useSyncExternalStore` requires a
 * stable value — one that changed on every call would re-render forever — and a
 * relative timestamp has no use for finer resolution.
 */
export function useNow(): Date | null {
  const minute = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return minute === null ? null : new Date(minute * 60_000);
}

function subscribe(): () => void {
  /* Nothing pushes. A component re-rendering for its own reasons picks up the
     newer minute; nothing here needs to drive a re-render on its own, and a
     timer would wake every mounted list once a minute for a cosmetic change. */
  return () => {};
}

function snapshot(): number {
  return Math.floor(Date.now() / 60_000);
}

function serverSnapshot(): null {
  return null;
}
