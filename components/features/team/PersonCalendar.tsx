"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icons";
import {
  EmptyState,
  Panel,
  Segmented,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { isOpen } from "@/components/features/dashboard/signals";
import {
  atMinutes,
  keyOfDate,
  parseKey,
  scheduleBusinessTime,
  WORK_END_MINUTES,
  WORK_START_MINUTES,
  type ScheduledSpan,
} from "@/lib/rules/tasks/workload";
import { formatDate } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * A person's workload as a full calendar page — the nested "Calendar" tab.
 *
 * The load matters, but so does its SHAPE in time. A person can't do two things
 * at the same moment, but a day has hours — so this lays the queue across working
 * time (Mon–Fri, 09:00–18:30): each task takes its time budget starting where the
 * last ended, several small tasks share a day, a long one spills across several,
 * and nothing ever overlaps. Months/weeks read as time-stamped chips; a picked
 * day opens into an hour-by-hour breakdown. Built in Cowork's own material and
 * state palette, not a borrowed calendar skin.
 */

/** The day a task is projected to finish: its real finish, else its due date. */
export function taskLandingDate(v: TaskView): string | null {
  const d = v.task.deadline;
  return d.operationalDueAt ?? d.dueAt ?? d.officialDueAt;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** A default budget when a task carries none, so it still takes a real slot. */
const DEFAULT_TASK_SECS = 2 * 3600;

interface Slot {
  v: TaskView;
  segStart: number;
  segEnd: number;
}

/** A task's colour, from Cowork's state palette — never a raw hue. */
function toneOf(v: TaskView): { backgroundColor: string; color: string } {
  const key = v.isOverdue
    ? "overdue"
    : v.task.isBlocked
      ? "blocked"
      : v.task.status === "in_review"
        ? "risk"
        : null;
  if (!key) return { backgroundColor: "var(--control)", color: "var(--ink)" };
  return {
    backgroundColor: `color-mix(in srgb, var(--state-${key}) 26%, transparent)`,
    color: `var(--state-${key}-ink)`,
  };
}

function startOfWeek(d: Date): Date {
  const wd = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd);
}
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

/** The weekday keys a scheduled span touches. */
function touchedWeekdays(startMs: number, endMs: number): string[] {
  const keys: string[] = [];
  const c = new Date(startMs);
  c.setHours(0, 0, 0, 0);
  const last = new Date(endMs - 1);
  for (let guard = 0; guard < 400 && c.getTime() <= last.getTime(); guard++) {
    const g = c.getDay();
    if (g !== 0 && g !== 6) keys.push(keyOfDate(c));
    c.setDate(c.getDate() + 1);
  }
  return keys;
}

/** A span clamped to one day's working window. */
function segmentOnDay(
  span: ScheduledSpan,
  key: string,
): { start: number; end: number } {
  const base = parseKey(key);
  const d0 = atMinutes(base, WORK_START_MINUTES);
  const d1 = atMinutes(base, WORK_END_MINUTES);
  return {
    start: Math.max(span.startMs, d0.getTime()),
    end: Math.min(span.endMs, d1.getTime()),
  };
}

export function PersonCalendar({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery(
    (r) =>
      r
        .listTasks({ scope: "all", assigneeId: employeeId, limit: 500 })
        .then((p) => p.items),
    [employeeId],
  );
  const tasks = data ?? [];
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [ref, setRef] = useState<Date>(() => new Date());
  /* One stable "now" for the whole render — the schedule is pure given it, and
     the purity lint is satisfied (a useState initialiser may read the clock). */
  const [nowMs] = useState(() => Date.now());
  const todayKey = keyOfDate(new Date(nowMs));
  const [selected, setSelected] = useState<string>(todayKey);

  /* Order the OPEN queue by projected finish (its queue position), then lay it
     across working time — one task at a time. */
  const openTasks = tasks
    .filter(isOpen)
    .slice()
    .sort((a, b) => {
      const ax = taskLandingDate(a) ?? "9999-99-99";
      const bx = taskLandingDate(b) ?? "9999-99-99";
      return ax.localeCompare(bx) || a.task.title.localeCompare(b.task.title);
    });

  const spans = scheduleBusinessTime(
    openTasks.map((v) => ({
      id: v.task.id,
      secs:
        v.task.deadline.currentWindowSecs ??
        v.task.estimatedEffortSecs ??
        DEFAULT_TASK_SECS,
    })),
    nowMs,
  );
  const spanById = new Map(spans.map((s) => [s.id, s]));

  const perDay = new Map<string, Slot[]>();
  for (const v of openTasks) {
    const span = spanById.get(v.task.id);
    if (!span) continue;
    for (const key of touchedWeekdays(span.startMs, span.endMs)) {
      const seg = segmentOnDay(span, key);
      if (seg.end <= seg.start) continue;
      const arr = perDay.get(key);
      const slot: Slot = { v, segStart: seg.start, segEnd: seg.end };
      if (arr) arr.push(slot);
      else perDay.set(key, [slot]);
    }
  }
  for (const arr of perDay.values())
    arr.sort((a, b) => a.segStart - b.segStart);
  const runway = spans.length
    ? keyOfDate(new Date(Math.max(...spans.map((s) => s.endMs))))
    : null;

  const total = tasks.length;
  const open = openTasks.length;
  const inReview = tasks.filter((t) => t.task.status === "in_review").length;
  const completed = tasks.filter((t) => t.task.status === "completed").length;
  const overdue = tasks.filter((t) => t.isOverdue).length;

  const shift = (dir: -1 | 1) => {
    if (view === "day") {
      setSelected((k) => {
        const d = parseKey(k);
        d.setDate(d.getDate() + dir);
        return keyOfDate(d);
      });
      return;
    }
    setRef((d) =>
      view === "month"
        ? new Date(d.getFullYear(), d.getMonth() + dir, 1)
        : new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir * 7),
    );
  };

  const label =
    view === "day"
      ? new Date(`${selected}T00:00:00`).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : view === "month"
        ? ref.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
        : (() => {
            const mon = startOfWeek(ref);
            const sun = new Date(
              mon.getFullYear(),
              mon.getMonth(),
              mon.getDate() + 6,
            );
            const f = (x: Date) =>
              x.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return `${f(mon)} – ${f(sun)}`;
          })();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 deck:grid-cols-5">
        <Stat
          label="Total tasks"
          value={total}
          loading={isLoading}
          icon="tasks"
        />
        <Stat label="Open" value={open} loading={isLoading} icon="tasks" />
        <Stat
          label="In review"
          value={inReview}
          loading={isLoading}
          icon="overview"
        />
        <Stat
          label="Completed"
          value={completed}
          tone="positive"
          loading={isLoading}
          icon="tasks"
        />
        <Stat
          label="Overdue"
          value={overdue}
          tone="overdue"
          loading={isLoading}
          icon="clock"
        />
      </div>

      <Panel padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
          <span className="text-sm font-medium text-ink">{label}</span>
          {runway && (
            <span className="hidden items-center gap-1.5 rounded-full bg-[var(--control)] px-2.5 py-0.5 text-[11px] text-ink-muted sm:inline-flex">
              Booked through{" "}
              <span data-figure className="text-ink">
                {formatDate(`${runway}T00:00:00`)}
              </span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <NavButton label="Previous" onClick={() => shift(-1)}>
              ‹
            </NavButton>
            <button
              type="button"
              onClick={() => {
                setRef(new Date());
                setSelected(todayKey);
              }}
              className="rounded-full bg-[var(--control)] px-3 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
            >
              Today
            </button>
            <NavButton label="Next" onClick={() => shift(1)}>
              ›
            </NavButton>
            <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />
            <Segmented
              label="Calendar view"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { id: "month", label: "Month" },
                { id: "week", label: "Week" },
                { id: "day", label: "Day" },
              ]}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : open === 0 ? (
          <EmptyState
            title="No open workload"
            body="Nothing is queued for this person right now."
          />
        ) : view === "month" ? (
          <MonthGrid
            refDate={ref}
            perDay={perDay}
            todayKey={todayKey}
            selected={selected}
            onSelect={(key) => {
              setSelected(key);
              setView("day");
            }}
          />
        ) : view === "week" ? (
          <WeekGrid
            refDate={ref}
            perDay={perDay}
            todayKey={todayKey}
            onSelectDay={(key) => {
              setSelected(key);
              setView("day");
            }}
          />
        ) : (
          <DayTimeline
            day={selected}
            slots={perDay.get(selected) ?? []}
            nowMs={nowMs}
            todayKey={todayKey}
          />
        )}
      </Panel>
    </div>
  );
}

