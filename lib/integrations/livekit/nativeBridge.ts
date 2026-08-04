/**
 * Bridge to the native iOS shell (CoworkSpikeHost's WKWebView wrapper).
 *
 * When the app is opened inside that shell, `window.webkit.messageHandlers
 * .coworkNative` exists. WKWebView cannot do `getDisplayMedia` at all, so on
 * native the whole "go online" LiveKit connection — presence AND the
 * screen-share publish — is owned by the native `Room` (ReplayKit captures
 * frames the browser has no access to). The web side never opens its own
 * room for this identity; connecting two rooms as the same participant is
 * rejected by LiveKit as a duplicate identity.
 */

interface CoworkNativeWebkit {
  messageHandlers?: {
    coworkNative?: {
      postMessage: (message: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    webkit?: CoworkNativeWebkit;
    CoworkNativeEvents?: {
      onScreenShareState: (isSharing: boolean, error?: string) => void;
      /** Native asks the web app to re-run "go online" after the broadcast
       *  died — iOS kills it whenever the phone is locked, and only a fresh
       *  user tap may restart it. Credentials are re-fetched rather than
       *  reused: the old token may have expired while locked. */
      onResumeScreenShare: () => void;
    };
  }
}

export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.webkit?.messageHandlers?.coworkNative;
}

let pending: ((isSharing: boolean, error?: string) => void) | null = null;

let onResume: (() => void) | null = null;

if (typeof window !== "undefined") {
  window.CoworkNativeEvents = {
    onScreenShareState(isSharing, error) {
      pending?.(isSharing, error);
      pending = null;
      onScreenShareState?.(isSharing, error);
    },
    onResumeScreenShare() {
      onResume?.();
    },
  };
}

/** Registered by whatever owns the "go online" gesture, so native can re-run
 *  exactly that flow — same credential fetch, same publish — after iOS killed
 *  the broadcast at lock. */
export function setNativeResumeHandler(fn: (() => void) | null): void {
  onResume = fn;
}

/** Set by the caller that wants to hear about state changes after the
 *  initial start/stop resolves too (e.g. the native "Stop sharing" bar). */
let onScreenShareState: ((isSharing: boolean, error?: string) => void) | null = null;
export function setNativeScreenShareListener(
  fn: ((isSharing: boolean, error?: string) => void) | null,
): void {
  onScreenShareState = fn;
}

const START_TIMEOUT_MS = 20_000;

export function nativeStartScreenShare(url: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null;
      reject(new Error("Screen sharing was cancelled — you are still offline."));
    }, START_TIMEOUT_MS);

    pending = (isSharing, error) => {
      clearTimeout(timer);
      if (isSharing) resolve();
      else reject(new Error(error ?? "That app could not start a screen share."));
    };

    window.webkit!.messageHandlers!.coworkNative!.postMessage({
      action: "startScreenShare",
      url,
      token,
    });
  });
}

export function nativeStopScreenShare(): void {
  window.webkit?.messageHandlers?.coworkNative?.postMessage({ action: "stopScreenShare" });
}
