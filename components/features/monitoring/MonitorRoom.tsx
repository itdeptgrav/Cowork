"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  fetchRoomPresence,
  fetchWatchSeat,
} from "@/lib/integrations/grav/credentials";
import { useScreenShareRequired } from "@/lib/hooks/useScreenSharePolicy";

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
    /**
     * Is a screen going out RIGHT NOW, as the SERVICE reports it — `null` until
     * it has been asked.
     *
     * **This is here because the frame cannot be trusted to say so.** Their
     * embed renders a share that was already running when a viewer joined, and
     * does not post `remote-screen-started` for it — so a panel that believed
     * only the frame's events covered a perfectly good picture with "Their
     * screen is not reaching this view". `participants[].sharing.screen` is the
     * same fact the sharer's own confirmation uses, and it is true whoever is
     * looking.
     */
    sharing: boolean | null;
    /**
     * This workspace does not watch screens at all — the office-policy switch.
     *
     * Distinct from "they are not sharing right now", and the panel has to say
     * so differently: one is a person to wait for, the other is a feature that
     * has been switched off, and a manager who reads the second as the first
     * goes looking for somebody to chase.
     */
    screenSharingOff: boolean;
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
  /* Whether this workspace watches screens at all — the office-policy switch. */
  const screenRequired = useScreenShareRequired();

  useEffect(() => {
    /* A page still resolving its subject asks for nothing. Requesting a seat for
       an empty id would spend a refusal on a question nobody asked, and render
       its message where the person expects a loading state.

       Nor does a workspace that has switched screen sharing off: there is no
       room to watch, and minting a seat for one would be a request per manager
       per page for a picture nobody is producing. */
    if (!subjectId || !screenRequired) return;
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
  }, [subjectId, screenRequired]);

  /**
   * Ask the service whether a screen is actually going out, and keep asking.
   *
   * Stamped with the subject for the same reason the seat is: an answer about
   * the person who was on screen a moment ago must never be read as an answer
   * about the person on screen now.
   *
   * Polled rather than pushed because there is nothing to push it: the room's
   * participant list is a REST read, and the one thing that would have told us
   * live — the embed's own event — is precisely what does not arrive for a
   * share that started before the viewer opened.
   */
  const [live, setLive] = useState<{ subject: string; sharing: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!subjectId || !screenRequired) return;
    let cancelled = false;
    async function ask(subject: string) {
      try {
        const room = await fetchRoomPresence({ subject, role: "watch" });
        if (!cancelled) setLive({ subject, sharing: room.sharing });
      } catch {
        /* A question that could not be asked is not a no. The previous answer
           stands, and the next tick asks again. */
      }
    }
    void ask(subjectId);
    const id = setInterval(() => void ask(subjectId), SHARING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [subjectId, screenRequired]);

  const current = seat && seat.subject === subjectId ? seat : null;
  const error =
    failure && failure.subject === subjectId ? failure.message : null;

  return (
    <>
      {children({
        embedUrl: current?.embedUrl ?? null,
        /**
         * **Not "connecting" where there is nothing to connect to.** With
         * sharing switched off the panel would otherwise sit on "Opening their
         * room…" for ever, waiting for a seat this component deliberately never
         * asks for. It resolves to the off state instead, which the viewer
         * explains.
         */
        connecting:
          screenRequired &&
          subjectId !== null &&
          current === null &&
          error === null,
        error,
        sharing: live && live.subject === subjectId ? live.sharing : null,
        screenSharingOff: !screenRequired,
      })}
    </>
  );
}

/* Often enough that a screen appearing is noticed within a few seconds, rarely
   enough that a manager watching for an hour is not a stream of requests. */
const SHARING_POLL_MS = 5000;
