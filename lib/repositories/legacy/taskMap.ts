import type { Employee, Task, TaskStatus, TaskType } from "@/lib/domain";
import { compositeId } from "./compositeId.ts";
import { completionState } from "../../rules/tasks/completion.ts";
import {
  holdersOf,
  resolveTaskPriority,
} from "../../rules/tasks/resolveTaskPriority.ts";
import { getPersonPriority } from "../../rules/tasks/priority.ts";
import { resolveTimeBudget } from "../../rules/tasks/resolveTimeBudget.ts";
import type { TaskView } from "@/lib/repositories/types";
import type { LegacyTask } from "@/lib/legacy/tasks";
import { LEGACY_ORGANISATION_ID } from "./map.ts";

/**
 * Legacy tasks as the domain's `TaskView`.
 *
 * Two systems with genuinely different models meet here, and the mapping is
 * lossy in one direction on purpose.
 *
 * **Status.** Legacy runs two parallel axes — `status` and `completionStatus` —
 * maintained independently. The domain has one `TaskStatus`. So the mapping
 * reads both and returns the single status that best describes the task, with
 * `completionStatus` winning where it is more specific: a task that is `open`
 * on one axis and `pending_tl_review` on the other is in review, and calling it
 * "assigned" would put it in the wrong column of every board.
 *
 * **Everything a TaskView carries that legacy does not send** — submissions,
 * proposals, approvals, chat counts, projects — is empty or null. Not because
 * the data does not exist in legacy, but because *this endpoint* does not
 * return it, and a count invented here would be a number on screen that nothing
 * measured.
 */

/**
 * Legacy's two state axes as one domain status.
 *
 * `completionStatus` is consulted first where it is set, because it is the more
 * specific of the two: legacy leaves `status` at `open` through an entire review
 * cycle while `completionStatus` moves through the stages.
 */
export function toTaskStatus(task: LegacyTask): TaskStatus {
  switch (task.reviewState) {
    case "awaiting_tl":
    case "awaiting_ceo":
    case "submitted":
      return "in_review";
    case "tl_rejected":
    case "ceo_rejected":
      /* Rejected work goes back to the assignee — it is in progress again, not
         cancelled. Legacy has no separate "rework" status. */
      return "in_progress";
    case "completed":
    case "approved":
    case "tl_approved":
    case "ceo_approved":
      return "completed";
    case "unknown":
      break;
  }

  switch (task.status) {
    /* ── The gates. ────────────────────────────────────────────────────────
       Every one of these was missing and fell through to `assigned`, which
       reads as "yours, go ahead" — the opposite of what they mean. A task
       waiting on a TL, on a cross-department approver, on an hours estimate,
       or on the assignee accepting a repeat, is held. The names are the
       engine's own, written by `taskForward.js:151-218` and
       `taskForward.service.js`. */
    case "pending_tl_approval":
    case "pending_department_approval":
    case "pending_tl_hours":
    case "repeat_pending_confirmation":
    case "pending":
      return "pending_approval";
    /* The old task page groups these with `open` in its Open tab
       (`page.js:6052`), so they are live-and-unstarted, not held. */
    case "open":
    case "pending_deadline_approval":
    case "deadline_approved":
      return "assigned";
    /* `confirmed` is grouped with `in_progress` by the old page
       (`page.js:6053`) — the assignee has accepted and is working. */
    case "in_progress":
    case "confirmed":
      return "in_progress";
    case "submitted":
      return "in_review";
    case "approved":
    case "completed":
    case "done":
    case "tl_final_approved":
    case "ceo_approved":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "rejected":
      return "assignment_rejected";
    default:
      /* An unrecognised status is not a guess at a workflow position. `assigned`
         is the neutral live state — it neither claims progress nor hides the
         task from a list. */
      return "assigned";
  }
}

/**
 * Legacy's variant flags as a domain `TaskType`.
 *
 * `folder` and `third_party` have no domain equivalent — both were removed by
 * decision D33. They map to `external`, the closest surviving type, so the task
 * still appears rather than vanishing from somebody's list.
 */
export function toTaskType(kind: LegacyTask["kind"]): TaskType {
  switch (kind) {
    case "goal":
      return "goal";
    case "repeat":
      return "recurring";
    case "self_assigned":
      return "self_assigned";
    case "third_party":
    case "folder":
      return "external";
    case "standard":
      return "standard";
  }
}

