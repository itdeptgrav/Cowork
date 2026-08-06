import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";
import {
  type LegacyCompletionStatus,
  type LegacyStatus,
  type LegacyTimerSession,
  isTerminal,
  readCompletionStatus,
  timerSessionPath,
  totalSeconds,
  windowSeconds,
} from "./wire.ts";

/**
 * Tasks, from the legacy engine.
 *
 * **Fetch, map, help. No rules.** Every lifecycle decision — who may confirm,
 * what a deadline becomes, when a score fires — belongs to `taskForward.js` and
 * `c1Service.js`. This module posts to them and reshapes what comes back.
 *
 * The clearest statement of that boundary: there is no deadline arithmetic here.
 * `POST /task/:id/propose-deadline` is a call, not a calculation.
 *
 * ## Where task data lives
 *
 * | Concern | Location | Reached by |
 * |---|---|---|
 * | Task documents | Firestore `cowork_tasks` | **Browser in legacy**; proxy here |
 * | Lifecycle transitions | `taskForward.js` | HTTP |
 * | Timers | `cowork_task_timers/{employeeId}/sessions/{taskId}` | **Browser only** |
 * | Work commits | `cowork_work_commits` | Browser + API |
 * | Priority rank | `cowork_tasks.priority` | **Browser only** |
 * | Requests | `cowork_requests` | Browser only |
 *
 * The rows marked "browser only" have **no REST endpoint at all**. Legacy writes
 * them straight from the client, which is why this module exposes reads and
 * mappers for them but routes their writes through the proxy — the only way to
 * keep the data identical while putting a server back in the path.
 */

/* ── The task document ────────────────────────────────────────────────────── */

/**
 * A `cowork_tasks` document as legacy stores it.
 *
 * Partial by necessity: Firestore declares no schema, and legacy carried ~25
 * deadline-related fields on this document plus a flag per task variant. Fields
 * are optional because they genuinely are — a document written before a feature
 * shipped simply lacks its fields.
 */
export interface LegacyTaskDoc {
  /**
   * The task's meeting summary, written by the session-end credit.
   *
   * `unknown` like every other raw field here: the document is written by two
   * applications and read tolerantly, so the parse decides the shape rather
   * than the declaration promising one.
   */
  meetingFirstStartedAt?: unknown;
  meetingLastEndedAt?: unknown;
  meetingTotalSecs?: unknown;
  id?: string;
  title?: string;
  description?: string;
  notes?: string;
  requirements?: unknown;
  completionRequirementsFailed?: unknown;
  c1?: { isExcluded?: unknown; c1Status?: unknown } | null;
  budgetNegotiation?: unknown;
  proposedDeadline?: unknown;
  proposedDeadlineBy?: unknown;
  proposedDeadlineByName?: unknown;
  proposedDeadlineAt?: unknown;
  deadlineWindowSecsBeforeProposal?: unknown;
  reworkHistory?: unknown;

  /** The two parallel state axes. Both are live; neither derives the other. */
  status?: LegacyStatus | string;
  completionStatus?: LegacyCompletionStatus | string;

  assigneeIds?: string[];
  assignedBy?: string;
  assignedByName?: string;
  createdBy?: string;
  createdByName?: string;
  approverId?: string;
  approverName?: string;
  visibleTo?: string[];
  groupId?: string | null;
  parentTaskId?: string | null;

  /** Numeric rank per assignee queue. 1 = highest. */
  priority?: number;
  /** Legacy's drag tie-break, `(index + 1) * 1000`. Written beside the rank. */
  order?: number;

  /**
   * Rank **per person**, keyed by employee id.
   *
   * The engine writes one entry per assignee at creation — each is that
   * person's open-task count plus one (`taskForward.js:296-303`). `priority` is
   * only the first assignee's, so on a shared task it is somebody else's rank.
   * The old task page orders by `assigneePriorities[me] ?? priority ?? 999`.
   */
  assigneePriorities?: Record<string, number>;

  /** The TL who set the hours estimate. Puts the task in their "Created" tab. */
  tlHoursSetBy?: string;

  /**
   * The original sender, preserved across a forward.
   *
   * `taskForward.service.js:352` writes it at creation and forwarding leaves it
   * alone, so it still names whoever set the work going. The Submitted tab
   * uses it to keep a forwarded task in front of the person who owns the
   * outcome.
   */
  originalAssignedBy?: string;

