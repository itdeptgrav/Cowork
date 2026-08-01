import { FLOW_CHANNELS } from "../../repositories/mock/flow.ts";
import type {
  FlowChannelId,
  FlowPoint,
  WorkloadFlow,
} from "@/lib/domain";

/**
 * Work arriving against work leaving, bucketed by week.
 *
 * The dashboard's signature graph read `getWorkloadFlow`, and on the real
 * backend that method was `async getWorkloadFlow() { return null; }` — a
 * one-line stub. The graph has therefore been empty in production for its whole
 * life while rendering perfectly against the mock, which computes the series in
 * full. This is the arithmetic, lifted out so both backends share it and so it
 * can be tested without a datastore.
 *
 * ## Which channels the legacy engine can actually answer
 *
 * Checked against the live collection rather than assumed, because the domain
 * names six channels and legacy stamps far fewer:
 *
 * | Channel     | Source in `cowork_tasks`            | Present |
 * |-------------|-------------------------------------|---------|
 * | `created`   | `createdAt`, creator in scope       | yes     |
 * | `assigned`  | `createdAt`, assignee in scope      | yes     |
 * | `rework`    | `reworkHistory[].sentBackAt`        | yes     |
 * | `completed` | `updatedAt` where status is closed  | yes     |
 * | `approved`  | `status` in the approved list       | mapped  |
 * | `cancelled` | `status` in the cancelled list      | mapped  |
 *
 * The last two are mapped but **flat on the live data**: all 21 closed tasks
 * carry `done`, and no task in the collection is in an approved or cancelled
 * status. They are not folded into `completed` to make the graph look busier —
 * a departure counted under two names would misstate the very thing the graph
 * exists to answer, and the rule this migration holds to throughout is that
 * absent stays absent. A flat channel is telling the truth about what is
 * recorded.
 *
 * ## Why `created` and `assigned` are separate and not double-counting
 *
 * They are different populations, not one event named twice: `created` counts
 * work this scope PUSHED OUT, `assigned` counts work that LANDED on it. A task
 * you create and assign to yourself is genuinely both, and on a team scope the
 * two diverge sharply — which is the comparison the graph is for. Legacy
 * assigns at creation, so both read `createdAt`; that is a fact about legacy,
 * not a shortcut.
 */

/** Arrivals. Everything else is a departure. */
const INBOUND: readonly FlowChannelId[] = ["created", "assigned", "rework"];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const WEEK_MS = 7 * 86_400_000;

/** One thing that happened, already attributed to a channel. */
export interface FlowEvent {
  at: string | null | undefined;
  channel: FlowChannelId;
}

/**
 * The Monday-opening weeks ending with the one containing `nowMs`.
 *
 * UTC throughout. A local-time boundary would put the same event in different
 * weeks for two people reading the same dashboard from two timezones, and the
 * axis label would disagree with the bucket for anybody east of UTC.
 */
export function weekBuckets(nowMs: number, weeks: number): FlowPoint[] {
  const end = new Date(nowMs);
  const day = end.getUTCDay();
  const monday = new Date(end);
  /* `(day + 6) % 7` maps Sunday to 6 rather than to -1, so a Sunday belongs to
     the week that opened six days earlier instead of the one starting tomorrow. */
  monday.setUTCDate(end.getUTCDate() - ((day + 6) % 7));
  monday.setUTCHours(0, 0, 0, 0);

  const out: FlowPoint[] = [];
  for (let i = Math.max(0, weeks) - 1; i >= 0; i--) {
    const start = new Date(monday.getTime() - i * WEEK_MS);
    out.push({
      weekStart: start.toISOString().slice(0, 10),
      label: `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`,
      values: {
        created: 0,
        assigned: 0,
        rework: 0,
        completed: 0,
        approved: 0,
        cancelled: 0,
      },
      net: 0,
    });
  }
  return out;
}

/**
 * Fold events into a series.
 *
 * Events outside the window are dropped, not clamped into the nearest bucket:
 * a task created a year ago is not news this week, and piling history onto the
 * first column would put a spike there that never happened.
 */
export function buildWorkloadFlow(
  events: readonly FlowEvent[],
  nowMs: number,
  weeks: number,
): WorkloadFlow {
  const points = weekBuckets(nowMs, weeks);
  const firstMs = points.length
    ? Date.parse(`${points[0].weekStart}T00:00:00.000Z`)
    : 0;

  for (const e of events) {
    if (!e.at) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    const index = Math.floor((t - firstMs) / WEEK_MS);
    if (index < 0 || index >= points.length) continue;
    points[index].values[e.channel] += 1;
  }

  let peak = 0;
  let netTotal = 0;
  for (const p of points) {
    let inSum = 0;
    let outSum = 0;
    for (const [k, v] of Object.entries(p.values) as [FlowChannelId, number][]) {
      peak = Math.max(peak, v);
      if (INBOUND.includes(k)) inSum += v;
      else outSum += v;
    }
    p.net = inSum - outSum;
    netTotal += p.net;
  }

  return { channels: FLOW_CHANNELS, points, peak, netTotal };
}

/**
 * Legacy statuses that mean the work has left the queue.
 *
 * `done` is the closed state in the live data (21 of 63 tasks). `completed`
 * and `cancelled` are the domain's names and are matched too, so a document
 * written by the new UI counts without a second pass here.
 */
export const CLOSED_LEGACY_STATUSES: readonly string[] = [
  "done",
  "completed",
];

/**
 * Statuses that mean a REVIEWER signed it off, as distinct from the work simply
 * being finished.
 *
 * Legacy writes these to `status` despite reading like completion states — see
 * `TERMINAL_STATUSES` in `legacy/wire.ts`. Kept apart from the closed list
 * because `completed` and `approved` are two different channels on the graph,
 * and merging them would count one departure under two names.
 */
export const APPROVED_LEGACY_STATUSES: readonly string[] = [
  "approved",
  "tl_final_approved",
  "ceo_approved",
];

export const CANCELLED_LEGACY_STATUSES: readonly string[] = [
  "cancelled",
  "canceled",
  "rejected",
];
