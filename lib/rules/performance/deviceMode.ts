import {
  HEARTBEAT_INTERVAL_MS,
  STALE_AFTER_MS,
} from "../presence/duty.ts";

/**
 * **Performance mode: rendering only, never behaviour.**
 *
 * Cowork runs on office laptops with integrated graphics beside machines that
 * can carry the full deck. This layer lets one build serve both without a second
 * app and without a second set of business rules.
 *
 * ## The line this module will not cross
 *
 * A mode may change **how much work the browser does to draw a thing**. It may
 * not change **what is true**. Concretely, the following are off limits and each
 * one has a guard below:
 *
 *  · **The presence heartbeat.** "Reduce polling frequency" is the obvious
 *    saving and it is a trap: `readDutyMode` treats a beat older than
 *    `STALE_AFTER_MS` as offline, so slowing the heartbeat past that window
 *    marks working people as away. Their timer then refuses to start. A
 *    performance setting that logs somebody out is not a performance setting.
 *  · **Timer accuracy.** The elapsed figure is computed from `startedAt` and the
 *    wall clock, never accumulated from ticks — so a slower tick redraws less
 *    often and stays exactly as correct. That is why it is safe to slow and why
 *    nothing else may be slowed the same way.
 *  · **Any repository read, write, permission or rule.** The mode never reaches
 *    them. A screen may render less; it may not show less true.
 *
 * ## Why per DEVICE and not per account
 *
 * One person uses a fast desktop and a slow laptop. Storing this on their user
 * record would carry the laptop's compromise onto the desktop, and — worse —
 * would make it a thing an administrator could set for somebody else. It lives
 * in `localStorage`, so it is a property of the machine in front of you.
 */

export type DeviceMode = "high" | "balanced" | "low";

export const DEVICE_MODES: {
  id: DeviceMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "high",
    label: "High performance",
    hint: "Full animation and the frosted deck. For a machine with a discrete GPU or recent integrated graphics.",
  },
  {
    id: "balanced",
    label: "Balanced",
    hint: "The default. Full visuals, with the most expensive effects trimmed under load.",
  },
  {
    id: "low",
    label: "Low-end laptop",
    hint: "Flat surfaces, no blur, fewer redraws. Everything still works — presence, timers, deadlines, screen sharing and notifications are untouched.",
  },
];

/**
 * What a mode actually changes.
 *
 * Every field is a RENDERING decision. There is deliberately no field here that
 * a repository, a rule or a permission reads — a reviewer should be able to
 * satisfy themselves of that by reading this interface alone.
 */
export interface PerformanceProfile {
  /** CSS transitions and keyframe animation. */
  animations: boolean;
  /**
   * `backdrop-filter`. The single most expensive always-on effect in the app —
   * the top bar blurs 28px behind a surface that is 94% opaque, so on a weak GPU
   * it costs a composite per scrolled frame to reveal almost nothing.
   */
  blur: boolean;
  /** Long shadows and the inset lip. Cheap individually, additive in a list. */
  decorativeShadows: boolean;
  /**
   * How often a running timer REDRAWS, in ms.
   *
   * Safe to slow because the figure is derived from `startedAt` and the wall
   * clock on every read — a slower tick shows a coarser number, never a wrong
   * one. It is the one interval in the product with that property.
   */
  timerTickMs: number;
  /** Non-critical UI polls — acknowledgement gates, tour probes. */
  uiPollMs: number;
  /** Rows a table renders before it asks the reader to page. */
  listChunkSize: number;
  /** Whether to mount charts, sparklines and the signature graph. */
  richCharts: boolean;
  /** Whether a live screen preview renders at full rate. */
  livePreview: boolean;
  /**
   * Frames per second for a monitoring preview.
   *
   * Applies to the WATCHER's rendering, not to the publisher's capture — the
   * shared stream is somebody's evidence of work and its quality is not a local
   * preference.
   */
  previewFps: number;
}

const HIGH: PerformanceProfile = {
  animations: true,
  blur: true,
  decorativeShadows: true,
  timerTickMs: 1_000,
  uiPollMs: 2_500,
  listChunkSize: 50,
  richCharts: true,
  livePreview: true,
  previewFps: 30,
};

const BALANCED: PerformanceProfile = {
  ...HIGH,
  /* The one trim the default takes: the always-on bar blur, which costs a
     composite per frame to reveal 6% of what is behind it. Everything else that
     blurs is a dialog, and a dialog is transient. */
  blur: true,
  listChunkSize: 50,
};

const LOW: PerformanceProfile = {
  animations: false,
  blur: false,
  decorativeShadows: false,
  /* Two seconds rather than one. A running timer still reads correctly; it
     simply redraws half as often. */
  timerTickMs: 2_000,
  uiPollMs: 10_000,
  listChunkSize: 20,
  richCharts: false,
  livePreview: true,
  previewFps: 10,
};

export function performanceProfile(mode: DeviceMode): PerformanceProfile {
  switch (mode) {
    case "high":
      return HIGH;
    case "low":
      return LOW;
    case "balanced":
    default:
      return BALANCED;
  }
}

/* ── The guards ───────────────────────────────────────────────────────────── */

