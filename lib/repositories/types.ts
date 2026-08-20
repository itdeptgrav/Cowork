/**
 * Repository contracts.
 *
 * This is THE seam. UI components never touch mock data; they call domain hooks
 * which call these interfaces. Swapping `MockRepository` for `ApiRepository`
 * must require no change above this line (docs/architecture/MIGRATION_DECISIONS.md §5).
 *
 * Every method is async even where the mock resolves synchronously, so the
 * production implementation can be a real network call without any caller
 * changing shape.
 */

import type { AuditEntry } from "@/lib/rules/settings/audit";
import type {
  DeadlineExtensionRecord,
  TimeBudgetExtensionRecord,
} from "@/lib/rules/tasks/extensionRecords";
import type { AttachmentEntity, AttachmentMeta } from "@/lib/legacy/attachments";
import type { Feasibility } from "@/lib/rules/tasks/deadlineFeasibility";
import type {
  HelpArticle,
  HelpCategory,
  HelpSearchResult,
} from "@/lib/help/types";
import type { ActionableReason } from "@/lib/rules/tasks/actionable";
import type { CompletionState } from "@/lib/rules/tasks/completion";
import type { DutyMode, DutyHistoryEntry, DutySnapshot } from "@/lib/rules/presence/duty";
import type { OfficePolicy } from "@/lib/legacy/officePolicy";
import type {
  TimerSopConfig,
  TimerSopResult,
  TodayTarget,
} from "@/lib/rules/scoring/timerSop";
import type { MrfChatMessage, MrfRequest, MrfStatus, RawItemHit } from "@/lib/domain/mrf";
import type {
  MrfApprovalStats,
  MrfStats,
  NewMrfInput,
} from "@/lib/rules/mrf/lifecycle";
import type { ReportingNode } from "@/lib/legacy/hierarchy";
import type { TaskRules } from "@/lib/rules/settings/taskRules";
import type { WorkflowRouting } from "@/lib/rules/settings/workflowRouting";
import type { ScoringSettings } from "@/lib/rules/settings/scoringSettings";
import type { RuleOverrides } from "@/lib/rules/settings/ruleOverrides";
import type {
  ActivityEvent,
  Approval,
  ApprovalKind,
  ApprovalStage,
  ApprovalWorkflow,
  AttendanceDay,
  AttendanceStatus,
  Attachment,
  BlockedDate,
  ChannelId,
  ConductEvent,
  ConductPolicy,
  ConductSeverity,
  Conversation,
  DailyReport,
  ReportAttachment,
  DailySummary,
  DeadlineCounter,
  DeadlineExtension,
  DeadlineChangeRequest,
  BreakBudget,
  BreakSession,
  EmergencyRequest,
  OrganisationSettings,
  DeadlineProposal,
  Department,
  DeviceInfo,
  Employee,
  EmployeeId,
  Goal,
  GoalActivity,
  Group,
  InterventionItem,
  CoworkDocument,
  CoworkDocumentBody,
  DocumentKind,
  DocumentPageSetup,
  DocumentRole,
  DocumentSummary,
  MindMapDetail,
  MindMapRecord,
  MindMapRole,
  MindMapSummary,
  MindNode,
  MailAttachment,
  MailFolder,
  MailMessage,
  MailParty,
  MailThread,
  OfficeHours,
  OfficeHoursVersion,
  MailTransport,
  Meeting,
  MeetingEvent,
  MeetingParticipant,
  Message,
  MessageAttachment,
  MessageReply,
  MonitoringPerformance,
  MonitoringSubject,
  Notification,
  Observation,
  PriorityAcknowledgement,
  PriorityCascade,
  PriorityChange,
  PriorityConflict,
  Project,
  ProjectActivity,
  ProjectId,
  ProjectMember,
  ProjectMilestone,
  ProjectProgress,
  ProjectStatus,
  ProjectTaskLink,
  Rejection,
  ReportingRelationship,
  ResolvedStage,
  ReviewDecision,
  ReworkRequest,
  Role,
  RoleArchetype,
  RoleId,
  Scope,
  Capability,
  ScoreLedgerEntry,
  ScoreOverview,
  ScoreUnit,
  ScoringRule,
  ScoringRuleVersion,
  Task,
  TaskAssignment,
  TaskChatMessage,
  TaskEvent,
  TaskId,
  TaskReview,
  TaskStatus,
  TaskSubmission,
  TeamAnalytics,
  TeamMonitoringRow,
  TimerSession,
  MusicPlaylist,
  MusicPreferences,
  MusicQueue,
  MusicResult,
  WorkloadFlow,
  Viewer,
  WorkCommit,
  WorkflowTrigger,
  TaskMeetingSession,
} from "@/lib/domain";

/**
 * Sharing a document, sheet or mindmap with somebody who is NOT an
 * organisation employee — by email, with a role, no Cowork account required.
 *
 * A **separate, parallel system** from `DocumentMember`/`MindMapMember`,
 * deliberately: an `employeeId` in either of those is tied to a real
 * `cowork_employees` record and a real Firebase Auth user, which is a much
 * bigger grant than "can see this one document". External access is its own
 * identity on the engine (`cowork_share_guests`), reached with its own
 * bearer session token, never with a Firebase ID token and never folded into
 * `members`.
 *
 * `kind` here spans both documents (a sheet is a `CoworkDocument` with
 * `kind:"sheet"`, so it is `"document"` here too — there is no sheet-specific
 * branch anywhere in this feature) and mindmaps, matching the `:kind` route
 * segment `POST /cowork/share/:kind/:id/invite` expects.
 */
export type ExternalShareKind = "document" | "mindmap";

/** Never `"owner"` — an external invite cannot grant ownership. Enforced
    server-side, not only by this type. */
export type ExternalShareRole = "editor" | "viewer";

export type ExternalShareStatus = "pending" | "accepted" | "revoked";

export interface ExternalShareInvite {
  id: string;
  targetKind: ExternalShareKind;
  targetId: string;
  /** Lower-cased, normalised. */
  email: string;
  role: ExternalShareRole;
  status: ExternalShareStatus;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface CreateRoleInput {
  key: string;
  displayName: string;
  archetype: RoleArchetype;
  administrativeLevel: number;
  permissions: { capability: Capability; scope: Scope }[];
}

export type UpdateRoleInput = Partial<
  Pick<Role, "displayName" | "administrativeLevel" | "archetype">
>;

/* ── Query shapes ─────────────────────────────────────────────────────────── */

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

/**
 * The task list's tabs.
 *
 * `self_assigned` and `submitted` are legacy's own, read off
 * `app/coworking/tasks/page.js:7075-7078`, which is the authoritative tab
 * strip: **Assigned to Me · Created by Me · Self Tasks · Submitted**.
 *
 * Two things that sound like tabs are not:
 *
 * · **Drafts** is a collapsible section *inside* Assigned and Created
 *   (`page.js:8069`, `8123`), holding tasks where the sender proposed a timer
 *   window the receiver has not yet agreed — `senderTimerWindowSecs > 0 &&
 *   !deadlineWindowSecs && status ∈ {open, not_started}` (`page.js:8051`). It
 *   has nothing to do with a `draft` status, which the engine never writes.
 * · **Completed** is a value of the separate `viewFilter` axis —
 *   `status === "done"` (`page.js:6102`) — expressible here as
 *   `status: ["completed"]` on any scope. Making it a scope would give two
 *   ways to ask one question.
 */
export type TaskScope =
  | "mine"
  | "team"
  | "assigned_out"
  | "self_assigned"
  | "submitted"
  | "all";

export interface TaskQuery {
  scope: TaskScope;
  status?: TaskStatus[];
  assigneeId?: EmployeeId;
  projectId?: ProjectId | null;
  parentTaskId?: TaskId | null;
  /**
   * Return subtasks alongside their parents, for a caller that renders a TREE.
   *
   * Off by default, and the default is not laziness. Without a tree there is
   * nowhere to put a child, so the list rolls other people's subtasks up into
   * the parent row and reports one row for one piece of work — which is what
   * every count, tab badge and dashboard total in the product is computed
   * from. Turning this on for those callers would silently inflate all of
   * them; the old app kept the same separation, counting only roots
   * (`page.js:4114-4118`) while its tree showed everything.
   *
   * So this is set by the one surface that can nest — the task table — and by
   * nothing else.
   */
  includeSubtasks?: boolean;
  /**
   * Return PROJECT containers alongside tasks. Off by default.
   *
   * A folder is stored as a task, so it arrives in the same query — but it is
   * not work: it has no timer, nothing to submit, and assigning one assigns the
   * project rather than the tasks under it. Left in, an assigned project shows
   * in somebody's Tasks as a thing to do and takes a priority rank, pushing
   * every real task's P-number down.
   *
   * `listProjects` is the one caller that wants them, because containers are
   * exactly what it lists.
   */
  includeFolders?: boolean;
  search?: string;
  overdueOnly?: boolean;
  blockedOnly?: boolean;
  sort?: "rank" | "due" | "updated" | "title";
  cursor?: string | null;
  limit?: number;
}

export interface ProjectQuery {
  status?: ProjectStatus[];
  ownerId?: EmployeeId;
  memberId?: EmployeeId;
  search?: string;
  sort?: "name" | "progress" | "target" | "health";
  cursor?: string | null;
  limit?: number;
}

/** A task plus everything a list row or detail header needs, resolved once. */
export interface TaskView {
  task: Task;
  assignments: TaskAssignment[];
  assignees: Employee[];
  /**
   * People a cross-department approval is holding back — see
   * `Task.pendingAssigneeIds`. They are not assignees yet and the task is not
   * on their list, but the approval panel has to name who it is all for.
   */
  pendingAssignees: Employee[];
  /** The person who created the task. Distinct from the assignee. */
  owner: Employee | null;
  /**
   * The other SIDE of the work — the assigner of record.
   *
   * The same person as `owner` on an ordinary task, and deliberately not on a
   * SELF task, where the engine records the assignee's primary manager: nobody
   * negotiates a budget with, sets the priority of, or reviews their own work.
   *
   * Carried separately because `owner` folds the two together, and the one case
   * where they differ is the one that needs them apart — the meeting clock runs
   * on THIS person's attendance, so on a self task naming the owner would credit
   * somebody for sitting in a room alone.
   */
  assigner: Employee | null;
  /** Actual logged effort, so progress is derived rather than guessed. */
  loggedSecs: number;
  project: Project | null;
  /**
   * The viewer's position in their own ACTIVE queue — P1, P2, P3 as displayed.
   *
   * Not the stored rank. Positions are derived over the tasks still in play, so
   * completing a P1 moves the rest up without any write; a closed task holds no
   * position at all and reports null. See `lib/rules/tasks/activeQueue.ts`.
   */
  myRank: number | null;
  /**
   * The rank recorded against the viewer, live or closed.
   *
   * The sort key behind `myRank`, and the only thing left to show on a finished
   * task — "was P1". Null where none was ever set.
   */
  myStoredRank: number | null;
  /**
   * The team lead who may set this task's time budget, where it is waiting for
   * one. Null otherwise, and null where the department has no lead recorded.
   */
  budgetOwner: Employee | null;
  /**
   * The viewer owns a pending time-budget EXTENSION decision on this task.
   *
   * Set by `listTasks`/`#readTaskView` from `cowork_task_budget_extensions` —
   * the request lives in its own collection the task never references, so
   * without this a manager was never told a report asked for more time. Drives
   * `nextAction` → "Decide the time budget", which is what puts it in the
   * approver's "Awaiting your decision", the same as a deadline or a review.
   */
  budgetDecisionPending?: boolean;
  /**
   * The viewer owns a pending DEADLINE-extension decision on this task.
   *
   * The date twin of `budgetDecisionPending`. A deadline extension lives in
   * `cowork_task_deadline_extensions` and — unlike the initial proposal — never
   * flips the task's own status, so `deadline.state` stays `agreed` and nothing
   * on the list would show it. `listTasks` sets this for exactly the routed
   * approver (the assignee's primary manager under cross-department routing, who
   * is NOT necessarily the creator), and `nextAction` turns it into
   * "Decide deadline".
   */
  deadlineDecisionPending?: boolean;
  /**
   * The time-budget negotiation, where one is running.
   *
   * The loop's whole state: what is on the table, who put it there, and whose
   * turn it is. Every surface reads the turn from here rather than deciding it
   * — which is what stops two screens disagreeing about who may act.
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
  /** Criteria the last reviewer marked as not met. Empty once resubmitted. */
  reworkRequested: string[];
  /** Every rework round, oldest first. Never cleared. */
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
    /**
     * Why this rework did NOT reset the deadline, or null when it did.
     *
     * Rework normally grants a fresh working hour from the send-back — see
     * `reworkDeadline`. It does not when the submission missed its deadline,
     * and that case must be said out loud: the task returns still overdue, an
     * overdue task refuses to start its timer, and the person is otherwise left
     * looking at a dead Play button on work they were just asked to redo.
     *
     * Null on every entry written before 16 Aug 2026, which is the honest
     * reading — nothing was withheld from those, because the rule did not exist.
     */
    deadlineHeldReason: string | null;
    /**
     * The deadline either side of this rework.
     *
     * The task page names the deadline nowhere — the facts panel shows Expected
     * completion, a projection, and withholds the date on purpose. So a rework
     * that moved the deadline by an hour was invisible, and read as the rule
     * having failed when the engine had written it correctly. These two are
     * what let the rework panel say what it did.
     */
    previousDeadline: string | null;
    newDeadline: string | null;
  }[];
  latestSubmission: TaskSubmission | null;
  openProposal: DeadlineProposal | null;
  openCounter: DeadlineCounter | null;
  pendingApprovals: Approval[];
  /**
   * Every approval on this task, in stage order — decided, pending and waiting.
   *
   * `pendingApprovals` holds only what is actionable right now, which is the
   * right input for "is it my move". It is the wrong input for showing somebody
   * why their task has not started: a chain rendered from it alone has no past
   * and no future, so the reader sees "waiting on approval" and cannot tell who
   * has already agreed, who is being asked, or who comes next.
   *
   * Read-only, and derived from the same records the decisions are recorded
   * against. Nothing here decides anything.
   */
  approvals: Approval[];
  reworkCount: number;
  isOverdue: boolean;
  subtaskCount: number;
  chatCount: number;
  /**
   * Requirement satisfaction and project state, DERIVED on every read.
   *
   * On the view rather than computed per-component so the detail page, the
   * subtask dialog and the repository's own completion gate cannot disagree
   * about how many requirements are done — see `lib/tasks/completion.ts`.
   */
  completion: CompletionState;
  /**
   * The project this task was broken out of, resolved.
   *
   * Null for a root task. `Task.satisfiesRequirementIds` holds ids and nothing
   * else — correct for storage, and useless to a screen on its own: a subtask's
   * view held `["req-t-15-1"]` with no way to turn that into "Token naming
   * reviewed across every surface" or to name the project it belongs to, which
   * is why the subtask could not display what it was responsible for.
   *
   * Resolved HERE rather than by a second fetch in the component, so the text a
   * subtask shows is the parent's own text and cannot drift from it.
   */
  parent: ParentContext | null;
}

