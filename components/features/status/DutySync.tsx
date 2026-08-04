"use client";

import { useEffect, useRef } from "react";
import { useEmployeeStatus } from "./useEmployeeStatus";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { getRepository } from "@/lib/repositories";
import {
  connectionId,
  claimedOnlineHere,
  markClaimedOnlineHere,
  clearClaimedOnlineHere,
} from "@/lib/status/connectionId";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/rules/presence/duty";
import { restorePresence } from "@/lib/status/employeeStatus";
import type { EmployeeStatus } from "@/lib/status/employeeStatus";
import type { DutyMode } from "@/lib/rules/presence/duty";

/**
 * The presence store, written to the presence document.
 *
 * **This is the join that was missing.** `lib/status/employeeStatus.ts` derived
 * a correct, immediate presence from the LiveKit share and kept it in memory,
 * where nobody else could see it and a refresh erased it. Legacy kept
 * `cowork_duty_status` in Firestore, where everybody could see it and nothing
 * in the new workspace ever wrote it. Two presence systems, no connection
 * between them — the exact duplication a migration is supposed to avoid, and it
 * had already happened.
 *
 * That module's own note anticipated this component: *"it is also the seam a
 * backend sync will attach to later: subscribe and POST, without any component
 * knowing about it."* This is that seam. Nothing else changed; the store still
 * decides, and this only publishes what it decided.
 *
 * Renders nothing. Mounted once, beside the room.
 */

/** The two vocabularies are the same four words. See `duty.ts`. */
function dutyModeOf(status: EmployeeStatus): DutyMode {
  return status;
}

export function DutySync() {
  const { status, session, reconnecting } = useEmployeeStatus();
  const viewerId = useViewerId();
  /* What we last successfully published. Prevents a re-render from reissuing a
     write that has not changed anything — presence changes rarely and renders
     happen constantly. */
  const published = useRef<DutyMode | null>(null);

  /* ── Restore on load ────────────────────────────────────────────────────── */
  /* A refresh must not read as going offline. The in-memory store re-initialises
     to offline on every load, but the duty document survived — so on mount we
     read it back once and restore the status, which is also what makes the
     heartbeat below resume. Without this the claim goes stale after two missed
     beats and the person really does go offline a couple of minutes after a
     harmless refresh. */
  const restored = useRef(false);
  useEffect(() => {
    if (!viewerId || restored.current) return;
    restored.current = true;
    void (async () => {
      try {
        const mode = await getRepository().getDutyMode();
        console.info("[presence] SESSION RESTORE: fetched durable mode", {
          employeeId: viewerId,
          durableMode: mode,
        });
        /* `getDutyMode` has already applied the staleness window, so a genuinely
           dead claim comes back as offline and restores nothing.

           An `online` claim is restored ONLY on the device that put itself
           online — `claimedOnlineHere()`, a per-browser flag distinct from the
           per-tab `connectionId()`. Without this check, opening Cowork on a
           phone while a laptop is sharing reads the same "online" mode and
           offers a "resume sharing" prompt for a share that phone never had.
           break/emergency are NOT gated: they are claims about the person, not
           a device, so every device restores them identically. */
        if (mode === "break" || mode === "emergency") {
          restorePresence({ mode });
        } else if (mode === "online" && claimedOnlineHere()) {
          restorePresence({ mode });
        }
      } catch (error) {
        console.error("[presence] SESSION RESTORE failed:", error);
      }
    })();
  }, [viewerId]);

  /* ── Publish ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!viewerId) return;
    /* Mid-attempt is not a state to publish. `requesting` is the browser's own
       picker being open and `connecting` is the token fetch — publishing
       "offline" through either would flicker somebody's dot grey while they
       were in the middle of coming online, and a watching manager would see
       them leave and return for no reason. */
    if (session === "requesting" || session === "connecting") return;

    /* While reconnecting after a refresh, publish nothing. The person is not
       sharing, so we must not assert online — but we also must not actively write
       offline: leaving the durable claim untouched lets it either be renewed the
       moment they resume sharing (seamless, within the staleness window) or lapse
       on its own if they do not. Writing offline here would end their session the
       instant the page reloaded, which is the bug this whole path exists to
       avoid. */
    if (reconnecting) return;

    const mode = dutyModeOf(status);
    if (published.current === mode) return;

    console.info("[presence] PRESENCE UPDATE sending:", {
      employeeId: viewerId,
      requestedMode: mode,
      lastPublished: published.current,
      connectionId: connectionId(),
      timestamp: new Date().toISOString(),
    });

    let cancelled = false;
    void (async () => {
      try {
        const result = await getRepository().setDutyMode({
          mode,
          connectionId: connectionId(),
        });
        if (cancelled) return;
        console.info("[presence] PRESENCE UPDATE in force:", {
          requestedMode: mode,
          modeInForce: result.ok ? result.data : "(write failed)",
        });
        /* The repository answers with the mode actually in force, which is not
           always the one asked for: another tab may hold the online claim, and
           this tab is not entitled to clear it. Recording what it reported
           rather than what we sent stops us retrying a write that was correctly
           declined. */
        published.current = result.ok ? result.data : null;
        /* This device's own memory of whether IT is the one online — see
           connectionId.ts. Only touched when the write actually took hold:
           a decline (another device still owns the claim) must not overwrite
           what this device remembers about itself. */
        if (result.ok) {
          if (result.data === "online") markClaimedOnlineHere();
          else clearClaimedOnlineHere();
        }
      } catch (error) {
        /* Presence is not worth breaking a page over. The store is still
           correct locally, and the next change retries. */
        console.error("[duty] could not publish presence:", error);
        if (!cancelled) published.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, session, viewerId, reconnecting]);

  /* ── Heartbeat ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!viewerId || status !== "online") return;

    const beat = () => {
      void getRepository()
        .heartbeatDuty(connectionId())
        .catch((error) => console.error("[duty] heartbeat failed:", error));
    };

    /* Immediately, then on the interval. The first beat matters most: it is
       what converts a claim written a moment ago into one a reader will still
       believe, and waiting a full interval for it would leave a fresh session
       looking stale to anybody who read it in between. */
    beat();
    const id = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    /* A backgrounded tab has its timers clamped — this application is
       sometimes deliberately run that way — so returning to it beats
       immediately rather than waiting out a clamped interval. The staleness
       window already tolerates two missed beats; this shortens the recovery
       rather than being the thing that prevents the problem. */
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, viewerId]);

  return null;
}
