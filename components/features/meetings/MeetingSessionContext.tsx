"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Meeting } from "@/lib/domain";

/**
 * The meeting you are in, held ABOVE the router so leaving the page does not
 * leave the meeting.
 *
 * ## The bug this exists for
 *
 * `LiveKitRoom` lived inside the meeting page. React unmounts a page when you
 * navigate, LiveKit disconnects when its component unmounts, and the recorder
 * unmounts with it — so pressing Back, opening a task from a notification, or
 * following any link at all *ended the meeting for you*, silently, with your
 * half of the recording never finalised. There was nothing to warn about
 * because nothing failed: the room did exactly what a component does.
 *
 * The fix is not to trap the back button. It is to stop the meeting being a
 * page. The room is mounted once, in the shell, and the meeting page merely
 * says WHERE to draw it — so navigation moves the picture, never the
 * connection.
 *
 * ## The same pattern the music player already uses
 *
 * `MusicProvider` + `PlayerEngine` solved this exact problem for playback: one
 * persistent player, a `stage` rectangle published by whichever page wants it
 * docked, and a floating presentation everywhere else. This is that, for a
 * meeting — deliberately, because a second way of doing one thing is a second
 * thing to keep right.
 *
 * ## What the stage is
 *
 * The empty element `MeetingStage` renders on the meeting page. Non-null means
 * "you are looking at the meeting, draw it over this"; null means "you have
 * gone somewhere else, show the small floating window". The engine measures it
 * and moves a `position: fixed` container — it never re-parents the media
 * elements, because React reconciles by position and a moved video element
 * restarts.
 */

/**
 * A meeting the shell is holding open, of either kind.
 *
 * **A union rather than one shape with optional halves**, because the two
 * genuinely differ in how they are entered and what ending one means. A
 * scheduled meeting fetches its own token from its room name and reports
 * presence; a task meeting is handed a token by `joinTaskMeeting`, which also
 * opens a CREDITED session — attendance on it decides how much time is added
 * to somebody's deadline. Collapsing those into one optional-riddled object is
 * how the credit arithmetic ends up running for the wrong kind.
 *
 * `kind` is what the engine switches on, and what `TaskMeetingLifecycle`
 * watches for: only a task session has a heartbeat to keep beating.
 */
export type MeetingSession = ScheduledSession | TaskSession | GuestSession;

export interface ScheduledSession {
  kind: "scheduled";
  meeting: Meeting;
  displayName: string;
  isOrganiser: boolean;
  /**
   * What the meeting's own page wants to know when the room ends.
   *
   * Carried on the session rather than passed to the engine, because the engine
   * is mounted in the shell and has no idea which page — if any — is showing
   * the meeting. Hanging up from the floating window while the page is not
   * mounted simply means nobody is listening, which is correct.
   *
   * Carries WHY when the room knows: `"ended"` for the organiser's End for
   * everyone, so the page can re-read the meeting at once and say so.
   */
  onLeave?: (reason?: LeaveReason) => void;
}

/**
 * A task's own meeting, held open by the shell so navigating away does not end
 * it.
 *
 * **The reason this exists at all.** The task panel used to own the room, the
 * twenty-second presence beat and the departure. Navigating away unmounted all
 * three at once, which was survivable while the room was there too — the
 * meeting simply ended. It stops being survivable the moment the room outlives
 * the page: the meeting would carry on in the corner while the beat that keeps
 * its credited session alive had stopped, the row would lapse ninety seconds
 * later, and the deadline credit would quietly stop for a conversation still
 * happening. So the beat moves into the shell with the room, and the two live
 * or die together.
 */
export interface TaskSession {
  kind: "task";
  taskId: string;
  /** Shown in the floating window's header, where there is no page to say it. */
  taskTitle: string;
  /** The credited session opened by `joinTaskMeeting`. The beat keeps it alive. */
  sessionId: string;
  roomName: string;
  token: string;
  url: string;
  /** Whose browser this is. The recording is filed per person. */
  employeeId: string;
  displayName: string;
  /** Whoever assigned the work — the side the credit clock already depends on. */
  isHost: boolean;
  /**
   * The room finished connecting.
   *
   * The task page re-reads attendance here: connecting is the moment the other
   * side becomes visible to this one, and waiting out the poll instead is the
   * longest avoidable disagreement between what the panel says and who is
   * actually in the room. It was `onConnected` on the panel's own LiveKitRoom
   * before the room moved into the shell; it is carried on the session for the
   * same reason `onLeave` is — the engine has no idea which page is showing it.
   */
  onConnected?: () => void;
  onLeave?: () => void;
}

