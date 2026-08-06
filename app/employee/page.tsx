"use client";

import { WorkspaceHead } from "@/components/ui/Workspace";
import { Panel, PanelHead, Button } from "@/components/ui/Primitives";
import { useEmployeeStatus } from "@/components/features/status/useEmployeeStatus";
import {
  STATUS_META,
  endSession,
  startScreenShare,
} from "@/lib/status/employeeStatus";
import {
  ROOM_NAME,
  fetchRoomCredentials,
  presenceIdentityFor,
} from "@/lib/integrations/livekit/credentials";
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
 * Nothing here is required to go online — and since Online became a choice
 * rather than a consequence of sharing, nothing here changes your status at
 * all. This page starts and stops the SHARE, which is what a diagnostics page
 * for screen sharing should do; the pill in the top bar owns presence.
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
                void startScreenShare(() => fetchRoomCredentials(viewerId))
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
            <Fact label="Room name" value={ROOM_NAME} />
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
      </div>
    </>
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
