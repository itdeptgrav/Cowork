import { isLiveCandidate } from "./priorityQueue.ts";
import {
  chainDeadlines,
  rankOf,
  startedAtMs,
  windowSecsFor,
  type QueueTask,
} from "./priorityDeadline.ts";

/**
 * Will this task finish in time if it goes here?
 *
 * A dry run over one person's real queue, using the SAME working-calendar
 * arithmetic production deadlines use — so a preview cannot promise a date the
 * engine would not then set. Nothing here writes, and nothing here decides a
 * priority: it answers a question about a placement somebody is considering.
 *
 * **The chain is the point.** A task does not start when it is assigned; it
 * starts when everything ahead of it in the queue is done. So inserting at P1
 * does not merely move one date — it pushes every task below it — and a preview
 * that ignored that would call a placement feasible while making three others
 * late. `chainDeadlines` already models exactly this and is reused rather than
 * re-derived.
 *
 * **Whose queue.** One person's, always: the assignee's. A cross-department task
 * is done by the person it is assigned to, and the creator's own workload has no
 * bearing on when they will finish it. The caller supplies the queue, so it
 * cannot accidentally be the wrong person's.
 */

/** A task competing for the same person's time, as the queue reports it. */
export interface FeasibilityTask extends QueueTask {
  title?: string;
  /** Domain status, for the active-workload test. */
  status?: string;
  /** The budget negotiation's state, where the task has one. */
  budgetState?: string | null;
  /**
   * Broken down into subtasks — holds no place in anyone's queue.
   *
   * A container KEEPS whatever window it was proposed with before it had any
   * subtasks, and stays in `assigneeIds` for whoever it was assigned to — so
   * without this it would compete for a slot in its own former assignee's
   * preview using a figure that describes nothing happening any more.
   */
  isContainer?: boolean;
  /**
   * Legacy's STORED date — `deadline.dueAt` / `officialDueAt`.
   *
   * The COMMITMENT, and never the chain's output. It is what scoring measures
   * and it is not what this module computes: `completionTime` below is when the
   * work will actually happen. A confirmation dialog that showed one of them
   * under the other's name would be lying about a promise.
   */
  committedDueAt?: string | null;
}

export interface BlockingTask {
  taskId: string;
  title: string;
  priority: number;
  estimatedDuration: number;
  reason: string;
}

export type SuggestionAction =
  | "increase_priority"
  | "increase_budget"
  | "request_deadline_change";

export interface Suggestion {
  action: SuggestionAction;
  suggestedPriority?: number;
  reason: string;
}

/** One task's place in the dry run, and what the placement did to it. */
export interface SimulatedEntry {
  taskId: string;
  title: string;
  position: number;
  estimatedDuration: number;
  /**
   * The OPERATIONAL date — when the work actually finishes, given everything
   * ahead of it in this order. Not the commitment; see `committedDueAt`.
   */
  completionTime: string | null;
  /** The stored commitment, carried through unchanged. */
  committedDueAt: string | null;
  /** Seconds this task moved LATER because of the insertion. 0 when unmoved. */
  movedLaterSeconds: number;
}

export interface Feasibility {
  feasible: boolean;
  currentPosition: number | null;
  simulatedPosition: number;
  estimatedStartTime: string | null;
  estimatedCompletionTime: string | null;
  deadline: string | null;
  /** Positive is slack, negative is the amount by which it misses. */
  bufferSeconds: number | null;
  blockingTasks: BlockingTask[];
  explanation: string;
  suggestions: Suggestion[];
  /** The whole queue as simulated, in order — for a UI to show the knock-on. */
  simulatedQueue: SimulatedEntry[];
  /**
   * The queue as it stands TODAY, in its current order, subject included.
   *
   * The BEFORE half of a before/after. Computed here rather than by asking the
   * repository a second time, for two reasons that both matter: a second call
   * re-scans the whole task collection, the office policy, the blocked dates and
   * the timer subcollection — and it stamps a different `Date.now()`, so the two
   * halves of one comparison would be measured from two different moments and
   * every row would show a spurious drift.
   *
   * Deliberately NOT the same chain `movedLaterSeconds` is measured against.
   * That baseline is the queue with the subject REMOVED, which answers "what did
   * inserting this cost"; this one answers "what does the queue look like now",
   * and quietly merging them would silently rewrite every delay figure in the
   * product.
   */
  baselineQueue: SimulatedEntry[];
  /** Only those the insertion actually pushed later. */
  affectedTasks: SimulatedEntry[];
  /**
   * How the answer was reached, in order.
   *
   * Placement first, then the calendar — because "why is it late" is usually
   * answered by the queue, and only sometimes by a closed Sunday.
   */
  calculationTrace: string[];
}

