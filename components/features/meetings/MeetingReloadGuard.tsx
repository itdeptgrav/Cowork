"use client";

import { useEffect } from "react";
import { useMeetingSession } from "./MeetingSessionContext";

/**
 * Ask before a reload takes somebody out of a meeting.
 *
 * ## Why a second guard rather than a change to the first
 *
 * `useMeetingRecording` already registers one, and it stays exactly as it is —
 * but it is gated on `isRecordingRef`, so it says nothing while somebody is in
 * a meeting that is not being recorded. That is most of a meeting's life: the
 * host has to press Record, and nobody does it in the first seconds.
 *
 * This one is gated on the SESSION instead, so the question is asked whenever
 * there is a call to lose — scheduled or a task's, docked or floating in the
 * corner. Two handlers both asking is harmless: the browser shows one dialog
 * for a page, not one per listener.
 *
 * ## The wording is the browser's, and cannot be ours
 *
 * `returnValue` is set because the specification still asks for it, and older
 * browsers use it. **No current browser shows it.** Chrome says "Reload site?
 * Changes you made may not be saved", Firefox and Safari say something close,
 * and every one of them ignores the string — a page that could write its own
 * text there would be a page that could impersonate the browser.
 *
 * So the text is there for the specification and for anything old enough to
 * honour it, and the value of this component is the PROMPT, not the words.
 *
 * ## It cannot fire on a page nobody has touched
 *
 * Browsers only honour `beforeunload` after a real interaction with the page —
 * a click, a key. Somebody who opened a meeting and immediately hit reload
 * without touching anything gets no dialog, and there is nothing a page can do
 * about that. In a meeting, joining is itself a click, so it holds in practice.
 */
export function MeetingReloadGuard() {
  const { session } = useMeetingSession();
  const inMeeting = session !== null;

  useEffect(() => {
    if (!inMeeting) return;

    const handler = (e: BeforeUnloadEvent) => {
      /* Both are required, and by different browsers: `preventDefault` is what
         the current specification asks for, `returnValue` is what older ones
         check. Setting one alone leaves a browser somewhere that does not ask. */
      e.preventDefault();
      e.returnValue =
        "You are in a meeting. Reloading will take you out of the room — your recording so far is saved.";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [inMeeting]);

  return null;
}
