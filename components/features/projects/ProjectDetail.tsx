"use client";

import Link from "next/link";
import { useState } from "react";
import { TaskTable } from "@/components/features/tasks/TaskTable";
import { TaskBoard } from "@/components/features/tasks/TaskBoard";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Breadcrumb,
  MenuDivider,
  MenuItem,
  Popover,
  ToolButton,
} from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  InlineError,
  Meter,
  Panel,
  ProvisionalBadge,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { PROVISIONAL_RULES } from "@/lib/config/provisional";

/**
 * Project detail.
 *
 * Connected tasks are the core of the page (brief §8.3), so they get the widest
 * column and the default tab. Everything else — members, milestones, activity —
 * supports them from the rail.
 *
 * Progress is always derived from connected tasks. There is no writable
 * progress field anywhere on this page.
 */

type Tab = "tasks" | "milestones" | "activity";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("tasks");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [linkOpen, setLinkOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery(
    (r) => r.getProject(projectId),
    [projectId],
  );
  const tasks = useQuery((r) => r.listProjectTasks(projectId), [projectId]);
  const activity = useQuery(
    (r) => r.listProjectActivity(projectId),
    [projectId],
  );
  const allTasks = useQuery(
    (r) => r.listTasks({ scope: "all" }).then((p) => p.items),
    [],
  );
  const people = useQuery((r) => r.listEmployees(), []);

  const [link, linkState] = useAction((r, taskId: string) =>
    r.linkTask(projectId, taskId),
  );
  const [unlink] = useAction((r, taskId: string) =>
    r.unlinkTask(projectId, taskId),
  );
  const [addMember] = useAction((r, employeeId: string) =>
    r.addProjectMember(projectId, employeeId, "member"),
  );
  const [archive, archiveState] = useAction((r) => r.archiveProject(projectId));

  if (isLoading) return <SkeletonRows rows={10} />;
  if (error) return <ErrorState body={error} onRetry={refetch} />;
  if (!data)
    return (
      <Panel>
        <ErrorState
          title="Project not found"
          body="It may have been archived or removed."
        />
      </Panel>
    );

  const { project: p, progress: pr, owner, members, milestones } = data;
  const unlinked = (allTasks.data ?? []).filter(
    (t) => t.task.projectId !== projectId,
  );

  const tabs = [
    {
      id: "tasks",
      label: "Tasks",
      href: "#tasks",
      icon: "tasks" as const,
      count: pr.totalTasks,
    },
    {
      id: "milestones",
      label: "Milestones",
      href: "#milestones",
      icon: "flag" as const,
      count: milestones.length,
    },
    {
      id: "activity",
      label: "Activity",
      href: "#activity",
      icon: "history" as const,
    },
  ];

  return (
    <>
      <div className="mb-4">
        <Breadcrumb
          items={[
            { label: "Tasks", href: "/tasks?view=tasks" },
            { label: "Projects", href: "/tasks/projects" },
            { label: p.reference },
          ]}
        />

        <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
              {p.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Chip>{p.status.replace(/_/g, " ")}</Chip>
              <Chip
                tone={
                  pr.health === "off_track"
                    ? "overdue"
                    : pr.health === "at_risk"
                      ? "risk"
                      : "positive"
                }
              >
                {pr.health.replace("_", " ")}
              </Chip>
              {p.isRestricted && <Chip tone="blocked">Restricted</Chip>}
              {p.targetDate && (
                <span className="text-xs text-ink-faint">
                  Target {formatDate(p.targetDate)}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <AvatarStack
              people={members.slice(0, 4).map((m) => ({
                initials: m.employee.initials,
                hue: m.employee.hue,
                name: m.employee.displayName,
              }))}
              overflow={Math.max(0, members.length - 4)}
            />
            <Popover
              label="Add member"
              trigger={({ toggle }) => (
                <ToolButton icon="user" label="Add member" onClick={toggle} />
              )}
            >
              {(close) => (
                <>
                  {(people.data ?? [])
                    .filter((e) => !members.some((m) => m.employeeId === e.id))
                    .map((e) => (
                      <MenuItem
                        key={e.id}
                        onClick={async () => {
                          await addMember(e.id);
                          close();
                          refetch();
                        }}
                      >
                        {e.displayName}
                      </MenuItem>
                    ))}
                </>
              )}
            </Popover>
            <Button tone="primary" size="sm">
              <Link
                href={`/tasks/new?project=${p.id}`}
                className="flex items-center gap-1.5"
              >
                <Icon.plus />
                New task
              </Link>
            </Button>
            <Popover
              label="Project actions"
              trigger={({ toggle }) => (
                <ToolButton icon="more" label="More" onClick={toggle} />
              )}
            >
              {() => (
                <>
                  <MenuItem icon="link" onClick={() => setLinkOpen(true)}>
                    Connect existing task
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem
                    icon="close"
                    danger
                    onClick={async () => {
                      await archive();
                      refetch();
                    }}
                  >
                    {archiveState.isPending ? "Archiving…" : "Archive project"}
                  </MenuItem>
                </>
              )}
            </Popover>
          </div>
        </div>
      </div>

      {/* Derived progress strip. */}
      <Panel padded={false} className="mb-4">
        <div className="grid grid-cols-2 divide-x divide-y divide-hairline sm:grid-cols-5 sm:divide-y-0">
          <ProgressCell
            label="Progress"
            value={`${pr.progressPercent}%`}
            bar={pr.progressPercent}
            health={pr.health}
            note={PROVISIONAL_RULES.projectProgressRule.label}
            provisional
          />
          <ProgressCell
            label="Tasks"
            value={`${pr.completedTasks}/${pr.totalTasks}`}
            note="completed"
          />
          <ProgressCell
            label="Overdue"
            value={String(pr.overdueTasks)}
            note={pr.overdueTasks ? "needs attention" : "none"}
            alert={pr.overdueTasks > 0}
          />
          <ProgressCell
            label="Blocked"
            value={String(pr.blockedTasks)}
            note={pr.blockedTasks ? "waiting on something" : "none"}
            alert={pr.blockedTasks > 0}
          />
          <ProgressCell
            label="Milestones"
            value={`${pr.completedMilestones}/${pr.totalMilestones}`}
            note={
              pr.nextDeadline
                ? `next ${formatDate(pr.nextDeadline)}`
                : "no deadlines"
            }
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        {/* Connected tasks — the core of the page. */}
        <div className="deck:col-span-9">
          <div className="mb-3 flex items-center gap-3 border-b border-hairline pb-2">
            <div className="min-w-0 flex-1">
              <div
                role="tablist"
                aria-label="Project views"
                className="flex items-center gap-0.5"
              >
                {tabs.map((t) => {
                  const Ico = Icon[t.icon];
                  const on = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTab(t.id as Tab)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        on
                          ? "bg-[var(--control)] text-ink"
                          : "text-ink-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
                      }`}
                    >
                      <Ico className={on ? "" : "opacity-70"} />
                      {t.label}
                      {t.count !== undefined && (
                        <span
                          data-figure
                          className="text-[11px] text-ink-faint"
                        >
                          {t.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {tab === "tasks" && (
              <div className="flex shrink-0 items-center gap-1.5">
                <ToolButton
                  icon="list"
                  label="List"
                  active={layout === "list"}
                  onClick={() => setLayout("list")}
                />
                <ToolButton
                  icon="board"
                  label="Board"
                  active={layout === "board"}
                  onClick={() => setLayout("board")}
                />
              </div>
            )}
          </div>

          {tab === "tasks" &&
            (pr.totalTasks === 0 ? (
              <Panel>
                <EmptyState
                  title="No tasks connected yet"
                  body="Create a task inside this project, or connect one that already exists. Connecting is a link — removing it later never deletes the task."
                  action={
                    <div className="flex gap-2">
                      <Button tone="primary">
                        <Link href={`/tasks/new?project=${p.id}`}>
                          New task
                        </Link>
                      </Button>
                      <Button onClick={() => setLinkOpen(true)}>
                        Connect existing
                      </Button>
                    </div>
                  }
                />
              </Panel>
            ) : layout === "list" ? (
              <TaskTable
                scope="all"
                projectId={projectId}
                onUnlink={async (taskId) => {
                  await unlink(taskId);
                  refetch();
                  tasks.refetch();
                }}
              />
            ) : (
              <TaskBoard scope="all" projectId={projectId} />
            ))}

          {tab === "milestones" && (
            <Panel padded={false}>
              {!milestones.length ? (
                <EmptyState
                  compact
                  title="No milestones"
                  body="Milestones group tasks toward a date."
                />
              ) : (
                <div className="divide-y divide-hairline">
                  {milestones.map((m) => {
                    const done = Boolean(m.completedAt);
                    const inside = (tasks.data ?? []).filter((t) =>
                      data.taskLinks.some(
                        (l) => l.taskId === t.task.id && l.milestoneId === m.id,
                      ),
                    );
                    const doneCount = inside.filter(
                      (t) => t.task.status === "completed",
                    ).length;
                    return (
                      <div key={m.id} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Icon.flag
                            className={
                              done
                                ? "text-[var(--state-positive-ink)]"
                                : "text-ink-faint"
                            }
                          />
                          <span className="text-sm text-ink">{m.title}</span>
                          {done && <Chip tone="positive">Complete</Chip>}
                          <span className="ml-auto text-xs text-ink-faint">
                            {formatDate(m.targetDate)}
                          </span>
                        </div>
                        {inside.length > 0 && (
                          <>
                            <Meter
                              value={
                                inside.length
                                  ? (doneCount / inside.length) * 100
                                  : 0
                              }
                              label={`${m.title} progress`}
                              className="mt-2"
                            />
                            <p className="mt-1 text-[11px] text-ink-faint">
                              {doneCount} of {inside.length} tasks complete
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {tab === "activity" && (
            <Panel padded={false}>
              {!activity.data?.length ? (
                <EmptyState compact title="No activity yet" />
              ) : (
                <ol className="divide-y divide-hairline">
                  {activity.data.map((a) => (
                    <li key={a.id} className="flex gap-3 px-5 py-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--control-active)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink">{a.summary}</p>
                        <p className="mt-0.5 text-[11px] text-ink-faint">
                          {a.actorLabel} · {formatDateTime(a.occurredAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}
        </div>

        {/* Rail */}
        <div className="flex flex-col gap-4 deck:col-span-3">
          <Panel>
            <h2 className="mb-3 text-sm font-medium text-ink">About</h2>
            {p.description && (
              <p className="mb-3 text-sm text-ink-muted">{p.description}</p>
            )}
            <dl className="space-y-2.5">
              <Fact label="Owner">
                <span className="flex items-center gap-1.5">
                  <Avatar
                    initials={owner.initials}
                    hue={owner.hue}
                    name={owner.displayName}
                    size="sm"
                  />
                  <span className="truncate text-sm text-ink">
                    {owner.displayName}
                  </span>
                </span>
              </Fact>
              <Fact label="Start">
                <span className="text-sm text-ink">
                  {formatDate(p.startDate)}
                </span>
              </Fact>
              <Fact label="Target">
                <span className="text-sm text-ink">
                  {formatDate(p.targetDate)}
                </span>
              </Fact>
              {p.tags.length > 0 && (
                <Fact label="Tags">
                  <span className="flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                  </span>
                </Fact>
              )}
            </dl>
          </Panel>

          <Panel>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-medium text-ink">Members</h2>
              <span data-figure className="text-xs text-ink-faint">
                {members.length}
              </span>
            </div>
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <Avatar
                    initials={m.employee.initials}
                    hue={m.employee.hue}
                    name={m.employee.displayName}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {m.employee.displayName}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint capitalize">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <h2 className="text-sm font-medium text-ink">Scoring</h2>
            <p className="mt-2 text-xs text-ink-muted">
              Projects do not carry a score of their own. The tasks and goals
              inside them are the scoring units, so nothing here is counted
              twice.
            </p>
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="text-[11px] text-ink-faint">
                Connected-task performance
              </p>
              <p className="mt-1 flex items-baseline gap-2">
                <span
                  data-figure
                  className="text-[22px] leading-none tracking-[-0.025em] text-ink"
                >
                  {pr.totalTasks
                    ? Math.round((pr.completedTasks / pr.totalTasks) * 100)
                    : 0}
                  %
                </span>
                <span className="text-[11px] text-ink-faint">
                  completion rate
                </span>
              </p>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                {pr.reworkCount} rework across connected tasks
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {/* Connect an existing task. */}
      {linkOpen && (
        <div className="fixed inset-0 z-[90] grid place-items-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLinkOpen(false)}
            className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
          />
          <div className="frost-panel relative max-h-[80vh] w-[min(520px,96vw)] overflow-y-auto rounded-panel px-6 py-5 scroll-slim">
            <h2 className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink">
              Connect an existing task
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              Connecting creates a link. Removing it later leaves the task
              intact.
            </p>
            {linkState.error && (
              <div className="mt-3">
                <InlineError
                  message={linkState.error}
                  code={linkState.errorCode}
                />
              </div>
            )}
            <ul className="mt-4 divide-y divide-hairline">
              {unlinked.slice(0, 12).map((t) => (
                <li key={t.task.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {t.task.title}
                    </span>
                    <span
                      data-figure
                      className="block text-[11px] text-ink-faint"
                    >
                      {t.task.reference}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    onClick={async () => {
                      const r = await link(t.task.id);
                      if (r.ok) {
                        refetch();
                        tasks.refetch();
                        setLinkOpen(false);
                      }
                    }}
                  >
                    Connect
                  </Button>
                </li>
              ))}
              {!unlinked.length && (
                <EmptyState compact title="Every task is already connected" />
              )}
            </ul>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setLinkOpen(false)}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProgressCell({
  label,
  value,
  bar,
  note,
  alert = false,
  health,
  provisional = false,
}: {
  label: string;
  value: string;
  bar?: number;
  note?: string;
  alert?: boolean;
  health?: string;
  provisional?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <p className="flex items-center gap-1.5 truncate text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        {label}
        {provisional && (
          <ProvisionalBadge decisionId="P1" label="Project progress rule" />
        )}
      </p>
      <p
        data-figure
        className={`mt-1.5 text-[22px] leading-none tracking-[-0.025em] ${
          alert ? "text-[var(--state-overdue-ink)]" : "text-ink"
        }`}
      >
        {value}
      </p>
      {bar !== undefined && (
        <Meter
          value={bar}
          label={label}
          tone={
            health === "off_track"
              ? "overdue"
              : health === "at_risk"
                ? "risk"
                : "default"
          }
          className="mt-2"
        />
      )}
      {note && (
        <p className="mt-1.5 truncate text-[11px] text-ink-faint">{note}</p>
      )}
    </div>
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
      <dt className="w-14 shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
