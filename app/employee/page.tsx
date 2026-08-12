"use client";

import { useEffect, useState } from "react";
import { WorkspaceHead } from "@/components/ui/Workspace";
import { Panel, PanelHead, Button } from "@/components/ui/Primitives";
import { useEmployeeStatus } from "@/components/features/status/useEmployeeStatus";
import {
  STATUS_META,
  endSession,
  startScreenShare,
} from "@/lib/status/employeeStatus";
import { fetchShareSeat } from "@/lib/integrations/grav/credentials";
import {
  publisherVersion,
  shareStats,
  type ShareStats,
} from "@/lib/integrations/grav/publisher";
import {
  presenceIdentityFor,
  presenceRoomName,
} from "@/lib/integrations/livekit/identity";
import { useViewerId } from "@/lib/hooks/usePermissions";

/**
 * The screen-share test surface.
 *
 * It no longer owns anything. It used to mount its own `<LiveKitRoom>` and hold
 * its own token, which meant two rooms could exist at once under the same
 * identity — the shell's and this page's — and the manager would see whichever
 * won. Presence now lives in the shell, and this page is what it always should
 * have been: a window onto that one session, useful for checking that the room,
 * the track and the publish are behaving, from the same controls the top bar
 * uses.
 *
 * This page starts and stops the SHARE — which, since Online is a live share
 * again, is the same act as going online and offline. It is the same store, the
 * same room and the same publish the top-bar pill uses; only the framing is
 * diagnostic.
 */
export default function EmployeePage() {
  const { status, share, session, token, url, notice } = useEmployeeStatus();
  const viewerId = useViewerId();
  const meta = STATUS_META[status];
  /* The identity this browser actually publishes under — derived, not fixed.
     Printing it is the point of a diagnostics page: it is the value a manager's
     viewer has to match, so a mismatch is visible here rather than only as an
     empty frame on somebody else's screen. */
  const identity = viewerId ? presenceIdentityFor(viewerId) : "—";

  const connecting = session === "requesting" || session === "connecting";

  return (
    <>
      <WorkspaceHead
        title="Screen share"
        count="LiveKit diagnostics"
        action={
          !share.sharing ? (
            <Button
              tone="primary"
              disabled={connecting || !viewerId}
              onClick={() =>
                viewerId &&
                void startScreenShare(() => fetchShareSeat(viewerId))
              }
            >
              {connecting ? "Waiting for your screen…" : "Start sharing"}
            </Button>
          ) : (
            /* Ends the ROOM, not the person's presence — stopping a share no
               longer takes anybody offline. */
            <Button tone="secondary" onClick={() => endSession()}>
              Stop sharing
            </Button>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel label="Current state">
          <PanelHead
            title="Current state"
            sub="What the room is actually reporting"
            aside={
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: meta.dot }}
                />
                {meta.label}
              </span>
            }
          />
          <dl className="divide-y divide-[var(--hairline)] text-sm">
            <Fact label="Status" value={meta.label} />
            <Fact label="Session" value={session} />
            <Fact
              label="Room"
              value={share.connected ? "Connected" : "Not connected"}
            />
            <Fact
              label="Screen track"
              value={share.sharing ? "Live" : "None"}
            />
          </dl>
          <p
            role={notice ? "alert" : undefined}
            className={`mt-3 text-xs ${
              notice ? "text-[var(--state-overdue-ink)]" : "text-ink-faint"
            }`}
          >
            {notice ?? share.detail}
          </p>
        </Panel>

        <Panel label="Connection">
          <PanelHead title="Connection" sub="Where this session is pointed" />
          <dl className="divide-y divide-[var(--hairline)] text-sm">
            <Fact label="Identity" value={identity} />
            <Fact
              label="Room name"
              value={viewerId ? presenceRoomName(viewerId) : "—"}
            />
            <Fact label="Server" value={url ?? "—"} />
            {/* The token is a credential. Its presence is the useful fact; its
                value is never printed. */}
            <Fact label="Token" value={token ? "Held" : "None"} />
          </dl>
          <p className="mt-3 text-xs text-ink-faint">
            Presence is mounted by the app shell, so the status pill works on
            every page. This screen only reads it.
          </p>
        </Panel>

        <EncoderPanel sharing={share.sharing} />
      </div>
    </>
  );
}

