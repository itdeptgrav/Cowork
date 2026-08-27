"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Breadcrumb } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  InlineError,
  Panel,
  PanelHead,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime, formatDuration } from "@/lib/utils/format";
import { canView, joinRefusal, manageRefusal } from "@/lib/rules/meetings/access";
import { RoomClosed } from "./MeetingRoom";
import { MeetingStage } from "./MeetingStage";
import { useMeetingSession } from "./MeetingSessionContext";
import { MeetingSummaryPanel } from "./MeetingSummaryPanel";
import { RecordingsPanel } from "./RecordingsPanel";
import { VerbatimTranscriptPanel } from "./VerbatimTranscriptPanel";
import { PublicLinkPanel } from "./PublicLinkPanel";

/**
 * One meeting: the room, and everything the room does not say.
 *
 * The lifecycle controls are the organiser's alone and are rendered from
 * `manageRefusal` — the same predicate the repository refuses with — so the
 * page never offers a button that would be denied. A participant sees the room
 * and no controls; somebody who may only VIEW the meeting sees why they cannot
 * enter, which is more useful than a Join button that fails.
 */
export function MeetingDetailArea({ meetingId }: { meetingId: string }) {
  /* Whether this reader has left the room. Opening the page joins; pressing
     Leave has to take you out and KEEP you out until you rejoin. */
  const [left, setLeft] = useState(false);
  const meetingSession = useMeetingSession();
  const meeting = useQuery((r) => r.getMeeting(meetingId), [meetingId]);
  const viewer = useQuery((r) => r.getViewer(), []);
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const people = useQuery((r) => r.listEmployees(), []);
  const parts = useQuery(
    (r) => r.listMeetingParticipants(meetingId),
    [meetingId],
  );
  const events = useQuery((r) => r.listMeetingEvents(meetingId), [meetingId]);
  const [setStatus, statusState] = useAction(
    (
      r,
      next: "waiting" | "live" | "completed" | "cancelled" | "archived",
    ) => r.setMeetingStatus(meetingId, next),
  );

  /**
   * Hand the meeting to the shell, which is what keeps it alive across
   * navigation.
   *
   * Placed above the early returns below, because hooks run unconditionally —
   * everything it needs is read from the queries directly and guarded inside
   * rather than from the values computed further down.
   *
   * `open` is idempotent on the same meeting; the provider replaces the session
   * object, and the engine keeps `MeetingRoom` at the same tree position, so no
   * media is torn down by a re-open.
   */
  const openMeeting = meetingSession.open;
  const closeMeeting = meetingSession.close;
  const liveMeeting = meeting.data ?? null;
  const viewerId = viewer.data?.employeeId ?? "";
  const viewerHierarchy = viewer.data?.hierarchyIds ?? [];
  const myName = me.data?.displayName ?? "";

  useEffect(() => {
    if (!liveMeeting || left) return;
    /* The same refusal the room itself is gated on — a meeting somebody may
       not join must not be started in the shell where no page is checking. */
    if (
      joinRefusal(liveMeeting, {
        employeeId: viewerId,
        seesOrganisation: false,
        hierarchyIds: viewerHierarchy,
      })
    )
      return;

    openMeeting({
      meeting: liveMeeting,
      displayName: myName,
      isOrganiser: liveMeeting.organiserId === viewerId,
      onLeave: () => {
        setLeft(true);
        parts.refetch();
      },
    });
    /* `parts` is a query object rebuilt on every render; depending on it would
       re-open the session continuously. The callback closes over the current
       one, which is the one that should be refetched. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMeeting, left, viewerId, myName, openMeeting]);

  /* Leaving takes the meeting down everywhere, not just off this page. */
  useEffect(() => {
    if (left) closeMeeting();
  }, [left, closeMeeting]);

  if (meeting.isLoading || viewer.isLoading) return <SkeletonRows rows={8} />;
  if (meeting.error)
    return (
      <ErrorState body={meeting.error} onRetry={meeting.refetch} />
    );
  const m = meeting.data;
  if (!m)
    return (
      <Panel>
        <ErrorState title="Meeting not found" />
      </Panel>
    );

  const v = viewer.data;
  const access = {
    employeeId: v?.employeeId ?? "",
    seesOrganisation: false,
    hierarchyIds: v?.hierarchyIds ?? [],
  };

  if (v && !canView(m, access)) {
    return (
      <Panel>
        <EmptyState
          title="You don’t have access to this meeting"
          body="Meetings are visible to the people in them, and to their managers."
        />
      </Panel>
    );
  }

  const refusalToJoin = joinRefusal(m, access);
  const refusalToManage = manageRefusal(m, access.employeeId);
  const isOrganiser = m.organiserId === access.employeeId;

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Meetings", href: "/meetings" },
          { label: m.title },
        ]}
      />

      {statusState.error && (
        <div className="mb-3">
          <InlineError
            message={statusState.error}
            code={statusState.errorCode}
          />
        </div>
      )}

      {/* The organiser's controls. Absent entirely for everybody else — a
          disabled End button on somebody else's meeting is an invitation to
          wonder why. */}
      {!refusalToManage && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {m.status === "scheduled" && (
            <Button
              tone="secondary"
              size="sm"
              disabled={statusState.isPending}
              onClick={() => void setStatus("waiting")}
            >
              Open the room
            </Button>
          )}
          {(m.status === "scheduled" || m.status === "waiting") && (
            <Button
              tone="primary"
              size="sm"
              disabled={statusState.isPending}
              onClick={() => void setStatus("live")}
            >
              Start meeting
            </Button>
          )}
          {(m.status === "live" || m.status === "waiting") && (
            <Button
              tone="secondary"
              size="sm"
              disabled={statusState.isPending}
              onClick={() => void setStatus("completed")}
            >
              End for everyone
            </Button>
          )}
          {(m.status === "scheduled" || m.status === "waiting") && (
            <Button
              tone="ghost"
              size="sm"
              disabled={statusState.isPending}
              onClick={() => void setStatus("cancelled")}
            >
              Cancel
            </Button>
          )}
          {m.status === "completed" && (
            <Button
              tone="ghost"
              size="sm"
              disabled={statusState.isPending}
              onClick={() => void setStatus("archived")}
            >
              Archive
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 deck:grid-cols-3">
        <div className="deck:col-span-2">
          {refusalToJoin ? (
            <RoomClosed reason={refusalToJoin} />
          ) : left ? (
            /**
             * **Leaving has to UNMOUNT the room, not merely be noticed.**
             *
             * `onLeave` refetched the participant list and nothing else, so the
             * room stayed mounted with `connect` still set — LiveKit dropped the
             * connection and immediately made another. Pressing Leave put you
             * straight back in the same call, which is what was reported.
             *
             * The guest view has always done this correctly by moving to a
             * lobby phase; this one had no notion of being out of the room at
             * all, and auto-joined the moment the page rendered.
             */
            <Panel>
              <div className="grid place-items-center px-8 py-14 text-center">
                <p className="text-[15px] font-medium text-ink">
                  You have left this meeting
                </p>
                <p className="mt-1.5 max-w-[42ch] text-xs leading-relaxed text-ink-muted">
                  Your camera and microphone are off and you are no longer in the
                  room. The meeting carries on without you until the organiser
                  ends it.
                </p>
                <div className="mt-4">
                  <Button size="sm" onClick={() => setLeft(false)}>
                    Rejoin
                  </Button>
                </div>
              </div>
            </Panel>
          ) : (
            /**
             * **The room is not rendered here any more — only its place is.**
             *
             * `MeetingEngine` mounts it once in the shell and draws it over
             * this rectangle. That is what lets Back, a notification, or any
             * link keep the meeting alive: the page stops publishing a place
             * to draw and the meeting moves to the corner, instead of being
             * unmounted mid-call with the recording unfinalised.
             *
             * `min-h-[520px]` matches what `RoomFrame` reserved when it was
             * here, so the page's layout is unchanged.
             */
            <MeetingStage className="min-h-[520px] w-full rounded-card" />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHead title="Details" sub="What this meeting is for" />
            <dl className="divide-y divide-hairline text-sm">
              <Fact label="When" value={formatDateTime(m.startsAt)} />
              <Fact
                label={m.actualDurationSecs !== null ? "Ran for" : "Scheduled"}
                value={formatDuration(
                  m.actualDurationSecs ??
                    Math.max(
                      0,
                      Math.round(
                        (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 1000,
                      ),
                    ),
                )}
              />
              <Fact
                label="Organiser"
                value={
                  people.data?.find((p) => p.id === m.organiserId)
                    ?.displayName ?? "—"
                }
              />
            </dl>
            {m.description && (
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                {m.description}
              </p>
            )}
            {m.agenda.length > 0 && (
              <>
                <p className="mt-4 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                  Agenda
                </p>
                <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-4 text-sm text-ink-muted">
                  {m.agenda.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </>
            )}
            {m.taskId && (
              <p className="mt-4 text-xs">
                <Link
                  href={`/tasks/${m.taskId}`}
                  className="text-ink underline decoration-hairline underline-offset-4"
                >
                  Open the related task
                </Link>
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHead
              title="Participants"
              sub={`${parts.data?.length ?? 0} invited`}
            />
            <ul className="mt-2 flex flex-col gap-2">
              {(parts.data ?? []).map((p) => {
                const person = people.data?.find((e) => e.id === p.employeeId);
                return (
                  <li key={p.id} className="flex items-center gap-2.5">
                    <Avatar
                      initials={person?.initials ?? "??"}
                      hue={person?.hue ?? 0}
                      name={person?.displayName ?? p.employeeId}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {person?.displayName ?? p.employeeId}
                      </span>
                      <span className="block text-[11px] text-ink-faint">
                        {p.role === "organiser" ? "Organiser" : "Participant"}
                      </span>
                    </span>
                    <Chip
                      tone={
                        p.attendanceStatus === "joined"
                          ? "positive"
                          : p.attendanceStatus === "absent"
                            ? "overdue"
                            : "neutral"
                      }
                    >
                      {p.attendanceStatus}
                    </Chip>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {/* Transcript first, summary second. What was actually said is the
              record; the summary is a reading of it, and putting the reading
              above the record invites the reading to be taken for the record.
              They stay two panels rather than tabs of one — see
              VerbatimTranscriptPanel's own header for why they must not be
              conflated: the summary paraphrases and translates by design,
              while this flags uncertainty instead of guessing. */}
          <Panel>
            <PanelHead
              title="Transcript"
              sub="Verbatim or translated — never the summary's silent paraphrase"
            />
            <VerbatimTranscriptPanel
              meetId={meetingId}
              meetStatus={m.status}
            />
          </Panel>

          <Panel>
            <PanelHead
              title="AI Summary"
              sub="Generated from meeting audio"
            />
            <MeetingSummaryPanel
              meetId={meetingId}
              meetStatus={m.status}
            />
          </Panel>

          {/* **Whose audio was saved, beside the summary made from it.**
              Everyone in the meeting sees it, not only the organiser: the
              person most able to act on their own missing recording is the
              person it belongs to, and the recovery — unsent clips kept in
              their browser — happens in THEIR browser. */}
          <RecordingsPanel
            meetingId={meetingId}
            participants={parts.data ?? []}
            nameFor={(id) =>
              people.data?.find((e) => e.id === id)?.displayName ?? id
            }
          />

          {isOrganiser && (
            <Panel>
              <PanelHead
                title="Guest link"
                sub="Share with people outside CoWork"
              />
              <PublicLinkPanel meetId={meetingId} />
            </Panel>
          )}

          <Panel>
            <PanelHead title="History" sub="Every change to this meeting" />
            {events.data?.length ? (
              <ol className="mt-2 flex flex-col gap-2">
                {events.data.map((e) => (
                  <li key={e.id} className="text-[11px] text-ink-faint">
                    <span className="text-ink-muted">{e.actorName}</span>{" "}
                    {e.type.replace(/_/g, " ")} ·{" "}
                    {formatDateTime(e.createdAt)}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Nothing recorded.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 truncate text-ink">{value}</dd>
    </div>
  );
}