  /** The engine's submission record. `submittedBy` is who filed it. */
  completionSubmission?: { submittedBy?: string } | null;

  /** Assignees who have acknowledged receipt. `confirmTaskReceipt` appends. */
  confirmedBy?: string[];
  /** Set by `markTaskStarted`. Its presence is what "work has begun" means. */
  startedAt?: string | number | { seconds?: number; _seconds?: number } | null;

  /** Children, maintained by the engine's `arrayUnion` on subtask create. */
  subtaskIds?: string[];
  /**
   * Which of the PARENT's completion requirements this subtask closes.
   *
   * A new-product concept the engine stores verbatim — see the note on
   * `LegacyTask.satisfiesRequirementIds`. Absent on every document written
   * before the subtask route began forwarding it, which is why it is read
   * defensively rather than assumed.
   */
  satisfiesRequirementIds?: unknown;
  /** Marks a doc as forward-created, so its parent chain can be hidden. */
  isForwardedTask?: boolean;

  /** The assignee a cross-department gate is holding. */
  pendingAssigneeId?: string | null;
  /** One entry per approving side. Both must clear before the assignee lands. */
  departmentApprovals?: {
    approverId?: string;
    approverName?: string;
    /** `sender` clears first; `receiver` waits for it. */
    side?: string;
    /** `pending` · `waiting` · `approved` · `rejected`. */
    status?: string;
    respondedAt?: string | null;
    rejectionReason?: string | null;
  }[] | null;

  hasTimer?: boolean;
  fixedDeadline?: string | number | null;
  deadline?: string | number | null;
  dueDate?: string | number | null;
  senderTimerWindowSecs?: number;
  /**
   * The agreed working window. Written when a proposal is approved, or when
   * the assignee accepts the assignor's preset (`approve-sender-timer` copies
   * `senderTimerWindowSecs` into it). Its presence is what "settled" means.
   */
  deadlineWindowSecs?: number | null;
  /** Every proposal, counter and decision, appended by the engine. */
  deadlineHistory?: unknown[];
  etcHours?: number;

  /* Variant flags — legacy models every task type as a boolean on one shape. */
  isFolder?: boolean;
  isRepeat?: boolean;
  isThirdParty?: boolean;
  isGoal?: boolean;
  isSelfAssigned?: boolean;
  isGoldTask?: boolean;
  createdByTl?: boolean;

  repeatConfig?: unknown;
  thirdPartyConfig?: unknown;
  goalConfig?: unknown;
  c2Config?: unknown;

  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
}

/** What the type flags amount to. Legacy has no `type` field. */
export type LegacyTaskKind =
  | "standard" | "folder" | "repeat" | "third_party"
  | "goal" | "self_assigned";

/**
 * The task variant, derived from legacy's boolean flags.
 *
 * Order matters and is not arbitrary: legacy allows more than one flag on a
 * document, and its own routes test them in roughly this order. `isFolder`
 * first because a folder is a container and its other flags are meaningless;
 * `isGoal` before `isRepeat` because the goal routes claim a task regardless of
 * whether it repeats.
 *
 * **Folder and third-party are removed from the new product (D33)** but still
 * exist in legacy data. They are surfaced rather than hidden — a task the UI
 * cannot render is better shown as unsupported than silently dropped.
 */
export function readKind(doc: LegacyTaskDoc): LegacyTaskKind {
  if (doc.isFolder) return "folder";
  if (doc.isGoal) return "goal";
  if (doc.isThirdParty) return "third_party";
  if (doc.isRepeat) return "repeat";
  if (doc.isSelfAssigned) return "self_assigned";
  return "standard";
}

