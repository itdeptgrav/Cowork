"use client";

import Link from "next/link";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { Card } from "./Card";
import { attentionSignals, interventionSignals, type Signal } from "./signals";
import {
  EmptyState,
  InlineError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { Icon, type IconName } from "@/components/ui/Icons";
import { useLens } from "@/components/layout/shell/LensContext";
import { useQuery } from "@/lib/hooks/useRepository";

/**
 * "Needs you" — the triage column.
 *
 * One row per kind of thing that is stuck on this person, ordered by
 * consequence and carrying the verb that clears it. Nothing here is a metric:
 * every row is a queue with a length, and every row leads somewhere that
 * shortens it.
 *
 * The lens changes the question, not the layout. An individual is asked what is
 * waiting on them; a manager is asked where they personally have to step in —
 * which is a different list, computed differently, and not the same rows with
 * the word "team" in front of them.
 */
export function AttentionCard() {
  const { lens } = useLens();
  const team = lens === "team";

  const viewerId = useViewerId();
  const tasks = useQuery(
    (r) =>
      r
        .listTasks({ scope: team ? "team" : "mine", sort: "rank" })
        .then((p) => p.items),
    [team],
  );
  const conflicts = useQuery(
    /* Keyed on `viewerId` — null on first render, so empty deps queried "" and
       never re-ran once the id resolved. */
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
  /**
   * Decisions addressed to this reader by name.
   *
   * A separate read, because `tasks` above is `scope: "mine"` and a task
   * waiting on your approval is not yours: a cross-department task held for
   * your hours estimate is assigned to nobody, created by somebody in another
   * department, and parked against the person you manage. It appeared in no
   * query this card made, so the only trace of it anywhere in the product was
   * a notification — dismiss that and the work was unreachable.
   *
   * `listActionable` is the repository deciding membership, which is the same
   * source the Actionable tab renders. Failure costs this one row and nothing
   * else: the rest of the card is built from its own reads.
   */
  const actionable = useQuery((r) => r.listActionable(), []);

  const loading = tasks.isLoading || conflicts.isLoading || reviews.isLoading;
  /* "Nothing needs you" and "we could not find out" are opposite messages, and
     only one of them lets someone stop looking. */
  const failure = tasks.error ?? conflicts.error ?? reviews.error;

  const signals: Signal[] = loading
    ? []
    : team
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
          approvals: (actionable.data ?? [])
            .filter((i) => i.reason === "approval")
            .map((i) => i.view),
        });

  /* Where "all of this" lives. The personal lens summarises the action inbox,
     so it points there; the team lens summarises other people’s work, which
     the inbox does not hold. */
  const allHref = team ? "/tasks?view=tasks" : "/tasks?view=approvals";

  return (
    <Card
      title={team ? "Where to step in" : "Needs you"}
      padded={false}
      className="min-w-0"
      /* **A way out, not a tally.**

         This read "N urgent", which repeated what the rows already say — they
         are ordered by urgency and the urgent ones carry the state wash on
         their own counts — while occupying the one slot in the header that
         could carry an action. With the list capped, the thing a reader needs
         from this corner is the rest of the list, not a number describing the
         part of it they can already see.

         It replaces the icon-only `CardLink` rather than sitting beside it:
         two controls to one destination is one too many, and a chevron alone
         never said where it went. */
      headerRight={
        <Link
          href={allHref}
          className="flex shrink-0 items-center gap-0.5 rounded-full py-1 pr-1.5 pl-2.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
        >
          View all
          <Icon.chevronRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <div className="px-5">
          <SkeletonRows rows={4} />
        </div>
      ) : failure ? (
        <div className="px-5 pb-1">
          <InlineError
            compact
            message="This list could not be loaded, so it is not safe to read it as empty."
            code={failure}
            onRetry={() => {
              tasks.refetch();
              conflicts.refetch();
              reviews.refetch();
            }}
          />
        </div>
      ) : signals.length === 0 ? (
        <div className="px-5">
          <EmptyState
            compact
            title={team ? "Nothing needs you" : "You are clear"}
            body={
              team
                ? "No blocked work, no approvals and no conflicts waiting on you."
                : "Nothing is blocked, overdue or waiting on a decision from you."
            }
          />
        </div>
      ) : (
        /* **The card ends at its last row.**

           It had a "+N more waiting" strip under the list and stretched to the
           bottom of the column, which put a band of empty card under the strip
           — so the one thing at the foot of the card was a line about rows that
           were not there, floating above space that held nothing either. The
           header's "View all" is the way to the rest and says so in words; a
           second pointer under a list is a footnote to a link.

           So: six rows, then the card stops. What is below it is the field,
           which is not empty in the way an empty card is. */
        <ul className="divide-y divide-hairline">
          {signals.slice(0, VISIBLE_SIGNALS).map((s) => (
            <SignalRow key={s.id} signal={s} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One signal.
 *
 * The whole row is the target — a triage list is read by pointing at the line
 * you mean, not by hunting for a small link at the end of it. Colour appears
 * only on the critical tier, so it stays meaningful when it does.
 */
/**
 * How many rows the card will hold before it stops and points onward.
 *
 * Six. It was four when the card packed to its content and a fifth row pushed
 * the right-hand column past the bottom of the page — a number the layout
 * imposed rather than one anybody chose. The card now takes a fixed share of
 * that column, so this is a judgement about how much triage belongs on a
 * dashboard, and `orderSignals` decides which six survive it.
 */
const VISIBLE_SIGNALS = 6;

/** One named icon, at the size the count it replaces occupies. */
function Glyph({ name }: { name: IconName }) {
  const C = Icon[name];
  return <C className="h-3.5 w-3.5 text-ink-muted" />;
}

function SignalRow({ signal }: { signal: Signal }) {
  const critical = signal.urgency === "critical";

  return (
    <li>
      <Link
        href={signal.href}
        className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--row-hover)]"
      >
        {/* A figure where the row counts something, a glyph where it IS the
            thing. Three message rows each stamped "1" say nothing three
            times, in the column the eye uses to weigh the list. */}
        <span
          data-figure={signal.count === undefined ? undefined : true}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm ${
            critical
              ? "bg-[color-mix(in_srgb,var(--state-overdue)_22%,transparent)] text-[var(--state-overdue-ink)]"
              : "bg-[var(--control)] text-ink"
          }`}
        >
          {signal.count !== undefined ? (
            signal.count
          ) : signal.icon ? (
            <Glyph name={signal.icon} />
          ) : null}
        </span>

        {/* Three lines, answering three questions: what is happening, which
            thing, and why it matters. The middle line used to be the whole
            row's context — a bare title that named the task and explained
            nothing about the cost of ignoring it. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink first-letter:uppercase">
            {signal.title ? (
              <>
                {signal.label}
                <span className="text-ink-muted">: {signal.title}</span>
              </>
            ) : (
              signal.label
            )}
          </span>
          {signal.detail && (
            <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
              {signal.detail}
            </span>
          )}
        </span>

        <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors group-hover:bg-[var(--control)] group-hover:text-ink">
          {signal.action}
        </span>
      </Link>
    </li>
  );
}
