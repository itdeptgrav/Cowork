import { ScreenSharePresets, VideoPresets } from "livekit-client";
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
 *
 * ## `adaptiveStream` and `dynacast`, and what leaving them off cost
 *
 * Both were absent, which is not a neutral default — it is the expensive one.
 *
 * Without `adaptiveStream` the client subscribes to every camera at the top
 * simulcast layer regardless of how the video is actually being used: a 120px
 * tile, a tile scrolled out of view, a tile behind a collapsed panel and a tile
 * in a background tab all pulled full-resolution video. LiveKit sizes each
 * subscription to the `<video>` element that renders it and pauses the ones
 * nothing renders, so turning it on is what makes hiding a tile stop costing
 * bandwidth.
 *
 * Without `dynacast` every publisher uploads the whole simulcast ladder for the
 * length of the meeting, including layers no subscriber has asked for. In a
 * two-person call that is two wasted layers each way, permanently.
 *
 * ## Why the ladder and the caps are declared rather than inherited
 *
 * `videoCaptureDefaults` caps the camera at 720p. Left undeclared, a capable
 * webcam negotiates whatever it likes — 1080p or higher — and the top layer is
 * then encoded and sent at that size for a grid nobody views that large.
 *
 * `screenShareEncoding` is the single largest line item in a meeting. LiveKit's
 * own default is 1080p at 30fps; a shared IDE or spreadsheet is a near-static
 * image where the frame rate buys nothing and the resolution buys everything,
 * so this halves the frame rate and keeps the pixels. Legibility is preserved;
 * roughly half the bytes are not sent.
 *
 * `dtx` stops sending audio packets through silence, which is most of most
 * meetings.
 *
 * Every value here is a LiveKit preset rather than a hand-picked number, so the
 * ladder stays consistent with what the SDK expects of it.
 */
export const COWORK_ROOM_OPTIONS: RoomOptions = {
  disconnectOnPageLeave: false,

  /* Size each subscription to the element rendering it; pause the unrendered. */
  adaptiveStream: true,
  /* Stop publishing simulcast layers nobody is subscribed to. */
  dynacast: true,

  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },

  publishDefaults: {
    simulcast: true,
    /* Two cheap layers under the 720p original: 360p for a mid-sized tile,
       180p for a thumbnail. `adaptiveStream` picks between them per subscriber,
       and `dynacast` stops encoding whichever nobody is on. */
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    /* 1080p keeps text readable; 15fps is plenty for a screen that mostly
       does not move. The default was 30. */
    screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
    /* Silence should not cost bandwidth. */
    dtx: true,
  },
};