/**
 * The tasks that actually take a place in this person's queue for a placement
 * PREVIEW — deliberately broader than `isActivePriorityTask`'s "counts as
 * committed workload".
 *
 * **The reported defect.** Two subtasks for one person, neither yet accepted,
 * each proposed at two hours: both previewed the identical completion time,
 * because `isActivePriorityTask` requires a SETTLED budget and neither had
 * one — so each ran `competingTasks` as though it were the only thing in the
 * person's queue, chained from "now", and landed on the same answer. A person
 * with two two-hour tasks does not finish both at the same moment; the second
 * one finishes two hours after the first, whether or not either has been
 * accepted yet.
 *
 * `isLiveCandidate` is the fix: live status, not a container, and — this is
 * the point — no acceptance or settlement requirement. A task that has been
 * PROPOSED already carries the number this function needs (`windowSecsFor`
 * reads the proposed window same as the accepted one), so there is a real
 * figure to chain against; withholding it until acceptance is what produced
 * two identical dates instead of one accurate pair.
 *
 * **This does not change what counts as committed workload anywhere else.**
 * `isActivePriorityTask` is untouched and still gates the dashboards, the
 * counters and the accepted chain (`#chainQueue`) that becomes the real,
 * production `operationalDueAt` — those answer "how much is this person
 * actually committed to", and an unsettled proposal correctly does not count
 * there. This function answers a narrower question — "if these proposals run
 * in rank order, when does each land" — and a dry-run preview is exactly where
 * that distinction belongs: `previewDeadlineFeasibility`'s own contract is
 * that nothing here is a promise the engine has made.
 */
function competingTasks(tasks: FeasibilityTask[]): FeasibilityTask[] {
  return tasks.filter((t) => {
    if (windowSecsFor(t) <= 0) return false;
    return isLiveCandidate({
      taskId: String(t.taskId),
      status: t.status ?? "",
      storedRank: null,
      isContainer: t.isContainer,
    });
  });
}

/**
 * Ordered by stored rank, the same key the real queue sorts on.
 *
 * `rankOf` rather than reading the map here: it already resolves
 * `assigneePriorities[me] ?? priority ?? 999`, which is legacy's own order, and
 * a second reading of that would be a second answer to the same question.
 */
function inRankOrder(
  tasks: FeasibilityTask[],
  employeeId: string,
): FeasibilityTask[] {
  return [...tasks].sort((a, b) => {
    const ra = rankOf(a, employeeId);
    const rb = rankOf(b, employeeId);
    if (ra !== rb) return ra - rb;
    /* Total, so the same queue never previews two ways. */
    return String(a.taskId).localeCompare(String(b.taskId));
  });
}

