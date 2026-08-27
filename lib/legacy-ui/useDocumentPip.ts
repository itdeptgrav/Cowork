"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A real picture-in-picture WINDOW — one that floats over other applications,
 * not just over the page.
 *
 * ## Why the Document API and not video PiP
 *
 * `HTMLVideoElement.requestPictureInPicture` gives you one video and nothing
 * else: no mute button, no camera toggle, no way to leave. A meeting people can
 * watch but not speak in is not a meeting. `documentPictureInPicture` opens an
 * empty always-on-top window whose document you fill with ordinary DOM, so the
 * controls come with it. It is what Google Meet uses, and it is Chromium-only —
 * `isSupported` is false in Firefox and Safari, and every caller must have
 * something sensible to do with that answer.
 *
 * ## The move, and why it does not restart the call
 *
 * The naive version renders the meeting into the PiP window with a second
 * portal. That unmounts the first tree and mounts a new one, which tears down
 * `LiveKitRoom`, drops the connection and abandons the recorder — the exact
 * fault the persistent engine exists to prevent, reintroduced at the last step.
 *
 * So nothing is re-rendered. ONE container element is created once and kept for
 * the life of the hook; React portals into that element and never learns it has
 * moved. The element is then physically `appendChild`-ed into the PiP document
 * and back again. Media elements keep playing across a move between documents —
 * that is the guarantee the whole technique rests on — and React's portal
 * target is the same node throughout, so it never reconciles anything.
 *
 * ## Styles
 *
 * A PiP window is a fresh document with no stylesheets. Every rule has to be
 * copied in or the meeting arrives as unstyled markup. Same-origin sheets are
 * copied rule by rule; cross-origin ones (a font service) cannot be read, so
 * their `<link>` is re-created and the new document fetches them itself.
 */

interface PipWindowLike extends Window {
  document: Document;
}

interface DocumentPipApi {
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }): Promise<PipWindowLike>;
  window: PipWindowLike | null;
}

function api(): DocumentPipApi | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { documentPictureInPicture?: DocumentPipApi };
  return w.documentPictureInPicture ?? null;
}

/** Whether this browser can open a document picture-in-picture window. */
export function documentPipSupported(): boolean {
  return api() !== null;
}

function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      /* Same-origin: copy the rules straight across. Reading `cssRules` on a
         cross-origin sheet throws, which is what the catch is for. */
      const rules = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      const style = target.createElement("style");
      style.textContent = rules;
      target.head.append(style);
    } catch {
      /* Cross-origin — re-create the link and let the new document fetch it. */
      const owner = sheet.ownerNode;
      if (owner instanceof HTMLLinkElement) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = owner.href;
        if (owner.media) link.media = owner.media;
        target.head.append(link);
      }
    }
  }

  /* The theme is carried on the root element as `data-theme` and a class, and
     a PiP window that ignored it would open in the light palette behind a dark
     application. */
  const root = document.documentElement;
  for (const attr of ["data-theme", "class", "style"]) {
    const value = root.getAttribute(attr);
    if (value) target.documentElement.setAttribute(attr, value);
  }
  /**
   * **The window's document has no height of its own, and that is not obvious.**
   *
   * A picture-in-picture document starts as bare `<html><body>`, both sized to
   * their content like any other page. The container is `height: 100%`, which
   * resolves against a body of automatic height — so it collapsed to whatever
   * the header and the control bar happened to need, the participant grid got
   * a few pixels, and the rest of the window was left black with the controls
   * stranded near the top.
   *
   * The chain has to be unbroken from `<html>` down, which is why both are set
   * rather than just the body.
   */
  target.documentElement.style.height = "100%";
  target.body.style.height = "100%";
  target.body.style.margin = "0";
  target.body.style.overflow = "hidden";
  /* The window is the meeting and nothing else, so the container fills it
     rather than sitting in normal flow inside it. */
  target.body.style.display = "flex";
}

