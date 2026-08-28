"use client";

import { useEffect, useRef, useState } from "react";
import "@livekit/components-styles";
import { creditedToTask } from "@/lib/rules/meetings/creditedToTask";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  EmptyState,
  InlineError,
  Panel,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import {
  attendeeCount,
  distinctAttendees,
  realMeetingsOnly,
} from "@/lib/rules/meetings/realMeeting";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { MeetingStage } from "@/components/features/meetings/MeetingStage";
import { useMeetingSession } from "@/components/features/meetings/MeetingSessionContext";
import { RecordingsPanel } from "@/components/features/meetings/RecordingsPanel";
import { MeetingSummaryPanel } from "@/components/features/meetings/MeetingSummaryPanel";
import { VerbatimTranscriptPanel } from "@/components/features/meetings/VerbatimTranscriptPanel";
import { taskMeetingRoomName } from "@/lib/rules/meetings/taskRoom";
import {
  liveCrossDeptFigures,
  liveMeetingFigures,
  roomIsEmpty,
} from "@/lib/rules/meetings/meetingCredit";
import { formatDateTime, formatTimer } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * A task's own meeting: join it, and what previous ones cost.
 *
 * ## Why there is nothing to schedule
 *
 * Every task has a room. It is not created until somebody presses Join —
 * a room per task made up front would be thousands nobody entered — but from
 * the reader's point of view it has simply always been there, which is the
 * point. Scheduling a meeting to explain a task is the step this removes.
 *
 * ## The figures, and why three of them
 *
 * `First start` and `Last end` bracket the whole history; `Total` counts only
 * the meetings themselves. They are deliberately not derivable from one
 * another — sessions at 10:00–10:30 and 14:00–14:20 give a four-hour bracket
 * and fifty minutes of meeting — and showing the bracket as the duration would
 * claim four hours of deadline for fifty minutes of talking.
 *
 * ## What the person needs to know before they press Join
 *
 * That the clock only runs while BOTH sides are in the room — the person who
 * assigned the work and the person doing it. Without that sentence, somebody
 * who joins alone and waits will reasonably expect the time to count, and will
 * be wrong. It is said on the panel rather than left for them to discover from
 * a total that did not move. (Cross-department work keeps its own rule: any two
 * people, because the sender of record is often not in the call.)
 *
 * ## The room is rendered here, not linked to
 *
 * An earlier version of this panel took the token from `joinTaskMeeting` and
 * dropped it, showing a green "In the room" pill beside no room at all — the
 * session was recorded, the deadline arithmetic ran, and there was nothing to
 * talk into. A meeting the product believes is happening and the person cannot
 * see is worse than no meeting: it credits time against a conversation that
 * never took place.
 */
