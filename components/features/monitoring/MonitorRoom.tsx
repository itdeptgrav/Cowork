"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { fetchViewerCredentials } from "@/lib/integrations/livekit/credentials";

/**
 * The manager's seat in the existing room.
 *
 * It reuses the LiveKit setup the product already has — the same token route,
 * the same room, the same `<LiveKitRoom>` — and adds exactly one thing: it
 * joins to *watch*. `video` and `audio` are false, so a manager never publishes
 * anything, and the token is minted under the separate `manager` identity so
 * the room's participant list stays truthful.
 *
 * It connects on mount rather than behind a Connect button. The page's whole
 * purpose is the live screen; making someone press a button to begin doing what
 * they came to do is a step that exists only because the test page had one.
 *
 * Failure is a state, not a silence. A room that will not connect renders its
 * own reason through `children`, which is why the credential error is held here
 * rather than thrown.
 */
export function MonitorRoom({
  children,
}: {
  children: (state: {
    /** True only while mounted inside a live `<LiveKitRoom>`. */
    inRoom: boolean;
    connecting: boolean;
    error: string | null;
  }) => ReactNode;
}) {
  const [creds, setCreds] = useState<{ token: string; url: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchViewerCredentials()
      .then((c) => {
        if (!cancelled) setCreds(c);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof Error
            ? e.message
            : "The monitoring room could not be reached.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!creds) {
    return (
      <>{children({ inRoom: false, connecting: error === null, error })}</>
    );
  }

  return (
    <LiveKitRoom
      token={creds.token}
      serverUrl={creds.url}
      connect
      video={false}
      audio={false}
      onError={(e) => setError(e.message)}
    >
      {children({ inRoom: true, connecting: false, error })}
    </LiveKitRoom>
  );
}