/* ── Month ────────────────────────────────────────────────────────────────── */

function MonthGrid({
  refDate,
  perDay,
  todayKey,
  selected,
  onSelect,
}: {
  refDate: Date;
  perDay: Map<string, Slot[]>;
  todayKey: string;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-hairline">
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            className="px-2 py-1.5 text-[10px] tracking-wide text-ink-faint uppercase"
          >
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date)
            return (
              <div
                key={i}
                aria-hidden="true"
                className="min-h-[104px] border-r border-b border-hairline bg-[var(--surface-sunken)]/50 last:border-r-0"
              />
            );
          const dow = (date.getDay() + 6) % 7;
          const key = keyOfDate(date);
          const slots = perDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selected;
          const isPast = key < todayKey;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(key)}
              title="Open hourly view"
              className={`min-h-[104px] border-r border-b border-hairline px-1 pt-1 pb-1.5 text-left transition-colors last:border-r-0 hover:bg-[var(--control)]/40 ${
                dow >= 5 ? "bg-[var(--surface-sunken)]/40" : ""
              } ${isSelected ? "bg-[var(--control)]/60" : ""} ${isPast ? "opacity-70" : ""}`}
            >
              <div className="mb-1 flex items-center justify-end px-0.5">
                <span
                  data-figure
                  className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] ${
                    isToday ? "bg-ink text-[var(--body-bg)]" : "text-ink-muted"
                  }`}
                >
                  {date.getDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {slots.slice(0, 3).map((slot) => (
                  <CalChip key={slot.v.task.id} slot={slot} />
                ))}
                {slots.length > 3 && (
                  <p className="px-0.5 text-[10px] text-ink-faint">
                    +{slots.length - 3} more
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A time-stamped task chip inside a day cell. */
function CalChip({ slot }: { slot: Slot }) {
  return (
    <Link
      href={`/tasks/${slot.v.task.id}`}
      title={slot.v.task.title}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 overflow-hidden rounded-[4px] px-1 py-0.5 text-[10px] leading-tight transition-opacity hover:opacity-90"
      style={toneOf(slot.v)}
    >
      <span data-figure className="shrink-0 opacity-70">
        {fmtTime(slot.segStart)}
      </span>
      <span className="truncate font-medium">{slot.v.task.title}</span>
    </Link>
  );
}

/* ── Week ─────────────────────────────────────────────────────────────────── */

function WeekGrid({
  refDate,
  perDay,
  todayKey,
  onSelectDay,
}: {
  refDate: Date;
  perDay: Map<string, Slot[]>;
  todayKey: string;
  onSelectDay: (key: string) => void;
}) {
  const mon = startOfWeek(refDate);
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i),
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7">
      {days.map((date, i) => {
        const key = keyOfDate(date);
        const slots = perDay.get(key) ?? [];
        const isToday = key === todayKey;
        return (
          <div
            key={i}
            className={`min-h-[180px] border-r border-b border-hairline last:border-r-0 ${
              i >= 5 ? "bg-[var(--surface-sunken)]/40" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectDay(key)}
              title="Open hourly view"
              className={`flex w-full items-baseline gap-1.5 border-b border-hairline px-2.5 py-2 text-left transition-colors hover:bg-[var(--control)] ${
                isToday ? "bg-[var(--control)]/60" : ""
              }`}
            >
              <span className="text-[10px] tracking-wide text-ink-faint uppercase">
                {WEEKDAYS[i]}
              </span>
              <span
                data-figure
                className={`text-[13px] ${isToday ? "font-semibold text-ink" : "text-ink-muted"}`}
              >
                {date.getDate()}
              </span>
            </button>
            <div className="space-y-1 p-1.5">
              {slots.length === 0 ? (
                <p className="px-1 py-2 text-[10px] text-ink-faint">Free</p>
              ) : (
                slots.map((slot) => (
                  <Link
                    key={slot.v.task.id}
                    href={`/tasks/${slot.v.task.id}`}
                    title={slot.v.task.title}
                    className="block rounded-[6px] px-2 py-1.5 text-[11px] leading-tight transition-opacity hover:opacity-90"
                    style={toneOf(slot.v)}
                  >
                    <span data-figure className="text-[10px] opacity-70">
                      {fmtTime(slot.segStart)}–{fmtTime(slot.segEnd)}
                    </span>
                    <span className="mt-0.5 line-clamp-2 font-medium">
                      {slot.v.task.title}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Day (hourly breakdown) ───────────────────────────────────────────────── */

const HOUR_H = 54;

/** A task's accent colour, from Cowork's state palette — never a raw hue. */
function accentOf(v: TaskView): string {
  if (v.isOverdue) return "var(--state-overdue)";
  if (v.task.isBlocked) return "var(--state-blocked)";
  if (v.task.status === "in_review") return "var(--state-risk)";
  return "var(--accent, #6b8afd)";
}

function DayTimeline({
  day,
  slots,
  nowMs,
  todayKey,
}: {
  day: string;
  slots: Slot[];
  nowMs: number;
  todayKey: string;
}) {
  const trackH = ((WORK_END_MINUTES - WORK_START_MINUTES) / 60) * HOUR_H;
  const base = atMinutes(parseKey(day), WORK_START_MINUTES);
  const baseMs = base.getTime();
  const yMin = (min: number) => ((min - WORK_START_MINUTES) / 60) * HOUR_H;
  const y = (ms: number) => ((ms - baseMs) / 3_600_000) * HOUR_H;
  const fmtMin = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  /* A gridline/label on each hour, plus the office close (18:30). */
  const marks: number[] = [];
  for (let m = WORK_START_MINUTES; m <= WORK_END_MINUTES; m += 60)
    marks.push(m);
  if (marks[marks.length - 1] !== WORK_END_MINUTES)
    marks.push(WORK_END_MINUTES);

  const nowY = day === todayKey ? y(nowMs) : null;
  const showNow = nowY !== null && nowY >= 0 && nowY <= trackH;

  return (
    <div className="flex gap-2 p-3">
      {/* Hour axis. */}
      <div className="relative w-11 shrink-0" style={{ height: trackH }}>
        {marks.map((m) => (
          <span
            key={m}
            className="absolute right-1 -translate-y-1/2 text-[10px] text-ink-faint"
            style={{ top: yMin(m) }}
          >
            {fmtMin(m)}
          </span>
        ))}
      </div>

      {/* The day's track — tasks as cards in their real time slots. */}
      <div
        className="relative flex-1 overflow-hidden rounded-inset border border-hairline bg-[var(--surface-sunken)]/30"
        style={{ height: trackH }}
      >
        {marks.map((m) => (
          <div
            key={m}
            className="absolute inset-x-0 border-t border-hairline/50"
            style={{ top: yMin(m) }}
          />
        ))}

        {showNow && (
          <div
            className="absolute inset-x-0 z-10"
            style={{ top: nowY! }}
            aria-hidden="true"
          >
            <div className="border-t-2 border-[var(--state-overdue)]" />
            <span className="absolute -top-[3px] left-0 h-1.5 w-1.5 rounded-full bg-[var(--state-overdue)]" />
          </div>
        )}

        {slots.length === 0 ? (
          <p className="absolute inset-0 grid place-items-center text-xs text-ink-faint">
            Nothing scheduled this day.
          </p>
        ) : (
          slots.map((slot) => {
            const height = Math.max(
              26,
              ((slot.segEnd - slot.segStart) / 3_600_000) * HOUR_H - 3,
            );
            return (
              <Link
                key={slot.v.task.id}
                href={`/tasks/${slot.v.task.id}`}
                title={slot.v.task.title}
                className="absolute inset-x-2 flex overflow-hidden rounded-lg border border-hairline bg-[var(--doc-page)] shadow-sm transition-shadow hover:shadow-md"
                style={{ top: y(slot.segStart) + 1, height }}
              >
                <span
                  aria-hidden="true"
                  className="w-1 shrink-0"
                  style={{ backgroundColor: accentOf(slot.v) }}
                />
                <div className="min-w-0 flex-1 px-2.5 py-1.5">
                  <span
                    data-figure
                    className="block text-[10px] text-ink-faint"
                  >
                    {fmtTime(slot.segStart)}–{fmtTime(slot.segEnd)}
                  </span>
                  <span className="block truncate text-[12px] font-medium text-ink">
                    {slot.v.task.title}
                  </span>
                  {slot.v.project?.name && height > 54 && (
                    <span className="block truncate text-[10px] text-ink-faint">
                      {slot.v.project.name}
                    </span>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
    >
      {children}
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
  loading,
  icon,
}: {
  label: string;
  value: number;
  tone?: "positive" | "overdue";
  loading: boolean;
  icon: "tasks" | "overview" | "clock";
}) {
  const color =
    tone === "overdue" && value > 0
      ? "text-[var(--state-overdue-ink)]"
      : tone === "positive" && value > 0
        ? "text-[var(--state-positive-ink)]"
        : "text-ink";
  const Glyph = Icon[icon];
  return (
    <div className="rounded-panel border border-hairline bg-[var(--doc-page)] px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
        <Glyph aria-hidden="true" className="h-3.5 w-3.5" />
        {label}
      </div>
      {loading ? (
        <div className="mt-1.5 h-5 w-10">
          <SkeletonRows rows={1} />
        </div>
      ) : (
        <p
          data-figure
          className={`mt-0.5 text-[22px] leading-none tracking-[-0.02em] ${color}`}
        >
          {value}
        </p>
      )}
    </div>
  );
}
