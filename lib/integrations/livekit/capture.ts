/**
 * Asking the browser for a screen, and checking what it actually gave.
 *
 * Deliberately separate from `screenShare.ts`, and deliberately free of any
 * LiveKit import: the presence store depends on this half, and a store that
 * pulls the whole realtime client in behind it cannot be reasoned about — or
 * unit-tested — on its own. Publishing lives next door, where LiveKit belongs.
 *
 * The rule this module enforces: **only an entire screen counts.** A window or
 * a browser tab is a curated view — the employee chooses what their manager
 * sees — so accepting one would make presence mean something different from
 * what it claims. The browser cannot be told to offer only monitors, so this
 * is a two-part job: ask for a monitor as a hint, then verify what came back
 * and hand the wrong thing straight back.
 */

/**
 * What Cowork asks for.
 *
 * `displaySurface: "monitor"` is a *hint* — Chrome pre-selects the Entire
 * Screen tab but still offers the others, so it improves the odds and proves
 * nothing. `surfaceSwitching: "exclude"` matters more: without it the browser
 * shows a "share this tab instead" control during the session, and a share
 * that starts compliant could quietly stop being so.
 */
export const SCREEN_CAPTURE: DisplayMediaStreamOptions = {
  video: { displaySurface: "monitor" },
  audio: false,
  // Not in every lib.dom version; harmless where unsupported, and each one
  // closes a route to a non-monitor surface.
  ...({
    surfaceSwitching: "exclude",
    selfBrowserSurface: "exclude",
    monitorTypeSurfaces: "include",
    systemAudio: "exclude",
  } as Record<string, string>),
};

/** What the employee actually picked, normalised across browsers. */
export type SharedSurface =
  | "entire_screen"
  | "window"
  | "browser_tab"
  /** The browser will not say. Not the same as a wrong answer — see below. */
  | "unknown";

export const SURFACE_LABEL: Record<SharedSurface, string> = {
  entire_screen: "Entire screen",
  window: "Application window",
  browser_tab: "Browser tab",
  unknown: "Unidentified surface",
};

/**
 * Read the surface off a live track.
 *
 * `displaySurface` is a track *setting*, not a constraint, so it reports what
 * the person chose rather than what was requested — which is exactly why it is
 * the thing to check. It is also live: re-reading mid-session is how a surface
 * switch would be caught if a browser allowed one.
 */
export function readSurface(track: MediaStreamTrack | null): SharedSurface {
  if (!track) return "unknown";
  const settings = track.getSettings() as MediaTrackSettings & {
    displaySurface?: string;
  };
  switch (settings.displaySurface) {
    case "monitor":
      return "entire_screen";
    case "window":
      return "window";
    case "browser":
    case "tab":
      return "browser_tab";
    default:
      return "unknown";
  }
}

/**
 * iOS Safari (16.4+) supports getDisplayMedia but never reports displaySurface —
 * it only offers full-screen capture with no window/tab picker, so "unknown"
 * from iOS is always an entire screen. Treat it as such so the eligibility
 * check doesn't reject a compliant iOS share.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    /* iPadOS 13+ reports MacIntel but has multiple touch points */
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isEntireScreen(track: MediaStreamTrack | null): boolean {
  const surface = readSurface(track);
  if (surface === "entire_screen") return true;
  /* iOS never sets displaySurface but only offers full-screen capture. */
  if (surface === "unknown" && isIOS()) return true;
  return false;
}

export class ScreenShareCancelled extends Error {
  constructor() {
    super("Screen sharing was cancelled.");
    this.name = "ScreenShareCancelled";
  }
}

/**
 * The person shared something, but not their whole screen.
 *
 * A distinct error rather than a boolean, because the two failures deserve
 * different sentences: cancelling is a decision, and picking a window is a
 * misunderstanding that a message can fix.
 */
export class ScreenShareWrongSurface extends Error {
  readonly surface: SharedSurface;
  constructor(surface: SharedSurface) {
    super(
      surface === "unknown"
        ? "This browser will not confirm which screen is being shared."
        : `${SURFACE_LABEL[surface]} sharing is not accepted.`,
    );
    this.name = "ScreenShareWrongSurface";
    this.surface = surface;
  }
}

/** The sentence shown before the picker opens, and again if the wrong thing is picked. */
export const ENTIRE_SCREEN_REQUIREMENT =
  "To go online you must share your entire screen. Sharing a single window or a browser tab is not accepted.";

/**
 * Ask the browser for a screen, and return the track only if it is the whole
 * screen. MUST be called synchronously from a user gesture — awaiting anything
 * first costs the transient activation and the prompt is refused.
 *
 * Three outcomes, each its own signal:
 *  · `ScreenShareCancelled` — the picker was dismissed. Nothing happened.
 *  · `ScreenShareWrongSurface` — a window or a tab was picked, or the browser
 *    would not say which. The capture is stopped here, so the browser's
 *    "sharing" indicator does not linger over a share Cowork rejected.
 *  · a track — verified as an entire screen, and safe to publish.
 *
 * An unverifiable surface is treated as a failure rather than waved through.
 * The requirement is that the manager sees the whole screen; a browser that
 * will not confirm it cannot satisfy that, and defaulting to trust would make
 * the guarantee depend on which browser someone happened to open.
 */
export async function requestScreenShare(): Promise<MediaStreamTrack> {
  if (typeof navigator === "undefined") {
    throw new Error("Screen sharing is not available in this context.");
  }

  /* navigator.mediaDevices is undefined on HTTP pages (insecure context).
     This is the most common failure on mobile: the device visits the app
     over HTTP rather than HTTPS. */
  if (!navigator.mediaDevices) {
    throw new Error(
      "Screen sharing requires a secure connection. Please make sure you are opening Cowork over HTTPS.",
    );
  }

  if (!navigator.mediaDevices.getDisplayMedia) {
    throw new Error(
      isIOS()
        ? "Screen sharing on iPhone and iPad requires Safari 16.4 or later."
        : "This browser cannot share a screen.",
    );
  }

  /* iOS Safari accepts only a minimal options object — the experimental keys
     (selfBrowserSurface, surfaceSwitching, monitorTypeSurfaces, systemAudio)
     are ignored or may cause a NotSupportedError on WebKit. */
  const options = isIOS()
    ? { video: { displaySurface: "monitor" }, audio: false }
    : SCREEN_CAPTURE;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(options);
  } catch (e) {
    const name = (e as Error)?.name;
    // NotAllowedError is both "denied" and "dismissed the picker".
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new ScreenShareCancelled();
    }
    console.error("[requestScreenShare] getDisplayMedia rejected:", name, (e as Error)?.message);
    throw e;
  }

  const track = stream.getVideoTracks()[0];
  if (!track) throw new ScreenShareCancelled();

  if (!isEntireScreen(track)) {
    for (const t of stream.getTracks()) t.stop();
    throw new ScreenShareWrongSurface(readSurface(track));
  }

  return track;
}