export function calculateDeadlineFeasibility(input: {
  /** Absent for a task not yet created — the ordinary case at assignment. */
  taskId?: string;
  employeeId: string;
  /**
   * 1-based, as a person reads it. Clamped to the queue's real length.
   *
   * **Optional, and omitting it is usually right.** Only a reader who is
   * actively choosing a placement has a position to offer. Everybody else is
   * asking "when will this be done?", and the answer to that must come from
   * where the task ALREADY sits in this person's queue — not from a number the
   * caller had to invent.
   *
   * Absent, the position is resolved in this order:
   *
   *   1. Where the task already is in this employee's queue.
   *   2. The back of the queue, for a task not in it yet — which is the
   *      product's own rule for new work: it joins the bottom and moves
   *      nothing above it.
   *
   * Defaulting to 1 instead, as the UI used to, put every task at the FRONT:
   * nothing was ahead of it, so it started now and every date below was
   * fiction. It looked plausible, which is why it survived.
   */
  proposedPriority?: number | null;
  estimatedWorkSeconds: number;
  /**
   * Seconds already worked on the task being placed.
   *
   * Only the REMAINDER is scheduled. Previewing a task that is half done as
   * though none of it were would predict a date the operational chain — which
   * does deduct — immediately contradicts.
   *
   * Zero for work not yet started, which is the ordinary case at assignment.
   */
  alreadyWorkedSeconds?: number;
  /** ISO. Null when nothing has been committed, which is not a failure. */
  committedDeadline: string | null;
  /** The employee's tasks. The caller decides whose, so it is never guessed. */
  tasks: FeasibilityTask[];
  /**
   * A hand-built order — task ids, front to back, including `"__proposed__"`
   * for a task not yet created. Overrides `proposedPriority`.
   *
   * This is what a planner dragging rows produces. It is an INPUT to the same
   * calculation, not a second one: the chain, the calendar walk and the
   * knock-on measurement below are untouched by it. Ids that are not in the
   * queue are ignored; tasks the override omits keep their rank order behind
   * the ones it names, so a partial list can never silently drop work.
   *
   * The baseline that `movedLaterSeconds` is measured against deliberately
   * does NOT use it. "Later" means later than the employee's real queue today
   * — otherwise dragging a task down would report it as unaffected, measured
   * against a position that exists only in the preview.
   */
  orderOverride?: string[] | null;
  /** Now, injected so the answer is reproducible in a test. */
  nowMs: number;
  /** Production's own arithmetic — office hours, breaks, blocked dates. */
  addWorkingSecs: (anchorMs: number, windowSecs: number) => string;
  /**
   * Optional step log for the calendar walk, from `explainAddWorkingSecs`.
   *
   * Injected rather than imported so this module stays free of the office
   * schedule — it knows about queues and chains, not about Sundays.
   */
  explainWorkingSecs?: (
    anchorMs: number,
    windowSecs: number,
  ) => { type?: string; date?: string; name?: string }[];
}): Feasibility {
  const competing = competingTasks(input.tasks).filter(
    (t) => t.taskId !== input.taskId,
  );
  const ordered = inRankOrder(competing, input.employeeId);

  const currentPosition = input.taskId
    ? (() => {
        const all = inRankOrder(
          competingTasks(input.tasks),
          input.employeeId,
        );
        const at = all.findIndex((t) => t.taskId === input.taskId);
        return at === -1 ? null : at + 1;
      })()
    : null;

  /* Clamped: a person may type 5 into a queue of two, and the honest reading of
     "P5" there is "last". A missing position resolves to where the task is
     today, or to the back for one that has not joined the queue yet. */
  const askedFor =
    input.proposedPriority === null || input.proposedPriority === undefined
      ? (currentPosition ?? ordered.length + 1)
      : input.proposedPriority;
  const index = Math.max(
    0,
    Math.min(ordered.length, Math.round(askedFor) - 1),
  );

  const subject: FeasibilityTask = {
    taskId: input.taskId ?? "__proposed__",
    title: "This task",
    assigneeIds: [input.employeeId],
    status: "confirmed",
    senderTimerWindowSecs: Math.max(0, Math.round(input.estimatedWorkSeconds)),
    loggedSecs: Math.max(0, Math.round(input.alreadyWorkedSeconds ?? 0)),
    /* Filled from the same field as every other row, so the subject is not the
       one entry in the list with an empty commitment column. */
    committedDueAt: input.committedDeadline ?? null,
  } as FeasibilityTask;

  const subjectId = String(subject.taskId);

  /* Either the dragged order or the ranked one. Both produce the same shape —
     a front-to-back list with the subject somewhere in it — so everything
     below this point is identical whichever way the reader got here. */
  const simulated: FeasibilityTask[] = [];
  if (input.orderOverride?.length) {
    const byId = new Map(ordered.map((t) => [String(t.taskId), t]));
    const placed = new Set<string>();
    for (const id of input.orderOverride) {
      if (placed.has(id)) continue;
      if (id === subjectId) {
        placed.add(id);
        simulated.push(subject);
        continue;
      }
      const t = byId.get(id);
      if (t) {
        placed.add(id);
        simulated.push(t);
      }
    }
    /* Anything the override did not name keeps its rank order at the back.
       Dropping it instead would quietly shorten the queue and flatter every
       date on screen. */
    for (const t of ordered) {
      if (!placed.has(String(t.taskId))) simulated.push(t);
    }
    if (!placed.has(subjectId)) simulated.push(subject);
  } else {
    simulated.push(...ordered);
    simulated.splice(index, 0, subject);
  }

  const simulatedIndex = simulated.findIndex(
    (t) => String(t.taskId) === subjectId,
  );
  const simulatedPosition = simulatedIndex + 1;

  /**
   * **Where the chain starts — and why it is NOT `now`.**
   *
   * This anchored at `input.nowMs`, so *Expected completion* was `now` plus the
   * remaining work: it walked forward one second per second, all day, every
   * day. Two browsers open on the same task two minutes apart showed 16:50 and
   * 16:52, and neither was stale — each had computed correctly, from a
   * different instant.
   *
   * A completion date that advances on its own is not a date. So the anchor is
   * the moment the work actually BEGAN, and the queue is laid out from there in
   * FULL budgets rather than remainders. The two go together: a fixed origin
   * with shrinking work would still move (earlier), and a moving origin with
   * full budgets would still drift. Fixed origin plus fixed budgets is a plan —
   * decided once when the work starts, and afterwards moved only by the things
   * that are allowed to move it: a break, an offline span, an approved
   * emergency, an approved extension.
   *
   * Nothing has started yet? Then there is no origin to hold and `nowMs` is the
   * honest answer, exactly as before.
   */
  const startedAnchorMs = (() => {
    /* Read from the REAL tasks, not from `simulated`. The subject in there is a
       synthesised row carrying only what this function was asked about — it has
       no `startedAt`, and the genuine task it stands for was filtered out of
       `competing` by id. Scanning the simulation therefore found no start on the
       one task most likely to have one, and the anchor silently fell back to
       `now` — the very drift this exists to remove. */
    const startsById = new Map<string, number>();
    for (const t of input.tasks) {
      const started = startedAtMs((t as QueueTask).startedAt);
      if (started !== null) startsById.set(String(t.taskId), started);
    }
    /* Front of the queue first: the chain is anchored where it BEGAN, and that
       is whichever task is leading it. */
    for (const t of simulated) {
      const started = startsById.get(String(t.taskId));
      if (started !== undefined) return started;
    }
    return input.nowMs;
  })();

  /* The real chain, over the simulated order. Each task starts when the one
     before it finishes — which is why a placement changes more than one date. */
  const chained = chainDeadlines({
    queue: simulated as QueueTask[],
    anchorMs: startedAnchorMs,
    addWorkingSecs: input.addWorkingSecs,
    budget: "full",
  });

  const mine = chained.find((c) => c.taskId === subject.taskId) ?? null;
  const completion = mine?.dueDate ?? null;

  /* Start is where the task ahead of it lands — or now, at the front. */
  const ahead = simulated
    .slice(0, simulatedIndex)
    .filter((t) => windowSecsFor(t) > 0);
  const lastAhead = ahead.length
    ? (chained.find((c) => c.taskId === ahead[ahead.length - 1].taskId) ?? null)
    : null;
  const estimatedStartTime = lastAhead
    ? lastAhead.dueDate
    : new Date(input.nowMs).toISOString();

  const blockingTasks: BlockingTask[] = ahead.map((t) => ({
    taskId: String(t.taskId),
    title: t.title ?? String(t.taskId),
    priority: rankOf(t, input.employeeId),
    estimatedDuration: windowSecsFor(t),
    reason: "Sits ahead in the queue, so this task cannot start until it ends.",
  }));

  /* What the whole queue looks like after the insertion, and what moved.
     A baseline chain WITHOUT the task is computed only to measure the
     knock-on — the difference between the two is what "moved later" means. */
  const baseline = chainDeadlines({
    queue: ordered as QueueTask[],
    /* The SAME anchor and the same budget rule as the chain above. "Moved
       later" is a difference between two orders, so measuring them from two
       different origins would report movement that nobody caused. */
    anchorMs: startedAnchorMs,
    addWorkingSecs: input.addWorkingSecs,
    budget: "full",
  });
  const baselineBy = new Map(baseline.map((b) => [b.taskId, b.dueDate]));

  const simulatedQueue: SimulatedEntry[] = simulated
    .filter((t) => windowSecsFor(t) > 0)
    .map((t, i) => {
      const now = chained.find((c) => c.taskId === t.taskId)?.dueDate ?? null;
      const was = baselineBy.get(t.taskId) ?? null;
      const movedLaterSeconds =
        now && was ? Math.max(0, Math.round((Date.parse(now) - Date.parse(was)) / 1000)) : 0;
      return {
        taskId: String(t.taskId),
        title: t.title ?? String(t.taskId),
        position: i + 1,
        estimatedDuration: windowSecsFor(t),
        completionTime: now,
        committedDueAt: t.committedDueAt ?? null,
        movedLaterSeconds,
      };
    });

  /* The queue as it stands today: the ranked order with the subject where it
     currently sits — or at the back when it is not in the queue yet, which is
     the product's own rule for new work. Chained from the same `nowMs` as the
     simulation, so a before/after comparison measures one moment. */
  const currentIndex =
    currentPosition !== null
      ? Math.max(0, Math.min(ordered.length, currentPosition - 1))
      : ordered.length;
  const baselineOrder: FeasibilityTask[] = [...ordered];
  baselineOrder.splice(currentIndex, 0, subject);
  const baselineChain = chainDeadlines({
    queue: baselineOrder as QueueTask[],
    anchorMs: input.nowMs,
    addWorkingSecs: input.addWorkingSecs,
  });
  const baselineQueue: SimulatedEntry[] = baselineOrder
    .filter((t) => windowSecsFor(t) > 0)
    .map((t, i) => ({
      taskId: String(t.taskId),
      title: t.title ?? String(t.taskId),
      position: i + 1,
      estimatedDuration: windowSecsFor(t),
      completionTime:
        baselineChain.find((c) => c.taskId === t.taskId)?.dueDate ?? null,
      committedDueAt: t.committedDueAt ?? null,
      /* Zero by construction — this IS the unmoved state. */
      movedLaterSeconds: 0,
    }));

  const affectedTasks = simulatedQueue.filter(
    (e) => e.taskId !== subject.taskId && e.movedLaterSeconds > 0,
  );

  const calculationTrace = traceFor({
    subjectId: String(subject.taskId),
    simulatedQueue,
    affectedTasks,
    completion,
    deadline: input.committedDeadline,
    calendarSteps: input.explainWorkingSecs
      ? input.explainWorkingSecs(
          Date.parse(estimatedStartTime),
          Math.max(0, Math.round(input.estimatedWorkSeconds)),
        )
      : [],
  });

  /* No committed deadline is not an infeasible one. It is a task nobody has
     promised a date for, and saying "will not meet its deadline" about it would
     invent a commitment. */
  if (!input.committedDeadline || !completion) {
    return {
      feasible: true,
      currentPosition,
      simulatedPosition,
      estimatedStartTime,
      estimatedCompletionTime: completion,
      deadline: input.committedDeadline,
      bufferSeconds: null,
      blockingTasks,
      explanation: completion
        ? `At position ${simulatedPosition} this finishes ${completion}. No deadline has been committed, so there is nothing to miss.`
        : "There is no estimated work time, so no completion date can be worked out.",
      suggestions: [],
      simulatedQueue,
      baselineQueue,
      affectedTasks,
      calculationTrace,
    };
  }

  const deadlineMs = Date.parse(input.committedDeadline);
  const completionMs = Date.parse(completion);
  if (Number.isNaN(deadlineMs) || Number.isNaN(completionMs)) {
    return {
      feasible: true,
      currentPosition,
      simulatedPosition,
      estimatedStartTime,
      estimatedCompletionTime: completion,
      deadline: input.committedDeadline,
      bufferSeconds: null,
      blockingTasks,
      explanation: "The committed deadline could not be read, so feasibility is unknown.",
      suggestions: [],
      simulatedQueue,
      baselineQueue,
      affectedTasks,
      calculationTrace,
    };
  }

  const bufferSeconds = Math.round((deadlineMs - completionMs) / 1000);
  const feasible = bufferSeconds >= 0;

  return {
    feasible,
    currentPosition,
    simulatedPosition,
    estimatedStartTime,
    estimatedCompletionTime: completion,
    deadline: input.committedDeadline,
    bufferSeconds,
    blockingTasks: feasible ? [] : blockingTasks,
    explanation: explain({
      feasible,
      simulatedPosition,
      bufferSeconds,
      blocking: blockingTasks,
    }),
    suggestions: feasible
      ? []
      : suggestionsFor({ simulatedPosition, blocking: blockingTasks }),
    simulatedQueue,
    baselineQueue,
    affectedTasks,
    calculationTrace,
  };
}

