import { type SharedSurface } from "../integrations/livekit/capture.ts";
import { stopPublishing } from "../integrations/grav/publisher.ts";
import {
  isNativeShell,
  /* `.ts`, like `capture.ts` above. Without it `node --test` cannot resolve the
     module, so every test that reaches this file failed to load at all — which
     is why `employeeStatus.test.ts` was among the suite's standing failures. */
} from "../integrations/livekit/nativeBridge.ts";

/**
 * Employee presence, for the whole of Cowork.
 *
 * The rule this module exists to enforce: **Online is not a choice.** It is a
 * consequence of a live, whole-screen share track. The manual states can
 * suppress Online, and the button can *start* the sharing that produces it, but
 * nothing can assert it — and a share of a single window or a browser tab does
 * not produce it, because a curated view is not the thing being promised.
 *
 * The track is carried into a room belonging to that one employee, where their
 * primary manager and nobody else may join to watch — `/api/stream/token`. The
 * capture itself stays here, because the surface rule is only enforceable where
 * `getDisplayMedia` is called.
 *
 * Why a store rather than a React context: the facts come from LiveKit hooks
 * that only work inside `<LiveKitRoom>`, while the pill that displays them
 * lives in the top bar. Rather than wrap the entire application — and remount
 * every page, including the music player's iframe, the moment a token arrives —
 * the room is mounted as a sibling of the shell and the two sides meet here. A
 * store can be written from one part of the tree and read from another, and it
 * is also the seam a backend sync will attach to later: subscribe and POST,
 * without any component knowing about it.
 *
 * The session lives here too, because "go online" is one intention that spans
 * three systems — the browser's capture prompt, the token endpoint and the
 * room — and splitting it across components is how it comes apart.
 *
 * No timers drive status. The only clock is the break stopwatch.
 */

export type EmployeeStatus = "online" | "break" | "emergency" | "offline";

/** What the person asked for. Never includes "online" — see the module note. */
export type ManualStatus = "break" | "emergency" | null;

/**
 * Where the connect-and-share attempt has got to.
 *
 * `requesting` is the browser's own picker being open; `connecting` covers the
 * token fetch, the room join and the publish. `live` means the room is up — it
 * does NOT mean online, which only the track can decide.
 */
export type SessionPhase =
  "idle" | "requesting" | "connecting" | "live" | "error";

/**
 * What the room actually reports. Written by the status button after the
 * publisher SDK starts a capture, and confirmed against the service.
 *
 * `sharing` means **a screen is going out right now, as the SERVICE reports it**
 * — `participants[].sharing.screen` on the room, read through
 * `/api/stream/presence`. Not "connected", and not the browser's word about
 * itself: a tab can be wrong or stale, and this is the fact a manager reads.
 *
 * For a period it could only mean "present in the room", because the only room
 * type was a meeting and nothing reported the share. A `screen` room reports it,
 * so the gap that had to be documented is closed.
 */
export interface ShareFacts {
  /** A screen is live, per the service. This is what Online is. */
  sharing: boolean;
  /** In the room. False also covers "never joined". */
  connected: boolean;
  /**
   * What is being shared — the surface the browser reported, through their
   * `screen-share-started` event and the room's own record of it.
   */
  surface: SharedSurface | null;
  /** Why sharing is false, in the reader's language. */
  detail: string;
}

