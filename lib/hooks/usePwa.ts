"use client";

/**
 * The app's own view of itself as an installable, updatable web app.
 *
 * Everything the Settings screen reports comes from here rather than from
 * components reaching into `navigator.serviceWorker` and `caches` directly —
 * the worker's cache naming, its message protocol and the install-prompt
 * lifecycle each have exactly one caller.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `beforeinstallprompt`, which is not in the DOM lib because it is not
 * standardised. Chromium fires it; Safari and Firefox never do, which is why
 * `canInstall` stays false there rather than offering a button that does
 * nothing.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PwaState {
  /** A worker is registered and controlling this page. */
  serviceWorker: "unsupported" | "registering" | "active" | "failed";
  /** The version the ACTIVE worker reports, not the one in this bundle. */
  version: string | null;
  /** A new worker is installed and waiting to take over. */
  updateReady: boolean;
  /** Checking for one right now. */
  checking: boolean;
  /** Running from the home screen / app window rather than a browser tab. */
  installed: boolean;
  /** The browser has offered an install prompt we can raise. */
  canInstall: boolean;
  online: boolean;
  /** Bytes used and available, where the browser reports them. */
  storage: { usage: number; quota: number } | null;
}

/** Ask the active worker something and wait for its reply. */
async function ask<T>(
  registration: ServiceWorkerRegistration | null,
  message: Record<string, unknown>,
): Promise<T | null> {
  const worker = registration?.active;
  if (!worker) return null;
  return new Promise<T | null>((resolve) => {
    const channel = new MessageChannel();
    /* A worker that never replies must not leave this pending forever — the
       Settings screen would show a spinner with nothing behind it. */
    const timer = setTimeout(() => resolve(null), 3_000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data as T);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  /* Two mechanisms, because iOS predates the standard one and still uses its
     own `navigator.standalone`. */
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function usePwa(): PwaState & {
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
  checkForUpdate: () => Promise<void>;
  applyUpdate: () => void;
  clearCaches: () => Promise<boolean>;
  reload: () => void;
} {
  const [state, setState] = useState<PwaState>({
    serviceWorker: "registering",
    version: null,
    updateReady: false,
    checking: false,
    installed: false,
    canInstall: false,
    online: true,
    storage: null,
  });

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const promptRef = useRef<InstallPromptEvent | null>(null);

  /* ── Registration, version, update watch ───────────────────────────────── */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) {
      setState((s) => ({ ...s, serviceWorker: "unsupported" }));
      return;
    }

    let cancelled = false;

    const watch = (registration: ServiceWorkerRegistration) => {
      registrationRef.current = registration;

      const settle = async () => {
        if (cancelled) return;
        const reply = await ask<{ version: string }>(registration, {
          type: "GET_VERSION",
        });
        if (cancelled) return;
        setState((s) => ({
          ...s,
          serviceWorker: registration.active ? "active" : "registering",
          version: reply?.version ?? s.version,
          /* `waiting` is a worker that installed while the old one was still
             controlling pages — precisely "an update is ready". */
          updateReady: Boolean(registration.waiting),
        }));
      };

      void settle();

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (cancelled) return;
          /* `installed` with a controller present means an update is waiting.
             Without a controller it is the FIRST install, which is not an
             update and must not be announced as one. */
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setState((s) => ({ ...s, updateReady: true }));
          }
          void settle();
        });
      });
    };

    navigator.serviceWorker
      .register("/firebase-messaging-sw.js", { scope: "/" })
      .then((registration) => {
        if (!cancelled) watch(registration);
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, serviceWorker: "failed" }));
      });

    /* The new worker calling `skipWaiting` swaps the controller under us. The
       page must reload to be driven by it, and doing that here — once — is what
       makes "Update" a single press rather than "update, then refresh". */
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  /* ── Install prompt, standalone, online, storage ───────────────────────── */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onPrompt = (e: Event) => {
      /* Chromium shows its own mini-infobar unless this is prevented; keeping
         the event lets Settings offer install at a moment the person chose. */
      e.preventDefault();
      promptRef.current = e as InstallPromptEvent;
      setState((s) => ({ ...s, canInstall: true }));
    };
    const onInstalled = () => {
      promptRef.current = null;
      setState((s) => ({ ...s, canInstall: false, installed: true }));
    };
    const onOnline = () => setState((s) => ({ ...s, online: true }));
    const onOffline = () => setState((s) => ({ ...s, online: false }));

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    setState((s) => ({
      ...s,
      installed: isStandalone(),
      online: navigator.onLine,
    }));

    void navigator.storage?.estimate?.().then((est) => {
      if (typeof est.usage === "number" && typeof est.quota === "number") {
        setState((s) => ({
          ...s,
          storage: { usage: est.usage as number, quota: est.quota as number },
        }));
      }
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const install = useCallback(async () => {
    const prompt = promptRef.current;
    if (!prompt) return "unavailable" as const;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    /* Single use: the event cannot be prompted twice, and keeping it would
       leave a button that silently does nothing on the second press. */
    promptRef.current = null;
    setState((s) => ({ ...s, canInstall: false }));
    return outcome;
  }, []);

  const checkForUpdate = useCallback(async () => {
    const registration = registrationRef.current;
    if (!registration) return;
    setState((s) => ({ ...s, checking: true }));
    try {
      await registration.update();
      setState((s) => ({ ...s, updateReady: Boolean(registration.waiting) }));
    } catch {
      /* Offline, or the worker script could not be fetched. Neither is worth
         an error state on a screen whose other rows still mean something. */
    } finally {
      setState((s) => ({ ...s, checking: false }));
    }
  }, []);

  const applyUpdate = useCallback(() => {
    const waiting = registrationRef.current?.waiting;
    if (!waiting) return;
    /* `controllerchange` above reloads once this takes effect. */
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, []);

  const clearCaches = useCallback(async () => {
    const reply = await ask<{ cleared: boolean }>(registrationRef.current, {
      type: "CLEAR_CACHES",
    });
    if (reply?.cleared) {
      const est = await navigator.storage?.estimate?.().catch(() => null);
      if (est && typeof est.usage === "number" && typeof est.quota === "number") {
        setState((s) => ({
          ...s,
          storage: { usage: est.usage as number, quota: est.quota as number },
        }));
      }
    }
    return Boolean(reply?.cleared);
  }, []);

  const reload = useCallback(() => window.location.reload(), []);

  return { ...state, install, checkForUpdate, applyUpdate, clearCaches, reload };
}
