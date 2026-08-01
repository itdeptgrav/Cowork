"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { Chip, Meter, ProvisionalBadge } from "@/components/ui/Primitives";
import { MonitorCard, Sparkline, clockTime, duration } from "@/components/features/monitoring/MonitorParts";
import { ActivityTimeline } from "@/components/features/monitoring/ActivityTimeline";
import { formatDate } from "@/lib/utils/format";
import type {
  ActivityEvent,
  DailySummary,
  DeviceInfo,
  Employee,
  Goal,
  MonitoringPerformance,
  MonitoringSubject,
  Observation,
  ScoreOverview,
  TeamMonitoringRow,
} from "@/lib/domain";
import type { TaskView } from "@/lib/repositories";

/**
 * The panels of the person monitoring view.
 *
 * Every one is a `MonitorCard`, which is the dashboard's `Card` plus the
 * loading / empty / failed states each feed needs on its own — nine panels here
 * read from seven independent providers, and a page that renders one shared
 * spinner for all of them is lying about which parts it actually has.
 *
 * Two conventions run through the file and are worth stating once:
 *
 *  · **Nothing carries a C1–C4 hue except the score channels.** Workload,
 *    quality, goals and trends are neutral ink or the state palette. Saturated
 *    colour in Cowork means "this is a score component" and the moment a
 *    workload bar borrows Execution Emerald the component band stops reading.
 *  · **Every claim states what it rests on.** `Observation.basis` is rendered,
 *    not dropped, because a manager should be able to disagree with the
 *    evidence rather than with the system.
 */

type Query = { error: string | null; refetch: () => void };

/* ══ Left column ═════════════════════════════════════════════════════════ */

/**
 * What they are doing right now, and the work it belongs to.
 *
 * Activity, task and project are one panel rather than three because they are
 * one thought — "Figma, on the empty-state copy pass, for the Workspace shell"
 * is a sentence, and splitting it across three cards makes the reader
 * reassemble it. The reference's `Match Overview` does the same job in the same
 * slot: the subject of everything else on the page, stated once at the top of
 * the left column.
 */
