import type { TaskView } from "@/lib/repositories";
import type { ProjectView } from "@/lib/repositories";
import type { Employee, Notification } from "@/lib/domain";
import { nextAction } from "@/components/features/tasks/statusMeta";
import {
  notificationHref,
  notificationTarget,
} from "@/lib/rules/notifications/target";
import type { IconName } from "@/components/ui/Icons";

/**
 * What the dashboard knows, separated from how it is drawn.
 *
 * The dashboard's job is not to display the database — it is to reach a
 * conclusion about it. Every card below is a rendering of one of these
 * derivations, and keeping them here means the conclusions can be read,
 * argued with and changed in one place rather than being spread through JSX.
 *
 * Two rules hold throughout:
 *
 *   · Nothing is surfaced unless someone can act on it. A count that leads to
 *     no decision belongs on the page that owns the subject, not here.
 *   · Order is by consequence, not by category. An overdue task outranks a
 *     tidy queue of five approvals, every time.
 */

export type Urgency = "critical" | "attention" | "steady";

export interface Signal {
  id: string;
  /**
   * What it is, in the reader's language, written to follow its own count and
   * agreeing with it: "1 task overdue", "3 decisions on you". Sentence case is
   * applied where a row needs it, so the same string also reads correctly
   * inside the brief at the top of the page.
   */
  label: string;
  /**
   * How many. Rendered as a figure, so it must be a real count.
   *
   * **Absent where the row IS one thing.** A message row is a single message
   * — stamping "1" on three of them in a column says nothing three times and
   * reads as a quantity the reader has to check. Those rows carry an `icon`
   * instead.
   */
  count?: number;
  /** Shown in place of the count. Only meaningful where `count` is absent. */
  icon?: IconName;
  /**
   * The label to use when several rows of this kind are summarised together.
   *
   * The brief at the top of the page groups the urgent rows by label and sums
   * them, so a kind that can appear more than once needs its plural or the
   * sentence reads "2 task waiting on your approval".
   */
  pluralLabel?: string;
  /** The verb that resolves it. */
  action: string;
  href: string;
  urgency: Urgency;
  /** The thing itself — the task or project the row is about. */
  title?: string;
  /** Why it matters: how long, what it blocks, who is waiting. */
  detail?: string;
}

/**
 * The order the card reads its rows in.
 *
 * Until now this was whatever order the pushes below happened to run in — which
 * was ROUGHLY right and guaranteed nothing: a signal added in the wrong place
 * would have sorted itself wherever its `out.push` landed, and the card would
 * have shown it there without complaint. With the list capped, ordering decides
 * what is SEEN, so it is written down rather than left to the sequence of
 * statements in a function.
 *
 * Three bands:
 *
 *   0. **Urgent.** Work that is stopped, late, or blocked on a decision from
 *      you. Somebody is waiting on the other side of every one of these.
 *   1. **Unread notifications.** Ranked above the softer work rows on purpose:
 *      notifications are how everything else on this list first reached you,
 *      so a card that pushes them below its own long tail can bury the news of
 *      the next urgent thing behind the last un-urgent one.
 *   2. Everything else, by urgency.
 *
 * The sort is stable, so rows within a band keep the order they were built in
 * — which is the order the pushes express and which is deliberate: conflicts
 * before approvals before overdue.
 */
/** How many recent messages the card shows in place of an unread count. */
const RECENT_MESSAGES = 3;

const BAND: Record<Urgency, number> = { critical: 0, attention: 2, steady: 3 };

export function orderSignals(signals: Signal[]): Signal[] {
  const band = (s: Signal) =>
    s.urgency === "critical" ? 0 : s.id.startsWith("unread") ? 1 : BAND[s.urgency];
  return [...signals].sort((a, b) => band(a) - band(b));
}

/* No module-level viewer. This was `const viewerId = "e-01"` — the seeded id —
   so every signal on the dashboard, and the whole "your move" queue, answered
   for one person no matter who was signed in. The viewer is now a parameter,
   which means the compiler finds every caller that has to supply it. */

/* ── Why a row matters ────────────────────────────────────────────────────── */