/** What a subtask needs to know about the project above it. */
export interface ParentContext {
  id: TaskId;
  title: string;
  reference: string;
  ownerName: string | null;
  /**
   * Only the requirements THIS task claims, each carrying the parent's live
   * satisfaction state. Not the parent's whole checklist — a subtask assignee
   * is answerable for their own areas, and showing them the rest would invite
   * them to act on somebody else's.
   */
  claimedRequirements: {
    id: string;
    text: string;
    /** Satisfied on the PARENT — the single source of truth. */
    isSatisfied: boolean;
    /** True when this subtask is the only thing standing between it and done. */
    isSoleClaimant: boolean;
  }[];
}

/**
 * One saved checkpoint of a document's text — not the text itself, which is
 * only fetched by `restoreDocumentVersion` applying it server-side. A list
 * screen needs no more than this to render a row: who, when, and the label
 * they gave it, if any.
 */
export interface DocumentVersionSummary {
  id: string;
  createdAt: string;
  /** Null for an automatic checkpoint — nobody in particular asked for it. */
  authorId: string | null;
  authorName: string;
  label: string | null;
}

export interface ProjectView {
  project: Project;
  owner: Employee;
  members: (ProjectMember & { employee: Employee })[];
  progress: ProjectProgress;
  milestones: ProjectMilestone[];
  taskLinks: ProjectTaskLink[];
  /**
   * Container requirements no live subtask has taken.
   *
   * A project here IS a broken-down task, so its requirements are the contract
   * its subtasks were created against — and one nobody claimed is a piece of
   * the project nobody is doing. That does not show up in any figure beside it:
   * `progressPercent` counts tasks, and a gap in the breakdown means the task
   * was never created, so completion can read 100% with work still missing.
   *
   * Empty on a healthy project, which is why the card can render it only when
   * there is something to say. Carried on the view rather than recomputed by
   * the card, because the card holds no subtasks to compute it from.
   */
  unassignedRequirements: { id: string; text: string }[];
  /**
   * How many of the project's requirements a subtask has taken, and how many
   * there are in total.
   *
   * Carried beside the unclaimed list because the list alone answers half the
   * question. "3 requirements have no subtask yet" does not say whether that is
   * three out of four or three out of thirty, and the reader's next question is
   * always how much of the job IS covered.
   */
  requirementsAssigned: number;
  requirementsTotal: number;
}

/* ── Results ──────────────────────────────────────────────────────────────── */

/**
 * Every mutation returns a result rather than throwing, so the UI can render a
 * permission-denied or validation state instead of an error boundary.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string; field?: string };

export type ActionErrorCode =
  | "permission_denied"
  | "not_found"
  | "invalid_state"
  | "validation_failed"
  | "conflict"
  | "budget_exceeded"
  | "offline";

/** The Timer SOP counters for one person, with the config they were judged by. */
export interface TimerSopStatus {
  employeeId: EmployeeId;
  config: TimerSopConfig;
  result: TimerSopResult;
  /** The live "Today's Work" target, or null when the engine is paused. */
  today: TodayTarget | null;
}

/* ── The repository ───────────────────────────────────────────────────────── */

export interface CoworkRepository {
  /* Identity */
  /**
   * The acting viewer, or a named one.
   *
   * The parameter exists for server code, which has no acting identity of its
   * own: the profile switcher runs in the browser and mutates the client's
   * repository singleton, so a route handler asking `getViewer()` always got
   * the seeded default and every server-side permission answer was about that
   * one person regardless of who was using the app. Resolving a named viewer
   * without mutating anything keeps that answer correct while staying safe on
   * a singleton shared between concurrent requests.
   *
   * An unknown id falls back to the acting viewer rather than throwing — a
   * stale value from a client should degrade to the default, not 500.
   */
  getViewer(employeeId?: EmployeeId): Promise<Viewer>;
  getCurrentEmployee(): Promise<Employee>;
  /**
   * Set or remove YOUR OWN profile picture.
   *
   * No id parameter, deliberately: the engine exposes no route that could decide
   * whether one person may change another's face, and legacy's own settings page
   * writes exactly one document — its author's. `null` removes the picture and
   * restores the monogram.
   *
   * The value is a `data:image/jpeg` URL produced by `encodeProfilePicture`;
   * the size is re-checked at the write, because only the encoder knows it.
   */
  setMyProfilePicture(dataUrl: string | null): Promise<ActionResult<Employee>>;
  listEmployees(): Promise<Employee[]>;
  /**
   * The people the acting viewer may create work for.
   *
   * Separate from `listEmployees` on purpose. The assignee picker used to
   * render everybody and let `createTask` refuse afterwards, so somebody with
   * `self` scope could select a colleague, fill in the whole form and only then
   * be told "You can only create task for yourself." The list a person chooses
   * from should be the list they are allowed to choose from.
   *
   * This is scoped by the same `can()` the write is refused by, so the two
   * cannot drift: it is the enforcement rule asked a different question, not a
   * second copy of it. Filtering here does not make the write safe — `createTask`
   * still checks every assignee — it makes the offer honest.
   */
  listAssignableEmployees(): Promise<Employee[]>;
  getEmployee(id: EmployeeId): Promise<Employee | null>;
  listRoles(): Promise<Role[]>;

  /* Administration — roles, departments, reporting lines and approval
     workflows are DATA, editable at runtime. Every write is permission-checked
     against `people.change_role` / `people.change_reporting`, and structural
     invariants (cycle-free reporting, an administrative floor that nobody can
     raise themselves through, at least one system administrator) are enforced
     here rather than in the form. */
  createRole(input: CreateRoleInput): Promise<ActionResult<Role>>;
  updateRole(id: RoleId, patch: UpdateRoleInput): Promise<ActionResult<Role>>;
  deleteRole(id: RoleId): Promise<ActionResult<void>>;
  setRolePermissions(
    id: RoleId,
    permissions: { capability: Capability; scope: Scope }[],
  ): Promise<ActionResult<Role>>;
  assignRoles(
    employeeId: EmployeeId,
    roleIds: RoleId[],
  ): Promise<ActionResult<Employee>>;

  /* Employees. Deactivation rather than deletion by default: an exited person's
     ledger entries, submissions and reviews all cite them, and a hard delete
     would orphan the lot. */
  createEmployee(input: {
    firstName: string;
    lastName: string;
    /** Required. Validated and de-duplicated by the repository, not the form. */
    email: string;
    employeeCode: string;
    departmentId: string | null;
    designation: string | null;
    roleIds: RoleId[];
    managerId: EmployeeId | null;
  }): Promise<ActionResult<Employee>>;
  updateEmployee(
    id: EmployeeId,
    patch: Partial<
      Pick<
        Employee,
        "firstName" | "lastName" | "designation" | "timezone" | "email"
      >
    >,
  ): Promise<ActionResult<Employee>>;
  setEmployeeActive(
    id: EmployeeId,
    active: boolean,
  ): Promise<ActionResult<Employee>>;

  /* Company policies — the conduct catalogue C3 deducts against. */
  createConductPolicy(input: {
    name: string;
    /** Percentage points a breach takes off — see `ConductPolicy.percent`. */
    percent: number;
    description: string;
    severity: ConductSeverity | null;
    scope: "global" | "department";
    departmentIds: string[];
  }): Promise<ActionResult<ConductPolicy>>;
  updateConductPolicy(
    id: string,
    patch: Partial<Omit<ConductPolicy, "id">>,
  ): Promise<ActionResult<ConductPolicy>>;

  /* ── C3 · the four acts ─────────────────────────────────────────────────
   *
   * **The reporting line decides all of them.** A rule is approved by its
   * author's own manager; a breach is applied by the employee's own manager; a
   * dispute is settled by the same person. An administrator stands in where the
   * line has run out. The rules themselves are in
   * `lib/rules/scoring/conduct.ts`, and the engine enforces them again — this
   * is a request, and its refusal is worth showing verbatim.
   */

  /** Rules waiting on THIS person to approve or reject. */
  listConductApprovals(): Promise<ConductPolicy[]>;
  decideConductPolicy(
    id: string,
    decision: "approve" | "reject",
    reason?: string,
  ): Promise<ActionResult<void>>;

  /** Charge an approved rule to somebody. */
  applyConductPolicy(input: {
    employeeId: EmployeeId;
    policyId: string;
    reason: string;
  }): Promise<ActionResult<void>>;

  /** Dispute a deduction on your OWN record. */
  requestConductRecheck(input: {
    entryId: string;
    note: string;
  }): Promise<ActionResult<void>>;

  /** Disputes waiting on this person to settle. */
  listConductDisputes(): Promise<
    {
      employeeId: EmployeeId;
      employeeName: string;
      entryId: string;
      policyName: string;
      percent: number;
      date: string | null;
      requestNote: string | null;
    }[]
  >;

  /**
   * Settle a dispute.
   *
   * `overturn: true` REVERSES the deduction — the employee was right. Named
   * this way because the engine's own word for it is `"confirm"`, which reads
   * as confirming the deduction and means the opposite; that word stops at the
   * wire boundary.
   */
  decideConductRecheck(input: {
    employeeId: EmployeeId;
    entryId: string;
    overturn: boolean;
    note: string;
  }): Promise<ActionResult<void>>;

  listDepartments(): Promise<Department[]>;
  createDepartment(input: {
    name: string;
    hodEmployeeId: EmployeeId | null;
    parentDepartmentId: string | null;
  }): Promise<ActionResult<Department>>;
  updateDepartment(
    id: string,
    patch: Partial<
      Pick<
        Department,
        "name" | "hodEmployeeId" | "parentDepartmentId" | "isActive"
      >
    >,
  ): Promise<ActionResult<Department>>;
  setEmployeeDepartment(
    employeeId: EmployeeId,
    departmentId: string | null,
  ): Promise<ActionResult<Employee>>;

  setReportingManager(
    employeeId: EmployeeId,
    managerId: EmployeeId | null,
    type?: ReportingRelationship["type"],
  ): Promise<ActionResult<ReportingRelationship | null>>;

  listWorkflows(): Promise<ApprovalWorkflow[]>;
  createWorkflow(input: {
    name: string;
    trigger: WorkflowTrigger;
  }): Promise<ActionResult<ApprovalWorkflow>>;
  updateWorkflow(
    id: string,
    patch: Partial<
      Pick<
        ApprovalWorkflow,
        "name" | "description" | "isActive" | "order" | "appliesTo"
      >
    >,
  ): Promise<ActionResult<ApprovalWorkflow>>;
  setWorkflowStages(
    id: string,
    stages: Omit<ApprovalStage, "id">[],
  ): Promise<ActionResult<ApprovalWorkflow>>;
  deleteWorkflow(id: string): Promise<ActionResult<void>>;
  /** Preview a workflow against one person, so a rule can be checked before it is relied on. */
  previewWorkflow(
    workflowId: string,
    subjectId: EmployeeId,
  ): Promise<ResolvedStage[]>;
  /** The resolved chain for a task, with whatever blocked it. */
  getApprovalPlan(taskId: TaskId): Promise<{
    stages: ResolvedStage[];
    blockedBy: ResolvedStage | null;
  } | null>;
  listReporting(): Promise<ReportingRelationship[]>;
  /**
   * The reporting closure, one node per person.
   *
   * **Distinct from `listReporting`, and richer.** That returns edges — an
   * employee, a manager, a type — which is the right shape for editing a
   * relationship and the wrong shape for reading a tree: it cannot say how deep
   * somebody sits, how many people report to them, or whether a manager named on
   * a record is a Cowork account at all.
   *
   * Those three are what an administrator needs to explain the product's
   * behaviour, because this closure is what visibility, monitoring and extension
   * approval all read. `depth` is **null rather than 0** when the chain to a root
   * cannot be resolved — a person whose manager is not in the directory is not
   * the same as a person at the top, and rendering both as 0 makes an incomplete
   * record look like a chief executive.
   *
   * Wired on the legacy backend, where it is derived from `primaryManager`.
   */
  listReportingLines(): Promise<ReportingNode[]>;
  /** Transitive closure beneath an employee, resolved by the repository. */
  hierarchyOf(id: EmployeeId): Promise<EmployeeId[]>;