export interface EmployeeStatusState {
  status: EmployeeStatus;
  manual: ManualStatus;
  share: ShareFacts;
  session: SessionPhase;
  /** Credentials for the room. Present only while a session is being held. */
  token: string | null;
  /**
   * The REALTIME SERVER the media connects to — `wss://stream.grav.in`, their
   * `url` field, what the publisher SDK is given as `serverUrl`.
   *
   * **It held the embed page for a while, and that is a bug worth naming**
   * because the two are one field apart and their documentation warns about it
   * twice. Every visible step still worked: the picker opened, the screen was
   * granted, the browser put its "sharing your screen" bar up — and then the
   * SDK could not reach a realtime server at an HTML page's address, the
   * session ended, and the share stopped about a second after it started. The
   * sharer no longer loads the embed at all (see `publisher.ts`), so this field
   * means one thing.
   */
  url: string | null;
  /** Epoch ms the current break began, or null. */
  breakStartedAt: number | null;
  /**
   * When Emergency Mode was declared, on the real clock.
   *
   * The same shape `breakStartedAt` already uses, and the same shape legacy
   * used (`emergencyStartedAtMs`). It is what makes the duration measurable
   * when the mode is switched off — that duration is the whole subject of the
   * approval request, so it cannot be reconstructed afterwards.
   */
  emergencyStartedAt: number | null;
  /** Shown under the pill; never moves the status by itself. */
  notice: string | null;
  /**
   * Presence restored from the durable document across a page load, with the
   * live share not yet re-established.
   *
   * Keeps someone online through a refresh instead of dropping them to offline
   * the moment the in-memory store re-initialises. Cleared as soon as a real
   * share goes live or the person changes their own status. See `derive`.
   */
  reconnecting: boolean;
  /**
   * The ACCOUNT holds the online claim, on a connection that is not this one.
   *
   * Presence is a fact about a person, and a person is not four different people
   * because they have four devices open. A laptop sharing its screen puts the
   * account online; the phone in their pocket showed Offline for the same
   * account, which is simply wrong — and it is what the second device reported
   * to the person looking at it.
   *
   * This does NOT weaken the rule that online is a live share. Somewhere, a
   * screen IS being shared, and a manager who opens it finds it. What changes is
   * only which device may SAY so. `sharedElsewhere` below is what keeps the
   * sentence honest on the device that is not the one sharing.
   */
  remoteOnline: boolean;
  /**
   * The account's own presence has been read at least once.
   *
   * The store initialises to `offline`, which is a GUESS until the duty document
   * has been heard from — and a second device announced that guess out loud, so
   * somebody on a break saw "Offline" and then "Break" a moment later. Nothing
   * was wrong except that the pill spoke before it knew. Surfaces that would
   * otherwise assert Offline wait on this instead.
   */
  hydrated: boolean;
}

const IDLE_SHARE: ShareFacts = {
  sharing: false,
  connected: false,
  surface: null,
  detail: "Not sharing. Your screen is not being watched.",
};

/**
 * The media layer torn down: no room, no credentials, no share.
 *
 * The three unavailable states all reach it — **break, emergency and offline
 * every one STOP THE SCREEN RECORDING**, because an unavailable person is not
 * being watched. Offline additionally clears the manual state; break and
 * emergency keep it. Factored out so the three cannot drift on what "stop
 * sharing" means. Callers call `releasePendingTrack()` alongside it — dropping
 * the reference is not releasing the capture, and the browser's own "sharing
 * your screen" bar is what tells the difference.
 */
const IDLE_SESSION = {
  session: "idle" as const,
  token: null,
  url: null,
  share: IDLE_SHARE,
};

/**
 * The whole ruleset, in one pure function.
 *
 * Order is the priority order: an emergency outranks a break, a break outranks
 * presence, and presence is whatever the screen-share track says it is.
 */
export function derive(
  manual: ManualStatus,
  share: ShareFacts,
  /**
   * The account is online on ANOTHER connection — read live from the duty
   * document. Defaulted so every existing caller and test is unchanged.
   */
  remoteOnline = false,
): EmployeeStatus {
  if (manual === "emergency") return "emergency";
  if (manual === "break") return "break";
  /**
   * **Online is a live, whole-screen share — OWNER DECISION, restored.**
   *
   * For a period this was a plain choice: pressing Online made you online with
   * no prompt and nothing verified it. That has been reversed at the owner's
   * instruction. Pressing Go online asks for your screen first, the browser's
   * picker must return an ENTIRE screen (`capture.ts` hands anything else
   * straight back), and only a track that is actually flowing into the room
   * puts the pill green. Nothing a person types or clicks can assert it.
   *
   * `remoteOnline` is the account's own answer, for a device that is not the
   * one sharing — a phone in somebody's pocket while their laptop shares. It is
   * not a second way to be online: somewhere a screen IS being shared, and the
   * manager who opens it finds it. What it decides is only which device may say
   * so.
   */
  if (share.sharing && share.connected) return "online";
  return remoteOnline ? "online" : "offline";
}

