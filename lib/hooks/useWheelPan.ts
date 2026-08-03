"use client";

import { useCallback, useRef } from "react";
import { wheelPan } from "@/lib/rules/ui/wheelPan";

/**
 * Make a horizontal scroll rail reachable with a wheel mouse.
 *
 * Returns a ref to put on the scrolling element. Every decision — how far, and
 * the several cases where the event belongs to the browser or the page instead
 * — lives in `lib/rules/ui/wheelPan.ts`, which is tested. This is the adapter:
 * it holds the node, listens, and applies.
 *
 * ## Why a listener rather than an `onWheel` prop
 *
 * **React registers `wheel` as a passive listener on the root**, so
 * `preventDefault()` inside `onWheel` does nothing but log a console warning:
 * the page would scroll AND the rail would move, which is worse than the bug.
 * The listener has to be attached to the node itself with `{ passive: false }`.
 *
 * ## Why a callback ref rather than an effect
 *
 * The rail this was written for mounts behind a media query (`hidden deck:flex`
 * on the top bar's tab list), so there is no node on the first render. A
 * callback ref runs when the node actually arrives and again with `null` when it
 * goes, which is exactly the listener's lifetime.
 */
export function useWheelPan<T extends HTMLElement>() {
  const detach = useRef<(() => void) | null>(null);

  return useCallback((node: T | null) => {
    detach.current?.();
    detach.current = null;
    if (!node) return;

    function onWheel(e: WheelEvent) {
      const el = e.currentTarget as HTMLElement;
      const { delta, preventDefault } = wheelPan({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
      if (!preventDefault) return;
      e.preventDefault();
      el.scrollLeft += delta;
    }

    node.addEventListener("wheel", onWheel, { passive: false });
    detach.current = () => node.removeEventListener("wheel", onWheel);
  }, []);
}