export function RightNowPanel({
  subject,
  task,
  loading,
  queries,
}: {
  subject: MonitoringSubject | null;
  task: TaskView | null;
  loading: boolean;
  queries: Query[];
}) {
  const activity = subject?.currentActivity;

  return (
    <MonitorCard
      title="Right now"
      queries={queries}
      loading={loading}
      empty={{
        when: !subject,
        title: "Nothing is being reported",
        body: "Activity appears once this person is sharing a screen.",
      }}
    >
      {subject && (
        <>
          <p className="text-[15px] leading-snug font-medium text-ink">
            {activity ?? "No active task"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            {activity
              ? "Reported by the endpoint agent."
              : subject.presence === "break"
                ? "On a break. The last timer was paused."
                : "No timer is running."}
          </p>

          {task ? (
            <Link
              href={`/tasks/${task.task.id}`}
              className="group -mx-2 mt-3 block rounded-inset px-2 py-2 transition-colors hover:bg-[var(--row-hover)]"
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                  {task.task.title}
                </span>
                <Icon.chevronRight className="h-3 w-3 shrink-0 translate-y-px text-ink-faint transition-transform duration-[180ms] ease-[var(--ease-deck)] group-hover:translate-x-0.5" />
              </span>
              <span className="mt-1 block truncate text-[11px] text-ink-faint">
                {task.project?.name ?? "No project"}
                {task.task.deadline.dueAt &&
                  ` · due ${formatDate(task.task.deadline.dueAt)}`}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                {task.isOverdue && <Chip tone="overdue">Overdue</Chip>}
                {task.task.isBlocked && <Chip tone="blocked">Blocked</Chip>}
                {task.reworkCount > 0 && (
                  <Chip tone="rework">
                    {task.reworkCount} rework
                    {task.reworkCount > 1 ? "s" : ""}
                  </Chip>
                )}
                {!task.isOverdue &&
                  !task.task.isBlocked &&
                  task.reworkCount === 0 && <Chip>On track</Chip>}
              </span>
            </Link>
          ) : (
            <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-faint">
              No Cowork task is linked to the current activity.
            </p>
          )}

          <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-1 border-t border-hairline pt-3">
            <Stat label="Online today" value={duration(subject.onlineSecondsToday)} />
            <Stat
              label="Local time"
              value={clockTime(new Date().toISOString(), subject.timezone)}
            />
          </dl>
        </>
      )}
    </MonitorCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-ink-faint">{label}</dt>
      <dd data-figure className="mt-0.5 truncate text-xs text-ink">
        {value}
      </dd>
    </div>
  );
}

/** The working day, newest first. Reuses the timeline the manager view owns. */
export function TodayPanel({
  events,
  timezone,
  loading,
  query,
}: {
  events: ActivityEvent[];
  timezone: string;
  loading: boolean;
  query: Query;
}) {
  return (
    <MonitorCard
      title="Today"
      queries={[query]}
      loading={loading}
      headerRight={
        events.length > 0 ? (
          <span data-figure className="text-xs text-ink-faint">
            {events.length}
          </span>
        ) : undefined
      }
      empty={{
        when: events.length === 0,
        title: "No activity recorded",
        body: "The day has not started, or the endpoint agent is not reporting.",
      }}
      className="min-h-0"
    >
      <ActivityTimeline
        events={events}
        timezone={timezone}
        className="max-h-[340px] min-h-0 flex-1"
      />
    </MonitorCard>
  );
}

/**
 * The events the provider marked notable, and only those.
 *
 * The reference's `Key Moments` is a five-row list of scoring events with a
 * minute against each — a compressed retelling of the match. This is the same
 * shape over the same day the timeline above shows in full: the timeline is
 * what happened, this is what mattered. Deriving "notable" in the UI would make
 * the two disagree, so the flag comes from the feed.
 */
export function KeyMomentsPanel({
  events,
  timezone,
  loading,
  query,
}: {
  events: ActivityEvent[];
  timezone: string;
  loading: boolean;
  query: Query;
}) {
  const moments = events.filter((e) => e.notable).slice(0, 6);

  return (
    <MonitorCard
      title="Key moments"
      queries={[query]}
      loading={loading}
      empty={{
        when: moments.length === 0,
        title: "Nothing stood out today",
        body: "An ordinary day is the usual answer here.",
      }}
    >
      <ol className="divide-y divide-hairline">
        {moments.map((m) => (
          <li key={m.id}>
            <MomentRow event={m} timezone={timezone} />
          </li>
        ))}
      </ol>
    </MonitorCard>
  );
}

function MomentRow({
  event,
  timezone,
}: {
  event: ActivityEvent;
  timezone: string;
}) {
  const body = (
    <>
      <span data-figure className="w-10 shrink-0 text-[11px] text-ink-muted">
        {clockTime(event.startedAt, timezone)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{event.label}</span>
        {event.detail && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
            {event.detail}
          </span>
        )}
      </span>
      <span data-figure className="shrink-0 text-[11px] text-ink-faint">
        {duration(event.durationSecs)}
      </span>
    </>
  );

  return event.href ? (
    <Link
      href={event.href}
      className="-mx-2 flex items-baseline gap-2.5 rounded-inset px-2 py-2 transition-colors hover:bg-[var(--row-hover)]"
    >
      {body}
    </Link>
  ) : (
    <div className="-mx-2 flex items-baseline gap-2.5 px-2 py-2">{body}</div>
  );
}

/* ══ Centre — the control deck under the live screen ═════════════════════ */

/**
 * The video's own chrome, below the frame rather than over it.
 *
 * The frame already carries what must be legible against moving pixels — the
 * live badge, the elapsed clock, the reason there is no picture. Everything
 * that needs to be *read* rather than *glanced at* sits here on a frosted
 * surface, which is the only way capture state, link quality and three actions
 * can be dense without competing with whatever is on the employee's desktop.
 *
 * The capture row states what is being captured, not what the device is capable
 * of. "Camera off" on a screen-share session is a fact about consent: Cowork
 * monitoring is screen-only, and saying so plainly is better than an ambiguous
 * icon that leaves a manager wondering whether a camera could be turned on.
 */
export function SessionDeck({
  subject,
  device,
  onOpenScreen,
  live,
  loading,
  queries,
}: {
  subject: MonitoringSubject | null;
  device: DeviceInfo | null;
  onOpenScreen: () => void;
  live: boolean;
  loading: boolean;
  queries: Query[];
}) {
  const first = subject?.displayName.split(" ")[0] ?? "them";
  const quality = device?.networkQuality ?? "unknown";
  const qualityInk =
    quality === "good"
      ? "text-[var(--state-positive-ink)]"
      : quality === "poor"
        ? "text-[var(--state-overdue-ink)]"
        : quality === "degraded"
          ? "text-[var(--state-risk-ink)]"
          : "text-ink-muted";

  const surface =
    device?.sharedSurface === "entire_screen"
      ? "Entire screen"
      : device?.sharedSurface === "window"
        ? "One window"
        : device?.sharedSurface === "browser_tab"
          ? "One browser tab"
          : "Nothing shared";

  return (
    <MonitorCard
      title="Session"
      queries={queries}
      loading={loading}
      empty={{
        when: !subject,
        title: "No session",
        body: "Nothing to connect to for this person.",
      }}
    >
      {subject && (
        <>
          {/* Capture and link, as four hairline-separated cells. A row of
              figures rather than a stack of label/value lines: a manager checks
              these at a glance and comparison across the row is the point. */}
          <dl className="-mx-5 grid grid-cols-2 divide-x divide-y divide-hairline border-y border-hairline sm:grid-cols-4 sm:divide-y-0">
            <Cell label="Screen" value={surface} tone={live ? "live" : "idle"} />
            <Cell label="Camera" value="Off" hint="Monitoring is screen-only" />
            <Cell label="Microphone" value="Off" hint="Monitoring is screen-only" />
            <Cell
              label="Link"
              value={
                <span className="inline-flex items-baseline gap-1.5">
                  <span className={qualityInk}>
                    {quality === "unknown" ? "Unknown" : quality}
                  </span>
                  {device?.latencyMs !== null &&
                    device?.latencyMs !== undefined && (
                      <span data-figure className="text-[11px] text-ink-faint">
                        {device.latencyMs} ms
                      </span>
                    )}
                </span>
              }
            />
          </dl>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenScreen}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-[var(--body-bg)] transition-opacity duration-[180ms] ease-[var(--ease-deck)] hover:opacity-90"
            >
              <Icon.play className="h-3.5 w-3.5" />
              Open full screen
            </button>
            <DeckAction
              href={`/messages?to=${subject.employeeId}&intent=update`}
              icon="approvals"
              label="Check in"
            />
            <DeckAction
              href={`/messages?to=${subject.employeeId}`}
              icon="chat"
              label={`Message ${first}`}
            />
            <span className="ml-auto flex shrink-0 items-baseline gap-2">
              {device?.displayCount && device.displayCount > 1 && (
                <span data-figure className="text-[11px] text-ink-faint">
                  {device.displayCount} displays
                </span>
              )}
              {device?.lastSeenAt && (
                <span data-figure className="text-[11px] text-ink-faint">
                  Seen {clockTime(device.lastSeenAt, subject.timezone)}
                </span>
              )}
            </span>
          </div>

          <p className="mt-3 border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-ink-faint">
            {first} started this share and can see it for as long as it lasts.
            Monitoring never runs without it.
            {device && ` ${device.deviceName} · ${device.network}.`}
          </p>
        </>
      )}
    </MonitorCard>
  );
}

