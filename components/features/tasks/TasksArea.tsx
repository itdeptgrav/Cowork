"use client";

import { isActivePriorityTask } from "@/lib/rules/tasks/activeQueue";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ApprovalKind } from "@/lib/domain";
import type { TaskView } from "@/lib/repositories";
import { TaskTable } from "./TaskTable";
import { TaskBoard } from "./TaskBoard";
import { EmergencyApprovals } from "./EmergencyApprovals";
import { TasksOverview } from "./TasksOverview";
import { TasksTimeline } from "./TasksTimeline";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { IconTabs, ToolButton, WorkspaceHead } from "@/components/ui/Workspace";
import {
  Button,
  EmptyState,
  Panel,
  Segmented,
  SkeletonRows,
  QueryError,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import type { TaskScope } from "@/lib/repositories";

/**
 * The Tasks workspace.
 *
 * Chrome is two compact rows, matching `Tasks.jpeg`: title + count + scope +
 * primary action, then icon tabs + toolbar. Everything below is data.
 */
/** Every view this area can render. `workload` is permission-gated in `tabs`,
 *  but a direct link to it is still a real view rather than a typo. */
const VIEWS = [
  "overview",
  "tasks",
  "timeline",
  "approvals",
  "workload",
] as string[];

export function TasksArea() {
  const perms = usePermissions();
  const viewScope = perms.scopeFor("task.view");
  const params = useSearchParams();
  /* Anything unrecognised falls back to the overview rather than rendering the
     chrome over an empty body. `?view=folders` was a real, linked URL until
     folders were removed, so bookmarks and old links point at a view that no
     longer exists — and a page that renders tabs and nothing else reads as
     broken rather than as moved. */
  const requested = params.get("view") ?? "overview";
  const view = VIEWS.includes(requested) ? requested : "overview";
  /* No "Needs you" pill here any more. Everything waiting on this person lives
     in the action inbox, and showing the same rows in both places taught people
     to check one and distrust the other. Tasks answers "what is the state of
     the work"; the inbox answers "what is waiting on me". */
  const [scope, setScope] = useState<TaskScope>("mine");
  const [layout, setLayout] = useState<"list" | "board">("list");

  const mine = useQuery(
    (r) => r.listTasks({ scope: "mine" }).then((p) => p.total),
    [],
  );
  const team = useQuery(
    (r) => r.listTasks({ scope: "team" }).then((p) => p.total),
    [],
  );
  const out = useQuery(
    (r) => r.listTasks({ scope: "assigned_out" }).then((p) => p.total),
    [],
  );
  const selfAssigned = useQuery(
    (r) => r.listTasks({ scope: "self_assigned" }).then((p) => p.total),
    [],
  );
  const submitted = useQuery(
    (r) => r.listTasks({ scope: "submitted" }).then((p) => p.total),
    [],
  );
  /* The badge counts the SAME list the tab renders. It used to count
     `listReviewQueue`, which is submission reviews only — so an approval
     waiting on you was absent from the number on the tab whose stated job is
     "what is waiting on me". One source, one count. */
  const actionable = useQuery((r) => r.listActionable(), []);

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      href: "/tasks?view=overview",
      icon: "overview" as const,
    },
    {
      id: "tasks",
      label: "Tasks",
      href: "/tasks?view=tasks",
      icon: "tasks" as const,
    },
    {
      id: "projects",
      label: "Projects",
      href: "/tasks/projects",
      icon: "projects" as const,
    },
    {
      id: "timeline",
      label: "Timeline",
      href: "/tasks?view=timeline",
      icon: "timeline" as const,
    },
    {
      id: "approvals",
      /* "Actionable", not "Approvals": the tab stopped being only approvals
         when it became the inbox. Tasks is all the work; this is the subset
         blocked on this person; the dashboard is the overview. The route key
         stays `approvals` so existing links keep working. */
      label: "Actionable",
      href: "/tasks?view=approvals",
      icon: "approvals" as const,
      count: actionable.data?.length ?? 0,
    },
    /* Workload only exists for someone whose `task.view` reaches past
       themselves. Showing it to an individual contributor would offer a view
       of one person — which reads as a broken team, not as an absent
       permission. */
    ...(viewScope === "direct_reports" ||
    viewScope === "hierarchy" ||
    viewScope === "organisation"
      ? [
          {
            id: "workload",
            label: "Workload",
            href: "/tasks?view=workload",
            icon: "team" as const,
          },
        ]
      : []),
  ];

  const all = useQuery(
    (r) => r.listTasks({ scope: "all" }).then((p) => p.total),
    [],
  );

  const scopeOptions = [
    { id: "mine" as const, label: "Mine", count: mine.data ?? undefined },
    ...(viewScope === "direct_reports" ||
    viewScope === "hierarchy" ||
    viewScope === "organisation"
      ? [
          {
            id: "team" as const,
            label: "My team",
            count: team.data ?? undefined,
          },
        ]
      : []),
    {
      id: "assigned_out" as const,
      label: "Assigned out",
      count: out.data ?? undefined,
    },
    /* Legacy's own last two tabs (`page.js:7077-7078`). Unlike "My team" and
       "Everyone" these carry no role condition — the old app shows both to
       every role, because each is defined by the viewer's own relationship to
       the task rather than by reach over other people. */
    {
      id: "self_assigned" as const,
      label: "Self tasks",
      count: selfAssigned.data ?? undefined,
    },
    {
      id: "submitted" as const,
      label: "Submitted",
      count: submitted.data ?? undefined,
    },
    ...(viewScope === "organisation"
      ? [
          {
            id: "all" as const,
            label: "Everyone",
            count: all.data ?? undefined,
          },
        ]
      : []),
  ];

  return (
    <>
      <WorkspaceHead
        title="Tasks"
        count={
          <>
            <span data-figure>{mine.data ?? 0}</span> assigned to you
            {(team.data ?? 0) > 0 && (
              <>
                {" · "}
                <span data-figure>{team.data}</span> across your team
              </>
            )}
          </>
        }
        scope={
          <Segmented
            data-help="task-scope-switch"
            label="Task scope"
            size="sm"
            value={scope}
            onChange={setScope}
            /* Scopes appear only where the viewer's `task.view` actually
               reaches. An individual contributor sees "Mine" and "Assigned
               out"; a manager gains "My team"; only organisation scope gains
               "Everyone". Offering a scope that resolves to nothing would look
               like an empty team rather than an absent permission. */
            options={scopeOptions}
          />
        }
        action={
          <Button tone="primary" size="sm" data-help="new-task-button">
            <Link href="/tasks/new" className="flex items-center gap-1.5">
              <Icon.plus />
              New task
            </Link>
          </Button>
        }
        tabs={<IconTabs items={tabs} active={view} />}
        toolbar={
          view === "tasks" ? (
            <>
              <ToolButton
                icon="list"
                label="List view"
                active={layout === "list"}
                onClick={() => setLayout("list")}
              />
              <ToolButton
                icon="board"
                label="Board view"
                active={layout === "board"}
                onClick={() => setLayout("board")}
              />
            </>
          ) : undefined
        }
      />

      {view === "overview" && <TasksOverview scope={scope} />}
      {view === "tasks" &&
        (layout === "list" ? (
          <TaskTable scope={scope} />
        ) : (
          <TaskBoard scope={scope} />
        ))}
      {view === "timeline" && <TasksTimeline />}
      {view === "approvals" && <Approvals />}
      {view === "workload" && <Workload />}
    </>
  );
}

