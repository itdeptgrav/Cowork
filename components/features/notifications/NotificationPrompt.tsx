"use client";

/**
 * The first-run ask: "turn on notifications?" — in the app, before the browser.
 *
 * ## Why the app asks first
 *
 * A browser honours a permission request that came from a click and quietly
 * ignores one that did not. Chrome's quieter-permissions behaviour suppresses
 * an automatic request on a low-engagement origin, `requestPermission()`
 * resolves to `default` with nothing shown, and the person is left never having
 * been asked while the app believes it asked and was refused. That is how a
 * device ends up permanently unreachable with nothing on screen to explain it.
 *
 * So this asks in our own words, and the browser's prompt follows the button.
 * It is also the more honest order: somebody is told what the permission is
 * for before a modal from the browser demands an answer about it.
 *
 * ## Shown once
 *
 * Once permission is granted the browser remembers it for this origin
 * permanently, `useFCMToken` re-registers silently on every sign-in, and this
 * never appears again. Declining is remembered too — in `localStorage`, because
 * `Notification.permission` stays `"default"` either way and cannot tell
 * "never asked" from "asked and said not now". Anybody who changes their mind
 * has the control on `/notifications`.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui/Primitives";
import { useViewerId } from "@/lib/hooks/usePermissions";
import {
  hasBeenAskedForPush,
  rememberAskedForPush,
  usePushRegistration,
} from "@/lib/hooks/useFCMToken";

export function NotificationPrompt() {
  const viewerId = useViewerId();
  const { state, enable } = usePushRegistration(viewerId ?? null);
  /**
   * Whether to render at all.
   *
   * Resolved in an effect rather than during render because it reads
   * `Notification.permission` and `localStorage`, neither of which exists on
   * the server. Starting at `false` means the banner appears after hydration
   * instead of flashing and being withdrawn.
   */
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!viewerId) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (!("serviceWorker" in navigator)) return;
    /* Already answered — by the browser, or by this person closing the banner. */
    if (Notification.permission !== "default") return;
    if (hasBeenAskedForPush()) return;
    setShow(true);
  }, [viewerId]);

  const dismiss = useCallback(() => {
    rememberAskedForPush();
    setShow(false);
  }, []);

  const accept = useCallback(() => {
    /* Remembered BEFORE the browser prompt, not after. If somebody closes that
       prompt without choosing, permission stays `default` and this would
       otherwise reappear on the next page — asking again about a dialog they
       just dismissed. */
    rememberAskedForPush();
    enable();
  }, [enable]);

  /* Once it succeeds, say nothing more and get out of the way. */
  useEffect(() => {
    if (state === "on" || state === "blocked") setShow(false);
  }, [state]);

  if (!show) return null;

  const working = state === "working";

  return (
    <Panel className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink">Turn on notifications?</p>
          <p className="mt-1 text-xs text-ink-muted">
            Be told when work is assigned to you, a deadline is decided, your
            score changes or somebody messages you — even when Cowork is not
            open. Your browser will ask you to confirm.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button tone="ghost" size="sm" onClick={dismiss} disabled={working}>
            Not now
          </Button>
          <Button tone="primary" size="sm" onClick={accept} disabled={working}>
            {working ? "Turning on…" : "Turn on"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
