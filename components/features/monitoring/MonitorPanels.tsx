"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, Meter, ProvisionalBadge } from "@/components/ui/Primitives";
import { Action } from "@/components/features/dashboard/Card";
import { Icon } from "@/components/ui/Icons";
import { ActivityTimeline } from "./ActivityTimeline";
import {
  Fact,
  Metric,
  MonitorCard,
  Sparkline,
  clockTime,
  duration,
} from "./MonitorParts";
import { STATUS_META } from "@/lib/status/employeeStatus";
import type {
  ActivityEvent,
  DailySummary,
  DeviceInfo,
  InterventionGroup,
  InterventionItem,
  MonitoredPresence,
  MonitoringPerformance,
  MonitoringSubject,
  TeamAnalytics,
  TeamMonitoringRow,
  WorkloadBand,
} from "@/lib/domain";

/**
 * The six panels the layout reference asks for, in its own slots.
 *
 * Each one is a `MonitorCard`, which is the dashboard's card — same material,
 * radius, heading and link affordance — so the monitoring surface reads as a
 * room in the same building. What changed in this pass is *which* panels exist
 * and where, not what they are made of.
 *
 * Every panel takes its data and its query state as props, because the feeds
 * behind them fail independently and a page that blanks entirely when one
 * provider is down is worse than one that says so in one card.
 */

type Query = { error: string | null; refetch: () => void };

/* ══ A — LEFT LARGE (5 cols, row 1) ═══════════════════════════════════════ */

/**
 * Employee Activity Overview.
 *
 * The reference's large left card leads with one figure at display scale and
 * sits everything else beneath it. Here the figure is time online today, which
 * is the number a monitoring view is actually asked for first. Identity and
 * status sit above it, the day's trend beside it, and the recent events run
 * underneath — the same top-to-bottom order the reference uses.
 */
export function EmployeeActivityOverview({
  subject,
  summary,
  events,
  loading,
  queries,
}: {
  subject: MonitoringSubject | null;
  summary: DailySummary | null;
  events: ActivityEvent[];
  loading: boolean;
  queries: Query[];
}) {
  const meta = subject ? STATUS_META[subject.presence] : null;
  const trend = summary?.trend ?? [];

  return (
    <MonitorCard
      title="Employee activity"
      href={subject ? `/team/${subject.employeeId}` : undefined}
      hrefLabel="Open their profile"
      queries={queries}
      loading={loading}
      className="flex-1"
      errorMessage="This person's activity could not be read."
      empty={{
        when: !subject,
        title: "No one selected",
        body: "Choose someone you manage to begin monitoring.",
      }}
    >
      {subject && meta && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-start gap-3">
            <Avatar
              initials={subject.initials}
              hue={subject.hue}
              size="md"
              name={subject.displayName}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] leading-tight font-medium text-ink">
                {subject.displayName}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                {subject.designation ?? "—"}
                {subject.departmentName ? ` · ${subject.departmentName}` : ""}
              </p>
            </div>
            <PresencePill presence={subject.presence} />
          </div>

          {/* The headline figure, and the trend read against it. */}
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="flex items-baseline gap-2">
                <span
                  data-figure
                  className="text-[clamp(1.875rem,3vw,2.5rem)] leading-none font-light tracking-[-0.035em] text-ink"
                >
                  {duration(subject.onlineSecondsToday)}
                </span>
                <span className="text-xs text-ink-muted">online today</span>
              </p>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                {subject.presenceSince
                  ? `Since ${clockTime(subject.presenceSince, subject.timezone)} · ${subject.currentActivity ?? "nothing running"}`
                  : "No session started today"}
              </p>
            </div>

            {trend.length > 1 && (
              <div className="w-[min(220px,100%)] shrink-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] text-ink-faint">
                    Productivity · {trend.length} days
                  </span>
                  <span data-figure className="text-[11px] text-ink-muted">
                    {trend[0].value} → {trend[trend.length - 1].value}
                  </span>
                </div>
                <Sparkline
                  className="mt-1.5"
                  points={trend.map((t) => t.value)}
                  label={`Productivity over ${trend.length} days, from ${trend[0].value} to ${trend[trend.length - 1].value} percent`}
                />
              </div>
            )}
          </div>

          {/* Recent events fill whatever the panel has left and scroll inside
              it, rather than taking a fixed height. A capped list in a taller
              card leaves a clipped row above an empty gap — the one shape that
              reads as broken rather than as scrollable. */}
          <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-hairline pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[11px] text-ink-faint">Recent events</p>
              {events.length > 6 && (
                <span className="text-[11px] text-ink-faint">
                  latest 6 of <span data-figure>{events.length}</span>
                </span>
              )}
            </div>
            {events.length === 0 ? (
              <p className="mt-2 text-xs text-ink-muted">
                Nothing has been reported today. An empty feed is not the same
                as an idle day.
              </p>
            ) : (
              <ActivityTimeline
                className="mt-1.5 min-h-0 flex-1"
                events={events.slice(0, 6)}
                timezone={subject.timezone}
              />
            )}
          </div>
        </div>
      )}
    </MonitorCard>
  );
}