function Cell({
  label,
  value,
  hint,
  tone = "idle",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "live" | "idle";
}) {
  return (
    <div className="px-5 py-2.5" title={hint}>
      <dt className="truncate text-[11px] text-ink-faint">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 truncate text-xs text-ink">
        {tone === "live" && (
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--state-positive)]"
            style={{
              boxShadow: "0 0 6px 1px color-mix(in srgb, var(--state-positive) 55%, transparent)",
            }}
          />
        )}
        {value}
      </dd>
    </div>
  );
}

function DeckAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: "chat" | "approvals";
  label: string;
}) {
  const Glyph = Icon[icon];
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--control)] px-4 py-2 text-sm font-medium text-ink transition-colors duration-[180ms] ease-[var(--ease-deck)] hover:bg-[var(--control-hover)]"
    >
      <Glyph className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}

/* ══ Right column ════════════════════════════════════════════════════════ */

/**
 * How committed this person is, as a band rather than a false-precision figure.
 *
 * The meter is neutral ink until the band turns heavy, at which point it takes
 * the state palette — never a channel hue. Over-capacity fills the whole track
 * and switches tone rather than overflowing it: "past capacity" is a state, not
 * an ambiguous bar longer than its container.
 */
export function WorkloadPanel({
  row,
  performance,
  loading,
  queries,
}: {
  row: TeamMonitoringRow | null;
  performance: MonitoringPerformance | null;
  loading: boolean;
  queries: Query[];
}) {
  const pct = row?.workloadPercent ?? 0;
  const band = row?.workloadBand ?? "balanced";
  const tone =
    band === "overloaded" ? "overdue" : band === "heavy" ? "risk" : "default";

  return (
    <MonitorCard
      title="Workload"
      queries={queries}
      loading={loading}
      headerRight={
        row ? (
          <Chip
            tone={
              band === "overloaded"
                ? "overdue"
                : band === "heavy"
                  ? "risk"
                  : band === "balanced"
                    ? "positive"
                    : "neutral"
            }
          >
            {BAND_LABEL[band]}
          </Chip>
        ) : undefined
      }
      empty={{
        when: !row,
        title: "No workload reading",
        body: "Capacity is reported for people in your direct line.",
      }}
    >
      {row && (
        <>
          <p className="flex items-baseline gap-1.5">
            <span
              data-figure
              className="text-[28px] leading-none tracking-[-0.03em] text-ink"
            >
              {Math.round(pct)}%
            </span>
            <span className="text-xs text-ink-faint">of committed capacity</span>
          </p>
          <Meter
            value={pct}
            announce={Math.round(pct)}
            label="Committed capacity"
            tone={tone}
            className="mt-2.5"
          />

          <dl className="mt-3.5 grid grid-cols-3 gap-x-3 border-t border-hairline pt-3">
            <Stat label="Open" value={String(row.openTasks)} />
            <Stat label="Overdue" value={String(row.overdueTasks)} />
            <Stat
              label="Done today"
              value={String(performance?.tasksCompletedToday ?? 0)}
            />
          </dl>
        </>
      )}
    </MonitorCard>
  );
}

