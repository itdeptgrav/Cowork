"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Put one element on the whole screen, and know when it is there.
 *
 * ## Why a hook and not two lines at the call site
 *
 * `requestFullscreen` is the easy half. The hard half is that full screen can
 * end without anybody pressing your button — Escape, F11, the operating
 * system, a second element asking for it — and a control that says "Exit full
 * screen" over a window that is no longer full screen is worse than no control.
 * So the state has to come from the browser's `fullscreenchange` event, never
 * from a local flag toggled on click.
 *
 * ## Why `useSyncExternalStore` rather than `useEffect` + `useState`
 *
 * The browser IS the store here — `document.fullscreenElement` is the truth and
 * this hook only reads it. Subscribing that way also gets the server render
 * right for free: `getServerSnapshot` says "nothing is full screen", which is
 * exactly true of a page that has not reached a browser yet, so there is no
 * hydration mismatch and no first-paint flicker of the wrong icon.
 *
 * ## Why the element arrives as a callback ref
 *
 * The caller does `ref={fs.attach}` and the hook holds the node in STATE. It could
 * have taken a `RefObject`, but then deciding "is MY element the full-screen
 * one" would mean reading `ref.current` while rendering — which the React
 * Compiler forbids, and rightly: the answer would not re-render when it
 * changed. Holding the node in state makes `isFullscreen` an honest comparison
 * of two values React knows about.
 *
 * ## Safari
 *
 * iOS and older desktop Safari only have the `webkit`-prefixed names. They are
 * checked everywhere the standard ones are, because a meeting that cannot fill
 * the screen on a Mac is a meeting that cannot fill the screen.
 */
export function useFullscreen() {
  const [el, setEl] = useState<HTMLElement | null>(null);

  const fullscreenElement = useSyncExternalStore(
    subscribeToFullscreenChange,
    readFullscreenElement,
    readNothingFullscreen,
  );

  const supported = useSyncExternalStore(
    subscribeToNothing,
    readFullscreenEnabled,
    readNotSupported,
  );

  /* Both are values React re-rendered for, so this is a plain comparison and
     not a ref read. `el` being the full-screen element — rather than merely
     SOMETHING being full screen — is what stops a video that went full screen
     on its own from flipping this button's label. */
  const isFullscreen = el !== null && fullscreenElement === el;

  const toggle = useCallback(() => {
    if (!el) return;
    void applyFullscreenAction(nextFullscreenAction(readFullscreenElement(), el), el);
  }, [el]);

  return { attach: setEl, isFullscreen, supported, toggle };
}

/**
 * What pressing the button should do, given who is full screen right now.
 *
 * Split out as a pure function because the interesting case is not the obvious
 * one. If SOMETHING ELSE is full screen — another element, a `<video>` that
 * went full screen by itself — the answer is still "enter", not "nothing":
 * `requestFullscreen` on a new element while another holds the screen replaces
 * it, which is what the reader means by pressing full screen on the meeting.
 * Exiting is only right when the element asking is the element that has it.
 */
export function nextFullscreenAction(
  fullscreenElement: Element | null,
  el: Element | null,
): "enter" | "exit" | "none" {
  if (!el) return "none";
  if (fullscreenElement === el) return "exit";
  return "enter";
}

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};

async function applyFullscreenAction(
  action: "enter" | "exit" | "none",
  el: HTMLElement,
): Promise<void> {
  const doc = document as WebkitDocument;
  try {
    if (action === "enter") {
      const node = el as WebkitElement;
      if (node.requestFullscreen) await node.requestFullscreen();
      else node.webkitRequestFullscreen?.();
      return;
    }
    if (action === "exit") {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    }
  } catch {
    /* `requestFullscreen` rejects when the browser decides the click was not a
       real user gesture, and `exitFullscreen` rejects if the screen was already
       given up in between. Neither is worth an error message: the reader can
       see whether the meeting filled the screen, and pressing again is the
       whole recovery. Swallowing beats an unhandled rejection in the console. */
  }
}

function subscribeToFullscreenChange(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
}

/* Whether full screen is *possible* cannot change while the page is open, so
   there is nothing to listen to — but it still goes through the store so the
   server and the first client render agree. */
function subscribeToNothing(): () => void {
  return () => {};
}

function readFullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function readNothingFullscreen(): Element | null {
  return null;
}

function readFullscreenEnabled(): boolean {
  const doc = document as WebkitDocument;
  return doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
}

function readNotSupported(): boolean {
  return false;
}