/**
 * The presence heartbeat, which **no mode may slow**.
 *
 * Stated as a function rather than left as a constant so the refusal is
 * greppable: somebody adding `heartbeatMs` to the profile above will find this
 * and the reason.
 *
 * `readDutyMode` treats a beat older than `STALE_AFTER_MS` (120s) as offline.
 * The interval is 45s, which gives two chances to land inside the window before
 * anybody is marked away. Slowing it to save a request would mark working people
 * as offline — and the offline gate then refuses to start their timer.
 */
export function heartbeatIntervalMs(_mode: DeviceMode): number {
  void _mode;
  return HEARTBEAT_INTERVAL_MS;
}

/**
 * Is this interval safe to slow to the profile's figure?
 *
 * The test is whether the value is DERIVED or ACCUMULATED. A timer computed from
 * `startedAt` and the wall clock is derived, so redrawing less often is a
 * cosmetic change. A heartbeat is a claim that expires, so slowing it changes
 * what the system believes.
 */
export function mayThrottle(interval: {
  /** Milliseconds the caller wants to use. */
  ms: number;
  /** Whether a missed tick changes what the product believes, not just shows. */
  affectsCorrectness: boolean;
}): number {
  if (!interval.affectsCorrectness) return interval.ms;
  /* Clamped to something that cannot outlive the staleness window, whatever a
     caller passes. Belt and braces: the profile has no such field, and if one is
     ever added this stops it silently expiring somebody's presence. */
  return Math.min(interval.ms, Math.floor(STALE_AFTER_MS / 3));
}

/* ── Detection ────────────────────────────────────────────────────────────── */

export interface DeviceSignals {
  /** `navigator.hardwareConcurrency`. Absent on some browsers. */
  cores: number | null;
  /** `navigator.deviceMemory`, in GB. Chrome-family only, and coarse. */
  memoryGb: number | null;
  /** The OS accessibility preference, which is also a performance signal. */
  prefersReducedMotion: boolean;
  /** `navigator.connection.saveData`, where the browser reports it. */
  saveData: boolean;
}

/**
 * Read what the browser will tell us about the machine.
 *
 * Every field is optional because every field is optional in practice: Safari
 * reports no `deviceMemory`, Firefox no `connection`. A missing signal is
 * **unknown, never zero** — treating an absent core count as a slow machine
 * would put half of Safari into low mode on no evidence.
 */
export function readDeviceSignals(): DeviceSignals {
  if (typeof navigator === "undefined") {
    return {
      cores: null,
      memoryGb: null,
      prefersReducedMotion: false,
      saveData: false,
    };
  }
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return {
    cores:
      typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0
        ? nav.hardwareConcurrency
        : null,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    prefersReducedMotion:
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: nav.connection?.saveData === true,
  };
}

/**
 * Should low mode be SUGGESTED?
 *
 * Suggested, never imposed. These signals are coarse — `deviceMemory` is
 * bucketed and caps at 8 regardless of how much is fitted, and a core count says
 * nothing about the GPU, which is what actually struggles with the blur. Acting
 * on them unilaterally would downgrade capable machines on a guess.
 *
 * So the product offers, and the person decides. A dismissal is remembered.
 */
export function shouldSuggestLowMode(signals: DeviceSignals): boolean {
  /* An explicit accessibility preference is a decision somebody already made,
     and honouring it is not a guess. */
  if (signals.prefersReducedMotion) return true;
  if (signals.saveData) return true;
  /* Two cores is a genuinely small machine. Four is an ordinary office laptop
     and would sweep in far too much. */
  if (signals.cores !== null && signals.cores <= 2) return true;
  /* 4GB reported means 4GB or less — the API buckets downward. */
  if (signals.memoryGb !== null && signals.memoryGb <= 4) return true;
  return false;
}

/** One sentence saying WHY the suggestion appeared, so it is not a mystery. */
export function suggestionReason(signals: DeviceSignals): string | null {
  if (!shouldSuggestLowMode(signals)) return null;
  if (signals.prefersReducedMotion) {
    return "Your system is set to reduce motion.";
  }
  if (signals.saveData) return "Your browser is set to save data.";
  if (signals.cores !== null && signals.cores <= 2) {
    return `This machine reports ${signals.cores} processor core${signals.cores === 1 ? "" : "s"}.`;
  }
  if (signals.memoryGb !== null && signals.memoryGb <= 4) {
    return `This machine reports about ${signals.memoryGb}GB of memory.`;
  }
  return null;
}

/* ── Storage ──────────────────────────────────────────────────────────────── */

export const DEVICE_MODE_KEY = "cowork.deviceMode";
export const DEVICE_MODE_DISMISSED_KEY = "cowork.deviceMode.suggestionDismissed";

/** A stored value, or null where nothing valid is stored. */
export function readStoredMode(raw: string | null): DeviceMode | null {
  return raw === "high" || raw === "balanced" || raw === "low" ? raw : null;
}

/**
 * The attribute the stylesheet keys off.
 *
 * One attribute on `<html>` rather than a class per effect: the CSS can then
 * express "no blur anywhere" once, and a component that forgets to check the
 * mode still gets the saving.
 */
export function documentModeAttribute(mode: DeviceMode): string {
  return mode;
}
