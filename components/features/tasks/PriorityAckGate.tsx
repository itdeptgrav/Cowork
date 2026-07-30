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
 *  · Legacy wrote the acknowledgement client-side into a history array. Here it
 *    goes through the repository like every other mutation.
 *  · Legacy notified only the manager. The affected person now gets a
 *    notification too, so this modal is a confirmation rather than the first
 *    they hear of it.
 *  · Legacy's modal appeared only if the person happened to open the tasks
 *    page. This lives in the shell, so it appears wherever they are.
 */
export function PriorityAckGate() {
  const { uiPollMs } = usePerformanceProfile();
  const [pending, setPending] = useState<PriorityCascade | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Every state write happens in an async callback, never synchronously in
    // the effect body.
    async function poll() {
      const list = await getRepository().listPendingAcknowledgements(
        (await getRepository().getViewer()).employeeId,
      );
      if (!cancelled) setPending(list[0] ?? null);
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

      <div className="frost-panel relative w-[min(520px,96vw)] rounded-panel px-6 py-5">
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