/** "3 days", "1 day", "today" — how long something has been sitting. */
function elapsed(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The consequence line under a signal.
 *
 * Every clause is read off the view — nothing is estimated. A row said what was
 * happening and never why it mattered: "Submission waiting on your review /
 * Empty-state copy pass" is a title, not a reason to act. This assembles the
 * three facts a person needs to triage — how long it has been waiting, what it
 * holds up, and who is on the other end — and omits any clause whose data is
 * absent rather than inventing a placeholder.
 */
function consequence(
  v: TaskView,
  opts: { waitingSince?: string | null; verb?: string } = {},
): string | undefined {
  const clauses: string[] = [];

  const age = elapsed(opts.waitingSince);
  if (age)
    clauses.push(
      age === "today"
        ? `${opts.verb ?? "Waiting"} today`
        : `${opts.verb ?? "Waiting"} ${age}`,
    );

  /* What it holds up. A project is the strongest claim; failing that, subtasks
     that cannot proceed are the next most concrete. */
  if (v.project) clauses.push(`blocks ${v.project.name}`);
  else if (v.subtaskCount > 0)
    clauses.push(
      v.subtaskCount === 1
        ? "holds 1 subtask"
        : `holds ${v.subtaskCount} subtasks`,
    );

  /* Who is on the other end — the person to talk to if it stalls. */
  if (v.owner) clauses.push(`from ${v.owner.displayName}`);

  return clauses.length ? clauses.join(" · ") : undefined;
}

/** How far past its scored deadline, for the overdue row. */
function overdueBy(v: TaskView): string | undefined {
  const due = v.task.deadline.officialDueAt ?? v.task.deadline.dueAt;
  const age = elapsed(due);
  if (!age) return undefined;
  const rest = consequence(v);
  return [age === "today" ? "Due today" : `${age} late`, rest]
    .filter(Boolean)
    .join(" · ");
}

/* ── What needs a person now ─────────────────────────────────────────────── */

export function attentionSignals({
  viewerId,
  tasks,
  conflicts,
  reviewQueue,
  projects,
  notifications,
  approvals = [],
}: {
  viewerId: string;
  tasks: TaskView[];
  conflicts: { rank: number }[];
  reviewQueue: TaskView[];
  projects: ProjectView[];
  notifications: Notification[];
  /**
   * Tasks whose next decision is addressed to this reader BY NAME.
   *
   * Supplied separately because it cannot be derived from `tasks`. That list
   * is `scope: "mine"` — work assigned to or pending for the viewer — and a
   * task waiting on your approval is by definition somebody ELSE’s: on the
   * cross-department path it is not assigned to you, not created by you, and
   * parked against the person you manage. It was therefore in no list this
   * card read, and the card could not have known it existed.
   *
   * The caller passes what `listActionable` returns, which is the repository
   * deciding membership — the same source the Actionable tab renders, so the
   * two cannot drift.
   */
  approvals?: TaskView[];
}): Signal[] {
  const open = tasks.filter((v) => isOpen(v));
  const overdue = open.filter((v) => v.isOverdue);
  const blocked = open.filter((v) => v.task.isBlocked);
  const mine = open.filter((v) => nextAction(v, viewerId).actor === "you");

  const decisions = mine.filter((v) => {
    const label = nextAction(v, viewerId).label;
    return (
      label === "Decide deadline" ||
      label === "Respond to counter" ||
      label === "Propose a deadline" ||
      label === "Approve or reject"
    );
  });
  const confirmations = mine.filter(
    (v) => nextAction(v, viewerId).label === "Confirm receipt",
  );
  const atRiskProjects = projects.filter(
    (p) => p.progress.health !== "on_track",
  );
  const unread = notifications.filter((n) => !n.readAt);
  /* Deduped against `decisions`, which can name the same task where the
     viewer is both its assignee and its approver — two rows for one
     obligation reads as two obligations. */
  const decidedIds = new Set(decisions.map((v) => v.task.id));
  const pendingApprovals = approvals.filter((v) => !decidedIds.has(v.task.id));

  const out: Signal[] = [];

  if (conflicts.length)
    out.push({
      id: "conflict",
      label:
        conflicts.length === 1 ? "priority conflict" : "priority conflicts",
      count: conflicts.length,
      detail: `Two tasks hold P${conflicts[0].rank}`,
      action: "Resolve",
      href: "/tasks?view=tasks",
      urgency: "critical",
    });

  /* Before overdue, and critical, because it is the only row here where
     somebody ELSE is stopped. Your own overdue task is late; a task waiting
     on your hours estimate has not reached the person it is for at all — they
     cannot see it, start it or ask about it, and nothing about their day says
     it is coming. */
  /* **One row per task, never a group.** These were rolled into a single row
     carrying a count and the FIRST task’s title, which made the others
     unnameable: two decisions on two different people’s work read as "2
     tasks waiting on your approval: embroidery", and the second task — a
     different task, for a different person, from a different sender — was
     invisible behind the number. A count is the right shape for "4 tasks
     overdue", which is one condition holding of four things; it is the wrong
     shape for a decision, because each one is a separate act with a separate
     person waiting on the other side of it. */
  for (const v of pendingApprovals)
    out.push({
      id: `approval:${v.task.id}`,
      label: "task waiting on your approval",
      pluralLabel: "tasks waiting on your approval",
      count: 1,
      title: v.task.title,
      detail: waitingOnYou(v),
      action: "Open",
      href: `/tasks/${v.task.id}`,
      urgency: "critical",
    });

  if (overdue.length)
    out.push({
      id: "overdue",
      label: overdue.length === 1 ? "task overdue" : "tasks overdue",
      count: overdue.length,
      title: overdue[0].task.title,
      detail: overdueBy(overdue[0]),
      action: "Open",
      href: `/tasks/${overdue[0].task.id}`,
      urgency: "critical",
    });

  if (blocked.length)
    out.push({
      id: "blocked",
      label: blocked.length === 1 ? "task blocked" : "tasks blocked",
      count: blocked.length,
      title: blocked[0].task.title,
      detail: [blocked[0].task.blockedReason, consequence(blocked[0])]
        .filter(Boolean)
        .join(" · "),
      action: "Open",
      href: `/tasks/${blocked[0].task.id}`,
      urgency: "critical",
    });

  if (reviewQueue.length)
    out.push({
      id: "review",
      label:
        reviewQueue.length === 1
          ? "submission waiting on your review"
          : "submissions waiting on your review",
      count: reviewQueue.length,
      title: reviewQueue[0].task.title,
      detail: consequence(reviewQueue[0], {
        waitingSince: reviewQueue[0].latestSubmission?.submittedAt,
      }),
      action: "Review",
      href: `/tasks/${reviewQueue[0].task.id}/review`,
      urgency: "attention",
    });

  if (decisions.length)
    out.push({
      id: "decide",
      label: decisions.length === 1 ? "decision on you" : "decisions on you",
      count: decisions.length,
      title: decisions[0].task.title,
      detail: consequence(decisions[0], {
        waitingSince: decisions[0].task.updatedAt,
        verb: "Pending",
      }),
      action: "Decide",
      href: nextAction(decisions[0], viewerId).href ?? "/tasks?view=tasks",
      urgency: "attention",
    });

  if (confirmations.length)
    out.push({
      id: "confirm",
      label:
        confirmations.length === 1
          ? "assignment to confirm"
          : "assignments to confirm",
      count: confirmations.length,
      title: confirmations[0].task.title,
      detail: consequence(confirmations[0], {
        waitingSince: confirmations[0].task.updatedAt,
      }),
      action: "Confirm",
      href: `/tasks/${confirmations[0].task.id}`,
      urgency: "attention",
    });

  if (atRiskProjects.length)
    out.push({
      id: "project",
      label:
        atRiskProjects.length === 1 ? "Project at risk" : "Projects at risk",
      count: atRiskProjects.length,
      detail: atRiskProjects[0].project.name,
      action: "Open",
      href: `/tasks/projects/${atRiskProjects[0].project.id}`,
      urgency: "attention",
    });

  /* **The three most recent, not a tally of fifty.**

     "50 unread notifications" is a number you can do nothing with: it names a
     backlog rather than anything in it, and the one thing a reader wants from
     this row — what the newest one SAYS — was the one thing it withheld. The
     total has not been lost; the bell in the shell still carries it, which is
     where a count belongs.

     `listNotifications` is ordered `createdAt desc`, so the head of this list
     is genuinely the most recent — no sort here, and none should be added: a
     second opinion about recency is how two surfaces come to disagree about
     which message is newest. */
  for (const n of unread.slice(0, RECENT_MESSAGES))
    out.push({
      id: `unread:${n.id}`,
      label: n.title,
      detail: n.body,
      icon: "chat",
      action: "Open",
      /* Where the message is ABOUT, falling back to the notification list.
         `notificationHref` answers null where it does not know, rather than
         guessing a route that would 404 — and a 404 reads as "the record is
         gone" rather than "we never knew where it was". */
      href:
        notificationHref(notificationTarget(n.type, n.data)) ?? "/notifications",
      urgency: "steady",
    });

  return orderSignals(out);
}

/**
 * Who is stopped by a decision sitting with you.
 *
 * Named rather than counted: "Krishna Behera cannot start until you do" is a
 * consequence somebody acts on, where "1 approval" is a statistic. On a
 * budget-gated task the person is in `pendingAssignees` and not `assignees` —
 * that is the whole state: they have not been given the work yet.
 *
 * **One task, because the row is now one task.** These were briefly rolled into
 * a single counted row, and the sentence then described the first decision
 * while the figure beside it counted several — so a task that was present read
 * as missing, because nothing on screen named it. Both ends are named here:
 * who is held up, and who sent it, because a decision row is about work moving
 * between two people and naming one leaves the reader guessing which.
 */
function waitingOnYou(v: TaskView): string {
  const who = v.pendingAssignees[0] ?? v.assignees[0] ?? null;
  const from = v.owner?.displayName ?? null;
  if (!who) return from ? `From ${from}` : "Nobody can start it until you do";
  /* Both ends of the handover, because a decision row is about a task moving
     between two people and naming only one leaves the reader guessing which. */
  return from
    ? `${who.displayName} cannot start until you do · from ${from}`
    : `${who.displayName} cannot start until you do`;
}

/* ── What to work on ─────────────────────────────────────────────────────── */

/**
 * The queue, in the order a person should actually take it.
 *
 * Overdue first, then blocked — a blocked task is not work, it is a
 * conversation, and it stays visible until someone has it. Then whatever is
 * genuinely startable, ranked by the person's own priority, then by deadline.
 */
export function workQueue(tasks: TaskView[], viewerId: string): TaskView[] {
  return tasks
    .filter(isOpen)
    .filter((v) => nextAction(v, viewerId).actor === "you")
    .sort(
      (a, b) => weight(a) - weight(b) || rank(a) - rank(b) || due(a) - due(b),
    );
}

function weight(v: TaskView): number {
  if (v.isOverdue) return 0;
  if (v.task.isBlocked) return 1;
  if (v.task.status === "in_progress") return 2;
  return 3;
}
function rank(v: TaskView): number {
  return v.myRank ?? 99;
}
function due(v: TaskView): number {
  return v.task.deadline.dueAt ? Date.parse(v.task.deadline.dueAt) : Infinity;
}

export function isOpen(v: TaskView): boolean {
  return (
    v.task.status !== "completed" &&
    v.task.status !== "cancelled" &&
    v.task.status !== "assignment_rejected"
  );
}

/* ── How a period is going ───────────────────────────────────────────────── */

export type Health = "healthy" | "watch" | "at_risk";

export function healthOf(percentage: number, delta: number): Health {
  if (percentage < 60 || delta <= -10) return "at_risk";
  if (percentage < 80 || delta < 0) return "watch";
  return "healthy";
}

export const HEALTH_LABEL: Record<Health, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
};

