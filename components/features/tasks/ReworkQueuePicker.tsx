"use client";

import { useEffect, useState } from "react";
import { getRepository } from "@/lib/repositories";
import type { ReworkQueuePreview } from "@/lib/repositories";
import type { TaskId } from "@/lib/domain";
import { formatDateTime } from "@/lib/utils/format";
import { REWORK_RANKS, describeQueueShift } from "@/lib/rules/tasks/reworkQueue";

/**
 * Whether the reviewer may actually choose a priority.
 *
 * **Off, by the owner's decision on 18 Aug 2026.** The dropdown offers "Leave
 * as it is" and nothing else while the deadline shifting is being watched on
 * real work — one change at a time, so if a deadline lands somewhere
 * surprising there is no question about which rule put it there.
 *
 * Nothing behind it was removed. The engine still accepts a priority, applies
 * it to every assignee and re-chains the queue; the preview below still runs
 * the real walk. Turning this to `true` is the whole of switching it back on.
 * Same shape as `OFFER_REJECTION` in `ReviewPanel.tsx`.
 */
const OFFER_PRIORITY_CHOICE = false;

/**
 * Where the returned work goes in the assignee's queue — and what that costs
 * everything else they are doing.
 *
 * **Showing the queue is not enough; it has to show the consequence.** A
 * reviewer who sees only a list of tasks is guessing. A reviewer who sees
 * "this pushes two deadlines out and one crosses into tomorrow" is deciding.
 * The whole reason this panel exists is that the person being sent work back
 * has already moved on to something else, and only the reviewer knows which
 * matters more.
 *
 * **The figures come from the engine, not from here.** The preview runs the
 * real queue walk in simulation, so what is promised is what the commit
 * produces. This file draws the answer and computes nothing.
 *
 * **It is never required.** A preview that fails, a store with no queue engine
 * behind it, or a reviewer who simply does not choose all leave the rank as it
 * was. Losing a rework because a picker could not load would be far worse than
 * a queue in a slightly wrong order.
 */

export function ReworkQueuePicker({
  taskId,
  value,
  onChange,
}: {
  taskId: TaskId;
  /** The chosen rank, or null for "leave it as it was". */
  value: number | null;
  onChange: (rank: number | null) => void;
}) {
  /* Whether this store can answer at all is a property of the store, not of
     the render, so it is settled once at mount rather than in an effect. */
  const [supported] = useState(
    () => typeof getRepository().reworkQueuePreview === "function",
  );
  const [preview, setPreview] = useState<ReworkQueuePreview | null>(null);
  const [loading, setLoading] = useState(supported);
  const [failed, setFailed] = useState(!supported);

  useEffect(() => {
    if (!supported) return;
    /* A stale answer must not overwrite a newer one — the picker is changed
       faster than the round trip completes. */
    let live = true;
    const repo = getRepository();
    void repo.reworkQueuePreview!(taskId, value).then(
      (r) => {
        if (!live) return;
        setPreview(r);
        setFailed(!r);
        setLoading(false);
      },
      () => {
        if (!live) return;
        setFailed(true);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    /* Deliberately no `setLoading(true)` when the priority changes: the last
       answer stays on screen while the next one is fetched, so the table does
       not blink out from under somebody comparing two choices. */
  }, [taskId, value, supported]);

  const state = loading ? "loading" : failed ? "unavailable" : "ready";
  const rank = value ?? preview?.currentRank ?? null;
  const shift = describeQueueShift(preview?.rows ?? []);

  return (
    <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {OFFER_PRIORITY_CHOICE
            ? "Where does this sit in their work?"
            : "What else they have on"}
        </p>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          Priority
          <select
            value={OFFER_PRIORITY_CHOICE ? (rank ?? "") : ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : Number(e.target.value))
            }
            className="rounded-full border border-hairline bg-[var(--control)] px-2.5 py-1 text-xs text-ink"
          >
            <option value="">Leave as it is</option>
            {OFFER_PRIORITY_CHOICE &&
              REWORK_RANKS.map((r) => (
                <option key={r} value={r}>
                  P{r}
                </option>
              ))}
          </select>
        </label>
      </div>

      {state === "loading" && (
        <p className="mt-2 text-xs text-ink-faint">Working out what moves…</p>
      )}

      {state === "unavailable" && (
        /* Said plainly rather than shown as an empty table. The rework still
           goes through; only the preview is missing. */
        <p className="mt-2 text-xs text-ink-faint">
          Their other deadlines cannot be shown right now. Sending this back
          still works{OFFER_PRIORITY_CHOICE ? " — the priority you pick is still applied" : ""}.
        </p>
      )}

      {state === "ready" && preview && (
        <>
          {preview.leftoverSecs !== null && (
            <p className="mt-1 text-xs text-ink-faint">
              This rework gets{" "}
              <strong className="text-ink">
                {formatLeftover(preview.leftoverSecs)}
              </strong>{" "}
              — the time that was left when they handed it in, not what is left
              now.
            </p>
          )}

          {preview.rows.length === 0 ? (
            <p className="mt-2 text-xs text-ink-faint">
              They have nothing else queued, so nothing else moves.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left text-xs">
                <thead>
                  <tr className="text-ink-faint">
                    <th className="py-1 pr-3 font-medium">Task</th>
                    <th className="py-1 pr-3 font-medium">Priority</th>
                    <th className="py-1 pr-3 font-medium">Deadline now</th>
                    <th className="py-1 font-medium">
                      {OFFER_PRIORITY_CHOICE ? "After your choice" : "After this rework"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const moved = row.from !== null && row.from !== row.to;
                    return (
                      <tr
                        key={row.taskId}
                        className="border-t border-hairline align-top"
                      >
                        <td className="py-1.5 pr-3 text-ink">
                          {row.isRework ? (
                            <span className="font-medium">
                              This rework
                            </span>
                          ) : (
                            row.title
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">
                          P{row.rank}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">
                          {row.from ? formatDateTime(row.from) : "—"}
                        </td>
                        <td
                          className={`py-1.5 ${
                            moved
                              ? "font-medium text-[var(--state-overdue-ink)]"
                              : "text-ink-muted"
                          }`}
                        >
                          {formatDateTime(row.to)}
                          {moved ? " ↓" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {shift && (
            /* The sentence that turns a table into a decision. */
            <p className="mt-2 text-xs text-[var(--state-overdue-ink)]">
              {shift}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Seconds as the reviewer would say them — "1 h 15 m", not "4500". */
function formatLeftover(secs: number): string {
  if (secs <= 0) return "no extra time";
  const hours = Math.floor(secs / 3600);
  const mins = Math.round((secs % 3600) / 60);
  if (hours && mins) return `${hours} h ${mins} m`;
  if (hours) return `${hours} h`;
  return `${mins} m`;
}

export default ReworkQueuePicker;