function explain(input: {
  feasible: boolean;
  simulatedPosition: number;
  bufferSeconds: number;
  blocking: BlockingTask[];
}): string {
  const hours = Math.abs(Math.round((input.bufferSeconds / 3600) * 10) / 10);
  if (input.feasible) {
    return `At position ${input.simulatedPosition} this finishes with about ${hours}h of working time to spare.`;
  }
  /* Names the CAUSE, not just the verdict: the reader's next question is always
     "because of what?", and the answer is the work ahead of it. */
  const ahead = input.blocking.length;
  const because =
    ahead === 0
      ? "the work itself does not fit before the deadline"
      : `${ahead} task${ahead === 1 ? "" : "s"} ahead of it must finish first`;
  return `At position ${input.simulatedPosition} this misses the deadline by about ${hours}h of working time, because ${because}.`;
}

/**
 * What could be done about it, in the order worth trying.
 *
 * Moving it up is offered only when something is actually ahead of it — at the
 * front of the queue there is nothing left to overtake, and suggesting it would
 * send somebody to a control that changes nothing.
 */
function suggestionsFor(input: {
  simulatedPosition: number;
  blocking: BlockingTask[];
}): Suggestion[] {
  const out: Suggestion[] = [];
  if (input.simulatedPosition > 1) {
    out.push({
      action: "increase_priority",
      suggestedPriority: 1,
      reason: `Moving it ahead of ${input.blocking.length} earlier task${
        input.blocking.length === 1 ? "" : "s"
      } starts it sooner.`,
    });
  }
  out.push({
    action: "increase_budget",
    reason:
      "If the estimate is too low, the date will slip whatever the position.",
  });
  out.push({
    action: "request_deadline_change",
    reason:
      "If the work genuinely takes this long, the committed date is the thing to renegotiate.",
  });
  return out;
}

