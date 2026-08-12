/**
 * Sharing a screen from THIS page, with Grav Stream's publisher SDK.
 *
 * **This is what removed the panel.** For a while the sharer had a small
 * Grav Stream frame in the corner, and it was not decoration: `getDisplayMedia`
 * needs user activation in the document that calls it, activation does not
 * cross a cross-origin frame boundary, and a hidden frame gets no picker at all
 * (`EMBED_NOT_VISIBLE`). So the button had to be inside their iframe, and the
 * iframe had to be on screen.
 *
 * The SDK runs in OUR document. Their own words: *"the host's own button works
 * with no extra click and no visible frame… Use the SDK for the person sharing,
 * and the iframe for the people watching."* So the Go online button opens the
 * picker directly, and nothing is rendered anywhere.
 *
 * ## The two rules that decide the shape of this file
 *
 *  · **The token must be in hand BEFORE the click.** Transient activation lasts
 *    about five seconds, and a token fetch inside the handler can spend all of
 *    it — the prompt is then refused with nothing to show for it. The seat is
 *    fetched when the status menu opens (`StatusButton`), and the script is
 *    preloaded there too.
 *  · **`share()` must be reached from the gesture.** It is `async`, but the work
 *    before `getDisplayMedia` is local, so calling it directly in the click
 *    keeps the activation. Nothing may be awaited in front of it.
 */

/**
 * Where the SDK is served from. Their path, not a bundled copy.
 *
 * **The query string is a cache-buster, and it is not decoration.** They rebuild
 * this file in place — the path carries a major version, not a build — so a
 * browser holding yesterday's copy keeps yesterday's behaviour for ever.
 * Nothing this application does can hard-refresh somebody else's browser; a
 * changed URL can, which is their own instruction: *"Add a version query so
 * browsers cannot serve a stale copy… Bump that number whenever we tell you
 * there is a new build."*
 *
 * **It is their SDK VERSION, not a date, and that matters to more than us.**
 * Every session they could see was reporting an unidentified client, because
 * clients were running a build from before version reporting existed — so they
 * could not tell an SDK integration from an iframe one when something looked
 * wrong. Matching the number makes `GravStream.version` and their server-side
 * "sdk 1.1.0" agree.
 *
 * **Bump on their word.** `EXPECTED_SDK_VERSION` is checked at load and a
 * mismatch is logged loudly: a stale copy is invisible otherwise, and every
 * fix they ship silently fails to arrive.
 */
const SDK_VERSION = "1.1.0";
const EXPECTED_SDK_VERSION = SDK_VERSION;
const SDK_URL = `https://live.grav.in/v1/grav-stream.js?v=${SDK_VERSION}`;

/** What one live share reports about itself. */
export interface ShareCapture {
  displaySurface: "monitor" | "window" | "browser" | null;
  width?: number;
  height?: number;
  frameRate?: number;
  label?: string;
  /** Their own verdict, rather than this product re-deriving it from a string. */
  isEntireScreen?: boolean;
}

/**
 * What the encoder is actually doing, from `session.getStats()`.
 *
 * **Every field here answers a question that was previously guesswork.** "It is
 * slow" is not a report anybody can act on; this is. Their two decisive fields:
 *
 *  · `codec` — `H264` means a dedicated hardware encoder. `VP8` means software,
 *    which will pin a core encoding a whole desktop no matter what else is
 *    tuned. It is negotiated at JOIN, so a session running since before their
 *    rebuild keeps VP8 until it reconnects.
 *  · `limitedBy` — `cpu`, `bandwidth`, or `none`. Which of the two ends is the
 *    constraint, rather than an argument about it.
 *
 * `paused` and `watchers` are the other change worth knowing: a publisher with
 * nobody watching now stops encoding altogether, where before it encoded and
 * uploaded all day into an empty room.
 */
export interface ShareStats {
  codec: string | null;
  /** Their `encoderImplementation` — e.g. `ExternalEncoder` for hardware. */
  encoder: string | null;
  /** `powerEfficientEncoder`: hardware, rather than a core spent on it. */
  hardware: boolean | null;
  resolution: string | null;
  fps: number | null;
  kbps: number | null;
  /** `qualityLimitationReason`: "none" | "cpu" | "bandwidth". */
  limitedBy: string | null;
  framesSent: number | null;
  framesDropped: number | null;
  /** Encoding has stopped because nobody is watching. */
  paused: boolean | null;
  watchers: number | null;
}

