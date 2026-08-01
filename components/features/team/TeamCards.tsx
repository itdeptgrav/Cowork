"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, Meter, Panel, SkeletonRows } from "@/components/ui/Primitives";
import { duration } from "@/components/features/monitoring/MonitorParts";
import {
  isOpen,
  LOAD_STATE,
  teamLoad,
  type MemberLoad,
} from "@/components/features/dashboard/signals";
import { LiveWorkLine } from "./LiveWork";
import { taskLandingDate } from "./PersonCalendar";
import { useQuery } from "@/lib/hooks/useRepository";
import { STATUS_META } from "@/lib/status/employeeStatus";
import { daysUntil, latestDate } from "@/lib/rules/tasks/workload";
import { formatDate } from "@/lib/utils/format";
import type { DutyMode } from "@/lib/rules/presence/duty";
import type { Employee, EmployeeId } from "@/lib/domain";
import type { TaskView } from "@/lib/repositories";

/**
 * The team as a wall of summary cards — the "multi" view.
 *
 * The roster's table answers "how does everyone compare on these columns"; this
 * answers "what is each person's situation right now", which is a different
 * question and wants a different shape. Each card pairs the two things a manager
 * glances for — **status tracking** (live presence, what they are on, time
 * online) and **workload** (open/overdue/in-review, a load state, the score) —
 * so the grid reads without drilling into anybody.
 *
 * It rides the same feeds as everything else: one team task read drives the
 * workload for the whole grid (as the dashboard's load card does), live presence
 * comes from the one roster subscription passed down, and each card reads its own
 * score and "right now" so a slow provider degrades one card, not the wall.
 */
export function TeamCards({
  reports,
  duty,
}: {
  reports: Employee[];
  duty: Map<EmployeeId, DutyMode>;
}) {
  /* One read for the whole grid's workload — matches the dashboard load card,
     and keeps this from firing a task query per person. */
  const tasks = useQuery(
    (r) => r.listTasks({ scope: "team", sort: "rank" }).then((p) => p.items),
    [],
  );

  const teamTasks = tasks.data ?? [];
  const loads = teamLoad(reports, teamTasks);
  const byId = new Map(loads.map((l) => [l.id, l]));
  /* Bars are proportional to the busiest person, so "a lot" reads relative to
     the team rather than to an absolute nobody can see. */
  const busiest = Math.max(1, ...loads.map((l) => l.open));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 deck:grid-cols-3">
      {reports.map((p) => (
        <EmployeeCard
          key={p.id}
          person={p}
          duty={duty.get(p.id) ?? null}
          load={byId.get(p.id) ?? null}
          /* Their own open tasks, sliced from the one team read — drives both
             the "booked until" runway and the nested calendar with no extra
             fetch. */
          tasks={teamTasks.filter(
            (v) => isOpen(v) && v.assignees.some((a) => a.id === p.id),
          )}
          busiest={busiest}
          loadingLoad={tasks.isLoading}
        />
      ))}
    </div>
  );
}