/**
 * The one thing worth saying about a score on a dashboard.
 *
 * `/score` exists to decompose the figure; repeating that decomposition here
 * was the duplication this dashboard had. What belongs here is the sentence a
 * person would want if they only had one: which channel is doing the damage,
 * or that nothing is.
 */
/**
 * The same judgement in a handful of words, for a card that has one line.
 *
 * Not a truncation of the sentence: a clause cut mid-word tells a reader less
 * than a shorter clause written on purpose.
 */
/**
 * Has this channel been scored?
 *
 * A count is the wrong signal on its own: the engine sends none, so an absent
 * count is unknown rather than zero. Points or a percentage are what prove a
 * channel was measured.
 */
function isMeasured(c: {
  percentage: number | null;
  unitCount: number | null;
  earnedPoints?: number;
  possiblePoints?: number;
}): boolean {
  if ((c.unitCount ?? 0) > 0) return true;
  if ((c.possiblePoints ?? 0) > 0) return true;
  if ((c.earnedPoints ?? 0) !== 0) return true;
  return (c.percentage ?? 0) !== 0;
}

export function scoreInsightShort(
  channels: {
    code: string;
    percentage: number | null;
    /** Null when the provider reports no count — see `ChannelBreakdown`. */
    unitCount: number | null;
    earnedPoints?: number;
    possiblePoints?: number;
  }[],
): string {
  /* **Not `unitCount > 0`.** The legacy engine reports no count at all, so that
     test called every channel unmeasured and the card said "nothing measured
     yet" over a real score. A channel is measured when it has been SCORED. */
  const measured = channels.filter((c) => isMeasured(c));
  if (!measured.length) return "nothing measured yet";
  /* The worst is chosen among channels the engine actually SCORED. A null
     percentage is not the lowest figure — it is no figure, and letting it win
     "worst" would name a channel that has not been judged at all. */
  const ranked = measured.filter(
    (c): c is typeof c & { percentage: number } => c.percentage !== null,
  );
  if (!ranked.length) return "nothing scored yet";
  const worst = ranked.reduce((w, c) =>
    c.percentage < w.percentage ? c : w,
  );
  if (worst.percentage < 0) return `${worst.code} is losing points`;
  if (worst.percentage < 70) return `${worst.code} is holding it down`;
  return "every channel above 70%";
}