/* ══ B — CENTRE STACK (3 cols, row 1) ═════════════════════════════════════ */

/** B1 — the score. The reference's small "Income" card: figure, then delta. */
export function ScoreCard({
  performance,
  loading,
  query,
}: {
  performance: MonitoringPerformance | null;
  loading: boolean;
  query: Query;
}) {
  return (
    <MonitorCard
      title="Employee score"
      href="/score"
      hrefLabel="Open the score"
      headerRight={
        performance?.provisional ? (
          <ProvisionalBadge label="Score" />
        ) : undefined
      }
      queries={[query]}
      loading={loading}
      errorMessage="The score could not be read."
      empty={{ when: !performance, title: "No score yet" }}
    >
      {/* The three centre cards are equal by construction, so each one
          distributes its own content across that height instead of stacking it
          at the top over a pool of dead space. Same instruction, three cards:
          figure first, supporting rule last. */}
      {performance && (
        <div className="flex flex-1 flex-col justify-between gap-3">
          <div className="flex items-end justify-between gap-3">
            <p className="flex items-baseline gap-1.5">
              <span
                data-figure
                className="text-[28px] leading-none font-light tracking-[-0.03em] text-ink"
              >
                {performance.productivityScore}
              </span>
              <span className="text-xs text-ink-faint">%</span>
            </p>
            <TrendChip delta={performance.trend} />
          </div>
          <div>
            <Meter
              value={performance.productivityScore}
              label={`Productivity ${performance.productivityScore}%`}
            />
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Composite of C1–C4 for the current period
            </p>
          </div>
        </div>
      )}
    </MonitorCard>
  );
}

/** B2 — how the time went, and how the work came back. */
export function ProductivityCard({
  performance,
  summary,
  loading,
  queries,
}: {
  performance: MonitoringPerformance | null;
  summary: DailySummary | null;
  loading: boolean;
  queries: Query[];
}) {
  const quality = summary?.quality ?? [];
  return (
    <MonitorCard
      title="Productivity"
      href="/score/c1"
      hrefLabel="Open C1 · Task Execution"
      queries={queries}
      loading={loading}
      errorMessage="Productivity figures could not be read."
      empty={{ when: !performance, title: "No productivity data" }}
    >
      {performance && (
        <div className="flex flex-1 flex-col justify-between gap-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Metric
              label="Active"
              value={duration(performance.activeSecondsToday)}
            />
            <Metric
              label="Focus"
              value={duration(performance.focusSecondsToday)}
            />
          </div>
          {quality.length > 0 && (
            <dl className="divide-y divide-hairline border-t border-hairline">
              {quality.slice(0, 2).map((q) => {
                const good =
                  q.betterWhen === "higher" ? q.trend >= 0 : q.trend <= 0;
                return (
                  <Fact
                    key={q.id}
                    label={q.label}
                    value={
                      <span className="inline-flex items-baseline gap-1.5">
                        <span data-figure className="text-ink">
                          {q.value}
                          {q.unit}
                        </span>
                        <span
                          data-figure
                          className={`text-[11px] ${
                            good
                              ? "text-[var(--state-positive-ink)]"
                              : "text-[var(--state-overdue-ink)]"
                          }`}
                        >
                          {q.trend >= 0 ? "+" : "−"}
                          {Math.abs(q.trend)}
                        </span>
                      </span>
                    }
                  />
                );
              })}
            </dl>
          )}
        </div>
      )}
    </MonitorCard>
  );
}

