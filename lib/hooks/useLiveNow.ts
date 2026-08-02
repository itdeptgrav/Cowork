"use client";

import { useEffect, useState } from "react";

/**
 * The wall clock, ticking every second.
 *
 * **Not `useNow`** (lib/hooks/useNow.ts) — that one is quantised to the MINUTE
 * for coarse relative-time labels ("2 minutes ago"), which makes it always at
 * or behind the real instant. Computing a running timer's elapsed seconds
 * against it (`now - startedAtRealMs`) goes NEGATIVE for any session that
 * started within the current minute — which a fresh timer always has — and a
 * negative elapsed reads as zero work done. That was a real bug here: a task
 * played for a few seconds never showed up as "worked today" until the minute
 * rolled over.
 *
 * This follows the same pattern as `useTicker` in
 * `components/features/tasks/TimerControl.tsx`: seeded once via `useState`'s
 * lazy initializer — the one place reading the wall clock during render is
 * accepted, since the value is captured once at mount and held, never
 * re-derived mid-render — then advanced from an interval in an effect.
 */
export function useLiveNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