export function scoreInsight(
  channels: {
    code: string;
    label: string;
    percentage: number | null;
    unitCount: number | null;
    earnedPoints?: number;
    possiblePoints?: number;
  }[],
): string {
  const measured = channels.filter((c) => isMeasured(c));
  if (!measured.length) return "Nothing measured in this period yet.";

  /* Same guard as `scoreInsightShort`: a null percentage is no figure, not the
     lowest one, and must not be named as the channel holding things down. */
  const ranked = measured.filter(
    (c): c is typeof c & { percentage: number } => c.percentage !== null,
  );
  if (!ranked.length) return "Nothing scored in this period yet.";

  const worst = ranked.reduce((w, c) =>
    c.percentage < w.percentage ? c : w,
  );
  if (worst.percentage < 0)
    return `${worst.code} ${worst.label} is the only channel losing points.`;
  if (worst.percentage < 70)
    return `${worst.code} ${worst.label} is holding the composite down at ${Math.round(worst.percentage)}%.`;

  const unmeasured = channels.length - measured.length;
  if (unmeasured > 0)
    return `Every measured channel is above 70%. ${unmeasured} not yet measured.`;
  return "Every channel is above 70% this period.";
}

/* ── Team ────────────────────────────────────────────────────────────────── */

export interface MemberLoad {
  id: string;
  name: string;
  initials: string;
  hue: Employee["hue"];
  open: number;
  overdue: number;
  blocked: number;
  inReview: number;
  /** The single word a manager needs about this person right now. */
  state: "overloaded" | "blocked" | "behind" | "steady" | "light";
}

