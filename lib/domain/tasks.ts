/**
 * The task aggregate.
 *
 * One `status` axis, not two. Legacy ran `status` and `completionStatus` in
 * parallel, unsynchronised, which is the single largest source of confusion in
 * the old system (docs/specs/TASK_LOGIC_SPEC.md §10.1). Review position lives on the
 * submission here, not in a second enum.
 */

import type { EmployeeId } from "./identity";
import type { MessageAttachment } from "./work";

export type TaskId = string;

/** docs/specs/TASK_LOGIC_SPEC.md §10.4 — the canonical machine. */
export type TaskStatus =
  | "draft"
  | "pending_approval"
  | "assigned"
  | "deadline_negotiation"
  | "confirmed"
  | "in_progress"
  | "in_review"
  | "completed"
  | "cancelled"
  | "assignment_rejected";

/**
 * Five near-identical legacy `pending_*` statuses collapse into one status plus
 * a typed reason.
 */
export type ApprovalReason =
  | "tl_assignment"
  | "cross_department"
  | "ceo_assignment"
  | "effort_estimate"
  | "self_assignment"
  | "recurrence";

export type TaskType =
  "standard" | "recurring" | "goal" | "external" | "self_assigned";

export interface RecurrenceConfig {
  cadence: "daily" | "weekly" | "monthly";
  slotsPerOccurrence: number;
  slotLabels: string[];
  activeFrom: string;
  activeTo: string | null;
}

export type DeadlineMode = "timer" | "fixed";

export type DeadlineState =
  "unset" | "proposed" | "countered" | "agreed" | "extension_pending";

export interface TaskDeadline {
  mode: DeadlineMode;
  originalWindowSecs: number | null;
  currentWindowSecs: number | null;
  dueAt: string | null;
  /**
   * The ONLY field scoring reads. Separate from `dueAt` on purpose: a waived
   * extension moves the scored deadline, a charged one does not. Legacy called
   * this `c1.officialDeadline` and the separation was correct.
   */
  officialDueAt: string | null;
  /**
   * When this will REALLY be finished, from the assignee's queue.
   *
   * The chain: everything ahead of it in their queue, then its own accepted
   * budget, walked through the office calendar. Null when it cannot be derived
   * — no queue was fetched, no settled budget, or the calendar could not be
   * read — and never a guess.
   *
   * Distinct from `dueAt`/`officialDueAt`, which are legacy's STORED figure:
   * assignment time plus the budget, as if the person were free the moment
   * they were given the work. That is the COMMITMENT, and what scoring
   * measures. It is not when the work happens, and for anybody with a queue
   * the two differ by everything ahead of it.
   */
  operationalDueAt: string | null;
  state: DeadlineState;
  /**
   * The assignee's refusal of the window the assignor set, if they refused it.
   *
   * Legacy's `senderTimerRejected` / `senderTimerRejectionReason`
   * (`taskForward.js:1763`). A budget task begins with the assignor proposing an
   * amount of working time; the assignee accepts it — which is what fixes the
   * due date — or refuses it with a reason and proposes their own instead.
   * Refusing does NOT move the task's status: legacy left it `open` so the
   * person could immediately propose an alternative.
   */
  assignorWindowRejection: {
    byId: EmployeeId;
    byName: string;
    reason: string;
    at: string;
  } | null;
}

/**
 * One completion requirement on a task.
 *
 * Requirements were `string[]` — a bulleted list rendered under a check icon
 * that never changed colour. They are entities now because the hierarchy model
 * turns them into the thing that actually decides completion: a project is done
 * when every requirement is satisfied, and a subtask exists to satisfy one.
 *
 * Satisfaction has two shapes and both are recorded, because "who finished
 * this" is the question an owner asks about a stalled project:
 *
 *  · **Directly** — the owner ticks it off. `satisfiedById` names them.
 *  · **By delegation** — a subtask claiming this requirement completed. The
 *    requirement is then satisfied by derivation, not by a flag, so it cannot
 *    drift from the subtask's real status.
 */
export interface CompletionRequirement {
  id: string;
  text: string;
  order: number;
  /**
   * Set ONLY for a direct tick. A requirement satisfied through subtasks leaves
   * this null and is computed from them — storing both would create two answers
   * to one question and no rule for which wins.
   */
  satisfiedAt: string | null;
  satisfiedById: EmployeeId | null;
}

/**
 * A task's meeting history, in three numbers.
 *
 * `firstStartedAt` is never overwritten and `lastEndedAt` always is, so the two
 * bracket the whole history while `totalSecs` counts only the meetings
 * themselves. They are deliberately not derivable from one another: sessions at
 * 10:00–10:30 and 14:00–14:20 give a four-hour bracket and fifty minutes of
 * meeting, and reporting the bracket as the duration would credit four hours of
 * deadline for fifty minutes of talking.
 */
