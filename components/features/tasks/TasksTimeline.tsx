"use client";

import { useState } from "react";
import { useNow } from "@/lib/hooks/useNow";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  EmptyState,
  Panel,
  Segmented,
  SkeletonRows,
  QueryError,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import {
  istHourOfDay,
  formatTimer,
  formatDurationTimer,
} from "@/lib/utils/format";

/**
 * Per-person day timeline, from `timeline.jpeg` / the higher-resolution
 * screenshot of the same component.
 *
 * The reference's encodings are kept and its colours are not: hatched means
 * "nothing tracked", solid means worked, and the current-time indicator is ink
 * rather than the reference's pink. Encoding by fill pattern rather than hue is
 * what lets this component survive both themes and colour-vision differences.
 *
 * Below 768px it transposes to a per-person session list. A nine-hour axis at
 * 360px is unreadable, so the component changes shape rather than shrinking.
 */

const DAY_START = 9;
const DAY_END = 19;
const SPAN = DAY_END - DAY_START;

export function TasksTimeline() {
  const [grain, setGrain] = useState<"day" | "week">("day");
  const dayCommits = useQuery((r) => r.listDayCommits("2026-07-25"), []);
  const { data, isLoading } = dayCommits;
  const { data: people } = useQuery((r) => r.listEmployees(), []);
  /* Called with the other hooks, above the early returns — hook order must not
     depend on whether the query resolved. */
  const now = useNow();

  if (isLoading) return <SkeletonRows rows={5} />;
  if (dayCommits.error)
    return (
      <QueryError
        queries={[dayCommits]}
        message="The timeline could not be loaded."
      />
    );

  const commits = data ?? [];
  const byPerson = new Map<string, typeof commits>();
  for (const c of commits)
    byPerson.set(c.employeeId, [...(byPerson.get(c.employeeId) ?? []), c]);

  const hours = Array.from({ length: SPAN + 1 }, (_, i) => DAY_START + i);
  /* The real clock, not a fixed hour.
     This was `const nowHour = 10`, so the "now" marker sat at 10:00 for
     everybody, all day — a line claiming to say where you are in the working
     day while pointing somewhere else. `useNow` returns null until the client
     has hydrated, which is what keeps the server and the first client render
     agreeing; the marker is simply not drawn until then rather than drawn in
     the wrong place. */
  const nowHour = now ? now.getHours() + now.getMinutes() / 60 : null;
  const nowLeft =
    nowHour === null ? null : ((nowHour - DAY_START) / SPAN) * 100;
  /* Off the ends of the working day, the marker is meaningless. */
  const showNow = nowLeft !== null && nowLeft >= 0 && nowLeft <= 100;

  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-2.5">
        <Segmented
          label="Granularity"
          size="sm"
          value={grain}
          onChange={setGrain}
          options={[
            { id: "day", label: "Day" },
            { id: "week", label: "Week" },
          ]}
        />
        <span className="text-sm text-ink">Friday 25 July</span>
        <span className="ml-auto text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Timer sessions by person
        </span>
      </div>

      {byPerson.size === 0 ? (
        <EmptyState
          title="Nothing tracked today"
          body="Timer sessions appear here as work is logged against tasks."
        />
      ) : (
        <>
          {/* Desktop: shared axis */}
          <div className="hidden md:block">
            <div className="flex items-center gap-3 px-4 pt-2 pb-1">
              <span className="w-40 shrink-0 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                Person
              </span>
              <div className="relative flex-1">
                <div className="flex justify-between">
                  {hours.map((h) => (
                    <span
                      key={h}
                      data-figure
                      className="text-[11px] text-ink-faint"
                    >
                      {String(h).padStart(2, "0")}
                    </span>
                  ))}
                </div>
              </div>
              <span className="w-24 shrink-0 text-right text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                Tracked
              </span>
            </div>

            <div className="divide-y divide-hairline">
              {[...byPerson.entries()].map(([empId, list]) => {
                const person = people?.find((p) => p.id === empId);
                const tracked = list.reduce((s, c) => s + c.durationSecs, 0);
                const idle = Math.max(0, SPAN * 3600 - tracked);
                return (
                  <div
                    key={empId}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <div className="flex w-40 shrink-0 items-center gap-2">
                      {person && (
                        <Avatar
                          initials={person.initials}
                          hue={person.hue}
                          name={person.displayName}
                          size="sm"
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">
                          {person?.displayName ?? empId}
                        </span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {list.length}{" "}
                          {list.length === 1 ? "session" : "sessions"}
                        </span>
                      </span>
                    </div>

                    <div className="hatch relative h-9 flex-1 overflow-hidden rounded-inset bg-[var(--surface-sunken)]">
                      {list.map((c) => {
                        /* IST, not UTC. Reading `getUTCHours()` here drew a
                           session worked at 14:30 five and a half hours to the
                           left, at 09:00 — every block on the day chart was in
                           the wrong place. */
                        const startH = istHourOfDay(c.startedAt);
                        if (startH === null) return null;
                        const left = ((startH - DAY_START) / SPAN) * 100;
                        const width = (c.durationSecs / 3600 / SPAN) * 100;
                        if (left < -8 || left > 108) return null;
                        return (
                          <span
                            key={c.id}
                            title={`${c.taskTitle} · ${formatTimer(c.durationSecs)}`}
                            className="absolute inset-y-1 flex items-center overflow-hidden rounded-inset bg-ink/80 px-2 text-[11px] whitespace-nowrap text-[var(--body-bg)]"
                            style={{
                              left: `${Math.max(0, left)}%`,
                              width: `${Math.max(3.5, width)}%`,
                            }}
                          >
                            <span className="truncate">{c.taskTitle}</span>
                          </span>
                        );
                      })}
                      {/* Current time. Ink, not the reference's pink.
                          Drawn only once the client knows the hour and it
                          falls inside the working day — a marker in the wrong
                          place is worse than none. */}
                      {showNow && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 w-px bg-ink"
                          style={{ left: `${nowLeft}%` }}
                        >
                          <span className="absolute -top-0.5 -left-[2.5px] h-1.5 w-1.5 rounded-full bg-ink" />
                        </span>
                      )}
                    </div>

                    <div className="w-24 shrink-0 text-right">
                      <span data-figure className="block text-sm text-ink">
                        {formatTimer(tracked)}
                      </span>
                      <span
                        data-figure
                        className="block text-[11px] text-ink-faint"
                      >
                        {formatTimer(idle)} idle
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-hairline px-4 py-2.5">
              <Legend swatch="bg-ink/80" label="Worked" />
              <Legend
                swatch="hatch bg-[var(--surface-sunken)]"
                label="Nothing tracked"
              />
              <Legend swatch="bg-ink w-px" label="Now" />
            </div>
          </div>

          {/* Mobile: transposed */}
          <div className="divide-y divide-hairline md:hidden">
            {[...byPerson.entries()].map(([empId, list]) => {
              const person = people?.find((p) => p.id === empId);
              return (
                <div key={empId} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {person && (
                      <Avatar
                        initials={person.initials}
                        hue={person.hue}
                        name={person.displayName}
                        size="sm"
                      />
                    )}
                    <span className="flex-1 truncate text-sm text-ink">
                      {person?.displayName ?? empId}
                    </span>
                    <span data-figure className="text-xs text-ink-faint">
                      {formatDurationTimer(
                        list.reduce((s, c) => s + c.durationSecs, 0),
                      )}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5 pl-9">
                    {list.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-baseline gap-2 text-xs"
                      >
                        <Icon.clock className="h-3 w-3 shrink-0 text-ink-faint" />
                        <span className="min-w-0 flex-1 truncate text-ink-muted">
                          {c.taskTitle}
                        </span>
                        <span data-figure className="shrink-0 text-ink-faint">
                          {formatTimer(c.durationSecs)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[11px] text-ink-faint">
      <span
        aria-hidden="true"
        className={`h-3 rounded-full ${swatch.includes("w-px") ? swatch : `w-5 ${swatch}`}`}
      />
      {label}
    </span>
  );
}