export function TaskMeetingPanel({ view }: { view: TaskView }) {
  const taskId = view.task.id;
  const sessions = useQuery(
    (r) => r.listTaskMeetingSessions(taskId),
    [taskId, view.task.meetings.lastEndedAt],
  );
  const [joined, setJoined] = useState<{
    sessionId: string;
    roomName: string;
    token: string;
    url: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Whether the "start a meeting?" confirmation is open. Opening the room is
     irreversible and credits time to everybody in it, so the press asks first. */
  const [confirmingJoin, setConfirmingJoin] = useState(false);
  /* The session this browser last left, which is what triggers the summary. */
  const [justLeftSession, setJustLeftSession] = useState<string | null>(null);
  /**
   * Shrunk to the corner.
   *
   * Held here rather than in the session because it is about this PAGE's
   * presentation, not about the meeting: the engine already floats a room
   * whose page publishes no stage, so minimising is simply declining to
   * publish one. Nothing else changes — the call, the recording and the
   * credited session carry on exactly as they do when you navigate away.
   */
  const [minimised, setMinimised] = useState(false);

  const {
    open: openMeeting,
    close: closeMeeting,
    session: shellSession,
  } = useMeetingSession();

  /**
   * **The shell is the authority on whether this task's meeting is open.**
   *
   * `joined` is local state, and returning to this tab from the floating window
   * remounts the panel — so on its own it says "nobody is in a meeting" about a
   * call that is still running in the corner. The page would then publish no
   * stage, offer no Leave, and show the transcript and summary of a meeting
   * that had not finished.
   *
   * Reading the session back covers every way of arriving: pressing Open on the
   * corner window, following a link, a reload, or simply switching tabs.
   */
  const shellTaskSession =
    shellSession?.kind === "task" && shellSession.taskId === taskId
      ? shellSession
      : null;
  const inRoom = joined ?? shellTaskSession;
  const inRoomSessionId = inRoom?.sessionId ?? null;
  const [join, joinState] = useAction((r) => r.joinTaskMeeting(taskId));
  /* `leave`, `end` and `touch` are deliberately NOT here any more. They belong
     to `TaskMeetingLifecycle` in the shell, which is the only place that can
     run them when this page is not mounted — and a second caller would be a
     second owner of one settlement. */
  const [end] = useAction((r, sessionId: string) =>
    r.endTaskMeeting({ taskId, sessionId }),
  );

  /**
   * Which session this page believes is open, for the departure below.
   *
   * The RECORDING of a departure — `beforeunload`, the presence beat, the
   * settlement — moved to `TaskMeetingLifecycle` in the shell when the room
   * did. What is left here is the page's own bookkeeping: which session the
   * Leave button should close.
   */
  const openRef = useRef<string | null>(null);
  useEffect(() => {
    openRef.current = inRoomSessionId;
  }, [inRoomSessionId]);

  /**
   * **The presence beat lives in the shell now — `TaskMeetingLifecycle`.**
   *
   * It had to move with the room. Presence is asserted every twenty seconds and
   * a row that stops beating lapses ninety seconds later, so a beat left on
   * this page would let a meeting still running in the corner quietly stop
   * being credited the moment somebody navigated away.
   */

  /**
   * Leaving and closing are two calls, and the order is the point.
   *
   * **Once per session, whichever way out was taken.** Pressing Leave clears
   * `joined`, which unmounts the room, which fires `onDisconnected` — so the
   * obvious writing of this runs the whole settlement twice for one departure.
   * Ending twice would re-close an already-closed session against a later
   * clock, and any task that went live in between would be credited for a
   * meeting that had finished. The ref is what makes the second call a no-op.
   */
  const departingRef = useRef<string | null>(null);
  const depart = async (sessionId: string) => {
    if (departingRef.current === sessionId) return;
    departingRef.current = sessionId;
    /* **What tells the summary to write itself.** A task meeting has no "End
       for everyone" — it is over when the last person walks away — so nobody
       is left to press Generate. Naming the session that just ended means it
       fires once for this meeting and not once per render. */
    setJustLeftSession(sessionId);

    /**
     * **The room goes at once, and the writes finish behind it.**
     * Reported 17 Aug 2026: "when I click leave two/three times, then it
     * leaves — not straight after the click."
     *
     * `setJoined(null)` used to sit at the END, after both network calls. So
     * pressing Leave disconnected LiveKit but left `<LiveKitRoom>` mounted
     * with its control bar still on screen until two round trips completed —
     * and a person watching a room that had not gone pressed Leave again.
     * Those presses did nothing (the ref above is doing its job), so the
     * meeting appeared to close on the third click when it was really the
     * first call finally returning.
     *
     * Clearing first costs nothing: `sessionId` is a parameter, so neither
     * call depends on the state being cleared, and the settlement below is
     * what credits the time either way.
     */
    setJoined(null);

    /**
     * **The settlement belongs to the shell, and is not raced from here.**
     *
     * `leave` and `end` used to run on this line. They cannot any more: the
     * room lives in the shell, and `TaskMeetingLifecycle` calls both when the
     * session closes — including when this page is not mounted at all, which is
     * the case the floating window creates. Calling them here as well would be
     * two owners of one settlement, closing a session twice against different
     * clocks.
     *
     * Closing the session is therefore the WHOLE departure: it unmounts the
     * room, which fires the lifecycle's cleanup, which records the leave and
     * settles. Nothing is awaited, so the room goes at once — which was the
     * point of clearing first in the original version, only more so.
     */
    closeMeeting();
    setMinimised(false);
    sessions.refetch();
  };

  const meetings = view.task.meetings;
  /**
   * **Only the sessions that were actually meetings.**
   *
   * A session with one person in it is somebody opening the room and closing
   * it — 327 of the 366 stored across the product are exactly that, and 324 of
   * those credited nothing. Listing them put a meeting on the record of tasks
   * where no conversation took place, which is what people reported.
   *
   * Filtered for DISPLAY only. Nothing is deleted: a solo session is a true
   * record of somebody opening the room, and `sessions.data` is still what the
   * live-room logic below reads, so a room with one person waiting in it is
   * still found and joined.
   */
  const list = realMeetingsOnly(sessions.data ?? []);
  /* What each session gave THIS task. `creditedSecs` is the session's own
     figure, credited to whoever attended on THEIR tasks — printing it here
     claimed seven minutes for a task whose deadline had moved by two. */
  const creditedHere = (s: { creditedSecs: number; creditedTaskIds: string[] }) =>
    creditedToTask(s, taskId);

  /* Names for the attendance line. Attendees are usually the assignee and the
     assigner, both of which `view` already carries, but a third person joining
     is ordinary — so the directory is read and the ids are the fallback. */
  const directory = useQuery((r) => r.listEmployees(), []);
  const nameOf = (id: string): string => {
    const known =
      directory.data?.find((e) => String(e.id) === String(id))?.displayName ??
      [view.owner, view.assigner, ...view.assignees, ...view.pendingAssignees]
        .find((p) => p && String(p.id) === String(id))?.displayName;
    /* The id, never "Unknown": a reader who recognises GR0045 is better served
       than one told the system has lost track of somebody. */
    return known ?? id;
  };

  /* ── The meeting that is happening right now ──────────────────────────────
   *
   * Shown whether or not THIS reader is in it: a running room is a fact about
   * the task, and somebody opening the tab to find out whether a conversation
   * is under way should not have to join to see.
   *
   * **An open session and a running meeting are not the same thing.** A session
   * stays open until somebody closes it, and the ordinary way out of a meeting
   * — closing the tab — cannot reliably write anything. So an abandoned room
   * used to read as "Meeting running" indefinitely, its clock ticking up while
   * both people were long gone. Reported exactly that way, with nine
   * attendance rows and nobody in the room.
   *
   * `open` is what the store says; `running` is what is true. The difference is
   * whether anybody is still beating — `roomIsEmpty`, the same question the
   * repository asks before it settles.
   */
  /**
   * **The session THIS reader is in, before any other open one.**
   *
   * Two places choose an open session and they could choose differently: the
   * join takes the first document an unordered Firestore query returns, and
   * this list is sorted newest-first. With more than one session open — a race
   * between two people joining, or one left open by a client that never closed
   * it — a reader's attendance row lands in one session while the panel reads
   * the other. The panel then cannot find them in the room they are standing
   * in: `Counting 00:00:00`, "you are not in the room with somebody else",
   * three faces on the screen. Reported exactly that way.
   *
   * Their own session is the one that describes what they are looking at.
   */
  const open =
    (inRoom && list.find((s) => s.id === inRoom.sessionId)) ??
    list.find((s) => s.endedAt === null) ??
    null;
  /* The COUNTERPARTY, not the owner. On a self task the owner is the assignee,
     and naming them here would tell somebody sitting alone in a room that their
     own presence was earning time — which it is not. `assigner` is the assigner
     of record: the same person on an ordinary task, the manager on a self one. */
  const counterparty = view.assigner ?? view.owner;
  const counterpartyId = counterparty?.id ?? "";
  const counterpartyName =
    counterparty?.displayName ?? "the person who assigned the work";

  /* Cross-department work settles by the shared-window rule: the clock runs
     only while BOTH sides are in the room, and each person earns their own time
     in it. So the figure below is this reader's own, not the meeting's. */
  const crossDept = view.task.isCrossDepartment;
  const receiver = view.assignees[0] ?? view.pendingAssignees[0] ?? null;
  const receiverId = receiver?.id ?? "";
  const receiverName = receiver?.displayName ?? "the person doing the work";

  const refetchSessions = sessions.refetch;

  /**
   * **Live while a session is OPEN, or while this reader is in one.**
   *
   * Open rather than running, deliberately: the clock and the refetch are how
   * the panel notices a room going empty, so gating them on the room still
   * being occupied would freeze the display at the last moment it was.
   *
   * Gated on the session id alone, a reader who pressed Join before their
   * session list had been fetched had no session — so no clock started, no
   * refetch was scheduled, and the panel sat at "not counting" for the whole
   * meeting while the other side counted normally. That is two people watching
   * the same room and seeing different answers, which is what was reported.
   */
  const openId = open?.id ?? null;
  const watching = openId !== null || inRoom !== null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!watching) return;
    /* One second, because this is a duration somebody is watching tick. It
       stops entirely when no meeting is running rather than idling forever. */
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [watching]);

  /**
   * Attendance arrives with the session list, so the live figure is only ever as
   * fresh as the last fetch.
   *
   * **Five seconds, not fifteen.** The figure beside it ticks every second, so a
   * fifteen-second lag on WHO IS IN THE ROOM meant the two sides of a meeting
   * disagreed for a quarter of a minute at a time — one counting, one at zero,
   * both drawn from the same room. The panel is only mounted while somebody is
   * looking at a meeting, so the cost is bounded by the meeting itself.
   */
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => refetchSessions(), 5_000);
    return () => clearInterval(id);
  }, [watching, refetchSessions]);

  const viewerId = useViewerId() ?? "";
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const myName = me.data?.displayName ?? "";
  /**
   * Whoever ASSIGNED the work owns the recording.
   *
   * Somebody has to own starting and stopping, and on a task that is the side
   * the credit clock already depends on: the credited span is the one where
   * the assigner was present, so a recording that follows their control
   * follows the meeting the product believes in.
   */
  const isTaskHost = String(view.task.createdById) === String(viewerId);

  /**
   * The name the recordings are filed under, and the roster to check.
   *
   * `taskMeetingRoomName` rather than `joined?.roomName`: the panel must be
   * able to list a finished meeting's audio when nobody is in the room, and
   * the rule derives the same name from the task id either way — which is
   * exactly why it is derived rather than random.
   *
   * The roster is everybody who has ever been in one of this task's meetings.
   * `RecordingsPanel` uses `joinedAt` to decide who OUGHT to have audio, so
   * somebody who was in the room and has no file is named as missing.
   */
  const taskMeetRoomName = taskMeetingRoomName(taskId);
  const recordedParticipants = Array.from(
    new Map(
      list
        .flatMap((session) => session.attendance ?? [])
        .map((a) => [
          String(a.employeeId),
          {
            id: `${taskId}-${a.employeeId}`,
            meetingId: taskMeetRoomName,
            employeeId: String(a.employeeId),
            role: "participant" as const,
            attendanceStatus: "joined" as const,
            joinedAt: a.joinedAt,
            leftAt: a.leftAt ?? null,
          },
        ]),
    ).values(),
  );

  const openAttendance = (open?.attendance ?? []).map((a) => ({
    employeeId: a.employeeId,
    joinedAtMs: Date.parse(a.joinedAt),
    leftAtMs: a.leftAt ? Date.parse(a.leftAt) : null,
    lastSeenAtMs: a.lastSeenAt ? Date.parse(a.lastSeenAt) : null,
  }));

  /**
   * The session that is actually happening — open AND somebody still in it.
   *
   * Everything below reads this rather than `open`, so a room everybody has
   * left stops claiming to be a meeting the moment its last row lapses, rather
   * than whenever somebody's departure write happens to land.
   */
  const running = open && !roomIsEmpty(openAttendance, now) ? open : null;

  const liveSession = running
    ? {
        counterpartyId,
        startedAtMs: Date.parse(running.startedAt),
        endedAtMs: now,
        attendance: openAttendance,
      }
    : null;

  /**
   * **An abandoned room is closed by whoever notices, not left open.**
   *
   * Hiding it would be enough to stop the false "Meeting running", and would
   * leave the session open in the store for ever — uncredited, and blocking
   * the next join from starting a fresh one, because a join re-enters any
   * session still marked open. So the panel settles it.
   *
   * Safe to run from any reader: `endTaskMeeting` re-checks the room itself and
   * returns without closing if anybody is still inside, and it is idempotent —
   * a session already credited to a task is never credited to it twice. Two
   * people noticing at once therefore settle it once.
   *
   * The ref makes it once per session per mount, so a failed call is not
   * retried every second by the clock above.
   */
  const settledRef = useRef<string | null>(null);
  const abandonedId = open && !running ? open.id : null;
  useEffect(() => {
    if (!abandonedId || settledRef.current === abandonedId) return;
    settledRef.current = abandonedId;
    void end(abandonedId).then(() => refetchSessions());
  }, [abandonedId, end, refetchSessions]);

  /**
   * The three figures, **read from the sessions rather than from the task.**
   *
   * The task carries a denormalised copy — `meetingFirstStartedAt`,
   * `meetingLastEndedAt`, `meetingTotalSecs` — written by the settlement. It is
   * a cache of what the session log already says, and one fact with two sources
   * eventually disagrees: reported as a panel showing `Total 00:00:00` and
   * `First start —` directly above two finished sessions worth 00:01:07 and
   * 00:04:32. Whatever went wrong with that write, the reader was looking at
   * the answer and being told there wasn't one.
   *
   * The sessions are the record. They are already loaded to draw the list
   * below, so this costs nothing, and it cannot fall out of step with the rows
   * it sits above. The stored copy still exists for everything that has no
   * session list to hand — a task card, a queue projection — which is why it is
   * kept as the fallback while the list is loading.
   *
   * `creditedSecs` and not wall clock, deliberately: the column beneath is
   * headed "Time counted for your deadline", and a total that summed something
   * else would not be the sum of the column.
   */
  const settled = list.filter((s) => s.endedAt !== null);
  const summary =
    settled.length > 0
      ? {
          firstStartedAt: settled.reduce(
            (earliest, s) =>
              !earliest || s.startedAt < earliest ? s.startedAt : earliest,
            "",
          ),
          lastEndedAt: settled.reduce<string | null>(
            (latest, s) =>
              !latest || (s.endedAt ?? "") > latest ? s.endedAt : latest,
            null,
          ),
          /* **What THIS task gained**, which is what the column beneath now
             shows. Summing `creditedSecs` reported 00:07:05 on a task whose
             budget had grown by 00:01:57 — the other two sessions were
             credited to their attendees' own tasks. The comment above already
             required the total to be the sum of the column; this makes it
             true. */
          totalSecs: settled.reduce((n, s) => n + creditedHere(s), 0),
        }
      : meetings;

  const live = !liveSession
    ? null
    : crossDept
      ? liveCrossDeptFigures({ ...liveSession, receiverId }, viewerId, now)
      : liveMeetingFigures({ ...liveSession, receiverId }, now);

  /* Why the clock is or is not running, in the terms of whichever rule applies.
     One sentence rather than a shared vague one: "nothing is being added" with
     no reason is the message that sent people to argue with a correct system. */
  /* **One sentence for both rules** — OWNER DECISION, 17 Aug 2026, when
     cross-department stopped counting any two people and started requiring the
     two sides like every other task. The cross-department wording said "you
     are in the room with somebody else", which is now false: Rishee and Rakesh
     in the room without Umung count for nothing. */
  const liveNote = !live
    ? ""
    : live.counting
      ? `${counterpartyName} and ${receiverName} are both in the room, so this is being added to your deadlines.`
      : `Nothing is being added — it counts only while ${counterpartyName} and ${receiverName} are both in the room.`;

  return (
    <Panel label="Meetings">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink">
            Meeting about this task
          </p>
          <p className="mt-1 max-w-[62ch] text-[11px] leading-relaxed text-ink-faint">
            Every task has its own room — there is nothing to schedule. Time
            spent here is added to your deadline, and to every other task you
            have on the go.{" "}
            {/* Everybody in the room is credited on any task, so the sentence
                that used to name only the receiver's deadline now says so.
                What still differs between the two rules is the window — who has
                to be present for the clock to run at all. */}
            {`The clock runs only while ${counterpartyName} and ${receiverName} are both in the room — neither side earns time alone.`}{" "}
            Everyone in the room is credited their own time in it, on their own
            tasks.
          </p>
        </div>

        {inRoom ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink-muted">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--state-positive)" }}
              />
              In the room
            </span>
            <Button
              size="sm"
              tone="ghost"
              onClick={() => void depart(inRoom.sessionId)}
            >
              Leave
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            disabled={joinState.isPending}
            /**
             * **Asked first, because opening the room IS the meeting.**
             *
             * There is no scheduling step: the press starts a session, stamps
             * attendance and begins crediting time to everybody's deadlines —
             * and nothing undoes it. Somebody pressing this to see what it does
             * has held a meeting, and the record cannot be withdrawn.
             *
             * A task carrying a meeting nobody meant to hold is what this
             * prevents. One press against an irreversible, shared consequence
             * is exactly where a confirmation earns its place.
             */
            onClick={() => {
              setError(null);
              setConfirmingJoin(true);
            }}
          >
            {joinState.isPending ? "…" : "Join meeting"}
          </Button>
        )}
      </div>

      {confirmingJoin && (
        <div className="mt-3 rounded-inset border border-hairline bg-[var(--surface-sunken)] p-4">
          <p className="text-sm text-ink">Start a meeting on this task?</p>
          <p className="mt-1 max-w-[62ch] text-[12px] text-ink-faint">
            There is nothing to schedule — opening the room starts it. The clock
            begins at once, everyone who joins is recorded, and the time is
            credited to their deadlines. A meeting cannot be withdrawn
            afterwards.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={joinState.isPending}
              onClick={async () => {
                setConfirmingJoin(false);
                const r = await join();
                if (!r.ok) {
                  setError(r.message);
                  return;
                }
                /* A rejoin after a settled departure is a fresh arrival, so the
                   once-only guard is released rather than carried over. */
                departingRef.current = null;
                setJoined(r.data);
                /* **Handed to the shell, which is what makes it survive
                   navigation.** The room is drawn over the stage below while
                   this page is open, and floats in the corner once it is not.
                   The presence beat goes with it — see `TaskMeetingLifecycle`. */
                openMeeting({
                  kind: "task",
                  taskId,
                  taskTitle: view.task.title,
                  sessionId: r.data.sessionId,
                  roomName: r.data.roomName,
                  token: r.data.token,
                  url: r.data.url,
                  employeeId: viewerId,
                  displayName: myName,
                  isHost: isTaskHost,
                  /* Connecting is when the other side becomes visible to this
                     one — re-read rather than wait out the poll. */
                  onConnected: () => refetchSessions(),
                  onLeave: () => {
                    const id = openRef.current;
                    if (id) void depart(id);
                  },
                });
                /* **Immediately, not on the next tick.** The snapshot this
                   panel holds was taken before this join — it contains neither
                   this reader's own attendance row nor anybody already inside,
                   so without this the figure reads zero and the reason line
                   blames the other person for not being in a room they are
                   standing in. */
                sessions.refetch();
              }}
            >
              {joinState.isPending ? "…" : "Yes, start the meeting"}
            </Button>
            <Button
              tone="secondary"
              onClick={() => setConfirmingJoin(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3">
          <InlineError compact message={error} />
        </div>
      )}

      {/* ── The running meeting ──────────────────────────────────────────────
          Two figures, because they answer different questions and the gap
          between them IS the anti-cheat: how long people have been talking,
          and how much of that is moving the deadline. A single number would
          have to pick one, and either choice misleads — the wall clock
          promises credit that an absent creator is not earning, and the credit
          alone denies a conversation that is plainly happening. */}
      {live && (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-inset bg-[var(--control)] px-3 py-2.5"
          aria-live="off"
        >
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: live.counting
                  ? "var(--state-positive)"
                  : "var(--state-overdue)",
              }}
            />
            <span className="text-[11px] text-ink-faint">Meeting running</span>
            <span data-figure className="text-[13px] text-ink tabular-nums">
              {formatTimer(live.elapsedSecs)}
            </span>
          </span>

          <span className="inline-flex items-center gap-2">
            <span className="text-[11px] text-ink-faint">Counting</span>
            <span
              data-figure
              className="text-[13px] tabular-nums"
              style={{
                color: live.counting
                  ? "var(--state-positive-ink)"
                  : "var(--ink-muted)",
              }}
            >
              {formatTimer(live.creditedSecs)}
            </span>
          </span>

          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-faint">
            {liveNote}
          </span>
        </div>
      )}

      {/* The room itself. Mounted only while joined: `LiveKitRoom` opens a
          websocket and asks for the camera the moment it renders, and doing
          that to somebody reading the session list would be a meeting they
          never agreed to be in. */}
      {/**
       * **The room is not rendered here any more — only its place is.**
       *
       * `MeetingEngine` mounts it once in the shell and draws it over this
       * rectangle, which is what lets Back, a notification or any link keep the
       * meeting alive: the page stops publishing a place to draw and the
       * meeting moves to the corner, instead of being unmounted mid-call with
       * the recording unfinalised and the credited session left open.
       *
       * **Minimised means: publish no stage.** There is no second mechanism for
       * it — the engine already floats a meeting whose page is not showing one,
       * so not rendering the stage IS minimising, and rendering it again is
       * restoring. One rule, and the corner window behaves identically whether
       * you minimised it or walked away from the page.
       */}
      {inRoom && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setMinimised((v) => !v)}
              title={minimised ? "Bring the meeting back" : "Minimise to the corner"}
              aria-label={
                minimised
                  ? "Bring the meeting back into the page"
                  : "Minimise the meeting to the corner"
              }
              aria-pressed={minimised}
              className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
            >
              {minimised ? (
                <Icon.expand className="h-3.5 w-3.5" />
              ) : (
                <Icon.collapse className="h-3.5 w-3.5" />
              )}
              {minimised ? "Maximise" : "Minimise"}
            </button>
          </div>

          {minimised ? (
            <p className="rounded-card border border-hairline px-4 py-6 text-center text-sm text-ink-muted">
              The meeting is running in the corner. Press Maximise to bring it
              back here.
            </p>
          ) : (
            <MeetingStage className="min-h-[22rem] w-full rounded-card sm:min-h-[26rem] deck:min-h-[420px]" />
          )}
        </div>
      )}

      {/**
       * **Whose audio was saved, on the task it was saved about.**
       *
       * A task meeting records like any other now, so it needs the same way of
       * checking that everybody's voice actually arrived — the panel names who
       * is missing rather than leaving a silent gap to be discovered later.
       *
       * Everybody sees it, not only whoever assigned the work: the person most
       * able to act on their own missing recording is the person it belongs to,
       * and the recovery — unsent clips kept in their browser — happens in
       * THEIR browser.
       *
       * Shown only once a meeting has actually been held: an empty recordings
       * panel on a task nobody has met about is a question nobody asked.
       */}
      {list.length > 0 && (
        <div className="mt-4">
          <RecordingsPanel
            meetingId={taskMeetRoomName}
            participants={recordedParticipants}
            nameFor={nameOf}
          />
        </div>
      )}

      {/**
       * **The record of a task meeting, on the task.**
       *
       * The same two panels the scheduled meeting has, on the same audio and
       * through the same routes — those look the recording up by `meetId` in
       * `meeting_audio_recordings`, and a task room's rows are filed under its
       * own derived name, so nothing about them needed changing.
       *
       * The transcript is first and the summary second, for the reason the
       * scheduled page gives: what was actually said is the record, and the
       * summary is a reading of it. Putting the reading above the record invites
       * the reading to be taken for the record.
       *
       * `meetStatus="completed"` because a task meeting is over the moment the
       * room empties — there is no lifecycle to consult, and while somebody is
       * still in the room `joined` is set and these are not shown at all.
       */}
      {list.length > 0 && !inRoom && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="border-t border-hairline pt-4">
            <p className="text-[15px] font-medium text-ink">Transcript</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              Verbatim or translated — never the summary&rsquo;s silent paraphrase
            </p>
            <VerbatimTranscriptPanel
              meetId={taskMeetRoomName}
              meetStatus="completed"
            />
          </div>

          <div className="border-t border-hairline pt-4">
            <p className="text-[15px] font-medium text-ink">AI summary</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              Written from the meeting&rsquo;s audio when the last person leaves
            </p>
            <MeetingSummaryPanel
              meetId={taskMeetRoomName}
              meetStatus="completed"
              autoGenerateAfter={justLeftSession}
            />
          </div>
        </div>
      )}

      {/* The three figures. Shown even at zero: "no meetings yet" is an answer,
          and an absent row reads as a panel that failed to load. */}
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3">
        <Figure
          label="First start"
          value={
            summary.firstStartedAt ? formatDateTime(summary.firstStartedAt) : "—"
          }
        />
        <Figure
          label="Last end"
          value={summary.lastEndedAt ? formatDateTime(summary.lastEndedAt) : "—"}
        />
        <Figure label="Total" value={formatTimer(summary.totalSecs)} />
      </dl>

      <div className="mt-4 border-t border-hairline pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            Sessions
          </p>
          {/* Naming the column, because "00:02:54" beside "3 people" reads as
              the length of the meeting and is not — it is the part of it that
              the creator was present for. */}
          <p className="text-[10.5px] text-ink-faint">
            Time counted for your deadline
          </p>
        </div>
        {sessions.isLoading ? (
          <div className="mt-2">
            <SkeletonRows rows={2} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            compact
            title="No meetings yet"
            body="Press Join meeting to open this task's room. Nobody needs to schedule anything."
          />
        ) : (
          <ul className="mt-1 divide-y divide-hairline">
            {list.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted">
                  <Icon.meeting className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                  {formatDateTime(s.startedAt)}
                  {/* `running`, not "still open". A row here said "running"
                      for any session without an `endedAt`, which is how an
                      abandoned room announced itself as a live meeting in the
                      one place a reader goes to check the history. It is the
                      running session only if somebody is actually in it. */}
                  {running?.id === s.id && (
                    <span className="ml-2 text-[11px] text-ink-faint">running</span>
                  )}
                  {s.endedAt === null && running?.id !== s.id && (
                    <span className="ml-2 text-[11px] text-ink-faint">
                      closing
                    </span>
                  )}
                </span>
                {/* Said in words, not only as a tooltip. A zero next to "3
                    people" is the one figure on this panel somebody will argue
                    about, and a hover they never perform cannot answer them. */}
                {s.endedAt !== null && creditedHere(s) === 0 && (
                  <span className="shrink-0 text-[10.5px] text-ink-faint">
                    {s.creditedSecs > 0
                      ? /* It counted — for the people in it, on THEIR tasks.
                           Saying "both sides were not in the room" of a
                           session two people plainly attended reads as a
                           fault; what is true is that it did not reach THIS
                           task. */
                        "Counted on the attendees’ own tasks, not this one"
                      : "Both sides were not in the room together"}
                  </span>
                )}
                {/* **Who was in the room, by name.**
                    Counted DISTINCT: `attendance` gains a row every time
                    somebody arrives, so two people rejoining five times each
                    read as "10 people" — the one figure on this panel somebody
                    will argue about. The same person is one person. */}
                <span
                  className="min-w-0 shrink text-right text-[11px] text-ink-faint"
                  title={distinctAttendees(s).map(nameOf).join(", ")}
                >
                  <span className="truncate">
                    {distinctAttendees(s).map(nameOf).join(", ")}
                  </span>
                  <span className="ml-1.5 whitespace-nowrap opacity-70">
                    ({attendeeCount(s)})
                  </span>
                </span>
                <span
                  data-figure
                  className="w-[72px] shrink-0 text-right text-[12px] tabular-nums"
                  style={{
                    color:
                      creditedHere(s) === 0 ? "var(--ink-faint)" : "var(--ink)",
                  }}
                  title={
                    creditedHere(s) > 0
                      ? "Credited to this task's deadline."
                      : s.creditedSecs > 0
                        ? "This session was credited to the people who attended it, on their own tasks. Nothing reached this one."
                        : "Nothing was credited — the two sides of this work were not in the room at the same time."
                  }
                >
                  {formatTimer(creditedHere(s))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}


function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd data-figure className="mt-0.5 text-[13px] text-ink tabular-nums">
        {value}
      </dd>
    </div>
  );
}