const INITIAL: EmployeeStatusState = {
  status: "offline",
  manual: null,
  share: IDLE_SHARE,
  session: "idle",
  token: null,
  url: null,
  breakStartedAt: null,
  emergencyStartedAt: null,
  notice: null,
  reconnecting: false,
  remoteOnline: false,
  hydrated: false,
};

let state: EmployeeStatusState = INITIAL;

/**
 * The captured track, held outside the snapshot.
 *
 * A `MediaStreamTrack` is a live object; putting one in a `useSyncExternalStore`
 * snapshot would make the snapshot unstable and is not what snapshots are for.
 * The publisher reads it through the getter below.
 */
let pendingTrack: MediaStreamTrack | null = null;

export function takePendingTrack(): MediaStreamTrack | null {
  return pendingTrack;
}
export function clearPendingTrack(): void {
  pendingTrack = null;
}

/**
 * Give the capture back to the browser.
 *
 * **Dropping the reference is not releasing the track**, and the difference is
 * visible to the person: every teardown below used to set `pendingTrack = null`,
 * which orphaned a live `MediaStreamTrack` if the publisher had never taken it —
 * a room that failed to connect, a token that never arrived. Chrome went on
 * showing "localhost is sharing your screen" for a share Cowork had already
 * given up on, and the pill said Offline beside it. Whoever saw that had no way
 * to reconcile the two.
 *
 * A no-op once the publisher has taken the track: ownership moved with it, and
 * `ScreenSharePublisher` stops it on unpublish and on unmount.
 */
function releasePendingTrack(): void {
  /**
   * **The live share goes with it.**
   *
   * Nothing unmounts a frame to end a capture any more — the publisher SDK runs
   * in this document and holds the session itself — so every path that tears a
   * session down has to say so. Break, emergency, offline and a failed publish
   * all reach here, which is why the stop belongs here rather than at four call
   * sites that could each forget it.
   *
   * Safe when nothing is sharing: `stopPublishing` is a no-op then.
   */
  stopPublishing();

  const track = pendingTrack;
  pendingTrack = null;
  if (!track) return;
  try {
    track.stop();
  } catch {
    /* Already ended — the browser's own Stop sharing bar, or a device that went
       away. Nothing to release. */
  }
}

const listeners = new Set<() => void>();

