"use client";

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
import { MeetingRoom, RoomClosed } from "./MeetingRoom";
import { MeetingSummaryPanel } from "./MeetingSummaryPanel";
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
          ) : (
            <MeetingRoom
              meeting={m}
              isOrganiser={isOrganiser}
              displayName={me.data?.displayName ?? ""}
              onLeave={() => parts.refetch()}
            />
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

          {/* A separate panel, not a tab inside the summary above — see this
              component's own header comment for why the two must not be
              conflated: the summary translates and paraphrases by design;
              this flags uncertainty instead of guessing, in either of its
              own two modes (verbatim or translated). */}
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
