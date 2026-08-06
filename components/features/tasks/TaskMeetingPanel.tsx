"use client";

import { useEffect, useRef, useState } from "react";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  EmptyState,
  InlineError,
  Panel,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import {
  liveCrossDeptFigures,
  liveMeetingFigures,
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
 * That the clock only runs while the person who ASSIGNED the work is in the
 * room. Without that sentence, an assignee who joins alone and waits will
 * reasonably expect the time to count, and will be wrong. It is said on the
 * panel rather than left for them to discover from a total that did not move.
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

  const [join, joinState] = useAction((r) => r.joinTaskMeeting(taskId));
  const [leave] = useAction((r, sessionId: string) =>
    r.leaveTaskMeeting({ taskId, sessionId }),
  );
  const [end] = useAction((r, sessionId: string) =>
    r.endTaskMeeting({ taskId, sessionId }),
  );

  /**
   * **Leaving is recorded even when nobody presses Leave.**
   *
   * Attendance decides the credit, so a departure that is never written leaves
   * somebody apparently in the room indefinitely. A closed tab and a navigation
   * away are the two ordinary ways out that no button sees, so both are caught.
   * `beforeunload` cannot await, which is why the ref holds the id — the call is
   * fired and the page may die mid-flight, and the session's own close bounds
   * the span either way.
   */
  const openRef = useRef<string | null>(null);
  useEffect(() => {
    openRef.current = joined?.sessionId ?? null;
  }, [joined]);

  useEffect(() => {
    const bail = () => {
      const id = openRef.current;
      if (id) void leave(id);
    };
    window.addEventListener("beforeunload", bail);
    return () => {
      window.removeEventListener("beforeunload", bail);
      bail();
    };
  }, [leave]);

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

    await leave(sessionId);
    /* Closing is what CREDITS it. Leaving alone would keep the session open for
       whoever is still inside — which is correct when somebody else remains,
       and is why the two are separate calls rather than one. */
    const r = await end(sessionId);
    if (!r.ok) setError(r.message);
    setJoined(null);
    sessions.refetch();
  };

  const meetings = view.task.meetings;
  const list = sessions.data ?? [];

  /* ── The meeting that is happening right now ──────────────────────────────
   *
   * Shown whether or not THIS reader is in it: a running room is a fact about
   * the task, and somebody opening the tab to find out whether a conversation
   * is under way should not have to join to see.
   */
  const running = list.find((s) => s.endedAt === null) ?? null;
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

  /* The id rather than the session: the object is rebuilt by every refetch, so
     depending on it would tear down and restart both intervals on a timer that
     one of them drives. */
  const runningId = running?.id ?? null;
  const refetchSessions = sessions.refetch;

  /**
   * **Live while a meeting is running OR while this reader is in one.**
   *
   * Gated on `runningId` alone, a reader who pressed Join before their session
   * list had been fetched had `running === null` — so no clock started, no
   * refetch was scheduled, and the panel sat at "not counting" for the whole
   * meeting while the other side counted normally. That is two people watching
   * the same room and seeing different answers, which is what was reported.
   */
  const watching = runningId !== null || joined !== null;

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
  const liveSession = running
    ? {
        counterpartyId,
        startedAtMs: Date.parse(running.startedAt),
        endedAtMs: now,
        attendance: running.attendance.map((a) => ({
          employeeId: a.employeeId,
          joinedAtMs: Date.parse(a.joinedAt),
          leftAtMs: a.leftAt ? Date.parse(a.leftAt) : null,
        })),
      }
    : null;

  const live = !liveSession
    ? null
    : crossDept
      ? liveCrossDeptFigures({ ...liveSession, receiverId }, viewerId, now)
      : liveMeetingFigures(liveSession, now);

  /* Why the clock is or is not running, in the terms of whichever rule applies.
     One sentence rather than a shared vague one: "nothing is being added" with
     no reason is the message that sent people to argue with a correct system. */
  const liveNote = !live
    ? ""
    : crossDept
      ? live.counting
        ? `${counterpartyName} and ${receiverName} are both in the room, so this is being added to your deadlines.`
        : `Nothing is being added to yours — it counts only while ${counterpartyName} and ${receiverName} are both in the room, and you are too.`
      : live.counting
        ? `${counterpartyName} is in the room, so this is being added to your deadlines.`
        : `Nothing is being added — ${counterpartyName} is not in the room. Time only counts while they are.`;

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
            {crossDept
              ? `This work came from another department, so the clock runs only while ${counterpartyName} and ${receiverName} are both in the room — and each person in it is credited their own time, on their own tasks.`
              : `The clock runs only while ${counterpartyName} is in the room.`}
          </p>
        </div>

        {joined ? (
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
              onClick={() => void depart(joined.sessionId)}
            >
              Leave
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            disabled={joinState.isPending}
            onClick={async () => {
              setError(null);
              const r = await join();
              if (!r.ok) {
                setError(r.message);
                return;
              }
              /* A rejoin after a settled departure is a fresh arrival, so the
                 once-only guard is released rather than carried over. */
              departingRef.current = null;
              setJoined(r.data);
              /* **Immediately, not on the next tick.** The snapshot this panel
                 is holding was taken before this join — it contains neither
                 this reader's own attendance row nor anybody already inside, so
                 without this the figure reads zero and the reason line blames
                 the other person for not being in a room they are standing in. */
              sessions.refetch();
            }}
          >
            {joinState.isPending ? "…" : "Join meeting"}
          </Button>
        )}
      </div>

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
      {joined && (
        <section
          aria-label="Meeting room"
          data-on-slab
          className="slab slab-flat mt-4 flex h-[420px] flex-col overflow-hidden rounded-card"
        >
          <LiveKitRoom
            token={joined.token}
            serverUrl={joined.url}
            connect
            video
            audio
            data-lk-theme="default"
            className="flex min-h-0 flex-1 flex-col"
            /* The room being up is the moment the other side becomes visible to
               this one — read the attendance again rather than waiting out the
               poll. */
            onConnected={() => refetchSessions()}
            /* The control bar's own leave button disconnects rather than
               calling anything here, so the close is hung off the
               disconnection — otherwise hanging up would leave the session
               open and the meeting would never be credited. */
            onDisconnected={() => {
              const id = openRef.current;
              if (id) void depart(id);
            }}
            onError={(e) => setError(e.message)}
          >
            <Stage />
            <div className="shrink-0 border-t border-white/10">
              <ControlBar variation="verbose" />
            </div>
            <RoomAudioRenderer />
          </LiveKitRoom>
        </section>
      )}

      {/* The three figures. Shown even at zero: "no meetings yet" is an answer,
          and an absent row reads as a panel that failed to load. */}
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3">
        <Figure
          label="First start"
          value={
            meetings.firstStartedAt ? formatDateTime(meetings.firstStartedAt) : "—"
          }
        />
        <Figure
          label="Last end"
          value={meetings.lastEndedAt ? formatDateTime(meetings.lastEndedAt) : "—"}
        />
        <Figure label="Total" value={formatTimer(meetings.totalSecs)} />
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
                  {s.endedAt === null && (
                    <span className="ml-2 text-[11px] text-ink-faint">running</span>
                  )}
                </span>
                {/* Said in words, not only as a tooltip. A zero next to "3
                    people" is the one figure on this panel somebody will argue
                    about, and a hover they never perform cannot answer them. */}
                {s.endedAt !== null && s.creditedSecs === 0 && (
                  <span className="shrink-0 text-[10.5px] text-ink-faint">
                    {counterpartyName.split(" ")[0]} was not in the room
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {s.attendance.length === 1
                    ? "1 person"
                    : `${s.attendance.length} people`}
                </span>
                <span
                  data-figure
                  className="w-[72px] shrink-0 text-right text-[12px] tabular-nums"
                  style={{
                    color: s.creditedSecs === 0 ? "var(--ink-faint)" : "var(--ink)",
                  }}
                  title={
                    s.creditedSecs === 0
                      ? "Nothing was credited — the person who assigned the work was not in the room."
                      : "Credited to your deadlines."
                  }
                >
                  {formatTimer(s.creditedSecs)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/**
 * The participant grid.
 *
 * Camera and screen-share tracks in one grid, so a shared screen takes the
 * space it needs instead of sitting in a thumbnail beside the faces — which is
 * what a task meeting is usually for: showing the thing being discussed.
 */
function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="min-h-0 flex-1 p-2">
      <GridLayout tracks={tracks} className="h-full">
        <ParticipantTile />
      </GridLayout>
    </div>
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
