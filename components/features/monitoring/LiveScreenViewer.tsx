"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { readEmbedEvent } from "@/lib/integrations/grav/embed";
import type { MonitoredPresence } from "@/lib/domain";

/**
 * The live screen.
 *
 * This is the one surface on the page that is not a summary of something — it
 * is the thing itself — so it gets the largest area, the darkest material and
 * the only moving content. Everything else on the page explains it.
 *
 * **It is Grav Stream's own page, in a frame.** Presence runs on their service —
 * OWNER DECISION — and their realtime media is reachable only through the embed,
 * so there is no track to subscribe to and no video element to place. What used
 * to happen here was an identity match against `presenceIdentity`, filtering one
 * shared room down to the right person. Losing that is a strengthening: the seat
 * this manager holds is for ONE person's room and the server refuses to issue it
 * to anybody but their primary manager, so the permission is carried by the
 * credential rather than by a component getting a filter right.
 *
 * The frame is a slab rather than a frosted panel. docs/architecture/DESIGN.md reserves the slab
 * for measurement, and a live screen is the most literal measurement in the
 * product — it is also the only way to seat moving video without the frost's
 * translucency fighting whatever is on the employee's desktop.
 */

interface ViewerProps {
  displayName: string;
  presence: MonitoredPresence;
  connecting: boolean;
  error: string | null;
  /**
   * The page this manager was granted for THIS person's room, or null.
   *
   * Null covers the server render, a seat still being minted, and a refusal —
   * `MonitorRoom` decides which, and `error` carries the reason.
   */
  embedUrl: string | null;
  /**
   * A screen is going out, as the SERVICE reports it — `null` until asked.
   *
   * **The frame is not the only witness, and it turned out not to be a reliable
   * one.** Their embed renders a share that was already running when a viewer
   * joined, but posts no `remote-screen-started` for it: the picture is on
   * screen and the event never comes. A panel that believed only the events
   * covered a working screen with "Their screen is not reaching this view" and
   * a Join again button, which is worse than the silence it replaced.
   */
  sharing: boolean | null;
  /**
   * Stand down: something else is showing this person's screen right now.
   *
   * **Every live frame decodes its own copy of the stream.** Their guidance is
   * blunt about what that costs: *"A dashboard showing eight employees' screens
   * live and simultaneously will make the MANAGER's machine slow, for the same
   * reason encoding makes the sharer's slow."* This page had two of them for
   * ONE person — the panel in the column and the expanded dialog over it —
   * decoding the same picture twice for as long as the dialog was open.
   *
   * The frame is not rendered while this is set, and the panel says where the
   * screen went rather than going blank.
   */
  suspended?: boolean;
}

export function LiveScreenViewer(props: ViewerProps) {
  return <ViewerFrame {...props} />;
}

