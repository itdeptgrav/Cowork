"use client";

import Link from "next/link";
import { Card } from "./Card";
import { isOpen } from "./signals";
import {
  EmptyState,
  QueryError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useLens } from "@/components/layout/shell/LensContext";
import { useQuery } from "@/lib/hooks/useRepository";
import type { TaskView } from "@/lib/repositories";

/**
 * "Where your work sits" — the reference's Expense split, in Cowork's terms.
 *
 * Its anatomy there: a ring with the total in the middle, and a two-column
 * legend of named parts with their share. The question it answers here is the
 * one a stage funnel used to answer badly — not "how many tasks exist" but
 * "where is my open work stuck", which is a different fact and a shorter read.
 *
 * Every segment is a link into that slice of the task list, so the card is a
 * way in rather than a readout. Colour is the state palette, never a C1–C4 hue:
 * saturated colour in Cowork means "score component" and nothing else.
 */

interface Slice {
  id: string;
  label: string;
  tone: string;
  href: string;
  match: (v: TaskView) => boolean;
}

const SLICES: Slice[] = [
  {
    id: "overdue",
    label: "Overdue",
    tone: "var(--state-overdue)",
    href: "/tasks?view=tasks",
    match: (v) => v.isOverdue,
  },
  {
    id: "blocked",
    label: "Blocked",
    tone: "var(--state-blocked)",
    href: "/tasks?view=tasks",
    match: (v) => !v.isOverdue && v.task.isBlocked,
  },
  {
    id: "review",
    label: "In review",
    tone: "var(--state-extension)",
    href: "/tasks?view=approvals",
    match: (v) =>
      !v.isOverdue && !v.task.isBlocked && v.task.status === "in_review",
  },
  {
    id: "progress",
    label: "In progress",
    tone: "var(--color-ink)",
    href: "/tasks?view=tasks",
    match: (v) =>
      !v.isOverdue && !v.task.isBlocked && v.task.status === "in_progress",
  },
  {
    id: "waiting",
    label: "Not started",
    tone: "var(--state-risk)",
    href: "/tasks?view=tasks",
    match: (v) =>
      !v.isOverdue &&
      !v.task.isBlocked &&
      (v.task.status === "assigned" || v.task.status === "confirmed"),
  },
  {
    id: "pending",
    label: "Awaiting a decision",
    tone: "var(--state-rework)",
    href: "/tasks?view=approvals",
    match: (v) =>
      !v.isOverdue &&
      !v.task.isBlocked &&
      (v.task.status === "pending_approval" ||
        v.task.status === "deadline_negotiation"),
  },
];

const R = 52;
const STROKE = 13;
const C = 2 * Math.PI * R;

export function WorkMix({ className = "" }: { className?: string }) {
  const { lens } = useLens();
  const team = lens === "team";

  const tasks = useQuery(
    (r) =>
      r
        .listTasks({ scope: team ? "team" : "mine", sort: "rank" })
        .then((p) => p.items),
    [team],
  );

  const open = (tasks.data ?? []).filter(isOpen);
  const parts = SLICES.map((s) => ({
    ...s,
    count: open.filter(s.match).length,
  }));
  const total = parts.reduce((n, p) => n + p.count, 0);

  /* Each arc starts where the previous one ended. Reduced rather than
     accumulated through a mutable cursor, which React's rules forbid during
     render — and which would be a bug the first time this list re-ordered. */
  const arcs = parts
    .filter((p) => p.count > 0)
    .reduce<
      {
        id: string;
        label: string;
        tone: string;
        count: number;
        dash: number;
        offset: number;
      }[]
    >((acc, p) => {
      const dash = (p.count / Math.max(1, total)) * C;
      const offset = acc.length
        ? acc[acc.length - 1].offset + acc[acc.length - 1].dash
        : 0;
      return [
        ...acc,
        {
          id: p.id,
          label: p.label,
          tone: p.tone,
          count: p.count,
          dash,
          offset,
        },
      ];
    }, []);

  return (
    <Card
      title={team ? "Where the team's work sits" : "Where your work sits"}
      href="/tasks?view=tasks"
      hrefLabel="Open the task list"
      className={`min-w-0 ${className}`}
    >
      {tasks.error ? (
        <QueryError
          queries={[tasks]}
          message="This breakdown could not be loaded."
        />
      ) : tasks.isLoading ? (
        <SkeletonRows rows={4} />
      ) : total === 0 ? (
        <EmptyState
          compact
          title="Nothing open"
          body="Every task assigned to you is closed."
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
          {/* The ring, with the total in the middle — the reference's own
              device for "this is the whole, and these are its parts". */}
          <div className="relative shrink-0">
            <svg
              viewBox="0 0 130 130"
              className="h-[130px] w-[130px] -rotate-90"
              role="img"
              aria-label={`${total} open, ${arcs.map((a) => `${a.count} ${a.label.toLowerCase()}`).join(", ")}`}
            >
              <circle
                cx="65"
                cy="65"
                r={R}
                fill="none"
                stroke="var(--control-active)"
                strokeWidth={STROKE}
              />
              {arcs.map((a) => (
                <circle
                  key={a.id}
                  cx="65"
                  cy="65"
                  r={R}
                  fill="none"
                  stroke={a.tone}
                  strokeWidth={STROKE}
                  strokeDasharray={`${Math.max(0, a.dash - 2)} ${C}`}
                  strokeDashoffset={-a.offset}
                  strokeLinecap="butt"
                />
              ))}
            </svg>
            <span className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="text-center">
                <span className="block text-[11px] text-ink-faint">Open</span>
                <span
                  data-figure
                  className="block text-[22px] leading-none tracking-[-0.025em] text-ink"
                >
                  {total}
                </span>
              </span>
            </span>
          </div>

          {/* The legend, two columns, as the reference lays it out. */}
          <ul className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2.5">
            {parts
              .filter((p) => p.count > 0)
              .map((p) => (
                <li key={p.id} className="min-w-0">
                  <Link
                    href={p.href}
                    className="group block min-w-0 rounded-inset"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-[3px] shrink-0 rounded-full"
                        style={{ backgroundColor: p.tone }}
                      />
                      <span className="min-w-0 truncate text-[11px] text-ink-faint group-hover:text-ink-muted">
                        {p.label}
                      </span>
                    </span>
                    <span
                      data-figure
                      className="mt-0.5 block text-sm text-ink group-hover:underline group-hover:underline-offset-2"
                    >
                      {p.count}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
