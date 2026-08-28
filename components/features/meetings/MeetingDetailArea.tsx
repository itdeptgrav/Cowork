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
import { CollapsiblePanel } from "./CollapsiblePanel";
import { MeetingMasthead } from "./MeetingMasthead";
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
    ) {
      /**
       * **Closed, not merely not-opened.**
       *
       * This used to `return`, which is right the first time round and wrong
       * every time after. Pressing **End for everyone** flips the status to
       * `completed`, the refusal becomes "This meeting has ended.", and the
       * page correctly says so — while the floating window carried on in the
       * corner with everybody's tiles and a live control bar, because nothing
       * ever told the session it was over. The organiser had ended the meeting
       * and was still sitting in it.
       *
       * The same line covers cancelling, archiving, and being removed from the
       * invitation while the window is open: the moment a meeting is one you
       * may not join, you are not in it.
       */
      closeMeeting();
      return;
    }

    openMeeting({
      kind: "scheduled",
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
  }, [liveMeeting, left, viewerId, myName, openMeeting, closeMeeting]);

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

  /**
   * The organiser's state controls, built once and handed to the masthead.
   *
   * A variable rather than inline JSX because the masthead decides WHERE they
   * sit — end of the title row on a wide screen, their own full-width row on a
   * narrow one — and that decision should live in one place, not be duplicated
   * as two conditional blocks in the page.
   */
  const organiserActions = (
    <>
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
    </>
  );

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

      {/**
       * **The page finally has a title.**
       *
       * The meeting's name used to appear only as the last breadcrumb — caption
       * size, muted, styled as navigation — while a row of five buttons was the
       * loudest thing on the screen. The masthead puts identity first and the
       * controls where a wide screen finishes reading, and it carries the when
       * / how long / who, because below `deck` the Details panel that holds
       * those facts sits a full screen-height below the room.
       *
       * The organiser's controls are passed in and are absent entirely for
       * everybody else — a disabled End button on somebody else's meeting is an
       * invitation to wonder why.
       */}
      <MeetingMasthead
        title={m.title}
        status={m.status}
        when={formatDateTime(m.startsAt)}
        duration={formatDuration(
          m.actualDurationSecs ??
            Math.max(
              0,
              Math.round(
                (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 1000,
              ),
            ),
        )}
        organiser={
          people.data?.find((p) => p.id === m.organiserId)?.displayName ?? "—"
        }
        actions={refusalToManage ? undefined : organiserActions}
      />


      {/**
       * **Three compositions, one for each way this page is actually used.**
       *
       * There used to be two: a 2:1 split at `deck`, and below it a single
       * column. That single column was the whole problem. On a tablet — and on
       * a desktop window merely dragged narrow — the room went full width and
       * then **eight panels** stacked beneath it in one file: Details,
       * Participants, Transcript, Summary, Recordings, Guest link, History. A
       * 900px-wide screen showed a 900px-wide Details panel with two facts on
       * it, and finding the transcript meant scrolling past all of them.
       *
       * - **< 640px** — one column. There is no width to divide.
       * - **640–1179px** — the rail flows into TWO columns beneath the room.
       * - **≥ 1180px** — the deck: room at 2/3, rail beside it at 1/3.
       */}
      <div className="grid gap-4 deck:grid-cols-3 deck:items-start">
        {/**
         * **The room sticks; the rail scrolls past it.**
         *
         * The room is a fixed 520px and the rail is seven panels tall, so the
         * left column ran out of content less than halfway down the page and
         * left a column-wide hole of nothing under the video while the
         * transcript continued below the fold. Two things were wrong with that
         * at once: the emptiest part of the page was its centre, and reading
         * the transcript meant scrolling the live meeting off the screen.
         *
         * Sticky fixes both — the video stays put while its record moves past
         * it, which is also what somebody reading a transcript during a call
         * actually wants. `self-start` is required: a stretched grid item is
         * as tall as its row and has nothing to slide within.
         */}
        <div className="deck:sticky deck:top-4 deck:col-span-2 deck:self-start">
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
            <MeetingStage
              /**
               * **A height ladder, not a flat 520px.**
               *
               * `min-h-[520px]` is a desk measurement. On a 667px-tall phone it
               * left 147px for a masthead, a breadcrumb and the browser's own
               * chrome — so the control bar, which is the last thing in the
               * room and the only way to mute or leave, sat below the fold on
               * the one device where scrolling during a call is hardest.
               *
               * The room lays itself out from this box, so the ladder is what
               * makes a phone get a usable call rather than a cropped one.
               */
              className="min-h-[26rem] w-full rounded-card sm:min-h-[30rem] deck:min-h-[32.5rem]"
            />
          )}
        </div>

        {/**
         * **CSS columns, not a grid, and that is the whole trick.**
         *
         * These panels have wildly different heights — Details is four lines,
         * a generated transcript is hundreds. In a two-column `grid` every row
         * is as tall as its tallest cell, so a short panel beside a long one
         * leaves a hole the size of the difference. `columns` has no rows: each
         * panel is placed directly under the one before it and the browser
         * balances the two flows. `break-inside-avoid` is what stops a panel
         * being sawn in half across the gap.
         *
         * Reading order is the DOM order either way, so a screen reader and a
         * keyboard traverse Details → Participants → Transcript regardless of
         * how the columns fall.
         *
         * `deck:columns-1` returns it to a single flow once it is a rail beside
         * the room, where it is one column by definition.
         */}
        <div className="gap-4 sm:columns-2 deck:columns-1 [&>section]:mb-4 [&>section]:break-inside-avoid">
          <RailHeading>About this meeting</RailHeading>

          <Panel label="Details">
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

          <Panel label="Participants">
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
          <RailHeading>The record</RailHeading>

          <Panel label="Transcript">
            <PanelHead
              title="Transcript"
              sub="Verbatim or translated — never the summary's silent paraphrase"
            />
            <VerbatimTranscriptPanel
              meetId={meetingId}
              meetStatus={m.status}
            />
          </Panel>

          <Panel label="AI Summary">
            <PanelHead
              title="AI Summary"
              sub="Generated from meeting audio"
            />
            <MeetingSummaryPanel
              meetId={meetingId}
              meetStatus={m.status}
            />
          </Panel>

          {isOrganiser && (
            <Panel label="Guest link">
              <PanelHead
                title="Guest link"
                sub="Share with people outside CoWork"
              />
              <PublicLinkPanel meetId={meetingId} />
            </Panel>
          )}

          {/**
           * **The two logs, together and shut.**
           *
           * Recorded audio and History are the only panels here that grow
           * without bound — one row per clip, one line every time anybody joins
           * or leaves. A meeting with twenty-two clips from four people put
           * twenty-two rows in the rail, and between them they were most of the
           * page's height and none of its usual reading.
           *
           * They are also the only two nobody reads in passing. Details,
           * Participants and the transcript answer questions you have while
           * looking at the page; these answer questions you came for. So they
           * sit last, and they start shut — with their headline still on the
           * closed header, because minimising should cost the detail and never
           * the answer.
           */}
          <RailHeading>Files and history</RailHeading>

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

          <CollapsiblePanel
            title="History"
            sub="Every change to this meeting"
            summary={
              events.data?.length
                ? `${events.data.length} change${events.data.length === 1 ? "" : "s"}`
                : "Nothing recorded."
            }
          >
            {events.data?.length ? (
              <ol className="flex flex-col gap-2">
                {events.data.map((e) => (
                  <li key={e.id} className="text-[11px] text-ink-faint">
                    <span className="text-ink-muted">{e.actorName}</span>{" "}
                    {e.type.replace(/_/g, " ")} ·{" "}
                    {formatDateTime(e.createdAt)}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-muted">Nothing recorded.</p>
            )}
          </CollapsiblePanel>
        </div>
      </div>
    </>
  );
}

/**
 * A heading that names a group of panels in the rail.
 *
 * The rail was seven panels in a row with nothing to say which were about the
 * meeting, which were produced by it, and which were housekeeping. Every one
 * carried the same weight of heading, so the eye had to read all seven titles
 * to find the one it wanted, every time.
 *
 * **Title, not a tracked uppercase eyebrow.** DESIGN.md's One Kicker Rule is
 * explicit that tracked caps over a panel is a defect — the tracked style is
 * reserved for the single wayfinding kicker in a view and for metric labels.
 * A section heading takes Title, and the separation is carried by space:
 * `32px` above and `12px` below, which is the system's own rhythm for a
 * section heading, against the `16px` that runs between panels within a group.
 * Proximity does the grouping; the heading only names it.
 *
 * `break-after-avoid` matters because the rail is a CSS-columns flow between
 * `sm` and `deck`: without it a heading can be laid at the foot of one column
 * with everything it names at the head of the next.
 */
function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 mb-3 break-after-avoid px-1 text-[15px] leading-none font-medium tracking-[-0.012em] text-ink-muted first:mt-0">
      {children}
    </h2>
  );
}

/**
 * One labelled fact.
 *
 * **`truncate` was the bug in the screenshot.** The row was
 * `justify-between` with a truncating value, so once the panel became a narrow
 * rail the label kept its full width and the value — the only part carrying
 * information — was clipped to "28". A date that reads "28" is worse than no
 * date: it looks like a value rather than like something missing.
 *
 * Now the label may shrink and the value may not, and below `sm` the pair
 * stacks so a long date gets the panel's whole width. Nothing is ever cut.
 */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="min-w-0 shrink text-ink-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-ink tabular-nums sm:shrink-0 sm:text-right">
        {value}
      </dd>
    </div>
  );
}
