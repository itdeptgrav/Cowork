import { connectionId } from "@/lib/status/connectionId";

/**
 * Where a room seat comes from, for the browser.
 *
 * Points at `/api/stream/token`, which mints against Grav Stream and — unlike
 * the route it replaced — decides whether this caller may have the seat at all.
 * Nothing here knows an API key exists, and nothing here decides anything: a
 * browser that asks for somebody else's screen is refused by the server, in the
 * server's own words.
 */

export interface RoomSeat {
  /** Grav Stream's own id for the room. */
  roomId: string;
  token: string;
  /**
   * The realtime server the media connects to — `serverUrl` for the publisher
   * SDK. Explicitly NOT a page to load; their documentation says so twice,
   * because it is the field most likely to be mistaken for the embed.
   */
  url: string;
  /** The page a WATCHER loads in an iframe. Built server-side. */
  embedUrl: string;
}

/**
 * The employee's own publishing seat.
 *
 * Takes WHO is publishing rather than assuming one occupant. The identity the
 * route mints is `presenceIdentityFor(employeeId)` — the same string
 * `/api/stream/presence` looks for in the room's participant list, so "is this
 * person live" is asked and answered about one name.
 */
export function fetchShareSeat(employeeId: string): Promise<RoomSeat> {
  return ask({ subject: employeeId, role: "publish" });
}

/**
 * A manager's read-only seat in one person's room.
 *
 * **One seat per tab, not one per product.** Identity is unique within a room,
 * so two managers joining under the same string would evict each other — the
 * second one to open a screen would blank the first. `connectionId()` is stable
 * for the life of the tab, so a re-render rejoins as the same participant
 * instead of accumulating ghosts.
 */
export function fetchWatchSeat(subjectEmployeeId: string): Promise<RoomSeat> {
  return ask({
    subject: subjectEmployeeId,
    role: "watch",
    seat: connectionId(),
  });
}

/**
 * Whether the person is live in their own room, as the SERVICE reports it.
 *
 * Not the browser's opinion of itself — see `/api/stream/presence` for why that
 * distinction is the whole design.
 */
export async function fetchRoomPresence(input: {
  subject: string;
  role: "publish" | "watch";
}): Promise<{
  /** In the room at all — connected, not necessarily sharing. */
  present: boolean;
  /** A screen is going out RIGHT NOW. This is what Online is decided on. */
  sharing: boolean;
  /** "monitor", "window" or "browser" — or null where it is not known. */
  surface: string | null;
  participantCount: number;
}> {
  const data = await request(
    `/api/stream/presence?subject=${encodeURIComponent(
      input.subject,
    )}&role=${input.role}`,
  );
  const read = (key: string): unknown =>
    typeof data === "object" && data !== null && key in data
      ? (data as Record<string, unknown>)[key]
      : undefined;
  return {
    present: read("present") === true,
    sharing: read("sharing") === true,
    surface: typeof read("surface") === "string" ? (read("surface") as string) : null,
    participantCount:
      typeof read("participantCount") === "number"
        ? (read("participantCount") as number)
        : 0,
  };
}

async function ask(params: {
  subject: string;
  role: "publish" | "watch";
  seat?: string;
}): Promise<RoomSeat> {
  const query = new URLSearchParams({
    subject: params.subject,
    role: params.role,
  });
  if (params.seat) query.set("seat", params.seat);

  const data = await request(`/api/stream/token?${query.toString()}`);
  const read = (key: string): unknown =>
    typeof data === "object" && data !== null && key in data
      ? (data as Record<string, unknown>)[key]
      : undefined;

  const roomId = read("roomId");
  const token = read("token");
  const url = read("url");
  const embedUrl = read("embedUrl");
  if (typeof token !== "string" || !token) throw new Error("No token returned");
  if (typeof embedUrl !== "string" || !embedUrl)
    throw new Error("No room page was returned");

  return {
    roomId: typeof roomId === "string" ? roomId : "",
    token,
    url: typeof url === "string" ? url : "",
    embedUrl,
  };
}

async function request(path: string): Promise<unknown> {
  const res = await fetch(path);
  const data: unknown = await res.json().catch(() => null);

  /* The route names its own refusals — not their manager, no reporting line,
     not configured. Surfacing that sentence rather than a status code is what
     lets the viewer's error state say something a reader can act on; the
     monitoring panel renders this message verbatim. */
  if (!res.ok) {
    const reason =
      typeof data === "object" && data !== null && "error" in data
        ? (data as { error?: unknown }).error
        : undefined;
    throw new Error(
      typeof reason === "string" && reason
        ? reason
        : `The screen-sharing room refused the connection (${res.status}).`,
    );
  }
  return data;
}
