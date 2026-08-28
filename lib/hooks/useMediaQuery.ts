"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Answer a CSS media query in React, for the cases CSS cannot reach.
 *
 * **Prefer a Tailwind variant.** Almost everything responsive belongs in a
 * class — `deck:grid-cols-3` costs nothing, works before hydration, and cannot
 * disagree with the stylesheet. This hook is for the remainder: when a
 * *component's props* have to change with the viewport, not its styling.
 *
 * The case it was written for is LiveKit's `ControlBar`, which takes a
 * `variation` prop deciding whether its buttons carry text. "Microphone ⌄
 * Camera ⌄ Share screen  Leave" is right on a desk and does not fit a 375px
 * phone at any font size — and it is a prop, so no class can override it.
 *
 * ## Why `useSyncExternalStore`
 *
 * `matchMedia` IS the store; this only reads it. That also settles the server
 * render honestly: `getServerSnapshot` returns `false`, so a page rendered
 * where there is no viewport reports "this query does not match" rather than
 * guessing. Pair it with a mobile-first default so the false is the safe answer.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      /* `matchMedia` is missing in some test environments and in any renderer
         without a window. Subscribing to nothing keeps the snapshot at its
         server value rather than throwing during render. */
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      /* `addEventListener` on a MediaQueryList is the modern form; Safari below
         14 has only `addListener`. Both are cheap to support and the fallback
         is two lines. */
      if (list.addEventListener) {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      }
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * The project's own breakpoints, so a component never hardcodes a pixel value
 * that the stylesheet is free to change.
 *
 * These mirror `--breakpoint-deck` in `app/globals.css` and Tailwind's
 * defaults. `deck` is Cowork's own step at 1180px — the width DESIGN.md calls
 * the full deck, where the navigation stops collapsing and a companion rail
 * fits beside the main column.
 */
export const BREAKPOINT = {
  /** ≥640px — a large phone in landscape, and up. */
  sm: "(min-width: 40rem)",
  /** ≥768px — tablet portrait, and up. */
  md: "(min-width: 48rem)",
  /** ≥1180px — the full deck. */
  deck: "(min-width: 73.75rem)",
} as const;

/**
 * True where a pointer can hover — a mouse or a trackpad, not a finger.
 *
 * Width is a poor proxy for input: a touchscreen laptop is wide and a desktop
 * window dragged narrow is not a phone. Anything that only appears on hover
 * needs this rather than a breakpoint, because on a touch device a hover-only
 * control is a control that does not exist.
 */
export function useHasHover(): boolean {
  const query = useMemo(() => "(hover: hover) and (pointer: fine)", []);
  return useMediaQuery(query);
}
