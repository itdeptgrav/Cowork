"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useMeetingSession } from "./MeetingSessionContext";
import { MeetingRoom } from "./MeetingRoom";
import { useDocumentPip } from "@/lib/legacy-ui/useDocumentPip";
import { useAutoPip } from "@/lib/legacy-ui/useAutoPip";

/**
 * The meeting, mounted once, for the whole application.
 *
 * ## Why it is here and not on the meeting page
 *
 * A meeting used to be a page, and a page unmounts when you navigate. LiveKit
 * disconnects on unmount and the recorder goes with it, so Back — or any link
 * at all — ended the meeting and abandoned that participant's half of the
 * recording. Nothing errored: a component did what components do.
 *
 * So the room is mounted here, above the router, and the meeting page publishes
 * a rectangle saying where to draw it (`MeetingStage`). Navigation changes the
 * rectangle, never the connection. Pressing Back does not need intercepting and
 * is not intercepted — the stage simply stops being published, and the meeting
 * carries on in the corner exactly as Google Meet's does.
 *
 * ## Three places, one room
 *
 * · **Docked** — over the rectangle the meeting page published.
 * · **Floating** — bottom-left of the tab, when you have navigated elsewhere.
 * · **Picture-in-picture** — a real window over other applications, when you
 *   have left the tab entirely.
 *
 * All three render the SAME element. `MeetingRoom` is portalled into one
 * container that is created once and physically moved between the page and the
 * PiP document; React's portal target is that node throughout, so it never
 * reconciles and `LiveKitRoom` never learns anything happened. Rendering a
 * second tree for the PiP window would tear the call down at the moment it is
 * most needed — which is the fault this whole arrangement exists to avoid.
 *
 * Recording continues in all three, and while the tab is hidden, because none
 * of it unmounts. `MediaRecorder` is driven by the media pipeline rather than a
 * timer, so a hidden tab keeps capturing; the recorder flushes on
 * `visibilitychange` so the clips do not pile up unsent.
 */

/**
 * The floating window: bottom-left, above the music bar rather than over it.
 *
 * `MusicBar` is `fixed bottom-3 left-3 z-40` — the same corner, and its own
 * comment claims that corner as "the one region of a page that is reliably
 * empty". This window is z-70, so parking it at `bottom: 16` would cover the
 * bar completely and leave somebody unable to pause the music they are trying
 * to pause because they joined a meeting.
 *
 * `--music-bar-clearance` is the variable the player already publishes for
 * exactly this, set to `88px` while the bar is up and removed when it is not.
 */
const FLOATING = {
  left: 16,
  bottom: "calc(16px + var(--music-bar-clearance, 0px))",
  width: 340,
  height: 232,
};

const PIP_SIZE = { width: 400, height: 300 };

