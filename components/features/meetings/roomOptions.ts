import type { RoomOptions } from "livekit-client";

/**
 * The options every Cowork room connects with.
 *
 * ## `disconnectOnPageLeave: false`, and why it has to be
 *
 * LiveKit's default is `true`, and it registers this:
 *
 * ```js
 * window.addEventListener('pagehide', this.onPageLeave);
 * window.addEventListener('beforeunload', this.onPageLeave);
 * ```
 *
 * `beforeunload` fires when a reload is **proposed**, not when it happens — so
 * the room was already torn down by the time the browser's "Reload site?"
 * dialog appeared. Pressing **Cancel** then left the reader on a live page with
 * a dead connection, which surfaced as "You have left this meeting" over a
 * meeting they had just chosen not to leave.
 *
 * Nobody saw it before there was a dialog: without one the page simply
 * reloaded, and a room disconnecting a few milliseconds early on the way out is
 * invisible. Asking the question is what made the early teardown matter.
 *
 * ## What we give up, and why it is nothing
 *
 * A genuine unload no longer disconnects politely — the connection dies with
 * the page and the server notices on its own timeout, a few seconds later. That
 * costs a participant tile lingering briefly for everybody else, and nothing
 * else: rejoining from a reloaded page uses the same identity, and LiveKit
 * drops the older session when a duplicate identity connects.
 *
 * The recording is unaffected either way. Its own `pagehide` handler flushes
 * and finalizes, and that is a separate listener from this one.
 */
export const COWORK_ROOM_OPTIONS: RoomOptions = {
  disconnectOnPageLeave: false,
};
