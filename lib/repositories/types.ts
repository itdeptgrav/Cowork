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
import type { DutyMode, DutyHistoryEntry } from "@/lib/rules/presence/duty";
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
} from "@/lib/domain";

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

export interface ProjectView {
  project: Project;
  owner: Employee;
  members: (ProjectMember & { employee: Employee })[];
  progress: ProjectProgress;
  milestones: ProjectMilestone[];
  taskLinks: ProjectTaskLink[];
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
    description: string;
    severity: ConductSeverity;
    scope: "global" | "department";
    departmentIds: string[];
  }): Promise<ActionResult<ConductPolicy>>;
  updateConductPolicy(
    id: string,
    patch: Partial<Omit<ConductPolicy, "id">>,
  ): Promise<ActionResult<ConductPolicy>>;

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
   * This employee's presence, with the staleness window already applied.
   *
   * Reads `cowork_duty_status/{employeeId}` — the presence store legacy already
   * has. There is **no second collection**: the old app writes this document,
   * the new app writes this document, and both read one answer.
   *
   * Never returns a raw `mode`. A claim whose heartbeat has expired is offline,
   * and resolving that here rather than at each call site is what stops a
   * closed browser leaving a green dot behind.
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
  }): Promise<ActionResult<DutyMode>>;
  /** Restate a live claim. Never moves the mode; cheap enough to run on a timer. */
  heartbeatDuty(connectionId: string): Promise<ActionResult<void>>;
  /**
   * Live presence for a set of people, for a manager's view.
   *
   * Returns an unsubscribe. The staleness window is applied per emission, so a
   * watcher's dot goes grey on its own when somebody's laptop shuts — without
   * anything being written by the person who left.
   */
  watchDutyModes(
    employeeIds: EmployeeId[],
    onChange: (modes: Map<EmployeeId, DutyMode>) => void,
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
  listMessages(conversationId: string): Promise<Message[]>;
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
   * Upload one file for a message and return the attachment to send.
   *
   * Optional: only a backend with an upload endpoint provides it, so the
   * in-memory prototype omits it and the composer's attach control stays off.
   * The two-step shape — upload, then `sendMessage` with the result — keeps the
   * message write a single Firestore document with no half-sent state.
   */
  uploadMessageAttachment?(
    file: File,
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
}


export interface CreateProjectInput {
  name: string;
  description?: string | null;
  ownerId: EmployeeId;
  memberIds: EmployeeId[];
  status: ProjectStatus;
  startDate?: string | null;
  targetDate?: string | null;
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

export interface CreateSubtaskInput {
  parentTaskId: TaskId;
  title: string;
  description?: string | null;
  assigneeIds: EmployeeId[];
  /** At least one, and every id must belong to the parent. */
  satisfiesRequirementIds: string[];
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
