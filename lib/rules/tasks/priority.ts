import {
  activeQueuePositions,
  isActiveInQueue,
  type QueueEntry,
} from "./activeQueue.ts";
import { mayReorder } from "../../auth/priority.ts";
import {
  isRealRank,
  resolveTaskPriority,
  MAX_RANK,
  MIN_RANK,
  UNRANKED,
  type PriorityCarrier,
} from "./resolveTaskPriority.ts";

/**
 * **THE priority authority.** One question, one answer, one place.
 *
 * ## What was actually wrong
 *
 * Not duplication — the reads were already centralised. The defect was that
 * **one field meant two different things**, and which one depended on a detail
 * of how the page had been loaded.
 *
 * `TaskAssignment.rank` was filled in by the mapper as:
 *
 * ```ts
 * rank: queue && queue.ownerId === employeeId
 *   ? (queue.positions.get(id) ?? resolveTaskPriority(...))   // DERIVED 1..N
 *   : resolveTaskPriority(...)                                 // STORED 1..10
 * ```
 *
 * and the two read paths supplied different owners:
 *
 * | Path | `queue.ownerId` |
 * |---|---|
 * | task list (`listTasks`) | **the viewer** |
 * | task detail (`#readTaskView`) | the viewer *if they hold it*, else the first holder |
 *
 * So a manager opening a report's task got the **assignee's derived queue
 * position**, and the same manager looking at the same task in the list got its
 * **stored priority**. Two different scales, both rendered `P{n}`. That is the
 * reported "detail says P1, list says P3".
 *
 * ## The fix is to make them un-conflatable
 *
 * A stored rank and a queue position are different facts and now live in
 * different fields. Nothing has to remember which one it is holding, because
 * nothing holds both in one place any more.
 *
 * | Concept | Scale | Where | Written by |
 * |---|---|---|---|
 * | **Stored rank** | 1–10, 1 highest | `assigneePriorities[id]`, else `priority` | a manager, deliberately |
 * | **Queue position** | 1..N over live work | derived per read | nobody — it is a consequence |
 *
 * ## Priority IS per person, and that is not the bug
 *
 * A task given to three people carries three ranks, because each is that
 * person's position in *their own* day. Legacy stores it that way
 * (`assigneePriorities[me] ?? priority ?? 999`), creates one rank per assignee at
 * assignment time from that person's own open-task count, and the product
 * documents the consequence: somebody else finishing their P1 never changes
 * yours.
 *
 * Flattening it to one number per task would mean one colleague's queue ordering
 * everybody's day — which is the defect the per-person map exists to prevent.
 * What must be consistent is **the scale and the subject**: one viewer sees one
 * number for one task everywhere, and the label says whose it is.
 */

export { MIN_RANK, MAX_RANK, UNRANKED, isRealRank };

/** Which of the two numbers a reading came from. */
export type PriorityScale =
  /** A position among live work, derived per read. Renumbers itself. */
  | "queue_position"
  /**
   * A position among work not yet accepted or budget-settled — its OWN
   * gap-free 1..N, independent of `queue_position`'s. Renumbers itself the
   * same way, over its own set.
   */
  | "provisional_position"
  /** The 1–10 figure a manager set. Survives completion. */
  | "stored_rank"
  /** Nothing usable was ever written. */
  | "none";

export interface TaskPriority {
  /**
   * The number to show, or null when the task genuinely carries none.
   *
   * A caller should not need to know which scale produced it — that is what
   * `scale` and `subjectId` are for — but it must never print it without
   * consulting `isHistoric`.
   */
  rank: number | null;
  scale: PriorityScale;
  /**
   * Whose number this is, where it belongs to a person.
   *
   * Null for the task's own shared `priority`. A screen that says "your
   * priority" over somebody else's is how a manager comes to believe their day
   * is ordered by a report's queue.
   */
  subjectId: string | null;
  /** True when the reading belongs to the viewer who asked. */
  isMine: boolean;
  /**
   * The task has left the live queue, so this is a record and not a position.
   *
   * Must render as "was P1", never a bare "P1" — a closed task showing the same
   * chip as a live one puts two first-priorities on one screen.
   */
  isHistoric: boolean;
  /** The stored 1–10 rank behind the reading, whatever scale was returned. */
  storedRank: number | null;
}

/** The shape this module reads. Anything wider is a caller's business. */
export interface PriorityTask extends PriorityCarrier {
  status: string;
}

/**
 * One person's priority on one task.
 *
 * `queuePosition` is passed in rather than derived here, because deriving it
 * needs that person's WHOLE queue and this function is given one task. The
 * repository fetches the queue once per read and hands the position down; a
 * caller with no queue gets the stored rank, which is a number that may lag
 * rather than a dash on work somebody was actually given.
 */
