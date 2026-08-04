"use client";

import { useMemo } from "react";
import { useQuery } from "@/lib/hooks/useRepository";
import { useLiveNow } from "@/lib/hooks/useLiveNow";
import { Icon } from "@/components/ui/Icons";
import { STATUS_META, type EmployeeStatus } from "@/lib/status/employeeStatus";
import { formatDuration, formatTimeOfDay } from "@/lib/utils/format";

/**
 * Today's status log — when this person went online, took a break, declared
 * an emergency, or went offline.
 *
 * `cowork_duty_status` remembers only the CURRENT mode; asking it "what did
 * my day look like" gets one answer regardless of how many times it changed.
 * `listDutyHistory` is the append-only trail behind it, one entry per
 * transition, and this is simply that list read back — newest first, the
 * same order a person thinks about "what did I just do".
 */
export function StatusHistoryModal({ onClose }: { onClose: () => void }) {
  const nowMs = useLiveNow();
  const history = useQuery((r) => r.listDutyHistory(), []);
  /* `history.data ?? []` is a fresh array every render while loading, which
     would make `rows` below recompute on every tick of `nowMs` for no reason
     — memoised on the one thing that actually identifies it. */
  const entries = useMemo(() => history.data ?? [], [history.data]);

  /* Each entry only stamps when a mode BEGAN. The length of that mode is the
     gap to the next (more recent) entry — or, for the most recent one, the
     gap to right now, since that mode is still running. */
  const rows = useMemo(
    () =>
      entries.map((entry, i) => ({
        entry,
        untilMs: i === 0 ? nowMs : entries[i - 1].at,
      })),
    [entries, nowMs],
  );

  return (
    <div
      className="fixed inset-0 z-[98] flex items-start justify-center bg-black/50 px-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="frost-panel flex w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] shadow-[0_28px_72px_rgba(0,0,0,0.45)]"
        style={{ maxHeight: "min(76vh, 640px)" }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-4 px-6 py-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/8 dark:bg-white/10">
            <Icon.history className="h-5 w-5 text-ink-muted" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
              Status history
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              {history.isLoading
                ? "Reading today's changes…"
                : entries.length === 0
                  ? "No status changes today"
                  : `${entries.length} change${entries.length !== 1 ? "s" : ""} today`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-black/8 hover:text-ink dark:hover:bg-white/10"
          >
            <Icon.close className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 border-t border-black/8 dark:border-white/8" />

        {/* ── The log ────────────────────────────────────────────── */}
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
          {history.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-faint border-t-ink-muted" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Icon.history className="h-8 w-8 text-ink-faint opacity-40" />
              <p className="text-[13px] text-ink-faint">
                Nothing recorded yet today.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-black/6 dark:divide-white/6">
              {rows.map(({ entry, untilMs }) => {
                const meta = STATUS_META[entry.mode as EmployeeStatus];
                const isCurrent = untilMs === nowMs && entry === entries[0];
                return (
                  <li key={entry.id} className="flex items-start gap-3 px-6 py-3">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: meta.dot }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-ink">
                        <span>{meta.label}</span>
                        <span data-figure className="text-[11px] font-normal text-ink-faint">
                          {formatTimeOfDay(entry.at)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {isCurrent ? "Ongoing — " : ""}
                        {formatDuration(
                          Math.max(0, Math.round((untilMs - entry.at) / 1000)),
                        )}
                        {entry.reason ? ` · ${entry.reason}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