function EmployeeCard({
  person,
  duty,
  load,
  tasks,
  busiest,
  loadingLoad,
}: {
  person: Employee;
  duty: DutyMode | null;
  load: MemberLoad | null;
  tasks: TaskView[];
  busiest: number;
  loadingLoad: boolean;
}) {
  const score = useQuery((r) => r.getScoreOverview(person.id), [person.id]);
  /* The "right now" facts — what they're on and how long they've been online.
     Manager-scoped; if it is refused the card simply reads "No active task". */
  const subject = useQuery(
    (r) => r.getMonitoringSubject(person.id),
    [person.id],
  );

  const meta = duty ? STATUS_META[duty] : null;
  const s = subject.data ?? null;
  /* The task the "right now" line is about, sliced from the tasks this card
     already holds — no extra read, and null when the running task is one this
     viewer may not see. */
  const current = s?.currentTaskId
    ? (tasks.find((v) => v.task.id === s.currentTaskId) ?? null)
    : null;
  const state = load ? LOAD_STATE[load.state] : null;
  const width = (n: number) => `${(n / busiest) * 100}%`;
  /* "Kab tak kaam hai" — the furthest their queue projects out. */
  const runwayIso = latestDate(tasks.map(taskLandingDate));
  const runwayDays = daysUntil(runwayIso);

  return (
    <Panel padded={false} className="flex h-full flex-col overflow-hidden">
      <Link
        href={`/team/${person.id}`}
        className="block p-4 transition-colors hover:bg-[var(--control)]"
      >
        {/* Identity + live presence. */}
        <div className="flex items-start gap-2.5">
          <Avatar
            initials={person.initials}
            hue={person.hue}
            src={person.profilePictureUrl}
            name={person.displayName}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {meta && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: meta.dot,
                    boxShadow:
                      duty === "offline" ? "none" : `0 0 6px 1px ${meta.glow}`,
                  }}
                />
              )}
              <span className="truncate text-sm font-medium text-ink">
                {person.displayName}
              </span>
            </div>
            <p className="truncate text-[11px] text-ink-faint">
              {person.designation}
              {person.departmentName ? ` · ${person.departmentName}` : ""}
            </p>
          </div>
          {meta && (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted"
              title={meta.help}
            >
              {meta.label}
            </span>
          )}
        </div>

        {/* Status tracking — what they are on right now. */}
        <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2">
          <p className="text-[10px] tracking-[0.08em] text-ink-faint uppercase">
            Right now
          </p>
          {subject.isLoading ? (
            <div className="mt-1">
              <SkeletonRows rows={1} />
            </div>
          ) : (
            <>
              <p className="mt-0.5 truncate text-xs text-ink">
                {s?.currentActivity ?? "No active task"}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                <span data-figure>{duration(s?.onlineSecondsToday ?? 0)}</span>{" "}
                online today
              </p>
              {/* How the time they were given is going. A card in a three-up
                  grid has room for the answer but not the working, so this is
                  one line and one bar; the full breakdown is on their page. */}
              {current && (
                <LiveWorkLine view={current} employeeId={String(person.id)} />
              )}
            </>
          )}
        </div>

        {/* Score. */}
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] text-ink-faint">Score</span>
            {score.data ? (
              <span className="flex items-baseline gap-1.5 text-xs text-ink">
                <span data-figure>
                  {Math.round(score.data.overallPercentage)}%
                </span>
                <span data-figure className="text-ink-faint">
                  {score.data.delta >= 0 ? "↑" : "↓"}
                  {Math.abs(Math.round(score.data.delta))}
                </span>
              </span>
            ) : (
              <span className="text-xs text-ink-faint">—</span>
            )}
          </div>
          <Meter
            value={score.data?.overallPercentage ?? 0}
            announce={score.data?.overallPercentage ?? 0}
            label={`${person.displayName} score`}
          />
        </div>

        {/* Workload. */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] text-ink-faint">Workload</span>
            {state && <Chip tone={state.tone}>{state.label}</Chip>}
          </div>
          {loadingLoad || !load ? (
            <span className="block h-[6px] rounded-full bg-[var(--control-active)]" />
          ) : (
            <>
              {/* One bar, segmented by what the work is — blocked and overdue
                  drawn first, so a heavy card reads as heavy-and-stuck. */}
              <div className="flex h-[6px] overflow-hidden rounded-full bg-[var(--control-active)]">
                {load.blocked > 0 && (
                  <span
                    className="block h-full"
                    style={{
                      width: width(load.blocked),
                      backgroundColor: "var(--state-blocked)",
                    }}
                    title={`${load.blocked} blocked`}
                  />
                )}
                {load.overdue > 0 && (
                  <span
                    className="block h-full"
                    style={{
                      width: width(load.overdue),
                      backgroundColor: "var(--state-overdue)",
                    }}
                    title={`${load.overdue} overdue`}
                  />
                )}
                <span
                  className="block h-full bg-ink"
                  style={{
                    width: width(
                      Math.max(0, load.open - load.blocked - load.overdue),
                    ),
                  }}
                  title={`${load.open} open in total`}
                />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-faint">
                <span data-figure>{load.open} open</span>
                {load.overdue > 0 && (
                  <span data-figure className="text-[var(--state-overdue-ink)]">
                    {load.overdue} overdue
                  </span>
                )}
                {load.inReview > 0 && (
                  <span data-figure>{load.inReview} in review</span>
                )}
                {load.blocked > 0 && (
                  <span data-figure>{load.blocked} blocked</span>
                )}
              </p>
            </>
          )}
          {/* Booked until — how far their queue actually runs. */}
          <p className="mt-2 text-[11px]">
            {runwayIso === null ? (
              <span className="text-ink-faint">No scheduled work</span>
            ) : runwayDays !== null && runwayDays < 0 ? (
              <span className="text-[var(--state-overdue-ink)]">
                Overdue backlog
              </span>
            ) : (
              <>
                <span className="text-ink-faint">Booked until </span>
                <span data-figure className="text-ink">
                  {formatDate(runwayIso)}
                </span>
                {runwayDays !== null && (
                  <span data-figure className="text-ink-faint">
                    {" · "}
                    {runwayDays}d
                  </span>
                )}
              </>
            )}
          </p>
        </div>
      </Link>

      {/* The detailed workload calendar is its own page — link to it. Outside
         the card's own link so it routes to the calendar, not the overview. */}
      <Link
        href={`/team/${person.id}/calendar`}
        className="flex items-center justify-between border-t border-hairline px-4 py-2.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
      >
        <span>Workload calendar</span>
        <span className="flex items-center gap-2">
          {tasks.length > 0 && (
            <span
              data-figure
              className="rounded-full bg-[var(--control)] px-1.5 text-[10px] text-ink-faint"
            >
              {tasks.length}
            </span>
          )}
          <span aria-hidden="true">›</span>
        </span>
      </Link>
    </Panel>
  );
}
