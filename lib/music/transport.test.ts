import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IDLE_TRANSPORT,
  advance,
  canDeclareBlocked,
  type TransportEvent,
  type TransportState,
} from "./transport.ts";

/**
 * The two bugs this file exists to keep fixed.
 *
 *   1. Pressing play did nothing and had to be pressed twice.
 *   2. The next track never started on its own — every advance needed a human.
 *
 * Both were the same race: a track change and a play request are committed
 * together, the player is told to cue first, and the play arrives while the
 * iframe is still swapping. YouTube drops it and says nothing.
 *
 * `run` replays a real sequence of events and reports every moment the play
 * request had to be issued again, which is the behaviour that was missing.
 */
function run(
  events: TransportEvent[],
  from: TransportState = IDLE_TRANSPORT,
): { state: TransportState; reissuedAt: number[] } {
  let state = from;
  const reissuedAt: number[] = [];
  events.forEach((e, i) => {
    const step = advance(state, e);
    state = step.state;
    if (step.reissue) reissuedAt.push(i);
  });
  return { state, reissuedAt };
}

/* ── The press-twice bug ──────────────────────────────────────────────────── */

test("a play request made mid-switch is re-issued when the video is cued", () => {
  /* Exactly what one click on a result row commits: the track changes, then
     the intent asks for playback, and only later does the player finish. */
  const { state, reissuedAt } = run([
    "track_changed",
    "play_requested",
    "video_cued",
  ]);
  assert.deepEqual(reissuedAt, [2], "the cue must hand the request back");
  assert.equal(state.awaitingCue, false);
  assert.equal(state.wantsPlay, true, "still outstanding until it plays");
});

test("a play request made before the player exists is re-issued on ready", () => {
  /* The very first click of a session: the host element does not exist yet. */
  const { reissuedAt } = run(["play_requested", "player_ready"]);
  assert.deepEqual(reissuedAt, [1]);
});

test("the request is spent once playback actually starts", () => {
  const { state, reissuedAt } = run([
    "track_changed",
    "play_requested",
    "video_cued",
    "playing",
  ]);
  assert.deepEqual(reissuedAt, [2]);
  assert.deepEqual(state, { wantsPlay: false, awaitingCue: false });
});

test("a later cue does not resurrect a request that already played", () => {
  /* Otherwise queueing a track onto a finished queue would start playing on
     its own, which nobody asked for. */
  const { reissuedAt } = run([
    "play_requested",
    "player_ready",
    "playing",
    "track_changed",
    "video_cued",
  ]);
  assert.deepEqual(reissuedAt, [1], "only the original request is honoured");
});

/* ── The autoplay bug ─────────────────────────────────────────────────────── */

test("the advance at the end of a track starts the next one by itself", () => {
  /* `onEnded` runs `next()`, which changes the track and asks for playback in
     one commit — the same shape as a click, and the reason autoplay silently
     did nothing before. */
  const { reissuedAt, state } = run([
    "play_requested",
    "player_ready",
    "playing",
    "ended",
    "track_changed",
    "play_requested",
    "video_cued",
  ]);
  assert.deepEqual(reissuedAt, [1, 6]);
  assert.equal(state.wantsPlay, true, "held until the next track plays");
});

test("several tracks in a row each start without a human", () => {
  const events: TransportEvent[] = ["play_requested", "player_ready"];
  for (let i = 0; i < 3; i++) {
    events.push("playing", "ended", "track_changed", "play_requested", "video_cued");
  }
  const { reissuedAt } = run(events);
  assert.equal(reissuedAt.length, 4, "one on ready, then one per advance");
});

/* ── Requests do not outlive their reason ─────────────────────────────────── */

test("pausing drops an outstanding request rather than fighting the reader", () => {
  const { reissuedAt } = run([
    "track_changed",
    "play_requested",
    "pause_requested",
    "video_cued",
  ]);
  assert.deepEqual(reissuedAt, [], "a cue must not undo a pause");
});

test("a track the player refused is not retried", () => {
  const { state, reissuedAt } = run([
    "track_changed",
    "play_requested",
    "failed",
    "video_cued",
  ]);
  assert.deepEqual(reissuedAt, []);
  assert.deepEqual(state, { wantsPlay: false, awaitingCue: false });
});

test("the reader pausing in YouTube's own controls clears the request", () => {
  const { reissuedAt } = run([
    "play_requested",
    "player_ready",
    "playing",
    "paused",
    "video_cued",
  ]);
  assert.deepEqual(reissuedAt, [1]);
});

test("once blocked is announced the request stops being outstanding", () => {
  /* The reader has been told to press play inside the player. Re-issuing
     behind them would make the message a lie. */
  const { state } = run([
    "play_requested",
    "player_ready",
    "declared_blocked",
  ]);
  assert.equal(state.wantsPlay, false);
});

/* ── The watchdog ─────────────────────────────────────────────────────────── */

test("a switch in flight is never called a blocked browser", () => {
  const { state } = run(["track_changed", "play_requested"]);
  assert.equal(
    canDeclareBlocked(state),
    false,
    "mid-switch there is nothing to blame",
  );
});

test("once cued, a silent player may be called blocked", () => {
  const { state } = run(["track_changed", "play_requested", "video_cued"]);
  assert.equal(canDeclareBlocked(state), true);
});

test("playing clears the switch even when no cue event ever arrived", () => {
  /* If the player honours a play issued mid-switch it goes straight to
     playing, and no cued event is emitted. `awaitingCue` must not stick on,
     or the watchdog would be disarmed for the rest of the session. */
  const { state } = run(["track_changed", "play_requested", "playing"]);
  assert.equal(state.awaitingCue, false);
  assert.equal(canDeclareBlocked(state), true);
});

test("idle is idle", () => {
  assert.deepEqual(IDLE_TRANSPORT, { wantsPlay: false, awaitingCue: false });
  assert.deepEqual(advance(IDLE_TRANSPORT, "video_cued").state, IDLE_TRANSPORT);
  assert.equal(advance(IDLE_TRANSPORT, "video_cued").reissue, false);
});
