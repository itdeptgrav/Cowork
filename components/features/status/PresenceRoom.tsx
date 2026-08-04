"use client";

import { LiveKitRoom } from "@livekit/components-react";
import { ScreenShareBridge } from "./ScreenShareBridge";
import { ScreenSharePublisher } from "./ScreenSharePublisher";
import { useEmployeeStatus } from "./useEmployeeStatus";
import { endSession } from "@/lib/status/employeeStatus";
import { isNativeShell } from "@/lib/integrations/livekit/nativeBridge";

/**
 * Cowork's LiveKit room, mounted once by the shell.
 *
 * Two decisions worth stating, because both were the alternative to something
 * that looks simpler and is worse:
 *
 *  1. It is a SIBLING of the shell, not a wrapper around it. Wrapping the
 *     application would mean the entire tree — every page, and the music
 *     player's iframe — unmounts and remounts the moment a token arrives.
 *     Nothing inside this room renders any of the application; the room's
 *     children are two headless bridges, and everything else reaches it
 *     through the presence store.
 *
 *  2. It mounts only once there are credentials, which only happens after
 *     someone has agreed to share a screen. Cowork does not hold an open
 *     realtime connection for a person who is not sharing one.
 *
 * Existing pieces are reused as they stand: the token comes from the same
 * `/api/livekit/token` route, the connection is the same `<LiveKitRoom>`, and
 * the publish is the same call — now in `lib/livekit/screenShare.ts` so that
 * one implementation serves every caller.
 */
export function PresenceRoom() {
  const { token, url } = useEmployeeStatus();

  /* In the native shell, the Swift `Room` already holds this identity's only
     connection — publishing the ReplayKit capture and reporting share state
     over the bridge. A second connection here, as the same participant,
     would be rejected by LiveKit as a duplicate identity. */
  if (isNativeShell()) return null;

  if (!token || !url) return null;

  return (
    <LiveKitRoom
      token={token}
      serverUrl={url}
      connect
      video={false}
      audio={false}
      onDisconnected={() => {
        /* The room going away tears down the media — a dropped network, a token
           expiry, the tab closing, OR a break/emergency clearing the credentials
           to stop the recording. It must NOT clear a manual state: a break or an
           emergency is a claim about the person, not the connection, so
           `endSession` keeps it. An online person, with no manual state, falls to
           offline here, which is the same result `goOffline` gave. */
        endSession();
      }}
    >
      <ScreenShareBridge />
      <ScreenSharePublisher />
    </LiveKitRoom>
  );
}
