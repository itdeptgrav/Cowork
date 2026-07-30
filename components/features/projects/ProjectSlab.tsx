"use client";

import Link from "next/link";
import { SlabCard } from "@/components/ui/SlabCard";
import { SlabChip } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { formatDate } from "@/lib/utils/format";
import type { ProjectView } from "@/lib/repositories";

/**
 * The project card, taken structurally from `Task_overview.jpeg`.
 *
 * The reference renders a project as a card with a RAISED IDENTITY TAB at its
 * top-left — which is Cowork's own stepped-slab silhouette. My first pass
 * rejected the step here on The Earned Step Rule ("reserved for a person or a
 * score") and lost the reference's whole composition as a result.
 *
 * Resolved by widening the rule rather than ignoring it: the step is earned by
 * an entity that carries BOTH an identity and a measurement. A person and a
 * score qualify; so does a project, which has an owner, a monogram, progress
 * and health. A task list and a settings group still do not. Recorded in
 * docs/architecture/DESIGN.md → Shapes.
 *
 * Region-for-region against the reference:
 *   tab monogram        → project monogram, hue from the owner
 *   title + subtitle    → project name + description
 *   two stacked tags    → status chip + health chip
 *   three stat pairs    → done / open / overdue, each with a real second figure
 *   four vertical bars  → completion / on-time / milestones / unblocked
 *   full-width CTA      → "Show these tasks", linking into the project
 */

/**
 * The reference gives each of the four bars its own saturated hue. Cowork
 * cannot: The Four Channels Rule reserves saturated colour for C1–C4, and four
 * arbitrary hues here would read as score components. Four different neutral
 * opacities were the first attempt and were worse — the variation encoded
 * nothing, so it just made the four bars harder to compare. One tone, four
 * labels, four percentages.
 */
const BAR_TONE = "rgba(255,255,255,0.42)";

export function ProjectSlab({
  view,
  delay = 0,
}: {
  view: ProjectView;
  delay?: number;
}) {
  const { project: p, progress: pr, owner, members } = view;

  const bars = [
    { label: "Completion", value: pr.progressPercent },
    {
      label: "On time",
      value: pr.totalTasks
        ? Math.round(((pr.totalTasks - pr.overdueTasks) / pr.totalTasks) * 100)
        : 100,
    },
    {
      label: "Milestones",
      value: pr.totalMilestones
        ? Math.round((pr.completedMilestones / pr.totalMilestones) * 100)
        : 0,
    },
    {
      label: "Unblocked",
      value: pr.totalTasks
        ? Math.round(((pr.totalTasks - pr.blockedTasks) / pr.totalTasks) * 100)
        : 100,
    },
  ];

  const monogram = p.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <SlabCard
      size="compact"
      className="rise"
      style={{ "--delay": `${delay}ms` } as React.CSSProperties}
      tab={
        <span
          className="inline-grid h-10 w-10 place-items-center rounded-full text-xs font-medium text-slab-ink ring-1 ring-white/20"
          style={{ background: "rgba(255,255,255,0.10)" }}
          role="img"
          aria-label={`${p.name} project`}
        >
          {monogram}
        </span>
      }
    >
      <div className="px-5 pt-5 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/tasks/projects/${p.id}`}
              className="block truncate text-lg leading-tight font-[350] tracking-[-0.02em] text-slab-ink"
            >
              {p.name}
            </Link>
            <p className="mt-1 line-clamp-2 text-xs text-slab-ink-muted">
              {p.description ?? owner.displayName}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <SlabChip>{p.status.replace(/_/g, " ")}</SlabChip>
            <SlabChip>{pr.health.replace("_", " ")}</SlabChip>
          </div>
        </div>

        {/* Three stat pairs, "N of M" exactly as the reference states them. */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <SlabStat
            label="Done"
            value={String(pr.completedTasks)}
            suffix={`of ${pr.totalTasks}`}
          />
          <SlabStat
            label="Open"
            value={String(pr.openTasks)}
            suffix={
              pr.inReviewTasks > 0
                ? `${pr.inReviewTasks} in review`
                : "none in review"
            }
          />
          <SlabStat
            label="Overdue"
            value={String(pr.overdueTasks)}
            suffix={`${pr.blockedTasks} blocked`}
          />
        </div>

        {/* Four vertical bars on a shared baseline — the reference's mini chart.
            Neutral fills, never a C1–C4 hue: The Four Channels Rule means
            saturated colour is score-component vocabulary and nothing else. */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {bars.map((b) => (
            <div key={b.label} className="min-w-0">
              <div className="flex h-14 items-end rounded-inset bg-white/[0.045] p-1">
                <span
                  className="band-fill w-full rounded-[10px]"
                  style={{
                    height: `${Math.max(6, b.value)}%`,
                    backgroundColor: BAR_TONE,
                  }}
                />
              </div>
              <p className="mt-1.5 truncate text-[11px] text-slab-ink-muted">
                {b.label}
              </p>
              <p data-figure className="text-sm leading-none text-slab-ink">
                {b.value}%
              </p>
            </div>
          ))}
        </div>

        {/* Full-width CTA, as in the reference. */}
        <Link
          href={`/tasks/projects/${p.id}`}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full bg-white/10 py-2.5 text-sm font-medium text-slab-ink transition-colors hover:bg-white/[0.16]"
        >
          Show these tasks
          <Icon.chevronRight className="h-3.5 w-3.5" />
        </Link>

        <p className="mt-2.5 flex items-center gap-2 text-[11px] text-slab-ink-muted">
          <Icon.team className="h-3.5 w-3.5" />
          <span className="truncate">
            {members.length} member{members.length === 1 ? "" : "s"}
            {pr.nextDeadline && ` · next ${formatDate(pr.nextDeadline)}`}
          </span>
        </p>
      </div>
    </SlabCard>
  );
}

function SlabStat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-slab-ink-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span
          data-figure
          className="text-lg leading-none tracking-[-0.025em] text-slab-ink"
        >
          {value}
        </span>
        {suffix && (
          <span
            data-figure
            className="truncate text-[11px] text-slab-ink-muted"
          >
            {suffix}
          </span>
        )}
      </p>
    </div>
  );
}
