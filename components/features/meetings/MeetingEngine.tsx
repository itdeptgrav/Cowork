"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useMeetingSession } from "./MeetingSessionContext";
import { MeetingRoom } from "./MeetingRoom";
import { TaskRoom } from "./TaskRoom";
import { GuestRoom } from "./GuestRoom";
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
 * · **Picture-in-picture** — a real window over other applications, bottom-
 *   right of the screen, the moment you leave the page (Chrome and Edge).
 * · **Floating** — bottom-left of the tab, where the browser has no such
 *   window to give, or refused to open one — see the leaving effect below.
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

/**
 * The floating window's size on THIS screen.
 *
 * The nominal 340×232 is a desk measurement. A phone narrower than 340px plus
 * its two 16px margins — a 320px iPhone SE, a 360px Android with a scrollbar —
 * had the window's right edge off the screen, with Leave on it. So the width
 * is capped to what fits, never below 240px (the control bar's six buttons),
 * and the height follows in the same proportion so the picture keeps its
 * shape rather than turning into a letterbox.
 */
function floatingSize(): { width: number; height: number } {
  const width = Math.min(
    FLOATING.width,
    Math.max(240, window.innerWidth - FLOATING.left * 2),
  );
  return {
    width,
    height: Math.round((width / FLOATING.width) * FLOATING.height),
  };
}

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
  /* The two callbacks are stable for the hook's life; the object holding them
     is rebuilt every render. Depending on the callbacks rather than the object
     keeps `openPip` — and the media-session handler registered on it — from
     being remade on every render of the shell. */
  const { open: openWindow, close: closeWindow } = pip;

  const openPip = useCallback(() => {
    /* A deliberate press of the pop-out button — see `autoOpenedRef` below,
       which this is NOT: that button is only reachable while the tab is
       visible, which is exactly the case this leaves alone. */
    autoOpenedRef.current = false;
    void openWindow(PIP_SIZE).catch(() => {
      /* Refused — no permission, or the window was blocked. The in-tab
         floating presentation is already on screen, so there is nothing to
         report and nothing lost. */
    });
  }, [openWindow]);

  /**
   * Whether the CURRENTLY OPEN window was opened by the browser's own
   * auto-PiP trigger, rather than by pressing pop-out.
   *
   * Only that one kind gets folded back in on its own, by the effect below.
   * Told apart at the moment each opens: the browser invokes
   * `enterpictureinpicture` only while the tab IS hidden, and the pop-out
   * button can only be pressed while it is not — so which function ran is
   * itself the answer, with nothing to race.
   */
  const autoOpenedRef = useRef(false);
  const autoOpenPip = useCallback(() => {
    autoOpenedRef.current = true;
    void openWindow(PIP_SIZE).catch(() => {
      autoOpenedRef.current = false;
    });
  }, [openWindow]);

  /* Registers the browser's own "enter picture-in-picture automatically"
     offer. It does nothing until the reader accepts it. */
  useAutoPip({
    active: session !== null,
    title:
      session === null
        ? "Meeting"
        : session.kind === "task"
          ? session.taskTitle
          : session.kind === "guest"
            ? session.meetTitle
            : session.meeting.title,
    onEnter: autoOpenPip,
  });

  /**
   * Fold the meeting back in when you return to its own tab.
   *
   * ## The gap this closes
   *
   * `useAutoPip` opens the real window on a `visibilitychange` this component
   * never otherwise sees: the TAB going to the background, not the meeting's
   * PAGE going away. Switching tabs and switching back does not unmount
   * anything — the stage this page published stays mounted throughout — so
   * the OTHER close trigger below, which watches `stageEl` go from mounted to
   * unmounted and back, never fires: it has nothing to transition FROM. The
   * window opened on its own and had nothing wired to close it on its own,
   * so returning to the exact tab the meeting is on left a live call sitting
   * in a floating window right next to the page that was meant to show it
   * docked.
   *
   * ## Why a deliberate pop-out is left alone
   *
   * Somebody who pressed the button while looking straight at the docked room
   * meant the window to float, and the next ordinary alt-tab must not undo
   * that choice for them. `autoOpenedRef` is what tells the two apart —
   * see its own note.
   *
   * `stageEl !== null` is the other half of the guard: this only folds the
   * window in once the reader is actually back on a page that wants the room
   * docked. Returning to an unrelated tab with the meeting still auto-floated
   * behind it is exactly the case this feature exists for, and is untouched.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.hidden) return;
      if (!autoOpenedRef.current) return;
      if (!pip.isOpen || stageEl === null) return;
      autoOpenedRef.current = false;
      closeWindow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pip.isOpen, stageEl, closeWindow]);

  /**
   * Leaving the page puts the meeting STRAIGHT into the real window.
   *
   * ## What this replaces
   *
   * Navigating away used to land the meeting in the in-tab corner window,
   * and the picture-in-picture window — the one that floats over other
   * applications, bottom-right of the screen — was a second press away, on
   * the corner window's own pop-out button. Two windows for one act of
   * leaving, and the first was the one nobody wanted: it lives inside the
   * tab, so it is gone the moment you switch to another one.
   *
   * ## Why it can be done here and not on `visibilitychange`
   *
   * `requestWindow()` needs a user gesture. Switching tab is not one — which
   * is why `useAutoPip` goes through the browser's own offer — but the CLICK
   * that navigated away is, and the browser keeps it usable for a few
   * seconds. The stage unmounts as the route changes, well inside that
   * allowance, so the window opens on the strength of the click that left.
   *
   * ## When it is refused, and what happens then
   *
   * The Back button is browser chrome and grants no gesture; a route that
   * takes longer than the allowance to arrive spends it; Firefox and Safari
   * have no such window at all (`pip.supported`). The promise rejects, the
   * in-tab corner window is what remains, and nothing is lost — it is the
   * presentation that was already on screen. The home element is kept
   * invisible while the attempt is in flight so the corner window does not
   * flash for a frame before the real one takes over; a layout effect, so
   * that happens before the first paint rather than after it.
   *
   * A TRANSITION, not a state: it fires when the stage GOES, and only then.
   * Re-trying on every render while floating would re-open a window the
   * reader had just closed, and would take the next unrelated click on some
   * other page as its gesture.
   */
  const prevStageRef = useRef<HTMLElement | null>(null);
  const [pipPending, setPipPending] = useState(false);
  useLayoutEffect(() => {
    const prev = prevStageRef.current;
    /* Recorded before any early return, or a transition that happened while
       there was no session would be seen again by the next render that has
       one. */
    prevStageRef.current = stageEl;
    if (!session) return;
    if (prev !== null && stageEl === null) {
      /* Left the page. */
      if (pip.isOpen || !pip.supported) return;
      setPipPending(true);
      void openWindow(PIP_SIZE)
        .then(() => {
          /* Back on the page before the window had finished opening — the
             stage that reappeared wants the room, not an empty box. */
          if (prevStageRef.current !== null) closeWindow();
        })
        .catch(() => {
          /* Refused: no gesture, no permission, or no such window. The
             corner window is already there. */
        })
        .finally(() => setPipPending(false));
    } else if (prev === null && stageEl !== null && pip.isOpen) {
      /* Arrived at the page: the room goes back into it, and closing needs
         no gesture. Only on ARRIVAL — pressing pop-out while on the page
         opens the window deliberately, and the stage does not change, so
         that is left alone. */
      closeWindow();
    }
  }, [session, stageEl, pip.isOpen, pip.supported, openWindow, closeWindow]);

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

    /* Coalesce a scroll's burst of events into one placement per frame. */
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place();
      });
    };

    const ro = new ResizeObserver(place);
    ro.observe(stageEl);
    /* The stage moves down the document when something above it grows, which
       resizes neither the stage nor the window. */
    ro.observe(document.body);
    window.addEventListener("resize", place);
    /**
     * **Follow the stage on scroll, because the stage is `sticky`.**
     *
     * The docked box is `position: absolute` in DOCUMENT coordinates so ordinary
     * scrolling moves it on the compositor with no JS — but the meeting page's
     * stage is `position: sticky` (it pins the video while the rail's panels
     * scroll past it — see `MeetingDetailArea`). A sticky element's document
     * position CHANGES as it sticks, and a resize never reports that, so without
     * this the box drifted off the stage while scrolling and only snapped back
     * when some other event happened to re-measure it — opening the History
     * panel being exactly such an event, and the jump this removes.
     *
     * It stays shear-free where it matters: while the stage is NOT stuck,
     * `r.top + scrollY` is constant, so this writes the value the box already
     * has and nothing moves. It does real work only in the stuck region, where
     * following one frame behind is far better than not following at all.
     * `capture` so a scroll on any container above the stage is caught too.
     */
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", schedule, true);
      if (raf) cancelAnimationFrame(raf);
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
    const place = () => {
      const size = floatingSize();
      home.style.position = "fixed";
      home.style.width = `${size.width}px`;
      home.style.height = `${size.height}px`;
      if (dragPos) {
        /* Clamped here as well as during the drag: the viewport may have
           shrunk since — a resized window, a rotated phone — and a meeting
           parked off the edge can only be recovered by reloading. */
        const maxX = Math.max(0, window.innerWidth - size.width);
        const maxY = Math.max(0, window.innerHeight - size.height);
        home.style.left = `${Math.min(dragPos.x, maxX)}px`;
        home.style.top = `${Math.min(dragPos.y, maxY)}px`;
        home.style.bottom = "auto";
      } else {
        home.style.left = `${FLOATING.left}px`;
        home.style.top = "auto";
        home.style.bottom = FLOATING.bottom;
      }
    };
    place();
    /* A rotated phone changes what fits; nothing else in the dependency list
       changes with it. */
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
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
                : /* `invisible` rather than `hidden` while the real window is
                     being opened: the box keeps its geometry, so nothing that
                     watches the video's visibility is told it has gone. */
                  `pointer-events-auto z-[70] overflow-hidden rounded-panel border border-white/15 shadow-[0_18px_48px_rgba(0,0,0,0.55)]${
                    pipPending ? " invisible" : ""
                  }`
          }
        />,
        document.body,
      )}

      {/**
        * ONE room, portalled into the container wherever it currently lives.
        *
        * **Two components, one position.** React reconciles by position, and a
        * `LiveKitRoom` that moves in the tree tears down its media and
        * reconnects — so the branch is here, at the top, and never inside the
        * room. A session cannot change kind while it is open, so the branch is
        * decided once and holds for the life of the call.
        */}
      {pip.container &&
        createPortal(
          session.kind === "guest" ? (
            /**
             * **Keyed on the guest session, and only this branch is.**
             *
             * A guest who joins a second meeting link while their first call
             * is still floating opens a NEW session under the same element
             * type at the same position — which, unkeyed, would hand the
             * running room new credentials and the running recorder a new
             * meeting id, so the first meeting's audio went to the second. The
             * key remounts: the old room unmounts (its recorder finalises on
             * the way out) and the new one connects clean. Re-opening the SAME
             * session — the guest page remounting under a live call — keeps
             * the key, so nothing is torn down.
             */
            <GuestRoom
              key={session.guestSessionId}
              token={session.token}
              url={session.url}
              meetTitle={session.meetTitle}
              camEnabled={session.camEnabled}
              micEnabled={session.micEnabled}
              camId={session.camId}
              micId={session.micId}
              meetId={session.meetId}
              guestId={session.guestId}
              guestSessionId={session.guestSessionId}
              guestName={session.guestName}
              compact={!docked}
              onReturn={() => {
                if (pip.isOpen) pip.close();
                router.push(`/meetings/guest/${session.shareToken}`);
              }}
              onPopOut={pip.supported && !pip.isOpen ? openPip : undefined}
              onDragHandle={!docked && !pip.isOpen ? onDragStart : undefined}
              onLeave={(reason) => {
                if (pip.isOpen) pip.close();
                session.onLeave?.(reason);
                close();
              }}
            />
          ) : session.kind === "task" ? (
            <TaskRoom
              session={session}
              compact={!docked}
              onReturn={() => {
                if (pip.isOpen) pip.close();
                /**
                 * **`/meetings`, not the task's root.**
                 *
                 * Each tab is its own route, and the root renders Overview. So
                 * pressing Open put the reader on the task's brief with the
                 * meeting still floating in the corner — the one place where
                 * the stage it wanted to dock into does not exist. It read as
                 * the button doing nothing, because visibly it did nothing.
                 */
                router.push(`/tasks/${session.taskId}/meetings`);
              }}
              onPopOut={pip.supported && !pip.isOpen ? openPip : undefined}
              onDragHandle={!docked && !pip.isOpen ? onDragStart : undefined}
              onLeave={() => {
                if (pip.isOpen) pip.close();
                session.onLeave?.();
                close();
              }}
            />
          ) : (
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
              onLeave={(reason) => {
                /* The window goes before the session: closing it moves the
                   container home, and a container still parented to a destroyed
                   document is one React would keep rendering into. */
                if (pip.isOpen) pip.close();
                session.onLeave?.(reason);
                close();
              }}
            />
          ),
          pip.container,
        )}
    </>
  );
}