function ViewerFrame({
  displayName,
  presence,
  connecting,
  error,
  embedUrl,
  sharing,
  suspended = false,
}: ViewerProps) {
  /* Whether their room is on screen at all. NOT whether a screen is arriving —
     that is inside the frame, and only the frame's own messages say so. */
  const room = embedUrl !== null && !error && !suspended;
  /**
   * **What the frame itself reports.** For a while nothing on this side
   * listened, and that is what produced the fault this exists to answer: a
   * manager watching somebody who was demonstrably sharing — the service showed
   * the producer, the room showed both of them in it — saw a black rectangle
   * and no sentence anywhere, while the embed was posting its state out loud.
   *
   * A frame that has joined and has no screen is a different thing from one
   * that failed, and both are different from one that never loaded. Each says
   * so now.
   */
  const frame = useEmbedReport(suspended ? null : embedUrl);
  /**
   * The badge answers "is this person sharing", and two sources can say so: the
   * frame, which knows what it is rendering, and the published presence, which
   * is what everybody else reads. The frame wins when it has spoken — it is the
   * one looking at the picture.
   *
   * It used to read `room`, which lit "Live" the moment a URL existed. A badge
   * saying Live over an empty rectangle is worse than no badge: it is the one
   * thing on the panel a manager would take on trust.
   */
  /**
   * **Live means a picture is going out, and two witnesses can say so.**
   *
   * The frame knows what it is rendering — when it speaks, it is right, and it
   * is instant. But it says nothing at all about a share that was already
   * running when this view joined, which is the ordinary case for a manager
   * opening somebody's panel mid-morning. So the SERVICE answers for it: the
   * room's own `participants[].sharing.screen`, polled by `MonitorRoom`.
   *
   * `??` and not `||`: an explicit `false` from the frame — it saw the share
   * stop — is an answer, and must not be overruled by a poll taken seconds
   * before. Only silence falls through to the service.
   *
   * What is NOT consulted is their published presence. That is what everybody
   * reads about the person, not about the picture, and believing it is how a
   * green "Live" badge came to sit over a black rectangle.
   */
  const picture = room && (frame.remoteScreen ?? sharing) === true;
  const live = picture;
  return (
    <section
      aria-label={`${displayName} — live screen`}
      className="slab slab-flat relative flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-card"
      data-on-slab
    >
      {/* The chrome floats over the video rather than sitting above it: the
          reference puts its status and controls inside the frame, and a bar
          stacked on top would cost the screen the height it exists for. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 bg-gradient-to-b from-black/55 to-transparent px-4 pt-3.5 pb-8">
        <LiveBadge live={live} presence={presence} />
        <p className="min-w-0 flex-1 truncate pt-0.5 text-xs text-slab-ink-muted">
          {/* No "press Join" any more — there is no Join. That copy was left
              over from the meeting rooms, and it sent managers looking for a
              button that does not exist on a screen room. */}
          {room
            ? live
              ? "Their screen, live"
              : frame.joined
                ? "In their room — nothing is being shared into it"
                : "Opening their room…"
            : connecting
              ? "Opening their room…"
              : "No screen is being shared"}
        </p>
        {live && <Elapsed />}
      </header>

      {room && embedUrl ? (
        /* `absolute inset-0` rather than a flow child with `h-full`: a frame
           sized by `height: 100%` inside a container whose own height derives
           from its content collapses, and this section's height comes from
           `min-h-[320px]` / `flex-1` above. Out of flow, it can only ever fill
           the box that already exists. */
        <iframe
          /**
           * **Keyed on the attempt, so a retry really is a fresh join.**
           *
           * Changing the `src` of a live frame is not reliably a reload, and
           * this is the one lever the host page has: their embed subscribes
           * when it joins, so a view that joined and never received the screen
           * has nothing to do but join again. See `useEmbedReport`.
           */
          key={frame.attempt}
          title={`${displayName} — live screen`}
          src={embedUrl}
          /**
           * The same permissions the sharer's frame gets, and the reason is
           * worth stating because withholding them looks safer and is not.
           *
           * Without this the embed refuses at its own join screen — "Camera and
           * microphone are blocked. If this meeting is embedded, the iframe
           * needs allow=…" — and a manager sees that instead of a screen. What
           * actually stops a watcher publishing anything is the SEAT: their
           * token is minted `canPublish: false`, server-side, in a route that
           * will not issue it to anybody but this person's primary manager. An
           * iframe attribute was never the guard; it only decided whether their
           * own devices could be reached, and their own devices are not what
           * this panel is about.
           */
          allow="camera; microphone; display-capture; autoplay"
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : null}

      {/* Over the frame, never instead of it: unmounting the frame to show a
          message would drop the connection that is about to deliver the very
          thing being waited for. */}
      {room && embedUrl && !picture && (
        <FrameReport
          displayName={displayName}
          presence={presence}
          sharing={sharing}
          report={frame}
        />
      )}

      {!(room && embedUrl) && (
        <ViewerPlaceholder
          displayName={displayName}
          presence={presence}
          connecting={connecting}
          error={error}
        />
      )}
    </section>
  );
}

/**
 * How long a joined frame is given to produce a picture before this says so.
 *
 * Their embed subscribes when it joins, so a screen that is already going out
 * should arrive within a second or two of `joined`. Eight seconds is long
 * enough that a slow network is not reported as a fault, short enough that a
 * manager is not left studying a black rectangle wondering whose fault it is.
 */
const SCREEN_WAIT_MS = 8000;

interface EmbedReport {
  /** The frame has answered at all. */
  ready: boolean;
  /** The frame is in the room. */
  joined: boolean;
  /**
   * Whether a remote screen is being rendered, per the frame — `null` until it
   * has said either way, which is different from "no".
   */
  remoteScreen: boolean | null;
  /** The embed's own words for a failure, if it reported one. */
  failure: string | null;
  /** Bumped to remount the frame. See `key` on the iframe. */
  attempt: number;
  /** Joined, a share is expected, and nothing has arrived. */
  waited: boolean;
  retry: () => void;
}

/**
 * Listen to the watcher's frame.
 *
 * **The fault this answers.** A manager opened somebody's screen while that
 * person was demonstrably sharing — the service reported the producer, and both
 * of them in the same room — and saw black. Nothing was wrong with the token,
 * the room or the identity, and nothing on this side was listening to the one
 * thing that could have explained it: the frame's own messages.
 *
 * It also gives the view its single retry. Their embed subscribes to what is in
 * the room when it JOINS, so a view that joined and never received the screen
 * has exactly one move — join again — and a manager should not have to know
 * that reloading the page is what does it.
 */
interface FrameState {
  /**
   * Which frame this describes — the URL and the attempt number.
   *
   * **Carried in the state rather than reset by an effect.** A new person, a
   * fresh seat or a retry is a new conversation, and the old frame's answers
   * must not be read as the new one's. Clearing them in an effect would mean a
   * render in between that still showed the previous frame's verdict, which is
   * how a stale "not reaching this view" ends up over a working screen.
   */
  key: string;
  ready: boolean;
  joined: boolean;
  remoteScreen: boolean | null;
  failure: string | null;
}

const BLANK: Omit<FrameState, "key"> = {
  ready: false,
  joined: false,
  remoteScreen: null,
  failure: null,
};

function useEmbedReport(embedUrl: string | null): EmbedReport {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FrameState>({ key: "", ...BLANK });
  const [waited, setWaited] = useState<string | null>(null);

  const key = `${embedUrl ?? ""}#${attempt}`;
  /* Derived, not reset: anything recorded against another frame is not about
     this one. */
  const current = state.key === key ? state : { key, ...BLANK };

  useEffect(() => {
    if (!embedUrl) return;
    function onMessage(event: MessageEvent) {
      const message = readEmbedEvent(event);
      if (!message) return;
      /* Logged as well as rendered: the codes are theirs, and the console is
         where a second pair of eyes will look first. */
      console.info("[stream] embed →", message.type, message.code ?? "");
      const patch = ((): Partial<FrameState> | null => {
        switch (message.type) {
          case "ready":
            return { ready: true };
          case "joined":
            return { ready: true, joined: true };
          case "remote-screen-started":
            return { remoteScreen: true, failure: null };
          case "remote-screen-stopped":
          case "screen-share-stopped":
          case "participant-left":
            return { remoteScreen: false };
          case "left":
            return { joined: false, remoteScreen: false };
          case "error":
            /* Their message, verbatim. A code with no sentence is what made
               this panel unreadable in the first place. */
            return {
              failure:
                message.message ??
                `The screen-sharing service reported ${message.code ?? "an error"}.`,
            };
          default:
            return null;
        }
      })();
      if (!patch) return;
      setState((prev) => ({
        ...(prev.key === key ? prev : { key, ...BLANK }),
        key,
        ...patch,
      }));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedUrl, key]);

  /* The deadline. Starts at `joined`, because a frame that has not joined is
     not late — it is loading. Recorded as the key it applies to, so a retry
     does not inherit the previous attempt's verdict. */
  const pending = current.joined && current.remoteScreen === null;
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setWaited(key), SCREEN_WAIT_MS);
    return () => clearTimeout(id);
  }, [pending, key]);

  /**
   * **Rejoin once, on its own, before asking anybody to press anything.**
   *
   * Reported as "sometimes the receiver's screen is black, sometimes it works"
   * — the same room, the same two people, a different outcome each time. That
   * shape is a subscription that started without a keyframe to decode: the
   * stream is there and the first paintable frame never arrives, and rejoining
   * asks for one.
   *
   * Exactly once per frame, and only where a screen IS going out (the caller
   * only mounts this component's report when it is). A loop of rejoins would
   * be worse than a black rectangle: each one costs the sharer a keyframe,
   * which is bitrate taken from the sharpness of the picture everybody else is
   * watching. If the second attempt is silent too, the button appears and a
   * person decides.
   */
  const healed = useRef<string | null>(null);
  const late = waited === key && pending;
  useEffect(() => {
    if (!late || healed.current === key || attempt > 0) return;
    healed.current = key;
    console.info("[stream] no picture after joining — rejoining once");
    setAttempt((n) => n + 1);
  }, [late, key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    ...current,
    attempt,
    /* Not "late" — that fires the automatic rejoin above. This is what the
       PERSON is told about, and only after the free attempt has been spent. */
    waited: late && attempt > 0,
    retry,
  };
}