function commit(next: Omit<EmployeeStatusState, "status">) {
  /* A real live share supersedes a reconnect: once the track is flowing this is
     genuine online and the prompt is done. A manual state also ends the
     reconnect — the person made a different choice. */
  const reconnecting =
    (next.share.sharing && next.share.connected) || next.manual !== null
      ? false
      : next.reconnecting;
  const status = derive(next.manual, next.share, next.remoteOnline);
  const same =
    status === state.status &&
    next.manual === state.manual &&
    next.share.sharing === state.share.sharing &&
    next.share.connected === state.share.connected &&
    next.share.surface === state.share.surface &&
    next.share.detail === state.share.detail &&
    next.session === state.session &&
    next.token === state.token &&
    next.url === state.url &&
    next.breakStartedAt === state.breakStartedAt &&
    next.emergencyStartedAt === state.emergencyStartedAt &&
    next.notice === state.notice &&
    reconnecting === state.reconnecting &&
    next.remoteOnline === state.remoteOnline &&
    next.hydrated === state.hydrated;
  if (same) return;
  state = { ...next, reconnecting, status };
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSnapshot(): EmployeeStatusState {
  return state;
}

/** The server has no presence to render; it renders the resting state. */
export function getServerSnapshot(): EmployeeStatusState {
  return INITIAL;
}

/* ── Writes from the room ─────────────────────────────────────────────────── */

/**
 * The only way LiveKit facts enter this module. Called by `ScreenShareBridge`
 * from real room events.
 *
 * Losing the share does NOT clear a manual state: someone on a break who stops
 * sharing is still on a break, and an emergency does not end because a track
 * did. Both are cleared by the person, or by ending the session.
 */
export function reportShare(share: ShareFacts): void {
  commit({
    ...state,
    share,
    /* A live track is a FACT about this device, not the initial guess the
       publish gate exists to hold back — so reporting one settles the question
       `hydrated` asks even if the account subscription never answered. See
       `goOffline`. */
    hydrated: state.hydrated || (share.sharing && share.connected),
    notice: null,
  });
}

/* ── The go-online flow ───────────────────────────────────────────────────── */

/**
 * Go online — which is to say, join your presence room and share your screen
 * into it.
 *
 * **There is no other way to be online, and no `goOnline()` to call.** A
 * function that set the status directly existed for a period and is gone: while
 * it did, presence was self-declared, and a manager opening somebody's screen
 * found nothing there.
 *
 * **The picker is no longer ours, and the rule is stronger for it.** Cowork used
 * to call `getDisplayMedia` itself and hand back anything that was not an entire
 * screen — a check in a browser, which a modified client could simply not make.
 * Presence runs on Grav Stream now, in a room created `mode: "screen"` with
 * `requireEntireScreen: true`, so their SFU refuses a window or a browser tab
 * before the producer exists. A screen room also never asks for a camera or a
 * microphone, which is why there is no longer a meeting to create or a join
 * screen to get past.
 *
 * This function only fetches the seat and holds it. The room comes up, and the
 * PICKER is opened separately by the press that asked for it — see
 * `startScreenShareNow`, and the note in `StatusButton` about why a capture
 * prompt cannot survive an `await`.
 */
export async function startScreenShare(
  /**
   * **`url`, not `embedUrl`.** The seat carries both and they are not
   * interchangeable: `url` is the realtime server the media connects to, and
   * `embedUrl` is an HTML page for a WATCHER's iframe. This used to take the
   * embed page and store it as `url`, which is what the publisher SDK was then
   * handed as `serverUrl` — see the field's note above for what that looked
   * like from the outside.
   */
  fetchSeat: () => Promise<{ token: string; url: string }>,
): Promise<boolean> {
  if (state.session === "requesting" || state.session === "connecting")
    return false;

  if (state.share.sharing && state.share.connected) return true;

  if (isNativeShell()) {
    /* The iOS shell publishes a ReplayKit broadcast into a LiveKit room, which
       is not what a Grav Stream seat is. Refused with the reason rather than
       started with credentials it cannot use — a broadcast that goes nowhere
       looks exactly like one that works. */
    commit({
      ...state,
      session: "error",
      notice:
        "This app cannot share its screen yet. Open Cowork in a browser to go online.",
    });
    return false;
  }

  commit({ ...state, session: "connecting", notice: null });

  try {
    const { token, url } = await fetchSeat();
    if (!token || !url) throw new Error("no credentials");
    commit({ ...state, session: "connecting", token, url, notice: null });
    return true;
  } catch (e) {
    commit({
      ...state,
      session: "error",
      token: null,
      url: null,
      /* The route's own sentence where there is one — "Only their primary
         manager…", "Screen sharing is unavailable: …" — because a status code
         tells the reader nothing they can act on. */
      notice:
        e instanceof Error && e.message
          ? e.message
          : "Could not reach the room, so your screen is not being shared.",
    });
    return false;
  }
}

export function sessionLive(): void {
  commit({ ...state, session: "live", notice: null });
}

/**
 * Something went wrong inside the room, and the session is still worth keeping.
 *
 * **The difference between this and `sessionFailed` is a session that survives.**
 * Grav Stream's embed posts `error` for anything it wants to tell the host —
 * media it could not reach, a share the person cancelled, a message from their
 * server. Treating every one of them as fatal dropped the credentials, which
 * unmounted the frame, which ended a session that was working: press Join, go
 * online, and watch the whole thing vanish a second later. Only `left` and a
 * deliberate choice end a session now; everything else is a sentence under the
 * pill.
 */
export function reportProblem(reason: string): void {
  commit({ ...state, notice: reason });
}

/** The publish itself failed, after the room was up. */
export function sessionFailed(reason: string): void {
  releasePendingTrack();
  commit({
    ...state,
    session: "error",
    token: null,
    url: null,
    notice: reason,
  });
}

/**
 * End the session.
 *
 * Dropping the credentials unmounts the room, which disconnects it — Cowork
 * does not hold an open room for someone who is not sharing.
 */
export function goOffline(): void {
  releasePendingTrack();
  commit({
    ...state,
    ...IDLE_SESSION,
    /* The person said so — see `goOnline`. */
    hydrated: true,
    manual: null,
    breakStartedAt: null,
    emergencyStartedAt: null,
    notice: null,
    /* A deliberate offline is the end of presence, reconnect or not. */
    reconnecting: false,
  });
}

/**
 * The room went away — a network drop, or the credentials being cleared by a
 * break/emergency/offline transition.
 *
 * Stops the media but keeps whatever status the person chose: a break or an
 * emergency is a claim about the person, not the connection, so a disconnect
 * must not silently demote it to offline. An online person, having no manual
 * state, falls to offline here, which is correct.
 */
export function endSession(): void {
  releasePendingTrack();
  commit({ ...state, ...IDLE_SESSION, notice: null });
}

/**
 * The share DIED rather than being given up — the phone locked, the broadcast
 * was torn down by iOS, the connection dropped.
 *
 * Distinct from `endSession` in exactly one respect, and it is the whole point:
 * it leaves `reconnecting` set. `DutySync` publishes nothing while that flag is
 * up, so the durable `cowork_duty_status` claim is neither renewed nor revoked —
 * it is simply left exactly as the person set it. Resume and nothing was ever
 * broken; stay away and it stands until they say otherwise, because nothing here
 * takes a status away from the person who chose it.
 *
 * **Why not just write offline immediately.** On iOS a locked screen kills the
 * broadcast every single time, and ReplayKit will not restart without a fresh
 * tap. Publishing offline the instant it dies marked people absent for putting
 * their phone in a pocket. Presence is not local here — it is what a manager
 * reads — so the flap was visible to everyone.
 *
 * The person is still OFFLINE locally (`derive` is unmoved: online is a live
 * share and nothing else). This governs only how long the shared claim outlives
 * the share.
 */
export function shareInterrupted(): void {
  releasePendingTrack();
  commit({
    ...state,
    ...IDLE_SESSION,
    reconnecting: true,
    notice: "Screen sharing stopped. Resume to stay online.",
  });
}

/* ── Manual states ────────────────────────────────────────────────────────── */

export function startBreak(): void {
  /* Stop the recording, keep the person on their break. Clearing the
     credentials unmounts the room, whose publisher stops the track. */
  releasePendingTrack();
  commit({
    ...state,
    ...IDLE_SESSION,
    /* The person said so — see `goOnline`. */
    hydrated: true,
    manual: "break",
    breakStartedAt: Date.now(),
    emergencyStartedAt: null,
    notice: null,
    reconnecting: false,
  });
}

export function declareEmergency(): void {
  /* Stops the recording like the other unavailable states — an emergency is not
     a moment to keep broadcasting someone's screen. The manual state is kept. */
  releasePendingTrack();
  commit({
    ...state,
    ...IDLE_SESSION,
    /* The person said so — see `goOnline`. */
    hydrated: true,
    manual: "emergency",
    breakStartedAt: null,
    /* Re-declaring while already in an emergency keeps the original start. The
       duration under review is the whole episode, not the last press. */
    emergencyStartedAt: state.emergencyStartedAt ?? Date.now(),
    notice: null,
    reconnecting: false,
  });
}

/**
 * How long Emergency Mode has been running, in seconds, or null.
 *
 * Read at the moment it is switched off, to fill the approval request. Derived
 * from the two timestamps rather than counted, for the same reason the work
 * timer is — see `lib/tasks/timer.ts`.
 */
/**
 * Consume the break's start timestamp.
 *
 * Returns it and clears it in one step, so a break can be credited EXACTLY
 * once. Without this, picking "online" while on a break credits it, and then
 * cancelling the screen-share prompt leaves `manual` as `break` with the start
 * still set — the next attempt credits the same minutes again.
 */
export function takeBreakStart(): number | null {
  const started = state.breakStartedAt;
  if (started === null) return null;
  commit({ ...state, breakStartedAt: null });
  return started;
}

export function emergencyElapsedSecs(nowMs = Date.now()): number | null {
  if (state.emergencyStartedAt === null) return null;
  return Math.max(0, Math.round((nowMs - state.emergencyStartedAt) / 1000));
}

/**
 * Leave a manual state.
 *
 * Presence then falls back to the track: still sharing, still online; sharing
 * stopped while away, offline until it starts again.
 */
export function clearManual(): void {
  commit({
    ...state,
    /* The person said so — see `goOnline`. */
    hydrated: true,
    manual: null,
    breakStartedAt: null,
    emergencyStartedAt: null,
    notice: null,
  });
}

/**
 * Restore presence from the durable duty document on page load.
 *
 * **A refresh is not a status change.** The in-memory store re-initialises to
 * offline on every load, but the `cowork_duty_status` document survived and is
 * the real source of truth. Called once, with the mode `getDutyMode()` read
 * back (staleness already applied — a genuinely stale claim arrives here as
 * `offline` and restores nothing).
 *
 *  · **break / emergency** are share-independent, so they restore exactly: the
 *    person is still on their break, and the stopwatch resumes from the stored
 *    start.
 *  · **online** cannot be reasserted without a fresh screen-share gesture, so it
 *    restores as `reconnecting` — presence stays online and the heartbeat keeps
 *    the claim alive while the share is re-established, rather than dropping to
 *    offline. The notice tells the person their share needs re-sharing.
 */
export function restorePresence(input: {
  mode: EmployeeStatus;
  breakStartedAtMs?: number | null;
  emergencyStartedAtMs?: number | null;
}): void {
  const restored =
    input.mode === "break"
      ? { manual: "break" as const, reconnecting: false }
      : input.mode === "emergency"
        ? { manual: "emergency" as const, reconnecting: false }
        : input.mode === "online"
          ? { manual: null, reconnecting: true }
          : null;

  console.info("[presence] SESSION RESTORE:", {
    previousStatus: input.mode,
    restoredStatus: restored ? derive(restored.manual, state.share) : "offline",
    reconnectingShare: restored?.reconnecting ?? false,
  });

  if (!restored) return; // offline / stale — nothing to restore

  commit({
    ...state,
    manual: restored.manual,
    breakStartedAt:
      input.mode === "break"
        ? (input.breakStartedAtMs ?? Date.now())
        : null,
    emergencyStartedAt:
      input.mode === "emergency"
        ? (input.emergencyStartedAtMs ?? Date.now())
        : null,
    reconnecting: restored.reconnecting,
    notice: restored.reconnecting
      ? "Reconnecting — resume your screen share to go back online."
      : null,
  });
}

/**
 * Apply the account's own presence, as the duty document currently states it.
 *
 * Called on every snapshot of a LIVE subscription, not once at mount. That is
 * the difference between the four reported faults and none of them:
 *
 *  · **The Offline flash.** A one-shot read meant the store sat at its initial
 *    `offline` until the round trip landed, so a second device announced Offline
 *    and corrected itself a moment later. `hydrated` below is what stops the pill
 *    asserting anything before it has been told.
 *  · **Timers that disagreed.** The start instants come from the account, so both
 *    devices count from the same origin. The clocks are not synchronised — they
 *    cannot be — they are given one shared zero.
 *  · **Status that did not follow.** A change on one device now reaches the other
 *    because there is a subscription rather than a single read at load.
 *
 * A break or an emergency is a claim about the PERSON and restores identically
 * everywhere. `online` is the one that needed a decision — see `remoteOnline`.
 */
export function applyRemotePresence(input: {
  mode: EmployeeStatus;
  breakStartedAtMs: number | null;
  emergencyStartedAtMs: number | null;
  /** The `online` claim belongs to a connection that is not this one. */
  onlineElsewhere: boolean;
}): void {
  const sharingHere = state.share.sharing && state.share.connected;

  if (input.mode === "break") {
    commit({
      ...state,
      hydrated: true,
      manual: "break",
      /* The account's instant wins. The local value is kept only when the
         document has none — the moment between starting a break here and the
         write landing, where dropping to `Date.now()` would restart the clock
         the person is watching. */
      breakStartedAt:
        input.breakStartedAtMs ?? state.breakStartedAt ?? Date.now(),
      emergencyStartedAt: null,
      remoteOnline: false,
      reconnecting: false,
    });
    return;
  }

  if (input.mode === "emergency") {
    commit({
      ...state,
      hydrated: true,
      manual: "emergency",
      breakStartedAt: null,
      emergencyStartedAt:
        input.emergencyStartedAtMs ?? state.emergencyStartedAt ?? Date.now(),
      remoteOnline: false,
      reconnecting: false,
    });
    return;
  }

  if (input.mode === "online") {
    commit({
      ...state,
      hydrated: true,
      /* Online is never a manual state — it is the track, or it is the
         account's word through `remoteOnline` below. */
      manual: null,
      breakStartedAt: null,
      emergencyStartedAt: null,
      /**
       * **The ACCOUNT is online, so this device says online — whoever holds the
       * claim.**
       *
       * This read `!sharingHere && input.onlineElsewhere`, and that second term
       * is the reported "it goes offline by itself". Reload the page: the store
       * re-initialises empty, the account still says online, and the first
       * snapshot carries `onlineElsewhere: true` because the claim is stamped
       * with the OLD tab's connection id — so the pill is green. Then the
       * heartbeat adopts the quiet claim and re-stamps it with THIS tab's id,
       * and the very next snapshot is `online` with `onlineElsewhere: false`.
       * Under the old term that left no share and no remote claim, which
       * derives to `offline`; the pill went grey and the publish effect wrote
       * that offline to `cowork_duty_status`. From a page reload, having
       * touched nothing.
       *
       * Whose connection holds the claim decides which device may STOP it, not
       * which device may report it. Cleared only when this device is the one
       * sharing, where the track says online on its own and this would be a
       * second, redundant reason for the same truth — one that would outlive
       * the share if the document were slow to catch up.
       */
      remoteOnline: !sharingHere,
      reconnecting: false,
      notice: null,
    });
    return;
  }

  /* Offline. The manual states are cleared because the account left them; this
     device's own share is untouched and still decides on its own — if it is
     sharing, `derive` keeps it online and the next publish corrects the
     document rather than this clearing the share. */
  commit({
    ...state,
    hydrated: true,
    manual: null,
    breakStartedAt: null,
    emergencyStartedAt: null,
    remoteOnline: false,
  });
}

/** Test seam. Resets everything, including the session. */
export function resetStatus(): void {
  pendingTrack = null;
  state = INITIAL;
  for (const fn of listeners) fn();
}

/* ── Presentation ─────────────────────────────────────────────────────────── */

export const STATUS_META: Record<
  EmployeeStatus,
  { label: string; dot: string; glow: string; help: string }
> = {
  online: {
    label: "Online",
    dot: "var(--state-positive)",
    glow: "color-mix(in srgb, var(--state-positive) 55%, transparent)",
    help: "Your screen is being shared.",
  },
  break: {
    label: "Break",
    dot: "var(--state-risk)",
    glow: "color-mix(in srgb, var(--state-risk) 55%, transparent)",
    help: "You are away. Screen sharing has stopped.",
  },
  emergency: {
    label: "Emergency",
    dot: "var(--state-overdue)",
    glow: "color-mix(in srgb, var(--state-overdue) 70%, transparent)",
    help: "Flagged as an emergency.",
  },
  offline: {
    label: "Offline",
    dot: "var(--ink-faint)",
    glow: "transparent",
    help: "No screen share is running.",
  },
};