const BAND_LABEL = {
  light: "Light",
  balanced: "Balanced",
  heavy: "Heavy",
  overloaded: "Past capacity",
} as const;

/**
 * What stands out about the day, with the measurement behind each claim.
 *
 * This is the panel the reference fills with a model's win probability. Cowork
 * is explicitly not an AI product — a binding constraint that reaches labels and
 * microcopy — so the same slot carries stated observations instead, and each one
 * renders its `basis`. The difference is not cosmetic: a manager can argue with
 * "open assignments against remaining scheduled hours" and cannot argue with a
 * percentage from an oracle.
 */
export function ObservationsPanel({
  observations,
  loading,
  query,
}: {
  observations: Observation[];
  loading: boolean;
  query: Query;
}) {
  const items = [...observations].sort((a, b) => b.weight - a.weight);

  return (
    <MonitorCard
      title="What stands out"
      queries={[query]}
      loading={loading}
      headerRight={
        items.length > 0 ? (
          <span data-figure className="text-xs text-ink-faint">
            {items.length}
          </span>
        ) : undefined
      }
      empty={{
        when: items.length === 0,
        title: "Nothing to flag",
        body: "The day reads as ordinary against this person's own trailing week.",
      }}
    >
      <ul className="divide-y divide-hairline">
        {items.map((o) => (
          <li key={o.id} className="py-2.5 first:pt-0 last:pb-0">
            <p className="text-xs leading-snug font-medium text-ink">
              {o.title}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              {o.detail}
            </p>
            {/* The basis is the point of the panel, so it is a rendered line
                rather than a tooltip. Prefixed with a glyph so it reads as
                provenance rather than as more claim. */}
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-faint">
              <Icon.history
                aria-hidden="true"
                className="mt-px h-3 w-3 shrink-0"
              />
              <span className="min-w-0">{o.basis}</span>
            </p>
            {o.action && (
              <Link
                href={o.action.href}
                className="group mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-ink"
              >
                {o.action.label}
                <Icon.chevronRight className="h-3 w-3 transition-transform duration-[180ms] ease-[var(--ease-deck)] group-hover:translate-x-0.5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </MonitorCard>
  );
}

/**
 * Who this person is working with, from the work itself.
 *
 * There is no collaboration feed in Cowork and inventing one would mean showing
 * a manager a number nothing computes. What the product genuinely knows is the
 * counterpart on every task — who raised the work assigned to this person, and
 * who is carrying the work they raised — plus the meetings already in the
 * activity timeline. Both are facts, and both are the actual answer to "who are
 * they in the loop with today".
 */
export function CollaborationPanel({
  counterparts,
  meetings,
  timezone,
  loading,
  queries,
}: {
  counterparts: { person: Employee; shared: number; direction: "from" | "to" }[];
  meetings: ActivityEvent[];
  timezone: string;
  loading: boolean;
  queries: Query[];
}) {
  const empty = counterparts.length === 0 && meetings.length === 0;

  return (
    <MonitorCard
      title="Working with"
      queries={queries}
      loading={loading}
      empty={{
        when: empty,
        title: "No shared work today",
        body: "Nobody is on the other side of this person's open tasks.",
      }}
    >
      {!empty && (
        <>
          <ul className="divide-y divide-hairline">
            {counterparts.slice(0, 4).map((c) => (
              <li key={`${c.person.id}-${c.direction}`}>
                <Link
                  href={`/team/${c.person.id}`}
                  className="-mx-2 flex items-center gap-2.5 rounded-inset px-2 py-2 transition-colors hover:bg-[var(--row-hover)]"
                >
                  <Avatar
                    initials={c.person.initials}
                    hue={c.person.hue}
                    src={c.person.profilePictureUrl}
                    name={c.person.displayName}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-ink">
                      {c.person.displayName}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                      {c.direction === "from"
                        ? "Raised work they are carrying"
                        : "Carrying work they raised"}
                    </span>
                  </span>
                  <span
                    data-figure
                    className="shrink-0 text-[11px] text-ink-muted"
                  >
                    {c.shared}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {meetings.length > 0 && (
            <div className="mt-2.5 border-t border-hairline pt-2.5">
              <p className="mb-1.5 text-[11px] text-ink-faint">
                In meetings today
              </p>
              <ul className="space-y-1.5">
                {meetings.slice(0, 3).map((m) => (
                  <li key={m.id} className="flex items-baseline gap-2">
                    <span
                      data-figure
                      className="w-10 shrink-0 text-[11px] text-ink-muted"
                    >
                      {clockTime(m.startedAt, timezone)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">
                      {m.label}
                    </span>
                    <span
                      data-figure
                      className="shrink-0 text-[11px] text-ink-faint"
                    >
                      {duration(m.durationSecs)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </MonitorCard>
  );
}

/* ══ Bottom — performance ════════════════════════════════════════════════ */

/**
 * The composite, its trailing readings, and the two counts underneath it.
 *
 * The trend is a line rather than four numbers because the question this panel
 * answers is "which way is this going", and a single trailing figure cannot
 * answer it. It stays neutral ink: a productivity reading is a composite of all
 * four channels, so giving it any one channel's hue would claim a component it
 * is not.
 */
export function PerformancePanel({
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
  const trend = summary?.trend ?? [];
  const delta = performance?.trend ?? 0;

  return (
    <MonitorCard
      title="Performance"
      href="/score"
      hrefLabel="Open the score surface"
      queries={queries}
      loading={loading}
      empty={{ when: !performance, title: "No performance reading" }}
    >
      {performance && (
        <>
          <div className="flex items-end justify-between gap-4">
            <p className="flex items-baseline gap-2">
              <span
                data-figure
                className="text-[28px] leading-none tracking-[-0.03em] text-ink"
              >
                {Math.round(performance.productivityScore)}%
              </span>
              <TrendPill delta={delta} />
            </p>
            {performance.provisional && <ProvisionalBadge label="Productivity" />}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Composite of C1–C4, as the scoring engine states it.
          </p>

          {trend.length > 1 && (
            <div className="mt-3">
              <Sparkline
                points={trend.map((t) => t.value)}
                label={`Daily readings, ${trend.length} days to ${trend[trend.length - 1].date}`}
              />
              <p className="mt-1 flex justify-between text-[11px] text-ink-faint">
                <span data-figure>{formatDate(trend[0].date)}</span>
                <span data-figure>
                  {formatDate(trend[trend.length - 1].date)}
                </span>
              </p>
            </div>
          )}

          <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-3">
            <Stat
              label="Active today"
              value={duration(performance.activeSecondsToday)}
            />
            <Stat
              label="Focus today"
              value={duration(performance.focusSecondsToday)}
            />
            <Stat label="Open tasks" value={String(performance.tasksOpen)} />
            <Stat
              label="Attendance"
              value={`${Math.round(performance.attendanceRate)}%`}
            />
          </dl>
        </>
      )}
    </MonitorCard>
  );
}

function TrendPill({ delta }: { delta: number }) {
  if (delta === 0)
    return <span className="text-[11px] text-ink-faint">No change</span>;
  const up = delta > 0;
  return (
    <span
      data-figure
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        up
          ? "bg-[color-mix(in_srgb,var(--state-positive)_20%,transparent)] text-[var(--state-positive-ink)]"
          : "bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)] text-[var(--state-overdue-ink)]"
      }`}
    >
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      {Math.abs(delta)}
      <span className="sr-only">
        {up ? "up" : "down"} {Math.abs(delta)} points on the previous period
      </span>
    </span>
  );
}

/**
 * How today's work landed, and the quality signals behind it.
 *
 * "Achievements" in Cowork is not a badge system — Product Principle 2 is
 * explicit that the score informs rather than becomes the job, and a trophy
 * shelf is the shortest route to the opposite. What a person has actually
 * achieved is what they finished and how it landed, so completions carry their
 * outcome: on time, late, reworked or extended. That is C1 signal, stated, not
 * a verdict.
 */
export function AchievementsPanel({
  summary,
  loading,
  query,
}: {
  summary: DailySummary | null;
  loading: boolean;
  query: Query;
}) {
  const completed = summary?.completed ?? [];
  const quality = summary?.quality ?? [];

  return (
    <MonitorCard
      title="Landed today"
      queries={[query]}
      loading={loading}
      headerRight={
        completed.length > 0 ? (
          <span data-figure className="text-xs text-ink-faint">
            {completed.length}
          </span>
        ) : undefined
      }
      empty={{
        when: completed.length === 0 && quality.length === 0,
        title: "Nothing completed yet",
        body: "Completions appear here as they are submitted and approved.",
      }}
    >
      {/* This panel runs the full width of the deck, so completions and the
          quality signals sit side by side rather than stacked: they are two
          readings of the same day — what landed, and how well it landed — and
          reading them against each other is the point. The quality column is
          fixed rather than fluid so its three figures stay in a comparable
          row instead of stretching apart on a wide monitor. */}
      <div className="grid gap-x-8 gap-y-4 deck:grid-cols-[minmax(0,1fr)_380px]">
        {completed.length > 0 ? (
          <ul className="divide-y divide-hairline">
            {completed.map((c) => (
              <li key={c.id}>
                <CompletionRow item={c} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-xs text-ink-faint">
            Nothing has been completed yet today.
          </p>
        )}

        {quality.length > 0 && (
          <dl className="grid grid-cols-3 gap-x-4 border-t border-hairline pt-3 deck:border-t-0 deck:border-l deck:border-hairline deck:pt-0 deck:pl-8">
            {quality.map((q) => (
              <div key={q.id} className="min-w-0">
                <dt className="truncate text-[11px] text-ink-faint">
                  {q.label}
                </dt>
                <dd className="mt-1 flex items-baseline gap-1.5">
                  <span
                    data-figure
                    className="text-[22px] leading-none tracking-[-0.025em] text-ink"
                  >
                    {q.value}
                    {q.unit}
                  </span>
                  <QualityTrend metric={q} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </MonitorCard>
  );
}

function CompletionRow({
  item,
}: {
  item: NonNullable<DailySummary["completed"]>[number];
}) {
  const tone =
    item.outcome === "on_time"
      ? "positive"
      : item.outcome === "reworked"
        ? "rework"
        : item.outcome === "extended"
          ? "extension"
          : "overdue";
  const label =
    item.outcome === "on_time"
      ? "On time"
      : item.outcome === "reworked"
        ? "Reworked"
        : item.outcome === "extended"
          ? "Extended"
          : "Late";

  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-xs text-ink">
        {item.title}
      </span>
      <Chip tone={tone}>{label}</Chip>
    </>
  );

  return item.href ? (
    <Link
      href={item.href}
      className="-mx-2 flex items-center gap-2.5 rounded-inset px-2 py-2 transition-colors hover:bg-[var(--row-hover)]"
    >
      {body}
    </Link>
  ) : (
    <div className="-mx-2 flex items-center gap-2.5 px-2 py-2">{body}</div>
  );
}

/**
 * The arrow means "better" or "worse", never "up" or "down".
 *
 * Rework rate rising four points is a worse result and a positive number, and a
 * green up-arrow against it would read as praise for the wrong thing. Direction
 * comes from `betterWhen`, which is why the metric carries it.
 */
function QualityTrend({
  metric,
}: {
  metric: NonNullable<DailySummary["quality"]>[number];
}) {
  if (metric.trend === 0) return null;
  const rising = metric.trend > 0;
  const better = metric.betterWhen === "higher" ? rising : !rising;
  return (
    <span
      data-figure
      className={`text-[11px] ${
        better
          ? "text-[var(--state-positive-ink)]"
          : "text-[var(--state-rework-ink)]"
      }`}
      title={`${rising ? "Up" : "Down"} ${Math.abs(metric.trend)} — ${better ? "an improvement" : "a decline"}`}
    >
      {rising ? "↑" : "↓"}
      {Math.abs(metric.trend)}
    </span>
  );
}

/** Goal attainment — C2's inputs, as the person's own targets. */
export function GoalsPanel({
  goals,
  loading,
  query,
}: {
  goals: Goal[];
  loading: boolean;
  query: Query;
}) {
  const active = goals.filter(
    (g) => g.status === "active" || g.status === "completed",
  );

  return (
    <MonitorCard
      title="Goals"
      href="/goals"
      hrefLabel="Open goals"
      queries={[query]}
      loading={loading}
      empty={{
        when: active.length === 0,
        title: "No goals set for this period",
        body: "C2 · Goals contributes nothing until goals are authored.",
      }}
    >
      <ul className="divide-y divide-hairline">
        {active.slice(0, 5).map((g) => {
          const pct =
            g.targetValue && g.targetValue > 0
              ? (g.achievedValue / g.targetValue) * 100
              : g.status === "completed"
                ? 100
                : 0;
          return (
            <li key={g.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-ink">
                  {g.title}
                </span>
                {g.status === "completed" ? (
                  <Chip tone="positive">Attained</Chip>
                ) : (
                  <span data-figure className="shrink-0 text-[11px] text-ink-muted">
                    {g.achievedValue}
                    {g.targetValue !== null && ` / ${g.targetValue}`}
                    {g.unit ? ` ${g.unit}` : ""}
                  </span>
                )}
              </div>
              <Meter
                value={pct}
                announce={Math.round(pct)}
                label={`${g.title} attainment`}
                className="mt-1.5"
              />
            </li>
          );
        })}
      </ul>
    </MonitorCard>
  );
}

/**
 * Score contribution, on the slab, as four independent channels.
 *
 * The band is Cowork's most distinctive data component and it is load-bearing
 * here: this is the one panel on the page that answers "what is this person's
 * work worth", and docs/architecture/DESIGN.md puts that on the measurement material. Rendered
 * through the shared `ComponentBand`, so The No Weighting Rule and The Deduction
 * Hangs Rule hold without this file restating them.
 */
export function ScoreContributionPanel({
  score,
  children,
}: {
  score: ScoreOverview | null;
  children: ReactNode;
}) {
  return (
    /* `overflow-hidden` is load-bearing, not tidiness: `.slab` composes the
       stepped silhouette from two pseudo-elements, so the bare class draws a
       raised tab whether or not the card wants one. This card is a plain
       measurement surface — the view's one step belongs to the person at the
       top — and clipping is how the material is borrowed without the shape. */
    <section
      aria-label="Score contribution"
      className="slab slab-flat flex h-full flex-col rounded-card px-5 pt-4 pb-4"
      data-on-slab
    >
      <div className="flex items-baseline gap-3">
        <h2 className="min-w-0 truncate text-[17px] leading-none font-medium tracking-[-0.02em] text-slab-ink">
          Score contribution
        </h2>
        {score && (
          <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
            <span
              data-figure
              className="text-[22px] leading-none tracking-[-0.025em] text-slab-ink"
            >
              {Math.round(score.overallPercentage)}%
            </span>
            <span data-figure className="text-[11px] text-slab-ink-muted">
              {score.delta >= 0 ? "↑" : "↓"}
              {Math.abs(Math.round(score.delta))}
            </span>
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-slab-ink-muted">
        Achieved against achievable. Four independent channels — never summed.
      </p>
      <div className="mt-auto pt-4">{children}</div>
    </section>
  );
}