/** B3 — what they are carrying. */
export function WorkloadCard({
  performance,
  row,
  loading,
  queries,
}: {
  performance: MonitoringPerformance | null;
  row: TeamMonitoringRow | null;
  loading: boolean;
  queries: Query[];
}) {
  const open = performance?.tasksOpen ?? row?.openTasks ?? 0;
  const overdue = row?.overdueTasks ?? 0;
  const percent = row?.workloadPercent ?? 0;

  return (
    <MonitorCard
      title="Workload"
      href="/tasks?view=tasks"
      hrefLabel="Open their tasks"
      headerRight={row ? <WorkloadChip band={row.workloadBand} /> : undefined}
      queries={queries}
      loading={loading}
      errorMessage="Workload could not be read."
      empty={{ when: !performance && !row, title: "No workload data" }}
    >
      <div className="flex flex-1 flex-col justify-between gap-3">
        <div className="grid grid-cols-3 gap-x-3">
          <Metric label="Open" value={String(open)} />
          <Metric
            label="Overdue"
            value={String(overdue)}
            tone={overdue > 0 ? "alert" : "default"}
          />
          <Metric
            label="Done today"
            value={String(performance?.tasksCompletedToday ?? 0)}
          />
        </div>
        {row && (
          <div>
            <Meter
              value={Math.min(100, percent)}
              announce={percent}
              label={`Capacity committed ${percent}%`}
              tone={
                percent > 100 ? "overdue" : percent > 85 ? "risk" : "default"
              }
            />
            <p className="mt-1.5 text-[11px] text-ink-faint">
              <span data-figure>{percent}%</span> of committed capacity
            </p>
          </div>
        )}
      </div>
    </MonitorCard>
  );
}

/* ══ C — RIGHT LARGE (4 cols, tall) ═══════════════════════════════════════ */

const GROUP_TITLE: Record<InterventionGroup, string> = {
  alert: "Alerts",
  unusual: "Unusual activity",
  pending: "Pending actions",
  issue: "Employee issues",
};

/**
 * Manager Intervention Panel.
 *
 * Four named sections in a fixed order, because the order IS the priority: what
 * is wrong, what is odd, what is waiting on you, what is worth a conversation.
 * Only `high` severity takes a state wash — if everything is coloured, nothing
 * is, and a monitoring surface that dramatises every row trains its reader to
 * stop looking.
 */