/**
 * Workload, read as a managerial question rather than a roster.
 *
 * A list of names with task counts is a spreadsheet. What a manager needs is
 * the exception: who is carrying too much, who cannot move, who has room. The
 * thresholds are relative to the team's own median, so a busy team and a quiet
 * one both produce a useful answer instead of everyone being flagged.
 */
export function teamLoad(people: Employee[], tasks: TaskView[]): MemberLoad[] {
  const rows = people.map((p) => {
    const theirs = tasks.filter(
      (v) => isOpen(v) && v.assignees.some((a) => a.id === p.id),
    );
    return {
      id: p.id,
      name: p.displayName,
      initials: p.initials,
      hue: p.hue,
      open: theirs.length,
      overdue: theirs.filter((v) => v.isOverdue).length,
      blocked: theirs.filter((v) => v.task.isBlocked).length,
      inReview: theirs.filter((v) => v.task.status === "in_review").length,
      state: "steady" as MemberLoad["state"],
    };
  });

  const counts = rows.map((r) => r.open).sort((a, b) => a - b);
  const median = counts.length
    ? counts[Math.floor((counts.length - 1) / 2)]
    : 0;
  const heavy = Math.max(median + 2, Math.ceil(median * 1.5));

  for (const r of rows) {
    r.state =
      r.blocked > 0
        ? "blocked"
        : r.overdue > 0
          ? "behind"
          : r.open >= heavy && r.open > 0
            ? "overloaded"
            : r.open === 0
              ? "light"
              : "steady";
  }

  // Exceptions first: the people a manager would otherwise have to go looking
  // for. Steady and light sink, because "nothing to do here" is the answer
  // they already assumed.
  const order: Record<MemberLoad["state"], number> = {
    blocked: 0,
    behind: 1,
    overloaded: 2,
    steady: 3,
    light: 4,
  };
  return rows.sort(
    (a, b) => order[a.state] - order[b.state] || b.open - a.open,
  );
}

