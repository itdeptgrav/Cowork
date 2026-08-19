/**
 * The stack of pop-ups that appear while the app is open.
 *
 * **A notification that arrives while you are looking at the screen should be
 * visible on the screen.** The engine already writes every notification to the
 * record and pushes it to the browser, and the browser's own pop-up is
 * suppressed while the tab is focused — correctly, because a system pop-up
 * over the app you are already using is worse than useless. What was missing
 * was the other half: something to show it inside the app instead.
 *
 * This file decides what the stack does. Drawing it is the component's job.
 */

export type ToastTone = "info" | "warn" | "good";

export interface Toast {
  /** Stable per notification — the engine's tag, so a repeat replaces rather than stacks. */
  id: string;
  title: string;
  body: string;
  /** The engine's notification type, e.g. `task_rework`. */
  type: string;
  /** Where clicking it should go, if anywhere. */
  url?: string;
  tone: ToastTone;
  /** How long it stays, in milliseconds. */
  ms: number;
}

/**
 * How many are shown at once.
 *
 * A submission can re-chain several tasks, so a burst is normal. Four stacked
 * pop-ups is a wall; the oldest is dropped rather than growing down the screen
 * past the fold where nobody sees it anyway.
 */
export const MAX_TOASTS = 3;

/** The default life of a pop-up. */
export const TOAST_MS = 6000;

/**
 * Longer for anything that COSTS the reader something.
 *
 * Six seconds is enough to notice a message; it is not enough to read "your
 * deadline moved to 17:59, was 18:19" and work out what to do about it.
 */
export const IMPORTANT_TOAST_MS = 12000;

/** Notification types that take something away, and so are given more time. */
const COSTLY = new Set([
  "deadline_moved_earlier",
  "task_rework",
  "completion_rejected",
  "task_overdue",
]);

const GOOD = new Set([
  "completion_approved",
  "completion_ceo_approved",
  "task_completed",
  "extension_granted",
]);

/** Which of the three tones a notification type reads as. */
export function toastToneFor(type: string): ToastTone {
  const t = String(type ?? "");
  if (COSTLY.has(t)) return "warn";
  if (GOOD.has(t)) return "good";
  return "info";
}

/** How long this type should stay on screen. */
export function toastMsFor(type: string): number {
  return COSTLY.has(String(type ?? "")) ? IMPORTANT_TOAST_MS : TOAST_MS;
}

/**
 * Build a toast from what the notification hook dispatches.
 *
 * Returns null for anything with no title — an untitled pop-up is a grey box
 * that tells the reader nothing and cannot be acted on.
 */
export function toastFrom(detail: {
  title?: unknown;
  body?: unknown;
  type?: unknown;
  url?: unknown;
  tag?: unknown;
}): Toast | null {
  const title = String(detail?.title ?? "").trim();
  if (!title) return null;
  const type = String(detail?.type ?? "");
  return {
    /* The engine's tag when there is one, so the same notification arriving
       twice replaces its own pop-up instead of stacking a duplicate. */
    id: String(detail?.tag ?? "") || `${type}:${title}`,
    title,
    body: String(detail?.body ?? "").trim(),
    type,
    url: detail?.url ? String(detail.url) : undefined,
    tone: toastToneFor(type),
    ms: toastMsFor(type),
  };
}

/**
 * Add one to the stack.
 *
 * A toast with an id already showing REPLACES it rather than appearing beside
 * it: the engine re-sends on retry, and two identical pop-ups reads as a bug
 * in the app rather than as one event.
 */
export function addToast(stack: readonly Toast[], next: Toast): Toast[] {
  const without = stack.filter((t) => t.id !== next.id);
  return [...without, next].slice(-MAX_TOASTS);
}

/** Remove one, by id. */
export function dismissToast(stack: readonly Toast[], id: string): Toast[] {
  return stack.filter((t) => t.id !== id);
}
