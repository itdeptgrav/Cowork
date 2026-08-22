"use client";

import Link from "next/link";
import { formatRankDisplay, rankFor, rankTitle } from "@/lib/rules/tasks/priorityDisplay";
import { isBudgetSettled } from "@/lib/rules/tasks/activeQueue";
import { isProjectContainer } from "@/lib/rules/tasks/completion";
import {
  deadlineOrigin,
  formatWindow,
} from "@/lib/rules/tasks/deadlineOrigin";
import { useEffect, useRef, useState } from "react";
import { TimerControl } from "./TimerControl";
import { statusMeta, nextAction } from "./statusMeta";
import { meetingFirstHint } from "@/lib/rules/meetings/meetingFirst";
import { ProjectPanel } from "./ProjectPanel";
import { ResponsibilityPanel } from "./ResponsibilityPanel";
import { OutputsPanel } from "./OutputsPanel";
import { RelatedMeetings } from "@/components/features/meetings/RelatedMeetings";
import { TaskMeetingPanel } from "./TaskMeetingPanel";
import { GoalRoadmapPanel } from "./GoalRoadmapPanel";
import { ApprovalActionCard } from "./ApprovalActionCard";
import { budgetTurn } from "@/lib/rules/tasks/budgetNegotiation";
import { BudgetNegotiationCard } from "./BudgetNegotiationCard";
import { BudgetConfirmationCard } from "./BudgetConfirmationCard";
import { AssignmentConfirmationCard } from "./AssignmentConfirmationCard";
import { getAssignmentActions } from "@/lib/rules/tasks/assignmentAcceptance";
import { ExtensionDecisionCard } from "./ExtensionDecisionCard";
import { DeadlineRevisionCard } from "./DeadlineRevisionCard";
import { ExtensionTimeline } from "./ExtensionTimeline";
import { CounterDeadlineCard } from "./CounterDeadlineCard";
import { ReworkPanel } from "./ReworkPanel";
import { TaskFilesPanel } from "./TaskFilesPanel";
import { FeasibilityPreview } from "./FeasibilityPreview";
/* `ExpectedCompletion` is no longer rendered here — the facts panel names the
   deadline itself now, see the Deadline fact below. The component is kept and
   still tested: it is a correct queue projection carrying the feasibility
   warning, and deleting it would take a working calculation with it. */
import { BudgetHistory } from "./BudgetHistory";
import { TaskFlowSection } from "./TaskFlowSection";
import { RelationshipNote } from "./RelationshipNote";
import { PriorityDialog } from "./PriorityDialog";
import { DeadlinePanel } from "./DeadlinePanel";
import { ReportsPanel } from "./ReportsPanel";
import { SubmissionPanel } from "./SubmissionPanel";
import { ReviewPanel } from "./ReviewPanel";
import { HistoryPanel } from "./HistoryPanel";
import { ChatPanel } from "./ChatPanel";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Breadcrumb,
  IconTabs,
  MenuDivider,
  MenuItem,
  Popover,
  ToolButton,
} from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  ErrorState,
  Field,
  InlineError,
  Meter,
  Panel,
  ProvisionalBadge,
  Select,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { tabBadges } from "@/lib/rules/tasks/tabBadges";
import { reorderableAssignees } from "@/lib/rules/tasks/priorityAffordance";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { useMyDutyMode } from "@/lib/hooks/useDutyMode";
import { presenceRefusal } from "@/lib/rules/presence/taskGate";
import {
  formatDate,
  formatDateTime,
  formatTimer,
  formatDurationTimer,
} from "@/lib/utils/format";
import { REWORK_DEDUCTION } from "@/lib/rules/scoring/engine";

/**
 * Task detail.
 *
 * A split view, not a stack of cards: the left column carries whatever the task
 * needs now, the right rail carries the facts that stay constant — people,
 * priority, deadline, effort, project, score impact. The next required action
 * is the first thing in the left column, above the fold, always.
 */

type Tab =
  | "overview"
  | "deadline"
  | "reports"
  | "submission"
  | "review"
  | "history"
  | "chat"
  | "files"
  | "meetings"
  /* C2 · the steps a goal task is delivered through. Offered only on a goal,
     so no other kind of task grows a tab it has nothing to put in. */
  | "roadmap";