/**
 * Legacy stores approver names shouted — the real record reads "RISHEE RAY".
 *
 * Fine in a database column, wrong on a workflow diagram, where it reads as an
 * error rather than a name. Only fully-uppercase values are touched: a name
 * that already has case is left exactly as its owner wrote it, because
 * lowercasing "McDonald" or "de Souza" to fit a rule is worse than shouting.
 */
export function displayCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

/** Legacy's held states, as the reason the domain already models. */
function approvalReasonOf(status: string | null): Task["approvalReason"] {
  switch (status) {
    case "pending_department_approval":
      return "cross_department";
    case "pending_tl_hours":
      return "effort_estimate";
    case "pending_tl_approval":
      return "tl_assignment";
    default:
      return null;
  }
}

export function toTask(legacy: LegacyTask): Task {
  return {
    organisationId: LEGACY_ORGANISATION_ID,
    id: legacy.id,
    reference: legacy.id,
    type: toTaskType(legacy.kind),
    status: toTaskStatus(legacy),
    title: legacy.title,
    description: legacy.description ?? "",
    /*
     * What has to be true before this task can be submitted.
     *
     * Hardcoded `[]` here while the documents carried them all along — so the
     * one person who needs them, the assignee, was shown nothing. Legacy stores
     * plain strings with no per-item state, so `satisfiedAt`/`satisfiedById`
     * are null: the engine records no tick against an individual requirement,
     * and inventing one would put a checkbox on screen that nothing could ever
     * check. `order` is the array position, which is the order they were
     * written in.
     */
    requirements: legacy.requirements.map((text, i) => ({
      id: compositeId(legacy.id, `req-${i}`),
      text,
      order: i,
      satisfiedAt: null,
      satisfiedById: null,
    })),
    /*
     * Which of the parent's requirements this subtask closes.
     *
     * Hardcoded `[]` here, and `parentTaskId` hardcoded `null` below it — the
     * pair is why a subtask vanished the moment it was created. With no parent
     * id the child could not name what it was part of, and with no claims the
     * parent's requirements never read as delegated, so `completionState`
     * answered `isProject: false` and `ProjectPanel` rendered no Subtasks
     * section at all. The work existed in Firestore and on nobody's screen.
     *
     * Both are on the document. Read them.
     */
    satisfiesRequirementIds: legacy.satisfiesRequirementIds,
    createdById: legacy.createdById ?? "",
    createdByRoleId: "",
    rootCreatorEmployeeId: legacy.createdById ?? "",
    departmentId: "",
    parentTaskId: legacy.parentTaskId,
    projectId: null,
    groupId: null,
    /*
     * The task's time budget, from the task document.
     *
     * **Hardcoded `0` shipped here**, justified by "legacy's budget is on the
     * timer document, not the task". That was wrong: `senderWindowSecs` and
     * `agreedWindowSecs` are both on `cowork_tasks`, and the deadline block
     * twenty lines below has been reading them all along.
     *
     * So T646 calculated a correct expected completion — the engine reads the
     * document — while the Details panel showed "00:00:00 of 00:00:00", and
     * so did both timer views, both table cells and the overview totals. Six
     * surfaces rendering one zero the mapper had written.
     */
    estimatedEffortSecs: resolveTimeBudget(legacy),
    deadline: {
      /**
       * **Read from the document, not hardcoded.**
       *
       * This said `mode: "fixed"` with both windows `null`, on the reasoning
       * that legacy stores a date rather than a budget. That was wrong on the
       * facts: legacy stores `hasTimer`, `senderTimerWindowSecs` and
       * `deadlineWindowSecs` on the very same document, and they are what the
       * whole negotiation runs on.
       *
       * The cost was the same shape as `assignments: []` — `windowOnOffer`
       * requires `mode === "timer"` and a positive `currentWindowSecs`, so it
       * could never be true. An assignee whose manager had already set a two-day
       * window was asked to propose one from scratch, and the figure their
       * manager chose was never shown to them.
       */
      mode: legacy.hasTimer ? "timer" : "fixed",
      /* The assignor's figure — the ceiling a later extension may not exceed. */
      originalWindowSecs: legacy.senderWindowSecs || null,
      /* What is on the table now: the agreed window once settled, otherwise the
         assignor's offer. Null when nobody has named one. */
      /* The same reading as `estimatedEffortSecs` above — one resolver, so the
         Details panel and the deadline block cannot report different budgets
         for one task. Null rather than 0 where none was ever set: this field
         feeds "is a window on offer?", where absent and zero differ. */
      currentWindowSecs: resolveTimeBudget(legacy) || null,
      dueAt: legacy.dueAtMs === null ? null : new Date(legacy.dueAtMs).toISOString(),
      /* The scored deadline. Legacy keeps no separate official date, so the
         same value serves both — never a different one, which would make
         scoring disagree with what the assignee was shown. */
      officialDueAt:
        legacy.dueAtMs === null ? null : new Date(legacy.dueAtMs).toISOString(),
      /* Derived, never stored — and not derivable HERE: `toTask` sees one
         document and the chain needs the whole queue. `toTaskView` fills it in
         where a queue was actually fetched. */
      operationalDueAt: null,
      /**
       * The negotiation stage, from the engine's own status.
       *
       * `pending_deadline_approval` and `deadline_approved` are legacy's
       * words for "proposed" and "settled" — the two states this used to
       * collapse into a date being present or absent. A task whose proposal
       * was sitting with a manager read as `unset`, so the assignee was shown
       * the proposal form again and could send a second one.
       */
      state:
        legacy.status === "pending_deadline_approval"
          ? "proposed"
          : legacy.agreedWindowSecs !== null ||
              legacy.status === "deadline_approved" ||
              legacy.dueAtMs !== null
            ? "agreed"
            : "unset",
      assignorWindowRejection: null,
    },
    /*
     * WHY the task is held, independent of who is looking.
     *
     * Hardcoded null before, so every held task looked alike to the UI — a task
     * waiting on a department decision and one waiting for its hours are
     * different waits, and both mapped to the same bare `pending_approval`.
     * The timeline needs this: `pendingApprovals` only ever names the person
     * who can ACT, so everybody else would have seen no reason at all.
     */
    approvalReason: approvalReasonOf(legacy.status),
    approverIds: legacy.approverId ? [legacy.approverId] : [],
    /* The person a cross-department gate is holding the work for. Hardcoded
       empty before, so the approval trail could not name who the task was
       actually for — it renders `pendingAssignees` precisely when there are no
       assignees yet, and that list was always empty. */
    pendingAssigneeIds: legacy.pendingAssigneeId ? [legacy.pendingAssigneeId] : [],
    /*
     * Whether this task counts toward a score.
     *
     * This read `isGoldTask`, which is the C2 GOAL flag — `pmpService.js:562`
     * returns immediately from the goal-scoring write unless it is set. C1, the
     * ordinary task-execution score every task gets, does not consult it at
     * all. The two are different channels and the adapter conflated them.
     *
     * The cost was total rather than partial: `isGoldTask` is false on all 49
     * live tasks, so EVERY task in the product wore a "Not scored" chip while
     * 47 of them carried a C1 record the engine had written.
     *
     * The real rule, from the engine: a task is in the scoring population
     * unless it is cancelled, unless the engine marked its C1 record excluded,
     * or unless it is one of the kinds that do not score today — recurring and
     * third-party work, per OWNER DECISION O20. A task with no C1 record yet is
     * still eligible: the record appears when the engine first scores it, and
     * treating its absence as ineligible is the same mistake in a new place.
     */
    isScoreEligible:
      toTaskStatus(legacy) !== "cancelled" &&
      legacy.kind !== "repeat" &&
      legacy.kind !== "third_party" &&
      legacy.c1?.isExcluded !== true,
    recurrence: null,
    goalId: null,
    isBlocked: false,
    blockedReason: null,
    tags: [],
    createdAt: "",
    updatedAt: "",
    deletedAt: legacy.isDeleted ? new Date(0).toISOString() : null,
  };
}

