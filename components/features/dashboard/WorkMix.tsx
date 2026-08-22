"use client";

import Link from "next/link";
import { Card, CardLink, CardTitle } from "./Card";
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
  /**
   * Shown even at zero.
   *
   * The three problem states only. "Overdue 0" is worth a row — it is the
   * reassurance the header pills used to give, and their absence is what a
   * reader would otherwise have to notice and interpret. The ordinary states
   * appear when they have something in them, as before: a row of six with four
   * zeros in it is a worse read than a row of two.
   */
  always?: boolean;
}

const SLICES: Slice[] = [
  {
    id: "overdue",
    label: "Overdue",
    tone: "var(--state-overdue)",
    href: "/tasks?view=tasks",
    match: (v) => v.isOverdue,
    always: true,
  },
  {
    id: "blocked",
    label: "Blocked",
    tone: "var(--state-blocked)",
    href: "/tasks?view=tasks",
    match: (v) => !v.isOverdue && v.task.isBlocked,
    always: true,
  },
  {
    id: "review",
    label: "In review",
    tone: "var(--state-extension)",
    href: "/tasks?view=approvals",
    match: (v) =>
      !v.isOverdue && !v.task.isBlocked && v.task.status === "in_review",
    always: true,
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

  /* Which rows appear: everything with something in it, plus the three problem
     states whether or not they do. */
  const shown = parts.filter((p) => p.count > 0 || p.always);
  /* The filled row is whichever of the problem states is actually a problem
     today — the treatment the header pills carried, kept because it is the one
     thing on this card that survives a glance. Nothing is filled when nothing
     is wrong; a permanently highlighted row stops meaning anything. */
  const leadId =
    shown.find((p) => p.id === "overdue" && p.count > 0)?.id ??
    shown.find((p) => p.id === "blocked" && p.count > 0)?.id ??
    shown.find((p) => p.id === "review" && p.count > 0)?.id ??
    null;

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

  const title = team ? "Where the team's work sits" : "Where your work sits";

  return (
    /* `bare`: the heading moves inside, beside the ring — see the note on the
       layout below. The card keeps `title` as its accessible name either way,
       and the loading, error and empty states render their own header, because
       those have no ring to sit beside. */
    <Card
      title={title}
      bare={total > 0 && !tasks.error && !tasks.isLoading}
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
        /**
         * The heading sits in the COLUMN, not across the top.
         *
         * A full-width title bar over a card whose content is one tall circle
         * put the ring in the bottom-left and left a band of empty card above
         * the pills — the biggest area on the card, holding nothing. Moving the
         * heading beside the ring, directly over the row it labels, gives the
         * ring the card's whole height and gives the pills something to hang
         * from. `items-start` rather than `items-center`, because the heading is
         * now the thing the top edge aligns to.
         */
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          {/* The ring, with the total in the middle — the reference's own
              device for "this is the whole, and these are its parts". */}
          <div className="relative shrink-0">
            <svg
              viewBox="0 0 130 130"
              className="h-[164px] w-[164px] -rotate-90"
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
            {/* The centre figure grows with the ring rather than staying at the
                size it was: a 130px hole that now measures 164 would otherwise
                have made the number look like it had shrunk. */}
            <span className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="text-center">
                <span className="block text-[12px] text-ink-faint">Open</span>
                <span
                  data-figure
                  className="block text-[28px] leading-none tracking-[-0.03em] text-ink"
                >
                  {total}
                </span>
              </span>
            </span>
          </div>

          {/* The legend IS the filter row.
              These used to be two things: a plain two-column legend here, and a
              pill row of Overdue / In review / Blocked / All open beside the
              page title. They were the same counts over the same query — the
              header's set was a strict subset of this one, with the ring's
              centre figure standing in for "All open" — so a reader comparing
              them was checking whether two readouts of one fact agreed. One
              row, carrying both jobs: it names the parts of the ring AND jumps
              into that slice of the list. The dot keeps each row tied to its
              arc, which a bare pill would have thrown away. */}
          <div className="flex min-w-0 flex-1 flex-col self-stretch">
            {/* The card's own heading, and the way out, on one line over the
                row they describe. It keeps the top edge — level with the link,
                which belongs in the corner wherever the heading goes. */}
            <div className="flex shrink-0 items-center gap-3">
              <CardTitle>{title}</CardTitle>
              <div className="ml-auto">
                <CardLink
                  href="/tasks?view=tasks"
                  label="Open the task list"
                />
              </div>
            </div>

            {/* The pills take the rest of the column and sit in the middle of
                it. Hanging them straight under the heading left the bottom
                third of the card empty beside a full-height ring — the same
                hole this rearrangement set out to close, moved down rather than
                filled. Centred, the space reads as the row's own margin. */}
            <ul className="flex min-w-0 flex-1 flex-wrap content-center items-center gap-1.5 pt-3">
            {shown.map((p) => {
              const lead = p.id === leadId;
              return (
                <li key={p.id} className="min-w-0">
                  <Link
                    href={p.href}
                    className={`inline-flex items-center gap-2 rounded-full py-1.5 pr-3 pl-2.5 text-xs font-medium transition-colors ${
                      lead
                        ? "bg-ink text-[var(--body-bg)]"
                        : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-[3px] shrink-0 rounded-full"
                      style={{ backgroundColor: p.tone }}
                    />
                    <span className="min-w-0 truncate">{p.label}</span>
                    <span
                      data-figure
                      className={lead ? "opacity-80" : "text-ink-faint"}
                    >
                      {p.count}
                    </span>
                  </Link>
                </li>
              );
            })}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
