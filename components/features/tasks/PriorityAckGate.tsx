"use client";

import { usePerformanceProfile } from "@/components/layout/shell/DeviceModeContext";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getRepository } from "@/lib/repositories";
import type { PriorityCascade } from "@/lib/domain";
import { Button, Chip } from "@/components/ui/Primitives";
import {
  formatDateTime,
  formatDurationTimer,
} from "@/lib/utils/format";

/**
 * Blocking acknowledgement for deadlines that moved because a higher-priority
 * task took precedence.
 *
 * Non-dismissable by design: no cancel, no backdrop click, no escape. The
 * legacy system established this and it is the right call — a person whose
 * commitments silently changed must see that they changed. What legacy got
 * wrong, and this fixes:
 *
 *  · Legacy wrote the acknowledgement client-side into a history array. It still
 *    lands in the same field — `cowork_tasks.deadlineAutoExtendedHistory[]`, the
 *    one the engine writes and the old app reads — but through the repository
 *    like every other mutation, so the old modal and this one clear each other.
 *  · Legacy's modal appeared only if the person happened to open the tasks
 *    page. This lives in the shell, so it appears wherever they are.
 *
 * **No notification is emitted.** This comment used to claim the affected person
 * also receives one; nothing on the production stack sends it — the engine's
 * `/priority-order` route only renumbers ranks. The mock does emit one, so the
 * two repositories genuinely differ, and stating otherwise here made a false
 * promise about the one case that matters: somebody who is not looking at the
 * app. This modal is what they get, and it waits for them.
 */
export function PriorityAckGate() {
  const { uiPollMs } = usePerformanceProfile();
  const [pending, setPending] = useState<PriorityCascade | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* Whether the current run of failures has already been reported. Logging
       every tick would bury the first, real one under a hundred copies of
       itself; logging none at all hides an engine that has been unreachable
       for an hour. So: once when it breaks, once more when it breaks again
       after recovering. */
    let reported = false;
    // Every state write happens in an async callback, never synchronously in
    // the effect body.
    async function poll() {
      /**
       * **A failed poll must not become an unhandled rejection.**
       *
       * `getViewer()` throws when the directory cannot be read — an engine
       * restart is enough, and that is exactly when this fires. Nothing here
       * caught it: neither `void poll()` nor the `setInterval` above has a
       * rejection handler, so every tick threw into the void. The reported
       * symptom was the same stack printed over and over as
       * `unhandledRejection`, on a timer, drowning whatever else the console
       * had to say — including the first occurrence, which is the one that
       * explains the cause.
       *
       * Swallowed rather than surfaced because of what this poll IS: a
       * background check for a banner that may not even be due. It authorises
       * nothing and blocks nothing. The acknowledgement write itself is a
       * separate action with its own error handling and is untouched, and the
       * next tick retries — so a transient outage costs a late banner rather
       * than a dead one.
       */
      try {
        const list = await getRepository().listPendingAcknowledgements(
          (await getRepository().getViewer()).employeeId,
        );
        if (!cancelled) setPending(list[0] ?? null);
        reported = false;
      } catch (error) {
        if (!reported) {
          reported = true;
          console.warn(
            "[priority] pending acknowledgements could not be read; still trying.",
            error,
          );
        }
      }
    }
    // The prototype has no socket; a short interval stands in for the push
    // that would deliver this in production.
    /* A UI poll standing in for a push that does not exist yet — so slowing it
       delays a banner, never a decision. The acknowledgement itself is a write
       and is unaffected. */
    const id = setInterval(poll, uiPollMs);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [uiPollMs]);

  // Portals need a document. Checked directly rather than via a mount effect,
  // which would be another synchronous state write.
  if (typeof document === "undefined" || !pending) return null;

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    await getRepository().acknowledgeCascade(pending.id, null);
    setPending(null);
    setBusy(false);
  }

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ack-title"
      className="fixed inset-0 z-[100] grid place-items-center p-4"
    >
      {/* No onClick — this cannot be dismissed by clicking outside. */}
      <div className="absolute inset-0 bg-[var(--body-bg)]/70 backdrop-blur-[6px]" />

      {/* Bounded, because it now lists the whole queue: a person with fifteen
          tasks would otherwise get a modal taller than the window, with the only
          button on it below the fold and no way to scroll to it. */}
      <div className="frost-panel relative max-h-[88vh] w-[min(560px,96vw)] overflow-y-auto overscroll-contain rounded-panel px-6 py-5">
        <p className="text-[11px] font-medium tracking-[0.09em] text-ink-muted uppercase">
          Acknowledgement required
        </p>
        <h2
          id="ack-title"
          className="mt-2 text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
        >
          {/* A reorder by somebody else raises this even when nothing moved,
              so the heading cannot assume a deadline did. */}
          {pending.effects.length === 0
            ? "Your priorities were changed"
            : pending.effects.length === 1
              ? "A deadline moved"
              : `${pending.effects.length} deadlines moved`}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {pending.changedByName} raised{" "}
          <span className="text-ink">“{pending.triggeringTaskTitle}”</span>{" "}
          above your other work.{" "}
          {pending.effects.length === 0
            ? "No deadline moved — the order you work through them did."
            : "The time it needs has been pushed into the tasks below — work you have already logged is credited, and no deadline moved earlier."}
        </p>

        <div className="mt-4 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
          <p className="text-xs text-ink-faint">Reason given</p>
          <p className="mt-1 text-sm text-ink">{pending.reason}</p>
        </div>

        {/* THE ORDER, before and after.
            The list below it names only the tasks whose deadline moved, which is
            the right answer to "what did this cost me" and the wrong one to
            "what am I doing next" — a reorder can change the whole sequence and
            move no date at all. Both questions get asked, so both are answered.

            Absent on a record written before the orders were carried, in which
            case the effects list stands alone rather than an empty table. */}
        {(pending.newOrder?.length ?? 0) > 0 && (
          <div className="mt-4">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Your order now
            </p>
            <ol className="mt-1.5 divide-y divide-hairline">
              {(pending.newOrder ?? []).map((row) => {
                const was =
                  (pending.previousOrder ?? []).find((p) => p.taskId === row.taskId) ?? null;
                const moved = was !== null && was.rank !== row.rank;
                return (
                  <li
                    key={row.taskId}
                    className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-1.5"
                  >
                    <span data-figure className="w-7 shrink-0 text-[11px] text-ink">
                      P{row.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {row.taskTitle}
                    </span>
                    {moved && (
                      <Chip tone="neutral">
                        was P{was!.rank}
                      </Chip>
                    )}
                    <span className="text-[11px] text-ink-faint">
                      {row.dueAt ? formatDateTime(row.dueAt) : "No date"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <ul className="mt-4 divide-y divide-hairline empty:mt-0">
          {pending.effects.map((e) => (
            <li
              key={e.taskId}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {e.taskTitle}
              </span>
              <Chip tone="neutral">
                P{e.previousRank} → P{e.newRank}
              </Chip>
              <span className="text-xs text-ink-faint">
                <span className="line-through opacity-70">
                  {formatDateTime(e.previousDueAt)}
                </span>
                {" → "}
                <span className="text-ink">{formatDateTime(e.newDueAt)}</span>
              </span>
              {e.creditedWorkedSecs > 0 && (
                <span className="text-xs text-ink-faint">
                  {formatDurationTimer(e.creditedWorkedSecs)} credited
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end">
          <Button tone="primary" onClick={confirm} disabled={busy}>
            {busy ? "Confirming…" : "I understand"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