/**
 * What is on the panel when there is no picture.
 *
 * Never a bare black rectangle. Each state gets its own sentence, because the
 * difference between "they stopped sharing", "the room will not connect" and
 * "their screen is not reaching this view" decides what a manager does next —
 * wait, message them, or press retry.
 */
function FrameReport({
  displayName,
  presence,
  sharing,
  report,
}: {
  displayName: string;
  presence: MonitoredPresence;
  sharing: boolean | null;
  report: EmbedReport;
}) {
  const first = displayName.split(" ")[0];
  /**
   * **Two weights, and the difference matters.**
   *
   * A settled state — it failed, they stopped, they are on a break — earns a
   * full cover: there is nothing behind it to look at. The first seconds after
   * joining do not: the picture may be arriving, and their embed could render
   * one without announcing it. So that one is a quiet line at the bottom that
   * takes no clicks and hides nothing.
   */
  const settled =
    report.failure !== null ||
    !report.ready ||
    report.remoteScreen === false ||
    sharing === false ||
    report.waited ||
    presence !== "online";
  const { title, detail, showRetry } = report.failure
    ? {
        title: "Their screen could not be shown",
        detail: report.failure,
        showRetry: true,
      }
    : !report.ready
      ? {
          title: "Opening their room…",
          detail: "Connecting to the screen-sharing service.",
          showRetry: false,
        }
      : sharing === false
        ? {
            /* The SERVICE says nothing is going out. That is not this view
               failing, and calling it a failure would send a manager chasing a
               connection problem that does not exist. */
            title: `${first} is not sharing a screen`,
            detail:
              presence === "online"
                ? "They are online, but nothing is being published into their room right now."
                : "Nothing is being published into their room right now.",
            showRetry: false,
          }
        : report.waited
          ? {
              title: "Their screen is not reaching this view",
              detail: `Nothing has arrived here, and the service could not confirm what ${first} is sharing. Joining again usually picks it up.`,
              showRetry: true,
            }
          : presence === "break"
          ? {
              title: `${first} is on a break`,
              detail: "The room stays open. Sharing resumes on their return.",
              showRetry: false,
            }
          : presence === "emergency"
            ? {
                title: `${first} has flagged an emergency`,
                detail: "Screen sharing is unchanged. Reach them directly.",
                showRetry: false,
              }
            : {
                title: `Waiting for ${first}’s screen`,
                detail:
                  "You are in their room. Anything they share appears here on its own.",
                showRetry: false,
              };

  if (!settled) {
    return (
      <p className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/55 to-transparent px-4 pt-8 pb-3.5 text-center text-[11px] text-slab-ink-muted">
        {title}
      </p>
    );
  }

  return (
    <div className="absolute inset-0 grid place-items-center bg-black/70 px-8 text-center">
      <div className="max-w-[40ch]">
        <p className="text-[15px] font-medium text-slab-ink">{title}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-slab-ink-muted">
          {detail}
        </p>
        {showRetry && (
          <button
            type="button"
            onClick={report.retry}
            className="mt-3.5 rounded-full bg-white/12 px-3.5 py-1.5 text-xs font-medium text-slab-ink transition-colors hover:bg-white/20"
          >
            Join again
          </button>
        )}
      </div>
    </div>
  );
}