export interface LegacyTask {
  id: string;
  title: string;
  description: string | null;
  kind: LegacyTaskKind;
  /** Raw, both axes, exactly as stored. */
  status: string | null;
  completionStatus: string | null;
  /** `completionStatus` with legacy's duplicate spellings collapsed. */
  reviewState: ReturnType<typeof readCompletionStatus>;
  /** True when the engine considers this finished — legacy's own list. */
  isTerminal: boolean;
  assigneeIds: string[];
  createdById: string | null;
  approverId: string | null;
  priority: number | null;
  /**
   * The drag handler's tie-break, `(index + 1) * 1000`.
   *
   * Dropped before, which cost nothing while ranks were shown raw. It matters
   * now that queue positions are derived: two tasks sharing a rank would
   * otherwise fall back to whatever order Firestore returned, and the numbers
   * would shuffle between refreshes.
   */
  order: number | null;
  /** Acceptance criteria, in the order they were written. */
  requirements: string[];
  /**
   * The engine's own C1 record, where it has made one.
   *
   * Its EXISTENCE is what says a task is in the scoring population — the engine
   * writes one per task it tracks — and `isExcluded` is how it takes one back
   * out. 47 of 49 live tasks carry one.
   */
  c1: { isExcluded: boolean; status: string } | null;
  /**
   * A deadline proposal waiting on the assignor, where one is outstanding.
   *
   * The engine writes `proposedDeadline*` and moves the task to
   * `pending_deadline_approval`; nothing read them, so the assignor had no way
   * to see what had been asked for — and no way to answer it.
   */
  /**
   * The time-budget negotiation, where one is running.
   *
   * A task created with a sender window is ALREADY mid-negotiation — the
   * assignor has proposed and the assignee has not answered — so a task with no
   * stored record still reports that opening state rather than "nothing
   * happening". That is what lets existing tasks join the loop untouched.
   */
  budgetNegotiation: {
    state: string;
    currentSecs: number;
    proposedById: string;
    proposedByName: string;
    waitingForId: string | null;
    round: number;
    history: {
      roundNumber: number;
      previousSecs: number;
      proposedSecs: number;
      proposedById: string;
      proposedByName: string;
      waitingForId: string | null;
      reason: string;
      createdAt: string | null;
      decision: string | null;
      decidedById: string | null;
    }[];
  } | null;
  deadlineProposal: {
    proposedDueAt: string | null;
    requestedWindowSecs: number;
    previousWindowSecs: number;
    proposedById: string;
    proposedByName: string;
  } | null;
  /**
   * The criteria a reviewer marked as not met when sending work back.
   *
   * Written by the engine on every rework. Empty on a task that has never been
   * returned — which is different from "returned with nothing named", a state
   * the engine now refuses.
   */
  completionRequirementsFailed: string[];
  /**
   * Every time this work was sent back, oldest first.
   *
   * Appended by the engine, never overwritten — a second rework must not erase
   * what the first one asked for, because the two together are the record of
   * how the work got where it is.
   */
  reworkHistory: {
    attempt: number;
    reviewerId: string;
    reviewerName: string;
    requirements: string[];
    reason: string;
    note: string;
    attachments: {
      url: string;
      name: string;
      type: string;
      downloadUrl: string;
    }[];
    requestedAt: string | null;
  }[];
  /**
   * Creation time, epoch ms.
   *
   * The last tie-break in a derived queue: where a rank and a drag order do not
   * separate two tasks, the one that has been waiting longer goes first.
   */
  createdAtMs: number | null;
  /**
   * The task's meeting summary, as stored.
   *
   * Absent on every task written before meetings existed, which is why all
   * three are nullable rather than defaulted at this layer — the mapper decides
   * what "no meetings" looks like in the domain, and a zero invented here would
   * be indistinguishable from a task that genuinely had none.
   */
  meetingFirstStartedAtMs: number | null;
  meetingLastEndedAtMs: number | null;
  meetingTotalSecs: number | null;
  /** Legacy's only close stamp. There is no `completedAt` in the collection. */
  updatedAtMs: number | null;
  /** Per-person rank. Empty when the engine wrote none. */
  assigneePriorities: Record<string, number>;
  /** Set when a TL supplied the hours estimate for somebody else's task. */
  tlHoursSetBy: string | null;
  /** The original sender, unchanged by forwarding. */
  originalAssignedBy: string | null;
  /** The window the assignor set at creation. 0 when they set none. */
  senderWindowSecs: number;
  /** The settled window. Null until accepted or approved. */
  agreedWindowSecs: number | null;
  /** How many negotiation entries the engine has recorded. */
  deadlineHistoryCount: number;
  /** Assignees who have confirmed receipt. */
  confirmedByIds: string[];
  /** When work began, in ms. Null until the assignee starts. */
  startedAtMs: number | null;
  /** The assignee a cross-department gate is holding, if any. */
  pendingAssigneeId: string | null;
  /** Parent in the hierarchy. Null for a root task. */
  parentTaskId: string | null;
  /** Children, as the engine maintains them via `arrayUnion` on create. */
  subtaskIds: string[];
  /**
   * The parent requirements this subtask is answerable for.
   *
   * Ids in the domain's own vocabulary — `compositeId(parentId, "req-N")`,
   * where N is the position in the parent's `requirements` array. Legacy stores
   * requirements as bare strings with no identity of their own, so the position
   * IS the identity and the engine stores this array without interpreting it.
   *
   * Empty on a subtask created before the route forwarded the field, and on
   * anything broken out through legacy's own UI. Empty means "claims nothing"
   * — the subtask still exists, still shows under its parent, and simply does
   * not close a requirement.
   */
  satisfiesRequirementIds: string[];
  /** Created by a forward. Its parent chain stays hidden from the list. */
  isForwardedTask: boolean;
  /** Approver ids on a held task. Empty when the task is not gated. */
  departmentApproverIds: string[];
  /**
   * The gate's stages, in order, with who owns each and where it has got to.
   *
   * Only the ids were kept before, so the approval trail could say a task was
   * held and not who by, whose turn it was, or who came next — which is the
   * whole of what somebody looking at a held task needs.
   */
  departmentApprovals: {
    approverId: string;
    approverName: string;
    side: "sender" | "receiver" | null;
    status: "pending" | "waiting" | "approved" | "rejected";
    respondedAt: string | null;
    rejectionReason: string | null;
  }[];
  /** Who filed the completion submission, when one exists. */
  submittedById: string | null;
  /** Whether the assignee raised this task themselves, for an approver to clear. */
  isSelfAssigned: boolean;
  /** Extra viewers on a self-assigned task. */
  visibleTo: string[];
  hasTimer: boolean;
  /** Milliseconds since epoch, or null. See `readInstant`. */
  dueAtMs: number | null;
  isGoldTask: boolean;
  isDeleted: boolean;
}