export function MeetingEngine() {
  const { session, stageEl, close } = useMeetingSession();
  const router = useRouter();

  /* Where the container lives when it is not in a PiP window. Positioned by
     the layout effects below; the container fills it.

     A CALLBACK ref: the engine renders nothing until somebody joins, so the
     home element mounts long after the hook does — with a ref object there is
     no change for an effect to depend on, and the meeting was never appended
     to it. That was the black screen. */
  const homeRef = useRef<HTMLDivElement | null>(null);
  /* A boolean the effects can depend on: a ref object never changes identity,
     so nothing could react to the element appearing. */
  const [homeReady, setHomeReady] = useState(false);
  const attachHome = useCallback((el: HTMLDivElement | null) => {
    homeRef.current = el;
    setHomeReady(el !== null);
  }, []);
  const pip = useDocumentPip(homeRef, homeReady);

  const openPip = useCallback(() => {
    void pip.open(PIP_SIZE).catch(() => {
      /* Refused — no permission, or the window was blocked. The in-tab
         floating presentation is already on screen, so there is nothing to
         report and nothing lost. */
    });
  }, [pip]);

  /* Registers the browser's own "enter picture-in-picture automatically"
     offer. It does nothing until the reader accepts it. */
  useAutoPip({
    active: session !== null,
    title: session?.meeting.title ?? "Meeting",
    onEnter: openPip,
  });

  const docked = stageEl !== null && !pip.isOpen;

  /**
   * Sit over the stage — WITHOUT following it on every scroll.
   *
   * ## The glitch this removes
   *
   * A `position: fixed` box has to be re-placed as the page scrolls, and no
   * amount of care makes that smooth: the browser scrolls the page on the
   * compositor and JavaScript runs afterwards, so the video is always drawn
   * where the page WAS. Every scroll shears the meeting against the panel it is
   * supposed to be sitting in. Moving the measurement out of React state
   * removed a re-render per frame but not the lag, because the lag is not
   * React's — it is the frame.
   *
   * So the docked presentation is `position: absolute` in DOCUMENT
   * coordinates, portalled to `<body>`. Scrolling then moves it because the
   * document moves, on the compositor, in the same frame as everything else.
   * There is no scroll listener at all: nothing to run late, nothing to shear.
   *
   * Only a LAYOUT change moves the stage relative to the document — a resize, a
   * panel opening above it — and `ResizeObserver` catches those. They are rare
   * and they are not frame-critical.
   *
   * The floating corner stays `fixed`: it is pinned to the viewport on purpose,
   * so scrolling must NOT move it, and a fixed box that never gets repositioned
   * has nothing to lag behind.
   */
  useLayoutEffect(() => {
    const home = homeRef.current;
    if (!home || !docked || !stageEl) return;

    const place = () => {
      const r = stageEl.getBoundingClientRect();
      home.style.position = "absolute";
      /* Document coordinates: viewport rect plus how far the document has been
         scrolled. This is what makes the value scroll-independent. */
      home.style.left = `${r.left + window.scrollX}px`;
      home.style.top = `${r.top + window.scrollY}px`;
      home.style.width = `${r.width}px`;
      home.style.height = `${r.height}px`;
      home.style.bottom = "auto";
    };
    place();

    const ro = new ResizeObserver(place);
    ro.observe(stageEl);
    /* The stage moves down the document when something above it grows, which
       resizes neither the stage nor the window. */
    ro.observe(document.body);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [homeReady, docked, stageEl]);

  /**
   * The floating corner, and where the reader has dragged it to.
   *
   * `null` means "where it starts" — bottom-left, above the music bar. Once
   * dragged it becomes viewport coordinates and stays put, because a window
   * that springs back to the corner is a window you have to move twice.
   *
   * Kept per session rather than persisted: the corner is the right place to
   * start every time, and remembering a position from last week is how a
   * meeting opens underneath something that has since moved.
   */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

/* Deliberately NOT reset when it docks or pops out: somebody who moved the
     window to the right-hand side meant it, and having to move it again after
     every visit to the meeting page is the annoyance the drag was added to
     end. It is clamped on re-float below, so a window dragged wide and then
     opened on a narrower screen still lands somewhere reachable. */

  /* The floating corner. Written the same way so the two never fight over the
     same style properties and leave a stale `top` or `position` behind. */
  useLayoutEffect(() => {
    const home = homeRef.current;
    if (!home || docked || pip.isOpen) return;
    home.style.position = "fixed";
    home.style.width = `${FLOATING.width}px`;
    home.style.height = `${FLOATING.height}px`;
    if (dragPos) {
      /* Clamped here as well as during the drag: the viewport may have shrunk
         since — a resized window, a rotated phone — and a meeting parked off
         the edge can only be recovered by reloading. */
      const maxX = Math.max(0, window.innerWidth - FLOATING.width);
      const maxY = Math.max(0, window.innerHeight - FLOATING.height);
      home.style.left = `${Math.min(dragPos.x, maxX)}px`;
      home.style.top = `${Math.min(dragPos.y, maxY)}px`;
      home.style.bottom = "auto";
    } else {
      home.style.left = `${FLOATING.left}px`;
      home.style.top = "auto";
      home.style.bottom = FLOATING.bottom;
    }
  }, [homeReady, docked, pip.isOpen, dragPos]);

  /**
   * Drag the floating window by its header.
   *
   * Pointer events rather than mouse: one code path covers a trackpad, a mouse
   * and a touch screen, and `setPointerCapture` keeps the drag alive when the
   * pointer crosses the video — which is an iframe-like surface that would
   * otherwise swallow the moves and strand the window mid-drag.
   *
   * Clamped to the viewport on release so it cannot be parked off-screen where
   * the only way back is a reload.
   */
  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      const home = homeRef.current;
      if (!home || docked || pip.isOpen) return;
      const rect = home.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const move = (raw: Event) => {
        const ev = raw as PointerEvent;
        const maxX = window.innerWidth - FLOATING.width;
        const maxY = window.innerHeight - FLOATING.height;
        setDragPos({
          x: Math.min(Math.max(0, ev.clientX - offsetX), Math.max(0, maxX)),
          y: Math.min(Math.max(0, ev.clientY - offsetY), Math.max(0, maxY)),
        });
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* Already released — the pointer left the window. */
        }
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
    },
    [docked, pip.isOpen],
  );

  if (!session) return null;

  return (
    <>
      {/**
       * **Portalled to `<body>`, which the document coordinates above depend
       * on.** `position: absolute` is resolved against the nearest positioned
       * ancestor, and the shell has several — a transformed or relative wrapper
       * anywhere above would silently shift the meeting by that element's
       * offset. On `<body>` there is nothing between it and the page.
       *
       * `position` itself is set in the layout effects rather than by a class,
       * so the two presentations cannot leave each other's value behind.
       */}
      {createPortal(
        <div
          ref={attachHome}
          /* Hidden while the meeting is in a PiP window: the container has
             moved out, and an empty positioned box would sit over the page
             catching clicks. */
          className={
            pip.isOpen
              ? "hidden"
              : docked
                ? "pointer-events-auto z-30"
                : "pointer-events-auto z-[70] overflow-hidden rounded-panel border border-white/15 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
          }
        />,
        document.body,
      )}

      {/* ONE room, portalled into the container wherever it currently lives. */}
      {pip.container &&
        createPortal(
          <MeetingRoom
            meeting={session.meeting}
            isOrganiser={session.isOrganiser}
            displayName={session.displayName}
            compact={!docked}
            onReturn={() => {
              /* Out of the PiP window first — going "back to the meeting"
                 while the room is still in a detached window would leave the
                 page showing an empty stage. */
              if (pip.isOpen) pip.close();
              router.push(`/meetings/${session.meeting.id}`);
            }}
            onPopOut={pip.supported && !pip.isOpen ? openPip : undefined}
            onDragHandle={!docked && !pip.isOpen ? onDragStart : undefined}
            onLeave={() => {
              /* The window goes before the session: closing it moves the
                 container home, and a container still parented to a destroyed
                 document is one React would keep rendering into. */
              if (pip.isOpen) pip.close();
              session.onLeave?.();
              close();
            }}
          />,
          pip.container,
        )}
    </>
  );
}
