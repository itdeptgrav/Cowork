import "server-only";

/**
 * Grav Stream — the service that carries a shared screen. `stream.grav.in`.
 *
 * **Server-side only, and the module is marked so.** The API key can create
 * rooms and mint tokens for the whole account; the service's own docs say it in
 * red. Nothing here may be imported from a client component, and `server-only`
 * turns a mistake into a build error rather than a leaked key.
 *
 * ## The embed is the only way in — MEASURED, not assumed
 *
 * The REST API answers with `{token, url: "wss://stream.grav.in"}`, which looks
 * like the shape a realtime client could connect to directly. It is not: the
 * token carries flat claims and no `video` grant, and `/rtc?access_token=…`
 * upgrades the socket for any token at all — a garbage one included — and then
 * sends nothing. The way in is `https://live.grav.in/embed/{roomId}?token={…}`
 * in an iframe, with `allow="camera; microphone; display-capture; autoplay"`.
 * That attribute is not optional; without it the browser blocks capture and the
 * embed reports `PERMISSION_DENIED`, which points nowhere near the cause.
 *
 * ## Screen mode changed what this product can promise
 *
 * The earlier release had one kind of room: a meeting. It took the camera and
 * microphone before it would let anybody in, opened its own picker, and reported
 * nothing about what was picked. Three rules this product claims had to be
 * written down as no longer enforceable.
 *
 * A `screen` room does not work that way, and all three are back:
 *
 *  · **No camera, no microphone.** Neither is ever requested, for a publisher or
 *    a viewer. There is no meeting to create and no join gate to get past.
 *  · **`requireEntireScreen` is enforced by their SFU.** A window or a browser
 *    tab never starts, and the refusal arrives as `ENTIRE_SCREEN_REQUIRED` so it
 *    can be explained. A modified client cannot get round it: the surface is
 *    re-checked server-side before the producer is created.
 *  · **Sharing is observable.** `screen-share-started` carries the
 *    `displaySurface`, and `GET /rooms/:id` carries `participants[].sharing.screen`
 *    for as long as a screen is actually live — so presence can be anchored to a
 *    fact the SERVICE reports rather than to a browser's word about itself.
 *
 * ## One room per person
 *
 * `maxParticipants` is capped at 30, so one room for a company is not an option.
 * A room per person is also what makes a seat carry its own permission: a token
 * minted for one person's room cannot show anybody else's screen.
 */

const DEFAULT_BASE = "https://stream.grav.in";

/** How long a publisher's seat lasts. The service caps `ttlSeconds` at 86400. */
export const PUBLISH_TTL_SECONDS = 86_400;
/** A watcher's seat. Short: a manager opens a screen, looks, and closes it. */
export const WATCH_TTL_SECONDS = 3_600;

/** The service refused, and this is what it said. */
export class GravStreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GravStreamError";
  }
}

/** Missing configuration is not a runtime failure to be discovered in a stack trace. */
export class GravStreamNotConfigured extends Error {
  constructor() {
    super(
      "Grav Stream is not configured on this server. Set GRAV_STREAM_API_KEY " +
        "to the key from live.grav.in → API keys.",
    );
    this.name = "GravStreamNotConfigured";
  }
}

function config(): { base: string; key: string } {
  const key = process.env.GRAV_STREAM_API_KEY;
  if (!key) throw new GravStreamNotConfigured();
  return {
    base: (process.env.GRAV_STREAM_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ""),
    key,
  };
}

async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { base, key } = config();
  const res = await fetch(base + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    /* Never cached. A room list is a live fact and a token is single-use. */
    cache: "no-store",
  });

  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    /* The service names its own refusals in `error`. Passing that sentence
       through is what lets the room's failure state say something a reader can
       act on instead of a status code. */
    const said =
      typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error?: unknown }).error
        : undefined;
    throw new GravStreamError(
      typeof said === "string" && said
        ? said
        : `Grav Stream request failed (${res.status}).`,
      res.status,
    );
  }
  return payload as T;
}

interface RoomRecord {
  roomId: string;
  name?: string | null;
  live?: boolean;
  createdAt?: number;
  endedAt?: number | null;
  /** `screen` or `meeting`. Fixed when the room is created — see `ensureRoom`. */
  mode?: string | null;
  requireEntireScreen?: boolean;
}

/**
 * This person's monitoring room, creating it the first time.
 *
 * ## `live` is a status, `endedAt` is the lifecycle — MEASURED, and it changed
 *
 * An earlier release emptied a room permanently: the last participant left, the
 * room went `live: false`, and rejoining it was refused with "Room does not
 * exist" while `endedAt` stayed `null`. This code filtered on `live === true`
 * because of it, and said so at length.
 *
 * That is no longer true. Against the service today: a freshly created room is
 * `live: false` with nobody in it, goes `live: true` while somebody is joined,
 * returns to `live: false` when they leave — **and is joined again without
 * complaint**. So `live` means "somebody is in this room right now", which is a
 * status; `endedAt` means "this room is over", which is the lifecycle. Filtering
 * on `live` would now create a new room for every session and, worse, hand the
 * manager a different room from the one their report is sharing into.
 *
 * The condition is `!endedAt`, checked on every call. No cache: a room id
 * outlives nothing here, but a listing is one request and a stale id is a whole
 * class of bug that took a day to find once already.
 *
 * ## The room is created for SCREEN monitoring
 *
 * `mode: "screen"` is what makes the embed open a capture picker and never ask
 * for a camera or a microphone, and `requireEntireScreen` is what makes their
 * SFU refuse a window or a browser tab. Both are properties of the ROOM, fixed
 * when it is created — which is why the rule this product has always claimed is
 * now enforced somewhere a modified client cannot reach.
 */
