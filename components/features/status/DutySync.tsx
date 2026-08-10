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
import {
  CLAIM_UNPROVEN_AFTER_MS,
  HEARTBEAT_INTERVAL_MS,
} from "@/lib/rules/presence/duty";
import {
  applyRemotePresence,
  claimLapsed,
  getSnapshot,
} from "@/lib/status/employeeStatus";
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

/**
 * How often the watchdog asks whether this device can still prove it is here.
 *
 * Arithmetic over two numbers already in memory — it writes nothing and reads
 * nothing — so it runs several times per beat rather than once, and the moment
 * a claim becomes unprovable is noticed within a third of a heartbeat instead of
 * a whole one.
 */
const WATCHDOG_INTERVAL_MS = Math.floor(HEARTBEAT_INTERVAL_MS / 3);

export function DutySync() {
  const { status, session, reconnecting } = useEmployeeStatus();
  const viewerId = useViewerId();
  /* What we last successfully published. Prevents a re-render from reissuing a
     write that has not changed anything — presence changes rarely and renders
     happen constantly. */
  const published = useRef<DutyMode | null>(null);
  /* The lapse instant this device has already written the tidy-up for. The
     watcher re-emits on its own sweep, and the same expired claim would
     otherwise be corrected once a minute until the write landed. */
  const committedLapse = useRef<number | null>(null);

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

      /**
       * **Write the lapse the staleness window only ever implied.**
       *
       * Everything above resolves an expired claim to offline on the way past,
       * and until now that was the whole mechanism: the document went on saying
       * `mode: "online"` for ever, because expiry is the ABSENCE of a write and
       * a browser that was closed does not get to write a farewell. So the day's
       * trail showed a session still running, and the old application — which
       * reads `mode` verbatim, with no window — showed a green dot for somebody
       * whose laptop shut days ago.
       *
       * The person's own device closes it when it next opens. It is entitled to:
       * `ownsClaim` hands an expired claim to whoever asks, precisely because
       * the connection that made it is gone. Nobody ELSE's device does this —
       * `setDutyMode` writes only the acting employee's own document — so a
       * claim whose owner never returns is still left to the staleness window,
       * which every reader here applies. Closing that last case needs something
       * that runs without a browser, and there is no such thing in this product
       * yet.
       */
      if (
        snapshot.lapsedAtMs !== null &&
        committedLapse.current !== snapshot.lapsedAtMs
      ) {
        const lapsedAtMs = snapshot.lapsedAtMs;
        committedLapse.current = lapsedAtMs;
        console.info("[presence] EXPIRED CLAIM tidied up:", {
          employeeId: viewerId,
          lapsedAt: new Date(lapsedAtMs).toISOString(),
        });
        void getRepository()
          .setDutyMode({
            mode: "offline",
            connectionId: connectionId(),
            lapsedAtMs,
          })
          .catch((error) => {
            /* Left for the next emission rather than swallowed: the document is
               still wrong, and the sweep will offer it again. */
            committedLapse.current = null;
            console.error("[duty] could not close an expired claim:", error);
          });
      }
    }, viewerId);
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

  /* ── Heartbeat, and the watchdog over it ────────────────────────────────── */
  /**
   * **A claim this device cannot prove is one it stops making.**
   *
   * The beat was fire-and-forget: its failure was logged and nothing followed
   * from it. Combined with online being a CHOICE rather than a consequence of a
   * live share, that left the one device that could act on the truth as the only
   * one not told it — a laptop whose wifi died, whose token expired, or whose
   * writes were being refused kept a green pill up indefinitely, while everybody
   * else's screen went grey ten minutes later. "The system should notice I have
   * dropped off" is exactly this, and it is measured here rather than guessed
   * from `navigator.onLine`: a write the server acknowledged is proof, and a
   * link-state flag is a rumour about one network interface.
   */
  useEffect(() => {
    if (!viewerId || status !== "online") return;

    /* The transition that put this person online wrote its own heartbeat, so the
       claim begins proven. Measuring from zero would demote everybody three
       beats after they arrived. */
    let lastAck = Date.now();

    const beat = () => {
      void getRepository()
        .heartbeatDuty(connectionId())
        .then((result) => {
          /* Only a beat that was WRITTEN counts. `heartbeatDuty` answers false
             in the two cases that both mean this device is no longer the live
             one — the claim belongs to another connection, or it has already
             expired — and reading either as proof of life is how a device goes
             on asserting a session it has lost. */
          if (result.ok && result.data) lastAck = Date.now();
        })
        .catch((error) => console.error("[duty] heartbeat failed:", error));
    };

    /* Immediately, then on the interval. The first beat matters most: it is
       what converts a claim written a moment ago into one a reader will still
       believe, and waiting a full interval for it would leave a fresh session
       looking stale to anybody who read it in between. */
    beat();
    const id = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    const watchdog = setInterval(() => {
      const quietForMs = Date.now() - lastAck;
      if (quietForMs <= CLAIM_UNPROVEN_AFTER_MS) return;
      /**
       * Re-armed rather than left tripped, and BEFORE anything is decided.
       *
       * Standing a claim down does not always end the session this effect is
       * watching: a device kept online by a live share, or by the same account
       * being online on another device, is still online afterwards — so nothing
       * tears this down, and a tripped watchdog would fire every fifteen seconds
       * for as long as that lasted. Re-arming makes it ask again a full window
       * later instead, which is also what lets a connection that comes back get
       * a fresh hearing.
       */
      lastAck = Date.now();
      /* Read live rather than from the render closure: `claimLapsed` changes
         `manual` without necessarily changing `status`, so the captured value
         goes stale exactly when it matters. A device that never held the claim —
         the phone mirroring an account its laptop is keeping alive — has nothing
         to stand down and says nothing about it. */
      if (getSnapshot().manual !== "online") return;
      console.info("[presence] CLAIM UNPROVEN — standing down:", {
        employeeId: viewerId,
        quietForMs,
        allowedMs: CLAIM_UNPROVEN_AFTER_MS,
      });
      /* Drops this device to offline and, through the publish effect above,
         writes it — a write that queues while the connection is down and lands
         the moment it returns. `claimLapsed` leaves a break, an emergency and a
         live share alone; see the store. */
      claimLapsed();
    }, WATCHDOG_INTERVAL_MS);

    /* A backgrounded tab has its timers clamped — this application is
       sometimes deliberately run that way — so returning to it beats
       immediately rather than waiting out a clamped interval. The staleness
       window already tolerates two missed beats; this shortens the recovery
       rather than being the thing that prevents the problem. The same for the
       browser reporting the network back: the first beat after it is what saves
       a session the watchdog is otherwise seconds from standing down. */
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", beat);

    return () => {
      clearInterval(id);
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", beat);
    };
  }, [status, viewerId]);

  return null;
}
