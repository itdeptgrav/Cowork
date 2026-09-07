"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { Breadcrumb, WorkspaceHead } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  Panel,
  SkeletonRows,
  Textarea,
  QueryError,
} from "@/components/ui/Primitives";
import { MeetingLobby } from "@/components/features/meetings/MeetingLobby";
import { EmployeePicker } from "@/components/features/meetings/EmployeePicker";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import type { Meeting } from "@/lib/domain";

/* ── Groups ───────────────────────────────────────────────────────────────── */

export function GroupsPage() {
  const groups = useQuery((r) => r.listGroups(), []);
  const { data, isLoading } = groups;
  const people = useQuery((r) => r.listEmployees(), []);

  return (
    <>
      <WorkspaceHead
        title="Groups"
        count={data ? `${data.length} groups` : undefined}
      />
      {groups.error ? (
        <QueryError queries={[groups]} message="Groups could not be loaded." />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : !data?.length ? (
        <Panel>
          <EmptyState title="No groups" />
        </Panel>
      ) : (
        <div className="grid gap-3 deck:grid-cols-3">
          {data.map((g) => {
            const members = (people.data ?? []).filter((p) =>
              g.memberIds.includes(p.id),
            );
            return (
              <Panel key={g.id}>
                <Link
                  href={`/groups/${g.id}`}
                  className="block text-sm font-medium text-ink"
                >
                  {g.name}
                </Link>
                {g.description && (
                  <p className="mt-1 text-xs text-ink-muted">{g.description}</p>
                )}
                <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-2.5">
                  <AvatarStack
                    people={members.slice(0, 4).map((m) => ({
                      initials: m.initials,
                      hue: m.hue,
                      name: m.displayName,
                      src: m.profilePictureUrl,
                    }))}
                    overflow={Math.max(0, members.length - 4)}
                  />
                  <span className="text-[11px] text-ink-faint">
                    <span data-figure>{members.length}</span> members
                  </span>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}

export function GroupDetail({ groupId }: { groupId: string }) {
  const group = useQuery((r) => r.getGroup(groupId), [groupId]);
  const { data, isLoading } = group;
  if (isLoading) return <SkeletonRows rows={5} />;
  if (group.error)
    return (
      <QueryError queries={[group]} message="This group could not be loaded." />
    );
  if (!data)
    return (
      <Panel>
        <ErrorState title="Group not found" />
      </Panel>
    );

  return (
    <>
      <Breadcrumb
        items={[{ label: "Groups", href: "/groups" }, { label: data.name }]}
      />
      <h1 className="mt-2 mb-4 text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
        {data.name}
      </h1>
      <div className="grid gap-4 deck:grid-cols-2">
        <Panel padded={false}>
          <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
            <h2 className="text-sm font-medium text-ink">Members</h2>
            <span data-figure className="text-xs text-ink-faint">
              {data.members.length}
            </span>
          </div>
          <div className="divide-y divide-hairline">
            {data.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 px-5 py-2.5">
                <Avatar
                  initials={m.initials}
                  hue={m.hue}
                  src={m.profilePictureUrl}
                  name={m.displayName}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {m.displayName}
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {m.designation}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <h2 className="text-sm font-medium text-ink">About</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {data.description ?? "No description."}
          </p>
          <p className="mt-3 border-t border-hairline pt-3 text-[11px] text-ink-faint">
            Created {formatDate(data.createdAt)}
          </p>
        </Panel>
      </div>
    </>
  );
}

/* ── Meetings ─────────────────────────────────────────────────────────────── */

export function MeetingsPage() {
  const meetings = useQuery((r) => r.listMeetings(), []);
  const { data, isLoading } = meetings;
  const people = useQuery((r) => r.listEmployees(), []);

  const upcoming = (data ?? []).filter((m) => m.status === "scheduled");
  const past = (data ?? []).filter((m) => m.status !== "scheduled");

  return (
    <>
      <WorkspaceHead
        title="Meetings"
        count={
          data ? (
            <>
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
        /* "No meetings" and "we could not read your meetings" are different
           facts, and only one of them means the afternoon is free. */
        <QueryError
          queries={[meetings]}
          message="Your meetings could not be loaded."
        />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : !data?.length ? (
        <Panel>
          <EmptyState title="No meetings" />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {[
            ["Upcoming", upcoming],
            ["Past", past],
          ].map(([label, list]) =>
            (list as typeof upcoming).length ? (
              <Panel key={label as string} padded={false}>
                <div className="border-b border-hairline px-5 py-2.5">
                  <h2 className="text-sm font-medium text-ink">
                    {label as string}
                  </h2>
                </div>
                <div className="divide-y divide-hairline">
                  {(list as typeof upcoming).map((m) => {
                    const parts = (people.data ?? []).filter((p) =>
                      m.participantIds.includes(p.id),
                    );
                    return (
                      <Link
                        key={m.id}
                        href={`/meetings/${m.id}`}
                        className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--control)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">
                            {m.title}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-ink-faint">
                            {formatDateTime(m.startsAt)}
                          </span>
                        </span>
                        <AvatarStack
                          people={parts.slice(0, 3).map((p) => ({
                            initials: p.initials,
                            hue: p.hue,
                            name: p.displayName,
                            src: p.profilePictureUrl,
                          }))}
                          overflow={Math.max(0, parts.length - 3)}
                        />
                        <Chip
                          tone={
                            m.status === "scheduled" ? "neutral" : "positive"
                          }
                        >
                          {m.status}
                        </Chip>
                      </Link>
                    );
                  })}
                </div>
              </Panel>
            ) : null,
          )}
        </div>
      )}
    </>
  );
}

export function MeetingDetail({ meetingId }: { meetingId: string }) {
  const meeting = useQuery((r) => r.getMeeting(meetingId), [meetingId]);
  const { data, isLoading } = meeting;
  const people = useQuery((r) => r.listEmployees(), []);

  if (isLoading) return <SkeletonRows rows={5} />;
  if (meeting.error)
    return (
      <QueryError
        queries={[meeting]}
        message="This meeting could not be loaded."
      />
    );
  if (!data)
    return (
      <Panel>
        <ErrorState title="Meeting not found" />
      </Panel>
    );

  const parts = (people.data ?? []).filter((p) =>
    data.participantIds.includes(p.id),
  );

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Meetings", href: "/meetings" },
          { label: data.title },
        ]}
      />
      <h1 className="mt-2 mb-1 text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
        {data.title}
      </h1>
      <p className="mb-4 text-sm text-ink-muted">
        {formatDateTime(data.startsAt)}
      </p>

      <div className="grid gap-4 deck:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-sm font-medium text-ink">Participants</h2>
          <ul className="space-y-2">
            {parts.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5">
                <Avatar
                  initials={p.initials}
                  hue={p.hue}
                  src={p.profilePictureUrl}
                  name={p.displayName}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {p.displayName}
                </span>
                {p.id === data.organiserId && <Chip>Organiser</Chip>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="text-sm font-medium text-ink">Details</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {data.description ?? "No agenda set."}
          </p>
          {data.joinToken && (
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="text-[11px] text-ink-faint">Guest link</p>
              <Link
                href={`/join/${data.joinToken}`}
                className="mt-1 block truncate text-sm text-ink hover:opacity-80"
              >
                /join/{data.joinToken}
              </Link>
            </div>
          )}
          <p className="mt-3 border-t border-hairline pt-3 text-[11px] text-ink-faint">
            Recording and summaries are optional features and are not enabled in
            this prototype.
          </p>
        </Panel>
      </div>
    </>
  );
}

/**
 * Scheduling a meeting, and then starting it.
 *
 * Two things this used to get wrong, both of which made the organiser a
 * stranger to their own meeting:
 *
 *  1. **They were not in it.** `participantIds` started empty and the organiser
 *     was stored only in `createdBy`. An ordinary employee's meeting list reads
 *     `participants array-contains me`, so a meeting whose organiser was not in
 *     that array did not appear on their own page. Now they are seeded in, and
 *     shown as a chip that cannot be switched off — you cannot un-invite
 *     yourself from a meeting you are calling.
 *  2. **Scheduling ended in a sentence.** "Meeting scheduled." and nothing to
 *     press: back to the list, find the meeting you had just made, open it.
 *     Now the lobby opens beside the form with the camera preview already
 *     running, and Join goes straight in.
 */
/** The three ways to make a meeting, matching the "New" menu on the dashboard.
 *  `scheduled` picks a time; `instant` and `link` start now — the difference is
 *  only what the result leads with: the camera lobby to join, or the link to
 *  share. Every path lands on the same lobby, so "instant" is a one-field
 *  version of the same form, not a separate flow. */
export type MeetingMode = "instant" | "scheduled" | "link";

const MEETING_MODE: Record<
  MeetingMode,
  {
    crumb: string;
    heading: string;
    sub: string;
    cta: string;
    pending: string;
    needsTime: boolean;
    defaultTitle: string;
  }
> = {
  instant: {
    crumb: "Instant meeting",
    heading: "Start an instant meeting",
    sub: "It begins now. Invite people here, then step into the camera preview and join.",
    cta: "Start meeting",
    pending: "Starting…",
    needsTime: false,
    defaultTitle: "Instant meeting",
  },
  scheduled: {
    crumb: "Schedule",
    heading: "Schedule a meeting",
    sub: "Pick a time and who is coming. Everyone invited sees it in their Meetings.",
    cta: "Schedule",
    pending: "Scheduling…",
    needsTime: true,
    defaultTitle: "",
  },
  link: {
    crumb: "Guest link",
    heading: "Create a meeting to share",
    sub: "Make the meeting now and share its link — with people inside CoWork, or, with a guest link, anyone outside it.",
    cta: "Create meeting",
    pending: "Creating…",
    needsTime: false,
    defaultTitle: "",
  },
};

export function NewMeetingForm({ mode = "scheduled" }: { mode?: MeetingMode }) {
  const meta = MEETING_MODE[mode];
  const [title, setTitle] = useState(meta.defaultTitle);
  const [description, setDescription] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [created, setCreated] = useState<Meeting | null>(null);

  const people = useQuery((r) => r.listEmployees(), []);
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const myId = me.data?.id ?? null;

  /**
   * The organiser is in the list by CONSTRUCTION, not by seeding state.
   *
   * An effect that pushed the id in would be a synchronous setState in an
   * effect — a cascading render — and it would leave a window in which the
   * organiser was absent. Derived here instead, so no such state exists and
   * there is nothing to keep in step. The engine dedupes as well; neither side
   * relies on the other having done it.
   */
  const effectiveParticipantIds = myId
    ? [myId, ...participantIds.filter((id) => id !== myId)]
    : participantIds;

  useEffect(() => {
    /* Only a scheduled meeting needs a default time; instant and link start
       "now" at create time. The next half hour, local — a fixed date in the
       source was shipping a default that had already passed.

       Deferred to the next frame rather than set in the effect body — the same
       reason `ThemeContext` defers its own sync. This reads an external system
       (the wall clock) that the server cannot agree with, and setting it
       synchronously cascades a render. */
    if (!meta.needsTime || startsAt) return;
    const frame = requestAnimationFrame(() => {
      const d = new Date(Date.now() + 30 * 60_000);
      d.setSeconds(0, 0);
      d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
      const pad = (n: number) => String(n).padStart(2, "0");
      setStartsAt(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [startsAt, meta.needsTime]);

  const [create, state] = useAction((r) => {
    /* Instant and link start the moment the button is pressed; scheduled uses
       the chosen time. Booked for an hour either way. */
    const start = meta.needsTime && startsAt ? new Date(startsAt) : new Date();
    return r.createMeeting({
      title: title.trim(),
      description: description || null,
      participantIds: effectiveParticipantIds,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 3600_000).toISOString(),
    });
  });

  const canSubmit =
    Boolean(title.trim()) && (!meta.needsTime || Boolean(startsAt));

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Meetings", href: "/meetings" },
          { label: created ? created.title : meta.crumb },
        ]}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[clamp(1.375rem,2vw,1.75rem)] leading-none font-light tracking-[-0.03em] text-ink">
          {created ? "Ready when you are" : meta.heading}
        </h1>
        {/* The meeting's state, up where the eye lands first — a scheduled
            meeting should read as BOOKED, not as a call in progress. */}
        {created && (
          <Chip tone="positive">
            <Icon.calendar
              className="mr-1 inline-block h-3 w-3 align-[-1px]"
              aria-hidden
            />
            {created.status.charAt(0).toUpperCase() + created.status.slice(1)}
          </Chip>
        )}
      </div>
      <p className="mt-1.5 mb-6 max-w-[560px] text-sm text-ink-muted">
        {created
          ? "Join from the camera preview, or share the link so others can too."
          : meta.sub}
      </p>

      {/* The lobby takes a column of its own from the deck breakpoint up, and
          stacks beneath the form below it — a camera preview squeezed into a
          third of a phone screen is not a preview. */}
      <div
        className={
          created
            ? "grid max-w-[1160px] items-start gap-5 deck:grid-cols-[minmax(0,1fr)_minmax(400px,480px)]"
            : "max-w-[720px]"
        }
      >
        {created ? (
          /* Once made, the meeting is READ BACK rather than shown as a form
             with its fields switched off — see CreatedSummary. */
          <CreatedSummary
            meeting={created}
            othersCount={participantIds.length}
            onCreateAnother={() => {
              /* Not a reset of the same form: a second meeting is a second
                 meeting, and leaving the first one's lobby on screen while
                 typing the next one's title is two meetings in one place. */
              setCreated(null);
              setTitle(meta.defaultTitle);
              setDescription("");
              setParticipantIds([]);
            }}
          />
        ) : (
        /* One card, two questions, one action.

           This used to stack five things at one uniform spacing, so a title
           field and the whole invite list read as equals and the primary
           button floated loose at the bottom. Now the card has a shape: WHAT
           the meeting is — title, agenda, when — as one tight group; WHO is
           coming as a second, set off by a rule with real air around it (the
           same hairline-divided region NewProjectForm uses); and the action
           anchored in a footer of its own. Same fields, same copy, same button:
           the change is grouping and rhythm, nothing else. */
        <Panel padded={false} label={meta.heading}>
          <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
            <Field
              label="Title"
              required
              error={state.errorField === "title" ? state.error : null}
            >
              <Input
                value={title}
                disabled={Boolean(created)}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Agenda">
              <Textarea
                rows={3}
                value={description}
                disabled={Boolean(created)}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {meta.needsTime && (
              <Field
                label="Starts"
                required
                error={state.errorField === "startsAt" ? state.error : null}
              >
                {/* The native picker glyph is a browser surface the design did
                    not draw. Muted until hovered, and given a pointer, so it
                    reads as the control it is rather than a stray icon. */}
                <Input
                  type="datetime-local"
                  value={startsAt}
                  disabled={Boolean(created)}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:transition-opacity hover:[&::-webkit-calendar-picker-indicator]:opacity-100"
                />
              </Field>
            )}
          </div>

          {/* Who is coming — the second question, kept apart from the first. */}
          <div className="border-t border-hairline px-5 py-5 sm:px-6 sm:py-6">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-ink">Invite people</span>
              <span className="text-[11px] text-ink-faint">
                {participantIds.length
                  ? `${participantIds.length + 1} in this meeting`
                  : "just you so far"}
              </span>
            </div>
            {created ? (
              <p className="text-sm text-ink-muted">
                Invited: you
                {participantIds.length
                  ? ` and ${participantIds.length} other${participantIds.length === 1 ? "" : "s"}`
                  : ""}
                . Add more from the meeting page.
              </p>
            ) : (
              /* A searchable LIST, not a wall of chips — see EmployeePicker. The
                 organiser is fixed at the top and always in. */
              <EmployeePicker
                people={people.data ?? []}
                selected={participantIds}
                onToggle={(id) =>
                  setParticipantIds((c) =>
                    c.includes(id) ? c.filter((x) => x !== id) : [...c, id],
                  )
                }
                fixedId={myId}
              />
            )}
            {state.error && !state.errorField && (
              <div className="mt-4">
                <InlineError message={state.error} code={state.errorCode} />
              </div>
            )}
          </div>

          {/* The action, anchored to the card rather than floating in it. */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-5 py-3.5 sm:px-6 sm:py-4">
            {created ? (
              /* Not a reset of the same form: a second meeting is a second
                 meeting, and leaving the first one's lobby on screen while
                 typing the next one's title is two meetings in one place. */
              <Button
                onClick={() => {
                  setCreated(null);
                  setTitle(meta.defaultTitle);
                  setDescription("");
                  setParticipantIds([]);
                }}
              >
                Create another
              </Button>
            ) : (
              <Button
                loading={state.isPending}
                tone="primary"
                disabled={state.isPending || !canSubmit}
                onClick={async () => {
                  const r = await create();
                  if (r.ok) setCreated(r.data);
                }}
              >
                {state.isPending ? meta.pending : meta.cta}
              </Button>
            )}
          </div>
        </Panel>
        )}

        {/* The guest link — how people OUTSIDE CoWork get in — now lives
            inside the lobby under "Or", so one card holds both ways in. */}
        {created && (
          <MeetingLobby
            meeting={created}
            displayName={me.data?.displayName ?? "You"}
            onDismiss={() => setCreated(null)}
          />
        )}
      </div>
    </>
  );
}

/**
 * The meeting, read back — the created state's left column.
 *
 * A form whose fields are merely disabled reads as a form that has stopped
 * working. What you have after scheduling is a BOOKING, and a booking is read,
 * not edited: the title, the agenda, when it starts, who is coming — each in
 * its own card, in the order the form asked for them, so the eye confirms what
 * it just typed. No pencil on the rows, deliberately: the meeting page does not
 * offer editing yet, and an edit affordance that leads nowhere is worse than
 * none. When it does, that is where a pencil belongs.
 */
function CreatedSummary({
  meeting,
  othersCount,
  onCreateAnother,
}: {
  meeting: Meeting;
  /** Invitees besides the organiser — the same count the form kept. */
  othersCount: number;
  onCreateAnother: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Panel padded={false} label="Meeting details">
        <SummaryHead
          icon={<Icon.meeting className="h-4 w-4" />}
          title="Meeting details"
        />
        <dl className="divide-y divide-hairline border-t border-hairline">
          <SummaryRow label="Title" value={meeting.title} />
          <SummaryRow
            label="Agenda"
            value={meeting.description || "No agenda set."}
            muted={!meeting.description}
          />
        </dl>
      </Panel>

      <Panel padded={false} label="Starts">
        <SummaryHead
          icon={<Icon.calendar className="h-4 w-4" />}
          title="Starts"
        />
        <div className="px-5 pb-5">
          <div className="flex items-center gap-3 rounded-inset border border-hairline bg-[var(--surface-sunken)] px-4 py-3">
            <Icon.calendar className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <span className="text-sm text-ink">
              {formatDateTime(meeting.startsAt)}
            </span>
          </div>
        </div>
      </Panel>

      <Panel padded={false} label="Invite people">
        <SummaryHead
          icon={<Icon.team className="h-4 w-4" />}
          title="Invite people"
          aside={
            <Chip tone="neutral">
              <Icon.team
                className="mr-1 inline-block h-3 w-3 align-[-1px]"
                aria-hidden
              />
              {othersCount
                ? `${othersCount + 1} in this meeting`
                : "just you so far"}
            </Chip>
          }
        />
        <p className="px-5 pb-5 text-sm text-ink-muted">
          Invited: you
          {othersCount
            ? ` and ${othersCount} other${othersCount === 1 ? "" : "s"}`
            : ""}
          . Add more from the meeting page.
        </p>
      </Panel>

      <Button onClick={onCreateAnother} className="min-h-12 w-full">
        <Icon.plus className="mr-2 h-4 w-4" aria-hidden />
        Create another meeting
      </Button>
    </div>
  );
}

/** A summary card's heading: an icon well and the title, with an optional
    aside on the right — the same heading scale every panel in the app uses. */
function SummaryHead({
  icon,
  title,
  aside,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted"
        >
          {icon}
        </span>
        <h2 className="text-[17px] font-medium leading-none tracking-[-0.02em] text-ink">
          {title}
        </h2>
      </div>
      {aside}
    </div>
  );
}

/** One fact of the booking: what it is, and what was entered. */
function SummaryRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  /** For a value that is really an absence — "No agenda set." */
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-6 px-5 py-3.5">
      <dt className="w-20 shrink-0 text-sm text-ink-muted">{label}</dt>
      <dd
        className={`min-w-0 flex-1 text-sm ${muted ? "text-ink-faint" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function JoinPage({ token }: { token: string }) {
  const invite = useQuery((r) => r.getMeetingByToken(token), [token]);
  const { data, isLoading } = invite;

  return (
    <div className="mx-auto max-w-[520px] pt-8">
      <Panel>
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : invite.error ? (
          /* An invalid link and an unreachable server are different problems
             with different next steps, and this page is often someone's first
             contact with Cowork. */
          <QueryError
            queries={[invite]}
            message="This invitation could not be checked."
          />
        ) : !data ? (
          <EmptyState
            title="This link is not valid"
            body="The meeting may have ended, or the link may have expired."
          />
        ) : (
          <>
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Guest access
            </p>
            <h1 className="mt-2 text-[22px] leading-tight font-light tracking-[-0.03em] text-ink">
              {data.title}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {formatDateTime(data.startsAt)}
            </p>
            <p className="mt-4 text-sm text-ink-muted">
              You are joining as a guest. Guests see this meeting only and have
              no access to the rest of the workspace.
            </p>
            <div className="mt-5">
              <Button tone="primary">Join meeting</Button>
            </div>
            <p className="mt-4 border-t border-hairline pt-3 text-[11px] text-ink-faint">
              Meeting rooms are not wired in this prototype.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
