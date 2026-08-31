"use client";

import { useLayoutEffect } from "react";
import type { RefObject } from "react";

/**
 * Grow a textarea to fit its content, up to a ceiling, then let it scroll.
 *
 * ## The behaviour this fixes
 *
 * A composer fixed at one row scrolls the moment a second line is typed — the
 * text you just wrote slides out of view behind a scrollbar while the box stays
 * the same size. Reported against exactly that: the scrollbar appeared
 * immediately. What people expect from every messaging product is the box
 * GROWING as they type, and only scrolling once it has taken as much height as
 * it is allowed.
 *
 * ## How it measures
 *
 * Height is set to `auto` first, then to `scrollHeight`. The reset matters:
 * without it the box could only ever grow, because `scrollHeight` never falls
 * below the current fixed height — so deleting lines would leave it stuck tall.
 * Measuring from `auto` lets it shrink back down a line at a time too.
 *
 * Past the ceiling the height stops and `overflow-y` flips to `auto`, so the
 * scrollbar appears ONLY at the maximum and never before it — the stated rule.
 *
 * ## Why a layout effect, and why keyed on `value`
 *
 * `useLayoutEffect` runs before the browser paints, so the box is never seen at
 * the wrong height for a frame. Keying on `value` means it re-measures on every
 * change the box does not raise an `input` event for as well — a restored draft,
 * a clear after send, a paste handled in code — which an `onInput` handler alone
 * would miss, leaving the height wrong until the next keystroke.
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxPx = 128,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxPx);
    el.style.height = `${next}px`;
    /* Hidden below the ceiling so the box shows no scrollbar while it still has
       room to grow; auto at the ceiling so the overflow becomes scrollable. */
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  }, [ref, value, maxPx]);
}
