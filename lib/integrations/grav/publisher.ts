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
  onEnded: () => void;
}): Promise<ShareCapture> {
  const sdk = window.GravStream;
  if (!sdk) throw Object.assign(new Error("Not ready"), { code: "NOT_LOADED" });

  const live = await sdk.share({
    token: input.token,
    serverUrl: input.serverUrl,
    /* The room enforces this too — it is created `requireEntireScreen: true` —
       so a window or a tab is refused by the SFU whatever a client asks for.
       Passing it here as well means the SDK can refuse before publishing, which
       is a faster and clearer failure for the same rule. */
    requireEntireScreen: true,
  });

  session = live;
  /* Covers the browser's own "Stop sharing" bar and a dropped connection —
     their documentation is explicit that both arrive here. */
  live.on("ended", () => {
    session = null;
    input.onEnded();
  });
  return live.capture;
}

/** Stop sharing, if this page is. Safe to call when it is not. */
export function stopPublishing(): void {
  const live = session;
  session = null;
  try {
    live?.stop();
  } catch {
    /* Already ended. */
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