/**
 * A guest's meeting, held open by the shell for the same reason as the others.
 *
 * **Parity, by decision.** The guest room used to be a page: `LiveKitRoom`
 * inside `GuestMeetingArea`, so any navigation — a link in the chat, the
 * browser's Back — unmounted it and ended the guest's call with their half of
 * the recording finalised mid-sentence, while the employee beside them kept
 * theirs in a corner window. The owner chose the same engine for guests: the
 * draggable floating window, the picture-in-picture window, a room that
 * survives navigation.
 *
 * Everything a guest room needs to connect and to record is carried here,
 * because the page that gathered it may be gone by the time the room is drawn:
 * the credentials `guest-join` minted, the identity the recorder files under,
 * and the lobby's device choices, which are where the room STARTS (see the
 * note on `LiveKitRoom`'s `audio`/`video` in `GuestRoom`).
 */
export interface GuestSession {
  kind: "guest";
  /** The share token the guest arrived by — the route their page lives at. */
  shareToken: string;
  meetId: string;
  meetTitle: string;
  token: string;
  url: string;
  /** Minted at join; the recorder files this guest's audio under it. */
  guestId: string;
  /** Gates the guest audio and chat routes in place of an employee token. */
  guestSessionId: string;
  guestName: string;
  micEnabled: boolean;
  camEnabled: boolean;
  micId: string;
  camId: string;
  /**
   * What the guest's page wants to know when the room ends — and why. The
   * page shows "This meeting has ended" for an organiser's End for everyone
   * and returns to its lobby for a plain Leave.
   */
  onLeave?: (reason?: LeaveReason) => void;
}

/**
 * Why a room closed, as far as the person in it is concerned.
 *
 * `"ended"` is the organiser's End for everyone (or a cancellation) reaching
 * this browser, whichever way it arrived — the socket, or the LiveKit room
 * being deleted underneath the call. `"left"` is the person's own Leave.
 * Everything else — a connection that gave up — is `undefined`, so a page can
 * tell "you were taken out" from "you chose to go".
 */
export type LeaveReason = "ended" | "left";

interface MeetingSessionValue {
  /** The meeting in progress, or null. */
  session: MeetingSession | null;
  /**
   * The element the page wants the meeting drawn over, or null when no page is
   * showing it.
   *
   * **The ELEMENT, not its rectangle.** A rectangle has to be re-measured on
   * every scroll and resize, and putting each measurement into React state
   * re-rendered the shell once per scroll frame — with the live video repainted
   * a frame behind the page it is supposed to be sitting in, which reads as the
   * meeting shivering against the page while you scroll.
   *
   * An element reference is stable, so it changes only when a page mounts or
   * unmounts a stage. The engine measures it in its own scroll handler and
   * writes the position straight onto a style, inside the same frame the
   * browser is already laying out — no render, no lag, nothing to see.
   */
  stageEl: HTMLElement | null;
  /** True while the meeting is drawn small, in a corner, over another page. */
  isFloating: boolean;
  open: (session: MeetingSession) => void;
  close: () => void;
  setStageEl: (el: HTMLElement | null) => void;
}

const Ctx = createContext<MeetingSessionValue | null>(null);

