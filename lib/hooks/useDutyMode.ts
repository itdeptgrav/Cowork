"use client";

import { useEffect, useState } from "react";
import { getRepository } from "@/lib/repositories";
import type { DutyMode } from "@/lib/rules/presence/duty";
import type { EmployeeId } from "@/lib/domain";

/**
 * Somebody's presence, live.
 *
 * **Replaces reading `cowork_duty_status` directly.** Not because the answer
 * differs any more — nothing expires a status, so the mode is the document's
 * own — but because every surface should ask one question of one place. The
 * ported `lib/legacy-ui/useDutyStatus.js` is left where it is; a screen reaching
 * into Firestore itself is a screen that will not notice when a presence rule
 * changes underneath it.
 *
 * `null` while the first read is in flight, and that null is load-bearing — see
 * `presenceRefusal`. Unknown is not away, and refusing during the attach window
 * would flash a refusal at everybody on every page load.
 *
 * Goes through the repository rather than Firestore so the demo tenant and the
 * legacy backend answer the same question the same way, and so a screen has one
 * fewer reason to know which backend it is talking to.
 */
export function useDutyMode(employeeId: EmployeeId | null): DutyMode | null {
  const [mode, setMode] = useState<DutyMode | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    let stopped = false;
    /* One id, one watcher. `watchDutyModes` takes a list because a manager's
       screen needs several at once; a single subscriber is the same machinery
       with one entry, rather than a second code path that could disagree with
       it. */
    const unsubscribe = getRepository().watchDutyModes([employeeId], (modes) => {
      if (stopped) return;
      setMode(modes.get(employeeId) ?? "offline");
    });
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [employeeId]);

  /* Derived rather than cleared in the effect: with no employee there is no
     presence to report, and that is null — the permissive "not known yet",
     which is the correct answer while the viewer is still resolving. */
  return employeeId ? mode : null;
}

/**
 * Presence for several people at once, for a roster.
 *
 * One subscription rather than one per row: a team of thirty rendered with a
 * per-row hook opens thirty listeners, and every one of them re-renders its row
 * on any change. The repository already takes a list for exactly this reason.
 *
 * `ids` is joined into the dependency rather than passed by reference, because
 * a caller computing it inline — `reports.map(p => p.id)` — hands over a new
 * array on every render, which would tear down and rebuild every listener each
 * time the page repainted.
 */
export function useDutyModes(ids: EmployeeId[]): Map<EmployeeId, DutyMode> {
  const [modes, setModes] = useState<Map<EmployeeId, DutyMode>>(new Map());
  const key = ids.join(",");

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const unsubscribe = getRepository().watchDutyModes(key.split(","), (next) => {
      if (!stopped) setModes(next);
    });
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [key]);

  return modes;
}

/**
 * The acting person's own presence.
 *
 * The common case by far — every task surface asks about the viewer, because
 * the gate is on doing your own work.
 */
export function useMyDutyMode(): DutyMode | null {
  const [id, setId] = useState<EmployeeId | null>(null);

  useEffect(() => {
    let stopped = false;
    void getRepository()
      .getViewer()
      .then((v) => {
        if (!stopped) setId(v.employeeId);
      })
      .catch(() => {
        /* Presence is an enhancement to a task screen, never the thing that
           takes it down. An unresolved viewer leaves the mode null, which is
           permissive — the repository still refuses the write. */
      });
    return () => {
      stopped = true;
    };
  }, []);

  return useDutyMode(id);
}
