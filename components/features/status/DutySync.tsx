"use client";

import { useEffect, useRef } from "react";
import { useEmployeeStatus } from "./useEmployeeStatus";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { getRepository } from "@/lib/repositories";
import {
  connectionId,
  markClaimedOnlineHere,
  clearClaimedOnlineHere,
} from "@/lib/status/connectionId";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/rules/presence/duty";
import { applyRemotePresence } from "@/lib/status/employeeStatus";
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
  const { status, session, reconnecting, hydrated } = useEmployeeStatus();
  const viewerId = useViewerId();
  /* What we last successfully published. Prevents a re-render from reissuing a
     write that has not changed anything — presence changes rarely and renders
     happen constantly. */
  const published = useRef<DutyMode | null>(null);

  /* ── Follow the account ─────────────────────────────────────────────────── */
  /**
   * **A live subscription, not a read at mount.** This is the whole of the
   * cross-device fix.
   *
   * It used to call `getDutyMode()` once, which was wrong in three ways at
   * once, and all three were visible:
   *
   *  · One shot. A change made on the laptop never reached the phone, so the
   *    second device kept showing whatever was true when it loaded.
   *  · One WORD. The mode came back without the instant behind it, so a device
   *    learning "break" started its own stopwatch from the moment it found out.
   *    Two devices on one account showed 13 seconds and 4 seconds.
   *  · Gated on `claimedOnlineHere()`. A phone opened while the laptop was
   *    sharing deliberately ignored the account's `online` claim and showed
   *    Offline.
   *
   * The gate is gone. It was protecting against offering a "resume sharing"
   * prompt for a share the phone never had — a real concern, but `remoteOnline`
   * answers it properly: the phone reports the account's presence, and
   * `sharedElsewhere` keeps the sentence honest about whose screen it is. What
   * the gate actually produced was one account showing two different presences
   * at the same moment, which is not a thing presence is allowed to do.
   */
  useEffect(() => {
    if (!viewerId) return;
    return getRepository().watchDutyStatus((snapshot) => {
      /* Whether the claim is THIS connection's. Only meaningful for `online`;
         `readDutySnapshot` returns null for every other mode. */
      const mine =
        snapshot.presenceConnectionId !== null &&
        snapshot.presenceConnectionId === connectionId();

      applyRemotePresence({
        mode: snapshot.mode,
        breakStartedAtMs: snapshot.breakStartedAtMs,
        emergencyStartedAtMs: snapshot.emergencyStartedAtMs,
        onlineElsewhere: snapshot.mode === "online" && !mine,
      });

      /* The echo guard. Publishing what we were just told would be a write per
         snapshot, and every device would answer every other device forever. */
      published.current = snapshot.mode;

      /* This device's own memory of whether IT is the one sharing, kept in step
         with the account rather than only with our own writes — a claim taken
         over by another device must stop this one believing it holds it. */
      if (snapshot.mode === "online" && mine) markClaimedOnlineHere();
      else if (snapshot.mode !== "online") clearClaimedOnlineHere();
    }, viewerId);
  }, [viewerId]);

  /* ── Publish ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!viewerId) return;
    /**
     * **Never publish a GUESS.** The store initialises to `offline`, and this
     * effect runs on mount — before the subscription above has heard anything,
     * because that is a Firestore round trip and this is not. So every page load
     * announced `offline` for a person who was online, and `ownsClaim` was the
     * only thing standing in front of it: the write was refused while the
     * previous tab's beat was recent, and ACCEPTED once it was not — a reload
     * after a couple of quiet minutes, or a second device opening. That is the
     * reported "it goes offline by itself", and it needed nobody to do anything
     * but open the app.
     *
     * `hydrated` is the store's own answer to exactly this — see its note there.
     * Until the account has been read, this device knows nothing and says
     * nothing.
     */
    if (!hydrated) return;
    /* Mid-attempt is not a state to publish. `requesting` is the browser's own
       picker being open and `connecting` is the token fetch — publishing
       "offline" through either would flicker somebody's dot grey while they
       were in the middle of coming online, and a watching manager would see
       them leave and return for no reason. */
    if (session === "requesting" || session === "connecting") return;

    /* While reconnecting after a refresh, publish nothing. The person is not
       sharing, so we must not assert online — and we must not write offline
       either: the durable claim is theirs, and leaving it untouched is what lets
       a resumed share pick straight up where it left off. Writing offline here
       would end their session the instant the page reloaded, which is the bug
       this whole path exists to avoid. */
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
  }, [status, session, viewerId, reconnecting, hydrated]);

  /* ── Heartbeat ──────────────────────────────────────────────────────────── */
  /**
   * **Nobody's status depends on this.** It stamps which connection is the live
   * one, so a reloaded tab can take its own claim back rather than two tabs
   * writing over each other — `ownsClaim`. A missed beat costs a person nothing:
   * no window expires a mode any more, and a beat that fails is logged and
   * forgotten rather than counted against them.
   */
  useEffect(() => {
    if (!viewerId || status !== "online") return;

    const beat = () => {
      void getRepository()
        .heartbeatDuty(connectionId())
        .catch((error) => console.error("[duty] heartbeat failed:", error));
    };

    /* Immediately, then on the interval — the first beat is what puts this
       connection's name on the claim, and waiting a full interval for it would
       leave a fresh session looking like somebody else's to a second tab. */
    beat();
    const id = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    /* A backgrounded tab has its timers clamped — this application is sometimes
       deliberately run that way — so returning to it beats immediately rather
       than waiting out a clamped interval, and so does the browser reporting the
       network back. Neither is load-bearing now; both keep the claim's owner
       current for the tab that might otherwise adopt it. */
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", beat);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", beat);
    };
  }, [status, viewerId]);

  return null;
}
