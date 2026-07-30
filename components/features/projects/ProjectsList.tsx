"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { IconTabs, ToolButton, WorkspaceHead } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Meter,
  Panel,
  Segmented,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDate } from "@/lib/utils/format";
import type { ProjectView } from "@/lib/repositories";
import type { ProjectStatus } from "@/lib/domain";

/**
 * The Projects tab — inside Tasks, never a top-level module.
 *
 * Two layouts over the same data: a compact grid for comparing health at a
 * glance, and a table for comparing many projects on precise numbers. Neither
 * is a carousel and no card is dimmed.
 */
export function ProjectsList() {
  const [filter, setFilter] = useState<"active" | "completed" | "archived">(
    "active",
  );
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");

  const statusFor: Record<typeof filter, ProjectStatus[]> = {
    active: ["planning", "active", "on_hold"],
    completed: ["completed"],
    archived: ["archived"],
  };

  const { data, isLoading, error, refetch } = useQuery(
    (r) =>
      r
        .listProjects({
          status: statusFor[filter],
          search: search || undefined,
          sort: "health",
        })
        .then((p) => p.items),
    [filter, search],
  );
  const reviews = useQuery((r) => r.listReviewQueue(), []);

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
      label: "Approvals",
      href: "/tasks?view=approvals",
      icon: "approvals" as const,
      count: reviews.data?.length ?? 0,
    },
  ];

  return (
    <>
      <WorkspaceHead
        title="Projects"
        count={
          <>
            <span data-figure>{data?.length ?? 0}</span> {filter}
          </>
        }
        scope={
          <Segmented
            label="Project status"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "active", label: "Active" },
              { id: "completed", label: "Completed" },
              { id: "archived", label: "Archived" },
            ]}
          />
        }
        action={
          <Button tone="primary" size="sm">
            <Link
              href="/tasks/projects/new"
              className="flex items-center gap-1.5"
            >
              <Icon.plus />
              New project
            </Link>
          </Button>
        }
        tabs={<IconTabs items={tabs} active="projects" />}
        toolbar={
          <>
            <ToolButton
              icon="overview"
              label="Grid view"
              active={layout === "grid"}
              onClick={() => setLayout("grid")}
            />
            <ToolButton
              icon="list"
              label="List view"
              active={layout === "list"}
              onClick={() => setLayout("list")}
            />
          </>
        }
      />

      <div className="mb-2 flex items-center gap-1.5">
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint">
            <Icon.search />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            className="h-8 w-[176px] rounded-full bg-[var(--surface-sunken)] pr-3 pl-8 text-sm text-ink placeholder:text-ink-faint focus:w-[240px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          />
        </div>
      </div>

      {isLoading ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorState body={error} onRetry={refetch} />
      ) : !data?.length ? (
        <Panel>
          <EmptyState
            title={
              filter === "archived"
                ? "No archived projects"
                : filter === "completed"
                  ? "Nothing completed yet"
                  : "No active projects"
            }
            body="A project groups connected tasks under an owner, members, dates and milestones."
            action={
              filter === "active" ? (
                <Button tone="primary">
                  <Link href="/tasks/projects/new">New project</Link>
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : layout === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 deck:grid-cols-3">
          {data.map((v) => (
            <ProjectCard key={v.project.id} view={v} />
          ))}
        </div>
      ) : (
        <ProjectTable rows={data} />
      )}
    </>
  );
}

