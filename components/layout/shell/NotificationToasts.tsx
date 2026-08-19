"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addToast,
  dismissToast,
  toastFrom,
  type Toast,
} from "@/lib/rules/notifications/toastStack";

/**
 * The pop-ups that appear while the app is open.
 *
 * **The missing half of a system that was otherwise complete.** The engine
 * writes every notification to the record and pushes it to the browser;
 * `useCoworkNotifications` deliberately suppresses the browser's own pop-up
 * while the tab is focused — a system notification over the app you are
 * already looking at is worse than useless — and dispatches a
 * `cowork:notification` event instead. Nothing listened to it, so a person
 * working in the app was the one person who never saw their notifications.
 *
 * Mounted once in the shell, so it covers every page rather than each screen
 * remembering to show its own.
 *
 * **It never blocks anything.** No overlay, no focus trap, no confirmation:
 * these report something that has already happened, and a pop-up you must
 * dismiss before carrying on would punish the reader for being told.
 */
export function NotificationToasts() {
  const [stack, setStack] = useState<Toast[]>([]);

  const drop = useCallback((id: string) => {
    setStack((s) => dismissToast(s, id));
  }, []);

  useEffect(() => {
    const onNotification = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const toast = toastFrom(detail);
      if (!toast) return;
      setStack((s) => addToast(s, toast));
      window.setTimeout(() => drop(toast.id), toast.ms);
    };
    window.addEventListener("cowork:notification", onNotification);
    return () => window.removeEventListener("cowork:notification", onNotification);
  }, [drop]);

  if (stack.length === 0) return null;

  return (
    <div
      /* `polite` rather than `assertive`: these are reports, not warnings that
         need to interrupt what somebody is typing. */
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[300] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {stack.map((toast) => (
        <article
          key={toast.id}
          className={`frost-panel pointer-events-auto rounded-2xl border p-3 shadow-[var(--deck-seat)] ${
            toast.tone === "warn"
              ? "border-[var(--state-overdue-ink)]"
              : toast.tone === "good"
                ? "border-[var(--state-positive-ink)]"
                : "border-hairline"
          }`}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p
                className={`text-[13px] font-semibold leading-snug ${
                  toast.tone === "warn"
                    ? "text-[var(--state-overdue-ink)]"
                    : toast.tone === "good"
                      ? "text-[var(--state-positive-ink)]"
                      : "text-ink"
                }`}
              >
                {toast.title}
              </p>
              {toast.body && (
                <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">
                  {toast.body}
                </p>
              )}
              {toast.url && (
                <a
                  href={toast.url}
                  onClick={() => drop(toast.id)}
                  className="mt-1.5 inline-block text-[12px] font-medium text-[var(--accent)] underline decoration-dotted underline-offset-2"
                >
                  Open
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={() => drop(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded-full px-1.5 text-[14px] leading-none text-ink-faint transition-colors hover:text-ink"
            >
              ×
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export default NotificationToasts;