export function TaskDetail({
  taskId,
  tab = "overview",
}: {
  taskId: string;
  tab?: Tab;
}) {
  const me = useViewerId();
  const { data, isLoading, error, isUnavailable, refetch } = useQuery(
    (r) => r.getTask(taskId),
    [taskId],
  );
  const subtasks = useQuery((r) => r.getSubtasks(taskId), [taskId]);
  const repo = useRepo();
  /**
   * What is new on each tab, and when this viewer last looked.
   *
   * **Above the early returns, with the other hooks.** Placing it below them
   * makes it a conditional hook call: the loading and error paths return
   * first, so React sees a different number of hooks between renders and
   * throws the moment a task fails to load.
   *
   * One read, not two — a message arriving between separate requests would
   * count as unread against a mark written after it, so the badge would never
   * clear.
   */
  const tabActivity = useQuery((r) => r.readTaskTabActivity(taskId), [taskId]);

  /* Opening a tab reads it. Written on the SERVER so the badge clears on every
     device this person signs in on, and keyed on task+tab so a re-render does
     not re-write it. A failure is swallowed: an unmarked tab shows its badge
     again, which is a smaller fault than an error over a page that loaded. */
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${taskId}:${tab}`;
    if (markedRef.current === key) return;
    markedRef.current = key;
    void repo.markTaskTabSeen(taskId, tab).catch(() => {});
  }, [repo, taskId, tab]);
  const [priorityOpen, setPriorityOpen] = useState(false);
  /* Whether there is anybody's priority this viewer may change on this task.
     Priority is now set by whoever manages you, so for most people on most
     tasks the answer is nobody — and a control that is always refused is worse
     than no control. Same predicate the repository refuses with. */
  const prioPerms = usePermissions();
  const prioViewer = useQuery((r) => r.getViewer(), []);
  const mayChangePriority =
    reorderableAssignees({
      assignees: data?.assignees ?? [],
      actorId: prioViewer.data?.employeeId ?? "",
      actorHasManager: prioViewer.data?.hasManager ?? true,
      canReorder: (id) => prioPerms.can("task.priority.change", id),
    }).length > 0;

  if (isLoading) return <SkeletonRows rows={10} />;
  /* A failed read is NOT a missing task.
     `unavailable` means the repository has no path to this yet; `error` means
     the request went wrong. Either one rendered as "it may have been deleted"
     would tell somebody their work is gone when it is sitting in the database,
     so each says what actually happened and offers a retry. The message is
     also logged, because the on-screen copy is deliberately short and the
     underlying failure is what a developer needs. */
  if (error) {
    console.error(`[TaskDetail] ${taskId} could not be read:`, error);
    return (
      <Panel>
        <ErrorState
          title={isUnavailable ? "Not available yet" : "Could not open this task"}
          body={error}
          onRetry={isUnavailable ? undefined : refetch}
        />
      </Panel>
    );
  }
  /* Only now, with the request completed and no error, does absent mean
     absent. */
  if (!data)
    return (
      <Panel>
        <ErrorState title="Task not found" body="It may have been deleted." />
      </Panel>
    );

  const v = data;
  const meta = statusMeta(v);
  const action = nextAction(v, me ?? "");

  /* Broken down, so the work — and with it the timer, the budget and the
     deadline — lives on the children. Decided once here and passed down, so
     the tab bar and the panels cannot reach different answers. */
  const isContainer = isProjectContainer({
    isProject: v.completion.isProject,
    loadedSubtasks: (subtasks.data ?? []).length,
  });

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      href: `/tasks/${taskId}`,
      icon: "overview" as const,
    },
    /**
     * **A project keeps its deadline, its submission and its review.**
     * OWNER DECISION, 16 Aug 2026.
     *
     * All three were dropped on a container, on the reasoning that nobody works
     * a project so there is nothing to hand in and no date that binds anybody.
     * The owner's model is the opposite and is coherent: a parent is real work
     * that was DIVIDED, not an empty folder. It keeps the deadline it was
     * given — and that deadline is the cap every subtask sits under, so it has
     * to be visible and negotiable. Its submission and review are how the whole
     * divided job is handed over and signed off once the parts are done.
     *
     * **Reports is the exception and stays dropped.** A daily report is written
     * against time a timer measured, and a project has no timer — its days are
     * reported on the subtasks where the work actually happened.
     */
    {
      id: "deadline",
      label: "Deadline",
      href: `/tasks/${taskId}/deadline`,
      icon: "clock" as const,
    },
    /* Between the deadline and the submission because that is where it falls in
       the work: the time is settled, then the days are reported as they pass,
       then the work is handed in. */
    ...(isContainer
      ? []
      : [
          {
            id: "reports",
            label: "Reports",
            href: `/tasks/${taskId}/reports`,
            icon: "timeline" as const,
          },
        ]),
    {
      id: "submission",
      label: "Submission",
      href: `/tasks/${taskId}/submission`,
      icon: "send" as const,
    },
    {
      id: "review",
      label: "Review",
      href: `/tasks/${taskId}/review`,
      icon: "approvals" as const,
    },
    {
      id: "chat",
      label: "Chat",
      href: `/tasks/${taskId}/chat`,
      icon: "chat" as const,
      count: v.chatCount,
    },
    /* Files is offered on a project too, unlike the four above. A project's own
       reference material — the brief everybody works from — hangs off THIS
       document, and its chat is where it is discussed, so there is something
       real here even when nobody works the task itself. */
    /* Offered on a project too, like Files: a project IS discussed even though
       nobody works it, and its subtasks each have rooms of their own. */
    {
      id: "meetings",
      label: "Meetings",
      href: `/tasks/${taskId}/meetings`,
      icon: "meeting" as const,
    },
    /* C2 · only on a goal task. Every other kind has no pool to share out, so
       the tab would open on an explanation of why it is empty. */
    ...(v.task.type === "goal"
      ? [
          {
            id: "roadmap",
            label: "Roadmap",
            href: `/tasks/${taskId}/roadmap`,
            icon: "score" as const,
          },
        ]
      : []),
    {
      id: "files",
      label: "Files",
      href: `/tasks/${taskId}/files`,
      icon: "folder" as const,
    },
    {
      id: "history",
      label: "History",
      href: `/tasks/${taskId}/history`,
      icon: "history" as const,
    },
  ];

  /**
   * **What is new on each tab since this person last looked.**
   * OWNER DECISION, 17 Aug 2026.
   *
   * A message arrived, work was submitted, a reviewer sent it back — and the
   * only way to find out was to open every tab and read it. The tab bar had a
   * `count` slot the whole time; the legacy mapper hardcoded it to `0`, so the
   * affordance existed and had never shown anything.
   *
   * Keyed by tab id end to end, so a tab added later gets a badge from the
   * engine reporting activity for it and nothing here changes.
   */
  const badges = tabBadges({
    activity: tabActivity.data?.activity,
    seen: tabActivity.data?.seen,
    viewerId: me,
  });
  const badgedTabs = tabs.map((t) => {
    /* Never on the tab you are looking at: it is being read right now, and a
       badge there would sit under your eyes until you navigated away. */
    if (t.id === tab) return t;
    const b = badges[t.id];
    if (!b) return t;
    return { ...t, count: b.count > 0 ? b.count : undefined, dot: b.dot };
  });

  return (
    <>
      <div className="mb-4">
        <Breadcrumb
          items={[
            { label: "Tasks", href: "/tasks?view=tasks" },
            ...(v.project
              ? [
                  {
                    label: v.project.name,
                    href: `/tasks/projects/${v.project.id}`,
                  },
                ]
              : []),
            { label: v.task.reference },
          ]}
        />

        <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
              {v.task.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Chip tone={meta.tone}>{meta.label}</Chip>
              {/* Priority is only meaningful once the time budget is decided —
                  a task still in budget negotiation (or waiting on a manager to
                  set the hours) holds no real queue position, so a P-tag there
                  would be a number that drives nothing. Hidden until settled. */}
              {isBudgetSettled(v.budgetNegotiation?.state ?? null) &&
                (mayChangePriority ? (
                  <button
                    type="button"
                    onClick={() => setPriorityOpen(true)}
                    className="rounded-full bg-[var(--control)] px-2 py-0.5 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control-hover)]"
                  >
                    <span data-figure>{formatRankDisplay(rankFor(v, me))}</span>
                  </button>
                ) : (
                  /* Still shown, because your rank is a fact about your day even
                     when you cannot change it. It is simply not a button. */
                  <span
                    /* Names WHOSE rank this is. The static "your priority" was
                       wrong for a manager looking at a report's task — the
                       number shown is the assignee's, not theirs. */
                    title={rankTitle(rankFor(v, me))}
                    className="rounded-full bg-[var(--control)] px-2 py-0.5 text-[11px] text-ink-muted"
                  >
                    <span data-figure>{formatRankDisplay(rankFor(v, me))}</span>
                  </span>
                ))}
              {v.task.isBlocked && <Chip tone="blocked">Blocked</Chip>}
              {v.reworkCount > 0 && (
                <Chip tone="rework">{v.reworkCount} rework</Chip>
              )}
              {!v.task.isScoreEligible && <Chip>Not scored</Chip>}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Popover
              label="Task actions"
              trigger={({ toggle }) => (
                <ToolButton icon="more" label="More actions" onClick={toggle} />
              )}
            >
              {() => (
                <>
                  {mayChangePriority && (
                    <MenuItem icon="flag" onClick={() => setPriorityOpen(true)}>
                      Change priority
                    </MenuItem>
                  )}
                  <MenuItem icon="projects">
                    <Link href="/tasks/projects">Move to project</Link>
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem icon="close" danger>
                    Cancel task
                  </MenuItem>
                </>
              )}
            </Popover>
          </div>
        </div>

        <div className="mt-3 border-b border-hairline pb-2">
          {/* Badges are attached HERE rather than built into `tabs` above, so
              the tab list stays a description of the task's shape and knows
              nothing about who has read what. */}
          <IconTabs items={badgedTabs} active={tab} />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        <div className="flex flex-col gap-4 deck:col-span-8">
          {/* The timer, above everything. It is the one control on this page
              somebody presses repeatedly through a working day — start, pause,
              start again — where every card below is a decision taken once and
              a brief read once. It used to sit between the brief and the
              subtasks, which put it below the fold on any task with a real
              description, so starting work cost a scroll every time.

              This displaces "the next required action, always first" below.
              That card still leads the decisions; it no longer leads the page.

              Suppressed on a container for the same reason as the block below:
              once a task is broken down nobody works the parent, and a Start
              button here would bank time against a task whose work is somebody
              else's — counted twice, once on the parent and once on the subtask
              actually doing it. */}
          {tab === "overview" && !isContainer && <TimePanel view={v} />}

          {/*
            The next required action, first among the decisions.

            Suppressed for a department gate the viewer owes a decision on:
            `ApprovalActionCard` below covers exactly that case and covers it
            better — it names what happens after the decision and requires a
            reason for a refusal. Rendering both would put two Approve buttons
            on one screen wired to the same endpoint.

            **Every card in this block is suppressed on a container.** Nothing
            below here is a decision about WORK — it is a decision about a
            timer, a budget, a deadline or an acceptance, and a project has none
            of those; its subtasks do. Before this gate a project still carried
            whatever negotiation state it had the moment it was broken down —
            usually "Assigned, awaiting acceptance" — so its detail page kept
            offering an Accept button and a budget proposal for work that was
            never going to happen on that document again. Pressing Accept would
            have accepted a project, which is not a coherent action; the button
            simply should never have been there. */}
          {action.actor !== "nobody" &&
            tab === "overview" &&
            !v.pendingApprovals.some(
              (a) => a.approverId === me && a.kind === "cross_department",
            ) && (
              <NextActionCard taskId={taskId} view={v} onRefetch={refetch} />
            )}

          {/* **Accepting the work itself**, before any of the negotiations below.
              It renders only where acceptance is the outstanding step and decides
              for itself whether this viewer is the person who owes it. */}
          {tab === "overview" && (
            <AssignmentConfirmationCard
              view={v}
              viewerId={me}
              onChange={refetch}
            />
          )}

          {/* An assignee's request for MORE time, answered in hours before
              anybody is asked about a date. It renders only where there is such
              a request, and it decides for itself whether this viewer is the
              manager who owns the hours. Above the budget card because it is a
              live question rather than a standing state. */}
          {tab === "overview" && (
            <ExtensionDecisionCard view={v} viewerId={me} onChange={refetch} />
          )}

          {/* The assignor's half of the same escalation, in DATES only. It
              renders only for a deadline request and decides for itself whether
              this viewer owns the commitment. */}
          {tab === "overview" && (
            <DeadlineRevisionCard view={v} viewerId={me} onChange={refetch} />
          )}

          {/* The move that had no surface: a counter-offer hands the turn back
              to whoever asked, and nothing rendered for them. */}
          {tab === "overview" && (
            <CounterDeadlineCard view={v} viewerId={me} onChange={refetch} />
          )}

          {/* The OTHER move that had no surface, and the one reported: a manager
              answers a request for hours, and the assignee — whose week the
              figure binds — has to agree to it. `approved` used to be terminal,
              so the record said "confirm this" and nothing rendered. */}
          {tab === "overview" && (
            <BudgetConfirmationCard view={v} viewerId={me} onChange={refetch} />
          )}

          {/* The time budget, for whichever side is being waited on — and a
              plain statement of whose turn it is for everybody else. One card
              for both parties: two cards each with their own conditions is how
              an assignee came to be offered an accept over their own proposal. */}
          {tab === "overview" && (
            <BudgetNegotiationCard view={v} viewerId={me} onChange={refetch} />
          )}

          {/* Both extension conversations in the order they happened, each in
              its own unit. Filtered by the rule: the assignor sees the dates
              only, because the hours are not their decision. */}
          {tab === "overview" && (
            <ExtensionTimeline view={v} viewerId={me} />
          )}

          {/* What was asked to be corrected, above the flow — somebody whose
              work came back needs the list before the diagram. Renders nothing
              on a task that has never been returned. */}
          {tab === "overview" && <ReworkPanel view={v} />}

          {/* The decision this viewer owes, above everything else — a person
              who has a button to press should not have to read a timeline to
              discover it. Renders for the current approver only; everyone else
              falls straight through to the read-only flow below. */}
          {tab === "overview" && (
            <ApprovalActionCard
              task={v.task}
              approvals={v.approvals}
              pendingApprovals={v.pendingApprovals}
              assignees={v.assignees}
              pendingAssignees={v.pendingAssignees}
              creator={v.owner}
              viewerId={me}
              onDone={refetch}
            />
          )}

          {/* Where the task is, and whose turn it is.
              Directly under the action card because the two answer different
              questions: that one is "what can I do", this is "what is going on"
              — and a reader with no action to take was previously left with a
              status label and no way to find out who was holding the work. */}
          {tab === "overview" && (
            <TaskFlowSection
              task={v.task}
              approvals={v.approvals}
              pendingApprovals={v.pendingApprovals}
              budgetOwner={v.budgetOwner}
              budgetTurn={budgetTurn(v, me)}
              /* From the same resolver the confirmation card renders from, so the
                 sentence and the control cannot disagree about whose move it is —
                 which is what "Waiting for Umung Arora — you" over no button was. */
              acceptanceIsViewers={
                getAssignmentActions(me, v).canAccept
              }
              assignees={v.assignees}
              /* Held off the task by an open gate, and still who it is for. */
              pendingAssignees={v.pendingAssignees}
              creator={v.owner}
              viewerId={me}
              /* Present only once somebody has submitted, and absent entirely
                 on the legacy read path — the flow says nothing about a
                 reviewer rather than naming a likely one. */
              review={
                v.latestSubmission && {
                  chain: v.latestSubmission.reviewChain,
                  currentStage: v.latestSubmission.currentStage,
                }
              }
            />
          )}

          {/* Why this task works the way it does. Shown on every task, not
              only pending ones — the assignee of a fixed-deadline task has the
              same question as its creator, and answering it only while
              something is blocked means the answer disappears the moment it is
              approved. Absent on a container: it explains a deadline model
              that no longer applies to this document. */}
          {tab === "overview" && <RelationshipNote view={v} />}

          {/* The project's own explanation, in the ONE card's place all the
              above would otherwise occupy. Says plainly that this task is a
              container now and where the real state lives. */}
          {tab === "overview" && isContainer && (
            <Panel>
              <h2 className="text-sm font-medium text-ink">
                This is a project
              </h2>
              <p className="mt-2 max-w-[62ch] text-sm text-ink-muted">
                It has been broken down into subtasks, so nothing happens on it
                directly — no timer, no time budget, no deadline, and nothing to
                accept or submit here. Its title, brief and completion
                requirements are below. The work, and everything that happens to
                it, is on its subtasks.
              </p>
            </Panel>
          )}

          {tab === "overview" && (
            <Overview
              view={v}
              subtasks={subtasks.data ?? []}
              onChange={() => {
                refetch();
                subtasks.refetch();
              }}
            />
          )}
          {/* Guarded as well as untabbed: the tab is gone from the bar, and
              `/tasks/:id/deadline` is still a URL somebody can hold open from
              before the task was broken down. */}
          {/* Guarded as well as untabbed. All three are gone from the bar on a
              project, and all three are URLs somebody can hold open from before
              the task was broken down — a bookmark, a notification, a back
              button. One explanation covers them, because the reason is the
              same: the work moved down a level. */}
          {isContainer &&
            (tab === "deadline" ||
              tab === "reports" ||
              tab === "submission" ||
              tab === "review") && (
              <Panel>
                <h2 className="text-sm font-medium text-ink">
                  This task has been broken down
                </h2>
                <p className="mt-2 max-w-[62ch] text-sm text-ink-muted">
                  It is a project now: its deadline, its daily reports, its
                  submission and its review all live on its subtasks, each
                  worked and decided with the person carrying that piece. This
                  task closes when every completion requirement is satisfied.
                  Open a subtask to see or change its time, read its progress,
                  hand it in, or decide on it.
                </p>
              </Panel>
            )}
          {tab === "deadline" && (
            <DeadlinePanel view={v} onChange={refetch} />
          )}
          {tab === "reports" && !isContainer && <ReportsPanel view={v} />}
          {tab === "submission" && (
            <SubmissionPanel view={v} onChange={refetch} />
          )}
          {tab === "review" && (
            <ReviewPanel view={v} onChange={refetch} />
          )}
          {tab === "meetings" && <TaskMeetingPanel view={v} />}

          {tab === "roadmap" && <GoalRoadmapPanel view={v} />}
          {tab === "files" && <TaskFilesPanel view={v} />}
          {tab === "history" && <HistoryPanel taskId={taskId} />}
          {tab === "chat" && (
            <ChatPanel taskId={taskId} status={v.task.status} />
          )}
        </div>

        {/* The constant facts. */}
        <div className="flex flex-col gap-4 deck:col-span-4">
          <FactsRail
            view={v}
            isContainer={isContainer}
            onPriority={
              mayChangePriority ? () => setPriorityOpen(true) : null
            }
          />
          <ScoreImpact view={v} />
        </div>
      </div>

      {priorityOpen && (
        <PriorityDialog
          view={v}
          onClose={() => setPriorityOpen(false)}
          onDone={() => {
            setPriorityOpen(false);
            refetch();
          }}
        />
      )}
    </>
  );
}

/* ── Next action ──────────────────────────────────────────────────────────── */

function NextActionCard({
  taskId,
  view,
  onRefetch,
}: {
  taskId: string;
  view: ReturnType<typeof Object> & { task: { status: string } };
  onRefetch: () => void;
}) {
  const me = useViewerId();
  const v = view as never as import("@/lib/repositories").TaskView;
  const dutyMode = useMyDutyMode();
  const action = nextAction(v, me ?? "", dutyMode);
  /* A suggestion under the obligation, never instead of it — see
     `lib/rules/meetings/meetingFirst.ts`. */
  const meetFirst = meetingFirstHint({
    taskId,
    actor: action.actor,
    budgetSettled: isBudgetSettled(v.budgetNegotiation?.state ?? null),
    everMet: v.task.meetings.firstStartedAt !== null,
  });
  const [start, startState] = useAction((r) => r.startTask(taskId));
  const [decide, decideState] = useAction(
    (r, approvalId: string, d: "approved" | "rejected") =>
      r.decideApproval(approvalId, d, "Approved from task detail"),
  );

  const pending = startState.isPending || decideState.isPending;
  const err = startState.error ?? decideState.error;
  const code = startState.errorCode ?? decideState.errorCode;

  const mineApproval = v.pendingApprovals.find((a) => a.approverId === me);

  /*
   * The approval chain used to replace this card's one-line summary, because
   * "Waiting on someone else" answers none of the questions a held task raises.
   * It now has a section of its own on the overview — `TaskFlowSection` — which
   * covers every state rather than only `pending_approval`, so this card is
   * back to doing one job: naming the action, if the viewer has one.
   *
   * Deliberately not both. Two timelines of one truth is two things to keep
   * right, and the one further down the page loses.
   */

  /**
   * Away from your own work — legacy's replacement, in its own place.
   *
   * `app/coworking/tasks/page.js:8571` swaps the entire `TaskActionBanner` for
   * a notice rather than editing the label inside it, and this is the same
   * swap. It matters that it is a replacement: every control below is an action
   * on the task, and leaving them under a warning would be offering exactly
   * what the sentence says cannot be done.
   *
   * Not reusing the "Waiting on someone else" eyebrow, even though `nextAction`
   * correctly reports `actor: "them"` for counting purposes. Nobody else IS
   * waiting — the person is, on themselves — and telling them otherwise would
   * send them looking for a colleague to chase.
   */
  const away = presenceRefusal(
    dutyMode,
    v.assignments.some((a) => a.employeeId === me),
  );
  if (away && v.task.status !== "completed" && v.task.status !== "cancelled") {
    return (
      <Panel>
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          {away.stateLabel}
        </p>
        <p className="mt-0.5 text-[15px] text-ink">{away.message}</p>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3">
        {(
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
              action.actor === "you"
                ? "bg-ink text-[var(--body-bg)]"
                : "bg-[var(--control)] text-ink-muted"
            }`}
          >
            <Icon.chevronRight />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            {action.actor === "you"
              ? "Your move"
              : action.actor === "them"
                ? "Waiting on someone else"
                : "Closed"}
          </p>
          <p className="mt-0.5 text-[15px] text-ink">{action.label}</p>
          {meetFirst && (
            /* Deliberately quiet: smaller, muted, and BELOW the move somebody is
               waiting on. A suggestion that competes with the obligation for
               attention is how the obligation gets missed. */
            <p className="mt-1.5 max-w-[62ch] text-[11px] leading-relaxed text-ink-faint">
              {meetFirst.text}{" "}
              <Link
                href={meetFirst.href}
                className="text-ink underline underline-offset-2"
              >
                {meetFirst.label}
              </Link>
            </p>
          )}
        </div>

        {action.actor === "you" && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* An effort estimate is not an approve/reject — the receiving
                department has to enter a number before the task can reach
                anyone. Legacy gave it its own control for that reason
                (`department-tl-set-hours`), so the generic buttons are
                suppressed for it. */}
            {mineApproval?.kind === "effort_estimate" ? (
              <EffortEstimateForm taskId={taskId} view={view} onDone={onRefetch} />
            ) : mineApproval ? (
              <>
                <Button
                  tone="primary"
                  size="sm"
                  disabled={pending}
                  onClick={async () => {
                    const r = await decide(mineApproval.id, "approved");
                    if (r.ok) onRefetch();
                  }}
                  data-help="review-approve-button"
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={async () => {
                    const r = await decide(mineApproval.id, "rejected");
                    if (r.ok) onRefetch();
                  }}
                  data-help="review-reject-button"
                >
                  Reject
                </Button>
              </>
            ) : null}
            {/* **Acceptance is NOT decided here any more.**
                This was `status === "assigned" && deadline.state === "agreed"`,
                which is stricter than the engine — `confirmTaskReceipt` skips the
                deadline requirement for budget tasks entirely — and it carried no
                viewer check, so the task's creator was offered a confirmation the
                engine would 403. With the "Go" link below also suppressed on
                `assigned`, all three branches were false at once and this card
                rendered "Your move" above nothing.

                `AssignmentConfirmationCard` owns it now, from
                `getAssignmentActions`, which is the same resolver the repository
                authorises the write with. */}
            {v.task.status === "confirmed" && (
              <Button
                tone="primary"
                size="sm"
                disabled={pending}
                onClick={async () => {
                  const r = await start();
                  if (r.ok) onRefetch();
                }}
              >
                {startState.isPending ? "Starting…" : "Start work"}
              </Button>
            )}
            {/* The generic fallback. `confirmed` is excluded because it has its
                own Start work button above; `assigned` used to be excluded too,
                which is what left that state with no control at all once the
                confirmation condition failed. It is now handled by
                `AssignmentConfirmationCard`, so the exclusion is gone and this
                link is a real fallback rather than a third dead branch. */}
            {action.href && !mineApproval && v.task.status !== "confirmed" && (
              <Button tone="primary" size="sm">
                <Link href={action.href}>Go</Link>
              </Button>
            )}
          </div>
        )}
      </div>
      {err && (
        <div className="mt-3">
          <InlineError message={err} code={code} />
        </div>
      )}
    </Panel>
  );
}