/**
 * A full `TaskView`.
 *
 * `employeesById` resolves assignees against the directory, which is verified —
 * so an assignee either resolves to a real person or is omitted. A placeholder
 * employee would put an invented name on a task.
 */

/**
 * The approvals somebody can act on right now.
 *
 * Two stages live here, and the second was missing entirely.
 *
 * **The department gate** — `pending` entries from `departmentApprovals`, never
 * `waiting` ones. The engine flips a waiting entry to pending when the stage
 * before it clears; offering it early puts a button in front of somebody whose
 * decision the engine would refuse.
 *
 * **The budget** — `pending_tl_hours`. When the last department approval lands
 * on a task with `hasTimer === false`, the engine does NOT assign it: it sets
 * `status: "pending_tl_hours"` and deliberately leaves the person in
 * `pendingAssigneeId` (`taskForward.js:1083`), because the receiving department
 * must supply hours first. `department-tl-set-hours` then writes the window AND
 * does the `arrayUnion` that finally hands the task over.
 *
 * A task can also be CREATED into that state with no gate at all
 * (`taskForward.js:284`), which is why the responsible person is derived from
 * the endpoint's rule rather than from any recorded approver.
 *
 * Every part of the budget step existed except the trigger: `setEffortEstimate`
 * is wired, `EffortEstimateForm` is built and renders on
 * `mineApproval?.kind === "effort_estimate"` — but no `effort_estimate`
 * approval was ever produced, so the control had nothing to appear for.
 */