/* ── Approvals ────────────────────────────────────────────────────────────── */

/**
 * The action inbox.
 *
 * Not an approvals list any more. Three sections, in the order a person cares
 * about them: what YOU must do, what you must let SOMEBODY ELSE do, and what
 * you must judge. The unifying idea is a decision or a commitment — if
 * something is waiting on this person, it is here.
 *
 * Nothing here is duplicated in Tasks. The Tasks view answers "what is the
 * state of the work"; this answers "what is waiting on me". Showing the same
 * rows in both taught people to check one and distrust the other.
 */
function Approvals() {
  /* One read, and it arrives already decided. The membership rule used to live
     here as a filter over every visible task — which is how "Submit when ready"
     ended up in an inbox for things that are stuck, and how the list and the
     count on the tab came to disagree. `listActionable` is now the only thing
     that decides; this renders what it is handed. */
  const inbox = useQuery((r) => r.listActionable(), []);
  const items = inbox.data ?? [];

  /* Sections come from the reason the repository assigned, so a task appears in
     exactly one — the ordering that used to be enforced by three overlapping
     filters is now a property of the verdict. */
  const needsAction = items.filter(
    (i) => i.reason !== "approval" && i.reason !== "review",
  );
  const giving = items.filter((i) => i.reason === "approval");
  const reviews = items.filter((i) => i.reason === "review");

  const APPROVAL_KINDS: { kind: ApprovalKind; title: string }[] = [
    { kind: "cross_department", title: "Cross-department" },
    { kind: "assignment", title: "Upward assignment" },
    { kind: "effort_estimate", title: "Time budget" },
    { kind: "self_assignment", title: "Self-assignment" },
  ];
  if (inbox.isLoading) return <SkeletonRows rows={5} />;

  const empty = items.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <QueryError
        queries={[inbox]}
        message="The action inbox could not be loaded."
      />

      {/* Not a task, so it is not in `listActionable` — that query answers
          "which TASKS are waiting on me" and widening it to carry a different
          kind of record would blur what the count on the tab means. It renders
          nothing when the queue is empty. */}
      <EmergencyApprovals />

      {empty && !inbox.error && (
        <Panel>
          <EmptyState
            title="Nothing waiting on you"
            body="Work you need to accept, approvals you owe and reviews on your desk all appear here."
          />
        </Panel>
      )}

      {/* 1 — yours to do. */}
      <InboxSection
        title={<span data-help="task-approvals-tab">Needs your action</span>}
        hint="Decisions and responses the work is waiting on. Tasks you can simply get on with live in Tasks."
        count={needsAction.length}
      >
        {needsAction.map((i) => (
          <InboxRow
            key={i.view.task.id}
            view={i.view}
            cta={i.label}
            subtitle={i.subtitle}
          />
        ))}
      </InboxSection>

      {/* 2 — yours to permit. Sub-grouped by kind, because agreeing to take
          work into your department and signing off a self-assignment are
          different decisions. */}
      {giving.length > 0 && (
        <Panel padded={false}>
          <SectionHeader
            title="Approvals"
            hint="Requests from other people that need your authorisation."
            count={giving.length}
          />
          {APPROVAL_KINDS.map(({ kind, title }) => {
            const rows = giving.filter((i) => i.approvalKind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind}>
                <p className="border-b border-hairline bg-[var(--surface-sunken)] px-4 py-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                  {title}
                </p>
                <div className="divide-y divide-hairline">
                  {rows.map((i) => (
                    <InboxRow
                      key={i.view.task.id}
                      view={i.view}
                      cta={i.label}
                      subtitle={i.subtitle}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      {/* 3 — yours to judge. */}
      <InboxSection
        title={<span data-help="review-queue-list">Reviews</span>}
        hint="Submitted work waiting on your decision."
        count={reviews.length}
      >
        {reviews.map((i) => (
          <InboxRow
            key={i.view.task.id}
            view={i.view}
            cta={i.label}
            subtitle={i.subtitle}
            href={i.href}
          />
        ))}
      </InboxSection>
    </div>
  );
}

function SectionHeader({
  title,
  hint,
  count,
}: {
  title: React.ReactNode;
  hint: string;
  count: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline px-4 py-2">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      <span data-figure className="text-xs text-ink-faint">
        {count}
      </span>
      <span className="w-full text-[11px] text-ink-faint sm:w-auto">
        {hint}
      </span>
    </div>
  );
}

/** A section that renders nothing at all when it is empty. */
function InboxSection({
  title,
  hint,
  count,
  children,
}: {
  title: React.ReactNode;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Panel padded={false}>
      <SectionHeader title={title} hint={hint} count={count} />
      <div className="divide-y divide-hairline">{children}</div>
    </Panel>
  );
}

function InboxRow({
  view,
  cta,
  subtitle,
  href,
}: {
  view: TaskView;
  cta: string;
  subtitle: string;
  href?: string;
}) {
  const target = href ?? `/tasks/${view.task.id}`;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <Link href={target} className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">
          {view.task.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
          {subtitle}
        </span>
      </Link>
      <Button size="sm">
        <Link href={target}>{cta}</Link>
      </Button>
    </div>
  );
}

/* ── Workload ───────────────────────────────────────────────────────────────── */

/**
 * Who is carrying what.
 *
 * Scoped by `task.view` like everything else: a manager sees their reports, an
 * administrator sees everyone, and an individual contributor sees only
 * themselves — which is why the tab is hidden for them rather than shown empty.
 */
function Workload() {
  const perms = usePermissions();
  const people = useQuery((r) => r.listEmployees(), []);
  const rows = useQuery((r) => r.listTeamMonitoring(), []);
  const tasks = useQuery(
    (r) => r.listTasks({ scope: "all" }).then((p) => p.items),
    [],
  );

  const reachable = (people.data ?? []).filter((p) =>
    perms.can("task.view", p.id),
  );

  if (people.isLoading || tasks.isLoading) return <SkeletonRows rows={6} />;

  return (
    <>
      <QueryError
        queries={[people, tasks, rows]}
        message="The workload view could not be loaded."
      />
      <Panel padded={false}>
        <div className="hidden grid-cols-[minmax(0,1fr)_90px_90px_90px_110px] items-center gap-2 border-b border-hairline px-4 py-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase deck:grid">
          <span>Person</span>
          <span className="text-right">Open</span>
          <span className="text-right">Overdue</span>
          <span className="text-right">In review</span>
          <span className="text-right">Capacity</span>
        </div>
        <div className="divide-y divide-hairline">
          {reachable.map((p) => {
            const theirs = (tasks.data ?? []).filter((v) =>
              v.assignments.some((a) => a.employeeId === p.id),
            );
            /* Same rule the priority queue uses, so a person's workload count
               and their queue length cannot disagree. */
            const open = theirs.filter(isActivePriorityTask).length;
            const overdue = theirs.filter((v) => v.isOverdue).length;
            const inReview = theirs.filter(
              (v) => v.task.status === "in_review",
            ).length;
            const row = (rows.data ?? []).find((r) => r.employeeId === p.id);
            return (
              <div
                key={p.id}
                className="grid grid-cols-2 gap-2 px-4 py-2.5 deck:grid-cols-[minmax(0,1fr)_90px_90px_90px_110px] deck:items-center"
              >
                <span className="flex items-center gap-2.5">
                  <Avatar initials={p.initials} hue={p.hue} src={p.profilePictureUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">
                      {p.displayName}
                    </span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {p.departmentName ?? "No department"}
                    </span>
                  </span>
                </span>
                <span data-figure className="text-sm text-ink deck:text-right">
                  {open}
                </span>
                <span
                  data-figure
                  className={`text-sm deck:text-right ${
                    overdue > 0 ? "text-[var(--state-overdue-ink)]" : "text-ink"
                  }`}
                >
                  {overdue}
                </span>
                <span data-figure className="text-sm text-ink deck:text-right">
                  {inReview}
                </span>
                <span className="deck:text-right">
                  {row ? (
                    <span data-figure className="text-xs text-ink-muted">
                      {row.workloadPercent}%
                    </span>
                  ) : (
                    <span className="text-xs text-ink-faint">—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
      {reachable.length === 0 && (
        <Panel className="mt-3">
          <EmptyState
            title="Nobody in reach"
            body="Workload shows the people your role lets you see."
          />
        </Panel>
      )}
    </>
  );
}
