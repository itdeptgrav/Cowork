/**
 * The Grav Stream page a MANAGER loads to watch somebody's screen.
 *
 * **The sharer had a frame here too, and no longer does.** It existed for one
 * reason: a capture prompt can only be opened by the document that calls
 * `getDisplayMedia`, so the button had to be inside their iframe and the iframe
 * had to be visible. Their publisher SDK runs in OUR document, so the sharer has
 * no frame at all — see `lib/integrations/grav/publisher.ts`. What that removed
 * from this file is listed at the bottom, because none of it should come back.
 *
 * What is left is one URL. A watcher's frame renders their page and nothing on
 * this side talks to it: the seat it carries is read-only (`canPublish: false`,
 * minted server-side for that one person's room), so there is no command worth
 * sending and no claim worth reading back.
 */

export const EMBED_ORIGIN = "https://live.grav.in";

/** The surface the browser says was captured. `null` where it will not say. */
export type EmbedSurface = "monitor" | "window" | "browser" | null;

/**
 * What the embed tells the page hosting it.
 *
 * A watcher's frame is not silent, and for a while nothing on this side was
 * listening — so a manager whose view failed got a black rectangle and no
 * sentence anywhere, while the frame was posting the reason out loud. Only the
 * events a WATCHER can see are listed; the publisher's half went with the
 * publisher's frame.
 */
export interface EmbedEvent {
  type:
    | "ready"
    | "joined"
    | "remote-screen-started"
    | "remote-screen-stopped"
    | "screen-share-stopped"
    | "participant-joined"
    | "participant-left"
    | "left"
    | "error";
  roomId?: string;
  role?: "publisher" | "viewer";
  mode?: "screen" | "meeting";
  identity?: string;
  peerId?: string;
  displaySurface?: EmbedSurface;
  width?: number;
  height?: number;
  message?: string;
  code?: string;
}

/**
 * Is this a message from the embed, and which one?
 *
 * Any frame on the page can post to this window, so the ORIGIN is checked as
 * well as the marker their documentation describes — a check on the marker
 * alone would trust anything that knew the string.
 */
export function readEmbedEvent(event: MessageEvent): EmbedEvent | null {
  if (event.origin !== EMBED_ORIGIN) return null;
  const data: unknown = event.data;
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { source?: unknown }).source !== "grav-stream" ||
    typeof (data as { type?: unknown }).type !== "string"
  )
    return null;
  return data as EmbedEvent;
}

/**
 * The embed page for a room.
 *
 * **`parentOrigin` is deliberately NOT sent, and this is the reason.** Their
 * embed posts every event with `postMessage(payload, parentOrigin)`, defaulting
 * to `*`. Naming an origin narrows who receives them — and if the value does not
 * match the parent's origin EXACTLY, the browser drops every message with no
 * error anywhere. That is not a degraded integration; it is total silence: no
 * `ready`, no `joined`, no share events, a status stuck on "Preparing…" for ever
 * and nothing in the console to explain it. It shipped that way once.
 *
 * The value is easy to get wrong for reasons nobody would look for — a server
 * computing it from `request.url` behind a proxy, `localhost` against
 * `127.0.0.1`, a LAN address in development, a port that only one side knows —
 * and the failure is invisible in every one of those cases.
 *
 * Nothing is lost by omitting it. What scopes a watcher is the TOKEN, which this
 * application will not mint for anybody but the subject's primary manager.
 */
export function embedUrlFor(input: { roomId: string; token: string }): string {
  const url = new URL(`${EMBED_ORIGIN}/embed/${encodeURIComponent(input.roomId)}`);
  url.searchParams.set("token", input.token);
  /**
   * **No `ui`, `controls` or `startLabel` — and no publisher branch at all.**
   *
   * There was one: a minimal panel with a relabelled Share button, because the
   * sharer had to press the embed's OWN button for the picker to open. Nobody
   * loads this URL to share any more, so the flags would only describe a frame
   * that is never mounted. A manager wants the screen, edge to edge, which is
   * what the default gives.
   */
  return url.toString();
}

/* ── Why there is nothing below this line ──────────────────────────────────── */

/**
 * **The sharer's half of this file was deleted, and it should not come back.**
 *
 * It held a registry of the sharer's frame, a `frameAnswered` flag,
 * `startScreenShareNow`, a watchdog for a picker that was asked for and never
 * opened, `EMBED_NOT_VISIBLE`, and the parent→embed command channel
 * (`postToEmbed`, `readEmbedEvent` and their event types). Every one of them
 * existed to work around a single sentence in their documentation: *"user
 * activation does not cross a postMessage boundary… the user must press the
 * embed's own button."* The consequences were a panel on screen during sharing,
 * a second button to press, and a class of silent failure — a command posted
 * into a frame that had not finished loading, a hidden frame that got no picker
 * — detectable only with a timer.
 *
 * The publisher SDK removed the boundary, and with it every consumer of that
 * channel. Re-adding a message bridge here means somebody has mounted a frame
 * for the sharer again.
 */