export interface TaskMeetingSummary {
  /** ISO. The first meeting this task ever had. Never rewritten. */
  firstStartedAt: string | null;
  /** ISO. The most recent meeting to end. */
  lastEndedAt: string | null;
  /**
   * Seconds of meeting credited to THIS task.
   *
   * Not only meetings opened from it: a session on any of the assignee's live
   * tasks credits every one of them, because the conversation informs the whole
   * of the work in front of them. See `creditTargets`.
   */
  totalSecs: number;
}

/**
 * One sitting in a task's room.
 *
 * The audit trail behind `TaskMeetingSummary`. Kept per session rather than
 * only as a total because the total alone cannot answer the question people
 * actually ask when a deadline moves — *which meeting was that, and who was
 * there?*
 */
export interface TaskMeetingSession {
  id: string;
  taskId: TaskId;
  /** ISO. When the room opened. */
  startedAt: string;
  /** ISO. Null while the session is still running. */
  endedAt: string | null;
  /**
   * Seconds credited — the span the task's CREATOR was present, not the length
   * of the call. A room the assignee sat in alone is worth zero, and that zero
   * is recorded rather than the session being discarded.
   */
  creditedSecs: number;
  /** Who was in the room, and when. Drives `creditedSecs`. */
  attendance: TaskMeetingAttendance[];
  /** Tasks this session has already credited — the idempotency key. */
  creditedTaskIds: TaskId[];
}

export interface TaskMeetingAttendance {
  employeeId: EmployeeId;
  joinedAt: string;
  /** ISO, or null for somebody still in the room. */
  leftAt: string | null;
  /**
   * ISO. The last beat from the browser that opened this row.
   *
   * **`leftAt: null` alone cannot mean "still here".** The only thing that
   * writes a departure is the leaving client, and the ordinary way out of a
   * meeting is closing the tab — which fires `beforeunload`, which cannot wait
   * for a round trip. So a lost write left somebody in the room for ever: the
   * session never reached "everybody has gone", never closed, never credited,
   * and the panel showed "Meeting running" over an empty room indefinitely.
   *
   * A row is presence while it is still being beaten. Absent on rows written
   * before this existed, which read as their `joinedAt` — so an old orphan
   * lapses rather than staying open for ever.
   */
  lastSeenAt?: string | null;
}

export interface Task {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: TaskId;
  reference: string;
  type: TaskType;
  status: TaskStatus;
  title: string;
  description: string | null;
  /**
   * What "done" means for this task, as checkable items.
   *
   * On a plain task these are acceptance criteria. On a task that has been
   * broken down they become the contract between the owner and their subtasks:
   * every subtask must claim at least one, and the parent cannot complete until
   * all of them are satisfied.
   */
  requirements: CompletionRequirement[];

  /**
   * Parent requirements this task is delegated to satisfy.
   *
   * Non-empty only on a subtask, and REQUIRED there: a subtask that contributes
   * to nothing is work nobody asked for, and the parent would have no way to
   * know whether it mattered. Enforced by `createSubtask`, not by the form.
   */
  satisfiesRequirementIds: string[];

  createdById: EmployeeId;
  createdByRoleId: string;
  /** Inherited down subtask chains so the review chain stays correct. */
  rootCreatorEmployeeId: EmployeeId;

  /**
   * The department the work belongs to.
   *
   * Legacy inferred this from whichever assignee happened to be first, which
   * made cross-department routing depend on assignment order. Stating it on the
   * task means the cross-department gate has something stable to compare
   * against, and work can be owned by a department before anyone is assigned.
   */
  departmentId: string | null;

  parentTaskId: TaskId | null;
  projectId: string | null;
  groupId: string | null;

  estimatedEffortSecs: number | null;
  deadline: TaskDeadline;
  /**
   * What the task's meetings add up to.
   *
   * A task's meeting exists so the people doing the work understand it before
   * they start, and that conversation is working time nobody spent on the task
   * — so it is credited back to the deadline, the fifth reason a due date may
   * move alongside a break, an offline span, an approved emergency and an
   * approved extension.
   *
   * A SUMMARY, denormalised onto the task for the same reason `nodeCount` sits
   * on a mindmap record: the panel that shows "45m of meetings" must not read a
   * session log to draw one line. The sessions themselves live in
   * `cowork_task_meetings/{taskId}/sessions`, and the rules that compute this
   * are in `lib/rules/meetings/meetingCredit.ts`.
   */
  meetings: TaskMeetingSummary;