export function getPersonPriority(input: {
  task: PriorityTask;
  /** Whose priority is being asked about. */
  subjectId: string;
  /** Their derived position, where the caller fetched their queue. */
  queuePosition?: number | null;
  /**
   * Their position among work not yet accepted or budget-settled — its OWN
   * gap-free sequence, read only where `queuePosition` has nothing, because a
   * task is in exactly one of the two.
   */
  provisionalPosition?: number | null;
  /** Who is looking. Only decides `isMine`, never the number. */
  viewerId?: string | null;
}): TaskPriority {
  const stored = resolveTaskPriority(input.task, input.subjectId);
  const storedRank = isRealRank(stored) ? stored : null;
  const isMine = input.viewerId != null && input.viewerId === input.subjectId;
  const historic = !isActiveInQueue(input.task.status);

  /* A closed task reports what it was carrying, from the STORED rank — it has no
     live position, and nothing rewrites the stored figure on completion. */
  if (historic) {
    return {
      rank: storedRank,
      scale: storedRank === null ? "none" : "stored_rank",
      subjectId: input.subjectId,
      isMine,
      isHistoric: true,
      storedRank,
    };
  }

  /* The derived position wins for a live task, because it is the one that
     renumbers itself as work closes. Only where the caller actually has it. */
  if (input.queuePosition != null && input.queuePosition > 0) {
    return {
      rank: input.queuePosition,
      scale: "queue_position",
      subjectId: input.subjectId,
      isMine,
      isHistoric: false,
      storedRank,
    };
  }

  /* Not yet accepted or settled, but real — and gap-free among its own kind
     rather than the raw stored figure. This is the tier that used to be
     missing entirely: a task fell straight from "queue position" to "whatever
     number the document happens to hold", and a container sitting between two
     pending siblings showed up as a missing number rather than as nothing. */
  if (input.provisionalPosition != null && input.provisionalPosition > 0) {
    return {
      rank: input.provisionalPosition,
      scale: "provisional_position",
      subjectId: input.subjectId,
      isMine,
      isHistoric: false,
      storedRank,
    };
  }

  return {
    rank: storedRank,
    scale: storedRank === null ? "none" : "stored_rank",
    subjectId: input.subjectId,
    isMine,
    isHistoric: false,
    storedRank,
  };
}

/**
 * The task's own priority, belonging to nobody in particular.
 *
 * **This is the "one operational priority" a task has.** It is the shared
 * `priority` field, which legacy sets at creation and which every per-person
 * rank falls back to. It is the honest answer for a reader who is not an
 * assignee: their own queue has nothing to say about work they are not doing.
 *
 * It deliberately does NOT summarise the per-person ranks. Taking the minimum
 * would report the most urgent holder's position as though it were the task's,
 * which is a different claim and a more alarming one.
 */
export function getTaskPriority(task: PriorityTask): TaskPriority {
  const stored = resolveTaskPriority({ priority: task.priority }, null);
  const storedRank = isRealRank(stored) ? stored : null;
  return {
    rank: storedRank,
    scale: storedRank === null ? "none" : "stored_rank",
    subjectId: null,
    isMine: false,
    isHistoric: !isActiveInQueue(task.status),
    storedRank,
  };
}

/**
 * The priority to SHOW, for this viewer, on this task.
 *
 * **Operates on RESOLVED inputs, not on the raw document**, and that is
 * deliberate. `priority` and `assigneePriorities` are legacy wire fields; the
 * domain `Task` does not carry them at all, because they are resolved once at the
 * mapper boundary where the legacy document actually is. A display function that
 * reached back for them would either need the wire type on every screen or would
 * silently read `undefined` — which typechecks, because every field on
 * `PriorityCarrier` is optional.
 *
 * So the mapper resolves, this decides, and the two cannot disagree because the
 * mapper resolves *through* `getPersonPriority`.
 *
 * The order:
 *
 *  1. **The viewer's own**, where they hold the task — the only reading that
 *     answers "where does this sit in my day".
 *  2. **A named holder's**, where the read fetched that person's queue. A manager
 *     watching one report is looking at that report's queue and should see its
 *     positions, labelled as theirs.
 *  3. **The stored rank** any holder carries, which claims no position.
 *
 * Falling from 1 to 3 is what stops a manager seeing `P—` on every task they
 * assigned; keeping 2 explicit is what stops the same manager seeing a derived
 * position on one screen and a stored rank on another.
 */