  /* Tasks */
  listTasks(q: TaskQuery): Promise<Page<TaskView>>;
  getTask(id: TaskId): Promise<TaskView | null>;
  getSubtasks(id: TaskId): Promise<TaskView[]>;
  /**
   * Break a task down, turning it into the project its subtasks live under.
   *
   * Separate from `createTask` because the rules are different in kind, not in
   * degree: a subtask must claim at least one of the parent's completion
   * requirements, only the parent's owner or assignee may create one, and the
   * cross-department gate is evaluated against what the PARENT already cleared
   * rather than skipped outright. Folding this into `createTask` would mean
   * every one of those checks living behind an optional field.
   */
  createSubtask(input: CreateSubtaskInput): Promise<ActionResult<Task>>;
  /**
   * Tick a requirement off directly, for work the owner did themselves.
   *
   * Refused for a requirement that has claiming subtasks: that one is answered
   * by the subtasks, and letting an owner override it would let a project close
   * over work still in flight.
   */
  setRequirementSatisfied(
    taskId: TaskId,
    requirementId: string,
    satisfied: boolean,
  ): Promise<ActionResult<Task>>;
  /** Add completion requirements to a task that has none yet. */
  addRequirements(
    taskId: TaskId,
    texts: string[],
  ): Promise<ActionResult<Task>>;
  createTask(input: CreateTaskInput): Promise<ActionResult<Task>>;
  updateTask(
    id: TaskId,
    patch: Partial<
      Pick<Task, "title" | "description" | "requirements" | "tags">
    >,
  ): Promise<ActionResult<Task>>;
  /**
   * Change a task's due date outright, with the reason that moved it.
   *
   * **Separate from the negotiation flow, and not a duplicate of it.**
   * `proposeDeadline` → `decideProposal` is a request somebody else answers;
   * this is the assignor setting the date, which legacy gives its own route
   * (`PATCH /task/:id/deadline`) and its own guard.
   *
   * `reason` is required by the engine, not by preference — it is what lands in
   * `deadlineHistory`, and the route refuses a blank one before it writes.
   * `null` clears the date rather than leaving it unchanged.
   */
  setTaskDeadline(
    id: TaskId,
    newDueAt: string | null,
    reason: string,
  ): Promise<ActionResult<Task>>;
  cancelTask(id: TaskId, reason: string): Promise<ActionResult<Task>>;
  deleteTask(id: TaskId): Promise<ActionResult<void>>;
  resetTaskToDraft(id: TaskId): Promise<ActionResult<Task>>;

  /* Task lifecycle */
  confirmTask(id: TaskId): Promise<ActionResult<Task>>;
  /**
   * The assignee accepts or refuses the working window the assignor proposed.
   *
   * Legacy's `/approve-sender-timer` and `/reject-sender-timer`. A budget task
   * is created with no due date at all — legacy's `/task/create` hardcodes
   * `const dueDate = null` with the comment "Deadline is always set by employee
   * after assignment". Accepting the window is what creates the due date;
   * refusing it opens a negotiation and leaves the task exactly where it was.
   */
  acceptAssignorWindow(id: TaskId): Promise<ActionResult<Task>>;
  rejectAssignorWindow(id: TaskId, reason: string): Promise<ActionResult<Task>>;
  /**
   * The receiving department sets the effort on an approved cross-department
   * task before it reaches the assignee — legacy's `department-tl-set-hours`.
   * Converts the task from a fixed deadline to a budget, exactly as legacy did.
   */
  setEffortEstimate(id: TaskId, secs: number): Promise<ActionResult<Task>>;
  startTask(id: TaskId): Promise<ActionResult<Task>>;
  decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<ActionResult<Task>>;

  /* Priority */
  changePriority(
    input: ChangePriorityInput,
  ): Promise<ActionResult<PriorityCascade | null>>;
  /**
   * Repair one person's stored ranks so the queue is 1..N with no gaps or repeats.
   *
   * Idempotent — a healthy queue is zero writes and `changed: 0`. Worth calling
   * after any priority write, because the stored ranks are what every reader who
   * is not the queue owner falls back to, and legacy wrote them per assignee
   * independently with nothing normalising the set.
   *
   * `fault` describes what was wrong, for a diagnostic surface; null when the
   * queue was already valid.
   */
  normalizePriorities(
    employeeId: EmployeeId,
  ): Promise<ActionResult<{ changed: number; fault: string | null }>>;
  /**
   * Repair EVERY user's queue. Admin and diagnostic use; no UI yet.
   *
   * One scan of the task collection, grouped by holder, each person normalised
   * independently. Completed history is never touched — only active tasks are
   * renumbered, so a closed task keeps the rank it finished with.
   *
   * Requires `system_admin`.
   */
  normalizePrioritiesAllUsers(): Promise<
    ActionResult<{
      scanned: number;
      users: number;
      changed: number;
      perUser: { employeeId: string; changed: number; fault: string | null }[];
    }>
  >;
  reorderPriorities(
    employeeId: EmployeeId,
    orderedTaskIds: TaskId[],
    reason: string,
  ): Promise<ActionResult<PriorityCascade | null>>;
  listPriorityConflicts(employeeId: EmployeeId): Promise<PriorityConflict[]>;
  listPendingAcknowledgements(
    employeeId: EmployeeId,
  ): Promise<PriorityCascade[]>;
  acknowledgeCascade(
    cascadeId: string,
    pauseTimerTaskId: TaskId | null,
  ): Promise<ActionResult<PriorityAcknowledgement>>;
  listPriorityChanges(taskId: TaskId): Promise<PriorityChange[]>;

