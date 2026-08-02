"use client";

/**
 * Guest meeting flow — no Cowork account needed.
 *
 * The host copies a public share link from the meeting detail page and sends
 * it to whoever they want to include. That person lands here:
 *
 *   1. Lobby — shows the meeting title, asks for a name, verifies the link is
 *      still open. Error states cover: invalid token, meeting not started yet,
 *      meeting ended, and server errors.
 *   2. Room — once the guest submits their name and the backend returns LiveKit
 *      credentials, we drop them into a lightweight LiveKit room. No recording
 *      hook (guests can't upload to Drive), no transcript (needs LiveKit
 *      DataChannel which needs auth participants to broadcast), just the
 *      participant grid + control bar.
 *
 * All API calls go through `meetingMedia.ts` — the `getPublicMeetingInfo` and
 * `guestJoinMeeting` functions hit the NO-AUTH backend routes directly.
 */

import { useEffect, useState } from "react";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { Icon } from "@/components/ui/Icons";
import {
  getPublicMeetingInfo,
  guestJoinMeeting,
} from "@/lib/legacy/meetingMedia";

// ── Component ──────────────────────────────────────────────────────────────────

type Phase =
  | { kind: "loading" }
  | { kind: "lobby"; meetTitle: string; status: string; canJoin: boolean }
  | { kind: "room"; token: string; url: string; meetTitle: string }
  | { kind: "error"; message: string };

export function GuestMeetingArea({ shareToken }: { shareToken: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Resolve the token to meeting info on first render
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getPublicMeetingInfo({ shareToken });
      if (cancelled) return;
      if (!res.ok) {
        setPhase({ kind: "error", message: res.error.message });
        return;
      }
      const d = res.data ?? {};
      setPhase({
        kind: "lobby",
        meetTitle: d.meetTitle ?? "CoWork Meeting",
        status: d.status ?? "unknown",
        canJoin: d.canJoin ?? false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  async function join() {
    const safeName = name.trim();
    if (!safeName) return;
    setJoining(true);
    setJoinError(null);
    try {
      const res = await guestJoinMeeting({
        shareToken,
        guestName: safeName,
      });
      if (!res.ok) throw new Error(res.error.message);
      const d = res.data!;
      if (!d.token || !d.url)
        throw new Error("Server did not return room credentials.");
      setPhase({
        kind: "room",
        token: d.token,
        url: d.url,
        meetTitle: d.meetTitle ?? "CoWork Meeting",
      });
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Could not join.");
    } finally {
      setJoining(false);
    }
  }

  if (phase.kind === "loading") return <Shell><Spinner /></Shell>;
  if (phase.kind === "error") return <Shell><ErrorCard message={phase.message} /></Shell>;
  if (phase.kind === "room") {
    return (
      <GuestRoom
        token={phase.token}
        url={phase.url}
        meetTitle={phase.meetTitle}
        onLeave={() =>
          setPhase({
            kind: "lobby",
            meetTitle: phase.meetTitle,
            status: "ended",
            canJoin: false,
          })
        }
      />
    );
  }

  // Lobby
  const { meetTitle, status, canJoin } = phase;
  return (
    <Shell>
      <div className="w-full max-w-sm space-y-5 text-center">
        {/* Logo / icon */}
        <span
          aria-hidden="true"
          className="mx-auto block h-12 w-12 rounded-full bg-white/[0.07] text-2xl leading-[3rem]"
        >
          🤝
        </span>

        <div>
          <h1 className="text-lg font-semibold text-slab-ink">{meetTitle}</h1>
          <p className="mt-1 text-[13px] text-slab-ink-muted">
            {status === "live"
              ? "The meeting is in progress."
              : status === "waiting"
                ? "The host has opened the room."
                : "The meeting hasn't started yet."}
          </p>
        </div>

        {canJoin ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
            className="space-y-3"
          >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={60}
              required
              disabled={joining}
              className="w-full rounded-inset border border-white/20 bg-white/[0.07] px-4 py-2.5 text-sm text-slab-ink placeholder:text-slab-ink-muted focus:outline-none focus:ring-2 focus:ring-white/30"
            />
            {joinError && (
              <p className="text-[12px] text-[var(--state-overdue-ink)]">
                {joinError}
              </p>
            )}
            <button
              type="submit"
              disabled={joining || !name.trim()}
              className="w-full rounded-inset bg-white/20 py-2.5 text-sm font-medium text-slab-ink transition-colors hover:bg-white/30 disabled:opacity-40"
            >
              {joining ? "Joining…" : "Join meeting"}
            </button>
          </form>
        ) : (
          <p className="rounded-inset border border-white/10 bg-white/[0.05] px-4 py-3 text-[13px] text-slab-ink-muted">
            {status === "ended" || status === "completed" || status === "archived"
              ? "This meeting has ended."
              : "This link is not currently active. Ask the host to share an active link."}
          </p>
        )}

        <p className="text-[11px] text-slab-ink-muted">
          Powered by{" "}
          <span className="font-medium text-slab-ink">CoWork</span>
        </p>
      </div>
    </Shell>
  );
}

// ── Guest room — no recording, just the grid + controls ──────────────────────

function GuestRoom({
  token,
  url,
  meetTitle,
  onLeave,
}: {
  token: string;
  url: string;
  meetTitle: string;
  onLeave: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section
      className="slab slab-flat relative flex min-h-screen flex-col overflow-hidden"
      data-on-slab
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
        <Icon.meeting className="h-4 w-4 text-slab-ink-muted" />
        <span className="flex-1 truncate text-sm font-medium text-slab-ink">
          {meetTitle}
        </span>
        <span className="text-[11px] text-slab-ink-muted">Guest</span>
      </header>

      {error ? (
        <div className="grid flex-1 place-items-center px-8 py-16 text-center">
          <p className="text-[15px] font-medium text-slab-ink">
            Connection error
          </p>
          <p className="mt-1.5 text-xs text-slab-ink-muted">{error}</p>
        </div>
      ) : (
        <LiveKitRoom
          token={token}
          serverUrl={url}
          connect
          video
          audio
          data-lk-theme="default"
          className="flex min-h-0 flex-1 flex-col"
          onDisconnected={onLeave}
          onError={(e) => setError(e.message)}
        >
          <GuestStage />
          <div className="shrink-0 border-t border-white/10">
            <ControlBar variation="verbose" />
          </div>
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </section>
  );
}

function GuestStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <div className="min-h-0 flex-1 p-2">
      <GridLayout tracks={tracks} className="h-full">
        <ParticipantTile />
      </GridLayout>
    </div>
  );
}

// ── Shell / utilities ─────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="slab slab-flat grid min-h-screen place-items-center px-6 py-12"
      data-on-slab
    >
      {children}
    </section>
  );
}

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-3">
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60"
      />
      <p className="text-[12px] text-slab-ink-muted">Loading…</p>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="w-full max-w-sm space-y-3 text-center">
      <p className="text-[15px] font-medium text-slab-ink">
        Cannot open this link
      </p>
      <p className="text-sm text-slab-ink-muted">{message}</p>
    </div>
  );
}
