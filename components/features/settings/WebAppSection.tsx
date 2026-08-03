"use client";

/**
 * Settings → Web App.
 *
 * Everything on this panel reports the ACTUAL state of the installed
 * application rather than a claim about it: the version the running service
 * worker answers with, the storage the browser says is in use, whether this
 * window is the installed app or a tab. Nothing is hard-coded and nothing is
 * inferred from the bundle, because the two can genuinely disagree — a worker
 * from a previous deploy stays in charge until it is replaced, and that is
 * exactly the situation somebody opens this panel to understand.
 *
 * Rows that a browser cannot answer say so instead of guessing. Safari has no
 * install prompt and Firefox reports no storage estimate; showing "not
 * supported" is information, showing a dead button is not.
 */

import { useCallback, useState } from "react";
import { Button, Panel } from "@/components/ui/Primitives";
import { usePwa } from "@/lib/hooks/usePwa";
import { usePushRegistration } from "@/lib/hooks/useFCMToken";
import { useViewerId } from "@/lib/hooks/usePermissions";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function Row({
  label,
  value,
  tone = "default",
  action,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "good" | "warn";
  action?: React.ReactNode;
}) {
  const colour =
    tone === "good"
      ? "text-[var(--state-positive-ink)]"
      : tone === "warn"
        ? "text-[var(--state-rework-ink)]"
        : "text-ink";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline py-2 first:border-t-0">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`text-xs ${colour}`}>{value}</span>
        {action}
      </span>
    </li>
  );
}

export function WebAppSection() {
  const pwa = usePwa();
  const viewerId = useViewerId();
  const push = usePushRegistration(viewerId ?? null);
  const [busy, setBusy] = useState<null | "cache" | "update">(null);
  const [cacheCleared, setCacheCleared] = useState(false);

  const onClearCache = useCallback(async () => {
    setBusy("cache");
    const ok = await pwa.clearCaches();
    setCacheCleared(ok);
    setBusy(null);
  }, [pwa]);

  const onCheck = useCallback(async () => {
    setBusy("update");
    await pwa.checkForUpdate();
    setBusy(null);
  }, [pwa]);

  const swLabel =
    pwa.serviceWorker === "active"
      ? "Running"
      : pwa.serviceWorker === "registering"
        ? "Starting…"
        : pwa.serviceWorker === "failed"
          ? "Failed to start"
          : "Not supported by this browser";

  const pushLabel =
    push.state === "on"
      ? "On"
      : push.state === "blocked"
        ? "Blocked in browser settings"
        : push.state === "unsupported"
          ? "Not supported by this browser"
          : push.state === "working"
            ? "Turning on…"
            : "Off";

  return (
    <Panel>
      <h2 className="text-sm font-medium text-ink">Web App</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Cowork can be installed like an ordinary application — its own window,
        its own icon, and notifications that arrive when it is closed. It keeps
        working well enough to tell you what is happening when the network does
        not.
      </p>

      <ul className="mt-3">
        <Row
          label="Installed"
          value={pwa.installed ? "Yes — running as an app" : "No — running in a browser tab"}
          tone={pwa.installed ? "good" : "default"}
          action={
            !pwa.installed && pwa.canInstall ? (
              <Button size="sm" onClick={() => void pwa.install()}>
                Install
              </Button>
            ) : null
          }
        />
        {!pwa.installed && !pwa.canInstall && (
          <Row
            label="Install"
            value={
              /* Safari never fires `beforeinstallprompt`; the route there is
                 the browser's own Share menu, and saying so is more use than
                 a button that cannot work. */
              "Use your browser's menu — Add to Home Screen, or Install app"
            }
          />
        )}
        <Row label="Version" value={pwa.version ?? "Unknown"} />
        <Row
          label="Update"
          value={
            pwa.updateReady
              ? "A new version is ready"
              : pwa.checking || busy === "update"
                ? "Checking…"
                : "Up to date"
          }
          tone={pwa.updateReady ? "warn" : "default"}
          action={
            pwa.updateReady ? (
              <Button size="sm" onClick={pwa.applyUpdate}>
                Update now
              </Button>
            ) : (
              <Button
                tone="ghost"
                size="sm"
                disabled={busy === "update" || pwa.serviceWorker !== "active"}
                onClick={() => void onCheck()}
              >
                Check
              </Button>
            )
          }
        />
        <Row
          label="Service worker"
          value={swLabel}
          tone={
            pwa.serviceWorker === "active"
              ? "good"
              : pwa.serviceWorker === "failed"
                ? "warn"
                : "default"
          }
        />
        <Row
          label="Connection"
          value={pwa.online ? "Online" : "Offline"}
          tone={pwa.online ? "good" : "warn"}
        />
        <Row
          label="Notifications"
          value={pushLabel}
          tone={push.state === "on" ? "good" : push.state === "blocked" ? "warn" : "default"}
          action={
            push.state === "on" || push.state === "unsupported" ? null : (
              <Button
                size="sm"
                disabled={push.state === "working" || push.state === "blocked"}
                onClick={push.enable}
              >
                Turn on
              </Button>
            )
          }
        />
        {push.detail && push.state !== "on" && (
          <Row label="" value={<span className="text-ink-faint">{push.detail}</span>} />
        )}
        <Row
          label="Storage used"
          value={
            pwa.storage
              ? `${formatBytes(pwa.storage.usage)} of ${formatBytes(pwa.storage.quota)}`
              : "Not reported by this browser"
          }
        />
        <Row
          label="Cached files"
          value={cacheCleared ? "Cleared" : "Held for offline use"}
          action={
            <Button
              tone="ghost"
              size="sm"
              disabled={busy === "cache" || pwa.serviceWorker !== "active"}
              onClick={() => void onClearCache()}
            >
              {busy === "cache" ? "Clearing…" : "Clear"}
            </Button>
          }
        />
      </ul>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
        <span className="text-[11px] text-ink-faint">
          Clearing removes only cached files. Nothing you have saved is stored
          on this device, so nothing here can lose work.
        </span>
        <Button tone="ghost" size="sm" onClick={pwa.reload}>
          Reload app
        </Button>
      </div>
    </Panel>
  );
}