export interface ShareSession {
  capture: ShareCapture;
  stop: () => void;
  on: (event: "ended", handler: () => void) => void;
  /** Added in SDK 1.1.0 — absent on an older cached copy, hence optional. */
  getStats?: () => Promise<ShareStats>;
}

/**
 * Why a share ended — and this distinction is the whole of a reported fault.
 *
 * Their `ended` fires for two completely different events: *"when the user
 * stops from the browser's own bar or the connection drops."* Cowork treated
 * both as the person stopping, so a network blip or a server restart marked
 * somebody offline and killed their capture while they were sitting at their
 * desk working. That is the auto-offline the owner has ruled out twice.
 *
 *  · `stopped` — the CAPTURE ended: the browser's Stop sharing bar, the display
 *    going away, the OS revoking it. A deliberate act, and going offline for it
 *    is the documented rule: stopping is stopping.
 *  · `dropped` — the capture is still live but the session is not. Nothing was
 *    decided by anybody, so nothing about their status may change.
 */
export type ShareEnd = "stopped" | "dropped";

interface GravStreamGlobal {
  share: (options: {
    token: string;
    serverUrl: string;
    requireEntireScreen?: boolean;
    maxBitrate?: number;
    /**
     * Their encoding hint. **Not passed by default, and that is the point.**
     *
     * The SDK sets `detail`, which is what keeps text legible — under pressure
     * the encoder drops frames rather than sharpness. They have asked for ONE
     * machine to try `motion` as an experiment, because they suspect Chrome is
     * choosing a software H.264 encoder precisely because we say the content is
     * text. That is a subjective read they want, not a default to change: see
     * `setContentHintForTest`.
     */
    contentHint?: "detail" | "motion";
  }) => Promise<ShareSession>;
  /** Added in 1.1.0. Absent means a cached copy from before it existed. */
  version?: string;
}

declare global {
  interface Window {
    GravStream?: GravStreamGlobal;
  }
}

let loading: Promise<GravStreamGlobal> | null = null;

/**
 * Load the SDK once, and keep the promise.
 *
 * Called from the status menu opening, so the script is parsed and ready long
 * before the press that needs it — see the note about activation above. Calling
 * it again is free.
 */
export function loadPublisherSdk(): Promise<GravStreamGlobal> {
  if (window.GravStream) return Promise.resolve(window.GravStream);
  if (loading) return loading;

  loading = new Promise<GravStreamGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_URL}"]`,
    );
    const script = existing ?? document.createElement("script");
    const done = () => {
      if (!window.GravStream) {
        reject(new Error("Grav Stream loaded but exposed nothing."));
        return;
      }
      reportVersion(window.GravStream);
      resolve(window.GravStream);
    };
    script.addEventListener("load", done);
    script.addEventListener("error", () => {
      /* Cleared so a later attempt can retry rather than inheriting a rejected
         promise for the life of the page. */
      loading = null;
      reject(new Error("The screen-sharing library could not be loaded."));
    });
    if (!existing) {
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return loading;
}

/** True once the SDK is parsed and `share()` can be called from a click. */
export function publisherReady(): boolean {
  return typeof window !== "undefined" && window.GravStream != null;
}

/** Which build is actually in this browser, or null before it has loaded. */
export function publisherVersion(): string | null {
  if (typeof window === "undefined") return null;
  return window.GravStream?.version ?? null;
}

/**
 * Say out loud which build arrived.
 *
 * **A stale copy is otherwise completely invisible.** The file is rebuilt in
 * place, so a browser holding an old one keeps old behaviour and reports
 * nothing: on their side the session shows an unidentified client, on ours
 * everything looks normal, and every fix they ship appears not to work. A
 * missing `version` means a copy from before version reporting existed at all,
 * which is the case they are currently seeing for every one of our sessions.
 */
function reportVersion(sdk: GravStreamGlobal): void {
  const found = sdk.version ?? null;
  if (found === EXPECTED_SDK_VERSION) {
    console.info(`[stream] Grav Stream SDK ${found}`);
    return;
  }
  console.warn(
    `[stream] Grav Stream SDK is ${found ?? "an unversioned build"}, expected ` +
      `${EXPECTED_SDK_VERSION}. A cached copy is being served: hard-refresh ` +
      `(Ctrl+Shift+R). Until it matches, their fixes are not in this browser.`,
  );
}

