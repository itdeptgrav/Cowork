"use client";

import Link from "next/link";
import {
  formatRankDisplay,
  rankFor,
  rankTitle,
} from "@/lib/rules/tasks/priorityDisplay";
import { isBudgetSettled } from "@/lib/rules/tasks/activeQueue";
import { isProjectContainer } from "@/lib/rules/tasks/completion";
import { deadlineOrigin, formatWindow } from "@/lib/rules/tasks/deadlineOrigin";
import { useEffect, useRef, useState } from "react";
import { TimerControl } from "./TimerControl";
import { statusMeta, nextAction } from "./statusMeta";
import { meetingFirstHint } from "@/lib/rules/meetings/meetingFirst";
import { ProjectPanel, requirementsFooterVisible } from "./ProjectPanel";
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
  InlineError,
  Meter,
  Panel,
  ProvisionalBadge,
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
  /**
   * A budget accept is finishing the assignment behind it.
   *
   * **The gap this closes.** Settling a budget and taking on the work are two
   * writes, and `acceptBudget` calls `notifyRepositoryChanged()` the moment the
   * first lands — so the view refetches BETWEEN them. For the second or two the
   * confirm is in flight, the task reads "budget agreed, not yet accepted",
   * which is exactly the state `AssignmentConfirmationCard` exists to answer.
   * It appeared, offered "Accept task", and vanished again on its own.
   *
   * Owned here rather than in either card because it is the seam between them:
   * one card starts the work and a different card must stay quiet until it is
   * done. Neither can see the other.
   */
  const [finishingAcceptance, setFinishingAcceptance] = useState(false);
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
          title={
            isUnavailable ? "Not available yet" : "Could not open this task"
          }
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
    /* Between the deadline and the submission: the reference material you work
       FROM is read before the work is handed in, and it is the thing people
       open most often after the brief itself. */
    {
      id: "files",
      label: "Files",
      href: `/tasks/${taskId}/files`,
      icon: "folder" as const,
    },
    {
      id: "submission",
      label: "Submission",
      href: `/tasks/${taskId}/submission`,
      icon: "send" as const,
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
    /* Withheld from a project, and the only tab that is. A daily report is
       written against time a timer measured, and a project has no timer — its
       days are reported on the subtasks where the work happened. */
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
              {/* A label, and only a label — see `Task.isImportant`. It leads
                  the row because it is the one thing here somebody set by hand
                  to be noticed. */}
              {v.task.isImportant && <Chip tone="overdue">Important</Chip>}
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
          {/* A /review URL lights Submission, the tab that absorbed it —
              otherwise an old bookmark shows a bar with nothing selected. */}
          <IconTabs
            items={badgedTabs}
            active={tab === "review" ? "submission" : tab}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        {/* Eight columns beside the rail, twelve without it. The rail is an
           overview-only thing now, and a tab that does not draw one must not
           leave a third of the page blank beside a panel that has to scroll. */}
        <div
          className={`flex flex-col gap-4 ${
            tab === "overview" ? "deck:col-span-8" : "deck:col-span-12"
          }`}
        >
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
          {/* **What the task is, first.**
              The brief and the completion requirements were the last two cards
              in the column, under the timer, the decisions, the negotiations
              and the flow diagram. That is the wrong way round: everything
              below is a decision ABOUT this work, and you cannot take one
              without first reading what the work is. They lead now. */}
          {tab === "overview" && <BriefPanel view={v} />}

          {tab === "overview" && (
            <ProjectPanel
              view={v}
              subtasks={subtasks.data ?? []}
              onChange={() => {
                refetch();
                subtasks.refetch();
              }}
            />
          )}

          {/* **The deadline and its negotiation, straight after the brief.**
              These five carry the whole time conversation — the hours stepper,
              the date counter-offer, and whose move it is — and they sat below
              the timer and the action card, four cards down. Reading what the
              work is and then agreeing how long it gets is one thought, so they
              follow the requirements directly.

              The order WITHIN the block is unchanged and deliberate: a live
              request is answered before a standing state, and hours are settled
              before dates. Each card still decides for itself whether it has
              anything to say, so on a task with no negotiation open this whole
              block renders nothing and the timer moves up to meet the brief. */}
          {tab === "overview" && (
            <ExtensionDecisionCard view={v} viewerId={me} onChange={refetch} />
          )}

          {tab === "overview" && (
            <DeadlineRevisionCard view={v} viewerId={me} onChange={refetch} />
          )}

          {tab === "overview" && (
            <CounterDeadlineCard view={v} viewerId={me} onChange={refetch} />
          )}

          {tab === "overview" && (
            <BudgetConfirmationCard view={v} viewerId={me} onChange={refetch} />
          )}

          {tab === "overview" && (
            <BudgetNegotiationCard
              view={v}
              viewerId={me}
              onChange={refetch}
              /* Carried across the merge from the copy that was removed as a
                 duplicate. Raised for the whole of the chained confirm, so the
                 card above stays shut across the refetch that lands between the
                 two writes — without it the confirmation reopens mid-sequence. */
              onFinishingAcceptance={setFinishingAcceptance}
            />
          )}

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
          {/* Held shut while a budget accept is confirming behind it — see
              `finishingAcceptance`. In its place, one line saying what is
              happening, so the pause reads as work rather than as a gap. */}
          {tab === "overview" &&
            (finishingAcceptance ? (
              <Panel>
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-ink-muted"
                >
                  <span className="flex gap-0.5" aria-hidden>
                    <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint [animation-delay:-200ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint [animation-delay:-100ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint" />
                  </span>
                  Taking on the task…
                </p>
              </Panel>
            ) : (
              <AssignmentConfirmationCard
                view={v}
                viewerId={me}
                onChange={refetch}
              />
            ))}

          {/* Both extension conversations in the order they happened, each in
              its own unit. Filtered by the rule: the assignor sees the dates
              only, because the hours are not their decision. */}
          {tab === "overview" && <ExtensionTimeline view={v} viewerId={me} />}

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
              acceptanceIsViewers={getAssignmentActions(me, v).canAccept}
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
          {tab === "deadline" && <DeadlinePanel view={v} onChange={refetch} />}
          {tab === "reports" && !isContainer && <ReportsPanel view={v} />}
          {/* **Submission and review are one tab.**
              They were two, and they are two halves of one exchange: the work
              goes in, and somebody decides on it. Splitting them meant the
              person handing work in and the person judging it read different
              screens about the same submission, and neither could see the other
              half without changing tab.

              The review sits UNDER the submit box, in the order the work moves.
              `ReviewPanel` decides for itself whether this viewer owes a
              decision, so on a task nobody has submitted it renders nothing and
              the tab is the submit box alone — exactly what it was before.

              `tab === "review"` still lands here: /tasks/:id/review is a URL
              people hold in bookmarks and notifications, and it now shows the
              tab that absorbed it rather than an empty column. */}
          {(tab === "submission" || tab === "review") && (
            <>
              <SubmissionPanel view={v} onChange={refetch} />
              <ReviewPanel view={v} onChange={refetch} />
            </>
          )}
          {tab === "meetings" && <TaskMeetingPanel view={v} />}

          {tab === "roadmap" && <GoalRoadmapPanel view={v} />}
          {tab === "files" && <TaskFilesPanel view={v} />}
          {tab === "history" && <HistoryPanel taskId={taskId} />}
          {tab === "chat" && (
            <ChatPanel taskId={taskId} status={v.task.status} />
          )}
        </div>

        {/* **The constant facts, on the overview only.**
           They are the standing description of the task — owner, priority,
           deadline, budget, score impact — and they were repeated beside every
           tab, including the ones that are themselves a full reading surface:
           the chat, the file list, the history. On those the rail was a column
           of facts nobody had come to read, taking a third of the width from
           the thing they had. */}
        {tab === "overview" && (
          <div className="flex flex-col gap-4 deck:col-span-4">
            {/* **The timer rides the rail, above the facts.**
              It led the wide column, which put the control somebody presses
              repeatedly through a day at the top of the reading column and
              pushed the brief down. Here it sits with the other constants —
              deadline, budget, priority — which is what it is a live reading
              of, and the wide column is left to what the task IS.

              Still overview-only and still absent on a container: the same two
              conditions it carried before, moved with it unchanged. */}
            {tab === "overview" && !isContainer && <TimePanel view={v} />}

            <FactsRail
              view={v}
              isContainer={isContainer}
              onPriority={
                mayChangePriority ? () => setPriorityOpen(true) : null
              }
            />
            <ScoreImpact view={v} />
          </div>
        )}
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

  /* **The submit move now lives in the completion panel above.** When it is
     showing this same move, a second control here is the same jump from a box
     that cannot say why it might be refused.

     Suppression asks that panel whether it is on screen rather than guessing
     from the status. Guessing is exactly what left `assigned` with no control
     at all: two conditions that looked equivalent were not, and both were
     false at once. A task with no requirements has no footer, so it keeps the
     link below. */
  const submitRelocated =
    action.href === `/tasks/${taskId}/submission` &&
    requirementsFooterVisible(v, me);

  /**
   * **A card with nothing left in it does not render.**
   *
   * Handing the submit move upstairs left this one stating “Your move —
   * Submit when ready” above an empty space, directly under the button that
   * had just offered it. An eyebrow naming a move it cannot perform is worse
   * than no card: it reads as a second, broken control.
   *
   * Only this one case. Every other move still has its own button here, and
   * `meetFirst` is checked because the meeting suggestion lives in this card
   * too — if it is showing, the card still has something to say. All hooks
   * are above this line.
   */
  if (submitRelocated && !meetFirst) return null;

  /* Kept on one line and intact: `assignmentAcceptance.test.ts` asserts on the
     exact text of this condition, because it is the one that went dead. */
  const fallbackGo =
    action.href && !mineApproval && v.task.status !== "confirmed";

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
        {
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
              action.actor === "you"
                ? "bg-ink text-[var(--body-bg)]"
                : "bg-[var(--control)] text-ink-muted"
            }`}
          >
            <Icon.chevronRight />
          </span>
        }
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
                suppressed for it.

                **And it is not rendered here.** This row is a slot for one or
                two capsule buttons sitting beside a heading that takes the rest
                of the line: `items-center`, a `flex-1` title, a `shrink-0`
                cluster. `EffortEstimateForm` is a whole planning surface — a
                selector, a feasibility panel and a queue — and putting it in
                the Approve/Reject slot is what left the heading stranded beside
                a void with the commit button floating in the corner. It has its
                own full-width block below this row. */}
            {mineApproval && mineApproval.kind !== "effort_estimate" ? (
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
            {/* Every other move still routes from here. Only the submit move
                is handed over, and only when the panel that took it is
                actually rendering — `submitRelocated` reads that panel’s own
                gate rather than re-deriving it. */}
            {fallbackGo && !submitRelocated && (
              <Button tone="primary" size="sm">
                <Link href={action.href!}>Go</Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* The effort estimate, at the panel's full width.
          Separated by a hairline and space rather than a nested card — the
          house rule, and a card inside a Panel would read as a second surface
          when it is the same move the heading above already named. */}
      {action.actor === "you" && mineApproval?.kind === "effort_estimate" && (
        <div className="mt-4 border-t border-hairline pt-4">
          <EffortEstimateForm taskId={taskId} view={view} onDone={onRefetch} />
        </div>
      )}

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
  onChange,
}: {
  view: import("@/lib/repositories").TaskView;
  /* Requirement and subtask changes have to refetch BOTH the task and its
     children — satisfaction is derived from the pair, so refreshing one leaves
     the panel showing a count the other half no longer supports.

     `subtasks` came with this prop on the incoming branch, for the
     `ProjectPanel` it rendered here. That panel is mounted at the top of the
     tab on this branch instead, so the list would have been an unread
     argument — the callback is what `OutputsPanel` actually needs. */
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

      {/* The brief and the completion requirements used to be here, at the
          bottom of the column. They are now `BriefPanel` and `ProjectPanel`,
          rendered at the TOP — what the task is has to be readable before any
          decision about it, and it was sitting under a dozen cards.

          **Only the outputs panel is drawn here.** The incoming branch also
          rendered a Brief panel and a second `ProjectPanel` in this spot, which
          was correct on that branch and is a duplicate on this one: both are
          already mounted above (`BriefPanel` and `ProjectPanel` at the top of
          the overview tab). Two Brief cards, and two requirement checklists of
          which only one could be ticked, is what taking that side wholesale
          would have produced. */}
      <OutputsPanel view={view} viewerId={viewerId} onChange={onChange} />

      {/* Daily reports used to be the last card here, and only when at least
          one existed — so on the task where somebody wondered where the
          progress notes had gone there was nothing on screen to answer them.
          They have a tab of their own now, `ReportsPanel`. Not repeated here:
          two lists of one thing is two places to keep right, and the one
          further down the page loses. */}
    </>
  );
}

/**
 * What the task is — the first thing on the page.
 *
 * Lifted out of `Overview` so it can be rendered above the decision cards
 * rather than beneath them. Same panel, same type, same "Created" stamp; only
 * its position changed.
 *
 * Requirements are NOT repeated here. `ProjectPanel` owns their satisfaction
 * state, and a second checklist would be a copy nobody could tick.
 */
function BriefPanel({ view }: { view: import("@/lib/repositories").TaskView }) {
  return (
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
    </Panel>
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
  /* Hours, and it may be FRACTIONAL now that minutes can be typed — 4h 30m is
     4.5 here. `Math.round(hours * 3600)` at every use turns it into whole
     seconds, so 4h 20m (4.3333…) banks 15600 exactly rather than 15599.88; the
     float only ever exists between the keystroke and the round. */
  const [hours, setHours] = useState(4);
  const budgetSecs = Math.round(hours * 3600);
  /* Advisory only: the preview never disables the button. The spec's optional
     "continue with deadline risk" acknowledgement is NOT built — it is meant to
     be stored with a feasibility snapshot, and the engine has no field for one.
     A checkbox that recorded nothing would look like an audit trail and be
     none. */
  const [set, state] = useAction((r) =>
    r.setEffortEstimate(taskId, budgetSecs),
  );
  /* The person who will DO the work — a held cross-department task keeps them
     in `pendingAssigneeIds` until it is handed over, so they are not in
     `assignees` yet. Never the viewer: the manager sizing a cross-department
     task is in a different department entirely. */
  const assigneeId =
    view.pendingAssignees[0]?.id ?? view.assignees[0]?.id ?? null;
  const assigneeName =
    view.pendingAssignees[0]?.displayName ??
    view.assignees[0]?.displayName ??
    null;

  /* ONE control for the number, handed to the panel so it renders beside the
     dates it moves. There is no second copy anywhere — see `BudgetChoice`. */
  const budgetControl = <BudgetChoice hours={hours} onChange={setHours} />;

  return (
    <div>
      {/* Said in full, because this control is the last thing standing between
          an approved task and the person waiting for it — and until it is set,
          they cannot see the task at all. "Effort" alone did not convey that. */}
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Set the estimated hours for the person doing this work. It is assigned
        to them once you do.
      </p>

      {/* Between the number and the commitment, which is where the question
          "is this enough time?" actually arises. */}
      <FeasibilityPreview
        employeeId={assigneeId}
        employeeName={assigneeName}
        taskId={taskId}
        /* Position is not chosen here — it is set later in the flow — so none
           is given, and the rule places the task where it actually goes: the
           back of the assignee's queue, which is where new work joins.

           It used to pass `view.myRank ?? view.myStoredRank ?? 1`. Both are
           null unless the VIEWER is an assignee, and the manager sizing a
           cross-department task never is — so every preview ran at P1, ahead
           of work the assignee was already committed to. */
        estimatedWorkSeconds={budgetSecs}
        committedDeadline={view.task.deadline.dueAt}
        /* Position is not committed on this card — trying one shows the impact
           without setting anything, which is the question being asked here. */
        selectable
        budgetControl={budgetControl}
      />

      {/* An assignee is what the preview measures against. Without one there is
          no queue and no dates to show, and the panel renders nothing — so the
          budget control is mounted here instead rather than disappearing with
          the preview that was only ever advisory. */}
      {!assigneeId && (
        <div className="mt-3 rounded-inset border border-[var(--hairline)] bg-[var(--surface-sunken)] px-3.5 py-3">
          {budgetControl}
        </div>
      )}

      {/* The form's terminal action, on its own line under both halves. It was
          wedged into a wrapping flex row beside the selector and the whole
          preview panel, which left it floating against the panel's bottom-right
          corner with no relationship to anything. */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-hairline pt-3">
        {state.error && (
          <div className="min-w-0 flex-1">
            <InlineError message={state.error} />
          </div>
        )}
        <Button
          tone="primary"
          size="sm"
          /* The engine refuses `val <= 0`; refusing it here means the reader
             finds out before a round trip rather than through a validation
             message about a field they cannot see. */
          disabled={state.isPending || !(budgetSecs > 0)}
          onClick={async () => {
            const r = await set();
            if (r.ok) onDone();
          }}
          data-help="set-time-budget-button"
        >
          {state.isPending ? "Setting…" : "Set hours"}
        </Button>
      </div>
    </div>
  );
}

/** The hours this budget may be set to — the ONE list, offered once. */
const BUDGET_HOURS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 40];

/**
 * The time budget, as a single control.
 *
 * **This replaces a dropdown and a chip row that set the same number.** They
 * were wired to one `hours` so they could never disagree — but a reader has no
 * way to see that, and two controls sitting together is a promise that they do
 * different things. Worse, they did not even offer the same hours: the chips
 * stopped at 16 while the dropdown went to 40, so the dropdown could show a
 * value no chip could reach and pressing a chip silently narrowed the range.
 *
 * Chips rather than the select, because this screen is for TRYING budgets: the
 * verdict beside it recomputes on every change, and one tap per trial is the
 * whole interaction. A select costs two clicks and hides the range it offers.
 *
 * A real radiogroup, not a row of buttons — arrow keys move between the hours
 * and only the selected one is in the tab order, which is what a person using a
 * keyboard expects from a control that picks one of ten.
 */
function BudgetChoice({
  hours,
  onChange,
}: {
  hours: number;
  onChange: (hours: number) => void;
}) {
  return (
    <div>
      <p id="budget-choice-label" className="text-[11px] text-ink-faint">
        Time budget
      </p>
      <div
        role="radiogroup"
        aria-labelledby="budget-choice-label"
        className="mt-1.5 flex flex-wrap gap-1.5"
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowRight" || e.key === "ArrowDown"
              ? 1
              : e.key === "ArrowLeft" || e.key === "ArrowUp"
                ? -1
                : 0;
          if (!step) return;
          e.preventDefault();
          const at = BUDGET_HOURS.indexOf(hours);
          /* Wraps, so the ends are not dead. */
          const next =
            BUDGET_HOURS[
              (at + step + BUDGET_HOURS.length) % BUDGET_HOURS.length
            ];
          onChange(next);
          /* Focus follows selection, which is the radiogroup contract. */
          (
            e.currentTarget.querySelector(
              `[data-hours="${next}"]`,
            ) as HTMLElement | null
          )?.focus();
        }}
      >
        {BUDGET_HOURS.map((h) => {
          const on = hours === h;
          return (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={on}
              data-hours={h}
              /* Roving tab stop: the group is one stop, not ten. */
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(h)}
              data-figure
              className={`rounded-full px-2.5 py-1 text-[12px] transition-colors duration-[180ms] ease-[var(--ease-deck)] ${
                on
                  ? "bg-ink text-[var(--body-bg)]"
                  : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
              }`}
            >
              {h}h
            </button>
          );
        })}
      </div>

      {/* An EXACT figure, for the budget the chips do not offer. The presets
          cover the common trials in one tap; this covers "4h 20m" without a
          chip for every quarter hour. It writes the same `hours` the chips do —
          fractional now — so the feasibility preview beside it and the Set-hours
          write both read one number, and a chip lights up only when the exact
          value happens to equal it. */}
      <CustomBudgetFields hours={hours} onChange={onChange} />

      <p className="mt-2 text-[11px] text-ink-faint">
        The estimated working hours for this task.
      </p>
    </div>
  );
}

/**
 * Hours and minutes typed exactly, kept in step with the chips above.
 *
 * ## Two-way, without a fight
 *
 * The fields mirror the current budget: pick the 6h chip and they read 6 and 0;
 * type here and the chips deselect because the value no longer equals a preset.
 * The sync from outside is GUARDED — it rewrites the fields only when the budget
 * arrived from elsewhere (a chip, an arrow key), never on the change this very
 * input just raised, so a half-typed "2" is not clobbered back to "0" between
 * keystrokes.
 *
 * ## Minutes are allowed to overflow, then settle
 *
 * You can type 90 into minutes; while you do, the budget is already 1h 30m more
 * than the hours field. On blur the fields normalise — 4h and 90m become 5h and
 * 30m — so what is shown always adds up, but you were never interrupted mid-entry.
 */
function CustomBudgetFields({
  hours,
  onChange,
}: {
  hours: number;
  onChange: (hours: number) => void;
}) {
  const wholeH = Math.floor(Math.max(0, hours));
  const wholeM = Math.round((Math.max(0, hours) - wholeH) * 60);
  const [hStr, setHStr] = useState(String(wholeH));
  const [mStr, setMStr] = useState(String(wholeM));

  /* Resync only when the budget changed from OUTSIDE this control — compared at
     second resolution so a rounding wobble does not count as a change. */
  useEffect(() => {
    const fieldsSecs = Math.round(
      ((Number(hStr) || 0) + (Number(mStr) || 0) / 60) * 3600,
    );
    if (fieldsSecs !== Math.round(hours * 3600)) {
      const h = Math.floor(Math.max(0, hours));
      setHStr(String(h));
      setMStr(String(Math.round((Math.max(0, hours) - h) * 60)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  const push = (hs: string, ms: string) => {
    const hh = Math.max(0, Math.floor(Number(hs) || 0));
    const mm = Math.max(0, Math.floor(Number(ms) || 0));
    onChange(hh + mm / 60);
  };

  /* Carry overflow minutes into hours, and drop a stray decimal — only when the
     person has finished typing, so it never rewrites a field under the cursor. */
  const normalise = () => {
    const total = Math.round(hours * 60); // whole minutes
    setHStr(String(Math.floor(total / 60)));
    setMStr(String(total % 60));
  };

  const field =
    "w-14 rounded-inset bg-[var(--surface-raised)] px-2 py-1 text-[12px] text-ink tabular-nums text-center shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none";

  return (
    <div className="mt-2.5 flex items-center gap-2">
      <span className="text-[11px] text-ink-faint">Or exact:</span>
      <label className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label="Hours"
          value={hStr}
          onChange={(e) => {
            setHStr(e.target.value);
            push(e.target.value, mStr);
          }}
          onBlur={normalise}
          className={field}
        />
        <span className="text-[11px] text-ink-faint">h</span>
      </label>
      <label className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label="Minutes"
          value={mStr}
          onChange={(e) => {
            setMStr(e.target.value);
            push(hStr, e.target.value);
          }}
          onBlur={normalise}
          className={field}
        />
        <span className="text-[11px] text-ink-faint">m</span>
      </label>
    </div>
  );
}
