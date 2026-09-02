"use client";

import { useEffect } from "react";

import {
  LOCAL_CONTINUITY_GAP_MS,
  nextLiveness,
} from "@/lib/rules/tasks/timer";

/**
 * How long this tab has been continuously alive.
 *
 * **Why a tab needs to answer this at all.** A running timer is credited only as
 * far as its last liveness beat plus a grace, and a beat is a network write. So
 * the engine's evidence that somebody was working is really evidence that their
 * network and the backend were reachable — and when those two part company, a
 * person sitting at their desk loses the difference off their record. A backend
 * restart or a stalled connection is indistinguishable, to the engine, from a
 * closed laptop.
 *
 * The tab is the one party that can tell those apart. Its own interval keeps
 * firing while it lives and needs nothing from the network; an unbroken chain of
 * local ticks is first-hand evidence of liveness where an arriving beat is only
 * second-hand. `readAliveSince` reports the start of the current chain, and a
 * beat carries it so the engine can credit a span it could not observe.
 *
 * **It is not a way to claim time a tab did not live through.** A frozen,
 * slept or closed tab stops ticking, its chain breaks, and the banking grace
 * decides exactly as it does today.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Module level, not component state, and that is the point.** `TimerControl`
 * unmounts whenever the task tab changes, and a per-instance ledger would break
 * its own chain on every navigation — reporting a fresh tab to the engine and
 * throwing away the credit this exists to protect. The chain belongs to the
 * browser tab, so it lives as long as the tab does.
 */
let ledger: { aliveSinceMs: number; lastSeenMs: number } | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let mountedCount = 0;

/**
 * The interval only has to be frequent enough that an ordinary gap between
 * folds stays inside `LOCAL_CONTINUITY_GAP_MS`. A hidden tab's timers are
 * clamped to roughly one a minute, so this fires about every 60s at worst —
 * comfortably inside a three-minute window.
 */
const FOLD_INTERVAL_MS = 30_000;

function fold(): void {
  ledger = nextLiveness(ledger, Date.now(), LOCAL_CONTINUITY_GAP_MS);
}

/**
 * The instant this tab has been continuously alive since.
 *
 * **Folds before it answers, and that is load bearing.** A tab woken from a
 * freeze beats on `visibilitychange`, which fires before the next interval tick
 * — so a reader that trusted the stored chain without re-checking the clock
 * would report a chain that spans the freeze and credit time nobody worked.
 * Folding here evaluates the gap up to this instant, every time.
 *
 * For event handlers and effects only. It reads the clock, so it must never be
 * called during a render.
 */
export function readAliveSince(): number {
  fold();
  return (ledger as { aliveSinceMs: number }).aliveSinceMs;
}

/**
 * Keep the chain going while a timer is mounted.
 *
 * Ref-counted: several controls can be on screen — the task panel and the shell
 * pill — and they share one tab, one chain and one interval.
 */
export function useLiveness(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    /* Fold on the way in as well as on the way round: mounting is itself
       evidence the tab is running. */
    fold();
    mountedCount += 1;
    if (ticker === null) ticker = setInterval(fold, FOLD_INTERVAL_MS);

    /* Unthrottled, unlike the interval, so a tab coming back records the
       moment it woke rather than up to a minute later. */
    const onVisible = () => fold();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedCount -= 1;
      document.removeEventListener("visibilitychange", onVisible);
      if (mountedCount <= 0 && ticker !== null) {
        clearInterval(ticker);
        ticker = null;
      }
    };
  }, [active]);
}
