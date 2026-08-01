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
import { dayKey, groupByDay } from "@/lib/rules/tasks/workload";
import type { TaskView } from "@/lib/repositories";

/**
 * A person's workload as a full calendar page — the nested "Calendar" tab.
 *
 * The card answers "how loaded, and until when"; this is the room to see it laid
 * out. Each task sits on the day the app projects it will really finish — its
 * `operationalDueAt` (the queue ahead of it, its budget, walked through the
 * office calendar), falling back to its due date — so a busy day is work
 * genuinely converging, not a pile of nominal deadlines. A month grid for the
 * shape of the load; a week for the detail. Built in Cowork's own material and
 * type rather than a borrowed calendar skin.
 */

/** The day a task occupies on the calendar: its real finish, else its due date. */
export function taskLandingDate(v: TaskView): string | null {
  const d = v.task.deadline;
  return d.operationalDueAt ?? d.dueAt ?? d.officialDueAt;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeek(d: Date): Date {
  const wd = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd);
}
function keyOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  const [view, setView] = useState<"month" | "week">("month");
  const [ref, setRef] = useState<Date>(() => new Date());

  const byDay = groupByDay(tasks, taskLandingDate);
  const todayKey = dayKey(new Date().toISOString());

  const total = tasks.length;
  const open = tasks.filter(isOpen).length;
  const inReview = tasks.filter((t) => t.task.status === "in_review").length;
  const completed = tasks.filter((t) => t.task.status === "completed").length;
  const overdue = tasks.filter((t) => t.isOverdue).length;

  const shift = (dir: -1 | 1) =>
    setRef((d) =>
      view === "month"
        ? new Date(d.getFullYear(), d.getMonth() + dir, 1)
        : new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir * 7),
    );

  const label =
    view === "month"
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
      {/* Task summary — the figures a manager reads before the layout. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 deck:grid-cols-5">
        <Stat label="Total tasks" value={total} loading={isLoading} />
        <Stat label="Open" value={open} loading={isLoading} />
        <Stat label="In review" value={inReview} loading={isLoading} />
        <Stat
          label="Completed"
          value={completed}
          tone="positive"
          loading={isLoading}
        />
        <Stat
          label="Overdue"
          value={overdue}
          tone="overdue"
          loading={isLoading}
        />
      </div>

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
          <span className="text-sm font-medium text-ink">{label}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <NavButton label="Previous" onClick={() => shift(-1)}>
              ‹
            </NavButton>
            <button
              type="button"
              onClick={() => setRef(new Date())}
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
              ]}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : total === 0 ? (
          <EmptyState
            title="No tasks"
            body="Nothing is on this person's calendar in this fixture."
          />
        ) : view === "month" ? (
          <MonthGrid refDate={ref} byDay={byDay} todayKey={todayKey} />
        ) : (
          <WeekGrid refDate={ref} byDay={byDay} todayKey={todayKey} />
        )}
      </Panel>
    </div>
  );
}

/* ── Month ────────────────────────────────────────────────────────────────── */

function MonthGrid({
  refDate,
  byDay,
  todayKey,
}: {
  refDate: Date;
  byDay: Map<string, TaskView[]>;
  todayKey: string | null;
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
                className="min-h-[104px] border-r border-b border-hairline bg-[var(--surface-sunken)]/40 last:border-r-0"
              />
            );
          const key = keyOf(date);
          const dayTasks = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={i}
              className={`min-h-[104px] border-r border-b border-hairline p-1.5 last:border-r-0 ${
                isToday ? "bg-[var(--control)]/40" : ""
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  data-figure
                  className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] ${
                    isToday ? "bg-ink text-[var(--body-bg)]" : "text-ink-muted"
                  }`}
                >
                  {date.getDate()}
                </span>
                {dayTasks.length > 0 && (
                  <span data-figure className="text-[10px] text-ink-faint">
                    {dayTasks.length}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {dayTasks.slice(0, 3).map((v) => (
                  <TaskChip
                    key={v.task.id}
                    v={v}
                    today={todayKey}
                    dayKeyStr={key}
                  />
                ))}
                {dayTasks.length > 3 && (
                  <p className="px-1 text-[10px] text-ink-faint">
                    +{dayTasks.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Week ─────────────────────────────────────────────────────────────────── */

function WeekGrid({
  refDate,
  byDay,
  todayKey,
}: {
  refDate: Date;
  byDay: Map<string, TaskView[]>;
  todayKey: string | null;
}) {
  const mon = startOfWeek(refDate);
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i),
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7">
      {days.map((date, i) => {
        const key = keyOf(date);
        const dayTasks = byDay.get(key) ?? [];
        const isToday = key === todayKey;
        return (
          <div
            key={i}
            className="min-h-[160px] border-r border-b border-hairline last:border-r-0"
          >
            <div
              className={`flex items-baseline gap-1.5 border-b border-hairline px-2 py-1.5 ${
                isToday ? "bg-[var(--control)]/50" : ""
              }`}
            >
              <span className="text-[10px] tracking-wide text-ink-faint uppercase">
                {WEEKDAYS[i]}
              </span>
              <span
                data-figure
                className={`text-[12px] ${isToday ? "font-semibold text-ink" : "text-ink-muted"}`}
              >
                {date.getDate()}
              </span>
              {dayTasks.length > 0 && (
                <span
                  data-figure
                  className="ml-auto text-[10px] text-ink-faint"
                >
                  {dayTasks.length}
                </span>
              )}
            </div>
            <div className="space-y-1 p-1.5">
              {dayTasks.length === 0 ? (
                <p className="px-1 py-2 text-[10px] text-ink-faint">—</p>
              ) : (
                dayTasks.map((v) => (
                  <TaskChip
                    key={v.task.id}
                    v={v}
                    today={todayKey}
                    dayKeyStr={key}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function TaskChip({
  v,
  today,
  dayKeyStr,
}: {
  v: TaskView;
  today: string | null;
  dayKeyStr: string;
}) {
  const done = v.task.status === "completed";
  const past = today !== null && dayKeyStr < today;
  const overdue = v.isOverdue || (past && !done);
  const cls = done
    ? "bg-[var(--control)] text-ink-faint line-through"
    : overdue
      ? "bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)] text-[var(--state-overdue-ink)]"
      : v.task.status === "in_review"
        ? "bg-[color-mix(in_srgb,var(--state-risk)_20%,transparent)] text-[var(--state-risk-ink)]"
        : "bg-[var(--control)] text-ink";
  return (
    <Link
      href={`/tasks/${v.task.id}`}
      title={v.task.title}
      className={`block truncate rounded-[5px] px-1.5 py-1 text-[10px] leading-tight transition-opacity hover:opacity-80 ${cls}`}
    >
      {v.task.title}
    </Link>
  );
}

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
}: {
  label: string;
  value: number;
  tone?: "positive" | "overdue";
  loading: boolean;
}) {
  const color =
    tone === "overdue" && value > 0
      ? "text-[var(--state-overdue-ink)]"
      : tone === "positive" && value > 0
        ? "text-[var(--state-positive-ink)]"
        : "text-ink";
  return (
    <div className="rounded-panel border border-hairline bg-[var(--doc-page)] px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
        <Icon.tasks aria-hidden="true" className="h-3.5 w-3.5" />
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