/**
 * What the encoder is actually doing — the answer to "it feels slow".
 *
 * **Grav Stream asks for these numbers by name, and asking somebody to open a
 * console for them is how a support thread stalls for a day.** Two of the
 * fields decide almost everything: `codec` — H264 means the work is on
 * dedicated hardware, VP8 means a CPU core is encoding an entire desktop in
 * software and nothing else will fix that — and `limitedBy`, which says
 * whether the machine or the network is the constraint rather than leaving it
 * to argument.
 *
 * `Watchers` and `Paused` are the 1.1.0 change worth seeing: a share with
 * nobody watching now stops encoding entirely, where before every sharer
 * encoded and uploaded all day into an empty room.
 *
 * The console handle is still there for them — `await gs.getStats()` — and this
 * reads the same call.
 */
function EncoderPanel({ sharing }: { sharing: boolean }) {
  const [stats, setStats] = useState<ShareStats | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!sharing) return;
    let cancelled = false;
    const read = async () => {
      const next = await shareStats();
      if (!cancelled) {
        setStats(next);
        setChecked(true);
      }
    };
    void read();
    /* Two seconds: fast enough to watch `paused` flip when the last viewer
       leaves, slow enough that reading the numbers is not itself work. */
    const id = setInterval(() => void read(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sharing]);

  return (
    <Panel label="Encoder">
      <PanelHead
        title="Encoder"
        sub="What is actually being sent, from the SDK's own stats"
        aside={
          <span className="text-xs text-ink-faint">
            SDK {publisherVersion() ?? "—"}
          </span>
        }
      />
      {!sharing ? (
        <p className="py-2 text-xs text-ink-faint">
          Nothing is being shared, so there is nothing to measure. Start a share
          and these fill in.
        </p>
      ) : !stats ? (
        <p className="py-2 text-xs text-ink-faint">
          {checked
            ? "This build of the sharing library does not report stats — hard-refresh to pick up 1.1.0."
            : "Reading…"}
        </p>
      ) : (
        <>
          <dl className="divide-y divide-[var(--hairline)] text-sm">
            <Fact
              label="Codec"
              value={`${stats.codec ?? "—"}${
                stats.hardware === true
                  ? " · hardware"
                  : stats.hardware === false
                    ? " · software"
                    : ""
              }`}
            />
            <Fact label="Encoder" value={stats.encoder ?? "—"} />
            <Fact label="Resolution" value={stats.resolution ?? "—"} />
            <Fact
              label="Frame rate"
              value={stats.fps === null ? "—" : `${stats.fps} fps`}
            />
            <Fact
              label="Bitrate"
              value={stats.kbps === null ? "—" : `${stats.kbps} kbps`}
            />
            <Fact label="Limited by" value={stats.limitedBy ?? "—"} />
            <Fact
              label="Watchers"
              value={
                stats.watchers === null
                  ? "—"
                  : `${stats.watchers}${stats.paused ? " · encoding paused" : ""}`
              }
            />
            <Fact
              label="Frames"
              value={
                stats.framesSent === null
                  ? "—"
                  : `${stats.framesSent} sent · ${stats.framesDropped ?? 0} dropped`
              }
            />
          </dl>
          {stats.codec === "VP8" && (
            <p className="mt-3 text-xs leading-relaxed text-[var(--state-overdue-ink)]">
              VP8 is encoded in software and will keep a CPU core busy for as
              long as this share runs. The codec is chosen when a share starts,
              so stop sharing and start again to move onto H.264.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 truncate text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
