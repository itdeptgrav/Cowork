"use client";

import { Panel, ProvisionalBadge } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import type { TodayTarget } from "@/lib/rules/scoring/timerSop";

/**
 * "Today's Work" — the user-facing face of the Timer SOP Point Engine, ported
 * from the legacy SOP page. It shows today's target (your window × the daily
 * minimum), how much time is left to reach it, and the running Deficit and
 * Overtime counters. All of it is driven by real tracked work time; every rate
 * and threshold is unconfirmed (O5), so the whole card is badged provisional.
 */
export function TimerSopCounters({ employeeId }: { employeeId?: string }) {
  const viewerId = useViewerId();
  const subject = employeeId ?? viewerId ?? "";
  const { data, isLoading } = useQuery(
    (r) => r.getTimerSopStatus(subject),
    [subject],
  );

  if (isLoading || !data) return null;

  const { config, result, today } = data;

  if (result.paused && !today) {
    return (
      <Panel className="mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-ink">Today&rsquo;s Work</h2>
          <ProvisionalBadge decisionId="O5" label="Timer SOP" />
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          The Timer SOP engine is paused. Deficit and overtime are not being
          counted, and no points are being cut or added.
        </p>
      </Panel>
    );
  }

  return (
    <Panel padded={false} className="mb-4 overflow-hidden">
      <div className="flex items-center gap-2 bg-[var(--slab-bg,#1e40af)] px-5 py-3 text-[var(--slab-ink,#fff)]">
        <span aria-hidden>⏱</span>
        <h2 className="text-sm font-semibold">
          Today&rsquo;s Work{today ? ` — ${formatDay(today.date)}` : ""}
        </h2>
        <span className="ml-auto">
          <ProvisionalBadge decisionId="O5" label="Timer SOP" />
        </span>
      </div>

      {today && (
        <div className="border-b border-hairline px-5 py-4">
          <p className="text-[11px] font-medium tracking-[0.09em] text-ink-faint uppercase">
            Today&rsquo;s target
          </p>
          <p className="mt-2 text-xs text-ink-muted">{targetLine(today, config)}</p>
          <p
            className={`mt-3 rounded-inset px-3 py-2 text-xs ${
              today.isOff || today.met
                ? "bg-[var(--state-positive-surface,var(--surface-sunken))] text-ink-muted"
                : "bg-[var(--state-rework-surface,var(--surface-sunken))] text-ink"
            }`}
          >
            {bannerLine(today)}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 divide-y divide-hairline sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <Counter
          tone="deficit"
          title="Deficit Counter"
          accumHours={result.deficitAccumHours}
          thresholdHours={config.deficitThresholdHours}
          stepPoints={config.deficitPoints}
          verb="cut"
          sign="−"
        />
        <Counter
          tone="overtime"
          title="Overtime Counter"
          accumHours={result.overtimeAccumHours}
          thresholdHours={config.overtimeThresholdHours}
          stepPoints={config.overtimePoints}
          verb="added"
          sign="+"
        />
      </div>

      <details className="border-t border-hairline px-5 py-3">
        <summary className="cursor-pointer text-xs text-ink-muted">
          How points are calculated
        </summary>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-faint">
          <li>
            Each working day, time short of your target adds to the Deficit
            Counter. When it reaches {config.deficitThresholdHours}h, {config.deficitPoints} pts are
            cut and the counter drops by the threshold — the remainder carries
            forward.
          </li>
          <li>
            Time worked after office close adds to the Overtime Counter. When it
            reaches {config.overtimeThresholdHours}h, {config.overtimePoints} pts are added and it
            drops by the threshold the same way.
          </li>
          <li>
            The daily target, thresholds and point amounts are all placeholders
            until confirmed, so these figures are provisional.
          </li>
        </ul>
      </details>
    </Panel>
  );
}

function Counter({
  tone,
  title,
  accumHours,
  thresholdHours,
  stepPoints,
  verb,
  sign,
}: {
  tone: "deficit" | "overtime";
  title: string;
  accumHours: number;
  thresholdHours: number;
  stepPoints: number;
  verb: "cut" | "added";
  sign: "−" | "+";
}) {
  const pct =
    thresholdHours > 0
      ? Math.min(100, Math.round((accumHours / thresholdHours) * 100))
      : 0;
  const ink =
    tone === "deficit" ? "var(--state-rework-ink)" : "var(--state-positive-ink)";
  const bar =
    tone === "deficit" ? "var(--state-rework)" : "var(--state-positive)";

  return (
    <div className="px-5 py-4">
      <p
        className="text-[11px] font-medium tracking-[0.09em] uppercase"
        style={{ color: ink }}
      >
        {title}
      </p>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span data-figure className="text-2xl font-light tracking-tight" style={{ color: ink }}>
          {Math.round(accumHours * 60)}min
        </span>
        <span className="text-xs text-ink-faint">/ {thresholdHours}h</span>
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--control)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: bar }} />
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        Full ={" "}
        <span data-figure style={{ color: ink }}>
          {sign}
          {stepPoints} pts
        </span>{" "}
        {verb}, counter restarts
      </p>
    </div>
  );
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function clock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const ap = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

function hoursLabel(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function targetLine(
  today: TodayTarget,
  config: { dailyMinHours: number },
): string {
  if (today.isOff) {
    return "Today is a day off — there is no target, and all worked time counts as overtime.";
  }
  const login = today.loginMinute !== null ? clock(today.loginMinute) : "office open";
  const close = clock(today.closeMinute);
  if (today.usesPercent) {
    return `${today.percent}% of your window today — ${login} login to ${close} close (${today.windowHours}h) = ${today.windowHours}h × ${today.percent}% = ${today.targetHours}h`;
  }
  return `A fixed daily minimum of ${config.dailyMinHours}h (your window today is ${login} to ${close}).`;
}

function bannerLine(today: TodayTarget): string {
  if (today.isOff) {
    return "Day off — nothing is required today. Any time you do work counts toward overtime.";
  }
  if (today.met) {
    return "Target met. Time worked after close now goes into your Overtime Counter.";
  }
  return `${hoursLabel(today.remainingHours)} left to reach today's target. Whatever is still missing at day-end goes into your Deficit Counter.`;
}
