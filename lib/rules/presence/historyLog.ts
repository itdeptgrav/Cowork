import type { DutyHistoryEntry } from "./duty.ts";

/**
 * Turning a day's transitions into a readable log.
 *
 * `cowork_duty_history` stores one row per transition and each row stamps only
 * the moment a mode BEGAN. Everything a reader actually wants — when a stretch
 * ended, how long it ran, how much of the day was worked — is the relationship
 * between neighbouring rows, and that arithmetic belongs somewhere it can be
 * tested at a fixed instant rather than inside a component that reads the
 * clock. `StatusHistoryModal` renders what these return and decides nothing.
 *
 * The list arrives newest-first, which is the order it is read in.
 */

export interface HistorySpan {
  entry: DutyHistoryEntry;
  /**
   * When this mode ended, in epoch ms. For the newest row that is `nowMs` —
   * the mode is still running — which is why `ongoing` is carried separately:
   * "ended just now" and "has not ended" are different facts and only one of
   * them may be printed as an out time.
   */
  untilMs: number;
  ongoing: boolean;
}

/**
 * Close each stretch against the one after it, and merge the repeats.
 *
 * **The newest row is left open.** Nothing ends a mode except the next
 * transition, so the most recent one is still running — and giving it an end
 * time would be inventing an event. It is measured against `nowMs` so the
 * duration climbs while somebody watches, and marked `ongoing` so the display
 * can say so rather than printing a clock reading for something that has not
 * happened.
 *
 * **Consecutive rows of the SAME mode are one stretch.** The stored trail has
 * plenty of them — a second device publishing the same state, a retry after a
 * failed write, a reconnect — and each one printed a row reading "Offline ·
 * 0m". A real day came out as eighty-five entries of which most were noise,
 * and the two facts somebody opens this for, when they started and when they
 * stopped, were buried among them. Nothing is hidden by merging: a transition
 * from a mode to itself changed nothing, so the stretch is what happened.
 *
 * The merged row keeps the OLDEST start in the run — that is when the mode
 * actually began — and the first reason found in it, so an emergency's
 * explanation is not lost to a duplicate written after it.
 */
export function spanRows(
  entries: readonly DutyHistoryEntry[],
  nowMs: number,
): HistorySpan[] {
  const out: HistorySpan[] = [];
  let i = 0;
  while (i < entries.length) {
    /* Newest-first, so the row AFTER this one in the array is older, and the
       one BEFORE it is what ended it. */
    const untilMs = i === 0 ? nowMs : entries[i - 1].at;
    let last = i;
    while (last + 1 < entries.length && entries[last + 1].mode === entries[i].mode)
      last++;
    const run = entries.slice(i, last + 1);
    out.push({
      entry: {
        ...entries[last],
        reason: run.find((e) => e.reason)?.reason ?? null,
      },
      untilMs,
      ongoing: i === 0,
    });
    i = last + 1;
  }
  return out;
}

/** How long one stretch ran, in whole seconds. Never negative. */
export function spanSeconds(span: HistorySpan): number {
  return Math.max(0, Math.round((span.untilMs - span.entry.at) / 1000));
}

/**
 * How much of today was spent online, across every stretch of it.
 *
 * **The sum, not the longest run and not "since the first Online".** A day is
 * not one session — people break for lunch, take a call, reload a page — and
 * measuring from the morning's first entry would count the breaks as work.
 * Anybody reading this is deciding whether the day adds up, so it has to be
 * the time actually spent online and nothing else.
 *
 * The running stretch is included, so the figure climbs rather than jumping
 * when the mode finally ends.
 */
export function onlineSecondsToday(spans: readonly HistorySpan[]): number {
  return spans.reduce(
    (total, span) =>
      span.entry.mode === "online" ? total + spanSeconds(span) : total,
    0,
  );
}

/**
 * A duration for a COLUMN: `8h 00m`, `45m`, `0m`.
 *
 * `formatDuration` in `lib/utils/format` is the prose form and drops an empty
 * minutes part — "8h" reads correctly in a sentence and wrongly in a column
 * beside "7h 45m", where the eye is comparing two figures in the same place.
 * Padded here so the widths match down the list.
 */
export function hoursMinutes(secs: number): string {
  const total = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  /* 59m30s rounds to 60 minutes, which must read as an hour rather than
     "0h 60m" — an impossible reading that only shows up on the boundary. */
  if (m === 60) return `${h + 1}h 00m`;
  if (!h) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
