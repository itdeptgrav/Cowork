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
 *
 * ## Two modes, and why not four
 *
 * There were four: a top mode identical to the default, and a middle one that
 * imitated the default's picture with cheaper technique. Both were answers to a
 * question nobody was asking. The top mode differed from the default in nothing
 * a reader could point at, so choosing it was a placebo; the middle one asked
 * somebody to reason about the difference between an effect and a picture of
 * that effect before they could pick a setting.
 *
 * What is left is the only choice that was ever real, and the two names say
 * which way it runs:
 *
 *  · **Rich** — the interface as designed. Frosted surfaces, the drifting
 *    field, motion, charts, a timer counting by the second.
 *  · **Plain** — the same product with the drawing taken out of it. Flat
 *    surfaces, no blur, no motion, fewer redraws, shorter pages of rows.
 *
 * Plain is an honest surrender of the look, not a cheaper imitation of it: the
 * field exists so the frosted surfaces have something to look through, so when
 * the blur goes the field goes with it. What Plain may NOT surrender is anything
 * above — the refusals apply to it exactly as they apply to Rich.
 */

export type DeviceMode = "rich" | "plain";

export const DEVICE_MODES: {
  id: DeviceMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "rich",
    label: "Rich",
    hint: "The default. The interface as designed — frosted surfaces, the drifting background, animation and charts.",
  },
  {
    id: "plain",
    label: "Plain",
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
  /**
   * Whether the background field is drawn.
   *
   *  · `animated` — ten composited layers, blurred and drifting. The only thing
   *    in the product that costs anything AT REST.
   *  · `none` — not rendered. Coherent rather than merely cheaper: the field
   *    exists so the frost has something to look through, and Plain has no
   *    frost for it to sit behind.
   */
  backdropField: "animated" | "none";
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

const RICH: PerformanceProfile = {
  animations: true,
  blur: true,
  backdropField: "animated",
  decorativeShadows: true,
  timerTickMs: 1_000,
  uiPollMs: 2_500,
  listChunkSize: 50,
  richCharts: true,
  livePreview: true,
  previewFps: 30,
};

const PLAIN: PerformanceProfile = {
  animations: false,
  blur: false,
  backdropField: "none",
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
    case "plain":
      return PLAIN;
    case "rich":
    default:
      return RICH;
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
 * would put half of Safari into plain mode on no evidence.
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
 * Should plain mode be SUGGESTED?
 *
 * Suggested, never imposed. These signals are coarse — `deviceMemory` is
 * bucketed and caps at 8 regardless of how much is fitted, and a core count says
 * nothing about the GPU, which is what actually struggles with the blur. Acting
 * on them unilaterally would downgrade capable machines on a guess.
 *
 * So the product offers, and the person decides. A dismissal is remembered.
 */
export function shouldSuggestPlainMode(signals: DeviceSignals): boolean {
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
  if (!shouldSuggestPlainMode(signals)) return null;
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

/**
 * A stored value, or null where nothing valid is stored.
 *
 * **The four old names still resolve**, because the value lives in somebody's
 * browser and shipping a rename does not reach into it. Dropping them would not
 * fail loudly — it would silently return null, and a person who had chosen the
 * lightest interface available would be handed the heaviest one on their next
 * load, on the machine that made them choose in the first place.
 *
 * The mapping runs by INTENT rather than by position: `high` and `balanced` were
 * the same picture, so both land on Rich. `lite` and `low` were both chosen by
 * somebody whose machine was struggling — `lite` kept the look, but the reason
 * for picking it was the cost — so both land on Plain.
 */
export function readStoredMode(raw: string | null): DeviceMode | null {
  switch (raw) {
    case "rich":
    case "plain":
      return raw;
    case "high":
    case "balanced":
      return "rich";
    case "lite":
    case "low":
      return "plain";
    default:
      return null;
  }
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
