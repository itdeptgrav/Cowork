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

/** Where the SDK is served from. Their versioned path, not a bundled copy. */
const SDK_URL = "https://live.grav.in/v1/grav-stream.js";

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

export interface ShareSession {
  capture: ShareCapture;
  stop: () => void;
  on: (event: "ended", handler: () => void) => void;
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
  }) => Promise<ShareSession>;
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
      if (window.GravStream) resolve(window.GravStream);
      else reject(new Error("Grav Stream loaded but exposed nothing."));
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
    live = await sdk.share({
      token: input.token,
      serverUrl: input.serverUrl,
      /* The room enforces this too — it is created `requireEntireScreen: true`
         — so a window or a tab is refused by the SFU whatever a client asks
         for. Passing it here as well means the SDK can refuse before
         publishing, which is a faster and clearer failure for the same rule. */
      requireEntireScreen: true,
    });
  } finally {
    /* The hook lives only for the duration of the call that uses it. */
    release();
  }

  session = live;
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
    const stream = await original(constraints);
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

/** Set by the capture's own `ended`, which only a real stop produces. */
let captureEnded = false;
/** True while `stopPublishing` is the one ending the session. */
let stoppingHere = false;

/** Stop sharing, if this page is. Safe to call when it is not. */
export function stopPublishing(): void {
  const live = session;
  session = null;
  stoppingHere = true;
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
