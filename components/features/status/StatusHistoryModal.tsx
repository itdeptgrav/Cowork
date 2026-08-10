"use client";

import { useMemo } from "react";
import { useQuery } from "@/lib/hooks/useRepository";
import { useLiveNow } from "@/lib/hooks/useLiveNow";
import { Icon } from "@/components/ui/Icons";
import { STATUS_META, type EmployeeStatus } from "@/lib/status/employeeStatus";
import { formatTimeOfDay } from "@/lib/utils/format";
import {
  hoursMinutes,
  onlineSecondsToday,
  spanRows,
  spanSeconds,
} from "@/lib/rules/presence/historyLog";

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

  /* The arithmetic lives in `lib/rules/presence/historyLog.ts`, where it can be
     tested at a fixed instant. This component reads the clock and draws. */
  const rows = useMemo(() => spanRows(entries, nowMs), [entries, nowMs]);
  const onlineSecs = useMemo(() => onlineSecondsToday(rows), [rows]);

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
              {/* Counts the STRETCHES shown, not the stored rows. Those differ
                  once repeats are merged, and a header saying "85 changes"
                  above a list of twenty is the kind of small lie that makes a
                  reader distrust the numbers underneath it. */}
              {history.isLoading
                ? "Reading today's changes…"
                : rows.length === 0
                  ? "No status changes today"
                  : `${rows.length} change${rows.length !== 1 ? "s" : ""} today`}
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

        {/* The day's headline figure, above the log that explains it. Only
            Online is totalled: it is the one people are counting, and a row of
            four totals would bury it among numbers nobody came for. */}
        {!history.isLoading && entries.length > 0 && (
          <div className="mx-6 mb-4 flex items-baseline justify-between gap-3 rounded-2xl bg-black/5 px-4 py-3 dark:bg-white/6">
            <span className="flex items-center gap-2 text-[12px] text-ink-muted">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_META.online.dot }}
              />
              Online today
            </span>
            <span
              data-figure
              className="text-[17px] leading-none font-medium tracking-[-0.01em] text-ink"
            >
              {hoursMinutes(onlineSecs)}
            </span>
          </div>
        )}

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
              {rows.map((span) => {
                const { entry, untilMs, ongoing } = span;
                /**
                 * **Online appears here like any other mode**, and for a while
                 * it did not — not because this list filtered it out, but
                 * because nothing ever published it: the session sat at
                 * `connecting` for the whole share and `DutySync` is silent in
                 * that state, so `setDutyMode("online")` was never called and no
                 * row was ever written. See `sessionLive` in `StatusButton`.
                 *
                 * The fallback is for a mode this build does not know — an older
                 * row, or one written by the legacy app. A missing entry in
                 * `STATUS_META` would otherwise throw while reading `.dot` and
                 * take the whole log down with it.
                 */
                const meta =
                  STATUS_META[entry.mode as EmployeeStatus] ??
                  ({
                    label: entry.mode,
                    dot: "var(--ink-faint)",
                  } as (typeof STATUS_META)[EmployeeStatus]);
                const secs = spanSeconds(span);
                return (
                  <li key={entry.id} className="flex items-start gap-3 px-6 py-3.5">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: meta.dot }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-ink">
                        <span>{meta.label}</span>
                        {ongoing && (
                          <span className="text-[11px] font-normal text-ink-faint">
                            Ongoing
                          </span>
                        )}
                      </p>
                      {/**
                       * **In, Out and Total, in three fixed columns.**
                       *
                       * It was one prose line — a start time on the right and a
                       * duration underneath — which meant the two clock readings
                       * that bound a stretch of work were never next to each
                       * other, and nothing lined up between rows. A day is read
                       * by scanning down a column, so the columns have to exist
                       * and hold their width whatever is in them.
                       *
                       * The running stretch has no out time. It says "Now"
                       * rather than borrowing the current clock, because that
                       * would be a reading of something that has not happened.
                       */}
                      <div className="mt-1.5 grid grid-cols-3 gap-2">
                        <Cell label="In" value={clock(entry.at)} />
                        <Cell
                          label="Out"
                          value={ongoing ? "Now" : clock(untilMs)}
                          muted={ongoing}
                        />
                        <Cell label="Total" value={hoursMinutes(secs)} strong />
                      </div>
                      {entry.reason && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                          {entry.reason}
                        </p>
                      )}
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

/**
 * One labelled figure in the In / Out / Total row.
 *
 * The label is above the value rather than beside it so the three read as
 * columns of a table — a day is scanned downwards, and a caption sitting in
 * front of each number would break the alignment that makes that possible.
 */
function Cell({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-medium tracking-[0.08em] text-ink-faint uppercase">
        {label}
      </p>
      <p
        data-figure
        className={`mt-0.5 truncate text-[12px] ${
          strong ? "font-medium text-ink" : muted ? "text-ink-faint" : "text-ink-muted"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * A wall-clock reading, without the timezone suffix.
 *
 * `formatTimeOfDay` is the product's one conversion to IST and stays that way —
 * a second implementation is how two screens come to disagree about what time
 * something happened. What is dropped here is only its " IST" suffix, because
 * this table prints three readings per row and the zone belongs in the column
 * heading rather than three times over.
 */
function clock(ms: number): string {
  return formatTimeOfDay(ms).replace(" IST", "");
}