function ProjectCard({ view }: { view: ProjectView }) {
  const { project: p, progress: pr, owner, members } = view;
  return (
    <Panel className="flex h-full flex-col">
      <div className="flex items-start gap-2.5">
        <Avatar
          initials={owner.initials}
          hue={owner.hue}
          name={owner.displayName}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/tasks/projects/${p.id}`}
            className="block truncate text-sm font-medium text-ink"
          >
            {p.name}
          </Link>
          <p className="mt-0.5 truncate text-[11px] text-ink-faint">
            <span data-figure>{p.reference}</span> · {owner.displayName}
          </p>
        </div>
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
      </div>

      {p.description && (
        <p className="mt-2 line-clamp-2 text-xs text-ink-muted">
          {p.description}
        </p>
      )}

      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-ink-faint">Progress</span>
          <span data-figure className="text-xs text-ink">
            {pr.progressPercent}%
          </span>
        </div>
        <Meter
          value={pr.progressPercent}
          label={`${p.name} progress`}
          tone={
            pr.health === "off_track"
              ? "overdue"
              : pr.health === "at_risk"
                ? "risk"
                : "default"
          }
          className="mt-1.5"
        />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-hairline pt-2.5">
        <Stat label="Done" value={`${pr.completedTasks}/${pr.totalTasks}`} />
        <Stat
          label="Overdue"
          value={String(pr.overdueTasks)}
          alert={pr.overdueTasks > 0}
        />
        <Stat
          label="Blocked"
          value={String(pr.blockedTasks)}
          alert={pr.blockedTasks > 0}
        />
        <Stat label="Rework" value={String(pr.reworkCount)} />
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-hairline pt-2.5">
        <AvatarStack
          people={members.slice(0, 3).map((m) => ({
            initials: m.employee.initials,
            hue: m.employee.hue,
            name: m.employee.displayName,
          }))}
          overflow={Math.max(0, members.length - 3)}
        />
        <span className="truncate text-[11px] text-ink-faint">
          {pr.nextDeadline
            ? `Next ${formatDate(pr.nextDeadline)}`
            : "No deadlines"}
        </span>
        <Link
          href={`/tasks/projects/${p.id}`}
          className="ml-auto flex shrink-0 items-center gap-1 text-xs text-ink-muted hover:text-ink"
        >
          Open <Icon.chevronRight className="h-3 w-3" />
        </Link>
      </div>
    </Panel>
  );
}

function ProjectTable({ rows }: { rows: ProjectView[] }) {
  const COLS = "grid-cols-[minmax(0,1fr)_120px_90px_100px_80px_80px_96px]";
  return (
    <Panel padded={false} className="overflow-hidden">
      <div
        className={`hidden deck:grid ${COLS} items-center gap-2 border-b border-hairline px-4 py-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase`}
      >
        <span>Project</span>
        <span>Owner</span>
        <span>Health</span>
        <span>Progress</span>
        <span className="text-right">Overdue</span>
        <span className="text-right">Blocked</span>
        <span>Next</span>
      </div>
      <div className="divide-y divide-hairline">
        {rows.map((v) => (
          <Link
            key={v.project.id}
            href={`/tasks/projects/${v.project.id}`}
            className={`grid grid-cols-1 gap-2 px-4 py-2.5 transition-colors hover:bg-[var(--control)] deck:grid ${COLS} deck:items-center`}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-ink">
                {v.project.name}
              </span>
              <span
                data-figure
                className="mt-0.5 block text-[11px] text-ink-faint"
              >
                {v.project.reference} · {v.progress.totalTasks} tasks
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Avatar
                initials={v.owner.initials}
                hue={v.owner.hue}
                name={v.owner.displayName}
                size="sm"
              />
              <span className="truncate text-xs text-ink-muted deck:hidden">
                {v.owner.displayName}
              </span>
            </span>
            <span>
              <Chip
                tone={
                  v.progress.health === "off_track"
                    ? "overdue"
                    : v.progress.health === "at_risk"
                      ? "risk"
                      : "positive"
                }
              >
                {v.progress.health.replace("_", " ")}
              </Chip>
            </span>
            <span>
              <Meter
                value={v.progress.progressPercent}
                label={`${v.project.name} progress`}
              />
              <span
                data-figure
                className="mt-1 block text-[11px] text-ink-faint"
              >
                {v.progress.progressPercent}%
              </span>
            </span>
            <span
              data-figure
              className={`text-right text-sm ${v.progress.overdueTasks ? "text-[var(--state-overdue-ink)]" : "text-ink-faint"}`}
            >
              {v.progress.overdueTasks}
            </span>
            <span
              data-figure
              className={`text-right text-sm ${v.progress.blockedTasks ? "text-[var(--state-blocked-ink)]" : "text-ink-faint"}`}
            >
              {v.progress.blockedTasks}
            </span>
            <span className="text-xs text-ink-muted">
              {formatDate(v.progress.nextDeadline)}
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function Stat({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-ink-faint">{label}</p>
      <p
        data-figure
        className={`mt-0.5 truncate text-sm ${alert ? "text-[var(--state-overdue-ink)]" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}