/* ── The live session ──────────────────────────────────────────────────────── */

let session: ShareSession | null = null;

/**
 * Start sharing. **Call this synchronously from the click** — see the file note.
 *
 * Returns the session's own report of what was captured. Throws with their
 * `code` on the error object, which `shareRefusal` turns into a sentence.
 */
export async function startPublishing(input: {
  token: string;
  serverUrl: string;
  onEnded: (reason: ShareEnd) => void;
}): Promise<ShareCapture> {
  const sdk = window.GravStream;
  if (!sdk) throw Object.assign(new Error("Not ready"), { code: "NOT_LOADED" });

  captureEnded = false;
  const release = watchTheCapture();
  let live: ShareSession;
  try {
    /**
     * **Three options, and deliberately not a fourth.**
     *
     * Their guidance is explicit: *"Call share() with only { token, serverUrl }
     * unless you have measured a specific reason to change something… If you
     * pass custom video constraints or a custom maxBitrate you will defeat the
     * resolution cap and the anti-downscale setting, and the text problem will
     * come back."* So no constraints and no `maxBitrate` are passed, and no
     * `getDisplayMedia` call of ours competes with theirs — the interception
     * below only listens to the track they create.
     *
     * What the SDK sets for us, which we must not re-implement: capture capped
     * at 1920×1080, `contentHint: "detail"` with `scaleResolutionDownBy` pinned
     * to 1 so pressure costs frames rather than sharpness, H.264 preferred over
     * VP8 so encoding uses hardware rather than a saturated CPU core, and a
     * server-side keepalive on the signaling socket so a day-long share is not
     * cut off as idle.
     *
     * `requireEntireScreen` is the exception, and it is not a capture
     * constraint: their reference says `ENTIRE_SCREEN_REQUIRED` is raised
     * *"only when you pass requireEntireScreen: true"*. Without it the SDK
     * accepts a window and the refusal arrives later, from the SFU, as a failed
     * publish. Passing it makes the rule refuse before anything starts.
     */
    live = await sdk.share({
      token: input.token,
      serverUrl: input.serverUrl,
      requireEntireScreen: true,
      /* Absent unless somebody has armed the experiment on this machine — see
         `setContentHintForTest`. Spreading an undefined key would still pass
         the key, which is why it is conditional rather than defaulted. */
      ...(contentHintForTest ? { contentHint: contentHintForTest } : {}),
    });
  } finally {
    /* The hook lives only for the duration of the call that uses it. */
    release();
  }

  session = live;
  /* The console handle their diagnostics ask for — see `exposeForConsole`. */
  exposeForConsole(live);
  /* Their one event for two events — see `ShareEnd`. */
  live.on("ended", () => {
    session = null;
    /* Our own teardown reaches here too, because stopping the session is what
       `stopPublishing` does. Nothing to report: the caller already knows. */
    if (stoppingHere) return;
    input.onEnded(captureEnded ? "stopped" : "dropped");
  });
  return live.capture;
}

/**
 * Watch the CAPTURE, not the session — the one thing that tells the two endings
 * apart.
 *
 * A `MediaStreamTrack` fires `ended` when its SOURCE goes away: the browser's
 * Stop sharing bar, a display being unplugged, the OS withdrawing permission.
 * It does NOT fire when a WebRTC transport drops, and — by specification — it
 * does not fire when something calls `stop()` on it either. So the event is a
 * reliable "the person is no longer sharing" and its absence is a reliable "the
 * connection is what went".
 *
 * Their SDK owns the capture and does not hand the track back, so the only way
 * to reach it is to intercept the call that creates it. The hook is installed
 * immediately before `share()` and removed the moment it returns.
 */
function watchTheCapture(): () => void {
  const media = navigator.mediaDevices as
    | (MediaDevices & { getDisplayMedia?: MediaDevices["getDisplayMedia"] })
    | undefined;
  const original = media?.getDisplayMedia?.bind(media);
  if (!media || !original) return () => {};

  media.getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
    /**
     * **A resume reuses the screen the person already chose.**
     *
     * Their SDK always calls `getDisplayMedia`, and a browser only opens a
     * capture prompt for a real click — so a share their SDK ended cannot be
     * restarted without asking again. Unless the stream is already in hand: a
     * `MediaStreamTrack` clone shares the ORIGINAL SOURCE and survives the
     * original being stopped, so the spare kept below is a live handle on the
     * same screen, with nothing to prompt for. See `resumeStream`.
     */
    if (resumeStream) {
      const reused = resumeStream;
      resumeStream = null;
      return reused;
    }
    const stream = await original(constraints);
    keepSpare(stream);
    for (const track of stream.getTracks())
      track.addEventListener("ended", () => {
        captureEnded = true;
      });
    return stream;
  };
  return () => {
    media.getDisplayMedia = original;
  };
}

