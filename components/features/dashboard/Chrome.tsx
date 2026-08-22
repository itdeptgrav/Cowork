"use client";

import { useViewerId } from "@/lib/hooks/usePermissions";
import { useLens } from "@/components/layout/shell/LensContext";
import { useQuery } from "@/lib/hooks/useRepository";
import { useNow } from "@/lib/hooks/useNow";
import { attentionSignals, interventionSignals, isOpen } from "./signals";

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
  /* Ticks once a minute, from the shared clock — never `Date.now()` in render,
     which is impure and makes the first paint disagree with the server's. */
  const now = useNow();
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
      (n, s) => n + (s.urgency === "steady" ? 0 : (s.count ?? 1)),
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
    /* A GRID, not two stacks side by side.
       Two stacks each lay out from their own top, so the time landed level with
       the brief and the date level with the title — near-misses that read as
       sloppiness rather than as a decision. Sharing rows is what puts the clock
       on the title's line and the date on the name's, and `items-baseline`
       aligns them on the letters rather than on the boxes, which is what the eye
       reads when two type sizes sit side by side.

       The corner used to hold a pill row — Overdue / In review / Blocked / All
       open — over the same counts "Where your work sits" was already breaking
       down further down the page. Those moved into that card; the clock is what
       the corner says now, and nothing else on the page says it. */
    <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-8">
      {/* Row 1 — the situation, across the full width. It leads because it is
          the five-second answer; the title says where you are, which you knew,
          having navigated here. */}
      <p className="col-span-2 max-w-[62ch] text-sm leading-relaxed text-ink-muted">
        {brief}
      </p>

      {/* Row 2 — the page, and the time. Time outranks the date in size because
          it is the one of the two that changes while you are looking at it.
          Tabular, like every figure in the product: a clock on proportional
          digits jogs sideways every minute. */}
      <h1 className="mt-1.5 text-[clamp(1.75rem,3.4vw,2.75rem)] leading-none font-light tracking-[-0.035em] text-ink">
        {team ? "Your team" : "Overview"}
      </h1>
      <p
        data-figure
        className="mt-1.5 text-right text-[22px] leading-none tracking-[-0.025em] text-ink"
      >
        {/* Resolved after mount, so the server's clock and the reader's never
            disagree on first paint. */}
        {now ? clockOf(now) : " "}
      </p>

      {/* Row 3 — who is reading it, and the date. Tight to the title above: a
          name is a caption on it, not a separate line of information. */}
      <p className="mt-1 text-sm text-ink-muted">
        {team
          ? `${reports.length} ${reports.length === 1 ? "report" : "reports"}`
          : (me.data?.displayName ?? "")}
      </p>
      <p className="mt-1 text-right text-sm text-ink-muted">{date}</p>
    </div>
  );
}

/**
 * The wall clock, twelve-hour with a lower-case meridiem.
 *
 * `hour12` is set explicitly rather than left to the locale: `en-GB` is a
 * 24-hour locale, so the surrounding `en-GB` formatting used elsewhere in this
 * file would render 14:47 and the flag is what makes it 2:47 pm. The zone is
 * the organisation's, matching the date beside it — a local time over an IST
 * date would be two different days' worth of confusion in one corner.
 */
function clockOf(now: Date): string {
  return now
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    })
    .toLowerCase();
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
  urgent: { label: string; count?: number; pluralLabel?: string }[];
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
    /* **Grouped by label before it is counted.**

       The urgent rows became one-per-task rather than one-per-kind, so two
       approvals now arrive as two rows carrying the same words — and this read
       them straight out, producing "1 task waiting on your approval and 1 task
       waiting on your approval". The card is right to list them separately,
       because each is a different task for a different person; a one-line
       brief is right to add them up. `pluralLabel` is what lets the sum say
       "2 tasks" rather than "2 task". */
    const byLabel = new Map<string, { n: number; one: string; many: string }>();
    for (const u of urgent) {
      const at = byLabel.get(u.label);
      if (at) at.n += u.count ?? 1;
      else
        byLabel.set(u.label, {
          n: u.count ?? 1,
          one: u.label,
          many: u.pluralLabel ?? u.label,
        });
    }
    parts.push(
      [...byLabel.values()]
        .slice(0, 2)
        .map((u) => `${u.n} ${u.n === 1 ? u.one : u.many}`)
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
