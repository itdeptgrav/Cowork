"use client";

import { useEffect, useRef } from "react";
import { useAction } from "@/lib/hooks/useRepository";
import { useMeetingSession } from "./MeetingSessionContext";

/** How often this browser says it is still in the room. */
const BEAT_MS = 20_000;

/**
 * Keeps a task meeting's credited session alive, from the shell.
 *
 * ## Why this had to move, and what breaks if it moves back
 *
 * A task meeting's attendance decides how much time is added to somebody's
 * deadline. Presence is not asserted by joining — it is asserted by a beat every
 * twenty seconds, and a row that stops beating lapses ninety seconds later, at
 * which point the room reads as empty and the session settles.
 *
 * All of that used to live in `TaskMeetingPanel`, which was correct while the
 * ROOM lived there too: navigating away unmounted the beat and the call
 * together, and the meeting simply ended. The moment the room outlives the page
 * — which is the whole point of the floating window — that arrangement becomes
 * a silent fault: the meeting carries on in the corner while the beat that
 * keeps its session alive has stopped, and ninety seconds later the deadline
 * credit stops for a conversation that is still happening. Nobody is told,
 * because from the reader's side nothing failed.
 *
 * So the beat lives beside the room, in the shell, and the two live or die
 * together. **If this ever moves back into a page, the corner window becomes a
 * meeting that is not being credited.**
 *
 * ## What it does on the way out
 *
 * `leave` records when this browser left; `end` settles the session if the room
 * is now empty. Both are called once, guarded by a ref, because a session can
 * be closed from three directions at once — the control bar's leave button, the
 * page's own Leave, and this component unmounting.
 *
 * `beforeunload` cannot await, so its call is fired and may die mid-flight.
 * That is why it is not the mechanism: the beat is. This is a courtesy that
 * makes the common case immediate rather than ninety seconds late.
 */
export function TaskMeetingLifecycle() {
  const { session, close } = useMeetingSession();
  const task = session?.kind === "task" ? session : null;
  const sessionId = task?.sessionId ?? null;
  const taskId = task?.taskId ?? null;

  const [leave] = useAction(
    (r, args: { taskId: string; sessionId: string }) =>
      r.leaveTaskMeeting(args),
  );
  const [end] = useAction(
    (r, args: { taskId: string; sessionId: string }) => r.endTaskMeeting(args),
  );
  const [touch] = useAction(
    (r, args: { taskId: string; sessionId: string }) =>
      r.touchTaskMeeting(args),
  );

  /* The beat. One immediately, so a tab that dies within twenty seconds of
     joining does not lapse from its join time — the same answer, but arrived
     at by accident rather than recorded. */
  useEffect(() => {
    if (!sessionId || !taskId) return;
    const args = { taskId, sessionId };
    void touch(args);
    const id = setInterval(() => void touch(args), BEAT_MS);
    return () => clearInterval(id);
  }, [sessionId, taskId, touch]);

  /**
   * Departure, once per session, whichever way out was taken.
   *
   * Held in a ref rather than state: nothing renders differently for having
   * departed, and the guard has to survive the unmount that triggers it.
   */
  const departedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || !taskId) return;
    const args = { taskId, sessionId };

    /* Built inside the effect so the guard is read in a CALLBACK rather than
       during render — the React Compiler forbids the latter, and rightly: a
       value read while rendering that nothing re-renders for is a value that
       will be stale exactly when it matters. */
    const bail = () => {
      if (departedRef.current === sessionId) return;
      departedRef.current = sessionId;
      void (async () => {
        await leave(args);
        /* Settles the session if this was the last person. Harmless if not:
           the rule reads the room's own attendance rather than trusting the
           caller. */
        await end(args);
      })();
    };

    window.addEventListener("beforeunload", bail);
    return () => {
      window.removeEventListener("beforeunload", bail);
      /* The session ending — by leaving, by the room disconnecting, or by this
         whole shell going away — is a departure like any other. The guard above
         is what keeps it to one per session when several arrive at once. */
      bail();
    };
  }, [sessionId, taskId, leave, end]);

  /* Nothing to draw. The room is the engine's business; this is only the
     bookkeeping that has to outlive the page. */
  void close;
  return null;
}
