"use client";

import { useEffect, useState } from "react";
import {
  VideoTrack,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Icon } from "@/components/ui/Icons";
import type { MonitoredPresence } from "@/lib/domain";

/**
 * The live screen.
 *
 * This is the one surface on the page that is not a summary of something — it
 * is the thing itself — so it gets the largest area, the darkest material and
 * the only moving content. Everything else on the page explains it.
 *
 * It consumes the existing LiveKit implementation and adds nothing to it:
 * `useTracks` for the screen-share source, `VideoTrack` to render. The only
 * judgement it makes is *whose* track to show — tracks are matched against the
 * subject's `presenceIdentity`, because a monitoring view that renders whatever
 * screen happens to be in the room would eventually put one person's work under
 * another person's name.
 *
 * The frame is a slab rather than a frosted panel. docs/architecture/DESIGN.md reserves the slab
 * for measurement, and a live screen is the most literal measurement in the
 * product — it is also the only way to seat moving video without the frost's
 * translucency fighting whatever is on the employee's desktop.
 */

interface ViewerProps {
  presenceIdentity: string;
  displayName: string;
  presence: MonitoredPresence;
  connecting: boolean;
  error: string | null;
}

/**
 * The public component. It decides only one thing: whether there is a room to
 * ask.
 *
 * `useTracks` throws outside a `<LiveKitRoom>`, and there is legitimately no
 * room during the server render, before the token lands, or after a connection
 * failure. Rather than guard the hook — which cannot be done, hooks are not
 * conditional — the two cases are two components, and this picks between them.
 * The frame is identical either way, so the switch is invisible.
 */
export function LiveScreenViewer(props: ViewerProps & { inRoom: boolean }) {
  const { inRoom, ...rest } = props;
  return inRoom ? (
    <SubscribedViewer {...rest} />
  ) : (
    <ViewerFrame {...rest} match={null} />
  );
}

function SubscribedViewer(props: ViewerProps) {
  const tracks = useTracks([
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);

  /* `withPlaceholder: false` means every entry here has a real publication, but
     the hook's return type keeps `publication` optional for the placeholder
     case. Narrowing once, here, is what lets `VideoTrack` be called without a
     cast — and it is also where the identity match happens, so there is exactly
     one place that decides whose screen this is. */
  const match =
    tracks.find(
      (t): t is TrackReference =>
        t.participant.identity === props.presenceIdentity && !!t.publication,
    ) ?? null;

  return <ViewerFrame {...props} match={match} />;
}

function ViewerFrame({
  displayName,
  presence,
  connecting,
  error,
  match,
}: ViewerProps & { match: TrackReference | null }) {
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
        <LiveBadge live={!!match} presence={presence} />
        <p className="min-w-0 flex-1 truncate pt-0.5 text-xs text-slab-ink-muted">
          {match
            ? "Entire screen · publishing now"
            : connecting
              ? "Joining the monitoring room…"
              : "No screen is being shared"}
        </p>
        {match && <Elapsed />}
      </header>

      {match ? (
        <VideoTrack
          trackRef={match}
          className="h-full w-full flex-1 object-contain"
        />
      ) : (
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
}: {
  displayName: string;
  presence: MonitoredPresence;
  connecting: boolean;
  error: string | null;
}) {
  const first = displayName.split(" ")[0];

  const { title, detail } = error
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
