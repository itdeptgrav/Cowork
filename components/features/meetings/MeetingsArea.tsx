"use client";

import Link from "next/link";
import { AvatarStack } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { WorkspaceHead } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  Panel,
  QueryError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime, formatDuration } from "@/lib/utils/format";
import { canJoin, canView } from "@/lib/rules/meetings/access";
import type { Employee, Meeting } from "@/lib/domain";

/**
 * The meetings dashboard.
 *
 * Three sections in the order somebody actually needs them: what is running
 * right now, what is coming, what just finished. The old page split on
 * `scheduled` versus everything else, which put a call happening this second in
 * the same bucket as one cancelled last month.
 *
 * Every list is filtered through `canView` — the same predicate the repository
 * and the token route use — so a meeting you may not see never reaches the
 * page in the first place.
 */
export function MeetingsArea() {
  const meetings = useQuery((r) => r.listMeetings(), []);
  const people = useQuery((r) => r.listEmployees(), []);
  const viewer = useQuery((r) => r.getViewer(), []);

  const me = viewer.data;
  const visible = (meetings.data ?? []).filter((m) =>
    me
      ? canView(m, {
          employeeId: me.employeeId,
          seesOrganisation: false,
          hierarchyIds: me.hierarchyIds,
        })
      : false,
  );

  const now = visible.filter(
    (m) => m.status === "live" || m.status === "waiting",
  );
  const upcoming = visible
    .filter((m) => m.status === "scheduled")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const done = visible
    .filter(
      (m) =>
        m.status === "completed" ||
        m.status === "cancelled" ||
        m.status === "archived",
    )
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const SECTIONS: [string, Meeting[], string][] = [
    ["Happening now", now, "Nothing is running."],
    ["Upcoming", upcoming, "Nothing scheduled."],
    ["Recently completed", done.slice(0, 8), "Nothing finished yet."],
  ];

  return (
    <>
      <WorkspaceHead
        title="Meetings"
        count={
          meetings.data ? (
            <>
              <span data-figure>{now.length}</span> running ·{" "}
              <span data-figure>{upcoming.length}</span> upcoming
            </>
          ) : undefined
        }
        action={
          <Button tone="primary" size="sm">
            <Link href="/meetings/new" className="flex items-center gap-1.5">
              <Icon.plus />
              Schedule
            </Link>
          </Button>
        }
      />

      {meetings.error ? (
        <QueryError
          queries={[meetings]}
          message="Your meetings could not be loaded."
        />
      ) : meetings.isLoading ? (
        <SkeletonRows rows={4} />
      ) : visible.length === 0 ? (
        <Panel>
          <EmptyState
            title="No meetings"
            body="Meetings you organise or are invited to appear here."
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {SECTIONS.map(([label, list, empty]) =>
            list.length ? (
              <Panel key={label} padded={false}>
                <div className="border-b border-hairline px-5 py-2.5">
                  <h2 className="text-sm font-medium text-ink">{label}</h2>
                </div>
                <div className="divide-y divide-hairline">
                  {list.map((m) => (
                    <MeetingCard
                      key={m.id}
                      meeting={m}
                      people={people.data ?? []}
                      viewerId={me?.employeeId ?? ""}
                      hierarchyIds={me?.hierarchyIds ?? []}
                    />
                  ))}
                </div>
              </Panel>
            ) : label === "Happening now" ? null : (
              <Panel key={label}>
                <EmptyState title={label} body={empty} />
              </Panel>
            ),
          )}
        </div>
      )}
    </>
  );
}

/**
 * One meeting, as a row.
 *
 * The Join button appears only when `canJoin` says so — the same rule the
 * repository and the token route enforce — so a control never offers something
 * that would be refused. A manager who can SEE a report's meeting gets the row
 * and no Join, which is the distinction the access module exists to draw.
 */
export function MeetingCard({
  meeting,
  people,
  viewerId,
  hierarchyIds,
}: {
  meeting: Meeting;
  people: Employee[];
  viewerId: string;
  hierarchyIds: string[];
}) {
  const parts = people.filter(
    (p) =>
      meeting.participantIds.includes(p.id) || p.id === meeting.organiserId,
  );
  const joinable = canJoin(meeting, {
    employeeId: viewerId,
    seesOrganisation: false,
    hierarchyIds,
  });
  const length =
    meeting.actualDurationSecs ??
    Math.max(
      0,
      Math.round(
        (Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 1000,
      ),
    );

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Link
        href={`/meetings/${meeting.id}`}
        className="min-w-0 flex-1 transition-colors hover:text-ink"
      >
        <span className="block truncate text-sm text-ink">{meeting.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
          {formatDateTime(meeting.startsAt)} · {formatDuration(length)}
          {meeting.actualDurationSecs !== null && " actual"}
        </span>
      </Link>

      <AvatarStack
        people={parts.slice(0, 3).map((p) => ({
          initials: p.initials,
          hue: p.hue,
          name: p.displayName,
        }))}
        overflow={Math.max(0, parts.length - 3)}
      />

      <Chip tone={statusTone(meeting.status)}>
        {meeting.status === "waiting" ? "waiting room" : meeting.status}
      </Chip>

      {joinable && (
        <Button tone="primary" size="sm">
          <Link href={`/meetings/${meeting.id}`}>Join</Link>
        </Button>
      )}
    </div>
  );
}

function statusTone(status: Meeting["status"]) {
  if (status === "live") return "positive" as const;
  if (status === "waiting") return "extension" as const;
  if (status === "cancelled") return "overdue" as const;
  return "neutral" as const;
}