/**
 * The working written out, in the order somebody would ask it.
 *
 * Placement first — "why is it late" is usually answered by the queue — then
 * the knock-on, then the calendar, then the verdict. Each line states a fact
 * that was actually used; nothing is inferred for narrative effect.
 */
function traceFor(input: {
  subjectId: string;
  simulatedQueue: SimulatedEntry[];
  affectedTasks: SimulatedEntry[];
  completion: string | null;
  deadline: string | null;
  calendarSteps: { type?: string; date?: string; name?: string }[];
}): string[] {
  const out: string[] = [];
  const hours = (secs: number) => `${Math.round((secs / 3600) * 10) / 10}h`;

  const me = input.simulatedQueue.find((e) => e.taskId === input.subjectId);
  const ahead = input.simulatedQueue.filter(
    (e) => me && e.position < me.position,
  );

  if (!me) {
    out.push("This task has no estimated time, so it takes no place in the queue.");
    return out;
  }

  out.push(
    ahead.length === 0
      ? `Placed at position ${me.position}, so it starts straight away.`
      : `Placed at position ${me.position}, so it starts after ${ahead.length} task${
          ahead.length === 1 ? "" : "s"
        } ahead of it.`,
  );
  for (const t of ahead) {
    out.push(`Waits for ${t.title} (position ${t.position}, ${hours(t.estimatedDuration)}).`);
  }

  for (const t of input.affectedTasks) {
    out.push(`${t.title} moves later by ${hours(t.movedLaterSeconds)}.`);
  }

  /* Calendar skips, de-duplicated: a four-day gap logs each day, and four
     identical "office closed" lines say no more than one. */
  const seen = new Set<string>();
  for (const step of input.calendarSteps) {
    const label =
      step.type === "holiday" || step.type === "leave"
        ? `${step.name || step.type} on ${step.date} is not a working day.`
        : step.date
          ? `Office closed on ${step.date}.`
          : null;
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }

  if (input.completion) {
    out.push(`Finishes ${input.completion}.`);
    if (input.deadline) {
      const diff = Math.round(
        (Date.parse(input.deadline) - Date.parse(input.completion)) / 1000,
      );
      out.push(
        diff >= 0
          ? `Completed ${hours(diff)} before the deadline.`
          : `Overruns the deadline by ${hours(-diff)}.`,
      );
    }
  }
  return out;
}