/* ── Time ─────────────────────────────────────────────────────────────────── */

/* The work session, and the commits it has produced. One control, shared with
   the table rows — the detail variant just states more of it.

   Lifted out of `Overview` so it can be rendered FIRST in the detail column,
   above the negotiation cards. The timer is the one thing on this page somebody
   presses repeatedly through a working day; every card above it was a decision
   made once. Kept as its own component rather than a branch inside `Overview`
   because it owns a query — the commit list — and nothing else up there needs
   it.

   The caller gates it on `!isContainer`; the reason lives there, with the rest
   of the container suppressions. */
function TimePanel({ view }: { view: import("@/lib/repositories").TaskView }) {
  const commits = useQuery(
    (r) => r.listWorkCommits(view.task.id),
    [view.task.id],
  );

  return (
    <Panel padded={false}>
      <div className="border-b border-hairline px-5 py-3">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-medium text-ink">Time</h2>
          <span className="text-[11px] text-ink-faint">
            Pausing writes a work commit — that record is what credits worked
            time.
          </span>
        </div>
        <TimerControl view={view} size="detail" />
      </div>
      {commits.data?.length ? (
        <div className="divide-y divide-hairline">
          {commits.data.slice(0, 5).map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-5 py-2">
              <Icon.clock className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                {c.message ?? "Work session"}
              </span>
              <span data-figure className="shrink-0 text-xs text-ink-faint">
                {formatDurationTimer(c.durationSecs)}
              </span>
            </div>
          ))}
        </div>
      ) : view.loggedSecs > 0 ? (
        /*
         * Legacy records no per-run commits — `pauseTimer` only accumulates
         * into `totalSeconds` — so this list is empty on every real task and
         * said "No time logged yet" over hours of work. The banked total is
         * the honest answer where the breakdown does not exist.
         */
        <div className="px-5 py-4">
          <p data-figure className="text-[15px] text-ink">
            {formatTimer(view.loggedSecs)}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            Total worked. This engine records a running total rather than a
            run-by-run breakdown.
          </p>
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-ink-faint">No time logged yet.</p>
      )}
    </Panel>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function Overview({
  view,
  subtasks,
  onChange,
}: {
  view: import("@/lib/repositories").TaskView;
  subtasks: import("@/lib/repositories").TaskView[];
  /* Requirement and subtask changes have to refetch BOTH the task and its
     children — satisfaction is derived from the pair, so refreshing one leaves
     the panel showing a count the other half no longer supports. */
  onChange: () => void;
}) {
  /* Read here rather than threaded down: the outputs panel is the only part of
     Overview that needs it, and who may declare or submit an output resolves
     from the acting employee. */
  const viewerId = useViewerId();
  return (
    <>
      {/* The Time panel used to sit here, between the brief and the subtasks.
          It is now `TimePanel`, rendered at the very top of the column — above
          the negotiation cards, not merely above the brief. Moving it inside
          this component was not enough: `Overview` is itself the last child of
          that column, so "first in Overview" was still below a dozen cards. */}

      {/* Above the brief on purpose: on a subtask this is the context for
          everything below it, not a footnote to it. Renders nothing on a root
          task. */}
      <ResponsibilityPanel view={view} />

      {/* Renders nothing when the task has no meetings, which is most of them. */}
      <RelatedMeetings taskId={view.task.id} />

      {/* Files used to be three read-only groups here — reference, each
          submission attempt, corrections — and the chat's own attachments and
          anything on a daily report were reachable only by scrolling the
          surface that carried them. They are all on the Files tab now, pooled
          and filterable, which is one place instead of four and takes 2+N
          fetches off this page. */}

      <Panel>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-medium text-ink">Brief</h2>
          <span className="text-[11px] text-ink-faint">
            Created {formatDate(view.task.createdAt)}
          </span>
        </div>
        <p className="mt-2 max-w-[68ch] text-sm text-ink-muted">
          {view.task.description ?? "No description was given for this task."}
        </p>
        {/* Requirements moved to `ProjectPanel`, which owns their satisfaction
            state. Rendering them here too would show the same checklist twice
            with only one copy able to be ticked. */}
      </Panel>

      {/* Below the brief and above the project panel: an output is a promise
          the brief explains, and it is read before the requirements that decide
          whether the task itself is done. */}
      <OutputsPanel view={view} viewerId={viewerId} onChange={onChange} />

      <ProjectPanel view={view} subtasks={subtasks} onChange={onChange} />

      {/* Daily reports used to be the last card here, and only when at least
          one existed — so on the task where somebody wondered where the
          progress notes had gone there was nothing on screen to answer them.
          They have a tab of their own now, `ReportsPanel`. Not repeated here:
          two lists of one thing is two places to keep right, and the one
          further down the page loses. */}
    </>
  );
}