  /* Deadlines */
  proposeDeadline(
    input: ProposeDeadlineInput,
  ): Promise<ActionResult<DeadlineProposal>>;
  decideProposal(
    proposalId: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<ActionResult<DeadlineProposal>>;
  counterProposal(
    proposalId: string,
    counterDueAt: string,
    counterWindowSecs: number,
    message: string,
  ): Promise<ActionResult<DeadlineCounter>>;
  respondToCounter(
    counterId: string,
    accepted: boolean,
    message?: string,
  ): Promise<ActionResult<DeadlineCounter>>;
  requestExtension(
    input: RequestExtensionInput,
  ): Promise<ActionResult<DeadlineProposal>>;
  decideExtension(
    proposalId: string,
    decision: "approved" | "rejected",
    waivePenalty: boolean,
    reason?: string,
    /**
     * Grant it AND move the project out by the same amount.
     *
     * A subtask may not be due after its project. Where a grant would breach
     * that, the engine refuses with `AFTER_PARENT_DEADLINE` and names this as
     * the way to take it anyway — so the approver makes ONE decision instead of
     * being sent to a second task they may not think to open.
     */
    raiseParent?: boolean,
  ): Promise<ActionResult<DeadlineExtension | null>>;
  listProposals(taskId: TaskId): Promise<DeadlineProposal[]>;

  /* Time budget extensions — hours, between an assignee and their primary
     manager. A SEPARATE store from the deadline negotiation, because a capacity
     question and a commitment question sharing one record meant approving
     either looked like approving both. */
  requestTimeBudgetExtension(input: {
    taskId: TaskId;
    requestedAdditionalSecs: number;
    reason?: string;
  }): Promise<ActionResult<TimeBudgetExtensionRecord>>;
  /**
   * The manager's answer to a request for hours.
   *
   * **`approved` hands the turn to the ASSIGNEE — it does not apply the budget.**
   * A manager may grant fewer hours than were asked for, so their answer is an
   * offer, and the person whose week it binds confirms it with
   * `confirmTimeBudgetExtension`. Approval used to apply the figure and close the
   * record, which left "waiting for the assignee to confirm" as a state the
   * record could not hold and the screen could not render.
   *
   * `grantedSecs` is the manager's own figure as a NEW TOTAL, omitted when they
   * are granting exactly what was asked.
   */
  decideTimeBudgetExtension(
    recordId: string,
    decision: "approved" | "rejected",
    options?: { reason?: string; grantedSecs?: number },
  ): Promise<ActionResult<TimeBudgetExtensionRecord | null>>;
  /**
   * The assignee's answer to what their manager granted.
   *
   * `accept` settles it and applies the budget. `counter` puts a different total
   * forward and hands the turn back — the loop, which exits only on agreement.
   * There is deliberately no reject: a refusal would leave the work carrying a
   * figure neither side settled.
   */
  confirmTimeBudgetExtension(
    recordId: string,
    answer: "accept" | "counter",
    options?: { counterSecs?: number; reason?: string },
  ): Promise<ActionResult<TimeBudgetExtensionRecord | null>>;
  listTimeBudgetExtensions(
    taskId: TaskId,
  ): Promise<TimeBudgetExtensionRecord[]>;
  /**
   * What is new on each tab of a task, and when the viewer last looked.
   *
   * Keyed by tab id both ways, and the engine decides the keys — a tab added
   * later gets a badge without a change here or in `tabBadges`.
   */
  readTaskTabActivity(taskId: TaskId): Promise<{
    activity: Record<string, { lastAt: string | null; items?: { at: string; by?: string | null }[] }>;
    seen: Record<string, string | null>;
  }>;
  /**
   * Mark one tab read, for this viewer, now.
   *
   * Server-side deliberately: reading a tab on a laptop has to clear its badge
   * on a phone, which a mark kept in one browser cannot do.
   */
  markTaskTabSeen(taskId: TaskId, tabId: string): Promise<ActionResult<null>>;
  /** The DATE conversation, in the typed shape. Dates only. */
  listDeadlineExtensionRecords(
    taskId: TaskId,
  ): Promise<DeadlineExtensionRecord[]>;
  /** The deadline change, owned by the assignee's primary manager. Dates only —
      no duration is taken. `approverId` names the manager who decides it. */
  requestDeadlineExtensionRecord(input: {
    taskId: TaskId;
    proposedDeadline: string;
    reason?: string;
    approverId?: string;
  }): Promise<ActionResult<DeadlineExtensionRecord>>;
  /**
   * The assignor's answer.
   *
   * `counter_proposed` needs a date and the others must not carry one — an
   * approval that took a date could silently move the commitment somewhere
   * nobody agreed to.
   */
  decideDeadlineExtension(
    recordId: string,
    decision: "approved" | "rejected" | "counter_proposed",
    input?: { counterDeadline?: string; reason?: string },
  ): Promise<ActionResult<DeadlineExtensionRecord | null>>;

  /* Budget vs deadline. An assignee-side manager adjusts the working window
     within what the assignor allowed; going beyond it routes to the assignor
     as a request rather than silently moving the scored deadline. */
  adjustBudget(
    taskId: TaskId,
    windowSecs: number,
    reason: string,
  ): Promise<ActionResult<Task>>;
  requestDeadlineChange(
    taskId: TaskId,
    windowSecs: number,
    reason: string,
  ): Promise<ActionResult<DeadlineChangeRequest>>;
  /**
   * The assignor answers an outstanding deadline proposal.
   *
   * Distinct from `decideDeadlineChange`, which settles a change REQUEST on an
   * already-agreed deadline. This one answers the first negotiation, before any
   * deadline exists — legacy's `approve-deadline` against
   * `pending_deadline_approval`.
   */
  /** Counter with a different figure. Only the side being waited on may. */
  counterBudget(
    taskId: TaskId,
    proposedSecs: number,
    reason?: string,
  ): Promise<ActionResult<void>>;

  /** Accept what stands. Only the side being waited on may. */
  acceptBudget(taskId: TaskId): Promise<ActionResult<void>>;

  /**
   * Would this task meet its deadline at this position? A dry run.
   *
   * Writes nothing. The queue is the EVALUATED employee's, so a manager
   * previewing a placement for somebody in another department is asking about
   * that person's week rather than their own.
   */
  previewDeadlineFeasibility(input: {
    taskId?: TaskId;
    employeeId: EmployeeId;
    /**
     * Where the reader is CONSIDERING putting it, 1-based.
     *
     * Omit unless somebody is actually choosing a placement. Absent, the rule
     * uses where the task already sits in this employee's queue, or the back
     * for one not in it yet. A caller that invents a number here — `?? 1` was
     * the one that shipped — puts the task at the front of somebody else's
     * queue and every date that follows is fiction.
     */
    proposedPriority?: number | null;
    estimatedWorkSeconds: number;
    /** Seconds already worked on it; only the remainder is scheduled. */
    alreadyWorkedSeconds?: number;
    committedDeadline?: string | null;
    /**
     * A dragged order — task ids front to back, `"__proposed__"` for a task
     * not yet created. Overrides `proposedPriority` when given.
     *
     * Passed straight through to the rule. The repository's job here is to
     * fetch the employee's real workload and their calendar; deciding what an
     * order means is the rule's, and duplicating that here is how two answers
     * to one question get made.
     */
    orderOverride?: string[] | null;
  }): Promise<Feasibility>;

  decideDeadline(
    taskId: TaskId,
    approved: boolean,
    rejectionReason?: string,
  ): Promise<ActionResult<Task>>;

  decideDeadlineChange(
    requestId: string,
    accept: boolean,
    reason?: string,
  ): Promise<ActionResult<DeadlineChangeRequest>>;
  listDeadlineChangeRequests(taskId: TaskId): Promise<DeadlineChangeRequest[]>;

  /* Duty presence */
  /**
   * This employee's presence, as they last set it.
   *
   * Reads `cowork_duty_status/{employeeId}` — the presence store legacy already
   * has. There is **no second collection**: the old app writes this document,
   * the new app writes this document, and both read one answer.
   *
   * The mode is the document's own, exactly as the person last set it. Nothing
   * expires it: a status is changed by the person whose status it is, and by
   * nobody else — see `readDutyMode`.
   */
  getDutyMode(employeeId?: EmployeeId): Promise<DutyMode>;
  /**
   * Move the acting employee's presence, performing legacy's own transition
   * arithmetic — banking an unfinished break, holding an emergency span for
   * approval, stamping or clearing the connection's claim.
   *
   * `connectionId` identifies the live room connection. A tab may only clear an
   * `online` claim it owns, so a second tab cannot end a share the first one is
   * still publishing.
   */
  setDutyMode(input: {
    mode: DutyMode;
    connectionId: string | null;
    reason?: string | null;
    /**
     * A PERSON asked for this, rather than a tab deriving it.
     *
     * **The claim rule is about derived publishes, and applying it to a
     * deliberate one is the reported "I press Go offline and I am still
     * online".** A second tab has no room, so its honest reading is "nothing is
     * being shared" — publishing that would end a share the first tab is still
     * sending, which is what `ownsClaim` refuses. But somebody pressing Go
     * offline is not a reading; it is a decision about their own presence, and
     * presence belongs to the person rather than to whichever tab happens to
     * hold the claim. Declining it left the document online, told the caller
     * "online" is in force, and every device came back green.
     *
     * Set only from an explicit choice — never from a heartbeat, a derivation
     * or a reconnect.
     */
    deliberate?: boolean;
  }): Promise<ActionResult<DutyMode>>;
  /**
   * Stamp which connection holds a live `online` claim. Never moves the mode,
   * and nobody's presence expires without one — see `PRESENCE_STALE_AFTER_MS`.
   */
  heartbeatDuty(connectionId: string): Promise<ActionResult<void>>;
  /**
   * Live presence for a set of people, for a manager's view.
   *
   * Returns an unsubscribe. Emissions follow the documents and nothing else: a
   * dot changes when somebody changes their own status, never on a timer.
   */
  watchDutyModes(
    employeeIds: EmployeeId[],
    onChange: (modes: Map<EmployeeId, DutyMode>) => void,
  ): () => void;
  /**
   * The acting employee's OWN presence, live, with the clocks behind it.
   *
   * `getDutyMode` is a one-shot read answering one word, and both halves of that
   * were faults across devices: a second device sat at its initial `offline`
   * until the round trip landed and then corrected itself on screen, and it
   * learned the person was on a break without learning WHEN — so each device
   * started its own stopwatch and the two disagreed by however long they were
   * apart.
   *
   * Same shape as `watchDutyModes`: subscribe, return the unsubscribe. Firestore's
   * own listener is the live channel; there is no second realtime system here.
   */
  watchDutyStatus(
    onChange: (snapshot: DutySnapshot) => void,
    employeeId?: EmployeeId,
  ): () => void;
  /**
   * The acting employee's status changes for one day, newest first.
   *
   * `dayKey` defaults to today (`dutyDayKey`, UTC — the same convention the
   * duty document's own daily accumulator uses). This is the trail
   * `getDutyMode` cannot answer, because the duty document holds only the
   * current mode: what time they went online, when they took a break, when
   * that break ended, when they went offline — one entry per transition,
   * written alongside it.
   */
  listDutyHistory(dayKey?: string): Promise<DutyHistoryEntry[]>;

  /* Break Mode */
  /** Today's allowance and what is left of it, for the acting employee. */
  getBreakBudget(): Promise<BreakBudget>;
  listBreakSessions(employeeId?: EmployeeId): Promise<BreakSession[]>;
  /**
   * Close a break. Credits `min(duration, remaining allowance)` back to the
   * employee's live deadlines. No approval — the daily budget bounds it.
   */
  endBreak(input: {
    startedAt: string;
    endedAt: string;
  }): Promise<ActionResult<BreakSession>>;
  /**
   * The Cowork-owned work policy — `cowork_settings/office`.
   *
   * Distinct from `getOfficeHours`, and deliberately not routed through it:
   * that type models one start and one end for the week, while the engine's
   * schedule is per-day. A company that closes early on Saturday is
   * representable in the engine and not in `OfficeHours`, and the hours it
   * would discard are the ones deadlines are computed from.
   *
   * Nothing here is HR data. Working hours, breaks and the action gap are
   * rules Cowork applies to its own scheduling; names, departments, reporting
   * lines and joining details stay in HR and are not editable from Cowork.
   */
  getOfficePolicy(): Promise<OfficePolicy>;
  /** Requires `score.configure`, as every other organisation setting does. */
  setOfficePolicy(
    policy: OfficePolicy,
    reason?: string,
  ): Promise<ActionResult<OfficePolicy>>;

  /**
   * Whether deadline maths fetches holidays and approved leave from the HR
   * system.
   *
   * ON — the default, and the product's standing behaviour: `listBlockedDates`
   * asks the engine, which reads HR, and deadline walks skip those days. OFF —
   * nothing is fetched from the HR side; every day reads as available. A
   * testing switch: task logic can be exercised without HR data moving the
   * dates. Deadlines computed while OFF ignore real holidays, which is the
   * point and the risk in one sentence.
   */
  getHrHolidaySync(): Promise<boolean>;
  /** Requires `score.configure`, as every other organisation setting does. */
  setHrHolidaySync(enabled: boolean): Promise<ActionResult<boolean>>;

  /* Timer SOP Point Engine — work-time deficit and overtime. Configured on the
     office-policy settings surface; the counters read live from work commits. */
  getTimerSopConfig(): Promise<TimerSopConfig>;
  /** Requires `score.configure`. */
  setTimerSopConfig(
    config: TimerSopConfig,
  ): Promise<ActionResult<TimerSopConfig>>;
  /**
   * The deficit/overtime counters for one person, computed from their real work
   * commits against the office calendar. Defaults to the acting viewer.
   */
  getTimerSopStatus(employeeId?: EmployeeId): Promise<TimerSopStatus>;

  /* ── The rest of the settings console ─────────────────────────────────────
   *
   * Five sections, one write path. Every setter below routes through
   * `#writeSettingsSection` in the legacy repository, which authorises from the
   * session archetype, reads the before-value, writes, then logs. There is no
   * second path and adding one is a defect — see `lib/rules/settings/sections.ts`
   * for which store each section lives in and who reads it once saved.
   *
   * **Reads are ungated; writes require `system_admin`.** Everybody may see the
   * rules they work under; a person who cannot find the office hours assumes
   * they are not configured.
   */

  /**
   * Task gates — acceptance, submission, escalation.
   *
   * Enforced by Cowork only. The legacy app does not read this document, so a
   * rule tightened here is not tightened for anybody still using the old UI.
   */
  getTaskRules(): Promise<TaskRules>;
  setTaskRules(
    rules: TaskRules,
    reason?: string,
  ): Promise<ActionResult<TaskRules>>;

  /** Who decides an extension, and what happens when nobody is named. */
  getWorkflowRouting(): Promise<WorkflowRouting>;
  setWorkflowRouting(
    routing: WorkflowRouting,
    reason?: string,
  ): Promise<ActionResult<WorkflowRouting>>;

  /**
   * Scoring values the Express engine reads — `cowork_sop_settings/task_events`.
   *
   * **These reach published scores.** The write has two halves: the Firestore
   * document the engine's `getC1Config` reads, and a mirror into MongoDB
   * `BandConfig` through `POST /cowork/sop/settings/sync`. Both, or the two
   * stores disagree about a score with nothing reporting it.
   */
  getScoringSettings(): Promise<ScoringSettings>;
  setScoringSettings(
    settings: ScoringSettings,
    reason?: string,
  ): Promise<ActionResult<ScoringSettings>>;

  /**
   * Published values for the rules nobody has decided yet.
   *
   * Only overridden keys are stored — an absent key means "use the seeded
   * placeholder", which is a different fact from an override that happens to
   * equal it, and the difference is what the Resolved badge renders.
   */
  getRuleOverrides(): Promise<RuleOverrides>;
  setRuleOverrides(
    overrides: RuleOverrides,
    reason?: string,
  ): Promise<ActionResult<RuleOverrides>>;
  /**
   * The settings audit log, newest first.
   *
   * **System administrators only** — narrower than the admin area it lives in.
   * The log records role changes among other things, so somebody who can alter
   * roles AND read the log of role alterations can cover one change with
   * another. Rejects rather than returning an empty list: an empty log and a
   * refused one are different facts.
   */
  listSettingsAudit(limit?: number): Promise<AuditEntry[]>;
  getOrganisationSettings(): Promise<OrganisationSettings>;

  /* Office hours — versioned, append-only, one live config per organisation. */
  /** The live configuration. Publishes defaults on first read if none exists. */
  getOfficeHours(): Promise<OfficeHours>;
  /** Every published version, newest first. */
  listOfficeHoursHistory(): Promise<OfficeHoursVersion[]>;
  /** Appends a new version. Requires `score.configure`. */
  setOfficeHours(
    config: OfficeHours,
    note?: string,
  ): Promise<ActionResult<OfficeHoursVersion>>;
  /** Requires `score.configure`, as every other organisation setting does. */
  setMaxBreakMinutesPerDay(
    minutes: number,
  ): Promise<ActionResult<OrganisationSettings>>;

  /* Emergency Mode */
  /**
   * Raise the request that ending Emergency Mode produces. Applies nothing —
   * deadlines move only when the manager approves.
   */
  createEmergencyRequest(input: {
    startedAt: string;
    endedAt: string;
    reason: string;
    document: { filename: string; mimeType: string; sizeBytes: number } | null;
  }): Promise<ActionResult<EmergencyRequest>>;
  /** `mine` for the employee's own history, `to_decide` for a manager's queue. */
  listEmergencyRequests(
    scope: "mine" | "to_decide",
  ): Promise<EmergencyRequest[]>;
  /** Only the named manager may decide. Approving applies the deadline shift. */
  decideEmergencyRequest(
    requestId: string,
    approve: boolean,
    decisionReason?: string,
  ): Promise<ActionResult<EmergencyRequest>>;
  listExtensions(taskId: TaskId): Promise<DeadlineExtension[]>;
  listBlockedDates(
    employeeId: EmployeeId,
    from: string,
    to: string,
  ): Promise<BlockedDate[]>;

  /* Work */
  /**
   * Watch one person's session on one task. Returns its own unsubscribe.
   *
   * The live channel a manager observes through — the same document the
   * employee's browser writes. Observation only; it performs no transition.
   */
  watchTimerSession(
    employeeId: EmployeeId,
    taskId: TaskId,
    onChange: (session: TimerSession | null) => void,
  ): () => void;

  /* ── Attachments ─────────────────────────────────────────────────────────
   *
   * Private, and reachable only through the engine's authenticated routes. No
   * method here returns a storage URL: an id is the handle, and bytes come back
   * as a blob from `downloadAttachment`. A URL would be a second way to the
   * file with none of the permission checks the route performs.
   */
  uploadAttachment(input: {
    file: File;
    entityType: AttachmentEntity;
    entityId: string;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  }): Promise<ActionResult<AttachmentMeta>>;

  /**
   * Files on one entity, or the reason there are none to show.
   *
   * Returns a RESULT rather than a bare array: an empty array cannot say
   * whether the entity has no files or the request failed, and rendering both
   * as a blank section is how a storage outage was investigated as a missing
   * upload button.
   */
  getAttachments(
    entityType: AttachmentEntity,
    entityId: string,
  ): Promise<ActionResult<AttachmentMeta[]>>;

  /** The bytes, for a caller to turn into a short-lived object URL. */
  downloadAttachment(id: string): Promise<ActionResult<Blob>>;

  deleteAttachment(id: string): Promise<ActionResult<void>>;

  getTimer(taskId: TaskId): Promise<TimerSession | null>;
  /**
   * The viewer's one running session, if any. One active task per person is a
   * real constraint, so the UI needs to answer "what is running" without
   * polling every row.
   */
  getActiveTimer(): Promise<
    (TimerSession & { taskTitle: string; loggedSecs: number }) | null
  >;
  listTimers(): Promise<TimerSession[]>;
  startTimer(taskId: TaskId): Promise<ActionResult<TimerSession>>;
  pauseTimer(
    taskId: TaskId,
    message: string | null,
    reason: WorkCommit["pauseReason"],
  ): Promise<ActionResult<WorkCommit>>;
  /**
   * Keep a running session alive so an abandoned clock cannot bank the gap.
   *
   * Called on an interval by the timer control while the clock genuinely runs.
   * A missed beat (closed tab, sleeping laptop) is what caps how much a later
   * pause may credit. Idempotent and cheap; a no-op on a paused or absent
   * session.
   */
  heartbeatTimer(taskId: TaskId): Promise<ActionResult<void>>;
  listWorkCommits(taskId: TaskId): Promise<WorkCommit[]>;
  listDayCommits(
    date: string,
  ): Promise<(WorkCommit & { employee: Employee; taskTitle: string })[]>;
  /**
   * The dashboard's principal graph. Weekly arrivals against departures for the
   * given scope, counted from timestamps already on the record.
   */
  getWorkloadFlow(q: {
    scope: TaskScope;
    weeks: number;
  }): Promise<WorkloadFlow>;
  submitDailyReport(input: {
    taskId: TaskId;
    message: string;
    progressPercent: number;
    attachmentIds: string[];
    /** Files, with their names. Preferred over `attachmentIds`. */
    attachments?: ReportAttachment[];
    /** A Cowork document written as the long form of this report. */
    documentId?: string | null;
    documentTitle?: string | null;
  }): Promise<ActionResult<DailyReport>>;
  listDailyReports(taskId: TaskId): Promise<DailyReport[]>;

  /* Submission and review */
  submitCompletion(
    input: SubmitCompletionInput,
  ): Promise<ActionResult<TaskSubmission>>;
  listSubmissions(taskId: TaskId): Promise<TaskSubmission[]>;
  reviewSubmission(input: ReviewInput): Promise<ActionResult<TaskReview>>;
  /**
   * What sending this task back at a given priority would do to that person's
   * other work. Read-only — asked again on every change of the picker, so it
   * must never write.
   *
   * Optional on the interface: a store with no queue engine behind it has no
   * honest answer, and the screen shows the picker without a preview rather
   * than inventing one.
   */
  reworkQueuePreview?(
    taskId: TaskId,
    priority: number | null,
  ): Promise<ReworkQueuePreview | null>;
  listReviews(taskId: TaskId): Promise<TaskReview[]>;
  listReworkRequests(taskId: TaskId): Promise<ReworkRequest[]>;
  listRejections(taskId: TaskId): Promise<Rejection[]>;
  listReviewQueue(): Promise<TaskView[]>;
  /** The queue, plus which stage is yours and what is blocking the chain. */
  /**
   * The action inbox: every task where a decision is required from the caller,
   * or where the work cannot move until they respond.
   *
   * A separate call rather than a flag on `listTasks` because it answers a
   * different question. `listTasks` answers "what is the state of the work";
   * this answers "what is waiting on me", and the two have different membership
   * — most of your work is not waiting on you at all.
   *
   * Membership is decided HERE, by `actionableFor`, and never by the caller.
   * The tab that renders this used to filter a full task list on
   * `nextAction(...).actor === "you"`, which is true of anything you are
   * carrying, so an inbox for stuck work filled up with work that was merely
   * yours. A client-side filter is also how the list and the count on the tab
   * came to disagree.
   */
  listActionable(): Promise<ActionableItem[]>;
  listReviewDetail(): Promise<
    {
      view: TaskView;
      stageName: string;
      stageNumber: number;
      stageCount: number;
      isMyTurn: boolean;
      waitingOn: string | null;
      blockedBy: ResolvedStage | null;
    }[]
  >;

  /* Chat, events, attachments */
  listTaskChat(
    taskId: TaskId,
    thread: "chat" | "draft",
  ): Promise<TaskChatMessage[]>;
  sendTaskChat(
    taskId: TaskId,
    thread: "chat" | "draft",
    text: string,
    /** Whole attachment objects (as returned by `uploadMessageAttachment`), not
        ids: the task thread stores them inline on the message, mirroring the
        message thread. Pass `[]` for a text-only message. */
    attachments: MessageAttachment[],
  ): Promise<ActionResult<TaskChatMessage>>;
  listTaskEvents(taskId: TaskId): Promise<TaskEvent[]>;
  listAttachments(ids: string[]): Promise<Attachment[]>;

  /* Projects */
  listProjects(q: ProjectQuery): Promise<Page<ProjectView>>;
  getProject(id: ProjectId): Promise<ProjectView | null>;
  createProject(input: CreateProjectInput): Promise<ActionResult<Project>>;
  updateProject(
    id: ProjectId,
    patch: Partial<
      Pick<
        Project,
        | "name"
        | "description"
        | "status"
        | "startDate"
        | "targetDate"
        | "priority"
        | "tags"
      >
    >,
  ): Promise<ActionResult<Project>>;
  archiveProject(id: ProjectId): Promise<ActionResult<Project>>;
  addProjectMember(
    projectId: ProjectId,
    employeeId: EmployeeId,
    role: ProjectMember["role"],
  ): Promise<ActionResult<ProjectMember>>;
  removeProjectMember(
    projectId: ProjectId,
    employeeId: EmployeeId,
  ): Promise<ActionResult<void>>;
  linkTask(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<ActionResult<ProjectTaskLink>>;
  /** Unlinking never deletes the task. */
  unlinkTask(projectId: ProjectId, taskId: TaskId): Promise<ActionResult<void>>;
  listProjectTasks(projectId: ProjectId): Promise<TaskView[]>;
  listProjectActivity(projectId: ProjectId): Promise<ProjectActivity[]>;
  addMilestone(
    projectId: ProjectId,
    title: string,
    targetDate: string,
  ): Promise<ActionResult<ProjectMilestone>>;

  /* Score */
  getScoreOverview(
    employeeId: EmployeeId,
    periodKey?: string,
  ): Promise<ScoreOverview>;
  listScoreUnits(
    employeeId: EmployeeId,
    component?: ChannelId,
    periodKey?: string,
  ): Promise<ScoreUnit[]>;
  listLedger(
    employeeId: EmployeeId,
    component?: ChannelId,
    periodKey?: string,
  ): Promise<ScoreLedgerEntry[]>;
  listScoreHistory(employeeId: EmployeeId): Promise<
    {
      periodKey: string;
      overall: number;
      channels: Record<ChannelId, number>;
    }[]
  >;
  /* Scoring rules are CONFIGURATION, not code. Publishing a version writes the
     value the engine computes with, so an edit here changes scores — which is
     why every publish keeps the superseded version rather than overwriting it. */
  updateScoringRule(
    id: string,
    patch: Partial<
      Pick<
        ScoringRule,
        "displayName" | "description" | "isActive" | "appliesTo"
      >
    >,
  ): Promise<ActionResult<ScoringRule>>;
  publishRuleVersion(
    id: string,
    input: {
      parameters: Record<string, number>;
      effectiveFrom: string;
      note?: string;
    },
  ): Promise<ActionResult<ScoringRuleVersion>>;
  createScoringRule(input: {
    key: string;
    component: ChannelId;
    displayName: string;
    description: string;
  }): Promise<ActionResult<ScoringRule>>;
  archiveScoringRule(id: string): Promise<ActionResult<void>>;
  restoreScoringRule(id: string): Promise<ActionResult<void>>;
  listRuleVersions(id: string): Promise<ScoringRuleVersion[]>;
  /** Roll back to a superseded version by republishing its parameters. */
  revertRuleVersion(
    id: string,
    versionId: string,
  ): Promise<ActionResult<ScoringRuleVersion>>;

  listScoringRules(): Promise<
    (ScoringRule & { version: ScoringRuleVersion })[]
  >;

  /* Goals */

  /**
   * The C2 pool a goal task claims a share of — Phase 1 of goal support.
   *
   * A goal task is worth `weightagePercent × globalMaxPoints ÷ 100`, and the
   * shares of all live goal tasks must not exceed the whole pool. This is what
   * the creation form needs to compute the figure and to say what is left.
   *
   * The arithmetic is in `lib/rules/scoring/goalPoints.ts`; this only fetches
   * the two numbers it works from. The engine is asked again at the moment of
   * writing — see `validateGoalWeightage` — because between reading this and
   * submitting, another task can claim the pool.
   */
  getGoalPool(): Promise<{
    globalMaxPoints: number;
    claimedPercent: number;
    remainingPercent: number;
  }>;

  /**
   * The engine's verdict on a share, at the moment of asking.
   *
   * A hard block, and its refusal is the engine's own sentence — shown as
   * written rather than restated, because it names the figures the person has
   * to act on.
   */
  validateGoalWeightage(input: {
    weightagePercent: number;
    excludeTaskId?: string | null;
  }): Promise<{ valid: boolean; remainingPercent: number; error: string | null }>;

  /**
   * Where a task's hours came from.
   *
   * A budget can grow after the task is created, without anybody asking: a
   * break credited back, an offline span, an approved emergency, a meeting
   * attended. This is the account of that — every recorded increase, oldest
   * first, with the engine's own reason on each.
   *
   * `givenSecs` is what the task was created with. It will NOT always equal
   * `currentSecs` minus the credits: receipts were only introduced recently, so
   * a task credited before that carries budget nothing explains. The caller is
   * expected to say so rather than hide it — see `budgetHistoryView`.
   *
   * An unreadable history answers empty rather than throwing. The Details panel
   * it hangs off must survive it.
   */
  getBudgetHistory(taskId: TaskId): Promise<{
    givenSecs: number;
    currentSecs: number;
    credits: {
      id: string;
      at: string;
      previousSecs: number;
      newSecs: number;
      reason: string;
      byEmployeeId: string | null;
    }[];
  }>;

  /**
   * A goal task's roadmap — Phase 2 of goal support.
   *
   * The steps the goal is delivered through, each with a share of the task's
   * points. The engine keeps them as an array on the task and replaces it
   * wholesale, so `saveGoalRoadmap` sends the whole list; anything this app
   * does not render is carried through untouched rather than dropped.
   */
  getGoalRoadmap(taskId: TaskId): Promise<{
    activities: {
      id: string;
      heading: string;
      description: string;
      deadline: string | null;
      weightPercent: number;
      points: number;
      /** `pending`, `pending_approval` or `done` — the engine's own words. */
      status: string;
      /** What was handed in against this step, where anything was. */
      report: {
        text: string;
        submittedAt: string | null;
        submittedBy: string | null;
        /** What was attached to it. Empty where nothing was. */
        files: GoalReportFile[];
      } | null;
      /**
       * Per-person progress, on a goal assigned to more than one person.
       *
       * Null on a single-assignee goal — there the flat `status` and `report`
       * above are the one person's state, unchanged from before goals were
       * shareable.
       */
      perUserStatus: Record<string, Partial<GoalStepPerson>> | null;
    }[];
    submitted: boolean;
    submittedAt: string | null;
    /** The task's own pool, so the editor can guard against it. */
    taskMaxPoints: number;
    /**
     * The date the whole goal is aimed at, as agreed at creation.
     *
     * Shown so the roadmap has the bound it is being built towards. It does
     * NOT gate anything: steps carry their own deadlines and those are what
     * earn or forfeit points. Null on a goal created before this was asked
     * for.
     */
    targetDate: string | null;
    /** What the goal is, in the creator's words. Null where none was given. */
    goalStatement: string | null;
  }>;

  saveGoalRoadmap(input: {
    taskId: TaskId;
    activities: {
      id: string;
      heading: string;
      description: string;
      deadline: string | null;
      weightPercent: number;
    }[];
  }): Promise<ActionResult<void>>;

  /**
   * Hand the roadmap to the person doing the work — Phase 3.
   *
   * Marks it submitted and stamps when. The engine notifies on the transition,
   * so this is sent once and never re-sent: `submitGoalRoadmap` on an already
   * submitted roadmap is a no-op rather than a second announcement.
   */
  submitGoalRoadmap(taskId: TaskId): Promise<ActionResult<void>>;

  /**
   * Hand in a report against one step — Phase 4.
   *
   * The engine refuses anybody who is not an assignee of the task, which is the
   * rule that matters: a report is the person doing the work saying they have
   * done it. It moves the step to `pending_approval` and tells the head.
   */
  submitGoalStepReport(input: {
    taskId: TaskId;
    stepId: string;
    text: string;
    /**
     * Files to attach, already uploaded by `uploadGoalReportFile`.
     *
     * Uploaded FIRST and separately, so a failed upload costs a retry of that
     * one file rather than the written report along with it.
     */
    files?: GoalReportFile[];
    /**
     * Who is handing it in, on a goal shared by several people.
     *
     * When given, the report is ALSO recorded against this person's own row so
     * a second assignee's submission cannot overwrite the first one's. The
     * engine's flat report is still written either way — it is what drives its
     * emails and what the old Cowork reads.
     *
     * Omit on a single-assignee goal.
     */
    personId?: string;
  }): Promise<ActionResult<void>>;

  /**
   * Put one file where a goal report can point at it — Phase 4.
   *
   * Separate from `submitGoalStepReport` because the two fail differently: an
   * upload is slow and worth showing progress for, and a report should not be
   * lost because the third of four files timed out.
   */
  uploadGoalReportFile(file: File): Promise<ActionResult<GoalReportFile>>;

  /**
   * Settle a step — Phase 5.
   *
   * `approve: true` marks it done and pays its points, **if** it was handed in
   * on or before its deadline. Late earns nothing; the engine re-checks that
   * itself and answers `skipped`, so a late approval still records the work
   * without moving anybody's score.
   *
   * `approve: false` sends it back: the step returns to `pending` and the
   * report is cleared, so the person can hand in another.
   */
  decideGoalStep(input: {
    taskId: TaskId;
    stepId: string;
    approve: boolean;
    /**
     * Whose work is being decided, on a goal shared by several people.
     *
     * The decision, and the points, land on this person alone — the others'
     * rows are untouched, and the step's flat status only reads `done` once
     * every assignee has been approved.
     *
     * Omit on a single-assignee goal, where the credit goes to the one
     * assignee as it always did.
     */
    personId?: string;
  }): Promise<ActionResult<{ pointsEarned: number }>>;

  /**
   * Where somebody's C2 came from — Phase 6.
   *
   * The C2 tab can already list the individual credits: each approved step
   * lands in the ledger as a `type: "C2"` entry. What that cannot answer is
   * WHICH GOAL each belongs to and how far through its pool the goal has got.
   */
  getC2Breakdown(employeeId: EmployeeId): Promise<{
    totalEarned: number;
    globalMaxPoints: number;
    tasks: {
      taskId: string;
      taskTitle: string;
      taskMaxPoints: number;
      earnedPoints: number;
      weightagePercent: number;
    }[];
  }>;

  listGoals(employeeId?: EmployeeId): Promise<Goal[]>;
  getGoal(
    id: string,
  ): Promise<{ goal: Goal; activities: GoalActivity[] } | null>;
  updateGoalActivity(
    activityId: string,
    patch: Partial<Pick<GoalActivity, "status" | "report">>,
  ): Promise<ActionResult<GoalActivity>>;

  /* Conduct and attendance */
  listConductEvents(employeeId: EmployeeId): Promise<ConductEvent[]>;
  listConductPolicies(): Promise<ConductPolicy[]>;
  listAttendance(
    employeeId: EmployeeId,
    from: string,
    to: string,
  ): Promise<AttendanceDay[]>;
  /**
   * Record or correct one person's attendance for a day, upserting by employee
   * and date. A manager may record for a direct report; People Operations and
   * administrators for anyone in the workspace. Nobody records their own day —
   * the reporting scope forbids it. The recorded day feeds C4 · Attendance
   * immediately.
   */
  recordAttendance(input: {
    employeeId: EmployeeId;
    /** YYYY-MM-DD. */
    date: string;
    status: AttendanceStatus;
    lateMinutes?: number;
    earlyDepartureMinutes?: number;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    actualStart?: string | null;
    actualEnd?: string | null;
    isExpectedWorkingDay?: boolean;
  }): Promise<ActionResult<AttendanceDay>>;

  /* Material Request Forms — request and approval (store issue/return is a
     separate app). */
  listMyMrfs(): Promise<{ requests: MrfRequest[]; stats: MrfStats }>;
  /** The approver's queue: requests routed to the acting viewer. */
  listMrfApprovals(
    status?: MrfStatus | "all",
  ): Promise<{ requests: MrfRequest[]; stats: MrfApprovalStats }>;
  getMrf(id: string): Promise<MrfRequest | null>;
  createMrf(input: NewMrfInput): Promise<ActionResult<MrfRequest>>;
  cancelMrf(id: string, note?: string): Promise<ActionResult<MrfRequest>>;
  /** The resolved approver (or CEO) approves or rejects a pending request. */
  decideMrf(
    id: string,
    decision: {
      approve: boolean;
      note?: string;
      /** Per-item approve/reject; absent items default to the overall decision. */
      itemDecisions?: Record<string, "approved" | "rejected">;
    },
  ): Promise<ActionResult<MrfRequest>>;
  /** The shared thread on one request — requester, approver and store. */
  listMrfChat(id: string): Promise<MrfChatMessage[]>;
  sendMrfChat(id: string, body: string): Promise<ActionResult<MrfChatMessage>>;
  /** Search the store catalogue (name or SKU) for items, with variants and stock. */
  searchMrfItems(query: string): Promise<RawItemHit[]>;

  /* Collaboration */
  listConversations(): Promise<(Conversation & { participants: Employee[] })[]>;
  /**
   * A page of one conversation's messages, newest end first in the window but
   * ASCENDING within it — the order `MessageList` renders in.
   *
   * Always the NEWEST `limit` messages, or the newest `limit` strictly older
   * than `before`.
   *
   * ## Why a cursor, when a growing window was simpler
   *
   * This used to page by asking for a bigger `limit` each time — 50, then 100,
   * then 150 — re-reading everything already on screen to add fifty more. The
   * reason was real: the thread is re-read on every live update
   * (`watchConversationMessages`), and one growing window stays correct under
   * that refetch for free, where separately-fetched pages have to be reconciled.
   *
   * The cost is that scrolling back through a long conversation re-reads it
   * from the start every time, and the reads grow quadratically with how far
   * somebody looks. So the reconciliation is now written down instead, in
   * `mergeMessagePages`: the newest page stays live and is refetched, older
   * pages are fetched once and never again, and the two are merged by message
   * id so a message appearing in both cannot be drawn twice.
   *
   * `before` is an ISO instant and the comparison is INCLUSIVE, which sounds
   * wrong and is deliberate. Two messages can share a `createdAt`, and an
   * exclusive cursor would step over the second of them — a message that
   * silently never appears, which is far worse than a duplicate. The overlap it
   * produces is removed by the merge, so the failure mode is a wasted row
   * rather than a lost one.
   *
   * `hasMore` says whether anything older than this page exists.
   */
  listMessages(
    conversationId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<{ messages: Message[]; hasMore: boolean }>;
  sendMessage(
    conversationId: string,
    text: string,
    /** Media to send with the text, where any. A message may carry attachments
     *  and no caption, so an empty `text` with a non-empty list is valid. */
    attachments?: MessageAttachment[],
    /** The message this one replies to, where it is a reply. */
    replyTo?: MessageReply | null,
  ): Promise<ActionResult<Message>>;
  /** Edit the text of your own message. Re-stamps it as edited. */
  editMessage(
    conversationId: string,
    messageId: string,
    text: string,
  ): Promise<ActionResult<Message>>;
  /** Soft-delete your own message: the slot and a tombstone remain. */
  deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<ActionResult<void>>;
  /**
   * React to a message with an emoji — or take the reaction back.
   *
   * One reaction per person per message: picking a second emoji replaces the
   * first, picking the one you already hold removes it. The rule lives in
   * `lib/rules/messages/reactions.ts` so both implementations apply the same
   * one. Optional, like every chat extra: a backend without it simply offers
   * no reaction bar.
   */
  toggleMessageReaction?(
    conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<ActionResult<void>>;
  /**
   * Star a message for YOURSELF — or unstar it. A star is a personal bookmark:
   * it lives on the message so it follows you across devices, but nobody else
   * is shown yours. Any message can be starred, including other people's.
   */
  toggleMessageStar?(
    conversationId: string,
    messageId: string,
  ): Promise<ActionResult<void>>;
  /**
   * Pin a message to the top of the conversation — for EVERYONE in it.
   *
   * The quote rides along denormalised (the same shape a reply carries) so the
   * banner renders without loading the original. Any participant may pin; the
   * count is capped, and the refusal sentence lives in
   * `lib/rules/messages/pins.ts` beside the cap itself.
   */
  pinMessage?(
    conversationId: string,
    message: { messageId: string; senderName: string; text: string },
  ): Promise<ActionResult<void>>;
  /** Take a pinned message off the conversation's banner. Any participant may. */
  unpinMessage?(
    conversationId: string,
    messageId: string,
  ): Promise<ActionResult<void>>;
  /**
   * Upload one file for a message and return the attachment to send.
   *
   * Optional: only a backend with an upload endpoint provides it, so the
   * in-memory prototype omits it and the composer's attach control stays off.
   * The two-step shape — upload, then `sendMessage` with the result — keeps the
   * message write a single Firestore document with no half-sent state.
   */
  uploadMessageAttachment?(
    file: File,
    /** 0–1 across the byte transfer, where the backend can report it. */
    onProgress?: (fraction: number) => void,
  ): Promise<ActionResult<MessageAttachment>>;
  /**
   * Upload one file to shared media storage and return where it lives.
   *
   * The general form of the method above, for every surface that needs a file
   * somebody else can SEE: a picture on a mind-map card, an image in a
   * document, a screenshot in a thread. Returns a Drive file id, which is what
   * `driveImageSources` turns into something an `<img>` can load.
   *
   * **This is public media.** Confidential files go through `uploadAttachment`,
   * which stores them privately and streams them back behind the permission
   * check. The two are not interchangeable and neither should grow into the
   * other — a component picking the wrong one either leaks a file or fails to
   * render it.
   *
   * Optional for the same reason as the method above: the in-memory prototype
   * has no storage, so a surface that needs it renders its control off rather
   * than offering an upload that cannot happen.
   */
  uploadDriveFile?(
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<ActionResult<UploadedMedia>>;
  /**
   * Start a conversation, or return the existing one.
   *
   * Direct messages are DEDUPLICATED on the pair: messaging somebody you have
   * messaged before reopens that thread rather than starting a second one
   * beside it. Two threads with the same person is the failure mode that makes
   * a message list untrustworthy — you can no longer tell which one they will
   * read.
   */
  createConversation(
    input: CreateConversationInput,
  ): Promise<ActionResult<Conversation>>;
  /**
   * Clear the unread count for the caller.
   *
   * Separate from `listMessages` on purpose: reading a thread is a side effect
   * on the reader, and a query that mutates would make the unread badge depend
   * on which components happened to mount.
   */
  markConversationRead(conversationId: string): Promise<ActionResult<void>>;
  /**
   * Record that this client has RECEIVED the newest messages in these
   * conversations — the grey double tick, not the blue one.
   *
   * Deliberately separate from `markConversationRead`, and the distinction is
   * the whole point of the feature: receiving is something your client does by
   * being connected, reading is something you do by opening a thread. Folding
   * them together would turn every delivered message blue and make the tick say
   * nothing.
   *
   * Called with the conversations that actually need it — see
   * `conversationsNeedingDelivery`, which narrows to the ones where a message
   * has arrived since our last stamp. Passing everything would work and would
   * also loop, because the stamp lives on a document the list is watching.
   *
   * Optional: a backend with no delivery concept omits it, and every message
   * shows a single tick rather than a wrong one.
   */
  markConversationsDelivered?(
    conversationIds: string[],
  ): Promise<ActionResult<void>>;
  /**
   * Live updates for the conversation list, where the backend has a live channel.
   *
   * Optional on purpose: a backend without one (the in-memory prototype) simply
   * omits it, and the list still refreshes on the viewer's own writes. Returns an
   * unsubscribe the caller detaches on unmount. The method drives updates through
   * the same change signal every query already listens to, so nothing new has to
   * be threaded through the UI.
   */
  watchConversations?(): () => void;
  /** Live updates for one open conversation's messages; unsubscribe on unmount. */
  watchConversationMessages?(conversationId: string): () => void;
  /** Signal the viewer is (or is no longer) typing in a conversation. */
  setTyping?(conversationId: string, isTyping: boolean): Promise<void>;
  /** Who else is typing in a conversation, live. Unsubscribe on unmount. */
  watchTyping?(
    conversationId: string,
    onChange: (typingIds: string[]) => void,
  ): () => void;
  /** Live online/offline for a set of people. Unsubscribe on unmount. */
  watchPresence?(
    employeeIds: string[],
    onChange: (online: Record<string, boolean>) => void,
  ): () => void;
  /** Rename a group chat. Admin only. */
  updateGroup?(
    groupId: string,
    patch: { title?: string },
  ): Promise<ActionResult<void>>;
  /** Add someone to a group chat. Admin only. */
  addGroupMember?(
    groupId: string,
    employeeId: string,
  ): Promise<ActionResult<void>>;
  /** Remove someone from a group chat — or leave it, if it is you. */
  removeGroupMember?(
    groupId: string,
    employeeId: string,
  ): Promise<ActionResult<void>>;
  /** Promote or demote a group admin. Admin only; a group keeps at least one. */
  setGroupAdmin?(
    groupId: string,
    employeeId: string,
    isAdmin: boolean,
  ): Promise<ActionResult<void>>;
  listGroups(): Promise<Group[]>;
  getGroup(id: string): Promise<(Group & { members: Employee[] }) | null>;
  /* Mail — one mailbox, both transports. `folder` is a view, not a partition. */
  listMailThreads(query: {
    folder: MailFolder;
    transport?: MailTransport;
    search?: string;
  }): Promise<MailThread[]>;
  listMailMessages(threadId: string): Promise<MailMessage[]>;
  listMailAttachments(ids: string[]): Promise<MailAttachment[]>;
  getMailUnreadCount(): Promise<number>;
  setMailRead(messageId: string, read: boolean): Promise<ActionResult<void>>;
  setMailFlag(
    messageId: string,
    flag: "starred" | "trashed",
    on: boolean,
  ): Promise<ActionResult<void>>;
  /**
   * Transport is decided by the recipients, never by the caller.
   *
   * **Every field counts toward that decision.** One external address in `bcc`
   * makes the whole message external, exactly as it would in `to` — the message
   * is one artefact and cannot half-leave the building.
   */
  sendMail(input: {
    to: MailParty[];
    cc?: MailParty[];
    /** Blind. See `lib/rules/mail/blindCopy.ts` for what that has to mean. */
    bcc?: MailParty[];
    subject: string;
    body: string;
    attachmentIds?: string[];
    threadId?: string | null;
    gmail?: { messageId: string; threadId: string } | null;
    deliveryError?: string | null;
  }): Promise<ActionResult<MailMessage>>;

  /** Fold synced Gmail messages in. Idempotent by `gmailMessageId`. */
  importGmailMessages(
    messages: MailMessage[],
    /** The connected mailbox address — decides which parties are this person. */
    mailboxAddress: string,
  ): Promise<ActionResult<{ added: number }>>;

  /* ── Documents ──────────────────────────────────────────────────────────
   *
   * Phase 1 of the collaborative editor. The body is a separate read because a
   * list of thirty documents must not fetch thirty bodies to render a sidebar.
   *
   * `saveDocumentBody` is deliberately last-write-wins and says so: with one
   * editor that is correct, and phase 2 replaces the mechanism entirely with a
   * CRDT rather than layering locking on top of it. */
  listDocuments(kind?: DocumentKind): Promise<DocumentSummary[]>;
  getDocument(id: string): Promise<CoworkDocument | null>;
  getDocumentBody(id: string): Promise<CoworkDocumentBody | null>;
  createDocument(input: {
    title: string;
    kind?: DocumentKind;
    memberIds?: EmployeeId[];
  }): Promise<ActionResult<CoworkDocument>>;
  renameDocument(id: string, title: string): Promise<ActionResult<CoworkDocument>>;
  /** Soft. A deleted document is recoverable until something reaps it. */
  deleteDocument(id: string): Promise<ActionResult<void>>;
  /**
   * Write any part of a body. Each field only when given.
   *
   * `pageSetup` is here rather than on the record because it is a property of
   * the text — the measure decides where every line breaks — and because a list
   * drawing thirty rows has no use for thirty sets of margins.
   */
  saveDocumentBody(
    id: string,
    body: {
      html?: string;
      cells?: string | null;
      ydocState?: string | null;
      pageSetup?: DocumentPageSetup | null;
    },
  ): Promise<ActionResult<CoworkDocumentBody>>;
  /**
   * Add somebody, or change what they may do. Owners only.
   *
   * `null` removes them. The repository refuses anything that would leave the
   * document with no owner — see `rules/documents/access.ts`.
   */
  setDocumentMember(
    id: string,
    employeeId: EmployeeId,
    role: DocumentRole | null,
  ): Promise<ActionResult<CoworkDocument>>;

  /**
   * Saved checkpoints of a document's text, newest first.
   *
   * Each entry is a point the document can be put BACK to — see
   * `restoreDocumentVersion` — not a diff against the current text; comparing
   * two versions is explicitly out of scope for this pass. The document
   * checkpoints itself automatically while it is actively edited, on top of
   * whatever `saveDocumentVersion` adds by hand.
   */
  listDocumentVersions(id: string): Promise<DocumentVersionSummary[]>;
  /**
   * Check-point the document's CURRENT text by hand.
   *
   * `label` is a note to find it by later ("before the rewrite"), never
   * required. This copies whatever is already stored server-side — the
   * live autosave keeps that fresh — so it never needs the caller's own Yjs
   * state.
   */
  saveDocumentVersion(
    id: string,
    label?: string,
  ): Promise<ActionResult<DocumentVersionSummary>>;
  /**
   * Replace the document's current text with an earlier version's.
   *
   * **A replacement, not a merge.** Everything typed since the chosen version
   * is discarded from the live document — the version itself is untouched and
   * stays in the list, so this is not a way to lose it, only a way to stop
   * seeing it as current. Every connected collaborator's editor reconciles to
   * the restored text the normal way a document ever changes under them.
   */
  restoreDocumentVersion(
    id: string,
    versionId: string,
  ): Promise<ActionResult<void>>;

  /* ── Mindmaps ───────────────────────────────────────────────────────────
   *
   * The same record/body shape as documents, for the same reason: a list of
   * thirty maps must not read thirty card trees to draw a table of names. The
   * card count is on the record so the list can say how big a map is without
   * opening it.
   *
   * **These go over the engine, not browser-direct to the store, and that is
   * the one place this differs from documents.** A document body is opaque
   * text and cannot be malformed. A card tree can be — two roots, a parent
   * that is not in the map, a cycle — and none of those look wrong, they fail
   * to draw at all, for every member of that map. The validation therefore
   * lives in `grav-cms-backend` where a request cannot skip it, rather than in
   * the browser where it can. See `routes/task_routes/coworkMindmaps.js`. */
  listMindMaps(): Promise<MindMapSummary[]>;
  /** The map AND its cards — the only mindmap read that touches a body. */
  getMindMap(id: string): Promise<MindMapDetail | null>;
  /**
   * Make one.
   *
   * `nodes` is how a map kept in a browser is lifted onto the server. Omitted,
   * the server seeds a root card: an empty mindmap cannot be drawn and its only
   * possible first action is "add the root", so shipping that state would be
   * shipping a screen whose only exit is one button.
   */
  createMindMap(input: {
    title: string;
    memberIds?: EmployeeId[];
    nodes?: MindNode[];
  }): Promise<ActionResult<MindMapRecord>>;
  renameMindMap(id: string, title: string): Promise<ActionResult<MindMapRecord>>;
  /** Soft. A deleted map is recoverable until something reaps it. */
  deleteMindMap(id: string): Promise<ActionResult<void>>;
  /**
   * Write the cards. **The whole tree, every time.**
   *
   * Not a patch, and that is the correct shape rather than a lazy one: a
   * mindmap edit is frequently structural — reparenting a branch changes one
   * field on one card and the meaning of every card beneath it — so a per-card
   * protocol would have to describe moves, and two clients applying different
   * moves would produce a tree neither of them authored. Replacing the tree
   * makes the last writer's map the map, which is a rule a person can predict.
   *
   * A refusal here is a real answer and must be shown: the server rejects a
   * tree it cannot lay out, and it names the card that is wrong.
   */
  saveMindMapNodes(
    id: string,
    nodes: MindNode[],
  ): Promise<ActionResult<MindMapDetail>>;
  /**
   * Add somebody, or change what they may do. Owners only.
   *
   * `null` removes them. The server refuses anything that would leave the map
   * with no owner — a map nobody can rename, delete or share is one nothing
   * should be able to create.
   */
  setMindMapMember(
    id: string,
    employeeId: EmployeeId,
    role: MindMapRole | null,
  ): Promise<ActionResult<MindMapRecord>>;

  /* ── External sharing ───────────────────────────────────────────────────
   *
   * Sharing a document, sheet or mindmap with somebody outside the
   * organisation — by email, with a role, no Cowork account required. See
   * `ExternalShareInvite` for why this is a system parallel to (never an
   * extension of) `setDocumentMember`/`setMindMapMember`.
   *
   * All three go over the engine — `routes/task_routes/coworkExternalShare.routes.js` —
   * never browser-direct, for both kinds: the owner check has to be
   * re-derived server-side, and the invite email has to be sent from
   * somewhere that isn't the browser. */

  /** Every invite for one target — pending, accepted and revoked — newest
      first. Owner-only; the server answers "not found" identically for a
      missing target and one this caller does not own. */
  listExternalShares(
    kind: ExternalShareKind,
    id: string,
  ): Promise<ExternalShareInvite[]>;

  /**
   * Invite one external address. Owner-only.
   *
   * `role` may not be `"owner"` — the type already excludes it, and the
   * server refuses it again rather than trusting the type. Re-inviting the
   * same email supersedes any previous live invite for this (target, email)
   * pair rather than issuing a second live one.
   */
  inviteExternal(
    kind: ExternalShareKind,
    id: string,
    email: string,
    role: ExternalShareRole,
  ): Promise<ActionResult<ExternalShareInvite>>;

  /** Revoke one invite — pending or already accepted. Owner-only. If it was
      accepted, the guest's matching grant is removed in the same operation;
      an already-revoked or unknown invite id is a `not_found`. */
  revokeExternal(
    kind: ExternalShareKind,
    id: string,
    inviteId: string,
  ): Promise<ActionResult<void>>;

  listMeetings(): Promise<Meeting[]>;
  /* Meeting lifecycle. The organiser drives all of it; `manageRefusal` gates. */
  listMeetingParticipants(meetingId: string): Promise<MeetingParticipant[]>;
  listMeetingEvents(meetingId: string): Promise<MeetingEvent[]>;
  setMeetingStatus(
    meetingId: string,
    next: "waiting" | "live" | "completed" | "cancelled" | "archived",
  ): Promise<ActionResult<Meeting>>;
  setMeetingParticipants(
    meetingId: string,
    participantIds: EmployeeId[],
  ): Promise<ActionResult<Meeting>>;
  /**
   * Open the room, and return the meeting now carrying it.
   *
   * Separate from `setMeetingStatus("live")` because the room is a real thing
   * that has to be created before it can be entered: this mints the LiveKit
   * room and the join code, and sets the status as a CONSEQUENCE. Setting the
   * status alone would mark a meeting live with no room behind it, and everyone
   * arriving would be told the room is not open.
   *
   * Idempotent — called on a meeting that is already live it returns the room
   * that exists rather than replacing it.
   */
  openMeetingRoom(meetingId: string): Promise<ActionResult<Meeting>>;
  /** Attendance only. The token route is what controls entry. */
  recordMeetingPresence(
    meetingId: string,
    present: boolean,
  ): Promise<ActionResult<MeetingParticipant>>;
  listMeetingsForTask(taskId: TaskId): Promise<Meeting[]>;

  /* ── A task's own meeting ────────────────────────────────────────────────
   *
   * Every task has a room; nobody schedules it. The room is created by the
   * first person to join and the session is what gets recorded — see
   * `lib/rules/meetings/meetingCredit.ts` for what a session is worth and who
   * it reaches.
   */

  /**
   * Open (or re-open) this task's room and take a seat in it.
   *
   * Returns the credentials to connect with. Called on JOIN rather than at task
   * creation: a room per task created up front would be thousands of rooms
   * nobody entered, and LiveKit charges for what exists.
   */
  joinTaskMeeting(taskId: TaskId): Promise<
    ActionResult<{ sessionId: string; roomName: string; token: string; url: string }>
  >;

  /**
   * Leave the room, recording when.
   *
   * Attendance is what decides the credit — only the span the task's CREATOR
   * was present counts — so a leave that is never recorded would leave somebody
   * apparently in the room forever. Two things bound that: the session's own
   * close, which `creditableSecs` clamps to, and the beat below, which expires
   * a row nobody is holding open any more.
   *
   * Leaving LAST also closes the session, because the ordinary way out is a
   * closed tab and no button sees that.
   */
  leaveTaskMeeting(input: {
    taskId: TaskId;
    sessionId: string;
  }): Promise<ActionResult<void>>;

  /**
   * Keep this person's attendance row alive.
   *
   * **The panel beats every twenty seconds while somebody is in the room**, and
   * a row that has not been beaten for ninety stops counting as presence — see
   * `PRESENCE_TIMEOUT_MS` in `lib/rules/meetings/meetingCredit.ts`.
   *
   * Without it, `leftAt: null` meant "still here" for ever, because the only
   * thing that writes a departure is the leaving client and `beforeunload`
   * cannot await a round trip. One dropped write held a meeting open
   * indefinitely: it never became empty, so it never closed, so nobody was
   * credited and the panel reported a running meeting over an empty room.
   *
   * Never fails loudly. A missed beat is not worth an error on a panel somebody
   * is talking over, and four have to be missed before anything changes.
   */
  touchTaskMeeting(input: {
    taskId: TaskId;
    sessionId: string;
  }): Promise<ActionResult<void>>;

  /**
   * Close the session and credit it.
   *
   * **The one call that moves deadlines.** It computes the creditable span,
   * finds every live task of the assignee's, adds the seconds to each, and
   * writes a deadline-history row per task so the History tab can say
   * `previous → why → current`. Idempotent: a session already credited to a
   * task is never credited to it twice.
   */
  endTaskMeeting(input: {
    taskId: TaskId;
    sessionId: string;
  }): Promise<ActionResult<{ creditedSecs: number; creditedTaskIds: string[] }>>;

  /** This task's meeting sessions, newest first — what the Meetings tab lists. */
  listTaskMeetingSessions(taskId: TaskId): Promise<TaskMeetingSession[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  getMeetingByToken(token: string): Promise<Meeting | null>;
  createMeeting(input: CreateMeetingInput): Promise<ActionResult<Meeting>>;

  /* Notifications */
  listNotifications(): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<ActionResult<void>>;
  markAllNotificationsRead(): Promise<ActionResult<void>>;

  /* ── Focus Music ────────────────────────────────────────────────────────
     A PERSONAL UTILITY. None of this is readable by scoring, attendance,
     timers, work commits or any manager-visible surface, and none of it may
     become so. It exists so a person's own queue survives a refresh. */
  listMusicFavourites(): Promise<MusicResult[]>;
  toggleMusicFavourite(item: MusicResult): Promise<ActionResult<boolean>>;
  getMusicQueue(): Promise<MusicQueue>;
  saveMusicQueue(queue: MusicQueue): Promise<ActionResult<void>>;
  listMusicSearches(): Promise<string[]>;
  recordMusicSearch(query: string): Promise<ActionResult<void>>;
  clearMusicSearches(): Promise<ActionResult<void>>;
  listMusicPlayed(): Promise<MusicResult[]>;
  recordMusicPlayed(item: MusicResult): Promise<ActionResult<void>>;
  getMusicPreferences(): Promise<MusicPreferences>;
  saveMusicPreferences(
    patch: Partial<MusicPreferences>,
  ): Promise<ActionResult<MusicPreferences>>;
  /* Playlists. Named lists a person builds for themselves — never shared,
     never visible to anyone else, and subject to the same rule as the rest of
     this block: nothing here is readable by any manager surface. */
  listMusicPlaylists(): Promise<MusicPlaylist[]>;
  /** Null when the name was empty, too long, taken, or the ceiling was hit. */
  createMusicPlaylist(name: string): Promise<ActionResult<MusicPlaylist | null>>;
  renameMusicPlaylist(
    id: string,
    name: string,
  ): Promise<ActionResult<MusicPlaylist[]>>;
  deleteMusicPlaylist(id: string): Promise<ActionResult<MusicPlaylist[]>>;
  /** False when the track was already in that playlist. */
  addToMusicPlaylist(
    id: string,
    item: MusicResult,
  ): Promise<ActionResult<boolean>>;
  removeFromMusicPlaylist(
    id: string,
    trackId: string,
  ): Promise<ActionResult<MusicPlaylist[]>>;
  moveMusicPlaylistTrack(
    id: string,
    from: number,
    to: number,
  ): Promise<ActionResult<MusicPlaylist[]>>;

  /* Live monitoring — the manager's view of one person's working day.
     Six separate reads on purpose: they come from six different providers
     (LiveKit, presence, an endpoint agent, the scoring engine, the client, and
     whatever computes observations), so a slow or broken feed degrades its own
     panel instead of the page. Every one is scoped to a single employee and
     the repository is the only thing that may decide whether the caller is
     allowed to see them. */
  getMonitoringSubject(id: EmployeeId): Promise<MonitoringSubject | null>;
  listActivityEvents(id: EmployeeId, limit?: number): Promise<ActivityEvent[]>;
  getMonitoringPerformance(
    id: EmployeeId,
  ): Promise<MonitoringPerformance | null>;
  getDailySummary(id: EmployeeId): Promise<DailySummary | null>;
  getDeviceInfo(id: EmployeeId): Promise<DeviceInfo | null>;
  listObservations(id: EmployeeId): Promise<Observation[]>;
  /** Everything needing this manager about one person, in one list. */
  listInterventions(id: EmployeeId): Promise<InterventionItem[]>;
  /** One row per person beneath the viewer. Scoped by the reporting chain. */
  listTeamMonitoring(): Promise<TeamMonitoringRow[]>;
  getTeamAnalytics(): Promise<TeamAnalytics>;

  /* Help. Behind the repository like everything else, so the eventual UI never
     imports the knowledge base directly — and so a later implementation can
     answer from a service instead of a local corpus without any caller
     changing shape. */
  searchHelp(
    question: string,
    category?: HelpCategory,
  ): Promise<HelpSearchResult>;
  listHelpArticles(category?: HelpCategory): Promise<HelpArticle[]>;
  getHelpArticle(id: string): Promise<HelpArticle | null>;

  /* Demo control — prototype only, absent from the production implementation */
  resetDemoData(): Promise<void>;
  /**
   * Development profile switching. Optional on the interface on purpose: a
   * production `ApiRepository` simply does not implement it, and every caller
   * uses optional-call syntax, so there is no path by which a deployed build
   * can change who it is acting as.
   */
  /**
   * Bind an authenticated session to a workspace identity.
   *
   * Signup creates an ACCOUNT — email, password, organisation — and an employee
   * id to act as. That id does not exist in the workspace yet, and `getViewer`
   * deliberately falls back to the seeded default for an id it does not know,
   * which for a stale profile switch is right and for a real session would be
   * catastrophic: you would be signed in as somebody else.
   *
   * So the session says who it is and the workspace provisions that person if
   * absent. Idempotent — signing in again finds the employee and changes
   * nothing. The archetype chooses the role, so an administrator arrives with
   * administrative capabilities rather than being granted them by a second call
   * some caller might forget.
   *
   * This is the join between the two halves. When workspace data moves
   * server-side it becomes a lookup instead of a provision, and nothing above
   * it changes.
   */
  ensureSessionEmployee(input: {
    employeeId: EmployeeId;
    displayName: string;
    email: string;
    archetype: RoleArchetype;
    organisationName: string;
    /** The tenant this employee belongs to. Required for isolation. */
    organisationId: string;
    isFounder?: boolean;
  }): Promise<Employee>;

  /**
   * Provision every member of the organisation that this browser's store does
   * not have yet. Returns how many were added. Adds employees only — never
   * reporting relationships, which stay an administrator's decision.
   */
  ensureDirectoryEmployees(
    members: {
      employeeId: EmployeeId;
      displayName: string;
      email: string;
      archetype: RoleArchetype;
      isFounder?: boolean;
    }[],
    organisationName: string,
    organisationId: string,
  ): Promise<number>;

  /**
   * Employees the reporting tree does not place — no active primary manager and
   * not the organisation founder. Derived from `reporting` on every read, so the
   * tree remains the single source of truth. Reports only; never repairs.
   */
  listUnattachedEmployees(): Promise<Employee[]>;

  setActingEmployee?(employeeId: EmployeeId | null): void;
  /**
   * The verified request context: who, and in which organisation.
   *
   * The organisation is the isolation boundary — reads are scoped to it and
   * writes are stamped with it. A production implementation derives this from
   * the session server-side and ignores anything the client claims.
   */
  setActingContext?(
    context: { employeeId: EmployeeId; organisationId: string } | null,
  ): void;
  /** The tenant this repository is currently answering for. */
  actingOrganisationId?(): string;
  /**
   * Who the repository is acting as, **synchronously**.
   *
   * The same string `getViewer()` reports as `employeeId` — that method resolves
   * it from exactly this value and then spends a round trip on the reporting
   * tree, which is what it actually needs the network for. Anything that only
   * wants to know "which of these people am I" was paying for the tree.
   *
   * That cost was visible, not theoretical. The conversation list resolves
   * before the viewer query does, so every direct thread rendered its title
   * with nobody filtered out and showed BOTH names — the reader's own included
   * — until the tree came back and it corrected itself. A list that rewrites
   * itself a second after it appears reads as a fault whatever it settles on.
   *
   * Optional, so an implementation without an acting identity omits it and
   * callers fall back to the asynchronous answer.
   */
  actingEmployeeId?(): EmployeeId | null;
  setSimulatedFailure(mode: SimulatedFailure): void;
  getSimulatedFailure(): SimulatedFailure;
}

/** Lets every page demonstrate its error, offline and denied states. */
export type SimulatedFailure =
  "none" | "offline" | "error" | "permission_denied";

/* ── Mutation inputs ──────────────────────────────────────────────────────── */

export interface CreateTaskInput {
  title: string;
  /** Owning department. Defaults to the creator's when omitted. */
  departmentId?: string | null;
  description?: string | null;
  requirements?: string[];
  type: Task["type"];
  assigneeIds: EmployeeId[];
  parentTaskId?: TaskId | null;
  projectId?: ProjectId | null;
  estimatedEffortSecs?: number | null;
  deadlineMode: "timer" | "fixed";
  fixedDueAt?: string | null;
  senderWindowSecs?: number | null;
  approverId?: EmployeeId | null;
  goalId?: string | null;
  /**
   * C2 · the share of the company pool a GOAL task claims, as a percentage.
   *
   * Optional, and only read when `type` is `"goal"` — every other kind of task
   * is unaffected. Absent means the task carries no C2 config at all, which is
   * what a goal created before this existed looks like.
   */
  c2WeightagePercent?: number | null;
  /** The pool that share was agreed against, snapshotted onto the task. */
  c2GlobalMaxPoints?: number | null;
  /**
   * C2 · what the goal is, in one line.
   *
   * The old Cowork's `goalConfig.goalDescription`, kept under that name so a
   * goal created here reads correctly in the old app. Separate from the task's
   * own description: one says what the work is, the other states the outcome
   * being aimed at.
   */
  goalStatement?: string | null;
  /**
   * C2 · the date the whole goal is aimed at, as `YYYY-MM-DD`.
   *
   * **Not a deadline the task is scored against.** A goal task carries no
   * budget and no task-level due date — its steps do, one each, and those are
   * what earn or forfeit points. This is the outer date the roadmap is built
   * towards, stored as the old app's `goalConfig.deadline`.
   */
  goalDeadline?: string | null;
  tags?: string[];
  recurrence?: Task["recurrence"];
}

export interface ChangePriorityInput {
  taskId: TaskId;
  employeeId: EmployeeId;
  newRank: number;
  reason: string;
}

export interface ProposeDeadlineInput {
  taskId: TaskId;
  proposedDueAt: string;
  windowSecs: number;
  reason?: string;
}

export interface RequestExtensionInput {
  taskId: TaskId;
  proposedDueAt: string;
  /**
   * Seconds being ADDED, for a TIME BUDGET request.
   *
   * Omitted on a deadline escalation, deliberately. That conversation is
   * between a manager and the assignor and is entirely in dates — a duration
   * travelling with it invites the `oldDeadline + hours` sum, which is always
   * wrong because the work sits in a queue and runs through a calendar.
   */
  additionalSecs?: number;
  /**
   * The window being extended.
   *
   * Sent so the record can store previous + added = total at request time.
   * Approving overwrites the window, so an amount derived at read time is zero
   * for every extension ever granted — which is exactly what the history
   * showed.
   */
  previousWindowSecs?: number;
  reason: string;
}

export interface SubmitCompletionInput {
  taskId: TaskId;
  message: string;
  attachmentIds: string[];
}

export interface ReviewInput {
  submissionId: string;
  decision: ReviewDecision;
  reason: string;
  /** Rework only. Requires a reason and writes a ledger entry (O18). */
  waiveDeduction?: boolean;
  /**
   * Rework only. The acceptance criteria that failed, as text.
   *
   * The engine refuses a rework without at least one where the task has any —
   * "fix it" leaves the assignee to work out which criterion they missed, and
   * the criteria are already on the task.
   */
  reworkRequirements?: string[];
  /**
   * Rework only. Extra context, separate from the required review note.
   *
   * Kept apart because they answer different questions — why the work came
   * back, and what to do about it — and merging them would make the required
   * one optional in practice.
   */
  reworkNote?: string;
  /**
   * Rework only. IDs of files already uploaded through the attachment routes.
   *
   * IDs, never bytes: the file is stored and permission-checked before this
   * request is made, so a review submission cannot become a second upload path
   * with none of those checks.
   */
  reworkAttachmentIds?: string[];
  /**
   * Rework only. Where the returned work sits in the assignee's queue.
   *
   * **The reviewer's call, because only they can make it.** Sending work back
   * puts it on somebody who has already moved on to the next thing, and
   * whether the rework outranks what they are doing now is a judgement about
   * the work, not something the engine can derive. Everything below the chosen
   * rank re-chains behind it.
   *
   * Optional, and absent means "leave the rank as it was". A rejection must
   * never fail because a priority could not be chosen — a queue in a slightly
   * wrong order is recoverable, a review that did not save is not.
   */
  reworkPriority?: number | null;
}

/**
 * What sending work back would do to the rest of that person's queue.
 *
 * Answered by the engine running its real queue walk in simulation, rather
 * than by the screen doing its own arithmetic — a preview that predicts
 * something the commit does not do is worse than showing nothing.
 */
export interface ReworkQueuePreview {
  /**
   * The time the rework will be given, in seconds — the time that was NEVER
   * USED, not what was left when the reviewer got to it. Due 6:00, handed in
   * at 5:00, reviewed at 5:45: a full hour, not fifteen minutes.
   *
   * Null when the task carries no deadline or was never submitted.
   */
  leftoverSecs: number | null;
  /** The rank the task carries today — the default, so most reviewers change nothing. */
  currentRank: number | null;
  /** The rank this preview was computed for. */
  rank: number | null;
  rows: ReworkQueueRow[];
}

export interface ReworkQueueRow {
  taskId: TaskId;
  title: string;
  rank: number;
  /** True for the task being sent back. */
  isRework: boolean;
  /** Its deadline today. Null for the rework, which has none until it lands. */
  from: string | null;
  /** Its deadline if the reviewer commits this priority. */
  to: string;
}


export interface CreateProjectInput {
  name: string;
  description?: string | null;
  /**
   * **`ownerId` and `targetDate` are sent by the form; the rest are not.**
   *
   * OWNER DECISION, 18 Aug 2026 established that a project is a folder carrying
   * a name and a description, with no dates and no chosen membership. A later
   * decision reinstated two of these as OPTIONAL fields, and only two:
   *
   * · **`targetDate`** — the project's own deadline. Where it is set, no task
   *   under the project may be due after it (`subtaskDeadlineCap`). Where it is
   *   absent the project is still judged on the latest commitment its children
   *   carry, exactly as before, and nothing under it is capped.
   * · **`ownerId`** — who the project is assigned to, which decides whose
   *   projects it is listed under. Absent, it belongs to its creator.
   *
   * `memberIds`, `status`, `startDate`, `priority`, `tags` and
   * `initialTaskIds` remain unsent for the original reasons: membership is
   * whoever holds the tasks inside, status comes from that work, and the rest
   * fed nothing. A store that models projects more richly may still accept
   * them.
   */
  ownerId?: EmployeeId;
  targetDate?: string | null;
  memberIds?: EmployeeId[];
  status?: ProjectStatus;
  startDate?: string | null;
  priority?: Project["priority"];
  tags?: string[];
  initialTaskIds?: TaskId[];
}

/**
 * One row of the action inbox.
 *
 * Carries everything the row renders, so the view never recomputes a label or
 * re-derives a section from the task's fields — the two ways a rendered inbox
 * drifts from the rule that populated it.
 */
export interface ActionableItem {
  view: TaskView;
  reason: ActionableReason;
  /** The call to action, in the same words the task's own screen uses. */
  label: string;
  href: string;
  /** The second line: who it is between, or which review stage. */
  subtitle: string;
  /** Which workflow decision, for `reason: "approval"` only. */
  approvalKind: ApprovalKind | null;
}

export interface CreateMeetingInput {
  /** One line per agenda item. Optional — most meetings have none. */
  agenda?: string[];
  /** What this meeting is about, when it is about a specific piece of work. */
  taskId?: TaskId | null;
  projectId?: ProjectId | null;
  title: string;
  description?: string | null;
  participantIds: EmployeeId[];
  startsAt: string;
  endsAt: string;
}

/**
 * Starting a conversation.
 *
 * `participantIds` names the OTHER people; the caller is added by the
 * repository, because a client that had to remember to include itself would
 * eventually create a conversation the creator cannot see.
 *
 * A group chat is a conversation with a title and no `groupId`. That is not a
 * gap — `Conversation.groupId` is nullable precisely so a chat can exist
 * without a managed `Group` behind it. Groups are an administered object with
 * their own surface and their own `group.manage` capability; naming three
 * people and typing a title is not that, and quietly minting a Group record
 * here would put unmanaged entries on a surface somebody is responsible for.
 */
/**
 * One uploaded file, as every surface that draws it needs it.
 *
 * `fileId` is the load-bearing field and `url` is the courtesy: an `<img>` is
 * pointed at `driveImageSources(...)`, which builds the CDN URL from the id and
 * falls back to the byte proxy. The stored URL is kept so a record written today
 * still means something if the CDN host ever changes, and so a non-Drive asset
 * from the old application round-trips unchanged.
 */
export interface UploadedMedia {
  /** The Drive file id. Null only for a store that is not Drive. */
  fileId: string | null;
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * A file attached to a goal step's report.
 *
 * The link lives ON the report rather than behind an id, because that is where
 * the engine has kept it since the old Cowork and every stored report points
 * at it. Unlike the private attachment system behind `getAttachments`, these
 * are Drive links: whoever holds one can open the file, so nothing that needs
 * a permission check belongs here.
 *
 * @see CoworkRepository.uploadGoalReportFile
 */
export interface GoalReportFile {
  name: string;
  /** Where to open it. */
  driveUrl: string;
  /** Where to fetch the bytes. Falls back to `driveUrl`. */
  downloadUrl: string;
  mimeType: string;
  /** Bytes, or 0 where the engine did not record it. */
  size: number;
}

/**
 * One person's progress against one step of a shared goal.
 *
 * A goal assigned to several people is walked independently by each of them:
 * their own report, their own approval, their own points. This is the row that
 * holds that, keyed by employee id under a step's `perUserStatus`.
 *
 * Absent entirely on a single-assignee goal, where the step's flat fields are
 * the one person's state and nothing extra is written.
 *
 * @see lib/rules/scoring/goalPeople.ts for what may be read from it
 */
export interface GoalStepPerson {
  /** `pending`, `pending_approval` or `done` — the engine's own words. */
  status: string;
  report: {
    text: string;
    submittedAt: string | null;
    submittedBy: string | null;
    files: GoalReportFile[];
  } | null;
  doneAt: string | null;
  /** Handed in after the deadline, so it earned nothing. */
  lateSubmission: boolean;
  /** What this person earned. The step's FULL points, or 0 if it was late. */
  pointsAwarded: number;
}

export interface CreateSubtaskInput {
  parentTaskId: TaskId;
  title: string;
  description?: string | null;
  assigneeIds: EmployeeId[];
  /** At least one, and every id must belong to the parent. */
  satisfiesRequirementIds: string[];
  /**
   * The subtask's OWN completion requirements — its acceptance criteria.
   *
   * **Not the same thing as `satisfiesRequirementIds`**, and the difference is
   * the whole reason both exist. Those name the PARENT's requirements this
   * child closes; these are what has to be true before this child itself is
   * done, and they belong to whoever is doing it.
   *
   * `createSubtask` did not accept them at all, so criteria typed into the
   * subtask form were silently dropped while the same field on an ordinary task
   * saved correctly. The form offered them, the engine stored them, and only
   * this contract did not carry them.
   */
  requirements?: string[];
  estimatedEffortSecs?: number | null;
  fixedDueAt?: string | null;
  senderWindowSecs?: number | null;
}

export interface CreateConversationInput {
  kind: "direct" | "group";
  /** Everyone except the caller. */
  participantIds: EmployeeId[];
  /** Required for a group, ignored for a direct message. */
  title?: string | null;
}