function LiveBadge({
  live,
  presence,
}: {
  live: boolean;
  presence: MonitoredPresence;
}) {
  if (!live) {
    /* The badge reports THIS room, not the presence feed. Someone the feed
       calls online with no track in the room is "no feed" — saying "Offline"
       there would contradict the panel three inches to the left, and one of
       the two would be wrong. */
    return (
      <span className="pointer-events-none inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slab-ink">
        {presence === "break"
          ? "On a break"
          : presence === "emergency"
            ? "Emergency"
            : presence === "online"
              ? "No feed"
              : "Offline"}
      </span>
    );
  }
  return (
    <span className="pointer-events-none inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slab-ink">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-[var(--state-positive)]"
        style={{ boxShadow: "0 0 8px 1px var(--state-positive)" }}
      />
      Live
    </span>
  );
}

/**
 * Time since this viewer saw the stream start.
 *
 * Deliberately labelled "watching", not "online": it measures this session's
 * subscription, and claiming it measured the employee's day would be a number
 * that looks authoritative and is not. The employee's online duration comes
 * from the presence feed, on the panel that owns it.
 */
function Elapsed() {
  /* Seconds live in state, not in a ref read during render: the clock IS the
     render, so the value the component draws has to be one React owns. */
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(
      () => setSecs(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <span
      data-figure
      className="pointer-events-none shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-slab-ink"
      title="Time watching this stream"
    >
      {mm}:{ss}
    </span>
  );
}

/**
 * The empty frame.
 *
 * Four different reasons live here and each gets its own sentence. A single
 * "waiting…" would tell a manager nothing about whether to wait, to message, or
 * to check their own connection — and the difference between "they are on a
 * break" and "the room will not connect" is the whole value of the panel when
 * there is no picture.
 */
function ViewerPlaceholder({
  displayName,
  presence,
  connecting,
  error,
  suspended = false,
}: {
  displayName: string;
  presence: MonitoredPresence;
  connecting: boolean;
  error: string | null;
  /** The screen is being shown somewhere else — see `ViewerProps.suspended`. */
  suspended?: boolean;
}) {
  const first = displayName.split(" ")[0];

  const { title, detail } = suspended
    ? {
        /* The frame moved, it did not fail. Said plainly so nobody reads an
           empty panel as a broken one and starts pressing things. */
        title: "Showing in the expanded view",
        detail:
          "One view at a time: each live frame decodes its own copy of the picture, and two would slow this machine down. Close the expanded view to bring it back here.",
      }
    : error
    ? {
        title: "The monitoring room could not be reached",
        detail: error,
      }
    : connecting
      ? { title: "Connecting", detail: "Joining the monitoring room." }
      : presence === "break"
        ? {
            title: `${first} is on a break`,
            detail: "The connection is held open. Sharing resumes on return.",
          }
        : presence === "emergency"
          ? {
              title: `${first} has flagged an emergency`,
              detail: "Screen sharing is unchanged. Reach them directly.",
            }
          : presence === "online"
            ? {
                title: `No screen is reaching this room`,
                detail: `${first} is reported online, but nothing is publishing here. They may have stopped sharing, or be connected from another session.`,
              }
            : {
                title: `${first} is not sharing a screen`,
                detail:
                  "Going online requires sharing an entire screen, so nothing is published while they are offline.",
              };

  return (
    <div className="grid flex-1 place-items-center px-8 py-14 text-center">
      <div className="max-w-[38ch]">
        <span
          aria-hidden="true"
          className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-white/[0.07] text-slab-ink-muted"
        >
          <Icon.overview className="h-5 w-5" />
        </span>
        <p className="text-[15px] font-medium text-slab-ink">{title}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-slab-ink-muted">
          {detail}
        </p>
      </div>
    </div>
  );
}