function pendingApprovalsFor(
  legacy: LegacyTask,
  viewer: { id: string },
  budgetOwner: Employee | null,
): TaskView["pendingApprovals"] {
  if (legacy.status === "pending_tl_hours") {
    /*
     * The engine authorises a RULE here, not a person:
     *
     *   `role !== "tl" || targetInfo.department !== callerDept` → 403
     *   "Only the assignee's own department TL can set hours for this task."
     *
     * So the question "who sets the budget" has no answer on the task document
     * — and on the no-gate path there is nothing to read even in principle.
     * The engine finds that department's TL at creation (`taskForward.js:276`),
     * uses them for ONE notification, and never persists them.
     *
     * Naming the receiver-side approver instead was wrong in both directions:
     * on the no-gate path there is none, and on the gate path they can be a
     * `primary_manager` who is not a TL in the assignee's department at all —
     * so the form would have appeared for somebody the endpoint then refused.
     *
     * Evaluating the endpoint's own predicate against the viewer is exact,
     * needs no record that does not exist, and covers both paths with one rule.
     */
    /* One test, and it is the endpoint's: are you the person who manages the
       assignee? Department no longer enters into it — a department lead who
       does not manage this person is refused, and a manager in another
       department is not. */
    if (!budgetOwner || budgetOwner.id !== viewer.id) return [];

    return [
      {
        id: compositeId(legacy.id, "effort-estimate"),
        taskId: legacy.id,
        submissionId: null,
        /* Not an approve/reject. It supplies a NUMBER, and supplying it is what
           converts the task from a fixed deadline into a budget — which is why
           it has its own control rather than the generic buttons. */
        kind: "effort_estimate" as const,
        stage: legacy.departmentApprovals.length,
        side: "receiver" as const,
        approverId: budgetOwner.id,
        approverName: budgetOwner.displayName,
        decision: "pending" as const,
        reason: null,
        decidedAt: null,
      },
    ];
  }

  return legacy.departmentApprovals
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.status === "pending")
    .map(({ a, i }) => ({
      id: compositeId(legacy.id, `approval-${i}`),
      taskId: legacy.id,
      submissionId: null,
      kind: "cross_department" as const,
      stage: i,
      side: a.side,
      approverId: a.approverId,
      approverName: displayCase(a.approverName),
      decision: a.status,
      reason: a.rejectionReason,
      decidedAt: a.respondedAt,
    }));
}

