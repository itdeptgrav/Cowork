"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
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
import { AddParticipants } from "./AddParticipants";
import {
  EndForEveryoneButton,
  EndForEveryoneConfirm,
  EndingReport,
} from "./EndingReport";

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
  /* AI Summary is hidden from the UI on request. The panel, its "Generate
     summary" action and the backend generation are all left intact — this only
     controls whether the panel renders. Flip to true to bring it back. */
  const showAiSummary = false;
  /* End for everyone: the confirmation, then the wrap-up panel from the moment
     End was pressed (its clock) until it closes itself or is dismissed. */
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [endedAt, setEndedAt] = useState<number | null>(null);
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
   * Starting a meeting MINTS its room — see the Start button. A separate
   * action from the status writes because it is a different call with a
   * different failure ("Could not create LiveKit room…") that deserves its own
   * pending state and its own message.
   */
  const [openRoom, openState] = useAction((r) => r.openMeetingRoom(meetingId));

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
        /* The meeting too: when the room closed because the organiser ended
           it, the page has to learn that NOW — `left` alone would offer a
           Rejoin into a meeting that no longer exists until the next poll. */
        meeting.refetch();
      },
    });
    /* `parts` and `meeting` are query objects rebuilt on every render;
       depending on them would re-open the session continuously. The callback
       closes over the current ones, which are the ones to refetch. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMeeting, left, viewerId, myName, openMeeting, closeMeeting]);

  /* Leaving takes the meeting down everywhere, not just off this page. */
  useEffect(() => {
    if (left) closeMeeting();
  }, [left, closeMeeting]);

  /**
   * The room going away IS leaving, whoever noticed it first.
   *
   * The effect above opens a session whenever `left` is false, and `left` is
   * set by a callback carried on the session. That is one link too many for
   * something this consequential: if the callback ever fails to reach THIS
   * component — and it did, when the shell kept a callback belonging to an
   * earlier instance of this page (see `MeetingSessionContext`'s note) —
   * `left` stays false, the effect above sees a meeting with no session, and
   * puts the reader straight back into the call they just hung up. Pressing
   * Leave then looks like it does nothing at all.
   *
   * So the room disappearing is read directly, as state, rather than waited
   * for as a message. `hadSession` is what makes it a TRANSITION: this page
   * opens with no session and must not read that as having left, and it must
   * not fight the ordinary case of a session it has not opened yet.
   *
   * A refusal — the organiser ending the meeting — also closes the session,
   * and this marks that as left too. Harmless: the render below shows
   * `RoomClosed` for a refusal in preference to the left card, so the reason
   * somebody sees is still the real one.
   */
  const hadSession = useRef(false);
  const engineSession = meetingSession.session;
  useEffect(() => {
    if (engineSession) {
      hadSession.current = true;
      return;
    }
    if (!hadSession.current) return;
    hadSession.current = false;
    setLeft(true);
  }, [engineSession]);

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
              <Button loading={statusState.isPending}
                tone="secondary"
                size="sm"
                disabled={statusState.isPending}
                onClick={() => void setStatus("waiting")}
              >
                Open the room
              </Button>
            )}
            {(m.status === "scheduled" ||
              m.status === "waiting" ||
              /* A meeting marked Live with no room behind it — the state the
                 old Start button left meetings in. The engine's start is
                 idempotent and mints the MISSING room for exactly this case,
                 so Start is offered here as the repair. */
              (m.status === "live" && !m.livekitRoomName)) && (
              /* `openMeetingRoom`, NOT `setStatus("live")`. The room is a real
                 thing that has to be minted before anyone can enter it: the
                 engine's /livekit/start creates the LiveKit room, stores its
                 name and sets the status as a CONSEQUENCE. Writing the status
                 alone marked the meeting Live with no room behind it, and
                 everyone — the organiser included — was told "The room is not
                 open" on a meeting whose own chip said Live. */
              <Button
                loading={openState.isPending}
                tone="positive"
                size="md"
                disabled={statusState.isPending || openState.isPending}
                onClick={() => void openRoom()}
              >
                <Icon.play className="mr-1.5 h-4 w-4" aria-hidden />
                Start meeting
              </Button>
            )}
            {(m.status === "live" || m.status === "waiting") && (
              /* Behind a confirmation — see EndingReport.tsx — because this
                 disconnects everybody, guests included, and cannot be undone. */
              <EndForEveryoneButton
                pending={statusState.isPending}
                open={confirmEnd}
                onToggle={() => setConfirmEnd((v) => !v)}
              />
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

      {openState.error && (
        /* The room failing to open is its own sentence — "Could not create
           LiveKit room…" — not a status write that went wrong. */
        <div className="mb-3">
          <InlineError message={openState.error} code={openState.errorCode} />
        </div>
      )}

      {confirmEnd && (
        <div className="mb-3">
          <EndForEveryoneConfirm
            onConfirm={() => {
              setConfirmEnd(false);
              /* The clock the wrap-up panel counts from, taken in the click. */
              setEndedAt(Date.now());
              void setStatus("completed");
            }}
            onCancel={() => setConfirmEnd(false)}
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
      <div className="grid gap-5 deck:grid-cols-3 deck:items-start">
        {/**
         * **The left column is the content; the rail is the meta — and the
         * rail is what sticks.**
         *
         * This used to pin the ROOM and stack every panel in the rail. Beside
         * a closed room that was a 280px box next to a column-wide hole, with
         * eight panels running down the right — the page read as all rail.
         * Now the room is followed by what a reader actually works with (who
         * is here, the guest link, the record), so the left fills; and the
         * short rail of facts and logs is the sticky part, staying in view
         * while the content scrolls — the usual shape of a sidebar.
         * `self-start` on the rail is still what lets it slide: a stretched
         * grid item is as tall as its row and has nothing to slide within.
         */}
        <div className="flex flex-col gap-4 deck:col-span-2">
          {endedAt !== null && (
            /* The organiser's view of everybody's audio arriving, after End
               for everyone. Above the closed room, where the room was. */
            <EndingReport
              meetId={meetingId}
              employeeId={viewerId}
              people={(parts.data ?? [])
                .filter((p) => p.joinedAt !== null)
                .map((p) => ({
                  id: p.employeeId,
                  name:
                    people.data?.find((e) => e.id === p.employeeId)
                      ?.displayName ?? p.employeeId,
                }))}
              startedAt={endedAt}
              onDismiss={() => setEndedAt(null)}
            />
          )}
          {isOrganiser &&
            !m.livekitRoomName &&
            (m.status === "scheduled" ||
              m.status === "waiting" ||
              m.status === "live") && (
              /* The room is not open and THIS is the person who opens it. The
                 stage below says "the organiser opens it when they are ready"
                 — which, read by the organiser, is a riddle — and the real
                 button sits in the corner where nobody looks. So say it
                 plainly, right above the empty room, with the button in hand. */
              <Panel label="Start this meeting">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-inset bg-[color-mix(in_srgb,var(--state-positive)_18%,transparent)] text-[var(--state-positive-ink)]"
                    >
                      <Icon.play className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        The room isn't open yet.
                      </p>
                      <p className="text-xs leading-relaxed text-ink-muted">
                        Press Start meeting when you're ready — everyone invited
                        can join from then on.
                      </p>
                    </div>
                  </div>
                  <Button
                    tone="positive"
                    size="md"
                    loading={openState.isPending}
                    disabled={statusState.isPending || openState.isPending}
                    onClick={() => void openRoom()}
                    className="shrink-0"
                  >
                    <Icon.play className="mr-1.5 h-4 w-4" aria-hidden />
                    Start meeting
                  </Button>
                </div>
              </Panel>
            )}
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
              <div className="grid place-items-center px-8 py-16 text-center">
                <span
                  aria-hidden
                  className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-[var(--control)] text-ink-muted"
                >
                  <Icon.meeting className="h-6 w-6" />
                </span>
                <p className="text-[17px] font-medium tracking-[-0.02em] text-ink">
                  You have left this meeting
                </p>
                <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-ink-muted">
                  Your camera and microphone are off and you are no longer in the
                  room. The meeting carries on without you until the organiser
                  ends it.
                </p>
                <div className="mt-5">
                  <Button size="sm" tone="primary" onClick={() => setLeft(false)}>
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
              className="min-h-[min(26rem,calc(100dvh-6rem))] w-full rounded-card sm:min-h-[min(30rem,calc(100dvh-6rem))] deck:min-h-[min(32.5rem,calc(100dvh-6rem))]"
            />
          )}

          {/* Who is here, directly under the room — the first thing a reader
              wants after the picture itself. */}
          <Panel label="Participants">
            <PanelHead
              title="Participants"
              icon={<Icon.team className="h-4 w-4" />}
              aside={
                <Chip tone="neutral">
                  {`${parts.data?.length ?? 0} invited`}
                </Chip>
              }
            />
            <ul className="mt-1 flex flex-col divide-y divide-hairline">
              {(parts.data ?? []).map((p) => {
                const person = people.data?.find((e) => e.id === p.employeeId);
                return (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <Avatar
                      initials={person?.initials ?? "??"}
                      hue={person?.hue ?? 0}
                      name={person?.displayName ?? p.employeeId}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {person?.displayName ?? p.employeeId}
                      </span>
                      <span className="block text-xs text-ink-faint">
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
                      {/* A dot in the status's own ink, so joined / absent /
                          invited read at a glance down the list. */}
                      <span
                        aria-hidden
                        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle"
                      />
                      {p.attendanceStatus.charAt(0).toUpperCase() +
                        p.attendanceStatus.slice(1)}
                    </Chip>
                  </li>
                );
              })}
            </ul>
            {/* The organiser can pull in more internal people after the fact —
                outside guests go through the guest link below. */}
            {isOrganiser && (
              <AddParticipants
                meetingId={meetingId}
                currentIds={m.participantIds}
                organiserId={m.organiserId}
                people={people.data ?? []}
              />
            )}
          </Panel>

          {/**
           * **The two logs, together and shut.**
           *
           * Recorded audio and History are the only panels that grow without
           * bound — one row per clip, one line every time anybody joins or
           * leaves. A meeting with twenty-two clips from four people put
           * twenty-two rows on the page, and between them they were most of
           * its height and none of its usual reading.
           *
           * They are also the only two nobody reads in passing. Details,
           * Participants and the transcript answer questions you have while
           * looking at the page; these answer questions you came for. So they
           * sit together under their own heading, and they start shut — with
           * their headline still on the closed header, because minimising
           * should cost the detail and never the answer.
           *
           * `pt-4` plus the heading's `first:mt-0`/`mb-3` gives the rail's own
           * 32/12 section rhythm inside this `gap-4` column; `[&>section]:mb-4`
           * spaces the two logs, and the last one's margin is dropped so the
           * column's gap does the work below it.
           */}
          <div className="pt-4 [&>section]:mb-4 [&>section:last-child]:mb-0">
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
                <ol className="flex flex-col divide-y divide-hairline">
                  {events.data.map((e) => (
                    <li key={e.id} className="py-2 text-xs text-ink-faint">
                      <span className="font-medium text-ink">{e.actorName}</span>{" "}
                      <span className="text-ink-muted">
                        {e.type.replace(/_/g, " ")}
                      </span>
                      <span className="mt-0.5 block tabular-nums">
                        {formatDateTime(e.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-muted">Nothing recorded.</p>
              )}
            </CollapsiblePanel>
          </div>

          {/* Transcript first, summary second. What was actually said is the
              record; the summary is a reading of it, and putting the reading
              above the record invites the reading to be taken for the record.
              They stay two panels rather than tabs of one — see
              VerbatimTranscriptPanel's own header for why they must not be
              conflated: the summary paraphrases and translates by design,
              while this flags uncertainty instead of guessing.

              `pt-4` on the group plus the heading's own `first:mt-0` and `mb-3`
              reproduces the rail's section rhythm exactly — 32px above the
              heading, 12px below — inside a `gap-4` column. */}
          <div className="pt-4">
            <RailHeading>The record</RailHeading>
            <Panel label="Transcript">
              <PanelHead
                title="Transcript"
                sub="Verbatim or translated — never the summary's silent paraphrase"
                icon={<Icon.list className="h-4 w-4" />}
              />
              <VerbatimTranscriptPanel
                meetId={meetingId}
                meetStatus={m.status}
              />
            </Panel>
          </div>

          {showAiSummary && (
            <Panel label="AI Summary">
              <PanelHead
                title="AI Summary"
                sub="Generated from meeting audio"
                icon={<Icon.sparkle className="h-4 w-4" />}
              />
              <MeetingSummaryPanel
                meetId={meetingId}
                meetStatus={m.status}
              />
            </Panel>
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
         * keyboard traverse Details → Recorded audio → History regardless of
         * how the columns fall.
         *
         * `deck:columns-1` returns it to a single flow once it is a rail beside
         * the room, where it is one column by definition — and there it is the
         * sticky column: short (facts and two shut logs), it stays in view while
         * the taller content column scrolls past it.
         */}
        <div className="gap-4 sm:columns-2 deck:columns-1 [&>section]:mb-4 [&>section]:break-inside-avoid deck:sticky deck:top-4 deck:self-start">
          <RailHeading>About this meeting</RailHeading>

          <Panel label="Details">
            <PanelHead
              title="Details"
              sub="What this meeting is for"
              icon={<Icon.calendar className="h-4 w-4" />}
            />
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
                {/* Title case, not a tracked eyebrow — the same One Kicker Rule
                    the rail headings follow. */}
                <p className="mt-4 text-xs font-medium text-ink-muted">Agenda</p>
                <ol className="mt-1.5 flex list-decimal flex-col gap-1.5 pl-4 text-sm text-ink-muted">
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


          {/* How people OUTSIDE CoWork get in — filed under About, because it
              is about access to the meeting rather than a record of it. Tinted
              in the extension hue so it reads as the one card here that DOES
              something, told apart from the facts above it at a glance. Inline,
              so the panel's own frost background cannot outrank the tint. */}
          {isOrganiser && (
            <Panel
              label="Guest link"
              style={{
                background:
                  "color-mix(in srgb, var(--state-extension) 12%, transparent)",
                borderColor:
                  "color-mix(in srgb, var(--state-extension) 40%, transparent)",
              }}
            >
              <PanelHead
                title="Guest link"
                sub="Share with people outside CoWork"
                icon={
                  <Icon.link className="h-4 w-4 text-[var(--state-extension-ink)]" />
                }
              />
              <PublicLinkPanel meetId={meetingId} />
            </Panel>
          )}
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
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="min-w-0 shrink text-ink-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-ink tabular-nums sm:shrink-0 sm:text-right">
        {value}
      </dd>
    </div>
  );
}