export function InterventionPanel({
  items,
  displayName,
  loading,
  query,
  className = "",
}: {
  items: InterventionItem[];
  displayName: string;
  loading: boolean;
  query: Query;
  className?: string;
}) {
  const groups: InterventionGroup[] = ["alert", "unusual", "pending", "issue"];
  const highCount = items.filter((i) => i.severity === "high").length;

  return (
    <MonitorCard
      title="Needs you"
      className={className}
      headerRight={
        highCount > 0 ? (
          <Chip tone="overdue">
            <span data-figure>{highCount}</span> urgent
          </Chip>
        ) : undefined
      }
      queries={[query]}
      loading={loading}
      errorMessage="This list could not be read."
      empty={{
        when: items.length === 0,
        title: "Nothing needs you",
        body: `No alerts, pending decisions or open issues for ${displayName}.`,
      }}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 scroll-slim">
        {groups.map((g) => {
          const inGroup = items.filter((i) => i.group === g);
          if (inGroup.length === 0) return null;
          return (
            <section key={g}>
              <h3 className="flex items-baseline gap-2 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                {GROUP_TITLE[g]}
                <span data-figure className="tracking-normal">
                  {inGroup.length}
                </span>
              </h3>
              <ul className="mt-1 divide-y divide-hairline">
                {inGroup.map((item) => (
                  <InterventionRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </MonitorCard>
  );
}

function InterventionRow({ item }: { item: InterventionItem }) {
  const high = item.severity === "high";
  return (
    <li className="py-2.5 first:pt-1.5">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            backgroundColor: high
              ? "var(--state-overdue)"
              : item.group === "unusual"
                ? "var(--state-risk)"
                : "var(--ink-faint)",
          }}
        />
        <p
          className={`min-w-0 flex-1 text-xs font-medium ${
            high ? "text-[var(--state-overdue-ink)]" : "text-ink"
          }`}
        >
          {item.title}
        </p>
      </div>
      <p className="mt-1 pl-3.5 text-[11px] leading-relaxed text-ink-muted">
        {item.detail}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-3.5">
        <p className="text-[11px] text-ink-faint">Based on {item.basis}</p>
        {item.action && (
          <Action href={item.action.href} icon="chevronRight">
            {item.action.label}
          </Action>
        )}
      </div>
    </li>
  );
}

/* ══ D — BOTTOM LEFT (4 cols, row 2) ══════════════════════════════════════ */

/**
 * The team, one row each.
 *
 * Rows separate with hairlines and the selected row takes control-active — the
 * single most-checked interaction state in the product, and the reason this is
 * a list of buttons rather than a table of links: choosing someone here changes
 * what the rest of the page is about.
 */
export function TeamWorkloadList({
  rows,
  selectedId,
  onSelect,
  loading,
  query,
}: {
  rows: TeamMonitoringRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  query: Query;
}) {
  const totalOpen = rows.reduce((n, r) => n + r.openTasks, 0);
  const totalOverdue = rows.reduce((n, r) => n + r.overdueTasks, 0);
  const overCapacity = rows.filter((r) => r.workloadPercent > 100).length;

  return (
    <MonitorCard
      title="Team workload"
      href="/team"
      hrefLabel="Open the team"
      className="flex-1"
      headerRight={
        rows.length > 0 ? (
          <span data-figure className="text-[11px] text-ink-faint">
            {rows.length}
          </span>
        ) : undefined
      }
      queries={[query]}
      loading={loading}
      errorMessage="The team list could not be read."
      empty={{
        when: rows.length === 0,
        title: "No direct reports",
        body: "This list shows the people who report to you.",
      }}
    >
      <ul
        role="listbox"
        aria-label="Choose who to monitor"
        className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto pr-1 scroll-slim"
      >
        {rows.map((r) => {
          const active = r.employeeId === selectedId;
          const meta = STATUS_META[r.presence];
          return (
            <li key={r.employeeId}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onSelect(r.employeeId)}
                className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-inset px-2 py-2.5 text-left transition-colors ${
                  active
                    ? "bg-[var(--control-active)]"
                    : "hover:bg-[var(--row-hover)]"
                }`}
              >
                <span className="relative shrink-0">
                  <Avatar initials={r.initials} hue={r.hue} size="sm" />
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--frost-panel)]"
                    style={{ backgroundColor: meta.dot }}
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-ink">
                    {r.displayName}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                    {meta.label}
                    {r.currentActivity ? ` · ${r.currentActivity}` : ""}
                  </span>
                </span>

                <span className="w-[86px] shrink-0">
                  <span className="flex items-baseline justify-end gap-1.5">
                    <span data-figure className="text-[11px] text-ink-muted">
                      {r.workloadPercent}%
                    </span>
                    {r.overdueTasks > 0 && (
                      <span
                        data-figure
                        className="text-[11px] text-[var(--state-overdue-ink)]"
                        title={`${r.overdueTasks} overdue`}
                      >
                        {r.overdueTasks}!
                      </span>
                    )}
                  </span>
                  <Meter
                    className="mt-1"
                    value={Math.min(100, r.workloadPercent)}
                    announce={r.workloadPercent}
                    label={`${r.displayName}: ${r.workloadPercent}% of capacity`}
                    tone={
                      r.workloadPercent > 100
                        ? "overdue"
                        : r.workloadPercent > 85
                          ? "risk"
                          : "default"
                    }
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* The list is short and the panel is tall, so its bottom edge was an
          accident. These are the same rows totalled — the figure a manager
          would otherwise add up by eye — pinned to the baseline so the panel
          ends on a statement rather than on empty space. */}
      {rows.length > 0 && (
        <dl className="mt-3 grid grid-cols-3 gap-x-3 border-t border-hairline pt-3">
          <Metric label="Open across the team" value={String(totalOpen)} />
          <Metric
            label="Overdue"
            value={String(totalOverdue)}
            tone={totalOverdue > 0 ? "alert" : "default"}
          />
          <Metric
            label="Over capacity"
            value={String(overCapacity)}
            tone={overCapacity > 0 ? "alert" : "default"}
          />
        </dl>
      )}
    </MonitorCard>
  );
}

/* ══ E — BOTTOM CENTRE (4 cols, row 2) ════════════════════════════════════ */

const BAND_LABEL: Record<WorkloadBand, string> = {
  light: "Light",
  balanced: "Balanced",
  heavy: "Heavy",
  overloaded: "Overloaded",
};

/**
 * Team analytics.
 *
 * Three distributions, all drawn as segmented tracks in neutral and state ink.
 * Not a donut and not four channel colours: The Four Channels Rule reserves
 * saturated hue for C1–C4, and none of these three is a score component.
 */
export function TeamAnalyticsPanel({
  analytics,
  loading,
  query,
}: {
  analytics: TeamAnalytics | null;
  loading: boolean;
  query: Query;
}) {
  /* Each distribution leads with the one number someone would read out loud.
     A bar and a legend answer "how is it split"; the headline answers "so
     what", which is the question a manager actually arrives with. */
  const online =
    analytics?.presence.find((p) => p.state === "online")?.count ?? 0;
  const strained = (analytics?.workload ?? [])
    .filter((w) => w.band === "heavy" || w.band === "overloaded")
    .reduce((s, w) => s + w.count, 0);
  const tracked = (analytics?.activeSecs ?? 0) + (analytics?.idleSecs ?? 0);
  const focusShare = tracked
    ? Math.round(((analytics?.focusSecs ?? 0) / tracked) * 100)
    : 0;

  return (
    <MonitorCard
      title="Team analytics"
      className="flex-1"
      headerRight={
        analytics ? (
          <span className="text-[11px] text-ink-faint">
            <span data-figure>{analytics.headcount}</span> people
          </span>
        ) : undefined
      }
      queries={[query]}
      loading={loading}
      errorMessage="Team analytics could not be read."
      empty={{
        when: !analytics || analytics.headcount === 0,
        title: "Nothing to summarise",
        body: "Analytics appear once people report to you.",
      }}
    >
      {/* Three equal rows for the same reason the centre stack uses them:
          `justify-between` spread three short blocks across 600px and put the
          slack into two large arbitrary gaps. Equal rows give one rhythm and
          put whatever is left inside each block, where it reads as breathing
          room rather than as a hole. */}
      {analytics && (
        <div className="grid min-h-0 flex-1 grid-rows-3 gap-4">
          <Distribution
            label="Online distribution"
            headline={`${online} of ${analytics.headcount}`}
            caption="online right now"
            total={analytics.headcount}
            segments={analytics.presence.map((p) => ({
              key: p.state,
              label: STATUS_META[p.state].label,
              value: p.count,
              tone: PRESENCE_TONE[p.state],
            }))}
          />
          <Distribution
            label="Workload distribution"
            headline={String(strained)}
            caption={
              strained === 1 ? "person over capacity" : "people over capacity"
            }
            total={analytics.headcount}
            segments={analytics.workload.map((w) => ({
              key: w.band,
              label: BAND_LABEL[w.band],
              value: w.count,
              tone: BAND_TONE[w.band],
            }))}
          />
          <Distribution
            label="Focus vs idle"
            headline={`${focusShare}%`}
            caption="of tracked time was focus"
            total={analytics.activeSecs + analytics.idleSecs}
            format={duration}
            segments={[
              {
                key: "focus",
                label: "Focus",
                value: analytics.focusSecs,
                tone: "var(--color-ink)",
              },
              {
                key: "other",
                label: "Other active",
                value: Math.max(0, analytics.activeSecs - analytics.focusSecs),
                tone: "var(--control-active)",
              },
              {
                key: "idle",
                label: "Idle",
                value: analytics.idleSecs,
                tone: "var(--state-risk)",
              },
            ]}
          />
        </div>
      )}
    </MonitorCard>
  );
}

const PRESENCE_TONE: Record<MonitoredPresence, string> = {
  online: "var(--state-positive)",
  break: "var(--state-risk)",
  emergency: "var(--state-overdue)",
  offline: "var(--control-active)",
};

const BAND_TONE: Record<WorkloadBand, string> = {
  light: "var(--control-active)",
  balanced: "var(--state-positive)",
  heavy: "var(--state-risk)",
  overloaded: "var(--state-overdue)",
};

/**
 * One distribution: a segmented track plus a legend of every category.
 *
 * Zero-count categories keep their legend entry and lose their segment. A
 * distribution that drops its empty categories cannot be read as one — "two
 * online" only means something if you can see the other states were counted.
 */
function Distribution({
  label,
  headline,
  caption,
  total,
  segments,
  format,
}: {
  label: string;
  headline: string;
  caption: string;
  total: number;
  segments: { key: string; label: string; value: number; tone: string }[];
  format?: (n: number) => string;
}) {
  const sum = segments.reduce((s, x) => s + x.value, 0) || total || 1;
  const fmt = format ?? ((n: number) => String(n));

  return (
    /* Each block distributes inside its equal third: name and figure at the
       top, bar and legend on the baseline. The slack then sits in one place
       per block rather than trailing off the bottom of each. */
    <div className="flex min-h-0 flex-col justify-between gap-2">
      <div>
        <p className="text-[11px] text-ink-faint">{label}</p>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span
            data-figure
            className="text-[22px] leading-none tracking-[-0.025em] text-ink"
          >
            {headline}
          </span>
          <span className="text-xs text-ink-faint">{caption}</span>
        </p>
        <div
          className="mt-2 flex h-2 gap-px overflow-hidden rounded-full bg-[var(--surface-sunken)]"
          role="img"
          aria-label={`${label}: ${segments
            .filter((s) => s.value > 0)
            .map((s) => `${fmt(s.value)} ${s.label}`)
            .join(", ")}`}
        >
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.key}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(s.value / sum) * 100}%`,
                  backgroundColor: s.tone,
                }}
              />
            ))}
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {segments.map((s) => (
            <li
              key={s.key}
              className={`flex items-center gap-1.5 text-[11px] ${
                s.value > 0 ? "text-ink-muted" : "text-ink-faint opacity-60"
              }`}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.tone }}
              />
              <span data-figure>{fmt(s.value)}</span> {s.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ══ F — BOTTOM RIGHT (right stack, under C) ══════════════════════════════ */

/**
 * Live monitoring actions.
 *
 * The live screen moved here, from a permanent panel to an action. That is the
 * reference's structure and it is also the better product: a manager watching a
 * screen all day is a different activity from running a team, and the dashboard
 * is for the second. Opening it is one click and it comes back over the page.
 *
 * The device facts sit underneath because they are what the action depends on —
 * a "poor link" is the difference between a stream worth opening and one that
 * will stutter.
 */
export function LiveActionsPanel({
  subject,
  device,
  onOpenScreen,
  loading,
  query,
}: {
  subject: MonitoringSubject | null;
  device: DeviceInfo | null;
  onOpenScreen: () => void;
  loading: boolean;
  query: Query;
}) {
  const first = subject?.displayName.split(" ")[0] ?? "them";
  const quality = device?.networkQuality ?? "unknown";

  return (
    <MonitorCard
      title="Live monitoring"
      queries={[query]}
      loading={loading}
      empty={{ when: !subject, title: "No one selected" }}
    >
      {subject && (
        <>
          <button
            type="button"
            onClick={onOpenScreen}
            className="flex w-full items-center gap-2.5 rounded-inset bg-ink px-3 py-2.5 text-left transition-opacity hover:opacity-90"
          >
            <span
              aria-hidden="true"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/15 text-[var(--body-bg)]"
            >
              <Icon.play className="h-3 w-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-[var(--body-bg)]">
                Open {first}&rsquo;s screen
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--body-bg)]/70">
                {subject.presence === "online"
                  ? "Live now"
                  : subject.presence === "break"
                    ? "On a break — the connection is held"
                    : "Not sharing right now"}
              </span>
            </span>
          </button>

          <ul className="mt-1 divide-y divide-hairline">
            <ActionRow
              icon="chat"
              label={`Message ${first}`}
              detail="Opens the conversation"
              href={`/messages?to=${subject.employeeId}`}
            />
            <ActionRow
              icon="approvals"
              label="Request an update"
              detail="Asks for a status on open work"
              href={`/messages?to=${subject.employeeId}&intent=update`}
            />
            <ActionRow
              icon="flag"
              label="Raise an emergency"
              detail="Notifies them and their chain immediately"
              href={`/messages?to=${subject.employeeId}&intent=emergency`}
              tone="alert"
            />
          </ul>

          {device && (
            <dl className="mt-2 border-t border-hairline pt-1">
              <Fact
                label="Device"
                value={device.deviceName}
                title={device.deviceModel ?? undefined}
              />
              <Fact
                label="Link"
                value={
                  <span className="inline-flex items-baseline gap-1.5">
                    <span
                      className={
                        quality === "good"
                          ? "text-[var(--state-positive-ink)]"
                          : quality === "poor"
                            ? "text-[var(--state-overdue-ink)]"
                            : "text-ink-muted"
                      }
                    >
                      {quality === "unknown" ? "Unknown" : quality}
                    </span>
                    {device.latencyMs !== null && (
                      <span data-figure className="text-[11px] text-ink-faint">
                        {device.latencyMs} ms
                      </span>
                    )}
                  </span>
                }
              />
            </dl>
          )}

          <p className="mt-2 border-t border-hairline pt-2 text-[11px] leading-relaxed text-ink-faint">
            Monitoring never runs without the share {first} started, and they
            can see it for as long as it lasts.
          </p>
        </>
      )}
    </MonitorCard>
  );
}

function ActionRow({
  icon,
  label,
  detail,
  href,
  tone = "default",
}: {
  icon: keyof typeof Icon;
  label: string;
  detail: string;
  href: string;
  tone?: "default" | "alert";
}) {
  const Glyph = Icon[icon];
  return (
    <li>
      <Link
        href={href}
        className="-mx-2 flex items-center gap-2.5 rounded-inset px-2 py-2 transition-colors hover:bg-[var(--row-hover)]"
      >
        <span
          aria-hidden="true"
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
            tone === "alert"
              ? "bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)] text-[var(--state-overdue-ink)]"
              : "bg-[var(--control)] text-ink-muted"
          }`}
        >
          <Glyph className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink">
            {label}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
            {detail}
          </span>
        </span>
        <Icon.chevronRight className="h-3 w-3 shrink-0 text-ink-faint" />
      </Link>
    </li>
  );
}

/* ══ Shared bits ══════════════════════════════════════════════════════════ */

function PresencePill({ presence }: { presence: MonitoredPresence }) {
  const meta = STATUS_META[presence];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] font-medium text-ink"
      title={meta.help}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: meta.dot,
          boxShadow:
            presence === "offline" ? "none" : `0 0 6px 1px ${meta.glow}`,
        }}
      />
      {meta.label}
    </span>
  );
}

function WorkloadChip({ band }: { band: WorkloadBand }) {
  const tone =
    band === "overloaded"
      ? "overdue"
      : band === "heavy"
        ? "risk"
        : band === "balanced"
          ? "positive"
          : "neutral";
  return <Chip tone={tone}>{BAND_LABEL[band]}</Chip>;
}

function TrendChip({ delta }: { delta: number }) {
  if (delta === 0) {
    return <span className="text-[11px] text-ink-faint">No change</span>;
  }
  const up = delta > 0;
  return (
    <span
      data-figure
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        up
          ? "bg-[color-mix(in_srgb,var(--state-positive)_20%,transparent)] text-[var(--state-positive-ink)]"
          : "bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)] text-[var(--state-overdue-ink)]"
      }`}
      aria-label={`${up ? "up" : "down"} ${Math.abs(delta)} points against the previous period`}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      {Math.abs(delta)}
    </span>
  );
}