  approvalReason: ApprovalReason | null;
  approverIds: EmployeeId[];
  /**
   * The work crossed a department boundary.
   *
   * True where the engine raised a SENDER-side department approval — the
   * cross-department gate writes one for each side, while the CEO-assignment
   * gate writes only a receiver-side row and is not a crossing.
   *
   * Load-bearing rather than descriptive: a task's MEETINGS settle by a
   * different rule when this is true — the clock runs only while both sides are
   * in the room, and everyone in that window is credited their own time against
   * their own queue. See `lib/rules/meetings/meetingCredit.ts`.
   */
  isCrossDepartment: boolean;
  /**
   * Assignees held back until a cross-department approval clears.
   *
   * Legacy's visibility gate, reproduced. `/task/create` wrote
   * `assigneeIds: departmentApprovalGate ? [] : assigneeIds` and parked the
   * person in `pendingAssigneeId`; `department-approve` moved them across with
   * `arrayUnion(finalAssigneeId)` only once every approver had agreed. Its own
   * comment gives the reason — "the task stays invisible to them until then".
   *
   * Nobody should see work on their list that two department heads have not yet
   * agreed to send them, and nobody should be able to start it.
   */
  pendingAssigneeIds: EmployeeId[];

  /** Recurring and external tasks do not score today — OWNER DECISION O20. */
  isScoreEligible: boolean;
  recurrence: RecurrenceConfig | null;
  goalId: string | null;

  isBlocked: boolean;
  blockedReason: string | null;

  tags: string[];

  createdAt: string;
  updatedAt: string;
  /** Soft delete. Legacy hard-deleted recursively and orphaned the ledger. */
  deletedAt: string | null;
}

/**
 * Priority lives here, per (task, employee), as a single `rank`.
 *
 * Legacy spread one concept across three fields (`priority`, `assigneePriorities`,
 * `order`) and wrote them client-side straight to Firestore with no permission
 * check and no audit (docs/specs/TASK_LOGIC_SPEC.md §2.4).
 */
export interface TaskAssignment {
  id: string;
  taskId: TaskId;
  employeeId: EmployeeId;
  /**
   * The STORED rank: 1–10, 1 highest, as a manager set it.
   *
   * **Always the stored figure, never a derived position.** This field used to
   * hold whichever of the two the read happened to produce — a queue position
   * when that person's queue had been fetched, the stored rank otherwise — and
   * the list and detail paths fetched different people's queues. The same viewer
   * therefore saw a different number for the same task on the two screens, both
   * labelled `P{n}`.
   *
   * Nothing rewrites it when a task closes, which is why it is the thing a
   * finished task reports ("was P3") and the SORT KEY the live position is
   * derived from — never the label.
   */
  rank: number;
  /**
   * This person's position among their live work, 1..N. Derived per read.
   *
   * Null where the read did not fetch THIS person's queue, which is the common
   * case: a list read fetches the viewer's queue only, so every other assignee's
   * position is genuinely unknown rather than zero. A caller must not fall back
   * to `rank` for it — they are different scales, and substituting one for the
   * other silently is the defect this field exists to have fixed.
   */
  queuePosition: number | null;
  /**
   * This person's position among work that is real but not yet in the queue
   * above — awaiting their acceptance, or awaiting a settled budget. 1..N,
   * derived per read, and its OWN independent sequence: never the same number
   * space as `queuePosition`, and never both populated for the one task.
   *
   * Null past acceptance (by then `queuePosition` is the answer), on a
   * container (a project holds no position, provisional or otherwise), and
   * wherever this person's queue was not the one fetched — the same
   * circumstances that leave `queuePosition` null.
   *
   * Exists because before it did, a pending task's displayed number was the
   * RAW stored rank — ungapped, and visibly wrong the moment a sibling task
   * became a container: three real subtasks would read P1, P3, P5 with
   * nothing at P2 or P4, the two missing numbers belonging to documents that
   * had stopped being workload but had not stopped holding a stored figure.
   */
  provisionalPosition: number | null;
  assignedAt: string;
  confirmedAt: string | null;
  startedAt: string | null;
  /** Resolves the multi-assignee attribution question — OWNER DECISION O9. */
  isScoreSubject: boolean;
}