export function toTaskView(input: {
  legacy: LegacyTask;
  employeesById: ReadonlyMap<string, Employee>;
  viewerId: string;
  nowMs: number;
  /**
   * One person's live queue positions, and whose they are.
   *
   * The owner is carried because the queue is not always the viewer's: a
   * manager opening a report's task is shown the REPORT's position, which is
   * the only way the two of them see the same number for the same task.
   * Without it, the manager fell through to the stored rank and the employee
   * saw a derived one — the same task reading P2 and P1 on two screens.
   */
  queue?: {
    ownerId: string;
    positions: ReadonlyMap<string, number>;
    /* Chained operational dates for that same queue, keyed by task id. */
    dueDates?: ReadonlyMap<string, string>;
  };
  /** Legacy's role string for the viewer — `tl`, `ceo`, or an employee role. */
  viewerLegacyRole?: unknown;
  /** Banked work from the assignee's timer session. */
  loggedSecs?: number;
  /**
   * The assignee's manager, where a time budget is outstanding.
   *
   * Supplied rather than derived: it is a reporting question, and the reporting
   * line is in neither the task document nor the directory snapshot.
   */
  budgetOwner?: Employee | null;
  /**
   * This task's children, where the caller has read them.
   *
   * Supplied rather than fetched because the mapper is pure and a list of
   * fifty tasks must not make fifty more round trips. Absent means "not read",
   * NOT "none" — which is exactly the distinction the list path relies on: it
   * carries `subtaskIds` for the count and leaves the delegation state to the
   * detail page, which reads the documents.
   */
  subtasks?: LegacyTask[];
  /** The parent document, where this task has one and the caller read it. */
  parent?: LegacyTask | null;
  /**
   * The PARENT's children — this task's siblings, including itself.
   *
   * Needed to answer "is this subtask the only thing that requirement is
   * waiting on", which no single document can answer about itself.
   */
  parentSubtasks?: LegacyTask[];
}): TaskView {
  const { legacy, employeesById } = input;
  const task = toTask(legacy);

  /* The operational date, from the chain the queue builder computed. Set only
     for the person whose queue was fetched — claiming those dates for a second
     assignee would be reporting somebody else's week as this one's. */
  task.deadline.operationalDueAt = input.queue?.dueDates?.get(legacy.id) ?? null;

  const assignees = legacy.assigneeIds
    .map((id) => employeesById.get(id))
    .filter((e): e is Employee => e !== undefined);

  const dueAtMs = legacy.dueAtMs;
  const terminal = task.status === "completed" || task.status === "cancelled";

  /* Does this person hold the task at all? Pending counts: while a
     cross-department task waits at the gate its assignee sits in
     `pendingAssigneeId` and `assigneeIds` is empty. */
  const holders = holdersOf({
    assigneeIds: legacy.assigneeIds,
    pendingAssigneeIds: legacy.pendingAssigneeId
      ? [legacy.pendingAssigneeId]
      : [],
  });
  const holds = (id: string | null) => id !== null && holders.includes(id);

  return {
    task,
    /**
     * One record per assignee, built from the task document.
     *
     * This was `[]`, on the reasoning that legacy has no assignment entity and
     * synthesising one would invent provenance. The reasoning was sound and the
     * consequence was severe: `nextAction` decides whose move it is with
     * `view.assignments.some(a => a.employeeId === viewerId)`, so an empty list
     * meant **nobody was ever the assignee**. Every assignee saw the bystander
     * branch — "Awaiting deadline", "Awaiting confirmation", "Not started" —
     * and never the action that was theirs to take. The task was not stuck;
     * the person who could move it was never recognised.
     *
     * Nothing here is invented. Every field is read off the document, and the
     * ones legacy genuinely does not record stay null rather than being filled
     * with a plausible value:
     *
     * · `assignedAt` — legacy stamps a creation time on the task, never one
     *   per assignee, and a forward reassigns without recording when. Empty
     *   rather than borrowing the task's creation time, which would be a
     *   different fact wearing this one's name.
     * · `confirmedAt` — legacy records **who** confirmed (`confirmedBy[]`), not
     *   when. Presence in that array is the fact; the timestamp is null.
     * · `isScoreSubject` — every assignee is scored in legacy; there is no
     *   nomination step (owner decision O9 has no legacy counterpart).
     */
    /* PENDING INCLUDED. A cross-department task at the gate has an EMPTY
       `assigneeIds` and its person in `pendingAssigneeId`, so building this
       from `assigneeIds` alone produced no assignment at all for the one
       person holding the work — and `rankFor` falls back to these ranks, so
       their own task showed them a dash where their priority should be. */
    assignments: holders.map((employeeId) => ({
      id: `${legacy.id}:${employeeId}`,
      taskId: legacy.id,
      employeeId,
      /* `?? 0` was here, and **P0 is not a legacy priority level** — the scale
         is 1–10. A task whose rank had never been written rendered as "P0",
         which reads as a real, highest-possible priority rather than as an
         absent one. Legacy's own fallback is 999, its unranked sentinel; the
         display layer treats anything outside 1–10 as no rank at all. */
      /*
       * The queue owner's rank is their DERIVED position; everyone else's is
       * the stored number.
       *
       * This is what makes a manager and an employee read the same P-number off
       * the same task. `rankFor` falls back to these ranks whenever the viewer
       * is not an assignee, so leaving the owner's stored value here is exactly
       * how the manager's screen came to disagree with the assignee's.
       */
      /*
       * The derived position, FALLING BACK to the stored rank.
       *
       * `?? UNRANKED` was here, and it is the whole of the reported bug.
       * `activeQueuePositions` numbers only tasks in the live queue — it
       * deliberately omits anything closed, or whose budget is still being
       * negotiated. For those, `positions.get` is undefined, so the queue
       * OWNER got UNRANKED while everybody else got the stored number.
       *
       * That is why a manager saw P1/P2/P3 and the assignee saw dashes on the
       * same three tasks: the manager is not the queue owner, so they took the
       * `resolveTaskPriority` branch. The person the queue belongs to was the
       * only one who could not see it.
       *
       * A derived position is better when there is one — it closes the gaps a
       * finished task leaves. When there is none, the stored rank is still a
       * fact about the task, and showing it beats showing nothing.
       */
      /* **The STORED rank, always.** This used to hold whichever of the two
         numbers the read produced — a queue position where this person's queue
         had been fetched, the stored rank otherwise — and the list path fetches
         the VIEWER's queue while the detail path fetches the SUBJECT's. So a
         manager saw the assignee's derived position on the detail page and the
         stored priority in the list, for the same task, both as `P{n}`.

         The derived position now has its own field and cannot be mistaken for
         this one. */
      rank: resolveTaskPriority(legacy, employeeId),
      /* Present only where THIS person's queue was the one fetched. Null is the
         honest answer otherwise: a list read fetches one queue, so every other
         assignee's position is genuinely unknown. */
      queuePosition:
        input.queue && input.queue.ownerId === employeeId
          ? (input.queue.positions.get(legacy.id) ?? null)
          : null,
      assignedAt: "",
      confirmedAt: legacy.confirmedByIds.includes(employeeId) ? "" : null,
      startedAt: legacy.startedAtMs
        ? new Date(legacy.startedAtMs).toISOString()
        : null,
      isScoreSubject: true,
    })),
    assignees,
    pendingAssignees: legacy.pendingAssigneeId
      ? [employeesById.get(legacy.pendingAssigneeId)].filter(
          (e): e is Employee => e !== undefined,
        )
      : [],
    owner: legacy.createdById
      ? (employeesById.get(legacy.createdById) ?? null)
      : null,
    /* Logged effort lives on the timer subcollection, which needs the Firestore
       proxy. Zero is honest here; any other number would be invented. */
    /* Supplied by the reader, which has the timer session. Zero only where no
       session exists — which is a real zero, not a missing one. */
    loggedSecs: input.loggedSecs ?? 0,
    project: null,
    /*
     * MY position in MY queue — not the task's stored number.
     *
     * The engine writes one rank per assignee at creation, each being that
     * person's own open-task count plus one; `priority` alone is the FIRST
     * assignee's, so on a shared task it ordered everyone's list by one
     * colleague's queue position.
     *
     * That stored rank is now the SORT KEY rather than the label. Nothing
     * rewrites it when a task finishes, so displaying it raw left a completed
     * P1 holding slot 1 for ever while the work below it never moved up. The
     * position comes from `activeQueuePositions`, which numbers only the tasks
     * still in play — so closing one collapses the gap with no write at all.
     *
     * Where no queue was supplied (a single-task read has none), this falls
     * back to the stored rank: a number that may lag is better than a dash on a
     * task somebody was actually given.
     */
    /* `holdersOf`, not `assigneeIds`: while a cross-department task waits at
       the gate, the person who will do it is a PENDING assignee. Asking
       "is this in my queue?" of `assigneeIds` answered no for them, on their
       own task, at the exact stage they most need to know where it sits. */
    /* **Through the one authority.** The expression here was a fourth copy of
       the same "position if we have it, stored rank otherwise" decision, and it
       is exactly the decision that produced two numbers for one task. It is made
       once now, in `getPersonPriority`, which also says WHICH scale it returned —
       something this field never could. */
    myRank: !holds(input.viewerId)
      ? null
      : (getPersonPriority({
          /* **`toTaskStatus`, not `legacy.status`.** The authority asks
             `isActiveInQueue`, and legacy's raw field stays `open` through an
             entire review cycle while `completionStatus` moves — so the raw
             string would keep approved work holding a live position for ever.
             That is the trap the queue builder already documents. */
          task: { ...legacy, status: toTaskStatus(legacy) },
          subjectId: String(input.viewerId),
          queuePosition:
            input.queue && input.queue.ownerId === input.viewerId
              ? (input.queue.positions.get(legacy.id) ?? null)
              : null,
          viewerId: input.viewerId,
        }).rank ?? null),
    /*
     * What the rank was, whatever the status.
     *
     * Kept so a closed task can say "was P1" instead of showing a live-looking
     * position it no longer holds. It is a last-known value, not a reconstructed
     * one — no per-change priority history is persisted.
     */
    myStoredRank: holds(input.viewerId)
      ? resolveTaskPriority(legacy, input.viewerId)
      : null,
    latestSubmission: null,
    /*
     * The proposal waiting on the assignor.
     *
     * Hardcoded `null`, so a task sitting at `pending_deadline_approval` looked
     * to the UI exactly like one with nothing outstanding — which is why no
     * screen could show the assignor what had been asked for, and why nothing
     * called `decideDeadline`. The engine had the fields the whole time.
     */
    openProposal: legacy.deadlineProposal
      ? {
          id: compositeId(legacy.id, "deadline-proposal"),
          taskId: legacy.id,
          proposedById: legacy.deadlineProposal.proposedById,
          proposedDueAt: legacy.deadlineProposal.proposedDueAt ?? "",
          windowSecs: legacy.deadlineProposal.requestedWindowSecs,
          /* Additive only when there was a settled window to add to. The first
             negotiation on a task replaces the assignor's offer rather than
             extending it. */
          isExtension: legacy.deadlineProposal.previousWindowSecs > 0,
          previousWindowSecs:
            legacy.deadlineProposal.previousWindowSecs || null,
          /* Derived here rather than stored: `deadlineProposal` is legacy's
             WINDOW negotiation, which carries a total and a previous. The
             difference is the addition — safe on a pending proposal, where
             neither figure has been overwritten yet. An extension REQUEST is a
             different record and carries the amount explicitly. */
          addedSecs: legacy.deadlineProposal.previousWindowSecs > 0
            ? legacy.deadlineProposal.requestedWindowSecs -
              legacy.deadlineProposal.previousWindowSecs
            : null,
          /* Legacy stores no reason on the proposal record — the assignee's
             case is posted to the task chat instead. Null rather than an empty
             string, so a UI can say the reason is elsewhere instead of showing
             a blank quote. */
          reason: null,
          state: "pending" as const,
          decidedById: null,
          decisionReason: null,
          decidedAt: null,
          createdAt: "",
          expiresAt: null,
        }
      : null,
    openCounter: null,
    /*
     * The approvals actionable RIGHT NOW — the button's whole basis.
     *
     * Hardcoded `[]` before, which is why a department head looking at a task
     * held for their decision saw the timeline say "current action required"
     * and no Approve button anywhere: `TaskDetail` finds its approval with
     * `pendingApprovals.find(a => a.approverId === me)`, and an empty array
     * never finds anything.
     *
     * `pending` only, never `waiting`. The receiving side's entry is real but
     * not yet theirs to act on — the engine flips it to `pending` when the
     * sending side clears — and offering it early would put a button in front
     * of somebody whose approval the engine would refuse.
     */
    pendingApprovals: pendingApprovalsFor(
      legacy,
      { id: input.viewerId },
      input.budgetOwner ?? null,
    ),
    /*
     * Who the engine will accept a budget from, for a task waiting on one.
     *
     * Null on every other task. It is carried on the view rather than derived
     * in a component because it needs the directory, and a component that
     * looked people up by department would be re-deriving a permission rule the
     * engine already owns.
     */
    /*
     * What a reviewer asked to be corrected, and every time they have asked.
     *
     * `activeRework` is the CURRENT request — the criteria named on the last
     * rework — and is empty once the work has been resubmitted, because the
     * engine clears the failed list when a new submission arrives. The history
     * is kept whatever the status, so a resubmission hides the warning without
     * losing the record.
     */
    budgetNegotiation: legacy.budgetNegotiation,
    reworkRequested: legacy.completionRequirementsFailed,
    reworkHistory: legacy.reworkHistory,
    /* Kept for a self task as well as the `pending_tl_hours` stage. On a self
       task the assignee proposes the budget and it waits on their MANAGER, whom
       `#readTaskView` resolves into `budgetOwner` — and dropping it here (the
       old condition named only `pending_tl_hours`) is why the negotiation card
       said "waiting for the task's creator to decide": the manager is neither
       an assignee nor the creator, so with `budgetOwner` gone there was no name
       left to resolve the turn to. */
    budgetOwner:
      legacy.isSelfAssigned || legacy.status === "pending_tl_hours"
        ? (input.budgetOwner ?? null)
        : null,
    approvals: legacy.departmentApprovals.map((a, i) => ({
      id: compositeId(legacy.id, `approval-${i}`),
      taskId: legacy.id,
      submissionId: null,
      /* See the note on the pending list: this is a department gate, and
         calling it an assignment mislabels the decision being asked for. */
      kind: "cross_department" as const,
      stage: i,
      side: a.side,
      approverId: a.approverId,
      approverName: displayCase(a.approverName),
      decision: a.status,
      reason: a.rejectionReason,
      decidedAt: a.respondedAt,
    })),
    /* One entry per time the work was sent back — the figure the C1 score
       deducts from. Was hardcoded to 0, so the rework deduction NEVER applied:
       `projected = 1 − reworkCount × 0.2` sat at 1.0 forever and the "Rework × N"
       line never rendered. */
    reworkCount: Array.isArray(legacy.reworkHistory)
      ? legacy.reworkHistory.length
      : 0,
    isOverdue: dueAtMs !== null && !terminal && dueAtMs < input.nowMs,
    /*
     * How many children this task holds.
     *
     * From `subtaskIds` rather than from `input.subtasks`, so a list row that
     * read no child documents still reports the truth — the count is the one
     * fact the parent's own document already carries, and `signals.ts` renders
     * "holds 3 subtasks" from it.
     */
    subtaskCount: legacy.subtaskIds.length,
    chatCount: 0,
    /*
     * The completion gate, built by the rule that owns it.
     *
     * The comment here used to say "no requirements on this endpoint, which is
     * the ordinary case" — and it was wrong: the documents carry them, T634
     * holds two, and 23 of 48 tasks have them. The assignee, who is the one
     * person who needs to know what they are being asked to satisfy, was shown
     * nothing for the whole life of the task.
     *
     * `completionState` rather than a hand-built object, so the counts and the
     * gate agree with every other caller.
     *
     * `input.subtasks` is what makes a requirement read as DELEGATED, and
     * passing `[]` unconditionally is what hid every subtask ever created: with
     * no claimants `isProject` is false, and `ProjectPanel` renders its
     * Subtasks section only for a project. The caller supplies the children on
     * the detail path; a list row supplies none and each requirement stands on
     * its own, which is the honest answer for a read that did not ask.
     */
    completion: completionState(task, (input.subtasks ?? []).map(toTask)),
    parent: input.parent ? parentContext(task, input.parent, input) : null,
  };
}

