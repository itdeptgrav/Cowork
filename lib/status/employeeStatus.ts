import {
  ENTIRE_SCREEN_REQUIREMENT,
  ScreenShareCancelled,
  ScreenShareWrongSurface,
  requestScreenShare,
  type SharedSurface,
} from "../integrations/livekit/capture.ts";

/**
 * Employee presence, for the whole of Cowork.
 *
 * The rule this module exists to enforce: **Online is not a choice.** It is a
 * consequence of a live, whole-screen share track. The manual states can
 * suppress Online, and the button can *start* the sharing that produces it, but
 * nothing can assert it — and a share of a single window or a browser tab does
 * not produce it, because a curated view is not the thing being promised.
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

/** What LiveKit actually reports. Written only by `ScreenShareBridge`. */
export interface ShareFacts {
  /**
   * A screen-share publication exists, its track is live and unmuted, and the
   * surface is the entire screen. All four, or this is false.
   */
  sharing: boolean;
  /** The room is connected. False also covers "never joined". */
  connected: boolean;
  /** What is actually being shared, as the browser reports it. */
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
}

const IDLE_SHARE: ShareFacts = {
  sharing: false,
  connected: false,
  surface: null,
  detail: "Not sharing. Go online to start.",
};

/**
 * The media layer torn down: no room, no credentials, no share.
 *
 * The three unavailable states all reach it — **break, emergency and offline
 * every one STOP THE SCREEN RECORDING**, because an unavailable person is not
 * being watched. Offline additionally clears the manual state; break and
 * emergency keep it. Factored out so the three cannot drift on what "stop
 * sharing" means. Callers set `pendingTrack = null` alongside it.
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
): EmployeeStatus {
  if (manual === "emergency") return "emergency";
  if (manual === "break") return "break";
  /* **Online is a live share, and NOTHING else asserts it.** A reconnect after a
     refresh must not read as online — a manager who opens the screen would find
     nothing there. `reconnecting` is tracked separately (see the state) purely to
     drive a "resume sharing" affordance; it never makes someone online. Until the
     track is actually flowing, this is offline. */
  return share.sharing && share.connected ? "online" : "offline";
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

const listeners = new Set<() => void>();

function commit(next: Omit<EmployeeStatusState, "status">) {
  /* A real live share supersedes a reconnect: once the track is flowing this is
     genuine online and the prompt is done. A manual state also ends the
     reconnect — the person made a different choice. */
  const reconnecting =
    (next.share.sharing && next.share.connected) || next.manual !== null
      ? false
      : next.reconnecting;
  const status = derive(next.manual, next.share);
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
    reconnecting === state.reconnecting;
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
  commit({ ...state, share, notice: null });
}

/* ── The go-online flow ───────────────────────────────────────────────────── */

/**
 * Ask for a screen, then hold a session.
 *
 * MUST be called straight from a click. `requestScreenShare` needs the gesture,
 * so the capture prompt comes FIRST and the network comes after — which also
 * means a cancelled prompt costs nothing: no token is minted and no room is
 * joined. That is the "if the user cancels, remain Offline" rule expressed as
 * an ordering rather than as a cleanup.
 */
export async function goOnline(
  fetchCredentials: () => Promise<{ token: string; url: string }>,
): Promise<boolean> {
  if (state.session === "requesting" || state.session === "connecting")
    return false;

  if (state.share.sharing && state.share.connected) {
    // Already sharing — "go online" just means "stop suppressing it".
    commit({
      ...state,
      manual: null,
      breakStartedAt: null,
      emergencyStartedAt: null,
      notice: null,
    });
    return true;
  }

  commit({ ...state, session: "requesting", notice: null });

  let track: MediaStreamTrack;
  try {
    track = await requestScreenShare();
  } catch (e) {
    /* Three different sentences, because they are three different situations
       and one generic failure message would leave someone who picked a window
       with no idea what to do differently. */
    commit({
      ...state,
      session: "idle",
      share: { ...state.share, surface: surfaceOf(e) },
      notice:
        e instanceof ScreenShareCancelled
          ? "Screen sharing was cancelled — you are still offline."
          : e instanceof ScreenShareWrongSurface
            ? `${e.message} ${ENTIRE_SCREEN_REQUIREMENT}`
            : (e instanceof Error && e.message)
              ? e.message
              : "That browser could not start a screen share.",
    });
    return false;
  }

  pendingTrack = track;
  commit({
    ...state,
    session: "connecting",
    manual: null,
    breakStartedAt: null,
    emergencyStartedAt: null,
  });

  try {
    const { token, url } = await fetchCredentials();
    if (!token || !url) throw new Error("no credentials");
    commit({ ...state, session: "connecting", token, url, notice: null });
    return true;
  } catch {
    track.stop();
    pendingTrack = null;
    commit({
      ...state,
      session: "error",
      token: null,
      url: null,
      notice: "Could not reach the room. You are still offline.",
    });
    return false;
  }
}

function surfaceOf(e: unknown): SharedSurface | null {
  return e instanceof ScreenShareWrongSurface ? e.surface : null;
}

/** The room reported that the track is published and flowing. */
export function sessionLive(): void {
  commit({ ...state, session: "live", notice: null });
}

/** The publish itself failed, after the room was up. */
export function sessionFailed(reason: string): void {
  pendingTrack = null;
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
  pendingTrack = null;
  commit({
    ...state,
    ...IDLE_SESSION,
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
  pendingTrack = null;
  commit({ ...state, ...IDLE_SESSION, notice: null });
}

/* ── Manual states ────────────────────────────────────────────────────────── */

export function startBreak(): void {
  /* Stop the recording, keep the person on their break. Clearing the
     credentials unmounts the room, whose publisher stops the track. */
  pendingTrack = null;
  commit({
    ...state,
    ...IDLE_SESSION,
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
  pendingTrack = null;
  commit({
    ...state,
    ...IDLE_SESSION,
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