/**
 * A clone of the live capture, kept for one silent resume.
 *
 * **This exists because their SDK has no reconnect, and stops the capture when
 * the socket closes.** From `web/sdk/index.js`:
 *
 *     ws.onclose = () => {
 *       if (session.active) {
 *         session.active = false;
 *         session._stream?.getTracks().forEach((t) => t.stop());
 *         session._emit("ended", { reason: "disconnected" });
 *       }
 *     };
 *
 * There is no retry anywhere in that file. So any WebSocket close — a wifi
 * blip, a laptop waking, a proxy hiccup, one of their deploys — permanently
 * ends a share that the person is in the middle of, which is the reported
 * "screen sharing turns off after a while".
 *
 * A clone is independent: stopping the original does not stop it, and both end
 * together when the SOURCE goes — which is exactly the distinction wanted. When
 * the person really pressed Stop, the clone dies with it and there is nothing
 * to resume; when the socket merely closed, the clone is still a live picture
 * of the same screen.
 *
 * **The right fix is theirs**, and this is a stopgap: when their SDK
 * reconnects, delete all of it.
 */
let spareStream: MediaStream | null = null;
/** Handed to their `getDisplayMedia` in place of a prompt, once. */
let resumeStream: MediaStream | null = null;

function keepSpare(stream: MediaStream): void {
  dropSpare();
  try {
    spareStream = stream.clone();
  } catch {
    /* A browser that will not clone simply gets no silent resume — the person
       is asked instead, which is the behaviour without any of this. */
    spareStream = null;
  }
}

function dropSpare(): void {
  for (const track of spareStream?.getTracks() ?? []) {
    try {
      track.stop();
    } catch {
      /* Already gone. */
    }
  }
  spareStream = null;
}

/** Is there still a live picture of the screen this person chose? */
export function canResumeSilently(): boolean {
  return (
    spareStream?.getVideoTracks().some((t) => t.readyState === "live") === true
  );
}

/**
 * Start sharing again with the screen already chosen — no prompt, no click.
 *
 * Only for a session their SDK ended without anybody deciding to (`dropped`).
 * Returns false when there is nothing live to reuse, which is when the person
 * has to be asked — and that is what the alert dialog is for.
 */
export async function resumePublishing(input: {
  token: string;
  serverUrl: string;
  onEnded: (reason: ShareEnd) => void;
}): Promise<ShareCapture | null> {
  if (!canResumeSilently() || !window.GravStream) return null;
  const spare = spareStream;
  if (!spare) return null;
  /* Consumed by the interception inside `startPublishing`, which hands it to
     their `getDisplayMedia` instead of prompting. A fresh clone is taken from
     it there, so a second drop can be resumed too. */
  resumeStream = spare;
  spareStream = null;
  try {
    return await startPublishing(input);
  } catch (error) {
    resumeStream = null;
    dropSpare();
    console.warn("[stream] silent resume failed:", error);
    return null;
  }
}

/** Set by the capture's own `ended`, which only a real stop produces. */
let captureEnded = false;
/** True while `stopPublishing` is the one ending the session. */
let stoppingHere = false;

/** Stop sharing, if this page is. Safe to call when it is not. */
export function stopPublishing(): void {
  const live = session;
  session = null;
  stoppingHere = true;
  /**
   * **The spare goes too, and this line is load-bearing.**
   *
   * A clone keeps the SOURCE alive: leaving one running after somebody went
   * offline would keep the browser's "sharing your screen" bar up over a person
   * who has stopped, which is the most alarming possible way to be wrong about
   * this. Every deliberate teardown reaches here — see `releasePendingTrack`.
   */
  dropSpare();
  try {
    live?.stop();
  } catch {
    /* Already ended. */
  } finally {
    /* Cleared on a later turn: their `ended` may be dispatched asynchronously
       after `stop()` returns, and it must still be recognised as ours. */
    setTimeout(() => {
      stoppingHere = false;
    }, 0);
  }
}