export type TaskEventType =
  | "created"
  | "assigned"
  | "approval_requested"
  | "approval_decided"
  | "priority_changed"
  | "priority_cascaded"
  | "priority_acknowledged"
  | "deadline_proposed"
  | "deadline_countered"
  | "deadline_decided"
  | "budget_adjusted"
  | "deadline_change_requested"
  | "deadline_change_decided"
  | "extension_requested"
  | "extension_decided"
  | "confirmed"
  | "started"
  | "work_committed"
  | "report_submitted"
  | "submitted"
  | "reviewed"
  | "rework_requested"
  | "rejected"
  | "approved"
  | "edited"
  | "moved"
  | "reset_to_draft"
  | "cancelled"
  | "deleted"
  | "project_linked"
  | "project_unlinked"
  /* The hierarchy model's own events. `edited` would have carried them and
     said nothing: "edited" on a project that just had three areas delegated
     tells a reader far less than the delegation did. */
  | "subtask_added"
  | "requirement_satisfied"
  | "requirement_added";

/**
 * One append-only stream per task, replacing legacy's seven separate history
 * array shapes plus system chat messages.
 */
export interface TaskEvent {
  id: string;
  taskId: TaskId;
  sequence: number;
  type: TaskEventType;
  actorId: EmployeeId | "system";
  actorLabel: string;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

/**
 * A file attached to submitted work.
 *
 * The same four fields the engine already stores on a rework's attachments, so
 * one renderer serves both. `downloadUrl` is what a link points at; `url` is the
 * stored address and is what identifies the file.
 */
export interface TaskAttachment {
  url: string;
  name: string;
  type: string;
  downloadUrl: string;
}

export interface TaskSubmission {
  id: string;
  taskId: TaskId;
  attempt: number;
  submittedById: EmployeeId;
  submittedAt: string;
  message: string;
  /**
   * The attachment URLs alone. Kept because callers already read it.
   *
   * A URL is not something to show a person — it has no filename in it and
   * cannot be clicked — which is why `attachments` below exists beside it.
   */
  attachmentIds: string[];
  /**
   * The same files WITH their names and download links.
   *
   * **The reviewer's whole view of the work.** The engine stores
   * `completionSubmission.pdfAttachments` as objects carrying a name and a
   * download address, and this was being flattened to bare URL strings on the
   * way in — so the one screen that decides whether the work is acceptable had
   * a message, a date, and no way to open what was submitted.
   */
  attachments: TaskAttachment[];
  /** Ordered reviewer ids, resolved from the reporting chain at submission. */
  reviewChain: EmployeeId[];
  currentStage: number;
  /** Set when a later attempt replaces this one. Legacy overwrote silently. */
  supersededById: string | null;
  /** Computed against `deadline.officialDueAt` at submission time. */
  wasLate: boolean;
}

export type ReviewDecision = "approved" | "rework" | "rejected";

export interface TaskReview {
  id: string;
  submissionId: string;
  taskId: TaskId;
  stage: number;
  isFinalStage: boolean;
  reviewerId: EmployeeId;
  decision: ReviewDecision;
  reason: string | null;
  reviewedAt: string;
}

export interface ReworkRequest {
  id: string;
  reviewId: string;
  taskId: TaskId;
  occurrence: number;
  reason: string;
  requestedById: EmployeeId;
  requestedAt: string;
  previousDueAt: string | null;
  newDueAt: string | null;
  /** OWNER DECISION O18 — whether waiver survives, and who may waive. */
  deductionWaived: boolean;
  waiverReason: string | null;
}

export interface Rejection {
  id: string;
  reviewId: string;
  taskId: TaskId;
  reason: string;
  rejectedById: EmployeeId;
  rejectedAt: string;
  /** OWNER DECISION O19 — legacy allowed silent resubmission. */
  allowsResubmission: boolean;
}

export type ApprovalKind =
  | "assignment"
  | "self_assignment"
  | "cross_department"
  | "effort_estimate"
  | "completion";

export type ApprovalDecision = "pending" | "waiting" | "approved" | "rejected";

export interface Approval {
  id: string;
  taskId: TaskId;
  submissionId: string | null;
  kind: ApprovalKind;
  /** Sequential gate: a `waiting` entry becomes `pending` when the prior clears. */
  stage: number;
  side: "sender" | "receiver" | null;
  approverId: EmployeeId;
  approverName: string;
  decision: ApprovalDecision;
  reason: string | null;
  decidedAt: string | null;
}

export interface WorkCommit {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  taskId: TaskId;
  employeeId: EmployeeId;
  startedAt: string;
  endedAt: string;
  durationSecs: number;
  message: string | null;
  attachmentIds: string[];
  /**
   * Why the clock stopped.
   *
   * `logged_out` is legacy's own spelling (`DutyStatusToggle.jsx:284`) for the
   * automatic pause that fires when somebody leaves Online — a break, an
   * emergency, or signing off. It is kept verbatim rather than folded into
   * `auto` because the two answer different questions on a manager's screen:
   * `auto` is the deadline window running out with the person still at their
   * desk, and this is the person no longer being there. Reading one as the
   * other would put "ran out of time" against work that was simply stood up
   * from.
   */
  pauseReason:
    | "manual"
    | "task_switch"
    | "priority_ack"
    | "submission"
    | "auto"
    | "logged_out";
}

export interface TimerSession {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  taskId: TaskId;
  employeeId: EmployeeId;
  isActive: boolean;
  accumulatedSecs: number;
  /**
   * When this run began, on the PROTOTYPE clock.
   *
   * Kept for ordering and for the work commit's timestamps, so a session reads
   * consistently against every other record in the store.
   */
  startedAt: string | null;
  /**
   * When this run began, on the REAL clock (epoch ms).
   *
   * A stopwatch has to measure real time, and the prototype clock cannot: it
   * only moves when a mutation calls `tick()`, so it stands still for the whole
   * time somebody is actually working. Measuring a session against it produced
   * a duration that had nothing to do with how long the person worked.
   *
   * Persisted rather than held in memory so a reload mid-session can resume the
   * count from where it really is instead of from zero.
   */
  startedAtRealMs: number | null;
}

/**
 * A file hung off a daily report.
 *
 * Carries the name and type alongside the URL because a report's files are
 * listed back to a person, and a bare URL is not something anyone can read. The
 * legacy store keeps only `imageUrls` and `pdfAttachments` — flat arrays of
 * strings — so a report written by the old application resolves to entries
 * whose `name` is derived from the URL rather than recorded.
 */
export interface ReportAttachment {
  url: string;
  name: string;
  mimeType: string;
}

export interface DailyReport {
  id: string;
  taskId: TaskId;
  employeeId: EmployeeId;
  reportDate: string;
  message: string;
  progressPercent: number;
  /** URLs, for compatibility with the legacy shape. Prefer `attachments`. */
  attachmentIds: string[];
  attachments: ReportAttachment[];
  /**
   * A Cowork document written as part of this report.
   *
   * The long form of a report — what a text box cannot hold. Stored as a real
   * document (`cowork_documents`) rather than as HTML on the report, so it is
   * editable, shareable and searchable like every other document.
   */
  documentId: string | null;
  documentTitle: string | null;
  createdAt: string;
}

export interface Attachment {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  ownerId: EmployeeId;
  scope: {
    type:
      | "task"
      | "submission"
      | "message"
      | "report"
      | "goal_activity"
      | "project";
    id: string;
  };
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** In the prototype this is a synthetic handle, never a real upload. */
  storageKey: string;
  uploadedAt: string;
  deletedAt: string | null;
}

export interface TaskChatMessage {
  id: string;
  taskId: TaskId;
  /** `chat` is the working thread; `draft_chat` is pre-start negotiation. */
  thread: "chat" | "draft";
  senderId: EmployeeId | "system";
  senderName: string;
  text: string;
  attachmentIds: string[];
  /**
   * Whole attachment objects for inline rendering (image/pdf/voice/file).
   *
   * The task thread — like the message thread — stores attachments inline on
   * the message rather than in a separate collection, so the rendered object is
   * the stored object. `attachmentIds` remains the flat list of URLs for
   * callers that only need handles; `attachments` carries the kind, name, size
   * and the Drive `fileId` the media proxy needs to actually load the file.
   */
  attachments?: MessageAttachment[];
  messageType: "text" | "system" | "attachment";
  createdAt: string;
}

/**
 * A request to move the scored deadline, routed to whoever set it.
 *
 * The rule this exists to hold: an assignee-side manager may grow the BUDGET —
 * the working window their person gets — but may not move `officialDueAt`,
 * which is the only field scoring reads. Those two are the same number in the
 * timer model, so "budget freely, deadline never" would let a manager defeat
 * the second rule by exercising the first.
 *
 * The resolution: budget may grow up to `originalWindowSecs`, the window the
 * assignor set. Anything beyond that stops being a budget change and becomes
 * this — a request the assignor accepts or rejects. The assignor stays the
 * owner of the deadline decision without the budget becoming unusable.
 */
export interface DeadlineChangeRequest {
  id: string;
  taskId: TaskId;
  /** The assignee-side manager asking. */
  requestedById: EmployeeId;
  requestedByName: string;
  /** Who owns the decision — the person who set the deadline. */
  decidedById: EmployeeId;
  /** Seconds requested beyond the assignor's original window. */
  requestedWindowSecs: number;
  currentWindowSecs: number;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  decisionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
}