export async function ensureRoom(name: string): Promise<string> {
  const listed = await api<{ rooms?: RoomRecord[] }>("/api/v1/rooms");
  const open = (listed.rooms ?? [])
    .filter(
      (r) =>
        r.name === name &&
        !r.endedAt &&
        /**
         * **A room's MODE is fixed when it is created, so a room in the wrong
         * mode is not this person's room — it is a different feature.**
         *
         * This cost a session. Rooms created before screen mode existed are
         * `mode: "meeting"`, they never end on their own, and matching on the
         * name alone handed one straight back: the embed loaded, reported
         * `ready` with `mode: "meeting"`, asked for a camera it should never
         * want, and `start-screen-share` did nothing anybody could see. One
         * account had four meeting rooms under the same person's name, each a
         * leftover from an earlier build, and every session picked the newest.
         *
         * `requireEntireScreen` is checked with it because a screen room created
         * without it does not enforce the rule this product states.
         */
        r.mode === "screen" &&
        r.requireEntireScreen === true,
    )
    /* Newest first. A name can have more than one open room if two callers
       raced before either was listed; the later one is where a fresh
       participant will be sent, so prefer it consistently. */
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const found = open[0]?.roomId;
  if (found) return found;

  const created = await api<RoomRecord>("/api/v1/rooms", {
    method: "POST",
    body: {
      name,
      /* Monitoring, not a call. See the note above. */
      mode: "screen",
      requireEntireScreen: true,
      /* One sharer and the people entitled to watch them. The service caps this
         at 30; asking for the cap costs nothing and leaves no room for a "room
         full" that nobody could explain. */
      maxParticipants: 30,
    },
  });
  return created.roomId;
}

export interface StreamSeat {
  token: string;
  url: string;
  roomId: string;
}

/**
 * A seat in one person's presence room.
 *
 * `canPublish` and `canSubscribe` are passed explicitly and are never both
 * true. That is the same split the previous token route settled on, for the
 * same reason: a publisher's seat that could subscribe is an employee who can
 * watch their colleagues, and a watcher's seat that could publish is a manager
 * who can push a track into somebody else's room.
 */
export type SeatRole = "publisher" | "viewer";

export async function mintSeat(input: {
  /** The room NAME, resolved to the service's own id by `ensureRoom`. */
  roomName: string;
  identity: string;
  name: string;
  role: SeatRole;
  ttlSeconds: number;
}): Promise<StreamSeat> {
  const roomName = input.roomName;

  const mint = async (roomId: string) =>
    api<{ token: string; url: string; roomId?: string }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/tokens`,
      {
        method: "POST",
        body: {
          identity: input.identity,
          name: input.name,
          role: input.role,
          ttlSeconds: input.ttlSeconds,
        },
      },
    );

  const roomId = await ensureRoom(roomName);
  try {
    const seat = await mint(roomId);
    return { token: seat.token, url: seat.url, roomId: seat.roomId ?? roomId };
  } catch (error) {
    /* The room was emptied between the listing and this mint — rooms die the
       moment their last participant leaves. Resolve again, which now finds no
       live room and creates one, and try once. */
    if (!(error instanceof GravStreamError) || error.status !== 404) throw error;
    const fresh = await ensureRoom(roomName);
    const seat = await mint(fresh);
    return { token: seat.token, url: seat.url, roomId: seat.roomId ?? fresh };
  }
}

export interface RoomParticipant {
  peerId: string;
  identity: string;
  name?: string;
  role?: SeatRole;
  /**
   * The screen this participant has live, or null.
   *
   * **Present only while a screen is actually being shared** — that is the
   * service's own contract, and it is what makes this the anchor for Online.
   */
  screen: {
    displaySurface: string | null;
    width: number | null;
    height: number | null;
    startedAt: number | null;
  } | null;
}

export interface RoomState {
  live: boolean;
  participantCount: number;
  participants: RoomParticipant[];
}

/**
 * What is actually happening in a room, from the service rather than a browser.
 *
 * **This is what presence is anchored to.** A tab claiming "I am sharing" can be
 * wrong, can be stale, and is exactly the kind of claim a screen-monitoring
 * feature must not take at face value. `sharing.screen` is the service's answer
 * to the same question, and it is the one a manager's dashboard reads too — so
 * "online" means the same thing on both screens.
 */
export async function readRoom(roomId: string): Promise<RoomState> {
  const room = await api<{
    live?: boolean;
    participantCount?: number;
    participants?: {
      peerId?: string;
      identity?: string;
      name?: string;
      role?: string;
      sharing?: {
        screen?: {
          displaySurface?: string;
          width?: number;
          height?: number;
          startedAt?: number;
        } | null;
      } | null;
    }[];
  }>(`/api/v1/rooms/${encodeURIComponent(roomId)}`);

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  return {
    live: room.live === true,
    participantCount:
      typeof room.participantCount === "number" ? room.participantCount : 0,
    participants: (room.participants ?? [])
      .filter((p) => typeof p.identity === "string")
      .map((p) => {
        const screen = p.sharing?.screen;
        return {
          peerId: String(p.peerId ?? ""),
          identity: String(p.identity),
          name: p.name,
          role: p.role === "publisher" || p.role === "viewer" ? p.role : undefined,
          screen: screen
            ? {
                displaySurface:
                  typeof screen.displaySurface === "string"
                    ? screen.displaySurface
                    : null,
                width: num(screen.width),
                height: num(screen.height),
                startedAt: num(screen.startedAt),
              }
            : null,
        };
      }),
  };
}