/**
 * A legacy timestamp as milliseconds.
 *
 * Legacy stores dates as ISO strings, epoch numbers, and Firestore `Timestamp`
 * objects (`{seconds, nanoseconds}` or `{_seconds}` once serialised through
 * JSON) — sometimes in the same field across documents of different vintages.
 * Reading one form and ignoring the rest silently renders "no deadline" for
 * every task written by a different code path.
 */
export function readInstant(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    const seconds = v.seconds ?? v._seconds;
    if (typeof seconds === "number") {
      const nanos = (v.nanoseconds ?? v._nanoseconds ?? 0) as number;
      return seconds * 1000 + Math.floor(nanos / 1e6);
    }
    if (typeof v.toMillis === "function") {
      const ms = (v.toMillis as () => number)();
      return Number.isFinite(ms) ? ms : null;
    }
  }
  return null;
}

/**
 * The deadline, from whichever field carries it.
 *
 * Legacy writes `fixedDeadline`, `deadline` and `dueDate` depending on which
 * path created the task. `fixedDeadline` wins because it is what the create
 * endpoint accepts and therefore what an explicitly-set date lands in.
 */
export function readDueAtMs(doc: LegacyTaskDoc): number | null {
  return (
    readInstant(doc.fixedDeadline) ??
    readInstant(doc.deadline) ??
    readInstant(doc.dueDate)
  );
}

