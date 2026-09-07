"use client";

import Link from "next/link";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { AvatarStack } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { InstantMeetingModal } from "./InstantMeetingModal";
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
        action={<NewMeetingMenu />}
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
          <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--control)] text-ink-muted">
              <Icon.meeting className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-lg font-medium text-ink">No meetings yet</h2>
              <p className="mx-auto mt-1 max-w-[380px] text-sm text-ink-muted">
                Start one now, schedule it for later, or create a link to share.
                Meetings you organise or are invited to appear here.
              </p>
            </div>
            <NewMeetingMenu align="center" />
          </div>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {SECTIONS.map(([label, list, empty]) =>
            list.length ? (
              /* `overflow-hidden` so a row's hover fill is clipped to the
                 card's rounded corners rather than poking square past them;
                 `label` names the section as a landmark, reusing its heading. */
              <Panel
                key={label}
                padded={false}
                label={label}
                className="overflow-hidden"
              >
                <div className="border-b border-hairline px-5 py-3.5">
                  {/* The same heading voice every other panel in the app uses
                      (PanelHead's scale), so a section reads as a section
                      rather than a caption on a strip. */}
                  <h2 className="text-[17px] font-medium leading-none tracking-[-0.02em] text-ink">
                    {label}
                  </h2>
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
    /* The row lights on hover — the app's control-hover idiom, the same one the
       New menu's items use. The old `hover:text-ink` on the title was a no-op:
       the title is already ink, so a clickable row gave no sign it was one. The
       title now carries the weight so it leads the row; the focus ring comes
       from the palette rather than the browser. */
    /* Two lines on a phone: the title takes the whole first line, and the
       avatars, the status and Join share the second. On one line a 375px
       screen cut "Design crit — task surfaces" to "Design crit — tas…" to fit
       three faces and a chip beside it. From `sm` it is one row again. */
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 transition-colors hover:bg-[var(--control)] sm:gap-4">
      <Link
        href={`/meetings/${meeting.id}`}
        className="min-w-0 basis-full rounded-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:flex-1"
      >
        <span className="block truncate text-[15px] font-medium leading-snug text-ink">
          {meeting.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-faint">
          {formatDateTime(meeting.startsAt)} · {formatDuration(length)}
          {meeting.actualDurationSecs !== null && " actual"}
        </span>
      </Link>

      {/* Fixed-width cells from `sm` up, so the avatars and the status line up
          as columns down the list instead of drifting with each row's content.
          Below `sm` they fall back to wrapping naturally. */}
      <div className="flex shrink-0 sm:w-24 sm:justify-end">
        <AvatarStack
          people={parts.slice(0, 3).map((p) => ({
            initials: p.initials,
            hue: p.hue,
            name: p.displayName,
            src: p.profilePictureUrl,
          }))}
          overflow={Math.max(0, parts.length - 3)}
        />
      </div>

      <div className="flex shrink-0 sm:w-28">
        <Chip tone={statusTone(meeting.status)}>
          {/* A dot in the status's own ink — `bg-current` — so live reads green
              and cancelled red at a glance, without making the whole chip loud. */}
          <span
            aria-hidden
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle"
          />
          {meeting.status === "waiting" ? "waiting room" : meeting.status}
        </Chip>
      </div>

      {joinable && (
        /* Far right of the second line on a phone; in the row from `sm`. */
        <div className="ml-auto sm:ml-0">
          <Button tone="primary" size="sm">
            <Link href={`/meetings/${meeting.id}`}>Join</Link>
          </Button>
        </div>
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

/**
 * The "New" menu — the three ways to make a meeting, offered up front the way
 * Google Meet's does, rather than dropping straight onto one schedule form. Each
 * item carries the same `?mode=` the new-meeting page reads, so the choice is
 * made here and the form arrives already shaped for it.
 */
function NewMeetingMenu({ align = "right" }: { align?: "right" | "center" }) {
  const [open, setOpen] = useState(false);
  /* The instant-meeting pop-up. Opened from the item below rather than
     navigating, so "begin now" does not first send you to a form page. */
  const [instantOpen, setInstantOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* An item either navigates (`href`) or runs an action here (`onSelect`).
     Instant is now the latter: it opens the pop-up over this page. */
  const items: {
    key: string;
    Glyph: ComponentType<{ className?: string }>;
    title: string;
    sub: string;
    href?: string;
    onSelect?: () => void;
  }[] = [
    {
      key: "instant",
      Glyph: Icon.meeting,
      title: "Start an instant meeting",
      sub: "Begin now and join from the preview",
      onSelect: () => {
        setOpen(false);
        setInstantOpen(true);
      },
    },
    {
      key: "scheduled",
      href: "/meetings/new?mode=scheduled",
      Glyph: Icon.calendar,
      title: "Schedule for later",
      sub: "Pick a time and invite people",
    },
    {
      key: "link",
      href: "/meetings/new?mode=link",
      Glyph: Icon.link,
      title: "Create a guest link",
      sub: "Share with people outside CoWork",
    },
  ];

  return (
    <div ref={ref} className="relative">
      <Button
        tone="primary"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="flex items-center gap-1.5">
          <Icon.meeting className="h-4 w-4" />
          New
        </span>
      </Button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-40 mt-2 w-[300px] overflow-hidden rounded-panel border border-hairline bg-[var(--surface-raised)] p-1 shadow-[var(--deck-seat)] ${
            align === "center" ? "left-1/2 -translate-x-1/2" : "right-0"
          }`}
        >
          {items.map((it) => {
            const inner = (
              <>
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--control)] text-ink-muted">
                  <it.Glyph className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{it.title}</span>
                  <span className="block text-[11px] text-ink-faint">{it.sub}</span>
                </span>
              </>
            );
            const cls =
              "flex items-start gap-3 rounded-inset px-2.5 py-2 text-left transition-colors hover:bg-[var(--control)]";
            return it.href ? (
              <Link
                key={it.key}
                href={it.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cls}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                onClick={it.onSelect}
                className={`${cls} w-full`}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}

      {/* The instant-meeting pop-up, over this page — no navigation to enter a
          name and pick people. Mounted only while open. */}
      {instantOpen && (
        <InstantMeetingModal onClose={() => setInstantOpen(false)} />
      )}
    </div>
  );
}