/* ── Facts rail ───────────────────────────────────────────────────────────── */

function FactsRail({
  view,
  isContainer,
  onPriority,
}: {
  view: import("@/lib/repositories").TaskView;
  /** No priority, no completion date, no time budget — see the facts below. */
  isContainer: boolean;
  /** Null when this viewer may change nobody's priority on this task. */
  onPriority: (() => void) | null;
}) {
  const v = view;
  /* Read here rather than threaded down as a prop: the rail is the only part
     of this component that needs it, and the resolver decides whose rank is
     being shown. */
  const me = useViewerId();
  return (
    <Panel>
      <h2 className="mb-3 text-sm font-medium text-ink">Details</h2>
      <dl className="space-y-2.5">
        <Fact label="Owner">
          {v.owner ? (
            <span className="flex items-center gap-1.5">
              <Avatar
                initials={v.owner.initials}
                hue={v.owner.hue}
                src={v.owner.profilePictureUrl}
                name={v.owner.displayName}
                size="sm"
              />
              <span className="truncate text-sm text-ink">
                {v.owner.displayName}
              </span>
            </span>
          ) : (
            <span className="text-sm text-ink-faint">—</span>
          )}
        </Fact>

        <Fact label="Assignees">
          {v.assignees.length ? (
            <span className="flex items-center gap-2">
              <AvatarStack
                people={v.assignees.map((a) => ({
                  initials: a.initials,
                  hue: a.hue,
                  name: a.displayName,
                  src: a.profilePictureUrl,
                }))}
              />
              <span className="truncate text-sm text-ink">
                {v.assignees.map((a) => a.firstName).join(", ")}
              </span>
            </span>
          ) : v.pendingAssignees.length ? (
            /* A cross-department task holds its assignee in `pendingAssignees`
               until both departments approve — showing "Unassigned" there was
               wrong, the person IS chosen, the handover just has not landed. */
            <span className="flex items-center gap-2">
              <AvatarStack
                people={v.pendingAssignees.map((a) => ({
                  initials: a.initials,
                  hue: a.hue,
                  name: a.displayName,
                  src: a.profilePictureUrl,
                }))}
              />
              <span className="truncate text-sm text-ink">
                {v.pendingAssignees.map((a) => a.firstName).join(", ")}
                <span className="text-ink-faint"> · pending approval</span>
              </span>
            </span>
          ) : (
            <span className="text-sm text-ink-faint">Unassigned</span>
          )}
        </Fact>

        {v.assignments.length > 1 && (
          <p className="rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-ink-faint">
            Only the primary assignee is scored on this task.{" "}
            <ProvisionalBadge
              decisionId="O9"
              label="Multi-assignee attribution"
            />
          </p>
        )}

        {/* Priority only once the time budget is decided — see the header chip.
            Until then the task holds no live queue position, so the whole row is
            omitted rather than showing a rank that means nothing yet. Also
            omitted on a container outright: a rank is a position in a queue of
            work, and nobody is queued to do a project — its subtasks each carry
            their own. */}
        {!isContainer &&
          isBudgetSettled(v.budgetNegotiation?.state ?? null) && (
            <Fact label="Priority">
              {onPriority ? (
                <button
                  type="button"
                  onClick={onPriority}
                  className="rounded-full bg-[var(--control)] px-2 py-0.5 text-sm text-ink transition-colors hover:bg-[var(--control-hover)]"
                >
                  <span data-figure>{formatRankDisplay(rankFor(v, me))}</span>
                </button>
              ) : (
                <span
                  title="Your priority is set by your manager"
                  className="rounded-full bg-[var(--control)] px-2 py-0.5 text-sm text-ink"
                >
                  <span data-figure>{formatRankDisplay(rankFor(v, me))}</span>
                </span>
              )}
            </Fact>
          )}

        {/**
         * **THE DEADLINE — one date, the same one the Deadline tab shows.**
         * OWNER DECISION, 16 Aug 2026.
         *
         * This row was `Expected completion`: a projection of when the queue
         * would finish the work, deliberately shown INSTEAD of the deadline on
         * the reasoning that two dates side by side would make people plan
         * against the wrong one.
         *
         * It did the opposite. The projection is what people read as their
         * deadline — it is the only date on the panel — so the real one lived
         * only on another tab, and the two disagreed. A rework that moved the
         * deadline from 11:18 to 12:17 changed nothing here, and was reported
         * as the rework rule having failed when the engine had written it
         * correctly. Two dates on two screens is worse than two dates on one:
         * at least side by side they can be labelled.
         *
         * So this reads `task.deadline.dueAt` — the identical field
         * `DeadlinePanel` renders as "Working deadline". One source, one date.
         * The projection still exists in `ExpectedCompletion` and is still
         * tested; it is no longer what this panel calls the answer.
         */}
        {/**
         * **Shown on a container too — OWNER DECISION, 16 Aug 2026.**
         *
         * A project keeps a real deadline and it is the umbrella its subtasks
         * sit under: no subtask may be due after it. A cap nobody can see is a
         * cap nobody can plan against, so the date the children are measured
         * against has to be on the parent's own page.
         *
         * This reverses "a container has no deadline of its own". It has one —
         * it is the commitment the whole divided job was given.
         */}
        {v.task.deadline.dueAt && (
          <Fact label="Deadline">
            <span className="text-sm text-ink">
              {formatDateTime(v.task.deadline.dueAt)}
            </span>
            {/* Where the count began is stated inside the budget history, not
                here — OWNER DECISION, 16 Aug 2026. The deadline itself stays a
                single clean date; the reasoning belongs with the other workings
                somebody opens deliberately. See `BudgetHistory`. */}
          </Fact>
        )}

        {v.task.deadline.officialDueAt !== v.task.deadline.dueAt && (
            <Fact label="Scored against">
              <span
                className="text-sm text-ink"
                title="Charged extensions move the working deadline but not the scored one"
              >
                {formatDateTime(v.task.deadline.officialDueAt)}
              </span>
            </Fact>
          )}

        {/* No time budget on a container — it has none of its own; each
            subtask has its own, shown on that subtask's own facts. Showing this
            document's leftover figure (whatever it was proposed with before it
            was broken down) is what put "05:00:00" and an Accept button on a
            screen that starts and stops nothing. */}
        {!isContainer && (
          <Fact label="Time budget">
            <span className="text-sm text-ink">
              <span data-figure>{formatDurationTimer(v.loggedSecs)}</span>
              <span className="text-ink-faint">
                {" "}
                of {formatDurationTimer(v.task.estimatedEffortSecs)}
              </span>
            </span>
            {/* Where the second figure came from. A budget grows on its own —
                breaks, offline spans, emergencies, meetings — and the number
                alone cannot say which. */}
            {/* The instant the deadline was counted from travels with the
                history rather than sitting under the date — one line, opened
                deliberately, beside the other workings. */}
            <BudgetHistory
              taskId={v.task.id}
              countedFrom={v.task.deadline.clockStartsAt}
            />
          </Fact>
        )}

        <Fact label="Project">
          {v.project ? (
            <Link
              href={`/tasks/projects/${v.project.id}`}
              className="truncate text-sm text-ink hover:opacity-80"
            >
              {v.project.name}
            </Link>
          ) : (
            <span className="text-sm text-ink-faint">None</span>
          )}
        </Fact>

        <Fact label="Type">
          <span className="text-sm text-ink capitalize">
            {v.task.type.replace(/_/g, " ")}
          </span>
        </Fact>
      </dl>
    </Panel>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-20 shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/* ── Score impact ─────────────────────────────────────────────────────────── */

function ScoreImpact({
  view,
}: {
  view: import("@/lib/repositories").TaskView;
}) {
  const v = view;
  if (!v.task.isScoreEligible) {
    return (
      <Panel>
        <h2 className="text-sm font-medium text-ink">Score impact</h2>
        <p className="mt-2 text-sm text-ink-muted">
          This task type is not scored, so nothing here contributes to C1 · Task
          Execution.
        </p>
      </Panel>
    );
  }

  const reworkLoss = v.reworkCount * REWORK_DEDUCTION;
  const projected = Math.max(0, 1 - reworkLoss);

  return (
    <Panel>
      <h2 className="text-sm font-medium text-ink">Score impact</h2>
      <p className="mt-1 text-xs text-ink-faint">C1 · Task Execution</p>

      <div className="mt-3 flex items-baseline gap-2">
        <span
          data-figure
          className="text-[22px] leading-none tracking-[-0.025em] text-ink"
        >
          {projected.toFixed(1)}
        </span>
        <span className="text-xs text-ink-faint">of 1.0 points projected</span>
      </div>
      <Meter
        value={projected * 100}
        label="Projected task score"
        className="mt-2"
      />

      <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3">
        <li className="flex items-baseline gap-2 text-xs">
          <span className="flex-1 text-ink-muted">Base</span>
          <span data-figure className="text-ink">
            +1.0
          </span>
        </li>
        {v.reworkCount > 0 && (
          <li className="flex items-baseline gap-2 text-xs">
            <span className="flex-1 text-ink-muted">
              Rework × {v.reworkCount}
            </span>
            <span data-figure className="text-[var(--state-rework-ink)]">
              −{reworkLoss.toFixed(1)}
            </span>
          </li>
        )}
        {v.latestSubmission?.wasLate && (
          <li className="flex items-baseline gap-2 text-xs">
            <span className="flex-1 text-ink-muted">Submitted late</span>
            <span className="flex items-center gap-1">
              <ProvisionalBadge
                decisionId="O6"
                label="Missed-deadline deduction"
              />
            </span>
          </li>
        )}
      </ul>

      <p className="mt-3 text-[11px] text-ink-faint">
        Rework at 0.2 per occurrence is a confirmed rule. Deadline and rejection
        deductions are placeholders pending an owner decision.
      </p>
    </Panel>
  );
}

/**
 * The receiving department sets the effort before the task reaches its
 * assignee.
 *
 * Legacy's `/task/:taskId/department-tl-set-hours`, which takes a value and a
 * unit and refuses anything not positive ("Enter a valid number of hours").
 * Setting it converts the task from a fixed deadline into a budget and performs
 * the `arrayUnion` that first makes it visible — so this control is the last
 * gate on a cross-department crossing, not a formality.
 */
function EffortEstimateForm({
  taskId,
  view,
  onDone,
}: {
  taskId: string;
  view: import("@/lib/repositories").TaskView;
  onDone: () => void;
}) {
  const [hours, setHours] = useState(4);
  /* Advisory only: the preview never disables the button. The spec's optional
     "continue with deadline risk" acknowledgement is NOT built — it is meant to
     be stored with a feasibility snapshot, and the engine has no field for one.
     A checkbox that recorded nothing would look like an audit trail and be
     none. */
  const [set, state] = useAction((r) =>
    r.setEffortEstimate(taskId, hours * 3600),
  );
  return (
    <div>
      {/* Said in full, because this control is the last thing standing between
          an approved task and the person waiting for it — and until it is set,
          they cannot see the task at all. "Effort" alone did not convey that. */}
      <p className="mb-2 text-[13px] leading-relaxed text-ink-muted">
        Set the estimated hours for the person doing this work. It is assigned
        to them once you do.
      </p>
      <div className="flex flex-wrap items-end gap-2">
      <Field label="Time budget" hint="The estimated working hours for this task.">
        <Select
          value={String(hours)}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 6, 8, 12, 16, 24, 40].map((h) => (
            <option key={h} value={h}>
              {h} hours
            </option>
          ))}
        </Select>
      </Field>
      {/* Between the number and the commitment, which is where the question
          "is this enough time?" actually arises. Measured against the person
          who will DO the work: a held cross-department task keeps them in
          `pendingAssigneeIds` until it is handed over. */}
      <FeasibilityPreview
        employeeId={
          view.pendingAssignees[0]?.id ?? view.assignees[0]?.id ?? null
        }
        employeeName={
          view.pendingAssignees[0]?.displayName ??
          view.assignees[0]?.displayName ??
          null
        }
        taskId={taskId}
        /* Position is not chosen here — it is set later in the flow — so none
           is given, and the rule places the task where it actually goes: the
           back of the assignee's queue, which is where new work joins.

           It used to pass `view.myRank ?? view.myStoredRank ?? 1`. Both are
           null unless the VIEWER is an assignee, and the manager sizing a
           cross-department task never is — so every preview ran at P1, ahead
           of work the assignee was already committed to. */
        estimatedWorkSeconds={hours * 3600}
        committedDeadline={view.task.deadline.dueAt}
        /* Position is not committed on this card — trying one shows the impact
           without setting anything, which is the question being asked here. */
        selectable
        /* Budget, unlike position, IS what this card sets. So the chips drive
           the same `hours` the dropdown above holds rather than a second copy
           of it — one number, two ways to reach it, and no way for the
           simulation to disagree with what the button will submit. */
        onBudgetChange={(secs) => setHours(secs / 3600)}
      />

      <Button
        tone="primary"
        size="sm"
        /* The engine refuses `val <= 0`; refusing it here means the reader
           finds out before a round trip rather than through a validation
           message about a field they cannot see. */
        disabled={state.isPending || !(hours > 0)}
        onClick={async () => {
          const r = await set();
          if (r.ok) onDone();
        }}
        data-help="set-time-budget-button"
      >
        {state.isPending ? "Setting…" : "Set hours"}
      </Button>
      </div>
      {state.error && <InlineError message={state.error} />}
    </div>
  );
}