export function displayPriority(input: {
  /** The DOMAIN status. Legacy's raw field stays `open` through a review. */
  status: string;
  viewerId: string | null;
  /**
   * The viewer's own resolved rank, where they hold the task. Null otherwise.
   *
   * Already the position-or-stored decision, made by `getPersonPriority` in the
   * mapper — so this function does not repeat it for the viewer's own case.
   */
  myRank?: number | null;
  /** The viewer's stored rank, whatever the status. Null if they hold nothing. */
  myStoredRank?: number | null;
  /** One entry per holder, with the facts kept apart. */
  holders: {
    employeeId: string;
    /** The stored 1–10 rank. */
    rank: number | null;
    /** The derived position, present only where THIS person's queue was read. */
    queuePosition?: number | null;
    /** Their position among not-yet-accepted work. Its own sequence — see above. */
    provisionalPosition?: number | null;
  }[];
}): TaskPriority {
  const { status, viewerId, holders } = input;
  const historic = !isActiveInQueue(status);

  const holdsIt =
    viewerId !== null && holders.some((h) => h.employeeId === viewerId);

  const myStored = isRealRank(input.myStoredRank ?? null)
    ? (input.myStoredRank as number)
    : null;

  if (holdsIt) {
    /* A closed task reports the STORED rank — it holds no position, and nothing
       rewrites the stored figure on completion. Taken before the live branch
       because `myRank` is already null on a finished task. */
    const own = historic ? myStored : (input.myRank ?? null);
    const usable = isRealRank(own) ? own : null;

    /* **Falls through rather than returning null**, and this is load-bearing:
       legacy's own read is `assigneePriorities[me] ?? priority ?? 999`, which
       gives up on nothing. A holder whose own reading is unusable — a nonsense
       `myRank`, or a closed task with no stored rank of their own — still sees
       what the task is carrying. Returning null here showed a dash to the one
       person holding the work, which is the bug this whole area exists to have
       fixed, arrived at from a new direction. */
    if (usable !== null) {
      return {
        rank: usable,
        scale: historic || usable === myStored ? "stored_rank" : "queue_position",
        subjectId: viewerId,
        isMine: true,
        isHistoric: historic,
        storedRank: myStored,
      };
    }
  }

  /* Either not a holder, or a holder whose own reading was unusable. At most one
     holder can carry a position — a read fetches one queue — and where it exists
     it is the more useful number, labelled as belonging to that person rather
     than to the reader. */
  const withPosition = historic
    ? undefined
    : holders.find((h) => h.queuePosition != null && h.queuePosition > 0);

  if (withPosition) {
    return {
      rank: withPosition.queuePosition as number,
      scale: "queue_position",
      subjectId: withPosition.employeeId,
      isMine: false,
      isHistoric: false,
      storedRank: isRealRank(withPosition.rank) ? withPosition.rank : null,
    };
  }

  /* The same preference, one tier down: nobody's live position was read, but
     somebody's PROVISIONAL one was — a holder whose queue was fetched while
     still awaiting acceptance or a settled budget. Gap-free among its own
     kind rather than the raw stored figure, for the reason `getPersonPriority`
     documents. */
  const withProvisional = historic
    ? undefined
    : holders.find(
        (h) => h.provisionalPosition != null && h.provisionalPosition > 0,
      );

  if (withProvisional) {
    return {
      rank: withProvisional.provisionalPosition as number,
      scale: "provisional_position",
      subjectId: withProvisional.employeeId,
      isMine: false,
      isHistoric: false,
      storedRank: isRealRank(withProvisional.rank)
        ? withProvisional.rank
        : null,
    };
  }

  /* The stored ranks. Where holders differ — which legacy allows, since each is
     that person's own queue position — the HIGHEST priority (lowest number) is
     the honest summary of how urgent this task is to the people holding it. */
  const ranked = holders.filter((h) => isRealRank(h.rank));
  if (ranked.length === 0) {
    return {
      rank: null,
      scale: "none",
      subjectId: null,
      isMine: false,
      isHistoric: historic,
      storedRank: null,
    };
  }
  const best = ranked.reduce((a, b) =>
    (a.rank as number) <= (b.rank as number) ? a : b,
  );
  return {
    rank: best.rank as number,
    scale: "stored_rank",
    /* Named where exactly one holder carries the best rank; null where several
       tie, because attributing a shared figure to one of them would be a guess. */
    subjectId:
      ranked.filter((h) => h.rank === best.rank).length === 1
        ? best.employeeId
        : null,
    isMine: false,
    isHistoric: historic,
    storedRank: best.rank as number,
  };
}

/** `P3`, `Was P3`, or an em dash. The one place the `P` prefix is written. */
export function formatPriority(priority: TaskPriority): string {
  if (priority.rank === null) return "—";
  return priority.isHistoric ? `Was P${priority.rank}` : `P${priority.rank}`;
}

/**
 * What the number means, in words, for a tooltip.
 *
 * Says which scale AND whose it is, because those are the two things a reader
 * cannot tell from `P3` and the two that were being conflated.
 */
