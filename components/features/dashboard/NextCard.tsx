"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { InlineError, SkeletonRows } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDate } from "@/lib/utils/format";

/**
 * Card F — "Next", 4 of 12 columns, sitting beneath the score in the right rail.
 *
 * The reference's Insights card is the one surface with an image ground rather
 * than a white card: a pill label, a huge figure, a bold sentence, a smaller
 * one, and pagination for the items behind it. All of that is kept.
 *
 * Its ground here is a controlled Cowork iridescence — the six field hues, laid
 * as fixed radial washes over the measurement slab. Fixed, not drifting: the
 * page's own field is the thing that moves, and a second moving surface would
 * compete with it. This is the third sanctioned use of the field palette
 * outside the background, and the composition puts a dark scrim under every
 * text run so contrast never depends on where a wash happens to land.
 */
export function NextCard() {
  const meetings = useQuery((r) => r.listMeetings(), []);
  const projects = useQuery(
    (r) =>
      r
        .listProjects({ status: ["active", "planning"], sort: "target" })
        .then((p) => p.items),
    [],
  );
  const [index, setIndex] = useState(0);

  type Item = {
    id: string;
    kind: "meeting" | "milestone";
    when: string;
    bigLabel: string;
    title: string;
    detail: string;
    href: string;
    joinHref?: string;
    live?: boolean;
  };

  const items: Item[] = [
    ...(meetings.data ?? [])
      .filter((m) => m.status === "scheduled" || m.status === "live")
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map<Item>((m) => ({
        id: m.id,
        kind: "meeting",
        when: m.startsAt,
        bigLabel: new Date(m.startsAt).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        }),
        title: m.title,
        detail: `${m.participantIds.length} people${m.description ? ` · ${m.description}` : ""}`,
        href: `/meetings/${m.id}`,
        joinHref: m.joinToken ? `/join/${m.joinToken}` : undefined,
        live: m.status === "live",
      })),
    ...(projects.data ?? [])
      .flatMap((v) =>
        v.milestones
          .filter((m) => !m.completedAt)
          .map<Item>((m) => ({
            id: m.id,
            kind: "milestone",
            when: m.targetDate,
            bigLabel: formatDate(m.targetDate),
            title: m.title,
            detail: `${v.project.name} · ${m.taskIds.length} ${m.taskIds.length === 1 ? "task" : "tasks"}`,
            href: `/tasks/projects/${v.project.id}`,
          })),
      )
      .sort((a, b) => a.when.localeCompare(b.when)),
  ].slice(0, 3);

  const loading = meetings.isLoading || projects.isLoading;
  /* An unread list is not an empty one. Without this the card announces
     "Clear — no meetings ahead" when the truth is that it could not find out,
     which is the worst thing a card about the next hour can say. */
  const failure = meetings.error ?? projects.error;
  const item = items[Math.min(index, items.length - 1)];

  return (
    <section
      aria-label="What is next"
      className="relative isolate flex h-full min-h-[190px] flex-col overflow-hidden rounded-card bg-slab"
    >
      {/* The iridescence. Fixed washes from the field palette — the page's own
          field is what drifts; this one holds still so it never competes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: [
            "radial-gradient(78% 90% at 12% 8%, var(--color-field-mauve), transparent 62%)",
            "radial-gradient(70% 80% at 88% 18%, var(--color-field-rose), transparent 60%)",
            "radial-gradient(80% 76% at 78% 92%, var(--color-field-gold), transparent 62%)",
            "radial-gradient(66% 70% at 22% 88%, var(--color-field-slate), transparent 64%)",
          ].join(","),
          opacity: 1,
        }}
      />
      {/* The scrim. Text sits on this, not on the wash — so contrast is a fixed
          quantity rather than a function of where a gradient stop landed. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(10,10,12,0.18) 0%, rgba(10,10,12,0.46) 42%, rgba(10,10,12,0.82) 100%)",
        }}
      />

      <div className="flex flex-1 flex-col px-5 py-4">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          <Icon.clock className="h-3 w-3" />
          Next
        </span>

        {loading ? (
          <div className="mt-4 opacity-60">
            <SkeletonRows rows={3} />
          </div>
        ) : failure ? (
          <div className="mt-auto">
            <InlineError
              onSlab
              message="What is next could not be loaded."
              code={failure}
              onRetry={() => {
                meetings.refetch();
                projects.refetch();
              }}
            />
          </div>
        ) : !item ? (
          <div className="mt-auto">
            <p className="text-[clamp(1.75rem,2.8vw,2.5rem)] leading-none font-light tracking-[-0.035em] text-white">
              Clear
            </p>
            <p className="mt-2 text-sm text-white/80">
              No meetings or milestones ahead of you.
            </p>
          </div>
        ) : (
          <>
            <p
              data-figure
              className="mt-4 text-[clamp(1.75rem,2.6vw,2.25rem)] leading-none font-light tracking-[-0.035em] text-white"
            >
              {item.bigLabel}
            </p>

            <p className="mt-3 text-[17px] leading-tight font-medium tracking-[-0.02em] text-white">
              {item.title}
            </p>
            <p className="mt-1.5 line-clamp-2 text-xs text-white/80">
              {item.detail}
            </p>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
              <Link
                href={item.href}
                className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
              >
                {item.kind === "meeting" ? "Open meeting" : "Open project"}
                <Icon.chevronRight className="h-3 w-3" />
              </Link>
              {item.joinHref && (
                <Link
                  href={item.joinHref}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-[#111] transition-opacity hover:opacity-90"
                >
                  {item.live ? "Join now" : "Join"}
                </Link>
              )}
            </div>
          </>
        )}

        {/* Pagination, exactly the reference's segmented indicator. */}
        {items.length > 1 && (
          <div
            className="mt-4 flex gap-1.5"
            role="tablist"
            aria-label="Upcoming items"
          >
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`${it.title}, ${it.bigLabel}`}
                onClick={() => setIndex(i)}
                className={`h-[3px] flex-1 rounded-full transition-colors ${
                  i === index ? "bg-white" : "bg-white/30 hover:bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
