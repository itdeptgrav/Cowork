"use client";

import Link from "next/link";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { Icon } from "@/components/ui/Icons";
import { useLens } from "@/components/layout/shell/LensContext";
import { useQuery } from "@/lib/hooks/useRepository";
import { attentionSignals, interventionSignals, isOpen } from "./signals";
import { ScopePills } from "./ScopePills";

/**
 * The title row, from the `dashboard` reference.
 *
 * There it is: a display-scale page title far left with a small circular
 * affordance beside it, and a right-hand control cluster of pill controls —
 * two date pickers, a granularity select, and `Add widget`.
 *
 * Cowork's cluster carries what it actually has: the lens (which is a privacy
 * boundary, not a filter, so it keeps its labelled segmented control), the
 * date, and a primary action. There is no widget system to add to, and a
 * date-range picker over a fixed prototype clock would be a control that
 * cannot do anything — so the date reads as a fact rather than a filter.
 *
 * Under the title sits the BRIEF: one sentence naming the situation. It is the
 * first thing read and often the only thing needed — the five-second answer,
 * before anyone has looked at a single card.
 */
export function DashboardChrome() {
  const { lens } = useLens();
  const team = lens === "team";

  const viewerId = useViewerId();
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const viewer = useQuery((r) => r.getViewer(), []);
  const people = useQuery((r) => r.listEmployees(), []);
  const reports = (people.data ?? []).filter((e) =>
    viewer.data?.hierarchyIds.includes(e.id),
  );

  /* The brief's inputs. Same derivations the cards use, so the sentence at the
     top and the rows underneath can never disagree with each other. */
  const tasks = useQuery(
    (r) =>
      r
        .listTasks({ scope: team ? "team" : "mine", sort: "rank" })
        .then((p) => p.items),
    [team],
  );
  const conflicts = useQuery(
    /* Keyed on `viewerId`; empty deps captured the first-render null. */
    (r) => r.listPriorityConflicts(viewerId ?? ""),
    [viewerId],
  );
  const reviews = useQuery((r) => r.listReviewQueue(), []);
  const projects = useQuery(
    (r) =>
      r
        .listProjects({ status: ["active", "planning"], sort: "health" })
        .then((p) => p.items),
    [],
  );
  const notifications = useQuery((r) => r.listNotifications(), []);
  const meetings = useQuery((r) => r.listMeetings(), []);
  const active = useQuery((r) => r.getActiveTimer(), []);

  const date = new Date(Date.UTC(2026, 6, 25)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });

  const signals = team
    ? interventionSignals({
        viewerId: viewerId ?? "",
        tasks: tasks.data ?? [],
        reviewQueue: reviews.data ?? [],
        conflicts: conflicts.data ?? [],
      })
    : attentionSignals({
        viewerId: viewerId ?? "",
        tasks: tasks.data ?? [],
        conflicts: conflicts.data ?? [],
        reviewQueue: reviews.data ?? [],
        projects: projects.data ?? [],
        notifications: notifications.data ?? [],
      });

  const brief = briefOf({
    team,
    loading: tasks.isLoading,
    failed: !!(tasks.error ?? conflicts.error ?? reviews.error),
    urgent: signals.filter((s) => s.urgency === "critical"),
    waiting: signals.reduce(
      (n, s) => n + (s.urgency === "steady" ? 0 : s.count),
      0,
    ),
    open: (tasks.data ?? []).filter(isOpen).length,
    running: active.data?.taskTitle ?? null,
    nextMeeting:
      (meetings.data ?? [])
        .filter((m) => m.status === "scheduled" || m.status === "live")
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null,
  });

  return (
    /* The reference's header: a display title with the date directly beneath
       it on the left, and a row of pills on the right. Cowork adds one line —
       the brief — because a command centre that states the situation in words
       is read faster than one that makes you assemble it from four counts. */
    <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-[clamp(1.75rem,3.4vw,2.75rem)] leading-none font-light tracking-[-0.035em] text-ink">
          {team ? "Your team" : "Overview"}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {date}
          {!team && me.data ? ` · ${me.data.displayName}` : ""}
          {team
            ? ` · ${reports.length} ${reports.length === 1 ? "report" : "reports"}`
            : ""}
        </p>
        <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-ink-muted">
          {brief}
        </p>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <ScopePills />
        <Link
          href="/tasks/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-xs font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
        >
          <Icon.plus className="h-3.5 w-3.5" />
          New task
        </Link>
      </div>
    </div>
  );
}

/**
 * The situation, in one sentence.
 *
 * Written rather than templated from counts alone: "3 items need attention" is
 * a number a person still has to interpret, while "1 task is overdue and 2
 * decisions are waiting on you" is the interpretation. The order is the order
 * of consequence, and when nothing is wrong it says so plainly instead of
 * reaching for something to report.
 */
function briefOf({
  team,
  loading,
  failed,
  urgent,
  waiting,
  open,
  running,
  nextMeeting,
}: {
  team: boolean;
  loading: boolean;
  failed: boolean;
  urgent: { label: string; count: number }[];
  waiting: number;
  open: number;
  running: string | null;
  nextMeeting: { title: string; startsAt: string } | null;
}): string {
  if (loading) return "Reading your work…";
  /* Silence about a failure reads exactly like calm, and this line is the one
     someone trusts enough not to check the cards. */
  if (failed)
    return "Some of your work could not be loaded — the cards below say which.";

  const parts: string[] = [];

  if (urgent.length) {
    parts.push(
      urgent
        .slice(0, 2)
        .map((u) => `${u.count} ${u.label}`)
        .join(" and "),
    );
  } else if (waiting > 0) {
    parts.push(
      team
        ? `${waiting} thing${waiting === 1 ? "" : "s"} waiting on you`
        : `${waiting} thing${waiting === 1 ? "" : "s"} waiting on you`,
    );
  }

  if (!team && running) parts.push(`you are timing “${running}”`);

  if (nextMeeting) {
    const at = new Date(nextMeeting.startsAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
    parts.push(`${nextMeeting.title} at ${at}`);
  }

  if (!parts.length) {
    return team
      ? `Nothing is blocked or overdue across ${open} open task${open === 1 ? "" : "s"}. A good day to look further ahead.`
      : `Nothing is waiting on you across ${open} open task${open === 1 ? "" : "s"}. A good day to get ahead.`;
  }

  const sentence = parts.join(" · ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}