export function describePriority(
  priority: TaskPriority,
  nameOf: (id: string) => string | null,
): string {
  if (priority.rank === null) {
    return "No priority has been set for this task.";
  }
  const whose = priority.isMine
    ? "your"
    : priority.subjectId
      ? `${nameOf(priority.subjectId) ?? "the assignee"}’s`
      : "this task’s";

  if (priority.isHistoric) {
    return `The rank this task was carrying in ${whose} queue when it closed. It holds no position now.`;
  }
  if (priority.scale === "queue_position") {
    return `Position ${priority.rank} in ${whose} live queue, counting only work still in play. Closing something above it moves this up with no change to what anybody set.`;
  }
  if (priority.scale === "provisional_position") {
    return `Position ${priority.rank} among ${whose === "this task’s" ? "this task’s" : `${whose}`} work not yet accepted or budget-settled — a separate count from the live queue. It takes its place there the moment it is accepted.`;
  }
  return `${whose === "this task’s" ? "The task’s" : `${whose}`} stored priority, on a scale of 1 to 10 where 1 is highest. A live queue position was not available for this read.`;
}

/* ── Changing it ──────────────────────────────────────────────────────────── */

/**
 * May this person change that person's priority on this task?
 *
 * Two halves, in the order the repository applies them, and neither is
 * sufficient alone:
 *
 *  1. **Capability** — `task.priority.change` must REACH the subject. An
 *     employee reaches nobody, a manager their direct reports, an administrator
 *     everybody. Injected, so this stays pure.
 *  2. **Not your own** — you do not order your own work unless nobody manages
 *     you. `can()` cannot express that, because its scope check returns true for
 *     yourself before scope is consulted.
 */
export function canChangePriority(input: {
  actorId: string;
  subjectId: string;
  /** Whether the ACTOR has a manager. From `Viewer.hasManager`. */
  actorHasManager: boolean;
  /** `perms.can("task.priority.change", subjectId)`. */
  canReorder: (employeeId: string) => boolean;
  /** The task, so a closed one is refused. */
  task: PriorityTask;
}): boolean {
  if (!isActiveInQueue(input.task.status)) return false;
  if (!input.canReorder(input.subjectId)) return false;
  return mayReorder({
    actorId: input.actorId,
    subjectId: input.subjectId,
    actorHasManager: input.actorHasManager,
  });
}

/** Why a priority change cannot be made, or null. */
export function priorityChangeRefusal(input: {
  actorId: string;
  subjectId: string;
  actorHasManager: boolean;
  canReorder: (employeeId: string) => boolean;
  task: PriorityTask;
  newRank: number;
}): string | null {
  if (!isActiveInQueue(input.task.status)) {
    return "This task has closed, so its priority is a record rather than a position. It cannot be changed.";
  }
  if (input.actorId === input.subjectId && input.actorHasManager) {
    /* Legacy's own wording, quoted by the help corpus. */
    return "You cannot change your own priority. The order of your work is set by your manager.";
  }
  if (!input.canReorder(input.subjectId)) {
    return "Your role does not let you set the order of this person’s work.";
  }
  if (!Number.isFinite(input.newRank)) {
    return "A priority has to be a number between 1 and 10.";
  }
  return null;
}

/**
 * The rank a write should carry: clamped to the scale, never rejected silently.
 *
 * Legacy clamps rather than refusing (`handleUpdatePriority`), and matching that
 * matters — a typed 0 or 50 becomes the nearest real rank instead of writing a
 * value off the scale that then sorts ahead of everything.
 */
export function clampRank(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return MIN_RANK;
  return Math.max(MIN_RANK, Math.min(MAX_RANK, Math.round(n)));
}

/**
 * The queue as it WOULD be after moving one task to a rank.
 *
 * **Moving one task moves the queue, so the whole queue is the unit of change.**
 * Writing one rank was the bug behind "I moved C to P1 and A is still P1": two
 * tasks at rank 1 leaves the displayed order to a tie-break, which put the older
 * one first and silently defeated the move.
 *
 * Returned rather than written, so the dialog's preview and the persisted order
 * are computed by one function and cannot disagree.
 */
export function updateTaskPriority(input: {
  /** The subject's live queue, in order. */
  currentOrder: string[];
  taskId: string;
  newRank: number;
}): string[] {
  const rank = clampRank(input.newRank);
  const without = input.currentOrder.filter((id) => id !== input.taskId);
  const at = Math.max(0, Math.min(without.length, rank - 1));
  without.splice(at, 0, input.taskId);
  return without;
}

/**
 * Positions for a whole queue, from the stored ranks.
 *
 * Re-exported through this module so a caller need not decide between two
 * imports for one concept. The sort is by stored rank FIRST, so an explicit
 * ranking is never overridden — a P1 can therefore never appear after a P3, and
 * a test pins it.
 */
export function queuePositions(entries: QueueEntry[]): Map<string, number> {
  return activeQueuePositions(entries);
}
