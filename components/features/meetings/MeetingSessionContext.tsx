"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
export type MeetingSession = ScheduledSession | TaskSession;

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
   */
  onLeave?: () => void;
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

  const open = useCallback((next: MeetingSession) => {
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
      return next;
    });
  }, []);

  const close = useCallback(() => {
    setSession(null);
    /* Cleared with the session, not left behind: a stale stage would park the
       next meeting over wherever the last one happened to be drawn. */
    setStageElState(null);
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