export function readTask(doc: LegacyTaskDoc): LegacyTask | null {
  if (!doc.id) return null;
  return {
    id: doc.id,
    title: doc.title?.trim() || "Untitled task",
    description: doc.description?.trim() || null,
    kind: readKind(doc),
    status: doc.status ?? null,
    completionStatus: doc.completionStatus ?? null,
    reviewState: readCompletionStatus(doc.completionStatus),
    isTerminal: isTerminal(doc.status),
    assigneeIds: Array.isArray(doc.assigneeIds) ? doc.assigneeIds.filter(Boolean) : [],
    createdById: doc.createdBy ?? doc.assignedBy ?? null,
    approverId: doc.approverId ?? null,
    priority: typeof doc.priority === "number" ? doc.priority : null,
    order: typeof doc.order === "number" ? doc.order : null,
    /*
     * The acceptance criteria, as the engine actually stores them.
     *
     * The wire type said `string`; every real document holds an ARRAY of
     * strings (`["shud match specs", "shud be luxurious"]` on T634, and 23 of
     * 48 tasks carry one). So this was never read, and the mapper wrote `[]` —
     * the assignee could not see what they were being asked to satisfy.
     *
     * A lone string is tolerated because the field is untyped at the source and
     * an older document may hold one; blank entries are dropped rather than
     * rendered as empty checkboxes.
     */
    requirements: (Array.isArray(doc.requirements)
      ? doc.requirements
      : typeof doc.requirements === "string"
        ? [doc.requirements]
        : []
    )
      .map((r) => (typeof r === "string" ? r.trim() : ""))
      .filter((r) => r !== ""),
    reworkHistory: (Array.isArray(doc.reworkHistory) ? doc.reworkHistory : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r, i) => ({
        attempt: typeof r.attempt === "number" ? r.attempt : i + 1,
        reviewerId: typeof r.reviewerId === "string" ? r.reviewerId : "",
        reviewerName:
          typeof r.reviewerName === "string" ? r.reviewerName : "",
        requirements: (Array.isArray(r.requirements) ? r.requirements : [])
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter((x) => x !== ""),
        reason: typeof r.reason === "string" ? r.reason : "",
        note: typeof r.note === "string" ? r.note : "",
        attachments: (Array.isArray(r.attachments) ? r.attachments : [])
          .filter(
            (a): a is Record<string, unknown> =>
              !!a && typeof a === "object" && typeof a.url === "string",
          )
          .map((a) => ({
            url: String(a.url),
            name: typeof a.name === "string" ? a.name : "attachment",
            type: typeof a.type === "string" ? a.type : "file",
            downloadUrl:
              typeof a.downloadUrl === "string" ? a.downloadUrl : String(a.url),
          })),
        /* The engine writes `sentBackAt`; `requestedAt` was never a field it
           produced, so every rework entry read back null. Checked against the
           live collection — all seven rework entries carry `sentBackAt` and
           none carries `requestedAt`. Both names are read so a document written
           under either is dated. */
        requestedAt:
          typeof r.sentBackAt === "string"
            ? r.sentBackAt
            : typeof r.requestedAt === "string"
              ? r.requestedAt
              : null,
      })),
    budgetNegotiation: (() => {
      const raw = doc.budgetNegotiation as Record<string, unknown> | undefined;
      const opening = Number(doc.senderTimerWindowSecs) || 0;
      /* Derived where absent, for the reason on the type above. */
      if (!raw || typeof raw !== "object") {
        if (opening <= 0) return null;
        /* **`pendingAssigneeId` FIRST**, matching the engine's own resolution
           in `department-tl-set-hours`:
           `task.pendingAssigneeId || task.assigneeIds?.[0]`.

           Reading `assigneeIds` alone disagreed with the engine on exactly the
           cross-department path, where the assignee is NOT added to `assigneeIds`
           until the hours are set — so the one person who could answer was not
           named, and the card rendered a wait with no button for anybody. */
        const assigneeId = (() => {
          const pending = doc.pendingAssigneeId;
          if (typeof pending === "string" && pending) return pending;
          const ids = Array.isArray(doc.assigneeIds) ? doc.assigneeIds : [];
          return ids[0] != null ? String(ids[0]) : null;
        })();
        const assignorId = String(doc.assignedBy ?? "");
        /* A SELF task reverses the opening. The CREATOR (the assignee) proposed
           the budget when they made the task; it is their MANAGER — the assigner
           of record in `assignedBy` — who approves or negotiates it. Without this
           flip a self task read as "your manager proposed and you accept", when
           the manager has not seen it yet. */
        const isSelf = doc.isSelfAssigned === true;
        if (isSelf) {
          return {
            state: "WAITING_FOR_ASSIGNOR",
            currentSecs: opening,
            proposedById: assigneeId ?? "",
            proposedByName: "",
            waitingForId: assignorId || null,
            round: 1,
            history: [],
          };
        }
        return {
          state: "WAITING_FOR_ASSIGNEE",
          currentSecs: opening,
          proposedById: assignorId,
          proposedByName:
            typeof doc.assignedByName === "string" ? doc.assignedByName : "",
          waitingForId: assigneeId,
          round: 1,
          history: [],
        };
      }
      return {
        state: typeof raw.state === "string" ? raw.state : "",
        currentSecs: Number(raw.currentSecs) || 0,
        proposedById: String(raw.proposedBy ?? ""),
        proposedByName:
          typeof raw.proposedByName === "string" ? raw.proposedByName : "",
        waitingForId: raw.waitingFor ? String(raw.waitingFor) : null,
        round: Number(raw.round) || 0,
        history: (Array.isArray(raw.history) ? raw.history : [])
          .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
          .map((h) => ({
            roundNumber: Number(h.roundNumber) || 0,
            previousSecs: Number(h.previousBudgetSeconds) || 0,
            proposedSecs: Number(h.proposedBudgetSeconds) || 0,
            proposedById: String(h.proposedBy ?? ""),
            proposedByName:
              typeof h.proposedByName === "string" ? h.proposedByName : "",
            waitingForId: h.waitingFor ? String(h.waitingFor) : null,
            reason: typeof h.reason === "string" ? h.reason : "",
            createdAt: typeof h.createdAt === "string" ? h.createdAt : null,
            decision: typeof h.decision === "string" ? h.decision : null,
            decidedById: h.decidedBy ? String(h.decidedBy) : null,
          })),
      };
    })(),
    deadlineProposal:
      doc.status === "pending_deadline_approval" && doc.proposedDeadlineBy
        ? {
            proposedDueAt:
              typeof doc.proposedDeadline === "string"
                ? doc.proposedDeadline
                : null,
            requestedWindowSecs: Number(doc.deadlineWindowSecs) || 0,
            previousWindowSecs:
              Number(doc.deadlineWindowSecsBeforeProposal) || 0,
            proposedById: String(doc.proposedDeadlineBy),
            proposedByName:
              typeof doc.proposedDeadlineByName === "string"
                ? doc.proposedDeadlineByName
                : "",
          }
        : null,
    c1:
      doc.c1 && typeof doc.c1 === "object"
        ? {
            isExcluded: (doc.c1 as { isExcluded?: unknown }).isExcluded === true,
            status:
              typeof (doc.c1 as { c1Status?: unknown }).c1Status === "string"
                ? ((doc.c1 as { c1Status: string }).c1Status)
                : "",
          }
        : null,
    completionRequirementsFailed: (Array.isArray(doc.completionRequirementsFailed)
      ? doc.completionRequirementsFailed
      : []
    )
      .map((r) => (typeof r === "string" ? r.trim() : ""))
      .filter((r) => r !== ""),
    createdAtMs: readInstant(doc.createdAt),
    meetingFirstStartedAtMs: readInstant(doc.meetingFirstStartedAt),
    meetingLastEndedAtMs: readInstant(doc.meetingLastEndedAt),
    meetingTotalSecs:
      typeof doc.meetingTotalSecs === "number" &&
      Number.isFinite(doc.meetingTotalSecs)
        ? doc.meetingTotalSecs
        : null,
    updatedAtMs: readInstant(doc.updatedAt),
    assigneePriorities:
      doc.assigneePriorities && typeof doc.assigneePriorities === "object"
        ? doc.assigneePriorities
        : {},
    tlHoursSetBy: doc.tlHoursSetBy ?? null,
    originalAssignedBy: doc.originalAssignedBy ?? null,
    senderWindowSecs:
      typeof doc.senderTimerWindowSecs === "number"
        ? doc.senderTimerWindowSecs
        : 0,
    agreedWindowSecs:
      typeof doc.deadlineWindowSecs === "number" ? doc.deadlineWindowSecs : null,
    deadlineHistoryCount: Array.isArray(doc.deadlineHistory)
      ? doc.deadlineHistory.length
      : 0,
    confirmedByIds: Array.isArray(doc.confirmedBy)
      ? doc.confirmedBy.filter(
          (v): v is string => typeof v === "string" && v !== "",
        )
      : [],
    startedAtMs: readInstant(doc.startedAt),
    pendingAssigneeId: doc.pendingAssigneeId ?? null,
    parentTaskId: doc.parentTaskId ?? null,
    subtaskIds: Array.isArray(doc.subtaskIds)
      ? doc.subtaskIds.filter(
          (id): id is string => typeof id === "string" && id !== "",
        )
      : [],
    satisfiesRequirementIds: Array.isArray(doc.satisfiesRequirementIds)
      ? doc.satisfiesRequirementIds.filter(
          (id): id is string => typeof id === "string" && id !== "",
        )
      : [],
    isForwardedTask: doc.isForwardedTask === true,
    departmentApproverIds: Array.isArray(doc.departmentApprovals)
      ? doc.departmentApprovals
          .map((a) => a?.approverId)
          .filter((id): id is string => typeof id === "string" && id !== "")
      : [],
    departmentApprovals: Array.isArray(doc.departmentApprovals)
      ? doc.departmentApprovals
          .filter((a) => typeof a?.approverId === "string" && a.approverId !== "")
          .map((a) => ({
            approverId: a.approverId as string,
            approverName: typeof a.approverName === "string" ? a.approverName : "",
            side:
              a.side === "sender" || a.side === "receiver" ? a.side : null,
            /* `waiting` is a real stage, not a variant of pending: the receiving
               side cannot act until the sending side clears. Collapsing the two
               would show two people as owing an action when only one does. */
            status:
              a.status === "approved" ||
              a.status === "rejected" ||
              a.status === "waiting"
                ? a.status
                : "pending",
            respondedAt: typeof a.respondedAt === "string" ? a.respondedAt : null,
            rejectionReason:
              typeof a.rejectionReason === "string" ? a.rejectionReason : null,
          }))
      : [],
    submittedById: doc.completionSubmission?.submittedBy ?? null,
    isSelfAssigned: doc.isSelfAssigned === true,
    visibleTo: Array.isArray(doc.visibleTo) ? doc.visibleTo.filter(Boolean) : [],
    hasTimer: doc.hasTimer === true,
    dueAtMs: readDueAtMs(doc),
    isGoldTask: doc.isGoldTask === true,
    isDeleted: readInstant(doc.deletedAt) !== null,
  };
}

