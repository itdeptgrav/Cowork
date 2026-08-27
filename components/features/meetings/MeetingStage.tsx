"use client";

import { useEffect, useRef } from "react";
import { useMeetingSession } from "./MeetingSessionContext";

/**
 * The hole in the page where the meeting is drawn.
 *
 * It renders nothing but a sized box, and does not measure itself. The meeting
 * lives in the shell (`MeetingEngine`), which is positioned over this box —
 * navigating away moves the picture into a corner and never touches the
 * connection.
 *
 * **Registering the element rather than publishing a rectangle** is what keeps
 * scrolling smooth. Measuring here meant a new `DOMRect` into React state on
 * every scroll frame, a re-render of the shell each time, and the live video
 * repainted a frame behind the page it sits in — the meeting shivering against
 * the page as you scrolled. The engine measures instead, in its own handler,
 * and writes the position straight onto a style with no render in between.
 */
export function MeetingStage({ className }: { className?: string }) {
  const { setStageEl } = useMeetingSession();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStageEl(ref.current);
    /* **Cleared on unmount, and this is the whole mechanism.** Leaving the page
       unmounts this, the stage goes null, and the engine reads that as "nobody
       is showing the meeting" and floats it into the corner. The back button
       needs no interception at all — it simply stops offering a place to
       draw. */
    return () => setStageEl(null);
  }, [setStageEl]);

  return <div ref={ref} className={className} aria-hidden />;
}
