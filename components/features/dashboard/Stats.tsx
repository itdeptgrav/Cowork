"use client";

import { StatCard } from "./StatCard";
import { HEALTH_LABEL, healthOf, isOpen, scoreInsightShort } from "./signals";
import { hasDataOn } from "@/lib/rules/scoring/scoreDisplay";
import { useLens } from "@/components/layout/shell/LensContext";
import { useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import {
  formatDurationTimer,
} from "@/lib/utils/format";

/**
 * The stacked pair in the middle column — the reference's Income and Expense.
 *
 * Two figures, chosen because they are the two a person checks without being
 * asked: how am I scoring, and how much is on me. Everything that explains
 * either lives one click away, which is what keeps them one line tall.
 *
 * The private and team versions read different data rather than relabelling the
 * same numbers: a manager's second figure is the team's overdue load, not their
 * own inbox.
 */

const HEALTH_COLOUR: Record<string, string> = {
  healthy: "var(--state-positive)",
  watch: "var(--state-risk)",
  at_risk: "var(--state-overdue)",
};

export function ScoreStat() {
  const { lens } = useLens();
  return lens === "team" ? <TeamScoreStat /> : <SelfScoreStat />;
}

function SelfScoreStat() {
  const me = useViewerId();
  /* Keyed on `me`. `useViewerId` is null on the first render and resolves a beat
     later, so with empty deps this fetched the score for "" — which fails — and
     never re-ran once the id arrived. That is the "Your score could not be
     loaded" card sitting beside a top bar that shows the very same score. */
  const score = useQuery((r) => r.getScoreOverview(me ?? ""), [me]);
  const data = score.data;
  const health = data ? healthOf(data.overallPercentage, data.delta) : "watch";

  /* A score of zero because nothing has been measured is not a score of zero.
     The panel used to read "0% · At risk — nothing measured yet", which is a
     full-width card spending prime vertical space to report an absence, and
     reads as failure to somebody who has simply not finished a cycle. */
  /* `unitCount === 0` was the test, and the engine reports no count — so every
     channel looked unmeasured and this card hid a real score behind "nothing
     measured yet". Measured means SCORED. */
  const unmeasured = !data || !data.channels.some((c) => hasDataOn(c));

  if (unmeasured && !score.isLoading && !score.error)
    return (
      <StatCard
        label="Your score"
        value="No score yet"
        caption="Complete your first cycle to establish a baseline."
        href="/score"
        hrefLabel="Open your score"
      />
    );

  return (
    <StatCard
      label="Your score"
      value={data ? `${Math.round(data.overallPercentage)}%` : "—"}
      pill={
        data
          ? {
              text: `${data.delta >= 0 ? "▲" : "▼"}${Math.abs(Math.round(data.delta))}`,
              tone: data.delta >= 0 ? "up" : "down",
            }
          : undefined
      }
      mark={HEALTH_COLOUR[health]}
      caption={
        data
          ? `${HEALTH_LABEL[health]} — ${scoreInsightShort(data.channels)}`
          : undefined
      }
      href="/score"
      hrefLabel="Open your score"
      loading={score.isLoading}
      error={score.error ? "Your score could not be loaded." : null}
      onRetry={score.refetch}
    />
  );
}

function TeamScoreStat() {
  const scores = useQuery(async (r) => {
    const v = await r.getViewer();
    const all = await r.listEmployees();
    const mine = all.filter((e) => v.hierarchyIds.includes(e.id));
    return Promise.all(
      mine.map(async (e) => ({
        employee: e,
        overview: await r.getScoreOverview(e.id),
      })),
    );
  }, []);

  const rows = scores.data ?? [];
  const median = rows.length
    ? Math.round(
        rows.map((r) => r.overview.overallPercentage).sort((a, b) => a - b)[
          Math.floor((rows.length - 1) / 2)
        ],
      )
    : 0;
  const falling = rows.filter((r) => r.overview.delta < 0);
  const lowest = [...rows].sort(
    (a, b) => a.overview.overallPercentage - b.overview.overallPercentage,
  )[0];
  const health = healthOf(median, falling.length ? -8 : 0);

  return (
    <StatCard
      label="Team score · median"
      value={rows.length ? `${median}%` : "—"}
      pill={
        rows.length
          ? {
              text: `${falling.length}/${rows.length} down`,
              tone: falling.length ? "down" : "up",
            }
          : undefined
      }
      mark={HEALTH_COLOUR[health]}
      caption={
        lowest
          ? `${HEALTH_LABEL[health]} — lowest is ${lowest.employee.displayName} at ${Math.round(lowest.overview.overallPercentage)}%`
          : undefined
      }
      href="/team"
      hrefLabel="Compare the team"
      loading={scores.isLoading}
      error={scores.error ? "Team scores could not be loaded." : null}
      onRetry={scores.refetch}
    />
  );
}

export function LoadStat() {
  const { lens } = useLens();
  const team = lens === "team";

  const tasks = useQuery(
    (r) =>
      r
        .listTasks({ scope: team ? "team" : "mine", sort: "rank" })
        .then((p) => p.items),
    [team],
  );
  const active = useQuery((r) => r.getActiveTimer(), []);

  const all = tasks.data ?? [];
  const open = all.filter(isOpen);
  const overdue = open.filter((v) => v.isOverdue).length;
  const logged = open.reduce((s, v) => s + v.loggedSecs, 0);

  /* What the eight actually are. "8 · 9 closed · 6h 15m logged" reports volume
     and throughput — true, and no help deciding anything. The states are what a
     person acts on, so the caption names them and omits any that is zero rather
     than printing a row of noughts. */
  const inProgress = open.filter((v) => v.task.status === "in_progress").length;
  const waiting = open.filter(
    (v) => v.task.status === "pending_approval" || v.task.isBlocked,
  ).length;
  const breakdown = [
    overdue ? `${overdue} overdue` : null,
    inProgress ? `${inProgress} in progress` : null,
    waiting ? `${waiting} awaiting someone` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <StatCard
      label={team ? "Open across the team" : "Open work"}
      value={tasks.isLoading ? "—" : String(open.length)}
      pill={
        overdue > 0
          ? { text: `${overdue} overdue`, tone: "down" }
          : open.length
            ? { text: "on track", tone: "up" }
            : undefined
      }
      tone={overdue === 0 && open.length > 0 ? "tinted" : "plain"}
      caption={
        team
          ? breakdown || `${all.length - open.length} closed`
          : active.data
            ? `Timing “${active.data.taskTitle}”`
            : breakdown ||
              `${all.length - open.length} closed · ${formatDurationTimer(logged)} logged`
      }
      href="/tasks?view=tasks"
      hrefLabel="Open the task list"
      loading={tasks.isLoading}
      error={tasks.error ? "Your work could not be loaded." : null}
      onRetry={tasks.refetch}
    />
  );
}