/**
 * What a subtask needs to know about the project above it.
 *
 * The parent's own requirement state, filtered to the claims THIS child makes.
 * Computed over the parent's whole set of children — `subtasks` on the input is
 * the parent's, not the child's — because `isSoleClaimant` is a question about
 * siblings, and a child cannot answer it from its own document.
 *
 * A parent whose children were not read yields claims with `isSatisfied: false`
 * and `isSoleClaimant: false`. Both are the cautious answer: nothing is
 * reported as done that has not been shown to be done.
 */
function parentContext(
  child: Task,
  parentLegacy: LegacyTask,
  input: {
    employeesById: ReadonlyMap<string, Employee>;
    /** The PARENT's children, where the caller read them. Includes `child`. */
    parentSubtasks?: LegacyTask[];
  },
): TaskView["parent"] {
  const parentTask = toTask(parentLegacy);
  const state = completionState(
    parentTask,
    (input.parentSubtasks ?? []).map(toTask),
  );
  const claimed = new Set(child.satisfiesRequirementIds);

  return {
    id: parentTask.id,
    title: parentTask.title,
    reference: parentTask.reference,
    ownerName:
      input.employeesById.get(parentTask.createdById)?.displayName ?? null,
    claimedRequirements: state.requirements
      .filter((r) => claimed.has(r.requirement.id))
      .map((r) => ({
        id: r.requirement.id,
        text: r.requirement.text,
        isSatisfied: r.isSatisfied,
        isSoleClaimant:
          r.claimants.length === 1 && r.claimants[0]?.id === child.id,
      })),
  };
}
