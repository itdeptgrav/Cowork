"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fetchWatchSeat } from "@/lib/integrations/grav/credentials";

/**
 * The manager's seat in ONE person's room.
 *
 * **A room per subject, not one room for the company.** It used to join a single
 * shared room and pick the right participant out of it, which made the
 * permission a rendering decision: every manager's token could subscribe to
 * everybody's track, and only an identity match in a component decided what
 * appeared on screen. The seat is now minted for `subjectId`'s own room and the
 * server refuses to issue it to anybody but that person's primary manager — so
 * the permission is carried by the credential, and a mistake in a component
 * cannot put the wrong screen in front of anybody.
 *
 * It no longer joins anything itself: presence runs on Grav Stream, whose media
 * is reachable only through their embed, so what this resolves is the PAGE the
 * viewer renders in a frame. It fetches on mount rather than behind a Connect
 * button — the page's whole purpose is the live screen, and making somebody
 * press a button to begin doing what they came to do is a step that existed only
 * because the test page had one.
 *
 * Failure is a state, not a silence. A seat that is refused renders its own
 * reason through `children` — including "Only their primary manager can watch
 * this screen", which is the sentence that explains why somebody else's screen
 * is not theirs to open.
 */
export function MonitorRoom({
  subjectId,
  children,
}: {
  /** Whose screen this view is for. No subject, no seat requested. */
  subjectId: string | null;
  children: (state: {
    /** The page to render for this person's room, once there is one. */
    embedUrl: string | null;
    connecting: boolean;
    error: string | null;
  }) => ReactNode;
}) {
  /**
   * The seat, stamped with WHOSE it is.
   *
   * Carrying the subject in the state rather than clearing it when the prop
   * changes is what keeps this correct without a synchronous reset in the
   * effect: a seat for the person who was on screen a moment ago is simply not
   * used for the person who is on screen now, so nobody's room is ever rendered
   * with the previous subject's credentials while the new ones are in flight.
   */
  const [seat, setSeat] = useState<{ subject: string; embedUrl: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<{
    subject: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    /* A page still resolving its subject asks for nothing. Requesting a seat for
       an empty id would spend a refusal on a question nobody asked, and render
       its message where the person expects a loading state. */
    if (!subjectId) return;
    let cancelled = false;
    fetchWatchSeat(subjectId)
      .then((s) => {
        if (!cancelled) setSeat({ subject: subjectId, embedUrl: s.embedUrl });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFailure({
          subject: subjectId,
          message:
            e instanceof Error
              ? e.message
              : "The monitoring room could not be reached.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  const current = seat && seat.subject === subjectId ? seat : null;
  const error =
    failure && failure.subject === subjectId ? failure.message : null;

  return (
    <>
      {children({
        embedUrl: current?.embedUrl ?? null,
        connecting: subjectId !== null && current === null && error === null,
        error,
      })}
    </>
  );
}
