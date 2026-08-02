"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEVICE_MODE_DISMISSED_KEY,
  DEVICE_MODE_KEY,
  performanceProfile,
  readDeviceSignals,
  readStoredMode,
  shouldSuggestLowMode,
  suggestionReason,
  type DeviceMode,
  type DeviceSignals,
  type PerformanceProfile,
} from "@/lib/rules/performance/deviceMode";

/**
 * The device's performance mode, and what it turns off.
 *
 * **Per device, in `localStorage`.** One person uses a fast desktop and a slow
 * laptop; putting this on their account would carry the laptop's compromise to
 * the desktop and would let an administrator set it for somebody else. It is a
 * property of the machine in front of you.
 *
 * ## The attribute is what does most of the work
 *
 * `<html data-perf="low">` is set here, and `globals.css` keys off it. That
 * matters more than the React flags: a component that never asks the context
 * still loses its blur and its transitions, so the saving does not depend on
 * every author remembering. The flags are for the cases CSS cannot express —
 * whether to MOUNT a chart, how often to redraw a timer.
 *
 * ## Written before paint
 *
 * The attribute is applied in a `useLayoutEffect`-equivalent position — the
 * inline script in the document head — so a low-end machine never renders one
 * frosted frame before the mode lands. Doing it in a normal effect would cost
 * exactly the frame the mode exists to avoid.
 */

interface DeviceModeState {
  mode: DeviceMode;
  profile: PerformanceProfile;
  setMode: (mode: DeviceMode) => void;
  /** Signals read from the browser, for the settings screen and the monitor. */
  signals: DeviceSignals;
  /** Whether to offer low mode, and why. Null once dismissed or acted on. */
  suggestion: string | null;
  dismissSuggestion: () => void;
}

const Ctx = createContext<DeviceModeState>({
  mode: "balanced",
  profile: performanceProfile("balanced"),
  setMode: () => {},
  signals: {
    cores: null,
    memoryGb: null,
    prefersReducedMotion: false,
    saveData: false,
  },
  suggestion: null,
  dismissSuggestion: () => {},
});

export function useDeviceMode(): DeviceModeState {
  return useContext(Ctx);
}

/** Just the profile, for the many callers that need nothing else. */
export function usePerformanceProfile(): PerformanceProfile {
  return useContext(Ctx).profile;
}

export function DeviceModeProvider({ children }: { children: ReactNode }) {
  /* `balanced` until storage is read. Matching the inline script's default, so
     the first React render agrees with the attribute already on the document and
     nothing re-paints. */
  const [boot, setBoot] = useState<{
    mode: DeviceMode;
    signals: DeviceSignals;
    dismissed: boolean;
  }>(() => ({
    mode: "balanced",
    signals: {
      cores: null,
      memoryGb: null,
      prefersReducedMotion: false,
      saveData: false,
    },
    /* Dismissed until storage has been read, so no prompt flashes before we
       know whether it was already answered. */
    dismissed: true,
  }));
  const { mode, signals, dismissed } = boot;

  /*
   * Read storage and the hardware signals in ONE state update.
   *
   * Three `setState` calls in an effect is three renders on mount, on the
   * machine least able to afford them — and the lint rule that flags it is
   * pointing at a real cost rather than a style preference. One object, one
   * commit.
   */
  useEffect(() => {
    /* Deferred to the next frame, matching `ThemeProvider`: this syncs React to
       an external system — `localStorage` plus an attribute the pre-paint script
       has already set — and doing it in the effect body cascades a render on the
       machine least able to afford one.
    
       One `setState` for all three values, for the same reason. */
    const id = requestAnimationFrame(() => {
      let stored: DeviceMode | null = null;
      let alreadyAnswered = false;
      try {
        stored = readStoredMode(window.localStorage.getItem(DEVICE_MODE_KEY));
        alreadyAnswered =
          window.localStorage.getItem(DEVICE_MODE_DISMISSED_KEY) === "1";
      } catch {
        /* Private browsing. Balanced applies, nothing is remembered. */
      }
      setBoot({
        mode: stored ?? "balanced",
        signals: readDeviceSignals(),
        /* A stored choice IS an answer to the suggestion — somebody who has
           picked a mode has considered the question, and re-asking on every load
           is how a prompt becomes noise. */
        dismissed: alreadyAnswered || stored !== null,
      });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const setMode = useCallback((next: DeviceMode) => {
    setBoot((b) => ({ ...b, mode: next, dismissed: true }));
    try {
      window.localStorage.setItem(DEVICE_MODE_KEY, next);
      /* Choosing any mode answers the suggestion, including choosing to stay on
         balanced — otherwise the prompt returns on every load to somebody who
         has already considered it. */
      window.localStorage.setItem(DEVICE_MODE_DISMISSED_KEY, "1");
    } catch {
      /* Private browsing, or storage full. The mode still applies for this
         session; it simply will not be remembered, which is better than
         refusing to change it. */
    }
    document.documentElement.dataset.perf = next;
  }, []);

  /* Keep the attribute in step for the initial read and any external change. */
  useEffect(() => {
    document.documentElement.dataset.perf = mode;
  }, [mode]);

  const dismissSuggestion = useCallback(() => {
    setBoot((b) => ({ ...b, dismissed: true }));
    try {
      window.localStorage.setItem(DEVICE_MODE_DISMISSED_KEY, "1");
    } catch {
      /* As above — a dismissal that cannot be remembered is still a dismissal
         for this session. */
    }
  }, []);

  const value = useMemo<DeviceModeState>(
    () => ({
      mode,
      profile: performanceProfile(mode),
      setMode,
      signals,
      suggestion:
        !dismissed && shouldSuggestLowMode(signals)
          ? suggestionReason(signals)
          : null,
      dismissSuggestion,
    }),
    [mode, setMode, signals, dismissed, dismissSuggestion],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The inline script that sets the attribute before first paint.
 *
 * Rendered into the document head. Without it a low-end machine paints one
 * frosted, animated frame and then drops it — which is the most expensive frame
 * in the session and the one the mode exists to avoid.
 *
 * Deliberately tiny and dependency-free: it runs before any bundle.
 */
export const DEVICE_MODE_BOOT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  DEVICE_MODE_KEY,
)});document.documentElement.dataset.perf=(m==="high"||m==="low"||m==="lite"||m==="balanced")?m:"balanced";}catch(e){document.documentElement.dataset.perf="balanced";}})();`;
