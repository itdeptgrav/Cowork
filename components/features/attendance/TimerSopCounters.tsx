"use client";

import { Meter, Panel, ProvisionalBadge } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { useNow } from "@/lib/hooks/useNow";
import { useTicker } from "@/components/features/tasks/TimerControl";
import { liveRunSecsForDay } from "@/lib/rules/scoring/workTime";
import { timerDisplayState } from "@/lib/rules/tasks/timer";
import {
  targetProgressPercent,
  withLiveRun,
  type TodayTarget,
} from "@/lib/rules/scoring/timerSop";

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

  /* **The clock that is running right now.**
     `getActiveTimer` reads the ACTING employee's sessions, so it can only ever
     answer for the viewer. On a manager looking at somebody else's card it is
     not asked — showing the manager's own running timer inside a report's
     figures would be worse than showing none. */
  const isSelf = !employeeId || employeeId === viewerId;
  const active = useQuery(
    (r) => (isSelf ? r.getActiveTimer() : Promise.resolve(null)),
    [isSelf],
  );
  /* Minute granularity, and all it decides is staleness — the per-second
     figure comes from the ticker, so nothing calls `Date.now()` in render. */
  const nowMs = (useNow() ?? new Date(0)).getTime();
  const session = active.data;
  const running =
    timerDisplayState(session, session?.accumulatedSecs ?? 0, nowMs) ===
    "running";
  const ticked = useTicker(running ? (session?.startedAtRealMs ?? null) : null);

  if (isLoading || !data) return null;

  const { config, result } = data;

  /* `now` reconstructed from the ticker rather than read fresh: the interval
     is what drives the repaint, and deriving the instant from it is what keeps
     the figure and the redraw describing the same moment. */
  const startedAtRealMs = session?.startedAtRealMs ?? null;
  const nowRealMs =
    running && startedAtRealMs !== null ? startedAtRealMs + ticked * 1000 : nowMs;
  const liveSecs = data.today
    ? liveRunSecsForDay({
        startedAtRealMs,
        isRunning: running,
        nowRealMs,
        date: data.today.date,
      })
    : 0;
  /* One fold, at the top. Everything below reads the same numbers. */
  const today = data.today ? withLiveRun(data.today, liveSecs) : null;

  /**
   * **The engine off means the card is gone, not that it explains itself.**
   *
   * This used to render a panel saying "The Timer SOP engine is paused" — a
   * box that occupies the top of everybody's score page, every day, to announce
   * that a feature they may never have seen is not running. It is a statement
   * about administrative configuration standing where a person's own figures
   * belong, and there is nothing they can do about it: only an administrator
   * can switch it back on, and an administrator finds out from the switch, not
   * from this.
   *
   * `config.enabled` rather than `result.paused`, even though the two agree
   * today. `paused` is the ENGINE's word for "I did not evaluate anything",
   * which a future transport failure could also produce; `enabled` is the
   * administrator's setting, and the setting is what this is about.
   */
  if (!config.enabled) return null;

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

          <TimeWorked today={today} liveSecs={liveSecs} />

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

/**
 * Time actually put on the clock today, against the target.
 *
 * This is the only place the card shows what task timers have RUN, and it was
 * missing: the target line and the remainder are both derived from this
 * figure, so a card without it asked people to subtract in their heads to
 * learn whether any work had been tracked at all.
 *
 * It counts banked timer segments plus whatever the clock running right now
 * has added since it started. Time on a task and nothing else — not time at a
 * desk, and not time signed in.
 *
 * The bar is neutral ink rather than a state colour: saturated colour in
 * Cowork means "score component", and this is progress, not a channel. The
 * two counters below it are state-coloured because a full counter genuinely
 * moves points.
 */
function TimeWorked({
  today,
  liveSecs,
}: {
  today: TodayTarget;
  liveSecs: number;
}) {
  const pct = targetProgressPercent(today);

  return (
    <div className="mt-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span data-figure className="text-2xl font-light tracking-tight text-ink">
          {hoursLabel(today.workedHours)}
        </span>
        <span className="text-xs text-ink-faint">
          {today.isOff
            ? "tracked on task timers today"
            : `tracked on task timers / ${hoursLabel(today.targetHours)} target`}
        </span>
      </p>
      {!today.isOff && (
        <Meter
          value={pct}
          label={`${hoursLabel(today.workedHours)} of today's ${hoursLabel(
            today.targetHours,
          )} target`}
          className="mt-2"
        />
      )}
      <p className="mt-1.5 text-[11px] text-ink-faint">
        {workedNote(today, pct, liveSecs)}
      </p>
    </div>
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
    return `${today.percent}% of your window today — ${login} login to ${close} close (${hoursLabel(today.spanHours)})${deductions(today)} = ${hoursLabel(today.windowHours)} × ${today.percent}% = ${hoursLabel(today.targetHours)}`;
  }
  return `A fixed daily minimum of ${config.dailyMinHours}h (your window today is ${login} to ${close}).`;
}

/**
 * The break time taken off the span, named so the sum on screen adds up.
 *
 * Without this the line read "login to close (16.83h)" while login to close
 * was plainly 18h 20m, and the missing 90 minutes had no explanation anywhere
 * on the card. A person checking our arithmetic against their own clock has to
 * be able to finish the sum.
 */
function deductions(today: TodayTarget): string {
  const parts: string[] = [];
  if (today.breakHours > 0) parts.push(`${hoursLabel(today.breakHours)} of breaks`);
  if (today.allowanceHours > 0)
    parts.push(`your ${hoursLabel(today.allowanceHours)} break allowance`);
  return parts.length ? ` less ${parts.join(" and ")}` : "";
}

/**
 * What the worked figure counts — the one thing no other line on the card says.
 *
 * Deliberately not a restatement of the banner's remainder. Two things people
 * get wrong about this number, and each is answered in the case that raises it:
 *
 * - **Zero when they have been at work all morning.** Only time on a task
 *   counts. Being signed in, in a meeting, or reading is not tracked work, and
 *   `0m` is the honest figure rather than a fault.
 * - **Whether the clock ticking on the task row is in it.** It is, and how much
 *   of the total it is, is named — because that part is not banked yet and will
 *   read differently the moment the timer stops.
 */
function workedNote(
  today: TodayTarget,
  pct: number,
  liveSecs: number,
): string {
  const live =
    liveSecs > 0
      ? ` Counting up — ${hoursLabel(liveSecs / 3600)} of this is a timer still running.`
      : "";
  if (today.workedHours <= 0)
    return "No task timer has run today yet. Only time on a task counts, not time signed in.";
  if (today.isOff)
    return `Today is a day off, so all of it counts toward overtime.${live}`;
  return `${pct}% of today's target.${live}`;
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