export interface DocumentPip {
  /** The container React should portal into. Stable for the hook's lifetime. */
  container: HTMLElement | null;
  /**
   * Where the container lives when it is NOT in a PiP window.
   *
   * **A callback ref, not a `RefObject`, and that distinction was a bug.** This
   * took a ref object and read `.current` inside an effect. The effect's
   * dependencies could not change when the home element mounted — a ref object
   * is the same object for ever — so on the ordinary path, where the engine
   * renders nothing until somebody joins a meeting, the container was created
   * while there was no home to put it in and then never appended to the one
   * that appeared. The meeting connected, the audio ran, and the screen was
   * black.
   *
   * Held as state so mounting the element is a change React can see.
   */
  /** True while the container is living in a picture-in-picture window. */
  isOpen: boolean;
  supported: boolean;
  open: (size?: { width: number; height: number }) => Promise<void>;
  close: () => void;
}

export function useDocumentPip(
  homeRef: React.RefObject<HTMLElement | null>,
  /**
   * Whether the home element is currently mounted.
   *
   * **The parameter that was missing, and it cost a black screen.** A ref
   * object never changes identity, so an effect depending on it cannot re-run
   * when the element inside it appears. The engine renders nothing until
   * somebody joins a meeting, so the container was created while there was no
   * home to hold it and then never appended to the one that arrived: the
   * meeting connected, the audio ran, and the screen stayed black.
   *
   * A boolean is a change React can see.
   */
  homeReady: boolean,
): DocumentPip {
  const [isOpen, setIsOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const pipRef = useRef<PipWindowLike | null>(null);

  /* Created once, in an effect rather than in render: `document` does not exist
     during server rendering, and a container rebuilt on a re-render would move
     the portal target and remount everything inside it. */
  useEffect(() => {
    if (containerRef.current) return;
    const el = document.createElement("div");
    el.style.width = "100%";
    el.style.height = "100%";
    /* Fills a flex parent as well as a block one — the PiP document's body is
       laid out as a flex row, and `height: 100%` alone leaves a flex item free
       to shrink to its content. */
    el.style.flex = "1 1 auto";
    el.style.minWidth = "0";
    el.style.minHeight = "0";
    containerRef.current = el;
    setContainer(el);
  }, []);

  /* Keep it parented at home whenever it is not in a PiP window. Depends on
     the home ELEMENT, so it runs the moment one mounts. */
  useEffect(() => {
    const home = homeRef.current;
    if (!container || !home || isOpen) return;
    if (container.parentElement !== home) home.append(container);
  }, [container, homeRef, homeReady, isOpen]);

  const close = useCallback(() => {
    const pip = pipRef.current;
    pipRef.current = null;
    setIsOpen(false);
    /* The container goes home BEFORE the window closes: a node still parented
       to a closing document is destroyed with it, and React would keep
       rendering into an element that is no longer anywhere. */
    const el = containerRef.current;
    const back = homeRef.current;
    if (el && back) back.append(el);
    try {
      pip?.close();
    } catch {
      /* Already gone — closed by the person, or by the tab going away. */
    }
  }, [homeRef]);

  const open = useCallback(
    async (size?: { width: number; height: number }) => {
      const dp = api();
      const el = containerRef.current;
      if (!dp || !el || pipRef.current) return;

      const pip = await dp.requestWindow({
        width: size?.width ?? 400,
        height: size?.height ?? 300,
      });
      pipRef.current = pip;
      copyStyles(pip.document);
      pip.document.body.append(el);
      setIsOpen(true);

      /* Closing the window — by its own button, or because the tab went away —
         has to bring the meeting home rather than leave the portal rendering
         into a destroyed document. */
      pip.addEventListener("pagehide", () => {
        pipRef.current = null;
        setIsOpen(false);
        const back = homeRef.current;
        if (back) back.append(el);
      });
    },
    [homeRef],
  );

  /* A PiP window outlives its opener's React tree unless it is closed here. */
  useEffect(() => () => {
    try {
      pipRef.current?.close();
    } catch {
      /* Already closed. */
    }
  }, []);

  return {
    container,
    isOpen,
    supported: api() !== null,
    open,
    close,
  };
}
