"use client";

import Link from "next/link";
import { Card, Action } from "./Card";
import { LOAD_STATE, teamLoad, type MemberLoad } from "./signals";
import { Avatar } from "@/components/ui/Avatar";
import {
  Chip,
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";

/**
 * "How is the work distributed?" — the manager's hero card.
 *
 * A roster with numbers beside it is a spreadsheet, and the brief is explicit
 * that this must not be one. So the card is built around the exception: rows
 * are ordered by whether the person needs something from their manager, and
 * each carries one word for their state before it carries any figure.
 *
 * The bar is proportional to the busiest person in the team rather than to an
 * absolute, because "a lot of work" only means anything relative to everyone
 * else's. Overdue and blocked are drawn INSIDE that bar rather than beside it:
 * they are part of the load, not a separate statistic.
 */
export function TeamLoadCard() {
  const viewer = useQuery((r) => r.getViewer(), []);
  const people = useQuery((r) => r.listEmployees(), []);
  const tasks = useQuery(
    (r) => r.listTasks({ scope: "team", sort: "rank" }).then((p) => p.items),
    [],
  );

  const reports = (people.data ?? []).filter((e) =>
    viewer.data?.hierarchyIds.includes(e.id),
  );
  const rows = teamLoad(reports, tasks.data ?? []);
  const busiest = Math.max(1, ...rows.map((r) => r.open));
  const needing = rows.filter(
    (r) =>
      r.state === "blocked" || r.state === "behind" || r.state === "overloaded",
  ).length;

  return (
    <Card
      title="Team workload"
      href="/team"
      hrefLabel="Open team"
      padded={false}
      className="min-w-0"
      headerRight={
        rows.length > 0 ? (
          <span data-figure className="text-[11px] text-ink-faint">
            {needing > 0
              ? `${needing} of ${rows.length} need you`
              : `${rows.length} steady`}
          </span>
        ) : null
      }
    >
      {tasks.isLoading || people.isLoading ? (
        <div className="px-5">
          <SkeletonRows rows={4} />
        </div>
      ) : tasks.error ? (
        <ErrorState body={tasks.error} onRetry={tasks.refetch} />
      ) : rows.length === 0 ? (
        <div className="px-5">
          <EmptyState
            compact
            title="No reports"
            body="Nobody reports to you in this fixture."
          />
        </div>
      ) : (
        <div className="divide-y divide-hairline">
          {rows.map((row) => (
            <LoadRow key={row.id} row={row} busiest={busiest} />
          ))}
        </div>
      )}
    </Card>
  );
}

function LoadRow({ row, busiest }: { row: MemberLoad; busiest: number }) {
  const state = LOAD_STATE[row.state];
  const width = (n: number) => `${(n / busiest) * 100}%`;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 transition-colors hover:bg-[var(--row-hover)]">
      <Avatar initials={row.initials} hue={row.hue} name={row.name} size="md" />

      <div className="min-w-0 flex-1 basis-[180px]">
        <div className="flex items-center gap-2">
          <Link
            href={`/team/${row.id}/tasks`}
            className="min-w-0 truncate text-sm text-ink hover:underline hover:underline-offset-2"
          >
            {row.name}
          </Link>
          <Chip tone={state.tone}>{state.label}</Chip>
        </div>

        {/* One bar, segmented by what the work actually is. Blocked and overdue
            are the first things drawn, so a heavy row reads as heavy-and-stuck
            rather than merely heavy. */}
        <div className="mt-1.5 flex h-[6px] overflow-hidden rounded-full bg-[var(--control-active)]">
          {row.blocked > 0 && (
            <span
              className="block h-full"
              style={{
                width: width(row.blocked),
                backgroundColor: "var(--state-blocked)",
              }}
              title={`${row.blocked} blocked`}
            />
          )}
          {row.overdue > 0 && (
            <span
              className="block h-full"
              style={{
                width: width(row.overdue),
                backgroundColor: "var(--state-overdue)",
              }}
              title={`${row.overdue} overdue`}
            />
          )}
          <span
            className="band-fill block h-full bg-ink"
            style={{
              width: width(Math.max(0, row.open - row.blocked - row.overdue)),
            }}
            title={`${row.open} open in total`}
          />
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-faint">
          <span data-figure>{row.open} open</span>
          {row.overdue > 0 && (
            <span data-figure className="text-[var(--state-overdue-ink)]">
              {row.overdue} overdue
            </span>
          )}
          {row.blocked > 0 && <span data-figure>{row.blocked} blocked</span>}
          {row.inReview > 0 && (
            <span data-figure>{row.inReview} in review</span>
          )}
        </p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Action href={`/team/${row.id}/tasks`}>See tasks</Action>
        {row.state === "light" && (
          <Action href="/tasks/new" tone="strong" icon="plus">
            Assign
          </Action>
        )}
        {(row.state === "blocked" || row.state === "behind") && (
          <Action href={`/team/${row.id}`} tone="strong">
            Open
          </Action>
        )}
      </div>
    </div>
  );
}