/**
 * What the encoder is doing right now, or null if nothing is being shared.
 *
 * The whole point is that "it is slow" stops being the report. This is the
 * object Grav Stream asks for when something looks wrong: the codec in use,
 * whether the encoder is hardware, the resolution and frame rate actually being
 * sent, which end is the constraint, and — new in 1.1.0 — whether encoding has
 * stopped because nobody is watching.
 *
 * Null rather than an error when the method is missing: that means an older
 * cached copy of the SDK, which `reportVersion` has already said out loud.
 */
export async function shareStats(): Promise<ShareStats | null> {
  const live = session;
  if (!live?.getStats) return null;
  try {
    return await live.getStats();
  } catch {
    /* A session that ended between the check and the call. Not a fault worth
       raising anywhere: the next read answers, or there is nothing to read. */
    return null;
  }
}

/**
 * Their console handle, honoured literally.
 *
 * Their instructions say to run `await gs.getStats()` on the sharing machine,
 * so `gs` is what it is called. `gravStream` is the same object under a name
 * that does not read like a typo in six months' time.
 *
 * **A handle, not a mechanism.** Nothing in this application reads either
 * global; deleting both would change no behaviour. It exists so that a person
 * on a support call can answer a question about their own machine without a
 * build, which is the difference between a report Grav Stream can act on and
 * "it feels laggy".
 */
function exposeForConsole(live: ShareSession): void {
  if (typeof window === "undefined") return;
  const handle = {
    session: live,
    version: publisherVersion(),
    getStats: () => shareStats(),
    /* The experiment they asked one machine to try. Set it, then stop and
       start the share — the hint is chosen when the encoder is created. */
    useMotionHint: () => setContentHintForTest("motion"),
    useDetailHint: () => setContentHintForTest(null),
  };
  Object.assign(window as unknown as Record<string, unknown>, {
    gs: handle,
    gravStream: handle,
  });
}

/**
 * Their optional experiment: tell Chrome the content is motion, not text.
 *
 * **Off by default and it must stay that way.** `detail` is what keeps small
 * text legible — under pressure the encoder drops frames rather than sharpness
 * — and every unreadable-text report was traced to that trade going the other
 * way. They suspect Chrome picks a SOFTWARE H.264 encoder precisely because we
 * say the content is text, and want one machine to try the opposite and say
 * whether it feels smoother. That is a subjective read on one machine, not a
 * default for everybody.
 *
 * Takes effect on the next share: the hint is applied when the encoder is
 * created, so an already-running session keeps what it started with.
 */
let contentHintForTest: "detail" | "motion" | null = null;

export function setContentHintForTest(hint: "detail" | "motion" | null): void {
  contentHintForTest = hint;
  console.info(
    hint
      ? `[stream] contentHint "${hint}" will apply to the NEXT share — stop and start sharing.`
      : "[stream] contentHint back to the SDK's own default on the next share.",
  );
}

export function isPublishing(): boolean {
  return session !== null;
}

/**
 * Their error codes, in this product's words.
 *
 * `CANCELLED` is not a failure and is handled by the caller — somebody who
 * dismissed the picker has simply not gone online yet.
 */
export function shareRefusal(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  switch (code) {
    case "ENTIRE_SCREEN_REQUIRED":
      return "Share your entire screen, not a single window or a browser tab.";
    case "SURFACE_UNKNOWN":
      return "This browser will not say what you shared, so it cannot be accepted. Use Chrome or Edge.";
    case "PERMISSION_DENIED":
      return "Your browser blocked screen sharing for Cowork. Allow it in the address bar and try again.";
    case "TOKEN_IS_VIEWER":
      return "This seat can only watch, not share. Reopen the menu and try again.";
    case "TOKEN_EXPIRED":
    case "TOKEN_INVALID":
    case "TOKEN_REQUIRED":
      return "Your sharing session expired. Reopen the menu and try again.";
    case "SERVER_UNREACHABLE":
      return "The screen-sharing service could not be reached.";
    case "PUBLISH_FAILED":
    case "TIMEOUT":
      return "Your screen could not be sent. Try Go online again.";
    case "NOT_LOADED":
      return "The screen-sharing library has not finished loading. Try again in a moment.";
    default:
      return error instanceof Error && error.message
        ? error.message
        : "Your screen could not be shared.";
  }
}

/** Was this the person dismissing the picker rather than anything failing? */
export function wasCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "CANCELLED"
  );
}