export function MeetingSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<MeetingSession | null>(null);
  const [stageEl, setStageElState] = useState<HTMLElement | null>(null);

  /**
   * The callbacks of whichever page is showing the meeting RIGHT NOW.
   *
   * ## The bug this exists for: pressing Leave did not leave
   *
   * `open` below deliberately keeps the PREVIOUS session object when the
   * meeting has not changed, so the shell is not re-rendered several times a
   * minute — see its own note. What that also kept was the previous object's
   * `onLeave`, and a page is not a fact about a meeting: it is a component
   * instance, and it is unmounted every time you navigate away.
   *
   * The whole point of this engine is that navigating away does NOT end the
   * meeting, so this is the ordinary path, not an edge case: open the meeting,
   * go and look at something else (the room floats), come back (it docks
   * again). Coming back mounts a NEW `MeetingDetailArea` — new `left` state,
   * new `setLeft` — which re-opens the same meeting and has its `onLeave`
   * quietly discarded in favour of the dead one belonging to the instance that
   * no longer exists.
   *
   * Pressing Leave then ran that dead callback: `setLeft(true)` on an unmounted
   * component is silently ignored, so the page never learned it was out and
   * went on rendering its stage and its "you are in this meeting" state. The
   * room DID disconnect — `close()` on the next line still ran — and then the
   * page's own effect, which opens a session whenever `left` is false, put the
   * reader straight back into the call. Which is exactly the report: the Leave
   * button visibly does nothing except make the meeting reappear.
   *
   * So the callbacks are recorded here, off the session object, on EVERY open —
   * including the ones that keep the previous object — and the object carries
   * stable forwarders that read this. Identity stays put for the shell; the
   * callbacks are always the live page's.
   */
  const liveRef = useRef<{
    onLeave?: (reason?: LeaveReason) => void;
    onConnected?: () => void;
  }>({});

  /* Stable for the provider's life, so the object comparison in `open` never
     sees a callback change and the shell is not re-rendered for one. */
  const forwardLeave = useCallback((reason?: LeaveReason) => {
    liveRef.current.onLeave?.(reason);
  }, []);
  const forwardConnected = useCallback(() => {
    liveRef.current.onConnected?.();
  }, []);

  const open = useCallback((incoming: MeetingSession) => {
    /* Recorded before the comparison below, and regardless of its outcome:
       "the same meeting" and "the same page instance" are different questions,
       and it is the second one that decides whose Leave this is. */
    liveRef.current = {
      onLeave: incoming.onLeave,
      onConnected: incoming.kind === "task" ? incoming.onConnected : undefined,
    };
    const next: MeetingSession =
      incoming.kind === "task"
        ? { ...incoming, onLeave: forwardLeave, onConnected: forwardConnected }
        : { ...incoming, onLeave: forwardLeave };
    setSession((prev) => {
      /**
       * **Re-opening the same meeting keeps the same session object.**
       *
       * The page opens from an effect keyed on the meeting it read, and
       * `useQuery` hands back a NEW object every time anything in the
       * repository changes — a timer tick, somebody else's write. Storing each
       * one would push a new context value through the whole shell several
       * times a minute for a meeting that had not changed.
       *
       * It does not reconnect anything either way — the engine keeps
       * `MeetingRoom` at one tree position and its token effect is keyed on the
       * room NAME, a string — so this is about not making the rest of the
       * application re-render, not about protecting the call.
       */
      if (!prev || prev.kind !== next.kind) return next;
      if (prev.kind === "scheduled" && next.kind === "scheduled") {
        if (
          prev.meeting.id === next.meeting.id &&
          prev.meeting.livekitRoomName === next.meeting.livekitRoomName &&
          prev.meeting.status === next.meeting.status &&
          prev.displayName === next.displayName &&
          prev.isOrganiser === next.isOrganiser
        )
          return prev;
      }
      if (prev.kind === "task" && next.kind === "task") {
        /* The token is deliberately NOT compared: a re-join mints a new one for
           the same room and session, and swapping it would reconnect a call
           that is already up. Identity is the session it opened. */
        if (
          prev.taskId === next.taskId &&
          prev.sessionId === next.sessionId &&
          prev.roomName === next.roomName &&
          prev.displayName === next.displayName &&
          prev.isHost === next.isHost
        )
          return prev;
      }
      if (prev.kind === "guest" && next.kind === "guest") {
        /* A guest's identity is the session `guest-join` minted: the same
           session re-opened (the page remounting under a live call) keeps the
           object; a fresh join is a different session and replaces it. */
        if (
          prev.guestSessionId === next.guestSessionId &&
          prev.meetId === next.meetId &&
          prev.shareToken === next.shareToken
        )
          return prev;
      }
      return next;
    });
  }, [forwardLeave, forwardConnected]);

  const close = useCallback(() => {
    setSession(null);
    /* Nothing is listening for this meeting's end any more. */
    liveRef.current = {};
    /**
     * **The stage is deliberately NOT cleared here.**
     *
     * It used to be, "so a stale stage would not park the next meeting over
     * wherever the last one happened to be drawn" — but a stage cannot go
     * stale that way. `MeetingStage` publishes its element when it mounts and
     * clears it when it unmounts, so the only way one outlives its page is if
     * something ELSE nulls it while that page is still on screen. Which is
     * what this line did.
     *
     * And it could not be undone: `MeetingStage`'s effect runs once, on mount,
     * so a stage cleared out from under a page that is still rendering it is
     * never re-published. The context then believes nobody is showing the
     * meeting for as long as the reader stays on the page — so the next
     * session opened drew itself in the little floating window, over a page
     * whose meeting area sat empty. That is the blank rectangle and the
     * floating box in the report.
     *
     * The stage belongs to whichever page is publishing it, and its mount and
     * unmount are the whole of that story. Closing a session is not an event
     * in it.
     */
  }, []);

  /* An element reference — stable by nature, so this fires when a page mounts
     or unmounts a stage and at no other time. */
  const setStageEl = useCallback((el: HTMLElement | null) => {
    setStageElState((prev) => (prev === el ? prev : el));
  }, []);

  const value = useMemo<MeetingSessionValue>(
    () => ({
      session,
      stageEl,
      isFloating: session !== null && stageEl === null,
      open,
      close,
      setStageEl,
    }),
    [session, stageEl, open, close, setStageEl],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The meeting session, or a dormant one.
 *
 * Never throws for a missing provider. This is read by the shell on every
 * route including the ones rendered before the provider exists — sign-in, the
 * guest page — and a hook that takes the application down because nobody is in
 * a meeting is worse than one that says so.
 */
export function useMeetingSession(): MeetingSessionValue {
  const ctx = useContext(Ctx);
  return (
    ctx ?? {
      session: null,
      stageEl: null,
      isFloating: false,
      open: () => {},
      close: () => {},
      setStageEl: () => {},
    }
  );
}
