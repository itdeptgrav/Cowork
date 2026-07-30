/**
 * Where a room token comes from.
 *
 * The same request the employee test page has always made, moved into one
 * function so that the shell and the test page ask the same endpoint with the
 * same identity — two identities would be two participants, and the manager
 * view would see the same person twice.
 *
 * The secret stays where it was: minting happens server-side in
 * `app/api/livekit/token/route.ts`. Nothing here knows an API key exists.
 */

import {
  MANAGER_IDENTITY,
  ROOM_NAME,
  presenceIdentityFor,
  watcherIdentity,
} from "./identity";
import { connectionId } from "@/lib/status/connectionId";

export { MANAGER_IDENTITY, ROOM_NAME, presenceIdentityFor };

export interface RoomCredentials {
  token: string;
  url: string;
}

/**
 * The employee's publishing seat.
 *
 * Takes WHO is publishing rather than assuming one fixed occupant. The
 * identity comes from `presenceIdentityFor`, the same function the manager's
 * viewer matches tracks with, so a screen published here is findable there.
 */
export function fetchRoomCredentials(
  employeeId: string,
): Promise<RoomCredentials> {
  return fetchCredentialsFor(presenceIdentityFor(employeeId));
}

/**
 * The manager's read-only seat in the same room.
 *
 * **One seat per tab, not one seat per product.** Every watcher used to join
 * as the bare string `"manager"`, and LiveKit treats identity as unique within
 * a room — so the second manager to open a monitoring page evicted the first,
 * whose screen went blank having done nothing. Reusing `connectionId()` keeps
 * the seat stable for the life of the tab, so a re-render or a reconnect
 * rejoins as the same participant instead of accumulating ghosts in the room.
 */
export function fetchViewerCredentials(): Promise<RoomCredentials> {
  return fetchCredentialsFor(watcherIdentity(connectionId()));
}

async function fetchCredentialsFor(identity: string): Promise<RoomCredentials> {
  /* No `room` parameter. The route pins the room itself — sending one implied
     the caller could choose, which was the behaviour that got closed. */
  const res = await fetch(
    `/api/livekit/token?identity=${encodeURIComponent(identity)}`,
  );

  const data: unknown = await res.json().catch(() => null);

  /* The route names its own refusals — not signed in, not configured, unknown
     identity. Surfacing that sentence rather than a status code is what lets
     the viewer's error state say something a reader can act on; `MonitorRoom`
     renders this message verbatim. */
  if (!res.ok) {
    const reason =
      typeof data === "object" && data !== null && "error" in data
        ? (data as { error?: unknown }).error
        : undefined;
    throw new Error(
      typeof reason === "string" && reason
        ? reason
        : `The monitoring room refused the connection (${res.status}).`,
    );
  }

  const token =
    typeof data === "object" && data !== null && "token" in data
      ? (data as { token?: unknown }).token
      : undefined;
  const url =
    typeof data === "object" && data !== null && "url" in data
      ? (data as { url?: unknown }).url
      : undefined;

  if (typeof token !== "string" || !token) throw new Error("No token returned");
  if (typeof url !== "string" || !url)
    throw new Error("No server URL configured");

  return { token, url };
}