export function readTasks(docs: readonly LegacyTaskDoc[]): LegacyTask[] {
  return docs.map(readTask).filter((t): t is LegacyTask => t !== null);
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

/** `GET /cowork/task/:taskId/details`. */
export async function getTask(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<LegacyTask>> {
  const r = await legacyFetch<LegacyTaskDoc>({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/details`,
    envelopeKey: "task",
    token: input.token,
  });
  if (!r.ok) return r;
  const task = readTask({ id: input.taskId, ...r.data });
  return task
    ? { ok: true, data: task }
    : {
        ok: false,
        error: { message: "That task record is incomplete.", status: 0, kind: "malformed" },
      };
}

/** `GET /cowork/task/list-hierarchy`. */
export async function listTaskHierarchy(
  token: string,
): Promise<LegacyResult<LegacyTask[]>> {
  const r = await legacyFetch<LegacyTaskDoc[]>({
    path: "/cowork/task/list-hierarchy",
    envelopeKey: "tasks",
    token,
  });
  return r.ok ? { ok: true, data: readTasks(r.data) } : r;
}

/* ── Lifecycle — calls, never calculations ────────────────────────────────── */

/**
 * `POST /cowork/task/create`.
 *
 * The body is legacy's 26-field shape, passed through unchanged. It is typed
 * rather than validated: **the engine decides what is acceptable**, and a
 * second validator here would eventually disagree with it — refusing something
 * legacy allows, or allowing something it refuses and turning a clear message
 * into an unexplained 400.
 */
export interface CreateTaskInput {
  title: string;
  description?: string;
  notes?: string;
  requirements?: string;
  assigneeIds: string[];
  priority?: number;
  parentTaskId?: string | null;
  groupId?: string | null;
  createdByTl?: boolean;
  isFolder?: boolean;
  isRepeat?: boolean;
  repeatConfig?: unknown;
  isThirdParty?: boolean;
  thirdPartyConfig?: unknown;
  isGoal?: boolean;
  goalConfig?: unknown;
  hasTimer?: boolean;
  fixedDeadline?: string | null;
  isSelfAssigned?: boolean;
  visibleTo?: string[];
  approverId?: string;
  approverName?: string;
  senderTimerWindowSecs?: number;
  isGoldTask?: boolean;
  c2Config?: unknown;
  etcHours?: number;
}

export async function createTask(input: {
  token: string;
  task: CreateTaskInput;
}): Promise<LegacyResult<{ taskId?: string }>> {
  return legacyFetch({
    path: "/cowork/task/create",
    method: "POST",
    token: input.token,
    body: input.task,
  });
}

/** One lifecycle transition. Each is a bare POST; the engine owns the rules. */
export type TaskAction =
  | "confirm" | "start" | "approve" | "submit-completion"
  | "review-completion" | "ceo-review" | "rework" | "reset-to-draft"
  | "self-assign-approve" | "department-approve"
  | "repeat-confirm" | "repeat-submit"
  | "third-party-update" | "third-party-complete"
  | "goal-update"
  | "propose-deadline" | "approve-deadline"
  | "tl-counter-deadline" | "respond-tl-counter"
  | "request-deadline-extension" | "review-deadline-extension"
  | "approve-sender-timer" | "reject-sender-timer"
  | "extension-deduction";

/**
 * Perform a lifecycle transition.
 *
 * ⚠ `review-completion` **has no authorisation check in legacy** — any
 * authenticated employee can approve or reject any task and fire its C1 score.
 * It must be called through the proxy, which applies the CEO-or-TL gate legacy
 * omits. See `UNGATED_LEGACY_ENDPOINTS` in `permissions.ts`.
 */
export async function taskAction(input: {
  token: string;
  taskId: string;
  action: TaskAction;
  body?: unknown;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/${input.action}`,
    method: "POST",
    token: input.token,
    body: input.body ?? {},
  });
}

/**
 * `POST /cowork/task/p1-conflict-check`.
 *
 * Legacy's own answer to "does promoting this task collide with another P1".
 * Called rather than reimplemented — the new project has its own cascade model
 * in `lib/rules/tasks/priorityCascade.ts`, and running both would give two
 * answers to one question.
 */
export async function checkPriorityConflict(input: {
  token: string;
  body: unknown;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: "/cowork/task/p1-conflict-check",
    method: "POST",
    token: input.token,
    body: input.body,
  });
}

/* ── Timers ───────────────────────────────────────────────────────────────── */

/**
 * A timer session in the shape the UI needs.
 *
 * **No elapsed time is computed here.** Legacy's timer is a stored base plus a
 * running anchor, and the arithmetic that turns those into a display value
 * lives in its `useTaskTimer` hook. Reimplementing it would produce a second
 * clock that disagrees with the one the engine commits work against.
 */
export interface LegacyTimer {
  taskId: string | null;
  /** Committed seconds. Accepts either of legacy's two field names. */
  totalSecs: number;
  /** The budget, where one is set. Null is "no budget", not zero. */
  windowSecs: number | null;
  startedAtMs: number | null;
  isRunning: boolean;
}

export function readTimer(session: LegacyTimerSession): LegacyTimer {
  const startedAtMs = readInstant(session.startedAt);
  return {
    taskId: session.taskId ?? session.activeTaskId ?? null,
    totalSecs: totalSeconds(session),
    windowSecs: windowSeconds(session),
    startedAtMs,
    /* Legacy has no explicit running flag: a session with a start time and no
       stop is the running one. */
    isRunning: startedAtMs !== null,
  };
}

export { timerSessionPath };

/**
 * Remaining budget, or null when the task has none.
 *
 * Subtraction only — the *rule* about what happens when it reaches zero
 * ("deadline or budget, whichever comes first") is a **new** concept with no
 * legacy equivalent, and it lives in `lib/rules/`, not here. This provides the
 * number that rule reads.
 */
export function remainingSecs(timer: LegacyTimer): number | null {
  if (timer.windowSecs === null) return null;
  return Math.max(0, timer.windowSecs - timer.totalSecs);
}

/* ── Extension points ─────────────────────────────────────────────────────── */

/**
 * Where the new task rules attach, and why they are not applied here.
 *
 * Four approved rules in the new product have **no legacy equivalent**:
 * single-assignee for standard tasks, self-assigned-equals-creator, office-hours
 * deadlines, and budget-or-deadline termination. Legacy enforces none of them,
 * and its data does not satisfy them — there are live multi-assignee standard
 * tasks in `cowork_tasks`.
 *
 * Applying them in the adapter would mean the UI refusing to display data the
 * engine considers valid. So they are **evaluated above this layer**, against
 * the mapped task, and reported rather than enforced:
 *
 * ```ts
 * const task = readTask(doc);
 * const problems = newRuleReport(task);   // caller's own rules module
 * ```
 *
 * `conflictsWithNewRules` names the mismatches so a migration screen can list
 * them. It reports; it never rewrites.
 */
export function conflictsWithNewRules(task: LegacyTask): string[] {
  const problems: string[] = [];

  if (task.kind === "standard" && task.assigneeIds.length > 1) {
    problems.push(
      `Legacy allows ${task.assigneeIds.length} assignees on a standard task; the new rule permits one.`,
    );
  }
  if (task.kind === "folder") {
    problems.push("Folders were removed from the new product (D33).");
  }
  if (task.kind === "third_party") {
    problems.push("Third-party tasks have no surface in the new product.");
  }
  return problems;
}
