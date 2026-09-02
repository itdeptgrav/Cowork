"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
export function NewMeetingForm() {
  const [title, setTitle] = useState("");
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
    if (startsAt) return;
    /* The next half hour, local. A fixed date in the source was shipping a
       default that had already passed.

       Deferred to the next frame rather than set in the effect body — the same
       reason `ThemeContext` defers its own sync. This reads an external system
       (the wall clock) that the server cannot agree with, and setting it
       synchronously cascades a render. */
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
  }, [startsAt]);

  const [create, state] = useAction((r) =>
    r.createMeeting({
      title,
      description: description || null,
      participantIds: effectiveParticipantIds,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(new Date(startsAt).getTime() + 3600_000).toISOString(),
    }),
  );

  /* Everybody except the organiser, who is rendered separately and fixed. */
  const others = (people.data ?? []).filter((p) => p.id !== myId);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Meetings", href: "/meetings" },
          { label: created ? created.title : "Schedule" },
        ]}
      />
      <h1 className="mt-2 mb-4 text-[clamp(1.375rem,2vw,1.75rem)] leading-none font-light tracking-[-0.03em] text-ink">
        {created ? "Ready when you are" : "Schedule a meeting"}
      </h1>

      {/* The lobby takes a column of its own from the deck breakpoint up, and
          stacks beneath the form below it — a camera preview squeezed into a
          third of a phone screen is not a preview. */}
      <div
        className={
          created
            ? "grid max-w-[1080px] items-start gap-4 deck:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]"
            : "max-w-[720px]"
        }
      >
        <Panel>
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
          <Field label="Agenda" className="mt-3">
            <Textarea
              rows={3}
              value={description}
              disabled={Boolean(created)}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label="Starts"
            required
            className="mt-3"
            error={state.errorField === "startsAt" ? state.error : null}
          >
            <Input
              type="datetime-local"
              value={startsAt}
              disabled={Boolean(created)}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>

          <div className="mt-3">
            <span className="mb-1.5 block text-sm font-medium text-ink">
              Participants
            </span>
            <div className="flex flex-wrap gap-1.5">
              {/* The organiser, fixed. Rendered as a chip rather than a
                  disabled button so it never reads as something that failed
                  to switch on. */}
              {me.data && (
                <span
                  className="rounded-full bg-ink px-2.5 py-1 text-sm text-[var(--body-bg)]"
                  title="You are always in a meeting you call"
                >
                  {me.data.displayName}
                  <span className="ml-1.5 opacity-60">you</span>
                </span>
              )}
              {others.map((p) => {
                const on = participantIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    disabled={Boolean(created)}
                    onClick={() =>
                      setParticipantIds((c) =>
                        c.includes(p.id)
                          ? c.filter((x) => x !== p.id)
                          : [...c, p.id],
                      )
                    }
                    className={`rounded-full px-2.5 py-1 text-sm transition-colors disabled:opacity-50 ${
                      on
                        ? "bg-ink text-[var(--body-bg)]"
                        : "bg-[var(--control)] text-ink-muted"
                    }`}
                  >
                    {p.displayName}
                  </button>
                );
              })}
            </div>
          </div>

          {state.error && !state.errorField && (
            <div className="mt-3">
              <InlineError message={state.error} code={state.errorCode} />
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {created ? (
              /* Not a reset of the same form: a second meeting is a second
                 meeting, and leaving the first one's lobby on screen while
                 typing the next one's title is two meetings in one place. */
              <Button
                onClick={() => {
                  setCreated(null);
                  setTitle("");
                  setDescription("");
                  setParticipantIds([]);
                }}
              >
                Schedule another
              </Button>
            ) : (
              <Button loading={state.isPending}
                tone="primary"
                disabled={state.isPending || !title.trim() || !startsAt}
                onClick={async () => {
                  const r = await create();
                  if (r.ok) setCreated(r.data);
                }}
              >
                {state.isPending ? "Scheduling…" : "Schedule"}
              </Button>
            )}
          </div>
        </Panel>

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