export const LOAD_STATE: Record<
  MemberLoad["state"],
  {
    label: string;
    tone: "overdue" | "blocked" | "risk" | "neutral" | "positive";
  }
> = {
  blocked: { label: "Blocked", tone: "blocked" },
  behind: { label: "Behind", tone: "overdue" },
  overloaded: { label: "Heavy load", tone: "risk" },
  steady: { label: "Steady", tone: "neutral" },
  light: { label: "Has room", tone: "positive" },
};

/** Where a manager has to step in personally, rather than watch. */
export function interventionSignals({
  viewerId,
  tasks,
  reviewQueue,
  conflicts,
}: {
  viewerId: string;
  tasks: TaskView[];
  reviewQueue: TaskView[];
  conflicts: { rank: number }[];
}): Signal[] {
  const open = tasks.filter(isOpen);
  const blocked = open.filter((v) => v.task.isBlocked);
  const overdue = open.filter((v) => v.isOverdue);
  const approvals = open.filter((v) =>
    v.pendingApprovals.some((a) => a.approverId === viewerId),
  );
  const deadlines = open.filter(
    (v) =>
      v.task.deadline.state === "proposed" ||
      v.task.deadline.state === "extension_pending" ||
      v.task.deadline.state === "countered",
  );
  const stalled = open.filter(
    (v) => v.task.status === "assigned" && !v.task.isBlocked,
  );

  const out: Signal[] = [];

  if (blocked.length)
    out.push({
      id: "t-blocked",
      label:
        new Set(blocked.flatMap((v) => v.assignees.map((a) => a.id))).size === 1
          ? "person blocked"
          : "people blocked",
      count: new Set(blocked.flatMap((v) => v.assignees.map((a) => a.id))).size,
      detail: blocked[0].task.blockedReason ?? blocked[0].task.title,
      action: "Unblock",
      href: `/tasks/${blocked[0].task.id}`,
      urgency: "critical",
    });

  if (approvals.length)
    out.push({
      id: "t-approve",
      label:
        approvals.length === 1
          ? "approval waiting on you"
          : "approvals waiting on you",
      count: approvals.length,
      detail: approvals[0].task.title,
      action: "Decide",
      href: `/tasks/${approvals[0].task.id}`,
      urgency: "critical",
    });

  if (conflicts.length)
    out.push({
      id: "t-conflict",
      label:
        conflicts.length === 1 ? "priority conflict" : "priority conflicts",
      count: conflicts.length,
      detail: `Two tasks hold P${conflicts[0].rank}`,
      action: "Resolve",
      href: "/tasks?view=tasks",
      urgency: "critical",
    });

  if (deadlines.length)
    out.push({
      id: "t-deadline",
      label:
        deadlines.length === 1
          ? "deadline being negotiated"
          : "deadlines being negotiated",
      count: deadlines.length,
      detail: deadlines[0].task.title,
      action: "Decide",
      href: `/tasks/${deadlines[0].task.id}/deadline`,
      urgency: "attention",
    });

  if (reviewQueue.length)
    out.push({
      id: "t-review",
      label:
        reviewQueue.length === 1
          ? "submission to review"
          : "submissions to review",
      count: reviewQueue.length,
      detail: reviewQueue[0].task.title,
      action: "Review",
      href: `/tasks/${reviewQueue[0].task.id}/review`,
      urgency: "attention",
    });

  if (overdue.length)
    out.push({
      id: "t-overdue",
      label: "overdue across the team",
      count: overdue.length,
      detail: overdue[0].task.title,
      action: "Open",
      href: "/tasks?view=tasks",
      urgency: "attention",
    });

  if (stalled.length)
    out.push({
      id: "t-stalled",
      label: "assigned, not yet confirmed",
      count: stalled.length,
      detail: stalled[0].task.title,
      action: "Chase",
      href: `/tasks/${stalled[0].task.id}`,
      urgency: "steady",
    });

  return orderSignals(out);
}
