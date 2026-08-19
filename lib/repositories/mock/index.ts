/**
 * The mock repository — the prototype's entire "backend".
 *
 * It implements `CoworkRepository` exactly, so replacing it with an API-backed
 * implementation requires no change in any component, hook or page.
 *
 * Workflow rules come from the approved specs. Where a rule is unresolved it
 * reads `lib/config/provisional.ts` and the result is flagged so the UI can
 * disclose it — never silently decided here.
 */

import { AUDIT_REFUSAL } from "@/lib/rules/settings/access";
import { ROLE_ADMIN } from "@/lib/auth/systemRoles";
import type { AuditEntry } from "@/lib/rules/settings/audit";
import {
  deadlineExtension,
  liveDeadline,
  timeBudgetExtension,
  type DeadlineExtensionRecord,
  type TimeBudgetExtensionRecord,
} from "@/lib/rules/tasks/extensionRecords";
import type { AttachmentEntity, AttachmentMeta } from "@/lib/legacy/attachments";
import {
  calculateDeadlineFeasibility,
  type Feasibility,
} from "@/lib/rules/tasks/deadlineFeasibility";
import type {
  ActionableItem,
  ParentContext,
  ActionErrorCode,
  ActionResult,
  ChangePriorityInput,
  CoworkRepository,
  CreateConversationInput,
  CreateSubtaskInput,
  CreateMeetingInput,
  CreateProjectInput,
  CreateTaskInput,
  DocumentVersionSummary,
  ExternalShareInvite,
  ExternalShareKind,
  ExternalShareRole,
  GoalReportFile,
  GoalStepPerson,
  Page,
  ProjectQuery,
  ProjectView,
  ProposeDeadlineInput,
  RequestExtensionInput,
  ReviewInput,
  SimulatedFailure,
  SubmitCompletionInput,
  TaskQuery,
  CreateRoleInput,
  TaskScope,
  TaskView,
  TimerSopStatus,
  UpdateRoleInput,
} from "../types";
import type {
  ApprovalStage,
  ApprovalWorkflow,
  Capability,
  AttendanceDay,
  AttendanceStatus,
  MrfRequest,
  MrfChatMessage,
  MrfStatus,
  RawItemHit,
  Department,
  BlockedDate,
  ChannelId,
  ConductEvent,
  ConductPolicy,
  Conversation,
  ConductSeverity,
  DailyReport,
  ReportAttachment,
  DeadlineCounter,
  DeadlineChangeRequest,
  Attachment,
  DeadlineExtension,
  BreakBudget,
  BreakSession,
  OfficeHours,
  OfficeHoursVersion,
  EmergencyRequest,
  OrganisationSettings,
  DeadlineProposal,
  Employee,
  EmployeeId,
  Goal,
  GoalActivity,
  MailAttachment,
  MailFolder,
  MailMessage,
  MailParty,
  MailThread,
  MailTransport,
  Meeting,
  MeetingEventType,
  MeetingParticipant,
  Message,
  MessageAttachment,
  MessageReply,
  Notification,
  PriorityAcknowledgement,
  PriorityCascade,
  PriorityChange,
  PriorityConflict,
  Project,
  ProjectActivity,
  ProjectId,
  ProjectMember,
  ProjectMilestone,
  ProjectTaskLink,
  Rejection,
  ReportingRelationship,
  ReworkRequest,
  Role,
  RoleArchetype,
  RoleId,
  Scope,
  ScoreOverview,
  ScoringRule,
  ScoringRuleVersion,
  Task,
  TaskChatMessage,
  TaskEvent,
  TaskId,
  TaskReview,
  TaskSubmission,
  TimerSession,
  WorkflowTrigger,
  Viewer,
  WorkCommit,
} from "@/lib/domain";

import {
  buildOverview,
  periodKeyFor,
  previousPeriodKey,
} from "@/lib/rules/scoring/engine";
import { provisionalNumber, provisionalString } from "@/lib/config/provisional";
import {
  actingId,
  bumpVersion,
  actingOrganisationId,
  setActingContext,
  setActingId,
  getStore,
  nextId,
  now,
  nowIso,
  persistStore,
  resetStore,
  tick,
} from "./store";
import {
  dutyDayKey,
  dutyTransition,
  heartbeatPatch,
  ownsClaim,
  readDutyMode,
  readDutySnapshot,
  type DutyDocument,
  type DutyHistoryEntry,
  type DutyMode,
  type DutySnapshot,
} from "@/lib/rules/presence/duty";
import { presenceWriteRefusal } from "@/lib/rules/presence/taskGate";
import {
  readOfficePolicy,
  validateOfficePolicy,
  type OfficePolicy,
} from "@/lib/legacy/officePolicy";
import type { ReportingNode } from "@/lib/legacy/hierarchy";
import {
  agreedOrRequestedSecs,
  transitionRefusal,
} from "@/lib/rules/tasks/extensionAuthority";
import {
  describeQueueFault,
  normalizePriorityQueue,
} from "@/lib/rules/tasks/priorityQueue";
import { NOT_YOURS_TO_ACCEPT } from "@/lib/rules/tasks/assignmentAcceptance";
import { applySettingsChange } from "@/lib/rules/settings/service";
import { OFFICE_POLICY_CHANGED } from "@/lib/rules/settings/audit";
import {
  AUDIT_SECTION,
  PROVISIONAL_RULES_CHANGED,
  SCORING_CHANGED,
  TASK_RULES_CHANGED,
  WORKFLOW_ROUTING_CHANGED,
} from "@/lib/rules/settings/sections";
import {
  readTaskRules,
  validateTaskRules,
  type TaskRules,
} from "@/lib/rules/settings/taskRules";
import {
  readWorkflowRouting,
  validateWorkflowRouting,
  type WorkflowRouting,
} from "@/lib/rules/settings/workflowRouting";
import {
  readScoringSettings,
  validateScoringSettings,
  type ScoringSettings,
} from "@/lib/rules/settings/scoringSettings";
import {
  validateRuleOverrides,
  type RuleOverrides,
} from "@/lib/rules/settings/ruleOverrides";
import {
  applyRefusal,
  approvalRefusal,
  mayDecideFor,
} from "../../rules/scoring/conduct.ts";
import { applyRuleOverrides } from "@/lib/config/settings";
import { projectScores } from "./scoring";
import { computeProgress } from "./progress";
import { musicStore } from "./musicStore";
import { FLOW_CHANNELS, MONTHS_SHORT } from "./flow";
import { HELP_ARTICLES } from "@/lib/help/knowledge";
import { searchHelp } from "@/lib/help/search";
import type { HelpCategory } from "@/lib/help/types";
import { directConversationKey, MESSAGE_PAGE_SIZE } from "@/lib/domain";
import { actionableFor } from "@/lib/rules/tasks/actionable";
import {
  istDayKey,
  isReportPending,
  workedToday,
} from "@/lib/rules/tasks/dailyReport";
import { validateAttendanceRecord } from "@/lib/rules/attendance/record";
import {
  DEFAULT_TIMER_SOP_CONFIG,
  computeTodayTarget,
  evaluateTimerSop,
  type TimerSopConfig,
} from "@/lib/rules/scoring/timerSop";
import { bucketWorkByDay, todayWindow } from "@/lib/rules/scoring/workTime";
import {
  canCancelMrf,
  canDecideMrf,
  mrfApprovalStats,
  mrfStats,
  validateNewMrf,
  type NewMrfInput,
} from "@/lib/rules/mrf/lifecycle";
import { closureOf, hasManager, unattachedEmployees } from "@/lib/auth/hierarchy";
import { runDurationSecs } from "@/lib/rules/tasks/timer";
import {
  addWallClockDuration,
  cascadeShifts,
  isDuplicateCascade,
} from "@/lib/rules/tasks/priorityCascade";
import {
  emergencyDecisionRefusal,
  emergencyRequestRefusal,
} from "@/lib/rules/tasks/emergency";
import { shiftableTasks, shiftedDueAt } from "@/lib/rules/tasks/deadlineShift";
import {
  claimedPercent,
  remainingPercent,
  weightageRefusal,
} from "@/lib/rules/scoring/goalPoints";
import {
  approvalOutcome,
  nodePointsFor,
  reportRefusal,
} from "@/lib/rules/scoring/goalNodes";
import {
  rollUpStatus,
  withDecision,
  withReport,
} from "@/lib/rules/scoring/goalPeople";
import {
  type Attendance as MeetingAttendance,
  creditsIn,
  crossDeptWindow,
  ordinaryWindow,
  roomEmptiedAtMs,
  roomIsEmpty,
  settleCrossDeptSession,
  settleSession,
} from "@/lib/rules/meetings/meetingCredit";
import {
  taskJoinRefusal,
  taskMeetingRoomName,
} from "@/lib/rules/meetings/taskRoom";
import {
  workingSecsInSpan,
  type WeekSchedule,
} from "@/lib/rules/tasks/deadlineCompensation";
import { sendRefusal, transportFor } from "@/lib/integrations/mail/transport";
import { previewOfHtml } from "@/lib/rules/documents/preview";
import { pageSetupRefusal } from "@/lib/rules/documents/pageSetup";
import { emergencyCompensationMs } from "@/lib/rules/tasks/emergency";
import { storedPictureRefusal } from "@/lib/rules/people/profilePicture";
import {
  canManage as canManageDocument,
  canView as canViewDocument,
  editRefusal,
  memberChangeRefusal,
  writeMembers,
} from "@/lib/rules/documents/access";
import { mindmapTreeRefusal } from "@/lib/rules/mindmap/validity";
import type {
  CoworkDocument,
  CascadeOrderEntry,
  CoworkDocumentBody,
  DocumentKind,
  DocumentPageSetup,
  DocumentRole,
  DocumentSummary,
} from "@/lib/domain";
import {
  mailVisibleTo,
  recipientRefusal,
  redactBcc,
  threadParticipants,
} from "@/lib/rules/mail/blindCopy";
import {
  assigneeCountRefusal,
  selfAssignmentRefusal,
} from "@/lib/rules/tasks/assignment";
import {
  canView,
  joinRefusal,
  manageRefusal,
  meetingRoomName,
  type MeetingViewer,
} from "@/lib/rules/meetings/access";
/* A value, not a type — the default has to exist at runtime for the migration. */
import { DEFAULT_OFFICE_HOURS } from "@/lib/domain/office";
import { officeHoursRefusal } from "@/lib/rules/calendar/officeHours";
import {
  breakBudget,
  breakDayKey,
  creditedBreakSecs,
  usedTodaySecs,
} from "@/lib/rules/tasks/breakMode";
import { selfReorderRefusal } from "@/lib/auth/priority";
import { completionState, subtaskRefusal } from "@/lib/rules/tasks/completion";
import { requirementCoverage } from "@/lib/rules/tasks/requirementCoverage";
import { reworkDeadline } from "@/lib/rules/tasks/reworkDeadline";
import { can, scopeFor, type PermissionContext } from "@/lib/auth/can";
import {
  assignableIds,
  assignmentRefusal,
  assignmentRelationship,
  upwardApprovers,
} from "@/lib/auth/assignment";
import {
  clearAllRuleOverrides,
  clearRuleOverride,
  setRuleOverride,
} from "@/lib/config/settings";
import {
  approverChain,
  resolveWorkflow,
  workflowFor,
  type ResolveContext,
} from "@/lib/auth/workflow";
import * as monitoring from "./monitoring";
import type {
  FlowChannelId,
  FlowPoint,
  MusicPreferences,
  MusicQueue,
  MusicResult,
  MindMapDetail,
  MindMapRecord,
  MindMapRole,
  MindMapSummary,
  MindNode,
} from "@/lib/domain";

const LATENCY_MS = 120;

/**
 * The demo office week, so offline compensation can be bounded to working hours
 * exactly as production is. 09:30–18:00 Monday–Friday, matching the seed's
 * `scheduledStart`/`scheduledEnd`; the weekend is off, so a Friday-evening
 * offline that runs to Monday credits nothing.
 */
const MOCK_OFFICE_SCHEDULE: WeekSchedule = {
  monday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  tuesday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  wednesday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  thursday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  friday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  saturday: { isOff: true },
  sunday: { isOff: true },
};

/**
 * Every READ passes through here.
 *
 * Two jobs. The latency makes loading states real rather than theoretical, and
 * the failure switch makes error states reachable — which they were not before:
 * the switch only covered mutations, so every "could not be loaded" branch in
 * the application was unreachable in the prototype and therefore untestable by
 * anyone reviewing it. A demo control that cannot demonstrate the states the
 * product spent its effort on is the wrong way round.
 */
function delay<T>(value: T): Promise<T> {
  const f = getStore().failure;
  /* Mutations carry an `ActionResult` and are already handled by `guard()`,
     which turns a simulated failure into a typed `{ ok: false }` rather than a
     rejection. Only reads — everything else — reject here. */
  const isMutationResult =
    !!value && typeof value === "object" && "ok" in (value as object);
  if (f !== "none" && !isMutationResult) {
    return new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              f === "offline"
                ? "You appear to be offline."
                : f === "permission_denied"
                  ? "You do not have permission to see this."
                  : "Something went wrong loading this.",
            ),
          ),
        LATENCY_MS,
      ),
    );
  }
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/**
 * Every mutation that SUCCEEDS returns through here, and nothing else does —
 * `delay()` already relies on that to tell a mutation result from a read. That
 * makes it the one place development persistence can hook without a save call
 * scattered through ninety methods, where the one that got forgotten would be
 * discovered as a mysteriously lost record weeks later.
 *
 * Failures deliberately do not save: a refused mutation left the store as it
 * was, so there is nothing new to write.
 */
function ok<T>(data: T): ActionResult<T> {
  persistStore();
  return { ok: true, data };
}

/**
 * Stored attendance rows in the shape the meeting rules read.
 *
 * The rules own "is anybody still in there"; the repository asks them rather
 * than re-deriving it, because a second copy of the presence rule is how a room
 * that looks live becomes one that cannot be joined.
 */
function toMeetingAttendance(
  rows: readonly {
    employeeId: string;
    joinedAt: string;
    leftAt: string | null;
    lastSeenAt?: string | null;
  }[],
): MeetingAttendance[] {
  const at = (v: string | null | undefined) => {
    const ms = v ? Date.parse(v) : NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  return rows.map((a) => ({
    employeeId: String(a.employeeId),
    joinedAtMs: at(a.joinedAt) ?? 0,
    leftAtMs: at(a.leftAt),
    lastSeenAtMs: at(a.lastSeenAt),
  }));
}
function fail(
  code: ActionErrorCode,
  message: string,
  field?: string,
): { ok: false; code: ActionErrorCode; message: string; field?: string } {
  return { ok: false, code, message, field };
}

/** Every mutation runs this first so simulated failure states are reachable. */
function guard() {
  const f = getStore().failure;
  if (f === "offline")
    return fail(
      "offline",
      "You appear to be offline. This change was not saved.",
    );
  if (f === "error")
    return fail(
      "conflict",
      "Something went wrong saving this change. Try again.",
    );
  if (f === "permission_denied")
    return fail("permission_denied", "You do not have permission to do this.");
  return null;
}

/** A small store catalogue, so search returns real hits in the demo. */
/* The prototype's HR-holiday switch. Module-level, like the store itself, so
   every screen reads one truth and a toggle flips the whole app at once. */
let hrHolidaySyncMock = true;

export class MockRepository implements CoworkRepository {
  /* ── Identity ───────────────────────────────────────────────────────────── */

  async getViewer(employeeId?: EmployeeId): Promise<Viewer> {
    const s = getStore();
    /* Falls back rather than throwing: an unknown id reaching here means a
       client sent a stale profile, and the right answer to that is the default
       viewer, not a crashed request. */
    const me =
      (employeeId && s.employees.find((e) => e.id === employeeId)) ||
      s.employees.find((e) => e.id === actingId())!;
    const roles = s.roles.filter((r) => me.roleIds.includes(r.id));
    const direct = s.reporting
      .filter((r) => r.managerId === me.id && !r.effectiveTo)
      .map((r) => r.employeeId);
    return delay({
      employeeId: me.id,
      roles,
      hierarchyIds: this.#closure(me.id),
      directReportIds: direct,
      hasManager: hasManager(s.reporting, me.id),
      administrativeLevel: Math.max(...roles.map((r) => r.administrativeLevel)),
    });
  }

  /* Delegates to `lib/auth/hierarchy`, which is where the rule now lives so it
     can be tested directly. Note the walk there counts only ACTIVE PRIMARY
     lines; this used to ignore `type`, so a dotted or secondary relationship
     silently granted a manager the same visibility as a real reporting line. */
  #closure(id: EmployeeId): EmployeeId[] {
    return closureOf(getStore().reporting, id);
  }

  async getCurrentEmployee() {
    return delay(getStore().employees.find((e) => e.id === actingId())!);
  }

  /**
   * Set or remove your own picture.
   *
   * Stores exactly what the person chose. That is not fabricated data — a
   * picture somebody uploaded in the demo is theirs — which is why the SEED
   * ships none: inventing faces for invented people would be, and the monogram
   * is the honest default for them.
   */
  async setMyProfilePicture(
    dataUrl: string | null,
  ): Promise<ActionResult<Employee>> {
    const g = guard();
    if (g) return g;
    if (dataUrl !== null) {
      const refusal = storedPictureRefusal(dataUrl);
      if (refusal) return fail("validation_failed", refusal);
    }
    const me = getStore().employees.find((e) => e.id === actingId());
    if (!me) return fail("not_found", "Your employee record could not be read.");
    tick();
    me.profilePictureUrl = dataUrl;
    persistStore();
    return delay(ok(me));
  }
  async listEmployees(): Promise<Employee[]> {
    return delay([...getStore().employees]);
  }
  async listAssignableEmployees(): Promise<Employee[]> {
    /* `reachableIds` walks the same scope rules `createTask` refuses on, so an
       employee with `self` scope gets themselves, a manager gets their direct
       reports, and an administrator with organisation scope gets everybody —
       across departments, because crossing a department is a matter for the
       approval chain, not a reason to hide the person. */
    const all = getStore().employees;
    const reachable = new Set(
      assignableIds(
        this.#ctx(),
        all.map((e) => e.id),
      ),
    );
    return delay(all.filter((e) => reachable.has(e.id)));
  }
  async getEmployee(id: EmployeeId) {
    return delay(getStore().employees.find((e) => e.id === id) ?? null);
  }
  async listRoles(): Promise<Role[]> {
    return delay([...getStore().roles]);
  }
  async listReporting(): Promise<ReportingRelationship[]> {
    return delay([...getStore().reporting]);
  }

  /**
   * The closure, derived from this store's own edges.
   *
   * Derived rather than stored so the demo tenant cannot drift from its own
   * reporting relationships — a second copy would let the tree say one thing and
   * `listReporting` another, and the seam between them is invisible on screen.
   *
   * `depth` walks up the primary line and returns **null on a cycle** rather than
   * looping or picking a number. A cycle is a broken record, and the honest answer
   * is "this chain cannot be resolved" — the same answer the legacy tree gives
   * when a manager is missing from the directory.
   */
  async listReportingLines(): Promise<ReportingNode[]> {
    const store = getStore();
    const primary = new Map<string, ReportingRelationship>();
    for (const edge of store.reporting) {
      if (edge.type === "primary" && !edge.effectiveTo) {
        primary.set(String(edge.employeeId), edge);
      }
    }
    const nameOf = (id: string) =>
      store.employees.find((e) => e.id === id)?.displayName ?? null;

    const depthOf = (id: string): number | null => {
      const seen = new Set<string>();
      let cursor = id;
      let depth = 0;
      for (;;) {
        if (seen.has(cursor)) return null;
        seen.add(cursor);
        const managerId = primary.get(cursor)?.managerId;
        if (!managerId) return depth;
        cursor = String(managerId);
        depth += 1;
      }
    };

    return delay(
      store.employees.map((employee) => {
        const edge = primary.get(employee.id);
        const secondary = store.reporting.find(
          (r) =>
            String(r.employeeId) === employee.id &&
            r.type !== "primary" &&
            !r.effectiveTo,
        );
        return {
          employeeId: employee.id,
          managerId: edge ? String(edge.managerId) : null,
          managerName: edge ? nameOf(String(edge.managerId)) : null,
          secondaryManagerId: secondary ? String(secondary.managerId) : null,
          secondaryManagerName: secondary
            ? nameOf(String(secondary.managerId))
            : null,
          directReportIds: [...primary.entries()]
            .filter(([, e]) => String(e.managerId) === employee.id)
            .map(([id]) => id),
          depth: depthOf(employee.id),
          /* Everybody in this store is a directory member by construction — the
             seed has no manager who lacks an account. Stated rather than left to
             a default so the field's meaning is not inferred from the demo. */
          isDirectoryMember: true,
        };
      }),
    );
  }
  async hierarchyOf(id: EmployeeId) {
    return delay(this.#closure(id));
  }

  /* ── Task views ─────────────────────────────────────────────────────────── */

  #view(task: Task): TaskView {
    const s = getStore();
    const assignments = s.assignments.filter((a) => a.taskId === task.id);
    const assignees = assignments
      .map((a) => s.employees.find((e) => e.id === a.employeeId))
      .filter(Boolean) as Employee[];
    const mine = assignments.find((a) => a.employeeId === actingId());
    const subs = s.submissions
      .filter((x) => x.taskId === task.id && !x.supersededById)
      .sort((a, b) => b.attempt - a.attempt);
    const proposal =
      s.proposals.find((p) => p.taskId === task.id && p.state === "pending") ??
      null;
    const counter = proposal
      ? (s.counters.find(
          (c) => c.proposalId === proposal.id && c.response === "pending",
        ) ?? null)
      : null;
    const due = task.deadline.dueAt;

    return {
      task,
      assignments,
      assignees,
      owner: s.employees.find((e) => e.id === task.createdById) ?? null,
      /* The prototype has no self-task manager substitution — the engine makes
         that swap server-side — so the assigner of record is the creator. Named
         rather than left undefined so the shape matches the product and the
         panel reads one field in both. */
      assigner: s.employees.find((e) => e.id === task.createdById) ?? null,
      loggedSecs: s.workCommits
        .filter((w) => w.taskId === task.id)
        .reduce((sum, w) => sum + w.durationSecs, 0),
      project: s.projects.find((p) => p.id === task.projectId) ?? null,
      myRank: mine?.rank ?? null,
      myStoredRank: mine?.rank ?? null,
      budgetOwner: null,
      budgetNegotiation: null,
      reworkRequested: [],
      reworkHistory: [],
      latestSubmission: subs[0] ?? null,
      openProposal: proposal,
      openCounter: counter,
      pendingAssignees: task.pendingAssigneeIds
        .map((id) => s.employees.find((e) => e.id === id))
        .filter((e): e is Employee => !!e),
      pendingApprovals: s.approvals.filter(
        (a) => a.taskId === task.id && a.decision === "pending",
      ),
      approvals: s.approvals
        .filter((a) => a.taskId === task.id)
        .sort((a, b) => a.stage - b.stage),
      reworkCount: s.reworkRequests.filter((r) => r.taskId === task.id).length,
      isOverdue:
        Boolean(due) &&
        new Date(due as string) < now() &&
        task.status !== "completed" &&
        task.status !== "cancelled",
      subtaskCount: s.tasks.filter(
        (t) => t.parentTaskId === task.id && !t.deletedAt,
      ).length,
      completion: completionState(
        task,
        s.tasks.filter((t) => t.parentTaskId === task.id && !t.deletedAt),
      ),
      parent: this.#parentContext(task),
      chatCount: s.chat.filter(
        (c) => c.taskId === task.id && c.thread === "chat",
      ).length,
    };
  }

  async listTasks(q: TaskQuery): Promise<Page<TaskView>> {
    const s = getStore();
    const viewer = await this.getViewer();
    let list = s.tasks.filter((t) => !t.deletedAt);

    const assignedTo = (taskId: string, empId: string) =>
      s.assignments.some((a) => a.taskId === taskId && a.employeeId === empId);

    if (q.scope === "mine") {
      list = list.filter((t) => assignedTo(t.id, viewer.employeeId));
    } else if (q.scope === "team") {
      // Hierarchy-scoped. Legacy let any TL see everyone (D10 reverses that).
      list = list.filter((t) =>
        viewer.hierarchyIds.some((id) => assignedTo(t.id, id)),
      );
    } else if (q.scope === "assigned_out") {
      list = list.filter(
        (t) =>
          t.createdById === viewer.employeeId &&
          !assignedTo(t.id, viewer.employeeId),
      );
    } else if (q.scope === "self_assigned" || q.scope === "submitted") {
      /* Legacy-only tabs. They are defined by fields the mock store does not
         have — `isSelfAssigned`, and a `completionStatus` moving through
         legacy's six-stage review — so there is nothing here to filter on.

         Empty, NOT unfiltered. Without this clause both scopes fell past the
         chain and returned every task in the organisation, which is the exact
         leak the `all` branch below was written to close. A tab that is empty
         because the mock cannot answer it is honest; one showing everybody's
         work is a permission failure wearing a tab's name. */
      list = [];
    } else if (q.scope === "all") {
      /* "All" used to fall straight through this chain, returning every task in
         the organisation to anyone who asked — the widest scope was the only
         one with no check at all. It now requires organisation-scoped
         `task.view`, and anyone without it gets their own hierarchy instead of
         an error: the request is reasonable, the reach is not. */
      if (scopeFor(this.#ctx(), "task.view") !== "organisation") {
        list = list.filter(
          (t) =>
            assignedTo(t.id, viewer.employeeId) ||
            viewer.hierarchyIds.some((id) => assignedTo(t.id, id)) ||
            t.createdById === viewer.employeeId ||
            /* Being asked to approve something is a reason to see it.
               Without this clause a cross-department approver could not: the
               task is not theirs, not their creation, and — because the
               assignee is deliberately held back until the chain clears — it
               has no assignment rows to reach them through either. The request
               was raised, they were notified, and the task was invisible.
               Any decision, not just `pending`, so it does not vanish from
               under them the moment they act on it. */
            s.approvals.some(
              (a) => a.taskId === t.id && a.approverId === viewer.employeeId,
            ),
        );
      }
    }

    if (q.status?.length)
      list = list.filter((t) => q.status!.includes(t.status));
    if (q.assigneeId)
      list = list.filter((t) => assignedTo(t.id, q.assigneeId!));
    if (q.projectId !== undefined)
      list = list.filter((t) => t.projectId === q.projectId);
    if (q.parentTaskId !== undefined)
      list = list.filter((t) => (t.parentTaskId ?? null) === q.parentTaskId);
    if (q.search) {
      const needle = q.search.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          t.reference.toLowerCase().includes(needle),
      );
    }

    let views = list.map((t) => this.#view(t));
    if (q.overdueOnly) views = views.filter((v) => v.isOverdue);
    if (q.blockedOnly) views = views.filter((v) => v.task.isBlocked);

    const sort = q.sort ?? "rank";
    views.sort((a, b) => {
      if (sort === "title") return a.task.title.localeCompare(b.task.title);
      if (sort === "updated")
        return b.task.updatedAt.localeCompare(a.task.updatedAt);
      if (sort === "due") {
        const ad = a.task.deadline.dueAt ?? "9999";
        const bd = b.task.deadline.dueAt ?? "9999";
        return ad.localeCompare(bd);
      }
      return (a.myRank ?? 999) - (b.myRank ?? 999);
    });

    const limit = q.limit ?? 50;
    const start = q.cursor ? Number(q.cursor) : 0;
    const slice = views.slice(start, start + limit);
    return delay({
      items: slice,
      nextCursor: start + limit < views.length ? String(start + limit) : null,
      total: views.length,
    });
  }

  async getTask(id: TaskId) {
    const t = getStore().tasks.find((x) => x.id === id && !x.deletedAt);
    return delay(t ? this.#view(t) : null);
  }

  /**
   * Break a task down. The parent becomes the project; nothing is duplicated.
   *
   * Order of checks matters and is the same order the person experiences: may I
   * do this, is the parent in a state to be broken down, do the chosen
   * requirements exist, and only then may I create work for this assignee.
   */
  async createSubtask(
    input: CreateSubtaskInput,
  ): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const parent = s.tasks.find((t) => t.id === input.parentTaskId);
    if (!parent) return fail("not_found", "The parent task was not found.");

    /* Only the people RESPONSIBLE for the parent may delegate from it. The
       owner raised it; the assignee carries it. A manager elsewhere with
       `task.create` may raise their own work but cannot reach into somebody
       else's project and restructure it. */
    const me = actingId();
    const isOwner = parent.createdById === me;
    const isAssignee = s.assignments.some(
      (a) => a.taskId === parent.id && a.employeeId === me,
    );
    if (!isOwner && !isAssignee)
      return fail(
        "permission_denied",
        "Only the person who raised this task or the person carrying it can break it down.",
      );

    const refusal = subtaskRefusal({
      parent,
      satisfiesRequirementIds: input.satisfiesRequirementIds,
    });
    if (refusal)
      return fail("validation_failed", refusal, "satisfiesRequirementIds");

    if (!input.title.trim())
      return fail("validation_failed", "Give the subtask a title.", "title");
    if (input.assigneeIds.length === 0)
      return fail("validation_failed", "Choose who will do this.", "assigneeIds");

    /* Delegated through `createTask`, deliberately. Every rule that governs
       raising work — the assignable set, the deadline model, the approval gate,
       the notifications — applies to a subtask unchanged, and reimplementing
       any of it here would be a second, quietly diverging copy. */
    const created = await this.createTask({
      title: input.title,
      description: input.description ?? null,
      type: "standard",
      assigneeIds: input.assigneeIds,
      parentTaskId: parent.id,
      projectId: parent.projectId,
      estimatedEffortSecs: input.estimatedEffortSecs ?? null,
      deadlineMode: input.senderWindowSecs ? "timer" : "fixed",
      fixedDueAt: input.fixedDueAt ?? null,
      senderWindowSecs: input.senderWindowSecs ?? null,
    });
    if (!created.ok) return created;

    const child = s.tasks.find((t) => t.id === created.data.id)!;
    child.satisfiesRequirementIds = [...new Set(input.satisfiesRequirementIds)];

    this.#event(
      parent.id,
      "subtask_added",
      `Broke out “${child.title}” against ${child.satisfiesRequirementIds.length} requirement${
        child.satisfiesRequirementIds.length === 1 ? "" : "s"
      }`,
    );
    persistStore();
    return delay(ok(child));
  }

  /**
   * Tick a requirement off directly.
   *
   * Refused when subtasks claim it — that requirement is answered by their
   * completion, and an owner able to override it could close a project over
   * work still running. The refusal names the subtasks so the reader knows
   * what they are waiting on rather than being told "no".
   */
  async setRequirementSatisfied(
    taskId: TaskId,
    requirementId: string,
    satisfied: boolean,
  ): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return fail("not_found", "Task not found.");

    const me = actingId();
    const isOwner = t.createdById === me;
    const isAssignee = s.assignments.some(
      (a) => a.taskId === t.id && a.employeeId === me,
    );
    if (!isOwner && !isAssignee)
      return fail(
        "permission_denied",
        "Only the person who raised this task or the person carrying it can tick off its requirements.",
      );

    const req = t.requirements.find((r) => r.id === requirementId);
    if (!req) return fail("not_found", "That requirement does not exist.");

    const claimants = s.tasks.filter(
      (x) =>
        x.parentTaskId === t.id &&
        !x.deletedAt &&
        x.status !== "cancelled" &&
        x.satisfiesRequirementIds.includes(requirementId),
    );
    if (claimants.length > 0)
      return fail(
        "invalid_state",
        `This requirement is delegated to ${claimants
          .map((c) => `“${c.title}”`)
          .join(", ")}. It is satisfied when they complete.`,
      );

    tick();
    req.satisfiedAt = satisfied ? nowIso() : null;
    req.satisfiedById = satisfied ? me : null;
    t.updatedAt = nowIso();
    this.#event(
      t.id,
      "requirement_satisfied",
      `${satisfied ? "Marked" : "Unmarked"} “${req.text}”`,
    );
    persistStore();
    return delay(ok(t));
  }

  async addRequirements(
    taskId: TaskId,
    texts: string[],
  ): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return fail("not_found", "Task not found.");

    const me = actingId();
    const isOwner = t.createdById === me;
    const isAssignee = s.assignments.some(
      (a) => a.taskId === t.id && a.employeeId === me,
    );
    if (!isOwner && !isAssignee)
      return fail(
        "permission_denied",
        "Only the person who raised this task or the person carrying it can change what done means.",
      );

    const clean = texts.map((x) => x.trim()).filter(Boolean);
    if (clean.length === 0)
      return fail("validation_failed", "Write at least one requirement.", "texts");

    tick();
    let order = t.requirements.length;
    for (const text of clean) {
      t.requirements.push({
        id: nextId("req"),
        text,
        order: order++,
        satisfiedAt: null,
        satisfiedById: null,
      });
    }
    t.updatedAt = nowIso();
    this.#event(
      t.id,
      "requirement_added",
      `Added ${clean.length} completion requirement${clean.length === 1 ? "" : "s"}`,
    );
    persistStore();
    return delay(ok(t));
  }

  async getSubtasks(id: TaskId) {
    const s = getStore();
    return delay(
      s.tasks
        .filter((t) => t.parentTaskId === id && !t.deletedAt)
        .map((t) => this.#view(t)),
    );
  }

  /* ── Task mutations ─────────────────────────────────────────────────────── */

  async createTask(input: CreateTaskInput): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    /* The same resolver the assignee picker filters with, so the list a person
       chose from and the rule they are judged by cannot disagree. Under the
       seeded roles this refuses nobody — legacy restricted assignment to
       nobody — but the check stays because the scope is editable data, and an
       organisation that narrows it must be enforced, not merely obeyed by a
       cooperative UI. */
    const refusal = assignmentRefusal(this.#ctx(), input.assigneeIds);
    if (refusal) return fail("permission_denied", refusal.message);
    if (!input.title.trim())
      return fail("validation_failed", "A title is required.", "title");
    /* Count rule, per task TYPE. Server-side and unconditional: the form
       renders from the same predicate, so a client that bypasses the form is
       refused here rather than quietly creating a second assignment row. */
    const countRefusal = assigneeCountRefusal({
      type: input.type,
      assigneeIds: input.assigneeIds,
    });
    if (countRefusal)
      return fail("validation_failed", countRefusal, "assigneeIds");

    /* A self-assigned task must name its creator and nobody else. The type and
       the assignee arrive together here, and this is the only layer that sees
       both. */
    const selfRefusal = selfAssignmentRefusal({
      type: input.type,
      assigneeIds: input.assigneeIds,
      creatorId: actingId(),
    });
    if (selfRefusal)
      return fail("validation_failed", selfRefusal, "assigneeIds");

    tick();
    const s = getStore();
    const id = nextId("t");
    const me = s.employees.find((e) => e.id === actingId());

    /* The owning department is DERIVED from the creator, never asked for.
       A field that asks is a field that can be answered wrongly, and the answer
       decides whether the work needs two department heads to approve it — so
       it is not a preference. An administrator may override it (they are the
       only role that legitimately files work on another department's behalf);
       for everyone else the request's value is ignored rather than refused,
       because it is not their decision to get wrong. */
    const mayOverride = can(this.#ctx(), "people.change_reporting").allowed;
    const departmentId =
      (mayOverride ? input.departmentId : null) ?? me?.departmentId ?? null;

    /* The relationship between this creator and these assignees, resolved once
       by the shared resolver so the form's prediction and this decision cannot
       diverge. It answers both questions — is this inside the reporting line,
       and does it genuinely cross a department — and a reporting line that
       spans a boundary means the boundary does not count. Legacy skipped its
       gate on the same ground. */
    const assigneeDepts = new Set(
      input.assigneeIds
        .map((aid) => s.employees.find((e) => e.id === aid)?.departmentId)
        .filter((d): d is string => !!d),
    );
    const relationship = assignmentRelationship({
      creatorId: actingId(),
      assigneeIds: input.assigneeIds,
      hierarchyIds: this.#closure(actingId()),
      directReportIds: s.reporting
        .filter((r) => r.managerId === actingId() && !r.effectiveTo)
        .map((r) => r.employeeId),
      creatorDepartmentId: departmentId,
      departmentOf: (id) =>
        s.employees.find((e) => e.id === id)?.departmentId ?? null,
    });
    const crossesDepartment = relationship.crossesDepartment;

    /* Legacy applied the cross-department gate to a deliberately narrow set of
       tasks. `taskForward.js:164` guards it with, verbatim:

         requesterRole !== "ceo" && !folderFlag && !repeatFlag
           && !thirdPartyFlag && !goalFlag && !parentTaskId
           && assigneeIds?.length === 1

       Every exclusion is a decision, not an oversight: a repeating or
       third-party or goal task runs on its own confirmation flow, a subtask
       inherits the parent's already-approved crossing, and the gate's
       two-approver shape assumes a single receiving department. Applying it to
       all of them — as this did — gates work legacy let through. `folderFlag`
       has no counterpart here: Cowork has no folder type, so the exclusion it
       bought is vacuous rather than dropped. The CEO exclusion is not
       reproduced: legacy replaced it with a separate receiver-side gate, and an
       administrator here is not exempt from a crossing they create. */
    /* Legacy exempted every subtask from the gate on the rationale that "a
       subtask inherits the parent's already-approved crossing". That rationale
       is sound and the implementation never checked it: parenting work to any
       task you can see routed it into another department with no approval at
       all. The exemption now has to be EARNED — the parent must actually have
       cleared a crossing, and into the same department this subtask is going
       to. Anything else is gated exactly like a root task.

       `legacyGate.test.ts` still transcribes the original condition. It is a
       record of what legacy did, and this is a deliberate divergence from it —
       noted there rather than silently making the two disagree. */
    const parentTask = input.parentTaskId
      ? s.tasks.find((t) => t.id === input.parentTaskId)
      : null;
    const parentClearedThisCrossing =
      !!parentTask &&
      s.approvals.some(
        (a) =>
          a.taskId === parentTask.id &&
          a.kind === "cross_department" &&
          a.decision === "approved",
      ) &&
      /* Same receiving department, or the inheritance does not apply: clearing
         a crossing into Operations says nothing about sending work to Platform. */
      input.assigneeIds.every((id) => {
        const child = s.employees.find((e) => e.id === id)?.departmentId ?? null;
        const parentAssignee =
          s.assignments.find((x) => x.taskId === parentTask.id)?.employeeId ??
          parentTask.pendingAssigneeIds[0] ??
          null;
        const parentDept = parentAssignee
          ? (s.employees.find((e) => e.id === parentAssignee)?.departmentId ??
            null)
          : null;
        return child === parentDept;
      });

    const gateEligible =
      input.type !== "recurring" &&
      input.type !== "external" &&
      input.type !== "goal" &&
      !parentClearedThisCrossing &&
      input.assigneeIds.length === 1;

    const crossWorkflow =
      crossesDepartment && gateEligible
        ? workflowFor(s.workflows, "cross_department", {
            departmentId,
            crossDepartment: true,
          })
        : null;
    const crossPlan = crossWorkflow
      ? approverChain(
          this.#resolveCtx(),
          crossWorkflow,
          actingId(),
          [...assigneeDepts].find((d) => d !== departmentId) ?? null,
          /* The person, not just their department — the receiving stage routes
             to their manager, and a department cannot have a manager. */
          input.assigneeIds[0] ?? null,
        )
      : null;

    /* A blocked gate stops creation rather than letting the work through
       ungated — "the receiving department has no head" is a sentence somebody
       has to read, not a stage that quietly disappears. */
    if (crossPlan?.blockedBy) {
      /* Say what cannot happen and what would fix it, not which internal stage
         failed. "Sending head of department: People has no head of department"
         names a workflow stage the reader has never heard of and offers them
         nothing to do. The approver chain has already tried the department's
         head and then the person's own manager — so by the time this fires,
         the organisation genuinely has nobody to route to, and the fix is a
         configuration change somebody has to make. */
      const side =
        crossPlan.blockedBy.rule === "target_department_hod"
          ? "the receiving"
          : "your";
      return fail(
        "invalid_state",
        `This task crosses departments, and there is nobody set up to approve it on ${side} side. ${crossPlan.blockedBy.unresolvedReason} Ask an administrator to set a head of department, or assign this to someone in your own department instead.`,
      );
    }

    /* Deadline mode follows the RELATIONSHIP, not a preference, and the caller's
       choice is overridden rather than trusted. Inside the creator's reporting
       line the assignee negotiates their resourcing, so the task runs on a
       budget — including when that line crosses a department, which is the case
       this used to get wrong. */
    const resolvedMode: "timer" | "fixed" = relationship.deadlineMode;

    /* Legacy's upward gate, restored. An employee assigning to a team lead set
       `pending_tl_approval` and the lead themselves accepted it — the domain
       already had `tl_assignment` for this, and nothing produced it. Skipped
       when the cross-department chain is running: that gate already requires
       two department heads, and stacking a third approver on top would gate the
       same task twice for the same crossing. */
    const upward = crossPlan?.chain.length
      ? []
      : upwardApprovers(this.#ctx(), input.assigneeIds);

    const selfAssignApproval =
      input.type === "self_assigned" && Boolean(input.approverId);
    const needsApproval =
      selfAssignApproval ||
      (crossPlan?.chain.length ?? 0) > 0 ||
      upward.length > 0;

    const task: Task = {
      organisationId: actingOrganisationId(),
      /* A new task has had no meetings. */
      meetings: { firstStartedAt: null, lastEndedAt: null, totalSecs: 0 },
      id,
      reference: `CW-${id.split("-")[1]}`,
      type: input.type,
      status: needsApproval ? "pending_approval" : "assigned",
      title: input.title.trim(),
      description: input.description ?? null,
      requirements: (input.requirements ?? [])
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text, order) => ({
          id: nextId("req"),
          text,
          order,
          satisfiedAt: null,
          satisfiedById: null,
        })),
      satisfiesRequirementIds: [],
      createdById: actingId(),
      createdByRoleId: "role-manager",
      rootCreatorEmployeeId: input.approverId ?? actingId(),
      departmentId,
      parentTaskId: input.parentTaskId ?? null,
      /* The prototype has no folders — every task it makes is work. */
      isFolder: false,
      projectId: input.projectId ?? null,
      groupId: null,
      estimatedEffortSecs: input.estimatedEffortSecs ?? null,
      deadline: {
        mode: resolvedMode,
        /* The assignor's window is the ceiling every later budget change is
           measured against, so it is recorded even when the mode is fixed. */
        originalWindowSecs: input.senderWindowSecs ?? null,
        currentWindowSecs:
          resolvedMode === "timer" ? (input.senderWindowSecs ?? null) : null,
        // A fixed deadline is stored as one. Legacy forced dueDate to null at
        // creation regardless of what the creator entered.
        dueAt: resolvedMode === "fixed" ? (input.fixedDueAt ?? null) : null,
        officialDueAt:
          resolvedMode === "fixed" ? (input.fixedDueAt ?? null) : null,
        /* Derived from a queue, which a freshly created task has not joined. */
        operationalDueAt: null,
        clockStartsAt: null,
        clockStartsAtSource: null,
        state: resolvedMode === "fixed" ? "agreed" : "unset",
        assignorWindowRejection: null,
      },
      approvalReason: needsApproval
        ? selfAssignApproval
          ? "self_assignment"
          : crossPlan?.chain.length
            ? "cross_department"
            : "tl_assignment"
        : null,
      /* The senior assignee approves their own incoming work, which is what
         legacy's `/task/:taskId/approve` required — it refused anybody not in
         `task.assigneeIds`. */
      /* Legacy's visibility gate: while a cross-department chain is running the
         assignee is parked here and given no assignment row, so the task does
         not appear on their list and cannot be started. They move across when
         the last approver agrees. */
      pendingAssigneeIds: crossPlan?.chain.length ? [...input.assigneeIds] : [],
      /* The prototype models a crossing by the approval chain it planned. */
      isCrossDepartment: (crossPlan?.chain.length ?? 0) > 0,
      approverIds: crossPlan?.chain.length
        ? crossPlan.chain
        : upward.length
          ? upward
          : input.approverId
            ? [input.approverId]
            : [],
      isScoreEligible: input.type !== "recurring" && input.type !== "external",
      recurrence: input.recurrence ?? null,
      goalId: input.goalId ?? null,
      isBlocked: false,
      blockedReason: null,
      tags: input.tags ?? [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    };
    s.tasks.push(task);

    // Rank auto-assign: the person's open-task count + 1, clamped to the
    // configured maximum. Legacy was unbounded on the server and clamped only
    // on the client, so a busy person could receive a rank the UI can't show.
    const maxRank = provisionalNumber("priorityMaxRank");
    /* Nothing is assigned while a cross-department gate is open — see
       `pendingAssigneeIds`. An assignment row here would put the task on
       somebody's list before the two departments had agreed to send it. */
    for (const empId of crossPlan?.chain.length ? [] : input.assigneeIds) {
      const open = s.assignments.filter((a) => {
        const t = s.tasks.find((x) => x.id === a.taskId);
        return (
          a.employeeId === empId &&
          t &&
          t.status !== "completed" &&
          t.status !== "cancelled" &&
          !t.deletedAt
        );
      }).length;
      s.assignments.push({
        id: nextId("a"),
        taskId: id,
        employeeId: empId,
        rank: Math.min(open + 1, maxRank),
        /* Derived per read from the whole queue, never stored. The mock does
           not compute a live or provisional queue at all — see the LegacyRepository
           equivalents in activeQueue.ts for the real derivation. */
        queuePosition: null,
        provisionalPosition: null,
        assignedAt: nowIso(),
        confirmedAt: null,
        startedAt: null,
        isScoreSubject: empId === input.assigneeIds[0],
      });
    }

    /* Cross-department gates, one Approval per resolved stage. Stage 1 is
       `pending`; the rest wait, and each opens as the previous clears — the
       sequential behaviour `Approval.stage` was designed for and which nothing
       had yet used. */
    if (crossPlan?.chain.length) {
      crossPlan.chain.forEach((approverId, i) => {
        /* `side` comes from the STAGE that produced this approver, never from
           its position in the chain. Position is wrong the moment a stage drops
           out: when the sender's own head is the person asking, the sending
           stage self-satisfies and the RECEIVING head slides into index 0 —
           and was then labelled "sender", telling the reader that another
           department's head represented theirs. */
        const from = crossPlan.stages.find(
          (st) => st.approverId === approverId && !st.selfSatisfied,
        );
        const side: "sender" | "receiver" =
          from?.rule === "target_department_hod" ||
          from?.rule === "target_reporting_manager"
            ? "receiver"
            : "sender";
        s.approvals.push({
          id: nextId("ap"),
          taskId: id,
          submissionId: null,
          kind: "cross_department",
          stage: i + 1,
          side,
          approverId,
          approverName:
            s.employees.find((e) => e.id === approverId)?.displayName ?? "",
          decision: i === 0 ? "pending" : "waiting",
          reason: null,
          decidedAt: null,
        });
      });
    } else if (upward.length) {
      /* The upward gate's records. The gate itself shipped without them, so the
         task sat in `pending_approval` with nothing for the senior assignee to
         act on and nothing for the creator to read. The rule is unchanged —
         `upwardApprovers` still decides who — this only writes down what it
         decided, in the same shape the cross-department branch uses. */
      upward.forEach((approverId, i) => {
        s.approvals.push({
          id: nextId("ap"),
          taskId: id,
          submissionId: null,
          kind: "assignment",
          stage: i + 1,
          side: null,
          approverId,
          approverName:
            s.employees.find((e) => e.id === approverId)?.displayName ?? "",
          decision: i === 0 ? "pending" : "waiting",
          reason: null,
          decidedAt: null,
        });
      });
    } else if (needsApproval && input.approverId) {
      s.approvals.push({
        id: nextId("ap"),
        taskId: id,
        submissionId: null,
        kind: "self_assignment",
        stage: 1,
        side: null,
        approverId: input.approverId,
        approverName:
          s.employees.find((e) => e.id === input.approverId)?.displayName ?? "",
        decision: "pending",
        reason: null,
        decidedAt: null,
      });
    }

    /* Tell the first approver. Nothing here did: `decideApproval` notifies the
       NEXT approver when a stage clears, so every approver after the first
       learned it was their turn and the first never did. A cross-department
       task sat pending with its sending head unaware, which is the failure the
       whole chain exists to prevent — legacy sent `department_approval_request`
       at exactly this point.

       Only the pending one. A `waiting` approver has nothing to act on yet and
       telling them now would make the notification meaningless by the time it
       is true. */
    const firstPending = s.approvals.find(
      (a) => a.taskId === id && a.decision === "pending",
    );
    if (firstPending)
      this.#notify(
        firstPending.approverId,
        "approval_requested",
        "Your approval is needed",
        `${me?.displayName ?? "Someone"} needs you to approve “${task.title}”.`,
        "task",
        id,
      );

    if (input.projectId) {
      s.projectTaskLinks.push({
        id: nextId("ptl"),
        projectId: input.projectId,
        taskId: id,
        linkedAt: nowIso(),
        linkedById: actingId(),
        milestoneId: null,
      });
      this.#projectActivity(
        input.projectId,
        "task_linked",
        `“${task.title}” linked`,
      );
    }

    this.#event(id, "created", "Task created");
    /* Only people who have actually been given the task. While a gate is open
       the assignee is parked in `pendingAssigneeIds` with no assignment row and
       the task hidden from their list — telling them it "was assigned to you"
       announces work they cannot see, from a request two department heads have
       not yet agreed to. They are told when the chain clears, by the release in
       `decideApproval`. */
    for (const empId of task.pendingAssigneeIds.length
      ? []
      : input.assigneeIds) {
      this.#notify(
        empId,
        "task_assigned",
        "New task",
        `“${task.title}” was assigned to you.`,
        "task",
        id,
      );
    }
    return delay(ok(task));
  }

  async updateTask(
    id: TaskId,
    patch: Partial<Task>,
  ): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    if (patch.title !== undefined && !String(patch.title).trim())
      return fail("validation_failed", "Title cannot be empty.", "title");
    tick();
    Object.assign(t, patch, { updatedAt: nowIso() });
    this.#event(id, "edited", "Task details edited");
    return delay(ok(t));
  }

  /**
   * Change the due date, recording why.
   *
   * Mirrors the legacy repository so a screen behaves identically on either
   * backend: the reason is required, and it moves BOTH dates. `officialDueAt`
   * is the scored one, and letting the two drift would score somebody against a
   * date they were never shown.
   */
  async setTaskDeadline(
    id: TaskId,
    newDueAt: string | null,
    reason: string,
  ): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    if (!reason.trim())
      return fail(
        "validation_failed",
        "A deadline change needs a reason. It is recorded in the task's deadline history, which is what makes a moved date accountable afterwards.",
        "reason",
      );

    const s = getStore();
    const task = s.tasks.find((t) => t.id === id);
    if (!task) return fail("not_found", "Task not found.");

    tick();
    task.deadline = {
      ...task.deadline,
      dueAt: newDueAt,
      officialDueAt: newDueAt,
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: newDueAt === null ? "unset" : "agreed",
    };
    task.updatedAt = nowIso();
    return delay(ok(task));
  }

  async cancelTask(id: TaskId, reason: string): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    if (!reason.trim())
      return fail(
        "validation_failed",
        "A reason is required to cancel.",
        "reason",
      );
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    const cancelDenied = this.#deny("task.cancel", this.#subjectOf(id));
    if (cancelDenied) return cancelDenied;
    if (t.status === "completed")
      return fail("invalid_state", "A completed task cannot be cancelled.");
    tick();
    t.status = "cancelled";
    /* Out of the queue, so everything behind it moves up. */
    this.#renumber(this.#holdersOfTask(String(id)));
    t.updatedAt = nowIso();
    this.#event(id, "cancelled", `Cancelled — ${reason}`);
    return delay(ok(t));
  }

  async deleteTask(id: TaskId): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    const deleteDenied = this.#deny("task.delete", this.#subjectOf(id));
    if (deleteDenied) return deleteDenied;
    tick();
    // Soft delete with a tombstone. Legacy hard-deleted recursively, orphaning
    // ledger entries and attachments (D25).
    t.deletedAt = nowIso();
    t.updatedAt = nowIso();
    this.#event(id, "deleted", "Task deleted");
    return delay(ok(undefined));
  }

  async resetTaskToDraft(id: TaskId): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    if (t.createdById !== actingId())
      return fail(
        "permission_denied",
        "Only the person who assigned this task can reset it.",
      );
    tick();
    t.status = "assigned";
    t.deadline = {
      ...t.deadline,
      currentWindowSecs: null,
      dueAt: null,
      state: "unset",
    };
    t.updatedAt = nowIso();
    s.assignments
      .filter((a) => a.taskId === id)
      .forEach((a) => {
        a.confirmedAt = null;
        a.startedAt = null;
      });
    this.#event(id, "reset_to_draft", "Reset to draft");
    return delay(ok(t));
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────────── */

  async confirmTask(id: TaskId): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    const a = s.assignments.find(
      (x) => x.taskId === id && x.employeeId === actingId(),
    );
    if (!a)
      return fail("permission_denied", NOT_YOURS_TO_ACCEPT);
    /* **No longer `deadline.state !== "agreed"`.** That was stricter than the
       engine, which skips the deadline requirement entirely for a task carrying a
       time budget — and the same over-strict condition in the UI is what left the
       assignee with a "Your move" and no control.

       What the engine genuinely will not accept is a task with neither a budget
       nor a date, because there is nothing to confirm agreement TO. */
    if (
      (t.estimatedEffortSecs ?? 0) <= 0 &&
      !t.deadline.dueAt &&
      t.deadline.state !== "agreed"
    ) {
      return fail(
        "invalid_state",
        "This task has neither a time budget nor a deadline yet, so there is nothing to accept. Propose a deadline first.",
      );
    }
    tick();
    a.confirmedAt = nowIso();
    t.status = "confirmed";
    /* Acceptance is what puts the work INTO the queue — before this it held no
       slot, so the queue has to be renumbered to make room for it. */
    this.#renumber(this.#holdersOfTask(String(id)));
    t.updatedAt = nowIso();
    this.#event(id, "confirmed", "Receipt confirmed");
    this.#notify(
      t.createdById,
      "task_confirmed",
      "Task confirmed",
      `“${t.title}” was confirmed.`,
      "task",
      id,
    );
    return delay(ok(t));
  }

  async startTask(id: TaskId): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    const a = s.assignments.find(
      (x) => x.taskId === id && x.employeeId === actingId(),
    );
    if (!a)
      return fail("permission_denied", "You are not assigned to this task.");
    if (!a.confirmedAt)
      return fail("invalid_state", "Confirm the task before starting it.");
    tick();
    a.startedAt = nowIso();
    t.status = "in_progress";
    t.updatedAt = nowIso();
    this.#event(id, "started", "Work started");
    return delay(ok(t));
  }

  /**
   * The assignee accepts the working window the assignor proposed.
   *
   * Legacy's `/task/:taskId/approve-sender-timer`. A budget task is NOT assigned
   * work with a deadline already on it — it is created with `dueDate: null` and
   * a proposed `senderTimerWindowSecs`, and the due date only exists once the
   * person doing the work has agreed to the amount of time. Accepting is what
   * creates it.
   *
   * Legacy's guards, transcribed: only an assignee may accept
   * ("Only assigned employees can approve"), the task must be open, and there
   * must be a window to accept ("No sender-set timer to approve").
   */
  async acceptAssignorWindow(id: TaskId): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    if (
      !s.assignments.some((a) => a.taskId === id && a.employeeId === actingId())
    )
      return fail(
        "permission_denied",
        "Only the assignee can accept this time.",
      );
    if (t.status !== "assigned")
      return fail("invalid_state", "This task is not waiting to be started.");
    if (t.deadline.mode !== "timer")
      return fail(
        "invalid_state",
        "This task has a fixed deadline, not a budget.",
      );
    const window = t.deadline.currentWindowSecs ?? 0;
    if (window <= 0)
      return fail("invalid_state", "There is no proposed time to accept.");
    if (t.deadline.state === "agreed")
      return fail("invalid_state", "This time has already been agreed.");

    tick();
    /* KNOWN DIVERGENCE, stated rather than hidden. Legacy computed this from
       WORKING time via `_addWorkingSecsIST`, reading the office schedule and
       breaks from `cowork_settings/office`, so a four-hour task accepted at
       17:15 did not fall due at 21:15 the same night. Cowork has no office
       schedule to read — `workCalendarId` exists on Employee but nothing
       resolves it — so this adds wall-clock seconds. Reproducing legacy here
       means building the calendar first; inventing an approximation would put a
       wrong due date on every budget task. */
    const due = new Date(now().getTime() + window * 1000);
    const me = s.employees.find((e) => e.id === actingId());
    t.deadline.dueAt = due.toISOString();
    t.deadline.officialDueAt = due.toISOString();
    t.deadline.state = "agreed";
    t.deadline.assignorWindowRejection = null;
    t.updatedAt = nowIso();
    this.#event(
      id,
      "deadline_decided",
      `Accepted the ${Math.round(window / 3600)}h window`,
    );
    this.#draftSystem(
      id,
      `${me?.displayName ?? "The assignee"} accepted the time: ${Math.round(window / 3600)}h. It can now be confirmed and started.`,
    );
    this.#notify(
      t.createdById,
      "deadline_decided",
      "Your proposed time was accepted",
      `“${t.title}” is ready to start.`,
      "task",
      id,
    );
    return ok(t);
  }

  /**
   * The assignee refuses the assignor's window and says why.
   *
   * Legacy's `/task/:taskId/reject-sender-timer`. Note what it does NOT do: the
   * status is unchanged. Legacy left the task open precisely so the person could
   * propose their own duration next, through the normal proposal flow. A refusal
   * here is the opening of a negotiation, not a rejection of the work.
   */
  async rejectAssignorWindow(
    id: TaskId,
    reason: string,
  ): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    if (!reason.trim())
      return fail("validation_failed", "A reason is required.", "reason");
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    if (
      !s.assignments.some((a) => a.taskId === id && a.employeeId === actingId())
    )
      return fail(
        "permission_denied",
        "Only the assignee can refuse this time.",
      );
    if (t.status !== "assigned")
      return fail("invalid_state", "This task is not waiting to be started.");
    if (t.deadline.mode !== "timer")
      return fail(
        "invalid_state",
        "This task has a fixed deadline, not a budget.",
      );
    if (t.deadline.state === "agreed")
      return fail("invalid_state", "This time has already been agreed.");

    tick();
    const me = s.employees.find((e) => e.id === actingId());
    t.deadline.assignorWindowRejection = {
      byId: actingId(),
      byName: me?.displayName ?? "",
      reason: reason.trim(),
      at: nowIso(),
    };
    t.updatedAt = nowIso();
    this.#event(id, "deadline_decided", `Refused the window: ${reason.trim()}`);
    this.#draftSystem(
      id,
      `${me?.displayName ?? "The assignee"} refused the allocated time (${Math.round((t.deadline.currentWindowSecs ?? 0) / 3600)}h). Reason: ${reason.trim()}`,
    );
    this.#notify(
      t.createdById,
      "deadline_decided",
      "Your proposed time was refused",
      `${me?.displayName ?? "The assignee"} needs a different amount of time for “${t.title}”.`,
      "task",
      id,
    );
    return ok(t);
  }

  /**
   * A system line in the pre-start negotiation thread.
   *
   * Legacy's window flows each post one of these into `draft_chat`
   * (`taskForward.js:1730` and `:1802`) so the negotiation reads as a
   * conversation rather than a status field that silently changed. Legacy also
   * skips notifying on system messages — the flow that posts them has already
   * notified — and this does the same by writing the message without a notify.
   */
  #draftSystem(taskId: TaskId, text: string): void {
    const s = getStore();
    s.chat.push({
      id: nextId("cm"),
      taskId,
      thread: "draft",
      senderId: "system",
      senderName: "Cowork",
      text,
      attachmentIds: [],
      messageType: "system",
      createdAt: nowIso(),
    });
  }

  /**
   * The receiving department sets the real effort on an approved crossing.
   *
   * Legacy's `/task/:taskId/department-tl-set-hours`. Three things happen there
   * and all three are reproduced:
   *
   *  1. `hasTimer: true` — the task CONVERTS from deadline-mode to a budget.
   *     Legacy's own comment: "Becomes a normal hasTimer:true task with a
   *     manager-preset duration — same senderTimerWindowSecs mechanism as any
   *     other task", so it then negotiates through the ordinary window flow.
   *  2. `arrayUnion(targetId)` — this is the moment the assignee first sees it.
   *  3. `status: "open"` — it joins the normal queue.
   *
   * The guard is legacy's, translated from role-string to the resolved head of
   * the assignee's department: only that person may set it.
   */
  async setEffortEstimate(
    id: TaskId,
    secs: number,
  ): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return fail("not_found", "Task not found.");
    const ap = s.approvals.find(
      (a) =>
        a.taskId === id &&
        a.kind === "effort_estimate" &&
        a.decision === "pending",
    );
    if (!ap)
      return fail(
        "invalid_state",
        "This task is not waiting on an effort estimate — it may already be active.",
      );
    if (ap.approverId !== actingId())
      return fail(
        "permission_denied",
        "Only the head of the assignee's department can set the effort for this task.",
      );
    if (!(secs > 0))
      return fail(
        "validation_failed",
        "Enter a valid amount of effort.",
        "secs",
      );

    tick();
    ap.decision = "approved";
    ap.decidedAt = nowIso();

    t.deadline.mode = "timer";
    t.deadline.originalWindowSecs = secs;
    t.deadline.currentWindowSecs = secs;
    t.deadline.dueAt = null;
    t.deadline.officialDueAt = null;
    t.deadline.state = "unset";
    t.estimatedEffortSecs = secs;
    t.status = "assigned";
    t.approvalReason = null;
    t.approverIds = [];
    t.updatedAt = nowIso();

    const me = s.employees.find((e) => e.id === actingId());
    const maxRank = provisionalNumber("priorityMaxRank");
    for (const empId of t.pendingAssigneeIds) {
      const open = s.assignments.filter((a) => {
        const other = s.tasks.find((x) => x.id === a.taskId);
        return (
          a.employeeId === empId &&
          other &&
          other.status !== "completed" &&
          other.status !== "cancelled" &&
          !other.deletedAt
        );
      }).length;
      s.assignments.push({
        id: nextId("a"),
        taskId: t.id,
        employeeId: empId,
        rank: Math.min(open + 1, maxRank),
        /* Derived per read from the whole queue, never stored. The mock does
           not compute a live or provisional queue at all — see the LegacyRepository
           equivalents in activeQueue.ts for the real derivation. */
        queuePosition: null,
        provisionalPosition: null,
        assignedAt: nowIso(),
        confirmedAt: null,
        startedAt: null,
        isScoreSubject: empId === t.pendingAssigneeIds[0],
      });
      this.#notify(
        empId,
        "task_assigned",
        "A task has been assigned to you",
        `“${t.title}” is ready — check the time allowed and accept or discuss it.`,
        "task",
        t.id,
      );
    }
    t.pendingAssigneeIds = [];

    this.#event(
      id,
      "approval_decided",
      `Effort set to ${Math.round(secs / 3600)}h`,
    );
    this.#draftSystem(
      id,
      `${me?.displayName ?? "The department head"} set the effort at ${Math.round(secs / 3600)}h — the task is now active.`,
    );
    return ok(t);
  }

  async decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<ActionResult<Task>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const ap = s.approvals.find((a) => a.id === approvalId);
    if (!ap) return fail("not_found", "Approval not found.");
    if (ap.approverId !== actingId())
      return fail("permission_denied", "This approval is not yours to decide.");
    if (ap.decision !== "pending")
      return fail("invalid_state", "This approval has already been decided.");
    /* An effort estimate is a number, not a verdict. Deciding it here left the
       task deadline-mode, so the completion branch below raised ANOTHER effort
       stage — and again on the next decision. The task could never be released.
       It has its own entry point, which converts the task and frees the
       assignee. */
    if (ap.kind === "effort_estimate")
      return fail(
        "invalid_state",
        "This task needs an effort estimate rather than an approval. Set the effort to release it.",
      );
    if (decision === "rejected" && !reason?.trim())
      return fail(
        "validation_failed",
        "A reason is required to reject.",
        "reason",
      );

    tick();
    ap.decision = decision;
    ap.reason = reason ?? null;
    ap.decidedAt = nowIso();

    const task = s.tasks.find((t) => t.id === ap.taskId)!;
    if (decision === "rejected") {
      task.status = "assignment_rejected";
    } else {
      // Sequential gate: a waiting entry becomes pending once the prior clears.
      const siblings = s.approvals.filter((a) => a.taskId === ap.taskId);
      const nextWaiting = siblings
        .filter((a) => a.decision === "waiting")
        .sort((a, b) => a.stage - b.stage)[0];
      if (nextWaiting) {
        nextWaiting.decision = "pending";
        this.#notify(
          nextWaiting.approverId,
          "approval_your_turn",
          "Your approval is needed",
          `“${task.title}” is now waiting on you.`,
          "task",
          task.id,
        );
      } else if (siblings.every((a) => a.decision === "approved")) {
        /* Legacy's `pending_tl_hours`. Both department heads have agreed, but a
           DEADLINE-mode crossing does not reach the assignee yet: the receiving
           department sets the real effort first. `department-approve` computes
           `finalStatus = (task.hasTimer === false) ? "pending_tl_hours" : "open"`
           and deliberately withholds `arrayUnion(finalAssigneeId)` in that
           branch — "the task stays invisible to them until then".

           The person who sets it is, in legacy, the assignee's own department
           TL (`role !== "tl" || targetInfo.department !== callerDept` → 403).
           Here that is the receiving department's head, which is the same
           deterministic role `target_department_hod` already resolved for the
           stage that just cleared — rather than legacy's unordered
           `where(role == "tl").limit(1)`, the coin flip LEGACY_AUDIT flagged. */
        const receivingDept = task.pendingAssigneeIds
          .map((id) => s.employees.find((e) => e.id === id)?.departmentId)
          .find((d): d is string => !!d);
        /* The receiver's manager, not the receiving department's head.
           The head can BE the assignee — Operations is headed by Hanne, so a
           task sent to Hanne asked Hanne to set the effort on her own incoming
           work, and it sat there forever. Same defect the approval chain had;
           this branch resolved its approver independently and kept it. */
        const receiver = task.pendingAssigneeIds[0] ?? null;
        const managerOf = (id: string | null) =>
          id
            ? (s.reporting.find((r) => r.employeeId === id && !r.effectiveTo)
                ?.managerId ?? null)
            : null;
        const deptHead = receivingDept
          ? (s.departments.find((d) => d.id === receivingDept)?.hodEmployeeId ??
            null)
          : null;
        const receivingHod =
          managerOf(receiver) ?? (deptHead === receiver ? null : deptHead);

        const alreadyRaised = s.approvals.some(
          (a) => a.taskId === task.id && a.kind === "effort_estimate",
        );
        if (
          task.deadline.mode === "fixed" &&
          task.pendingAssigneeIds.length > 0 &&
          receivingHod &&
          !alreadyRaised
        ) {
          task.approvalReason = "effort_estimate";
          task.approverIds = [receivingHod];
          s.approvals.push({
            id: nextId("ap"),
            taskId: task.id,
            submissionId: null,
            kind: "effort_estimate",
            stage: siblings.length + 1,
            side: "receiver",
            approverId: receivingHod,
            approverName:
              s.employees.find((e) => e.id === receivingHod)?.displayName ?? "",
            decision: "pending",
            reason: null,
            decidedAt: null,
          });
          this.#draftSystem(
            task.id,
            "Both department heads approved. The receiving department is setting the effort before this reaches the assignee.",
          );
          this.#notify(
            receivingHod,
            "approval_your_turn",
            "Set the effort for an incoming task",
            `“${task.title}” was approved. Set the effort before it reaches your team member.`,
            "task",
            task.id,
          );
          return ok(task);
        }

        task.status = "assigned";
        /* The moment legacy called `arrayUnion(finalAssigneeId)`: every approver
           has agreed, so the people held back now actually receive the work. */
        const maxRank = provisionalNumber("priorityMaxRank");
        for (const empId of task.pendingAssigneeIds) {
          const open = s.assignments.filter((a) => {
            const t = s.tasks.find((x) => x.id === a.taskId);
            return (
              a.employeeId === empId &&
              t &&
              t.status !== "completed" &&
              t.status !== "cancelled" &&
              !t.deletedAt
            );
          }).length;
          s.assignments.push({
            id: nextId("a"),
            taskId: task.id,
            employeeId: empId,
            rank: Math.min(open + 1, maxRank),
            /* Derived per read from the whole queue, never stored. The mock does
               not compute a live or provisional queue at all — see the LegacyRepository
               equivalents in activeQueue.ts for the real derivation. */
            queuePosition: null,
            provisionalPosition: null,
            assignedAt: nowIso(),
            confirmedAt: null,
            startedAt: null,
            isScoreSubject: empId === task.pendingAssigneeIds[0],
          });
          this.#notify(
            empId,
            "task_assigned",
            "A task has been assigned to you",
            `“${task.title}” was approved and is now yours.`,
            "task",
            task.id,
          );
        }
        task.pendingAssigneeIds = [];
      }
    }
    task.updatedAt = nowIso();
    this.#event(task.id, "approval_decided", `Approval ${decision}`);
    return delay(ok(task));
  }

  /* ── Priority ───────────────────────────────────────────────────────────── */

  async changePriority(
    input: ChangePriorityInput,
  ): Promise<ActionResult<PriorityCascade | null>> {
    const g = guard();
    if (g) return g;
    if (!input.reason.trim())
      return fail(
        "validation_failed",
        "A reason is required for a priority change.",
        "reason",
      );
    /* Legacy wrote priority straight from the client with no authorisation and
       no audit (P6). It is now a capability against the person whose queue is
       being reordered. */
    const priorityDenied = this.#deny("task.priority.change", input.employeeId);
    if (priorityDenied) return priorityDenied;
    /* Your rank is set by whoever manages you. The capability check above
       cannot carry this — see `#selfReorderDenied`. */
    const selfDenied = this.#selfReorderDenied(input.employeeId);
    if (selfDenied) return selfDenied;

    const maxRank = provisionalNumber("priorityMaxRank");
    if (input.newRank < 1 || input.newRank > maxRank)
      return fail(
        "validation_failed",
        `Priority must be between 1 and ${maxRank}.`,
        "newRank",
      );

    const s = getStore();
    const asg = s.assignments.find(
      (a) => a.taskId === input.taskId && a.employeeId === input.employeeId,
    );
    if (!asg)
      return fail("not_found", "That person is not assigned to this task.");

    const previousRank = asg.rank;
    if (previousRank === input.newRank) return delay(ok(null));

    if (
      input.newRank > previousRank &&
      provisionalString("priorityDownwardAllowed") === "block"
    ) {
      return fail("invalid_state", "Lowering priority is not permitted.");
    }

    tick();
    const ordered = this.#orderedFor(input.employeeId).filter(
      (a) => a.taskId !== input.taskId,
    );
    ordered.splice(Math.max(0, input.newRank - 1), 0, asg);
    const cascade = this.#applyOrder(input.employeeId, ordered, input.reason);

    s.priorityChanges.push({
      id: nextId("pc"),
      taskId: input.taskId,
      employeeId: input.employeeId,
      previousRank,
      newRank: asg.rank,
      reason: input.reason,
      changedById: actingId(),
      changedAt: nowIso(),
      cascadeId: cascade?.id ?? null,
    });
    this.#event(
      input.taskId,
      "priority_changed",
      `Priority P${previousRank} → P${asg.rank}`,
    );
    /* `#applyOrder` already writes 1..N over the ordered list, so this is the
       belt to its braces: an active task missing from `#orderedFor` would keep a
       stale rank and duplicate one of the new ones. Idempotent, so a correct
       queue costs nothing. */
    this.#renumber([String(input.employeeId)]);
    return delay(ok(cascade));
  }

  /**
   * Renumber the queues a mutation disturbed. The mock's funnel.
   *
   * Synchronous over the store, so it can be called at the end of any mutation
   * without an await chain — and every mutation that changes queue membership
   * calls it, which is what makes the guarantee testable without Firestore.
   */
  #renumber(employeeIds: (string | null | undefined)[]): void {
    const s = getStore();
    for (const employeeId of new Set(employeeIds.filter(Boolean) as string[])) {
      const mine = s.assignments.filter((a) => a.employeeId === employeeId);
      const queue = normalizePriorityQueue(
        mine.map((a) => {
          const t = s.tasks.find((x) => x.id === a.taskId);
          return {
            taskId: a.taskId,
            status: t?.status ?? "cancelled",
            storedRank: a.rank,
            createdAtMs: t?.createdAt ? Date.parse(t.createdAt) : null,
            accepted: a.confirmedAt !== null,
          };
        }),
      );
      for (const change of queue.changes) {
        const a = mine.find((x) => x.taskId === change.taskId);
        if (a) a.rank = change.to;
      }
    }
  }

  /** Everybody holding a task, for the renumber above. */
  #holdersOfTask(taskId: string): string[] {
    return getStore()
      .assignments.filter((a) => a.taskId === taskId)
      .map((a) => a.employeeId);
  }

  async normalizePrioritiesAllUsers(): Promise<
    ActionResult<{
      scanned: number;
      users: number;
      changed: number;
      perUser: { employeeId: string; changed: number; fault: string | null }[];
    }>
  > {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;

    const s = getStore();
    const people = new Set(s.assignments.map((a) => a.employeeId));
    const perUser: { employeeId: string; changed: number; fault: string | null }[] =
      [];
    let changed = 0;

    for (const employeeId of people) {
      const before = s.assignments
        .filter((a) => a.employeeId === employeeId)
        .map((a) => [a.taskId, a.rank] as const);
      const result = await this.normalizePriorities(employeeId);
      const count = result.ok ? result.data.changed : 0;
      changed += count;
      perUser.push({
        employeeId,
        changed: count,
        fault: result.ok ? result.data.fault : null,
      });
      void before;
    }

    return delay(
      ok({ scanned: s.tasks.length, users: people.size, changed, perUser }),
    );
  }

  async normalizePriorities(
    employeeId: EmployeeId,
  ): Promise<ActionResult<{ changed: number; fault: string | null }>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const id = String(employeeId);

    const mine = s.assignments.filter((a) => a.employeeId === id);
    const queue = normalizePriorityQueue(
      mine.map((a) => {
        const t = s.tasks.find((x) => x.id === a.taskId);
        return {
          taskId: a.taskId,
          status: t?.status ?? "cancelled",
          storedRank: a.rank,
          createdAtMs: t?.createdAt ? Date.parse(t.createdAt) : null,
          accepted: a.confirmedAt !== null,
        };
      }),
    );

    const fault = describeQueueFault(queue);
    if (queue.isNormal) return delay(ok({ changed: 0, fault }));

    tick();
    for (const change of queue.changes) {
      const a = mine.find((x) => x.taskId === change.taskId);
      if (a) a.rank = change.to;
    }
    return delay(ok({ changed: queue.changes.length, fault }));
  }

  async reorderPriorities(
    employeeId: EmployeeId,
    orderedTaskIds: TaskId[],
    reason: string,
  ): Promise<ActionResult<PriorityCascade | null>> {
    const g = guard();
    if (g) return g;
    if (!reason.trim())
      return fail("validation_failed", "A reason is required.", "reason");
    /* This had no authorisation of any kind. It was unreachable — no caller
       existed — so nothing exploited it, but wiring drag-and-drop to it would
       have reintroduced exactly the hole legacy had: an unchecked client write
       reordering anybody's queue. */
    const denied = this.#deny("task.priority.change", employeeId);
    if (denied) return denied;
    const selfDenied = this.#selfReorderDenied(employeeId);
    if (selfDenied) return selfDenied;

    const s = getStore();
    const asgs = orderedTaskIds
      .map((tid) =>
        s.assignments.find(
          (a) => a.taskId === tid && a.employeeId === employeeId,
        ),
      )
      .filter(Boolean) as typeof s.assignments;
    tick();
    const cascade = this.#applyOrder(employeeId, asgs, reason);
    this.#renumber([String(employeeId)]);
    return delay(ok(cascade));
  }

  /**
   * The "not your own" rule, resolved against the live reporting tree.
   *
   * Separate from `#deny` because the capability cannot express it: `reaches()`
   * returns true for yourself before scope is consulted, so holding
   * `task.priority.change` at ANY scope would otherwise let anyone reorder
   * their own queue.
   */
  #selfReorderDenied(subjectId: EmployeeId) {
    const actor = actingId();
    const refusal = selfReorderRefusal({
      actorId: actor,
      subjectId,
      actorHasManager: hasManager(getStore().reporting, actor),
    });
    return refusal ? fail("permission_denied", refusal) : null;
  }

  /**
   * Move one task's deadline and record why.
   *
   * The ONLY place a deadline is extended. `decideExtension` reaches it from a
   * negotiated proposal and an approved emergency reaches it from a manager's
   * decision, so both produce the same `DeadlineExtension` record and obey the
   * same rule about the scored date.
   *
   * `officialDueAt` moves only when the penalty is waived. That separation is
   * the whole reason the field exists: a charged extension gives somebody more
   * working time without forgiving the lateness, and a waived one forgives it.
   */
  #extendDeadline(input: {
    task: Task;
    proposalId: string | null;
    newWindowSecs: number | null;
    previousWindowSecs: number;
    newDueAt: string | null;
    waivePenalty: boolean;
  }): DeadlineExtension {
    const t = input.task;
    const ext: DeadlineExtension = {
      id: nextId("de"),
      taskId: t.id,
      proposalId: input.proposalId,
      addedSecs: (input.newWindowSecs ?? 0) - input.previousWindowSecs,
      previousWindowSecs: input.previousWindowSecs,
      newWindowSecs: input.newWindowSecs ?? 0,
      elapsedPercentAtRequest: this.#elapsedPercent(t),
      penaltyWaived: input.waivePenalty,
      waiverDecidedById: actingId(),
      approvedById: actingId(),
      approvedAt: nowIso(),
    };
    getStore().extensions.push(ext);

    t.deadline.currentWindowSecs = input.newWindowSecs;
    t.deadline.dueAt = input.newDueAt;
    if (input.waivePenalty) t.deadline.officialDueAt = input.newDueAt;
    t.deadline.state = "agreed";
    t.updatedAt = nowIso();
    return ext;
  }

  /**
   * Move this person's active deadlines later by lost working time.
   *
   * The application half of offline compensation, and it is deliberately the
   * same shape a break takes: `shiftableTasks` picks the same eligible tasks, the
   * shift goes through `#extendDeadline`, and `waivePenalty` is FALSE — lost
   * availability moves the working deadline without forgiving the score, exactly
   * as a break does. Called with WORKING seconds already bounded to office hours
   * by the caller, so an evening or weekend offline arrives here as 0 and moves
   * nothing.
   */
  #creditAbsenceToDeadlines(lostWorkingSecs: number): void {
    if (lostWorkingSecs <= 0) return;
    const s = getStore();
    const me = actingId();
    const affected = shiftableTasks({
      tasks: s.tasks,
      employeeId: me,
      isAssigned: (t) =>
        s.assignments.some((a) => a.taskId === t.id && a.employeeId === me),
    });
    for (const t of affected) {
      const previous = t.deadline.currentWindowSecs ?? 0;
      this.#extendDeadline({
        task: t,
        proposalId: null,
        previousWindowSecs: previous,
        newWindowSecs: previous + lostWorkingSecs,
        newDueAt: shiftedDueAt(t.deadline.dueAt!, lostWorkingSecs),
        waivePenalty: false,
      });
      this.#event(
        t.id,
        "extension_decided",
        `Deadline moved by an offline absence (${Math.round(lostWorkingSecs / 60)}m)`,
      );
    }
  }

  #orderedFor(employeeId: EmployeeId) {
    const s = getStore();
    return s.assignments
      .filter((a) => {
        const t = s.tasks.find((x) => x.id === a.taskId);
        return (
          a.employeeId === employeeId &&
          t &&
          !t.deletedAt &&
          t.status !== "completed" &&
          t.status !== "cancelled"
        );
      })
      .sort((a, b) => a.rank - b.rank);
  }

  /**
   * Renumbers contiguously (the single semantic — O11) and cascades deadlines
   * for everything that moved down, crediting work already done and never
   * moving a deadline earlier.
   *
   * Runs synchronously as part of the reorder rather than 500ms later on a
   * timer, which is how legacy raced its own client write.
   */
  #applyOrder(
    employeeId: EmployeeId,
    ordered: { taskId: string; rank: number; employeeId: string }[],
    reason: string,
  ): PriorityCascade | null {
    const s = getStore();
    const before = new Map(ordered.map((a) => [a.taskId, a.rank]));

    /* The WHOLE queue as it stands, captured before anything is renumbered.
       Read from `#orderedFor` rather than from `ordered`, which may be a subset:
       a caller that omitted a task would otherwise produce a "full order" with
       the person's own work missing from it. */
    const entryOf = (taskId: string, rank: number): CascadeOrderEntry => {
      const t = s.tasks.find((x) => x.id === taskId);
      return {
        taskId,
        taskTitle: t?.title ?? taskId,
        rank,
        dueAt: t?.deadline.dueAt ?? null,
      };
    };
    const previousOrder = this.#orderedFor(employeeId).map((a, i) =>
      entryOf(a.taskId, i + 1),
    );

    ordered.forEach((a, i) => {
      a.rank = i + 1;
    });

    const top = ordered[0];
    if (!top) return null;
    const topTask = s.tasks.find((t) => t.id === top.taskId);
    if (!topTask) return null;

    const remainingOf = (taskId: string) => {
      const t = s.tasks.find((x) => x.id === taskId)!;
      const worked = s.workCommits
        .filter((w) => w.taskId === taskId && w.employeeId === employeeId)
        .reduce((sum, w) => sum + w.durationSecs, 0);
      const window = t.deadline.currentWindowSecs ?? t.estimatedEffortSecs ?? 0;
      return { worked, remaining: Math.max(0, window - worked) };
    };

    /* The reorder's effect on everybody else, computed by
       `lib/rules/tasks/priorityCascade.ts`.

       Relative, not an absolute finish estimate: a deadline moves by the work
       newly inserted ahead of it. The previous implementation asked "when will
       this realistically finish" and refused to pull a date earlier, so any
       queue carrying slack never moved at all — while the acknowledgement still
       announced that deadlines had. */
    const shifts = cascadeShifts({
      entries: ordered.map((a) => ({
        taskId: a.taskId,
        previousRank: before.get(a.taskId) ?? a.rank,
        newRank: a.rank,
        remainingSecs: remainingOf(a.taskId).remaining,
        dueAt: s.tasks.find((x) => x.id === a.taskId)?.deadline.dueAt ?? null,
      })),
      /* Wall-clock for now. Checkpoint 3 passes `addWorkingDuration` here and
         every shift counts office hours only, with no change to the rule. */
      addDuration: addWallClockDuration,
    });

    const effects = shifts.map((shift) => {
      const t = s.tasks.find((x) => x.id === shift.taskId)!;
      const { worked } = remainingOf(shift.taskId);
      const effect = {
        taskId: t.id,
        taskTitle: t.title,
        previousRank: before.get(t.id) ?? 0,
        newRank: ordered.find((a) => a.taskId === t.id)?.rank ?? 0,
        previousDueAt: shift.previousDueAt,
        newDueAt: shift.newDueAt,
        previousWindowSecs: t.deadline.currentWindowSecs,
        newWindowSecs: t.deadline.currentWindowSecs,
        shiftedBySecs: shift.shiftedBySecs,
        creditedWorkedSecs: worked,
      };

      /* `dueAt` only. `officialDueAt` is the scored commitment somebody agreed
         to — a colleague being promoted above them is not a renegotiation of
         it, and moving it here would forgive lateness nobody granted. The
         previous implementation moved both. */
      t.deadline.dueAt = shift.newDueAt;
      t.updatedAt = nowIso();
      return effect;
    });

    /* Two reasons to raise a cascade, and the second is new.
     *
     *  1. Deadlines moved. That is the original case and the reason the record
     *     carries `effects`.
     *  2. SOMEBODY ELSE reordered this person's queue. Now that priority is set
     *     by a manager rather than by the person working through it, a reorder
     *     that shifts no deadline is still something they have to be told —
     *     otherwise their day is silently rewritten by another person and the
     *     first they know of it is that the list looks different.
     *
     * `effects` is legitimately empty in the second case, and the
     * acknowledgement gate reads it that way rather than assuming a deadline
     * moved. */
    const changedByOther = actingId() !== employeeId;
    if (!effects.length && !changedByOther) return null;

    /* **Do not fire the same cascade twice in quick succession.**
     *
     * A drag that settles, a stale re-render, a double-submit — the same reorder
     * can reach here more than once, and each pass would push another record and
     * another notification for a shift that already happened. A cascade is
     * identified by whose queue moved, what triggered it, and why; an identical
     * one within `CASCADE_DEDUP_WINDOW_MS` is the same event observed twice, not
     * a new one, so the existing record is returned rather than duplicated. */
    const candidate = { employeeId, triggeringTaskId: topTask.id, reason };
    if (isDuplicateCascade(candidate, s.cascades, now().getTime())) {
      const existing = s.cascades.find(
        (c) =>
          c.employeeId === employeeId &&
          c.triggeringTaskId === topTask.id &&
          c.reason === reason,
      );
      /* One cascade, one notification, one acknowledgement — but the snapshot is
         refreshed. Returning it untouched would show somebody a "new order" that
         is one reorder out of date, which is worse than a duplicate: it is a
         confident wrong answer about the queue in front of them. */
      if (existing) {
        this.#renumber([String(employeeId)]);
        existing.effects = effects;
        existing.newOrder = this.#orderedFor(employeeId).map((a, i) =>
          entryOf(a.taskId, i + 1),
        );
      }
      return existing ?? null;
    }

    const me = s.employees.find((e) => e.id === actingId())!;
    /* Taken AFTER the ranks and the shifted dates have been written, and after a
       renumber, so a task the caller omitted carries its repaired rank rather
       than a stale one. `#renumber` is idempotent, so the callers' own calls
       stay exactly where they are. */
    this.#renumber([String(employeeId)]);
    const newOrder = this.#orderedFor(employeeId).map((a, i) =>
      entryOf(a.taskId, i + 1),
    );

    const cascade: PriorityCascade = {
      id: nextId("cas"),
      triggeringTaskId: topTask.id,
      triggeringTaskTitle: topTask.title,
      employeeId,
      reason,
      changedById: actingId(),
      changedByName: me.displayName,
      effects,
      previousOrder,
      newOrder,
      createdAt: nowIso(),
      acknowledgedAt: null,
    };
    s.cascades.push(cascade);

    // Both parties are told. Legacy notified only the manager, leaving the
    // affected person to discover it through a blocking modal.
    this.#notify(
      employeeId,
      "priority_cascade",
      effects.length ? "Deadlines shifted" : "Your priorities were changed",
      effects.length
        ? `${effects.length} of your tasks moved because “${topTask.title}” took priority.`
        : `${me.displayName} reordered your work. “${topTask.title}” is now first.`,
      "task",
      topTask.id,
    );
    for (const e of effects)
      this.#event(
        e.taskId,
        "priority_cascaded",
        "Deadline shifted by a priority change",
      );
    return cascade;
  }

  async listPriorityConflicts(
    employeeId: EmployeeId,
  ): Promise<PriorityConflict[]> {
    const byRank = new Map<number, string[]>();
    for (const a of this.#orderedFor(employeeId)) {
      byRank.set(a.rank, [...(byRank.get(a.rank) ?? []), a.taskId]);
    }
    return delay(
      [...byRank.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([rank, taskIds]) => ({ employeeId, rank, taskIds })),
    );
  }

  async listPendingAcknowledgements(employeeId: EmployeeId) {
    return delay(
      getStore().cascades.filter(
        (c) => c.employeeId === employeeId && !c.acknowledgedAt,
      ),
    );
  }

  async acknowledgeCascade(
    cascadeId: string,
    pauseTimerTaskId: TaskId | null,
  ): Promise<ActionResult<PriorityAcknowledgement>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const c = s.cascades.find((x) => x.id === cascadeId);
    if (!c) return fail("not_found", "Nothing to acknowledge.");
    tick();
    c.acknowledgedAt = nowIso();
    if (pauseTimerTaskId)
      await this.pauseTimer(pauseTimerTaskId, null, "priority_ack");
    const ack: PriorityAcknowledgement = {
      id: nextId("ack"),
      cascadeId,
      employeeId: c.employeeId,
      affectedTaskIds: c.effects.map((e) => e.taskId),
      acknowledgedAt: nowIso(),
      timerPausedTaskId: pauseTimerTaskId,
    };
    s.acknowledgements.push(ack);
    return delay(ok(ack));
  }

  async listPriorityChanges(taskId: TaskId): Promise<PriorityChange[]> {
    return delay(getStore().priorityChanges.filter((p) => p.taskId === taskId));
  }

  /* ── Deadlines ──────────────────────────────────────────────────────────── */

  async proposeDeadline(
    input: ProposeDeadlineInput,
  ): Promise<ActionResult<DeadlineProposal>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === input.taskId);
    if (!t) return fail("not_found", "Task not found.");
    if (input.windowSecs <= 0)
      return fail(
        "validation_failed",
        "Enter how long you need.",
        "windowSecs",
      );

    const blocked = await this.listBlockedDates(
      actingId(),
      input.proposedDueAt.slice(0, 10),
      input.proposedDueAt.slice(0, 10),
    );
    // Enforced, not advisory. Legacy computed blocked dates and never checked them.
    if (blocked.length)
      return fail(
        "validation_failed",
        `${blocked[0].label} — choose a working day.`,
        "proposedDueAt",
      );

    tick();
    const p: DeadlineProposal = {
      id: nextId("dp"),
      taskId: input.taskId,
      proposedById: actingId(),
      proposedDueAt: input.proposedDueAt,
      windowSecs: input.windowSecs,
      isExtension: false,
      previousWindowSecs: t.deadline.currentWindowSecs,
      addedSecs: null,
      reason: input.reason ?? null,
      state: "pending",
      decidedById: null,
      decisionReason: null,
      createdAt: nowIso(),
      expiresAt: new Date(
        now().getTime() + provisionalNumber("proposalExpiryHours") * 3600_000,
      ).toISOString(),
      decidedAt: null,
    };
    s.proposals.push(p);
    t.status = "deadline_negotiation";
    t.deadline.state = "proposed";
    t.deadline.currentWindowSecs = input.windowSecs;
    t.updatedAt = nowIso();
    this.#event(t.id, "deadline_proposed", "Deadline proposed");
    this.#notify(
      t.createdById,
      "deadline_proposed",
      "Deadline proposed",
      `A deadline was proposed for “${t.title}”.`,
      "task",
      t.id,
    );
    return delay(ok(p));
  }

  async decideProposal(
    proposalId: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<ActionResult<DeadlineProposal>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const p = s.proposals.find((x) => x.id === proposalId);
    if (!p) return fail("not_found", "Proposal not found.");
    if (p.state !== "pending")
      return fail("invalid_state", "This proposal is already decided.");
    if (decision === "rejected" && !reason?.trim())
      return fail(
        "validation_failed",
        "A reason is required to reject.",
        "reason",
      );

    tick();
    p.state = decision;
    p.decidedById = actingId();
    p.decisionReason = reason ?? null;
    p.decidedAt = nowIso();

    const t = s.tasks.find((x) => x.id === p.taskId)!;
    if (decision === "approved") {
      t.deadline.dueAt = p.proposedDueAt;
      t.deadline.officialDueAt = p.proposedDueAt;
      t.deadline.currentWindowSecs = p.windowSecs;
      t.deadline.originalWindowSecs ??= p.windowSecs;
      t.deadline.state = "agreed";
      t.status = "assigned";
    } else {
      // Roll the window back so a rejected ask doesn't leave it inflated.
      t.deadline.currentWindowSecs = p.previousWindowSecs;
      t.deadline.state = "unset";
      t.status = "assigned";
    }
    t.updatedAt = nowIso();
    this.#event(t.id, "deadline_decided", `Deadline ${decision}`);
    this.#notify(
      p.proposedById,
      "deadline_decided",
      `Deadline ${decision}`,
      `Your proposal for “${t.title}” was ${decision}.`,
      "task",
      t.id,
    );
    return delay(ok(p));
  }

  async counterProposal(
    proposalId: string,
    counterDueAt: string,
    counterWindowSecs: number,
    message: string,
  ): Promise<ActionResult<DeadlineCounter>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const p = s.proposals.find((x) => x.id === proposalId);
    if (!p) return fail("not_found", "Proposal not found.");
    if (p.state !== "pending")
      return fail("invalid_state", "This proposal is already decided.");
    tick();
    p.state = "countered";
    const c: DeadlineCounter = {
      id: nextId("dc"),
      proposalId,
      taskId: p.taskId,
      counteredById: actingId(),
      counterDueAt,
      counterWindowSecs,
      message: message || null,
      response: "pending",
      responseMessage: null,
      respondedAt: null,
      createdAt: nowIso(),
    };
    s.counters.push(c);
    const t = s.tasks.find((x) => x.id === p.taskId)!;
    t.deadline.state = "countered";
    t.updatedAt = nowIso();
    this.#event(t.id, "deadline_countered", "Counter-proposal made");
    this.#notify(
      p.proposedById,
      "deadline_countered",
      "Counter-proposal",
      `A different deadline was suggested for “${t.title}”.`,
      "task",
      t.id,
    );
    return delay(ok(c));
  }

  async respondToCounter(
    counterId: string,
    accepted: boolean,
    message?: string,
  ): Promise<ActionResult<DeadlineCounter>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const c = s.counters.find((x) => x.id === counterId);
    if (!c) return fail("not_found", "Counter-proposal not found.");
    if (c.response !== "pending")
      return fail("invalid_state", "Already responded.");
    tick();
    c.response = accepted ? "accepted" : "rejected";
    c.responseMessage = message ?? null;
    c.respondedAt = nowIso();

    const t = s.tasks.find((x) => x.id === c.taskId)!;
    if (accepted) {
      t.deadline.dueAt = c.counterDueAt;
      t.deadline.officialDueAt = c.counterDueAt;
      t.deadline.currentWindowSecs = c.counterWindowSecs;
      t.deadline.originalWindowSecs ??= c.counterWindowSecs;
      t.deadline.state = "agreed";
      t.status = "assigned";
    } else {
      t.deadline.state = "unset";
      t.status = "assigned";
    }
    t.updatedAt = nowIso();
    this.#event(
      t.id,
      "deadline_decided",
      accepted ? "Counter accepted" : "Counter rejected",
    );
    return delay(ok(c));
  }

  async requestExtension(
    input: RequestExtensionInput,
  ): Promise<ActionResult<DeadlineProposal>> {
    const g = guard();
    if (g) return g;
    if (!input.reason.trim())
      return fail(
        "validation_failed",
        "Explain why you need longer.",
        "reason",
      );
    const s = getStore();
    const t = s.tasks.find((x) => x.id === input.taskId);
    if (!t) return fail("not_found", "Task not found.");
    if (t.deadline.state !== "agreed")
      return fail(
        "invalid_state",
        "Agree a deadline before requesting an extension.",
      );

    const elapsed = this.#elapsedPercent(t);
    const floor = provisionalNumber("extensionRequestFloorPercent");
    if (elapsed < floor)
      return fail(
        "invalid_state",
        `Extensions can be requested once ${floor}% of the window has elapsed. You are at ${Math.round(elapsed)}%.`,
      );

    tick();
    const p: DeadlineProposal = {
      id: nextId("dp"),
      taskId: input.taskId,
      proposedById: actingId(),
      proposedDueAt: input.proposedDueAt,
      /* Absent on a DEADLINE escalation, which carries dates only — the
         manager↔assignor conversation has no hours in it. Present on a time
         budget request, where it is the whole point. */
      windowSecs: input.additionalSecs
        ? (t.deadline.currentWindowSecs ?? 0) + input.additionalSecs
        : 0,
      isExtension: true,
      previousWindowSecs: input.additionalSecs
        ? t.deadline.currentWindowSecs
        : null,
      addedSecs: input.additionalSecs ?? null,
      reason: input.reason,
      state: "pending",
      decidedById: null,
      decisionReason: null,
      createdAt: nowIso(),
      expiresAt: new Date(
        now().getTime() + provisionalNumber("proposalExpiryHours") * 3600_000,
      ).toISOString(),
      decidedAt: null,
    };
    s.proposals.push(p);
    t.deadline.state = "extension_pending";
    t.updatedAt = nowIso();
    this.#event(
      t.id,
      "extension_requested",
      `Extension requested at ${Math.round(elapsed)}% elapsed`,
    );
    this.#notify(
      t.createdById,
      "extension_requested",
      "Extension requested",
      `An extension was requested on “${t.title}”.`,
      "task",
      t.id,
    );
    return delay(ok(p));
  }

  #elapsedPercent(t: Task): number {
    const start = new Date(t.createdAt).getTime();
    const due = t.deadline.dueAt ? new Date(t.deadline.dueAt).getTime() : null;
    if (!due || due <= start) return 0;
    return Math.min(100, ((now().getTime() - start) / (due - start)) * 100);
  }

  async decideExtension(
    proposalId: string,
    decision: "approved" | "rejected",
    waivePenalty: boolean,
    reason?: string,
  ): Promise<ActionResult<DeadlineExtension | null>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const p = s.proposals.find((x) => x.id === proposalId);
    if (!p || !p.isExtension)
      return fail("not_found", "Extension request not found.");
    if (p.state !== "pending") return fail("invalid_state", "Already decided.");

    tick();
    p.state = decision;
    p.decidedById = actingId();
    p.decisionReason = reason ?? null;
    p.decidedAt = nowIso();

    const t = s.tasks.find((x) => x.id === p.taskId)!;
    if (decision === "rejected") {
      t.deadline.state = "agreed";
      t.updatedAt = nowIso();
      this.#event(t.id, "extension_decided", "Extension rejected");
      return delay(ok(null));
    }

    const ext = this.#extendDeadline({
      task: t,
      proposalId,
      newWindowSecs: p.windowSecs,
      previousWindowSecs: p.previousWindowSecs ?? 0,
      newDueAt: p.proposedDueAt,
      waivePenalty,
    });

    this.#event(
      t.id,
      "extension_decided",
      waivePenalty
        ? "Extension approved — penalty waived"
        : "Extension approved — penalty charged",
    );
    this.#notify(
      p.proposedById,
      "extension_decided",
      "Extension approved",
      `Your extension on “${t.title}” was approved.`,
      "task",
      t.id,
    );
    return delay(ok(ext));
  }

  /* ── Budget and deadline ────────────────────────────────────────────────── */

  /**
   * Whether the acting person is on the ASSIGNEE's side of this task.
   *
   * Budget rights belong to the people managing the person doing the work, not
   * to whoever happens to hold a capability. A manager elsewhere in the
   * organisation with `task.edit` at organisation scope still has no business
   * re-planning somebody else's team's week.
   */
  #isAssigneeSideManager(taskId: TaskId): boolean {
    const subject = this.#subjectOf(taskId);
    if (subject === actingId()) return false;
    return this.#closure(actingId()).includes(subject);
  }

  /**
   * Grow or shrink the working window, within what the assignor allowed.
   *
   * In the timer model the window IS the deadline — `officialDueAt` is computed
   * from it — so "budget freely but never the deadline" is self-defeating
   * unless the budget is bounded. The bound is `originalWindowSecs`: the window
   * the assignor set. Inside it, an assignee-side manager re-plans freely.
   * Beyond it, they are moving the scored deadline, and that is a request.
   */
  async adjustBudget(taskId: TaskId, windowSecs: number, reason: string) {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return fail("not_found", "Task not found.");
    if (!reason.trim())
      return fail("validation_failed", "A reason is required.", "reason");
    if (windowSecs <= 0)
      return fail(
        "validation_failed",
        "The budget must be positive.",
        "windowSecs",
      );

    if (!this.#isAssigneeSideManager(taskId)) {
      const denied = this.#deny("task.edit", this.#subjectOf(taskId));
      if (denied) return denied;
    }

    if (t.deadline.mode !== "timer")
      return fail(
        "invalid_state",
        "This task has a fixed deadline, so it has no budget to adjust.",
      );

    const ceiling = t.deadline.originalWindowSecs;
    if (ceiling !== null && windowSecs > ceiling) {
      return fail(
        "invalid_state",
        `That exceeds the window the assignor set (${formatSecs(ceiling)}). Request a deadline change instead — the assignor decides.`,
        "windowSecs",
      );
    }

    tick();
    t.deadline.currentWindowSecs = windowSecs;
    t.updatedAt = nowIso();
    this.#event(
      taskId,
      "budget_adjusted",
      `Budget set to ${formatSecs(windowSecs)} — ${reason}`,
    );
    return delay(ok(t));
  }

  /**
   * Ask the assignor to move the deadline.
   *
   * Routed to whoever set it — the task's creator — because the assignor
   * remains the owner of the deadline decision. An assignee-side manager can
   * ask; they cannot decide.
   */
  async requestDeadlineChange(
    taskId: TaskId,
    windowSecs: number,
    reason: string,
  ): Promise<ActionResult<DeadlineChangeRequest>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return fail("not_found", "Task not found.");
    if (!reason.trim())
      return fail("validation_failed", "A reason is required.", "reason");
    if (t.createdById === actingId())
      return fail(
        "invalid_state",
        "You set this deadline, so you can change it directly.",
      );

    const me = s.employees.find((e) => e.id === actingId());
    const req: DeadlineChangeRequest = {
      id: nextId("dcr"),
      taskId,
      requestedById: actingId(),
      requestedByName: me?.displayName ?? "",
      decidedById: t.createdById,
      requestedWindowSecs: windowSecs,
      currentWindowSecs: t.deadline.currentWindowSecs ?? 0,
      reason: reason.trim(),
      status: "pending",
      decisionReason: null,
      requestedAt: nowIso(),
      decidedAt: null,
    };
    tick();
    s.deadlineChangeRequests.push(req);
    this.#notify(
      t.createdById,
      "deadline_change_requested",
      "Deadline change requested",
      `${req.requestedByName} has asked to move the deadline on “${t.title}”.`,
      "task",
      taskId,
    );
    this.#event(
      taskId,
      "deadline_change_requested",
      `Deadline change requested — ${reason}`,
    );
    return delay(ok(req));
  }

  async decideDeadlineChange(
    requestId: string,
    accept: boolean,
    reason?: string,
  ): Promise<ActionResult<DeadlineChangeRequest>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const req = s.deadlineChangeRequests.find((r) => r.id === requestId);
    if (!req) return fail("not_found", "Request not found.");
    if (req.decidedById !== actingId())
      return fail(
        "permission_denied",
        "Only the person who set the deadline can decide this.",
      );
    if (req.status !== "pending")
      return fail("invalid_state", "This request has already been decided.");
    if (!accept && !reason?.trim())
      return fail(
        "validation_failed",
        "A reason is required to reject.",
        "reason",
      );

    tick();
    req.status = accept ? "accepted" : "rejected";
    req.decisionReason = reason ?? null;
    req.decidedAt = nowIso();

    if (accept) {
      const t = s.tasks.find((x) => x.id === req.taskId)!;
      /* Accepting moves BOTH the window and the ceiling: the assignor has
         re-set the deadline, so the new window is what future budget changes
         are measured against. */
      t.deadline.currentWindowSecs = req.requestedWindowSecs;
      t.deadline.originalWindowSecs = req.requestedWindowSecs;
      t.updatedAt = nowIso();
      this.#event(
        req.taskId,
        "deadline_change_decided",
        `Deadline moved to ${formatSecs(req.requestedWindowSecs)} by the assignor`,
      );
    }

    this.#notify(
      req.requestedById,
      accept ? "deadline_change_accepted" : "deadline_change_rejected",
      accept ? "Deadline change accepted" : "Deadline change rejected",
      reason ?? "",
      "task",
      req.taskId,
    );
    return delay(ok(req));
  }

  async listDeadlineChangeRequests(taskId: TaskId) {
    return delay(
      getStore()
        .deadlineChangeRequests.filter((r) => r.taskId === taskId)
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    );
  }

  /* ── Time budget extensions ─────────────────────────────────────────────
     Their own store, keyed by task. The fixture keeps them in memory for the
     same reason production keeps them in their own collection: a capacity
     record folded into the deadline history shares that record's status, and
     approving one then looks like approving the other. */
  async requestTimeBudgetExtension(input: {
    taskId: TaskId;
    requestedAdditionalSecs: number;
    reason?: string;
  }): Promise<ActionResult<TimeBudgetExtensionRecord>> {
    const s = getStore();
    const t = s.tasks.find((x) => x.id === input.taskId);
    if (!t) return fail("not_found", "That task does not exist.");
    const rec = timeBudgetExtension({
      id: nextId("tbe"),
      taskId: String(input.taskId),
      requestedBy: actingId(),
      /* The primary manager owns the hours. The fixture's directory records it
         the same way production's HR does. */
      approverId:
        s.reporting.find(
          (r) => r.employeeId === actingId() && !r.effectiveTo,
        )?.managerId ?? null,
      previousBudgetSecs: t.deadline.currentWindowSecs ?? t.estimatedEffortSecs ?? 0,
      requestedAdditionalSecs: input.requestedAdditionalSecs,
      reason: input.reason ?? null,
      createdAt: nowIso(),
    });
    s.timeBudgetExtensions.push(rec);
    tick();
    return { ok: true, data: rec };
  }

  /**
   * The manager's answer. **Hands the turn to the assignee; applies nothing.**
   *
   * The demo tenant runs the same loop as production for the same reason the
   * settings audit does: the transitions are where the bug was, and Firestore
   * cannot be unit-tested. Both implementations authorise through
   * `transitionRefusal`, so what a test asserts here is the shared rule.
   */
  async decideTimeBudgetExtension(
    recordId: string,
    decision: "approved" | "rejected",
    options?: { reason?: string; grantedSecs?: number },
  ): Promise<ActionResult<TimeBudgetExtensionRecord | null>> {
    const s = getStore();
    const rec = s.timeBudgetExtensions.find((r) => r.id === recordId);
    if (!rec) return fail("not_found", "That request does not exist.");

    const refusal = transitionRefusal({
      viewerId: actingId(),
      state: { budget: rec },
      intent: decision === "rejected" ? "reject" : "accept",
    });
    if (refusal) return fail("permission_denied", refusal);

    if (decision === "rejected") {
      rec.status = "rejected";
      rec.approvedAt = nowIso();
      if (options?.reason) rec.reason = options.reason;
      tick();
      return { ok: true, data: rec };
    }

    /* The manager's own figure. Null when they granted exactly what was asked —
       which is the only thing the decision card offers. */
    const granted =
      options?.grantedSecs !== undefined &&
      Math.round(options.grantedSecs) !== rec.newBudgetSecs
        ? Math.max(1, Math.round(options.grantedSecs))
        : null;

    /* **The manager's approval APPLIES the budget and settles the request, in
       one step.** The hours belong to the manager, and the backend authorises
       only them to set hours (`/set-budget` refuses anyone else) — so the manager
       is the one party who can make the grant take effect, and they are the
       caller here. Leaving the record at `approved` for the ASSIGNEE to confirm
       handed the applying step to somebody the backend would refuse, so it could
       never land. Applying here is what makes "approve" mean the budget moved. */
    const agreedSecs = granted ?? rec.newBudgetSecs;
    const t = s.tasks.find((x) => x.id === rec.taskId);
    if (t) {
      t.deadline.currentWindowSecs = agreedSecs;
      t.estimatedEffortSecs = agreedSecs;
      t.updatedAt = nowIso();
    }
    rec.status = "accepted";
    rec.approvedAt = nowIso();
    rec.approvedSecs = granted;
    rec.confirmedAt = nowIso();
    rec.confirmedBy = actingId();
    if (options?.reason) rec.reason = options.reason;
    tick();
    return { ok: true, data: rec };
  }

  /**
   * The assignee's answer, and the only place the budget is applied.
   *
   * Applying on confirmation rather than on approval is the whole fix: a manager
   * may grant fewer hours than were asked for, and a figure that binds somebody's
   * week should not take effect before they have agreed to it.
   */
  async confirmTimeBudgetExtension(
    recordId: string,
    answer: "accept" | "counter",
    options?: { counterSecs?: number; reason?: string },
  ): Promise<ActionResult<TimeBudgetExtensionRecord | null>> {
    const s = getStore();
    const rec = s.timeBudgetExtensions.find((r) => r.id === recordId);
    if (!rec) return fail("not_found", "That request does not exist.");

    const refusal = transitionRefusal({
      viewerId: actingId(),
      state: { budget: rec },
      intent: answer === "accept" ? "accept" : "negotiate",
    });
    if (refusal) return fail("permission_denied", refusal);

    if (answer === "counter") {
      const counterSecs = Math.max(1, Math.round(options?.counterSecs ?? 0));
      if (!counterSecs) {
        return fail("validation_failed", "Say how many hours in total you need.");
      }
      /* Back to the manager, one round on. The loop has no built-in limit —
         agreement is the only exit, and capping the rounds would end a
         conversation on somebody's terms rather than by consent. */
      rec.status = "counter_proposed";
      rec.approvedSecs = counterSecs;
      rec.round += 1;
      rec.approvedAt = null;
      if (options?.reason) rec.reason = options.reason;
      tick();
      return { ok: true, data: rec };
    }

    /* Accepting. The budget moves HERE and nowhere else — and no date is written:
       whether the deadline can hold is a separate question with a separate owner,
       already answered by the time this runs. */
    const agreedSecs = agreedOrRequestedSecs(rec);
    const t = s.tasks.find((x) => x.id === rec.taskId);
    if (t) {
      t.deadline.currentWindowSecs = agreedSecs;
      t.estimatedEffortSecs = agreedSecs;
      t.updatedAt = nowIso();
    }
    rec.status = "accepted";
    rec.confirmedAt = nowIso();
    rec.confirmedBy = actingId();
    tick();
    return { ok: true, data: rec };
  }

  /**
   * The prototype has no engine, so nothing is ever new.
   *
   * Empty rather than invented: a badge in the prototype that no action could
   * clear would read as a bug in the real product.
   */
  async readTaskTabActivity(): Promise<{
    activity: Record<string, { lastAt: string | null; items?: { at: string; by?: string | null }[] }>;
    seen: Record<string, string | null>;
  }> {
    return { activity: {}, seen: {} };
  }

  async markTaskTabSeen(): Promise<ActionResult<null>> {
    return { ok: true, data: null };
  }

  async listTimeBudgetExtensions(
    taskId: TaskId,
  ): Promise<TimeBudgetExtensionRecord[]> {
    return delay(
      getStore().timeBudgetExtensions.filter((r) => r.taskId === String(taskId)),
    );
  }

  async requestDeadlineExtensionRecord(input: {
    taskId: TaskId;
    proposedDeadline: string;
    reason?: string;
  }): Promise<ActionResult<DeadlineExtensionRecord>> {
    const s = getStore();
    const t = s.tasks.find((x) => x.id === input.taskId);
    if (!t) return fail("not_found", "That task does not exist.");
    const rec = deadlineExtension({
      id: nextId("dex"),
      taskId: String(input.taskId),
      /* The MANAGER escalates. Never the assignee. */
      requestedBy: actingId(),
      approverId: t.createdById ?? null,
      previousDeadline: t.deadline.dueAt,
      proposedDeadline: input.proposedDeadline,
      reason: input.reason ?? null,
      createdAt: nowIso(),
    });
    s.deadlineExtensions.push(rec);
    tick();
    return { ok: true, data: rec };
  }

  async decideDeadlineExtension(
    recordId: string,
    decision: "approved" | "rejected" | "counter_proposed",
    input?: { counterDeadline?: string; reason?: string },
  ): Promise<ActionResult<DeadlineExtensionRecord | null>> {
    const s = getStore();
    const rec = s.deadlineExtensions.find((r) => r.id === recordId);
    if (!rec) return fail("not_found", "That request does not exist.");
    if (decision === "counter_proposed" && !input?.counterDeadline) {
      return fail(
        "validation_failed",
        "A counter-offer needs a date.",
        "counterDeadline",
      );
    }
    rec.status = decision;
    rec.decidedBy = actingId();
    rec.approvedAt = nowIso();
    if (input?.reason) rec.reason = input.reason;
    if (decision === "counter_proposed") {
      /* Kept BESIDE what was asked for, not over it: both figures are part of
         the account, and the conversation is not finished. */
      rec.counterDeadline = input!.counterDeadline!;
    }

    /* Only an approval moves the commitment. A counter-offer is an answer, not
       a decision — and a refusal changes nothing at all. The queue, the
       operational date and every preview recompute from the task on the next
       read; none of them is stored. */
    if (decision === "approved") {
      const t = s.tasks.find((x) => x.id === rec.taskId);
      if (t) {
        /* The date ON THE TABLE, which is the counter once one has been made.
           Applying `proposedDeadline` would set the figure that was answered
           rather than the one being accepted. */
        const settled = liveDeadline(rec);
        t.deadline.dueAt = settled;
        t.deadline.officialDueAt = settled;
        t.deadline.state = "agreed";
        t.updatedAt = nowIso();
      }
    }
    tick();
    return { ok: true, data: rec };
  }

  async listDeadlineExtensionRecords(
    taskId: TaskId,
  ): Promise<DeadlineExtensionRecord[]> {
    const s = getStore();
    /* The typed collection first, then pre-migration rows marked as such. New
       writes never touch the old store. */
    const own = s.deadlineExtensions.filter((r) => r.taskId === String(taskId));
    return delay([
      ...own,
      ...s.proposals
        .filter((p) => p.taskId === taskId && p.isExtension)
        .map((p) =>
          deadlineExtension({
            id: p.id,
            taskId: String(p.taskId),
            requestedBy: p.proposedById,
            approverId: p.decidedById,
            previousDeadline:
              s.tasks.find((t) => t.id === p.taskId)?.deadline.dueAt ?? null,
            proposedDeadline: p.proposedDueAt,
            reason: p.reason,
            status:
              p.state === "approved"
                ? "approved"
                : p.state === "rejected"
                  ? "rejected"
                  : "pending",
            createdAt: p.createdAt,
            approvedAt: p.decidedAt,
            decidedBy: p.decidedById,
            isHistorical: true,
          }),
        ),
    ]);
  }

  async listSettingsAudit(limit = 100): Promise<AuditEntry[]> {
    /* Same gate as production. A fixture that let everybody read the log would
       hide exactly the bug the gate exists to prevent. */
    const me = getStore().employees.find((e) => e.id === actingId());
    const isAdmin = (me?.roleIds ?? []).includes(ROLE_ADMIN);
    if (!isAdmin) throw new Error(AUDIT_REFUSAL);
    return delay([...getStore().settingsAudit].reverse().slice(0, limit));
  }

  async listProposals(taskId: TaskId) {
    return delay(getStore().proposals.filter((p) => p.taskId === taskId));
  }
  async listExtensions(taskId: TaskId) {
    return delay(getStore().extensions.filter((e) => e.taskId === taskId));
  }

  async getHrHolidaySync(): Promise<boolean> {
    return hrHolidaySyncMock;
  }

  async setHrHolidaySync(enabled: boolean): Promise<ActionResult<boolean>> {
    hrHolidaySyncMock = enabled;
    return delay(ok(enabled));
  }

  async listBlockedDates(
    _employeeId: EmployeeId,
    from: string,
    to: string,
  ): Promise<BlockedDate[]> {
    /* Same gate as the live repository: OFF fetches nothing HR-shaped, so the
       prototype demonstrates the disconnect the same way production does. */
    if (!hrHolidaySyncMock) return delay([]);
    const out: BlockedDate[] = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6) {
        out.push({
          date: d.toISOString().slice(0, 10),
          kind: "week_off",
          label:
            wd === 0
              ? "Sunday — non-working day"
              : "Saturday — non-working day",
        });
      }
    }
    return delay(out);
  }

  /**
   * The Cowork-owned work policy, in the demo tenant.
   *
   * Held in memory rather than in the seed, and seeded from
   * `readOfficePolicy(null)` so the demo starts on exactly the defaults legacy
   * applies to a workspace that has never saved this document. Validated
   * through the same function the legacy repository uses, so a value the engine
   * would refuse is refused here too.
   */
  #officePolicy: OfficePolicy | null = null;

  async getOfficePolicy(): Promise<OfficePolicy> {
    this.#officePolicy ??= readOfficePolicy(null);
    return delay(this.#officePolicy);
  }

  /**
   * The demo tenant's settings write path — one, matching production's one.
   *
   * **This exists so the audit is testable.** The legacy path writes Firestore,
   * which a unit test cannot exercise, so the assertion "a settings change
   * records who changed it, from what, to what" has to run against a store a
   * test can hold. Both paths call the same `applySettingsChange`, in the same
   * order — write, then log — so what is asserted here is the real rule and not
   * a re-implementation of it.
   *
   * `setOfficePolicy` previously wrote `#officePolicy` and nothing else. The
   * demo tenant therefore had settings changes with no record, which is the
   * defect the production path was fixed for.
   */
  async #writeSettings<T>(input: {
    section: string;
    type: string;
    refusal: string | null;
    before: T;
    after: T;
    reason?: string | null;
    commit: (value: T) => void;
  }): Promise<ActionResult<T>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    if (input.refusal) return fail("validation_failed", input.refusal);

    const store = getStore();
    const result = await applySettingsChange<T>({
      section: input.section,
      type: input.type,
      changedById: actingId(),
      changedAt: nowIso(),
      before: input.before,
      after: input.after,
      reason: input.reason ?? null,
      newId: () => `sa_${store.settingsAudit.length + 1}`,
      write: async (value) => {
        tick();
        input.commit(value);
        return { ok: true };
      },
      log: async (entry) => {
        store.settingsAudit.push(entry);
      },
    });

    if (!result.ok) {
      return fail(
        "conflict",
        result.error ?? "The setting could not be saved.",
      );
    }
    return delay(ok(input.after));
  }

  async setOfficePolicy(
    policy: OfficePolicy,
    reason?: string,
  ): Promise<ActionResult<OfficePolicy>> {
    return this.#writeSettings<OfficePolicy>({
      section: AUDIT_SECTION["office-policy"],
      type: OFFICE_POLICY_CHANGED,
      refusal: validateOfficePolicy(policy),
      before: await this.getOfficePolicy(),
      after: policy,
      reason,
      commit: (value) => {
        this.#officePolicy = value;
      },
    });
  }

  /* Timer SOP Point Engine. Config lives beside the office policy (as legacy
     kept it in its own `cowork_sop_settings` doc), and starts PAUSED so no
     points move until an administrator switches it on. */
  #timerSopConfig: TimerSopConfig = { ...DEFAULT_TIMER_SOP_CONFIG };

  async getTimerSopConfig(): Promise<TimerSopConfig> {
    return delay({ ...this.#timerSopConfig });
  }

  async setTimerSopConfig(
    config: TimerSopConfig,
  ): Promise<ActionResult<TimerSopConfig>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    if (config.deficitThresholdHours < 0 || config.overtimeThresholdHours < 0)
      return fail("validation_failed", "Thresholds cannot be negative.");
    if (config.deficitPoints < 0 || config.overtimePoints < 0)
      return fail("validation_failed", "Point values cannot be negative.");
    tick();
    this.#timerSopConfig = { ...config };
    return delay(ok({ ...this.#timerSopConfig }));
  }

  async getTimerSopStatus(
    employeeId?: EmployeeId,
  ): Promise<TimerSopStatus> {
    const subject = employeeId ?? actingId();
    const policy = await this.getOfficePolicy();
    const commits = getStore().workCommits.filter(
      (c) => c.employeeId === subject,
    );
    const days = bucketWorkByDay(commits, policy);
    const result = evaluateTimerSop(days, this.#timerSopConfig);
    const today = this.#timerSopConfig.enabled
      ? computeTodayTarget(
          todayWindow(commits, policy, nowIso().slice(0, 10)),
          this.#timerSopConfig,
        )
      : null;
    return delay({
      employeeId: subject,
      config: { ...this.#timerSopConfig },
      result,
      today,
    });
  }

  #taskRules: TaskRules | null = null;
  #workflowRouting: WorkflowRouting | null = null;
  #scoringSettings: ScoringSettings | null = null;
  #ruleOverrides: RuleOverrides | null = null;

  async getTaskRules(): Promise<TaskRules> {
    this.#taskRules ??= readTaskRules(null);
    return delay(this.#taskRules);
  }

  async setTaskRules(
    rules: TaskRules,
    reason?: string,
  ): Promise<ActionResult<TaskRules>> {
    return this.#writeSettings<TaskRules>({
      section: AUDIT_SECTION["task-rules"],
      type: TASK_RULES_CHANGED,
      refusal: validateTaskRules(rules),
      before: await this.getTaskRules(),
      after: rules,
      reason,
      commit: (value) => {
        this.#taskRules = value;
      },
    });
  }

  async getWorkflowRouting(): Promise<WorkflowRouting> {
    this.#workflowRouting ??= readWorkflowRouting(null);
    return delay(this.#workflowRouting);
  }

  async setWorkflowRouting(
    routing: WorkflowRouting,
    reason?: string,
  ): Promise<ActionResult<WorkflowRouting>> {
    return this.#writeSettings<WorkflowRouting>({
      section: AUDIT_SECTION["workflow-routing"],
      type: WORKFLOW_ROUTING_CHANGED,
      refusal: validateWorkflowRouting(routing),
      before: await this.getWorkflowRouting(),
      after: routing,
      reason,
      commit: (value) => {
        this.#workflowRouting = value;
      },
    });
  }

  async getScoringSettings(): Promise<ScoringSettings> {
    this.#scoringSettings ??= readScoringSettings(null);
    return delay(this.#scoringSettings);
  }

  async setScoringSettings(
    settings: ScoringSettings,
    reason?: string,
  ): Promise<ActionResult<ScoringSettings>> {
    return this.#writeSettings<ScoringSettings>({
      section: AUDIT_SECTION["priority-scoring"],
      type: SCORING_CHANGED,
      refusal: validateScoringSettings(settings),
      before: await this.getScoringSettings(),
      after: settings,
      reason,
      commit: (value) => {
        this.#scoringSettings = value;
      },
    });
  }

  async getRuleOverrides(): Promise<RuleOverrides> {
    this.#ruleOverrides ??= {};
    return delay(this.#ruleOverrides);
  }

  async setRuleOverrides(
    overrides: RuleOverrides,
    reason?: string,
  ): Promise<ActionResult<RuleOverrides>> {
    const result = await this.#writeSettings<RuleOverrides>({
      section: AUDIT_SECTION["provisional-rules"],
      type: PROVISIONAL_RULES_CHANGED,
      refusal: validateRuleOverrides(overrides),
      before: await this.getRuleOverrides(),
      after: overrides,
      reason,
      commit: (value) => {
        this.#ruleOverrides = value;
      },
    });
    /* The engine reads the module-level map, so the demo tenant has to install
       them too — otherwise the rule card would show a published value while
       every score in the demo carried on using the placeholder, which is the
       divergence `lib/config/settings.ts` exists to prevent. */
    if (result.ok) applyRuleOverrides(overrides);
    return result;
  }

  /* ── Duty presence ──────────────────────────────────────────────────────── */

  /**
   * Presence, in the demo tenant.
   *
   * Held in memory rather than in the seed, because presence is a fact about
   * right now and a fixture that shipped somebody as "online" would be a
   * fabricated claim about a person's working day — the one thing the seed's
   * own header forbids. Everybody starts offline, which is true of a store
   * nobody has signed into.
   *
   * The staleness window is applied here exactly as the legacy repository
   * applies it, so a screen behaves identically against either backend. That is
   * the point of both implementing the same four methods rather than the demo
   * having a simpler presence of its own.
   */
  #duty = new Map<string, DutyDocument>();
  #dutyWatchers = new Set<() => void>();
  /** The append-only trail behind `#duty` — see `listDutyHistory`. */
  #dutyHistory = new Map<string, DutyHistoryEntry[]>();

  async getDutyMode(employeeId?: EmployeeId): Promise<DutyMode> {
    const id = String(employeeId ?? actingId());
    return readDutyMode(this.#duty.get(id) ?? null, Date.now());
  }

  async setDutyMode(input: {
    mode: DutyMode;
    connectionId: string | null;
    reason?: string | null;
    /** A person asked for this rather than a tab deriving it — see the
        interface. */
    deliberate?: boolean;
  }): Promise<ActionResult<DutyMode>> {
    const id = String(actingId());
    const now = Date.now();
    const previous = this.#duty.get(id) ?? null;

    /* Deliberate transitions are not subject to the claim — a person pressing
       Go offline is deciding about themselves, not reading a room. See the
       interface, and the same guard in the legacy repository. */
    if (
      !input.deliberate &&
      input.mode !== "online" &&
      !ownsClaim(previous, input.connectionId, now)
    ) {
      return ok(readDutyMode(previous, now));
    }

    const { patch, emergencyToRaiseMs, breakToCreditMs, offlineToCreditMs } =
      dutyTransition({
        previous,
        next: input.mode,
        nowMs: now,
        connectionId: input.connectionId,
        reason: input.reason ?? null,
      });
    this.#duty.set(id, { ...(previous ?? {}), ...patch });
    const history = this.#dutyHistory.get(id) ?? [];
    history.push({
      id: nextId("dh"),
      mode: input.mode,
      at: now,
      reason: input.mode === "emergency" ? (input.reason ?? null) : null,
    });
    this.#dutyHistory.set(id, history);

    /* The demo CAN act on these, unlike the legacy build — `endBreak` and
       `createEmergencyRequest` are both implemented here. So the spans are
       raised rather than banked, and `bankEvenWhenRaising` stays false above,
       or the same minutes would be credited twice. */
    if (breakToCreditMs > 0) {
      await this.endBreak({
        startedAt: new Date(now - breakToCreditMs).toISOString(),
        endedAt: new Date(now).toISOString(),
      });
    }
    /* **The exit no longer raises the request; the dialog already did.**
     *
     * `StatusButton` holds the transition until `EmergencyEndDialog` has raised
     * the request WITH its reason and document, and only then applies the mode.
     * So by the time this runs the request exists — raising another here made
     * two pending records for one emergency, and approving both shifted every
     * deadline twice. `emergencyToRaiseMs` is left in the return type because it
     * is what the caller would need if a non-gated exit ever existed; nothing
     * acts on it, and nothing should without also deciding what to do about the
     * request the dialog already made. */
    void emergencyToRaiseMs;

    /* **Offline compensation — the third unavailable state.**
     *
     * Returning online from offline credits the WORKING time the absence cost,
     * so the deadline moves by lost office hours and not by the raw span: an
     * offline hour mid-morning shifts a deadline an hour, an offline evening
     * shifts nothing. This is the same move a break makes and goes through the
     * same `#extendDeadline`, so all three states produce one kind of record and
     * `waivePenalty` stays false — an absence moves the working deadline without
     * forgiving the score. */
    if (offlineToCreditMs > 0) {
      const lostWorkingSecs = workingSecsInSpan({
        startMs: now - offlineToCreditMs,
        endMs: now,
        schedule: MOCK_OFFICE_SCHEDULE,
      });
      if (lostWorkingSecs > 0) this.#creditAbsenceToDeadlines(lostWorkingSecs);
    }

    /* Leaving online stops the work clock — legacy auto-pauses on all three
       non-online modes, for the reason that the same minutes would otherwise be
       logged as worked and given back as deadline. */
    if (input.mode !== "online") {
      const active = await this.getActiveTimer();
      if (active) await this.pauseTimer(active.taskId, null, "logged_out");
    }

    for (const fn of this.#dutyWatchers) fn();
    tick();
    return ok(input.mode);
  }

  async heartbeatDuty(connectionId: string): Promise<ActionResult<void>> {
    const id = String(actingId());
    const now = Date.now();
    const previous = this.#duty.get(id) ?? null;
    if (readDutyMode(previous, now) !== "online") return ok(undefined);
    if (!ownsClaim(previous, connectionId, now)) return ok(undefined);
    this.#duty.set(id, { ...previous, ...heartbeatPatch(now, connectionId) });
    return ok(undefined);
  }

  watchDutyModes(
    employeeIds: EmployeeId[],
    onChange: (modes: Map<EmployeeId, DutyMode>) => void,
  ): () => void {
    const emit = () => {
      const now = Date.now();
      const modes = new Map<EmployeeId, DutyMode>();
      for (const id of employeeIds) {
        modes.set(id, readDutyMode(this.#duty.get(String(id)) ?? null, now));
      }
      onChange(modes);
    };
    this.#dutyWatchers.add(emit);
    /* No sweep, matching the legacy watcher: nothing expires on a clock, so a
       timed re-emission has nothing to say — see its note. */
    emit();
    return () => {
      this.#dutyWatchers.delete(emit);
    };
  }

  /** The acting employee's own presence, live — see the interface note. */
  watchDutyStatus(
    onChange: (snapshot: DutySnapshot) => void,
    employeeId?: EmployeeId,
  ): () => void {
    const id = String(employeeId ?? actingId());
    const emit = () =>
      onChange(readDutySnapshot(this.#duty.get(id) ?? null, Date.now()));
    this.#dutyWatchers.add(emit);
    emit();
    return () => {
      this.#dutyWatchers.delete(emit);
    };
  }

  async listDutyHistory(dayKey?: string): Promise<DutyHistoryEntry[]> {
    const id = String(actingId());
    const key = dayKey ?? dutyDayKey(Date.now());
    const entries = this.#dutyHistory.get(id) ?? [];
    return entries
      .filter((e) => dutyDayKey(e.at) === key)
      .sort((a, b) => b.at - a.at);
  }

  /* ── Break Mode ─────────────────────────────────────────────────────────── */

  /** Today's allowance and what is left of it, for the pill and the settings. */
  async getBreakBudget(): Promise<BreakBudget> {
    const s = getStore();
    return delay(
      breakBudget({
        maxMinutesPerDay: s.settings.maxBreakMinutesPerDay,
        usedSecs: usedTodaySecs(
          s.breakSessions,
          actingId(),
          breakDayKey(nowIso()),
        ),
      }),
    );
  }

  async listBreakSessions(employeeId?: EmployeeId): Promise<BreakSession[]> {
    const who = employeeId ?? actingId();
    return delay(
      getStore()
        .breakSessions.filter((b) => b.employeeId === who)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    );
  }

  /**
   * Close a break and credit what the allowance permits.
   *
   * No approval anywhere: a break is ordinary and self-declared, and the daily
   * budget is what bounds it instead. The budget is evaluated NOW, against
   * today — legacy was explicit that deferring it risked settling a break
   * against a different calendar day entirely.
   *
   * The credit goes through `#extendDeadline`, the same call an approved
   * emergency and a negotiated extension make, so all three produce the same
   * records. `waivePenalty` is FALSE, and that is the deliberate difference
   * from an approved emergency: a break moves the working deadline without
   * forgiving lateness, exactly as legacy did — it wrote `dueDate` and left the
   * scored deadline alone. Nobody has agreed that a break was unavoidable.
   */
  async endBreak(input: {
    startedAt: string;
    endedAt: string;
  }): Promise<ActionResult<BreakSession>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const me = actingId();

    const durationSecs = Math.max(
      0,
      Math.round(
        (Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000,
      ),
    );
    if (durationSecs <= 0)
      return fail("validation_failed", "That break had no duration.");

    const budget = breakBudget({
      maxMinutesPerDay: s.settings.maxBreakMinutesPerDay,
      usedSecs: usedTodaySecs(s.breakSessions, me, breakDayKey(input.startedAt)),
    });
    const { appliedSecs, wasCapped } = creditedBreakSecs({
      sessionSecs: durationSecs,
      remainingSecs: budget.remainingSecs,
    });

    tick();
    const session: BreakSession = {
      organisationId: actingOrganisationId(),
      id: nextId("brk"),
      employeeId: me,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationSecs,
      appliedSecs,
      wasCapped,
      shiftedTaskIds: [],
      createdAt: nowIso(),
    };

    if (appliedSecs > 0) {
      const affected = shiftableTasks({
        tasks: s.tasks,
        employeeId: me,
        isAssigned: (t) =>
          s.assignments.some((a) => a.taskId === t.id && a.employeeId === me),
      });
      for (const t of affected) {
        const previous = t.deadline.currentWindowSecs ?? 0;
        this.#extendDeadline({
          task: t,
          proposalId: null,
          previousWindowSecs: previous,
          newWindowSecs: previous + appliedSecs,
          newDueAt: shiftedDueAt(t.deadline.dueAt!, appliedSecs),
          waivePenalty: false,
        });
        session.shiftedTaskIds.push(t.id);
        this.#event(
          t.id,
          "extension_decided",
          `Deadline moved by a break (${Math.round(appliedSecs / 60)}m)`,
        );
      }
    }

    s.breakSessions.push(session);
    persistStore();
    return delay(ok(session));
  }

  /**
   * Set the daily break allowance for the organisation.
   *
   * `score.configure` is the capability every other organisation-wide setting
   * is already edited under — conduct policies use it — so this introduces no
   * new permission. Under the seeded roles that means administrators; widening
   * it to managers is a role edit, which is the existing mechanism for exactly
   * that question.
   */
  async setMaxBreakMinutesPerDay(
    minutes: number,
  ): Promise<ActionResult<OrganisationSettings>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    if (!Number.isFinite(minutes) || minutes <= 0)
      return fail(
        "validation_failed",
        "The allowance must be more than zero minutes.",
        "minutes",
      );
    if (minutes > 24 * 60)
      return fail(
        "validation_failed",
        "A daily allowance cannot exceed a day.",
        "minutes",
      );
    tick();
    const s = getStore();
    s.settings = {
      ...s.settings,
      maxBreakMinutesPerDay: Math.round(minutes),
    };
    persistStore();
    return delay(ok(s.settings));
  }

  async getOrganisationSettings(): Promise<OrganisationSettings> {
    return delay({ ...getStore().settings });
  }

  /* ── Office hours ───────────────────────────────────────────────────────── */

  /**
   * The live configuration for this organisation, migrating on first read.
   *
   * **Migration happens here rather than in a script.** An organisation created
   * before office hours existed has no version, and every deadline calculation
   * needs an answer immediately — so the first read publishes v1 from
   * `DEFAULT_OFFICE_HOURS` and records it as a real, attributed change. No
   * manual step, and no silent default that leaves the audit trail starting
   * midway through.
   */
  async getOfficeHours(): Promise<OfficeHours> {
    return delay(this.#liveOfficeVersion().config);
  }

  #liveOfficeVersion(): OfficeHoursVersion {
    const s = getStore();
    const org = actingOrganisationId();
    const mine = s.officeHoursVersions
      .filter((v) => v.organisationId === org)
      .sort((a, b) => a.version - b.version);
    const latest = mine[mine.length - 1];
    if (latest) return latest;

    const seeded: OfficeHoursVersion = {
      id: nextId("ohv"),
      organisationId: org,
      version: 1,
      config: structuredClone(DEFAULT_OFFICE_HOURS),
      previous: null,
      changedById: "system",
      changedByName: "System",
      changedAt: nowIso(),
      note: "Default working hours applied automatically.",
    };
    s.officeHoursVersions.push(seeded);
    persistStore();
    return seeded;
  }

  /** Every published version for this organisation, newest first. */
  async listOfficeHoursHistory(): Promise<OfficeHoursVersion[]> {
    const org = actingOrganisationId();
    return delay(
      getStore()
        .officeHoursVersions.filter((v) => v.organisationId === org)
        .sort((a, b) => b.version - a.version),
    );
  }

  /**
   * Publish a new configuration.
   *
   * Appends; never overwrites. The previous configuration is stored on the new
   * version so a reader can explain a past calculation without reconstructing
   * the chain.
   */
  async setOfficeHours(
    config: OfficeHours,
    note?: string,
  ): Promise<ActionResult<OfficeHoursVersion>> {
    const g = guard();
    if (g) return g;
    /* Same capability every other organisation-wide setting uses. */
    const denied = this.#deny("score.configure");
    if (denied) return denied;

    const refusal = officeHoursRefusal(config);
    if (refusal) return fail("validation_failed", refusal);

    tick();
    const s = getStore();
    const current = this.#liveOfficeVersion();
    const me = s.employees.find((e) => e.id === actingId());
    const next: OfficeHoursVersion = {
      id: nextId("ohv"),
      organisationId: actingOrganisationId(),
      version: current.version + 1,
      config: structuredClone(config),
      previous: structuredClone(current.config),
      changedById: actingId(),
      changedByName: me?.displayName ?? actingId(),
      changedAt: nowIso(),
      note: note?.trim() || null,
    };
    s.officeHoursVersions.push(next);
    persistStore();
    return delay(ok(next));
  }

  /* ── Emergency Mode ─────────────────────────────────────────────────────── */

  /**
   * Raise the request that ending Emergency Mode produces.
   *
   * NOTHING is applied here. Legacy shifted deadlines from the browser the
   * moment a manager clicked approve; the shift now happens in
   * `decideEmergencyRequest` and only there, so a request that is never decided
   * leaves every deadline exactly where it was.
   *
   * The manager is resolved from the reporting tree ONCE, here, and frozen onto
   * the record — a reorganisation between raising and deciding must not move a
   * pending decision to somebody who was not there for it.
   */
  async createEmergencyRequest(input: {
    startedAt: string;
    endedAt: string;
    reason: string;
    document: { filename: string; mimeType: string; sizeBytes: number } | null;
  }): Promise<ActionResult<EmergencyRequest>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const me = s.employees.find((e) => e.id === actingId());
    if (!me) return fail("not_found", "Employee not found.");

    const durationSecs = Math.max(
      0,
      Math.round(
        (Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000,
      ),
    );
    const manager =
      s.reporting.find(
        (r) => r.employeeId === me.id && !r.effectiveTo && r.type === "primary",
      ) ?? null;
    const managerEmployee = manager
      ? (s.employees.find((e) => e.id === manager.managerId) ?? null)
      : null;

    /* One predicate, shared with the dialog, so the form can never submit
       something this refuses. */
    const refusal = emergencyRequestRefusal({
      durationSecs,
      reason: input.reason,
      document: input.document,
      managerId: managerEmployee?.id ?? null,
    });
    if (refusal) return fail("validation_failed", refusal);

    tick();
    const doc = input.document!;
    /* Recorded, not stored. `Attachment.storageKey` is a synthetic handle in
       this prototype — the same as every other attachment — so what is kept is
       the fact that a document of this name and type was supplied. */
    const attachment: Attachment = {
      organisationId: actingOrganisationId(),
      id: nextId("att"),
      ownerId: me.id,
      scope: { type: "report", id: me.id },
      filename: doc.filename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      storageKey: `emergency/${me.id}/${doc.filename}`,
      uploadedAt: nowIso(),
      deletedAt: null,
    };
    s.attachments.push(attachment);

    const req: EmergencyRequest = {
      organisationId: actingOrganisationId(),
      id: nextId("em"),
      employeeId: me.id,
      employeeName: me.displayName,
      managerId: managerEmployee!.id,
      managerName: managerEmployee!.displayName,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationSecs,
      reason: input.reason.trim(),
      attachmentId: attachment.id,
      status: "pending",
      decisionReason: null,
      decidedAt: null,
      appliedTaskIds: [],
      /* Nothing applied — which is what pending means, and what the gate holds. */
      compensationAppliedAt: null,
      createdAt: nowIso(),
    };
    s.emergencyRequests.push(req);

    this.#notify(
      req.managerId,
      "emergency_requested",
      "Emergency Mode needs your decision",
      `${me.displayName} was in Emergency Mode for ${Math.round(durationSecs / 60)} minutes and has asked for that time.`,
      "emergency",
      req.id,
    );
    return delay(ok(req));
  }

  async listEmergencyRequests(scope: "mine" | "to_decide") {
    const s = getStore();
    const mine = actingId();
    return delay(
      s.emergencyRequests
        .filter((r) =>
          scope === "mine" ? r.employeeId === mine : r.managerId === mine,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  /**
   * Approve or decline, and apply the time only on approval.
   *
   * Approving runs every one of that person's live tasks through
   * `#extendDeadline` — the same call `decideExtension` makes — so an emergency
   * produces exactly the records a negotiated extension does and cannot drift
   * from them. The penalty is waived: an emergency the manager has just agreed
   * to is not lateness the employee owes, so the SCORED deadline moves with the
   * working one.
   */
  async decideEmergencyRequest(
    requestId: string,
    approve: boolean,
    decisionReason = "",
  ): Promise<ActionResult<EmergencyRequest>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const req = s.emergencyRequests.find((r) => r.id === requestId);
    if (!req) return fail("not_found", "Request not found.");

    const refusal = emergencyDecisionRefusal({
      request: req,
      actorId: actingId(),
      approve,
      decisionReason,
    });
    if (refusal)
      return fail(
        refusal.startsWith("A reason") ? "validation_failed" : "permission_denied",
        refusal,
      );

    /* Computed BEFORE the status is written, from the record the refusal above
       was taken against — zero for a rejection, zero for an already-applied
       request, zero for anybody who is not the named manager. Same rule the
       production repository runs. */
    const lostSecs = Math.round(
      emergencyCompensationMs({ request: req, actorId: actingId(), approve }) / 1000,
    );

    tick();
    req.status = approve ? "approved" : "declined";
    req.decisionReason = decisionReason.trim() || null;
    req.decidedAt = nowIso();
    /* The consumed marker, stamped with the payout rather than with the
       decision: an approval worth nothing has nothing to consume. */
    if (lostSecs > 0) req.compensationAppliedAt = nowIso();

    /* Whatever was decided, the banked claim is spent — a rejected emergency
       must not leave one lying on the duty document. */
    const duty = this.#duty.get(String(req.employeeId));
    if (duty)
      this.#duty.set(String(req.employeeId), {
        ...duty,
        /* `DutyDocument` types only the fields the rules read; the pending gap
           is legacy's own key, carried on the same document. Cast rather than
           widened, so the domain type keeps describing what this product uses
           rather than everything the old app happens to write. */
        ...({ pendingEmergencyGapMs: null, pendingEmergencyReason: null } as Record<
          string,
          unknown
        >),
      });

    if (lostSecs > 0) {
      const affected = shiftableTasks({
        tasks: s.tasks,
        employeeId: req.employeeId,
        /* The same relationship legacy's `assigneeIds array-contains` tested,
           expressed against Cowork's assignment records. */
        isAssigned: (t) =>
          s.assignments.some(
            (a) => a.taskId === t.id && a.employeeId === req.employeeId,
          ),
      });
      for (const t of affected) {
        const previous = t.deadline.currentWindowSecs ?? 0;
        this.#extendDeadline({
          task: t,
          proposalId: null,
          previousWindowSecs: previous,
          newWindowSecs: previous + lostSecs,
          newDueAt: shiftedDueAt(t.deadline.dueAt!, lostSecs),
          waivePenalty: true,
        });
        req.appliedTaskIds.push(t.id);
        this.#event(
          t.id,
          "extension_decided",
          `Deadline moved by an approved emergency (${Math.round(lostSecs / 60)}m)`,
        );
      }
    }

    this.#notify(
      req.employeeId,
      approve ? "emergency_approved" : "emergency_declined",
      approve ? "Emergency Mode approved" : "Emergency Mode declined",
      approve
        ? `${req.managerName} approved it. ${req.appliedTaskIds.length} of your deadlines moved.`
        : `${req.managerName} declined it. Your deadlines are unchanged.`,
      "emergency",
      req.id,
    );
    return delay(ok(req));
  }

  /* ── Timers and work ────────────────────────────────────────────────────── */

  /**
   * The fixture has no change stream, so this delivers the current session once
   * and then stays quiet.
   *
   * Honest for a fixture: the contract is "you will be told the session, and
   * told again when it changes", and here it never changes. Returning a no-op
   * unsubscribe keeps the caller's cleanup identical to the live path.
   */
  watchTimerSession(
    employeeId: EmployeeId,
    taskId: TaskId,
    onChange: (session: TimerSession | null) => void,
  ): () => void {
    let stopped = false;
    void this.getTimer(taskId).then((s) => {
      if (!stopped) onChange(s);
    });
    return () => {
      stopped = true;
    };
  }

  /* ── Attachments ─────────────────────────────────────────────────────────
   *
   * In-memory, so the uploader can be exercised without a backend. Files are
   * held as real `Blob`s, which is what makes the preview and download paths
   * genuinely testable rather than stubbed.
   */
  #attachments = new Map<
    string,
    { meta: AttachmentMeta; blob: Blob; entityType: string; entityId: string }
  >();
  #attachmentSeq = 0;

  async uploadAttachment(input: {
    file: File;
    entityType: AttachmentEntity;
    entityId: string;
    onProgress?: (fraction: number) => void;
  }): Promise<ActionResult<AttachmentMeta>> {
    /* The fixture mirrors the engine's refusals rather than accepting anything,
       so a component's error path is reachable without a server.
       The SIZE refusal is gone, because the engine's is: a mock that refused a
       file the product accepts would send somebody hunting for a limit that no
       longer exists. An empty file is still refused — the engine answers "No
       file was received." to that one. */
    if (input.file.size === 0) {
      return {
        ok: false,
        code: "validation_failed",
        message: "No file was received.",
      };
    }
    input.onProgress?.(1);
    const id = `att-${++this.#attachmentSeq}`;
    const meta: AttachmentMeta = {
      id,
      name: input.file.name,
      type: input.file.type,
      size: input.file.size,
      uploadedAt: new Date(0).toISOString(),
    };
    this.#attachments.set(id, {
      meta,
      blob: input.file,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    return { ok: true, data: meta };
  }

  async getAttachments(
    entityType: AttachmentEntity,
    entityId: string,
  ): Promise<ActionResult<AttachmentMeta[]>> {
    return {
      ok: true,
      data: [...this.#attachments.values()]
        .filter((a) => a.entityType === entityType && a.entityId === entityId)
        .map((a) => a.meta),
    };
  }

  async downloadAttachment(id: string): Promise<ActionResult<Blob>> {
    const found = this.#attachments.get(id);
    if (!found) {
      return { ok: false, code: "not_found", message: "That file could not be opened." };
    }
    return { ok: true, data: found.blob };
  }

  async deleteAttachment(id: string): Promise<ActionResult<void>> {
    this.#attachments.delete(id);
    return { ok: true, data: undefined };
  }

  async decideDeadline(
    taskId: TaskId,
    approved: boolean,
  ): Promise<ActionResult<Task>> {
    /* The fixture keeps no proposal record, so this reports the outcome without
       moving anything — enough for a component's success path, and honest about
       having no negotiation to settle. */
    const task = getStore().tasks.find((t) => t.id === String(taskId));
    if (!task) {
      return { ok: false, code: "not_found", message: "That task is not here." };
    }
    void approved;
    return { ok: true, data: task };
  }

  async counterBudget(): Promise<ActionResult<void>> {
    /* The fixture runs no negotiation; reporting success keeps a component's
       happy path reachable without pretending a loop is being kept. */
    return { ok: true, data: undefined };
  }

  async acceptBudget(): Promise<ActionResult<void>> {
    return { ok: true, data: undefined };
  }

  async previewDeadlineFeasibility(input: {
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
  }): Promise<Feasibility> {
    /* The fixture runs the REAL rule over the fixture's own tasks, so the
       component's rendering is exercised against genuine output rather than a
       hand-written object that could drift from the shape. */
    const tasks = getStore()
      .tasks.filter((t) => !t.deletedAt)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        assigneeIds: [String(input.employeeId)],
        senderTimerWindowSecs: t.estimatedEffortSecs ?? 0,
        committedDueAt: t.deadline.dueAt,
        /* A task cannot be due before it existed — see `QueueTask.createdAtMs`. */
        createdAtMs: t.createdAt ? Date.parse(t.createdAt) : undefined,
      }));
    return calculateDeadlineFeasibility({
      taskId: input.taskId ? String(input.taskId) : undefined,
      employeeId: String(input.employeeId),
      proposedPriority: input.proposedPriority,
      estimatedWorkSeconds: input.estimatedWorkSeconds,
      /* The fixture keeps timers in its own store, so the deduction is read
         from there rather than from a Firestore subcollection. */
      alreadyWorkedSeconds:
        input.alreadyWorkedSeconds ??
        getStore().timers.find(
          (t) =>
            t.taskId === input.taskId &&
            t.employeeId === String(input.employeeId),
        )?.accumulatedSecs ??
        0,
      committedDeadline: input.committedDeadline ?? null,
      orderOverride: input.orderOverride ?? null,
      tasks: tasks as never,
      nowMs: Date.parse("2026-07-30T09:00:00.000Z"),
      /* No calendar in the fixture: straight wall-clock, which keeps the
         fixture's dates predictable and is clearly not production's rule. */
      addWorkingSecs: (anchorMs, secs) =>
        new Date(anchorMs + secs * 1000).toISOString(),
    });
  }

  async getTimer(taskId: TaskId) {
    return delay(
      getStore().timers.find(
        (t) => t.taskId === taskId && t.employeeId === actingId(),
      ) ?? null,
    );
  }

  async getActiveTimer() {
    const s = getStore();
    const t = s.timers.find((x) => x.employeeId === actingId() && x.isActive);
    if (!t) return delay(null);
    return delay({
      ...t,
      taskTitle: s.tasks.find((x) => x.id === t.taskId)?.title ?? "—",
      // Committed work on this task, so the shell's figure matches the row's.
      loggedSecs: s.workCommits
        .filter((w) => w.taskId === t.taskId && w.employeeId === actingId())
        .reduce((sum, w) => sum + w.durationSecs, 0),
    });
  }

  async listTimers() {
    return delay(getStore().timers.filter((t) => t.employeeId === actingId()));
  }

  async startTimer(taskId: TaskId): Promise<ActionResult<TimerSession>> {
    const g = guard();
    if (g) return g;

    /* The offline restriction, at the write and not at the button — the same
       check the legacy repository makes, from the same function. A rule that
       held on one backend and not the other would be found by whoever tested
       against the wrong one. Pausing stays ungated: stopping a clock is always
       allowed, or a session started before somebody stepped away could never
       be stopped. */
    const refusal = presenceWriteRefusal(await this.getDutyMode());
    if (refusal) return refusal;

    const s = getStore();
    tick();
    // One active timer per person — pause any other before starting.
    for (const t of s.timers) {
      if (t.employeeId === actingId() && t.isActive && t.taskId !== taskId) {
        await this.pauseTimer(t.taskId, null, "task_switch");
      }
    }
    let session = s.timers.find(
      (t) => t.taskId === taskId && t.employeeId === actingId(),
    );
    if (!session) {
      session = {
        organisationId: actingOrganisationId(),
        taskId,
        employeeId: actingId(),
        isActive: true,
        accumulatedSecs: 0,
        startedAt: nowIso(),
        startedAtRealMs: Date.now(),
        /* The mock has no heartbeat loop — nothing throttles or sleeps here —
           so there is no last beat to cap against. Null means "no cap", which
           is the honest reading for a session nothing can starve. */
        heartbeatAtRealMs: null,
      };
      s.timers.push(session);
    } else {
      session.isActive = true;
      session.startedAt = nowIso();
      /* Reset on every resume. Duration is measured per RUN and added to
         `accumulatedSecs`; carrying the original start forward would re-count
         the paused interval on the next pause. */
      session.startedAtRealMs = Date.now();
    }
    persistStore();
    return delay(ok(session));
  }

  async pauseTimer(
    taskId: TaskId,
    message: string | null,
    reason: WorkCommit["pauseReason"],
  ): Promise<ActionResult<WorkCommit>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const session = s.timers.find(
      (t) => t.taskId === taskId && t.employeeId === actingId(),
    );
    if (!session || !session.isActive)
      return fail("invalid_state", "No timer is running on this task.");

    /* How long this run ACTUALLY lasted, on the real clock.
     *
     * This used to be `tick(60_000)` followed by a measurement against the
     * prototype clock, floored at 60 seconds — so the clock was advanced a
     * minute and then asked how much time had passed, and every pause committed
     * at least a minute however briefly the person had worked. Ten seconds of
     * work became 1:00 on the first pause and grew by another minute on each
     * cycle after it.
     *
     * The fallback covers a session recorded before this field existed: there
     * is no real start to measure against, so it falls back to the prototype
     * clock exactly as before, minus the inflation. */
    const started = session.startedAt ? new Date(session.startedAt) : now();
    const durationSecs = runDurationSecs({
      startedAtRealMs: session.startedAtRealMs,
      nowRealMs: Date.now(),
      fallbackSimElapsedMs: now().getTime() - started.getTime(),
    });

    /* Capture real-clock timestamps BEFORE clearing the session so we can use
       them for the commit. Commit timestamps must be real wall-clock time, not
       the prototype clock: `listDayCommits` is called with the real IST day key
       (`istDayKey(Date.now())`), and prototype-clock dates (anchored to the seed
       date, not today) would never match — silently dropping every commit from
       the daily-report modal, the Reports tab, and the Actionable inbox. */
    const realEndMs = Date.now();
    const realStartMs = session.startedAtRealMs != null
      ? session.startedAtRealMs
      : realEndMs - durationSecs * 1000;

    tick(durationSecs * 1000);
    session.isActive = false;
    session.accumulatedSecs += durationSecs;
    session.startedAt = null;
    session.startedAtRealMs = null;

    const commit: WorkCommit = {
      organisationId: actingOrganisationId(),
      id: nextId("wc"),
      taskId,
      employeeId: actingId(),
      startedAt: new Date(realStartMs).toISOString(),
      endedAt: new Date(realEndMs).toISOString(),
      durationSecs,
      message,
      attachmentIds: [],
      pauseReason: reason,
    };
    s.workCommits.push(commit);
    this.#event(taskId, "work_committed", message ?? "Work committed");
    return delay(ok(commit));
  }

  /* The interface's liveness beat. The prototype keeps a simpler timer model — a
     single run measured on pause — and carries none of the per-beat record the
     legacy adapter uses to cap an abandoned session, so there is nothing to move
     forward here. Accepted as a no-op so the timer control can beat against
     either backend without knowing which it is on. */
  async heartbeatTimer(_taskId: TaskId): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    return delay(ok(undefined));
  }

  async listWorkCommits(taskId: TaskId) {
    return delay(getStore().workCommits.filter((w) => w.taskId === taskId));
  }

  async listDayCommits(date: string) {
    const s = getStore();
    return delay(
      s.workCommits
        /* Scoped to the acting employee, matching the legacy repository's own
           `where("employeeId", "==", employeeId)` — this was unscoped, which
           handed the daily-report flow (end-of-day modal, Reports tab,
           Actionable inbox) every employee's commits as if they were the
           viewer's own.
           Filtered by `endedAt` (not `startedAt`): a session that started just
           before midnight continues into the next IST day, and the day it is
           reported against should be the day it ended. Mirrors legacy's own
           `endedAt` filter. IST-aware so midnight UTC does not split a shift
           that ran through to 5:30 AM IST. */
        .filter(
          (w) => istDayKey(Date.parse(w.endedAt)) === date && w.employeeId === actingId(),
        )
        .map((w) => ({
          ...w,
          employee: s.employees.find((e) => e.id === w.employeeId)!,
          taskTitle: s.tasks.find((t) => t.id === w.taskId)?.title ?? "—",
        })),
    );
  }

  /**
   * Weekly arrivals against departures — the dashboard's principal graph.
   *
   * Every figure is COUNTED from a timestamp that already exists on the record.
   * Nothing is smoothed, back-filled or invented: a week with no movement
   * returns zeros for every channel and draws flat on the baseline, which is
   * the honest answer and the one the graph's geometry is built to show.
   */
  async getWorkloadFlow(q: { scope: TaskScope; weeks: number }) {
    const s = getStore();
    const viewer = await this.getViewer();

    const ids =
      q.scope === "team"
        ? new Set(viewer.hierarchyIds)
        : new Set([viewer.employeeId]);
    const mine = (empId: string) => ids.has(empId);
    const assignedToScope = (taskId: string) =>
      s.assignments.some((a) => a.taskId === taskId && mine(a.employeeId));

    // Week buckets, Monday-opening, ending with the week containing "now".
    const end = now();
    const day = end.getUTCDay();
    const monday = new Date(end);
    monday.setUTCDate(end.getUTCDate() - ((day + 6) % 7));
    monday.setUTCHours(0, 0, 0, 0);

    const buckets: FlowPoint[] = [];
    for (let i = q.weeks - 1; i >= 0; i--) {
      const start = new Date(monday.getTime() - i * 7 * 86_400_000);
      buckets.push({
        weekStart: start.toISOString().slice(0, 10),
        label: `${start.getUTCDate()} ${MONTHS_SHORT[start.getUTCMonth()]}`,
        values: {
          created: 0,
          assigned: 0,
          rework: 0,
          completed: 0,
          approved: 0,
          cancelled: 0,
        },
        net: 0,
      });
    }

    const bucketFor = (iso: string | null | undefined): FlowPoint | null => {
      if (!iso) return null;
      const t = Date.parse(iso);
      if (Number.isNaN(t)) return null;
      for (let i = buckets.length - 1; i >= 0; i--) {
        const bStart = Date.parse(buckets[i].weekStart + "T00:00:00.000Z");
        if (t >= bStart && t < bStart + 7 * 86_400_000) return buckets[i];
      }
      return null;
    };
    const add = (iso: string | null | undefined, ch: FlowChannelId) => {
      const b = bucketFor(iso);
      if (b) b.values[ch] += 1;
    };

    for (const t of s.tasks) {
      if (t.deletedAt) continue;
      const inScope = assignedToScope(t.id) || mine(t.createdById);
      if (!inScope) continue;

      if (mine(t.createdById)) add(t.createdAt, "created");
      // `Task` carries no completedAt; the close writes `updatedAt`.
      if (t.status === "completed") add(t.updatedAt, "completed");
      if (t.status === "cancelled") add(t.updatedAt, "cancelled");
    }

    for (const a of s.assignments) {
      if (mine(a.employeeId)) add(a.assignedAt, "assigned");
    }

    for (const r of s.reworkRequests) {
      if (assignedToScope(r.taskId)) add(r.requestedAt, "rework");
    }

    for (const rv of s.reviews) {
      if (rv.decision !== "approved") continue;
      if (assignedToScope(rv.taskId)) add(rv.reviewedAt, "approved");
    }

    const IN: FlowChannelId[] = ["created", "assigned", "rework"];
    let peak = 0;
    let netTotal = 0;
    for (const b of buckets) {
      let inSum = 0;
      let outSum = 0;
      for (const [k, v] of Object.entries(b.values) as [
        FlowChannelId,
        number,
      ][]) {
        peak = Math.max(peak, v);
        if (IN.includes(k)) inSum += v;
        else outSum += v;
      }
      b.net = inSum - outSum;
      netTotal += b.net;
    }

    return delay({ channels: FLOW_CHANNELS, points: buckets, peak, netTotal });
  }

  async submitDailyReport(input: {
    taskId: TaskId;
    message: string;
    progressPercent: number;
    attachmentIds: string[];
    attachments?: ReportAttachment[];
    documentId?: string | null;
    documentTitle?: string | null;
  }): Promise<ActionResult<DailyReport>> {
    const g = guard();
    if (g) return g;
    /* A document is a report too — the text box is the short form, not the
       only form. Matches the legacy repository's rule exactly. */
    if (!input.message.trim() && !input.documentId)
      return fail(
        "validation_failed",
        "Write what you did, or attach a document.",
        "message",
      );
    tick();
    const attachments =
      input.attachments ??
      input.attachmentIds.map((url) => ({ url, name: url, mimeType: "" }));
    const r: DailyReport = {
      id: nextId("dr"),
      taskId: input.taskId,
      employeeId: actingId(),
      reportDate: nowIso().slice(0, 10),
      message: input.message.trim(),
      progressPercent: input.progressPercent,
      attachmentIds: attachments.map((a) => a.url),
      attachments,
      documentId: input.documentId ?? null,
      documentTitle: input.documentTitle ?? null,
      createdAt: nowIso(),
    };
    getStore().dailyReports.push(r);
    this.#event(input.taskId, "report_submitted", "Daily report submitted");
    return delay(ok(r));
  }

  async listDailyReports(taskId: TaskId) {
    return delay(getStore().dailyReports.filter((r) => r.taskId === taskId));
  }

  /* ── Submission and review ──────────────────────────────────────────────── */

  async submitCompletion(
    input: SubmitCompletionInput,
  ): Promise<ActionResult<TaskSubmission>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const t = s.tasks.find((x) => x.id === input.taskId);
    if (!t) return fail("not_found", "Task not found.");

    if (
      provisionalString("submissionRequiresStart") === "require" &&
      t.status !== "in_progress"
    ) {
      return fail("invalid_state", "Start the task before submitting it.");
    }
    if (
      provisionalString("submissionMessageRequired") === "require" &&
      !input.message.trim()
    ) {
      return fail(
        "validation_failed",
        "Describe what you completed.",
        "message",
      );
    }

    /* The project gate — ONLY when the rules say `block`. By default
       (`requirementsBeforeSubmit: "off"`) acceptance criteria are the reviewer's
       reference for rework, not a checklist that gates submission, so this does
       not fire. When an org opts into `block`, a task cannot be submitted until
       every requirement is satisfied (directly, or by the subtasks that claimed
       it), and the message names what is outstanding. */
    const rules = await this.getTaskRules();
    const children = s.tasks.filter(
      (x) => x.parentTaskId === t.id && !x.deletedAt,
    );
    const state = completionState(t, children);
    if (rules.requirementsBeforeSubmit === "block" && !state.canComplete) {
      const named = state.outstanding.slice(0, 3).join(", ");
      const more = state.outstanding.length - 3;
      return fail(
        "invalid_state",
        `${state.satisfiedCount} of ${state.total} completion requirements are satisfied. Outstanding: ${named}${more > 0 ? ` and ${more} more` : ""}.`,
      );
    }

    tick();
    const prior = s.submissions.filter((x) => x.taskId === t.id);
    prior.forEach((p) => {
      if (!p.supersededById) p.supersededById = "pending";
    });

    const reviewChain = this.#reviewChainFor(t);
    const sub: TaskSubmission = {
      id: nextId("sb"),
      taskId: t.id,
      attempt: prior.length + 1,
      submittedById: actingId(),
      submittedAt: nowIso(),
      message: input.message.trim(),
      attachmentIds: input.attachmentIds,
      /* The mock takes attachment IDENTIFIERS, not the engine's `{url, name}`
         records, so there is no name or download address to invent here. The
         list stays derivable from what was actually supplied. */
      attachments: input.attachmentIds.map((url) => ({
        url,
        name: url,
        type: "file",
        downloadUrl: url,
      })),
      reviewChain,
      currentStage: 1,
      supersededById: null,
      wasLate: Boolean(
        t.deadline.officialDueAt && now() > new Date(t.deadline.officialDueAt),
      ),
    };
    prior.forEach((p) => {
      if (p.supersededById === "pending") p.supersededById = sub.id;
    });
    s.submissions.push(sub);

    t.status = "in_review";
    t.updatedAt = nowIso();

    // The timer stops server-side. Legacy left it running.
    const timer = s.timers.find(
      (x) => x.taskId === t.id && x.employeeId === actingId() && x.isActive,
    );
    if (timer)
      await this.pauseTimer(t.id, "Submitted for review", "submission");

    this.#event(
      t.id,
      "submitted",
      `Submitted for review (attempt ${sub.attempt})`,
    );
    if (reviewChain[0])
      this.#notify(
        reviewChain[0],
        "review_requested",
        "Work submitted",
        `“${t.title}” is ready for your review.`,
        "task",
        t.id,
      );
    return delay(ok(sub));
  }

  /* ── Permission and workflow context ────────────────────────────────────── */

  /** Everything `can()` needs, assembled from the store. */
  #ctx(): PermissionContext {
    const s = getStore();
    const me = s.employees.find((e) => e.id === actingId())!;
    const roles = s.roles.filter((r) => me.roleIds.includes(r.id));
    return {
      viewer: {
        employeeId: me.id,
        roles,
        hierarchyIds: this.#closure(me.id),
        directReportIds: s.reporting
          .filter((r) => r.managerId === me.id && !r.effectiveTo)
          .map((r) => r.employeeId),
        hasManager: hasManager(s.reporting, me.id),
        administrativeLevel: this.#levelOf(me.id),
      },
      roles: s.roles,
      directReportIds: s.reporting
        .filter((r) => r.managerId === me.id && !r.effectiveTo)
        .map((r) => r.employeeId),
      hierarchyIds: this.#closure(me.id),
      levelOf: (id) => this.#levelOf(id),
    };
  }

  /** Whose work a task is — the score-bearing assignee, else its creator. */
  #subjectOf(taskId: TaskId): EmployeeId {
    const s = getStore();
    const a = s.assignments.find(
      (x) => x.taskId === taskId && x.isScoreSubject,
    );
    if (a) return a.employeeId;
    return s.tasks.find((t) => t.id === taskId)?.createdById ?? actingId();
  }

  /** Highest administrative level across a person's roles. Zero if roleless. */
  #levelOf(id: EmployeeId): number {
    const s = getStore();
    const emp = s.employees.find((e) => e.id === id);
    if (!emp) return 0;
    const levels = s.roles
      .filter((r) => emp.roleIds.includes(r.id))
      .map((r) => r.administrativeLevel);
    return levels.length ? Math.max(...levels) : 0;
  }

  /**
   * The permission gate every mutation runs through.
   *
   * Returns a typed `permission_denied` carrying the REASON — "your role does
   * not include this", "this person is outside your reports", "you cannot act
   * on someone at or above your level" — rather than one generic refusal. A
   * denial that cannot be explained is indistinguishable from a bug, and the
   * three cases need different things from the reader.
   */
  #deny(capability: Capability, targetId?: EmployeeId) {
    const d = can(this.#ctx(), capability, targetId);
    return d.allowed ? null : fail("permission_denied", d.message);
  }

  #resolveCtx(): ResolveContext {
    const s = getStore();
    return {
      employees: s.employees,
      reporting: s.reporting,
      departments: s.departments,
      roles: s.roles,
    };
  }

  /**
   * The approval chain for a task's completion.
   *
   * This used to be a literal `for (i < 3)` climb of the reporting line that
   * ended silently whenever a link was missing — so work could reach "approved"
   * having passed fewer gates than the process required, with nothing recording
   * it. It is now whichever workflow matches the case, resolved stage by named
   * stage. A stage that cannot find its approver either skips or blocks, and
   * which one is configuration rather than an accident of the data.
   */
  #reviewChainFor(t: Task): EmployeeId[] {
    return this.#reviewPlanFor(t).chain;
  }

  #reviewPlanFor(t: Task) {
    const s = getStore();
    const assignee = s.assignments.find(
      (a) => a.taskId === t.id && a.isScoreSubject,
    );
    const subject = assignee?.employeeId ?? actingId();
    const subjectDept =
      s.employees.find((e) => e.id === subject)?.departmentId ?? null;
    const creatorDept =
      s.employees.find((e) => e.id === t.createdById)?.departmentId ?? null;
    const cross = !!subjectDept && !!creatorDept && subjectDept !== creatorDept;

    const wf = workflowFor(s.workflows, "task_completion", {
      departmentId: subjectDept,
      crossDepartment: cross,
    });
    return approverChain(this.#resolveCtx(), wf, subject, creatorDept);
  }

  async getApprovalPlan(taskId: TaskId) {
    const t = getStore().tasks.find((x) => x.id === taskId);
    if (!t) return delay(null);
    const plan = this.#reviewPlanFor(t);
    return delay({ stages: plan.stages, blockedBy: plan.blockedBy });
  }

  async listSubmissions(taskId: TaskId) {
    return delay(
      getStore()
        .submissions.filter((s) => s.taskId === taskId)
        .sort((a, b) => b.attempt - a.attempt),
    );
  }

  async reviewSubmission(
    input: ReviewInput,
  ): Promise<ActionResult<TaskReview>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const sub = s.submissions.find((x) => x.id === input.submissionId);
    if (!sub) return fail("not_found", "Submission not found.");
    const t = s.tasks.find((x) => x.id === sub.taskId)!;

    // The permission check legacy did not have: any employee could approve any
    // task, including their own (docs/specs/PERMISSIONS_AND_ROLES_SPEC.md P1).
    if (sub.submittedById === actingId())
      return fail(
        "permission_denied",
        "You cannot review your own submission.",
      );
    /* Two checks, and both are needed. The chain says whether this person is
       one of the resolved approvers for THIS submission; the capability says
       whether their role permits deciding at all. Legacy had neither — any
       authenticated employee could approve any task, including their own
       (docs/specs/PERMISSIONS_AND_ROLES_SPEC.md P1). */
    const reviewDenied = this.#deny("review.decide", sub.submittedById);
    if (reviewDenied) return reviewDenied;
    if (!sub.reviewChain.includes(actingId()))
      return fail(
        "permission_denied",
        "This submission is not in your review chain.",
      );
    if (t.status !== "in_review")
      return fail("invalid_state", "This task is not awaiting review.");
    if (!input.reason.trim())
      return fail("validation_failed", "A note is required.", "reason");

    tick();
    const stage = sub.currentStage;
    const isFinal = stage >= sub.reviewChain.length;
    const review: TaskReview = {
      id: nextId("rv"),
      submissionId: sub.id,
      taskId: t.id,
      stage,
      isFinalStage: isFinal,
      reviewerId: actingId(),
      decision: input.decision,
      reason: input.reason.trim(),
      reviewedAt: nowIso(),
    };
    s.reviews.push(review);

    if (input.decision === "approved") {
      if (isFinal) {
        t.status = "completed";
        /* Out of the queue. The stored rank is left exactly as it was — a closed
           task is a record and renders as "was P3". */
        this.#renumber(this.#holdersOfTask(t.id));
        t.updatedAt = nowIso();
        this.#event(t.id, "approved", "Approved — task complete");
        this.#notify(
          sub.submittedById,
          "task_approved",
          "Approved",
          `“${t.title}” was approved.`,
          "task",
          t.id,
        );
        /* A completing subtask moves its parent's progress, and the person
           accountable for the parent is the one who needs to know — nobody else
           is watching whether Meetings landed. The count is recomputed rather
           than incremented, so it stays right if a requirement was also ticked
           directly in the meantime. */
        this.#announceToParent(t);
      } else {
        sub.currentStage += 1;
        this.#event(t.id, "reviewed", `Stage ${stage} approved — escalated`);
        this.#notify(
          sub.reviewChain[stage],
          "review_requested",
          "Second-stage review",
          `“${t.title}” needs your review.`,
          "task",
          t.id,
        );
      }
    } else if (input.decision === "rework") {
      const occurrence =
        s.reworkRequests.filter((r) => r.taskId === t.id).length + 1;
      /**
       * **A fresh working hour, and only if the submission beat its deadline.**
       * OWNER DECISION, 16 Aug 2026 — see `reworkDeadline`.
       *
       * `#regrantDeadline` handed back the leftover, which gave whoever
       * finished earliest the smallest window to redo the work. It is left in
       * place for the REJECTION branch below, which the owner's rule does not
       * cover and which is not being changed alongside it.
       *
       * The calendar walk is wall-clock here for the same reason
       * `previewDeadlineFeasibility` uses wall-clock: no calendar in the
       * fixture, and predictable dates are the point of a prototype. The
       * DECISION — on-time gate, fresh window rather than leftover — is the
       * shared rule, so the two repositories cannot disagree about who earns a
       * reset.
       */
      const regrant = reworkDeadline({
        submittedAtMs: Date.parse(sub.submittedAt),
        currentDueAtMs: t.deadline.dueAt ? Date.parse(t.deadline.dueAt) : null,
        reworkAtMs: now().getTime(),
        addWorkingSecs: (fromMs, secs) =>
          new Date(fromMs + secs * 1000).toISOString(),
      });
      const rw: ReworkRequest = {
        id: nextId("rw"),
        reviewId: review.id,
        taskId: t.id,
        occurrence,
        reason: input.reason.trim(),
        requestedById: actingId(),
        requestedAt: nowIso(),
        previousDueAt: t.deadline.dueAt,
        /* Unchanged when the rule held it — the row still records what the
           deadline IS, so a reader is never shown a date that was not granted. */
        newDueAt: regrant.moved ? regrant.newDueAtIso : t.deadline.dueAt,
        deductionWaived: Boolean(input.waiveDeduction),
        waiverReason: input.waiveDeduction ? input.reason.trim() : null,
      };
      s.reworkRequests.push(rw);
      /* Only on a grant. A late submission keeps its date and stays overdue,
         which is what leaves its timer blocked until somebody grants time. */
      if (regrant.moved) t.deadline.dueAt = regrant.newDueAtIso;
      t.status = "in_progress";
      t.updatedAt = nowIso();
      this.#event(t.id, "rework_requested", `Rework #${occurrence} requested`);
      this.#notify(
        sub.submittedById,
        "rework_requested",
        "Rework requested",
        `“${t.title}” was sent back — ${input.reason.trim()}`,
        "task",
        t.id,
      );
    } else {
      const rj: Rejection = {
        id: nextId("rj"),
        reviewId: review.id,
        taskId: t.id,
        reason: input.reason.trim(),
        rejectedById: actingId(),
        rejectedAt: nowIso(),
        allowsResubmission:
          provisionalString("rejectionResubmission") === "allow",
      };
      s.rejections.push(rj);
      // Rejection re-grants time symmetrically with rework. Legacy re-granted
      // on TL rejection but not on second-stage rejection.
      t.deadline.dueAt = this.#regrantDeadline(t, sub);
      t.status = "in_progress";
      t.updatedAt = nowIso();
      this.#event(t.id, "rejected", "Submission rejected");
      this.#notify(
        sub.submittedById,
        "rejected",
        "Submission rejected",
        `“${t.title}” was rejected — ${input.reason.trim()}`,
        "task",
        t.id,
      );
    }
    return delay(ok(review));
  }

  /**
   * Re-grants the time the person had left when they submitted.
   *
   * **Rework no longer uses this** — it grants a fresh working hour instead,
   * per `reworkDeadline`. This remains the REJECTION path's rule, which the
   * owner's decision did not cover.
   */
  #regrantDeadline(t: Task, sub: TaskSubmission): string {
    if (!t.deadline.dueAt)
      return new Date(now().getTime() + 86_400_000).toISOString();
    const leftover =
      new Date(t.deadline.dueAt).getTime() -
      new Date(sub.submittedAt).getTime();
    return new Date(
      now().getTime() + Math.max(leftover, 3600_000),
    ).toISOString();
  }

  async listReviews(taskId: TaskId) {
    return delay(getStore().reviews.filter((r) => r.taskId === taskId));
  }
  async listReworkRequests(taskId: TaskId) {
    return delay(getStore().reworkRequests.filter((r) => r.taskId === taskId));
  }
  async listRejections(taskId: TaskId) {
    return delay(getStore().rejections.filter((r) => r.taskId === taskId));
  }

  /**
   * What is waiting on this person, with the reason.
   *
   * The old queue answered "are you somewhere in the chain", which is not the
   * same question as "is it your turn". A reviewer three stages down saw the
   * task in their queue and could do nothing with it; a task blocked because a
   * department has no head looked identical to one simply not yet reached.
   */
  /**
   * The action inbox.
   *
   * Reads the same visible task set the Tasks view does and asks
   * `actionableFor` about each one, so the inbox is a strict subset of what the
   * caller can already see and cannot leak a task through a route that skipped
   * the visibility rules.
   *
   * The subtitle and the review stage line are composed here rather than in the
   * view. The repository already holds the submission and the chain; making the
   * component re-derive them is how a row's second line and the rule that put
   * it there come to describe different things.
   */
  async listActionable(): Promise<ActionableItem[]> {
    const s = getStore();
    const meId = actingId();
    const page = await this.listTasks({ scope: "all" });

    const items: ActionableItem[] = [];
    for (const view of page.items) {
      const verdict = actionableFor(view, meId);
      if (!verdict) continue;

      let subtitle: string;
      if (verdict.reason === "review") {
        const sub = s.submissions
          .filter((x) => x.taskId === view.task.id)
          .sort((a, b) => b.attempt - a.attempt)[0];
        const plan = this.#reviewPlanFor(view.task);
        const stageIndex = sub ? sub.currentStage - 1 : 0;
        const submitter = s.employees.find((e) => e.id === sub?.submittedById);
        subtitle = `${plan.stages[stageIndex]?.name ?? "Review"} · stage ${
          stageIndex + 1
        } of ${sub?.reviewChain.length ?? plan.chain.length}${
          submitter ? ` · submitted by ${submitter.displayName}` : ""
        }`;
      } else if (verdict.reason === "approval") {
        const to =
          (view.assignees.length ? view.assignees : view.pendingAssignees)
            .map((e) => e.displayName)
            .join(", ") || "nobody yet";
        subtitle = `${view.owner?.displayName ?? "Someone"} → ${to}`;
      } else {
        subtitle = `${view.owner?.displayName ?? "Someone"} → you`;
      }

      items.push({
        view,
        reason: verdict.reason,
        label: verdict.label,
        href: verdict.href,
        subtitle,
        approvalKind:
          verdict.reason === "approval"
            ? (view.pendingApprovals.find((a) => a.approverId === meId)?.kind ??
              null)
            : null,
      });
    }

    items.push(...(await this.#dailyReportActionable(meId, items)));
    return delay(items);
  }

  /**
   * Unfiled daily reports, as inbox items. See the legacy repository's
   * `#dailyReportActionable` for why this is separate from the loop above:
   * whether today's timer activity has been reported on lives in the
   * work-commit/timer store, keyed by employee and day, not on the task
   * itself, so `actionableFor` (which only ever sees a `TaskView`) cannot
   * decide it.
   */
  async #dailyReportActionable(
    meId: string,
    already: ActionableItem[],
  ): Promise<ActionableItem[]> {
    const today = istDayKey(Date.now());
    const commits = await this.listDayCommits(today);
    const timers = await this.listTimers();
    const worked = workedToday(
      commits,
      timers as Parameters<typeof workedToday>[1],
      Date.now(),
    );
    if (worked.length === 0) return [];

    const seen = new Set(already.map((i) => i.view.task.id));
    const out: ActionableItem[] = [];
    for (const w of worked) {
      if (seen.has(w.taskId as TaskId)) continue;
      const reports = await this.listDailyReports(w.taskId as TaskId);
      if (
        !isReportPending({
          reports,
          worked,
          taskId: w.taskId,
          employeeId: meId,
          date: today,
        })
      )
        continue;
      const view = await this.getTask(w.taskId as TaskId);
      if (!view) continue;
      const mins = Math.max(1, Math.round(w.totalSecs / 60));
      out.push({
        view,
        reason: "daily_report",
        label: "File report",
        href: `/tasks/${w.taskId}/reports`,
        subtitle: `${mins}m logged today — no report filed yet`,
        approvalKind: null,
      });
    }
    return out;
  }

  async listReviewDetail() {
    const s = getStore();
    const meId = actingId();
    const queue = await this.listReviewQueue();
    return delay(
      queue.map((view) => {
        const sub = s.submissions
          .filter((x) => x.taskId === view.task.id)
          .sort((a, b) => b.attempt - a.attempt)[0];
        const plan = this.#reviewPlanFor(view.task);
        const myIndex = sub ? sub.reviewChain.indexOf(meId) : -1;
        const stageIndex = sub ? sub.currentStage - 1 : 0;
        return {
          view,
          stageName: plan.stages[stageIndex]?.name ?? "Review",
          stageNumber: stageIndex + 1,
          stageCount: sub?.reviewChain.length ?? plan.chain.length,
          isMyTurn: myIndex === stageIndex,
          waitingOn:
            myIndex > stageIndex
              ? (s.employees.find((e) => e.id === sub?.reviewChain[stageIndex])
                  ?.displayName ?? null)
              : null,
          blockedBy: plan.blockedBy,
        };
      }),
    );
  }

  async listReviewQueue(): Promise<TaskView[]> {
    const s = getStore();
    const mine = s.submissions.filter(
      (sub) =>
        !sub.supersededById &&
        sub.reviewChain[sub.currentStage - 1] === actingId() &&
        s.tasks.find((t) => t.id === sub.taskId)?.status === "in_review",
    );
    return delay(
      mine
        .map((sub) => s.tasks.find((t) => t.id === sub.taskId))
        .filter(Boolean)
        .map((t) => this.#view(t as Task)),
    );
  }

  /* ── Chat, events, attachments ──────────────────────────────────────────── */

  async listTaskChat(taskId: TaskId, thread: "chat" | "draft") {
    return delay(
      getStore()
        .chat.filter((c) => c.taskId === taskId && c.thread === thread)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async sendTaskChat(
    taskId: TaskId,
    thread: "chat" | "draft",
    text: string,
    attachments: MessageAttachment[],
  ): Promise<ActionResult<TaskChatMessage>> {
    const g = guard();
    if (g) return g;
    if (!text.trim() && !attachments.length)
      return fail("validation_failed", "Write a message.", "text");
    tick();
    const s = getStore();
    const me = s.employees.find((e) => e.id === actingId())!;
    const m: TaskChatMessage = {
      id: nextId("ch"),
      taskId,
      thread,
      senderId: actingId(),
      senderName: me.displayName,
      text: text.trim(),
      attachmentIds: attachments.map((a) => a.url),
      attachments: attachments.length ? attachments : undefined,
      messageType: attachments.length ? "attachment" : "text",
      createdAt: nowIso(),
    };
    s.chat.push(m);
    return delay(ok(m));
  }

  async listTaskEvents(taskId: TaskId) {
    return delay(
      getStore()
        .taskEvents.filter((e) => e.taskId === taskId)
        .sort((a, b) => b.sequence - a.sequence),
    );
  }

  async listAttachments(ids: string[]) {
    return delay(getStore().attachments.filter((a) => ids.includes(a.id)));
  }

  /* ── Projects ───────────────────────────────────────────────────────────── */

  #projectView(p: Project): ProjectView {
    const s = getStore();
    const links = s.projectTaskLinks.filter((l) => l.projectId === p.id);
    const tasks = links
      .map((l) => s.tasks.find((t) => t.id === l.taskId))
      .filter((t) => t && !t.deletedAt) as Task[];
    const milestones = s.milestones.filter((m) => m.projectId === p.id);
    return {
      project: p,
      owner: s.employees.find((e) => e.id === p.ownerId)!,
      members: s.projectMembers
        .filter((m) => m.projectId === p.id)
        .map((m) => ({
          ...m,
          employee: s.employees.find((e) => e.id === m.employeeId)!,
        })),
      progress: computeProgress(p, tasks, milestones, s.reworkRequests, now()),
      milestones,
      taskLinks: links,
      /**
       * Requirements no subtask took, across the project's broken-down tasks.
       *
       * The mock's project is a real entity linking arbitrary tasks rather than
       * the legacy container-task, so this gathers across the linked tasks
       * instead of reading one container's `completion`. The RULE is the same
       * one — `requirementCoverage` over `completionState` — so both
       * repositories answer this question identically.
       *
       * **Only tasks that have actually been broken down count.** A plain task
       * with acceptance criteria and no subtasks has every requirement
       * unclaimed, and listing those would report a breakdown gap on work
       * nobody intended to break down — turning an ordinary checklist into a
       * card full of warnings.
       */
      ...(() => {
        /* Summed across the project's broken-down tasks — the mock's project
           links many, where the legacy one IS a single container. The rule is
           the same either way, so the two repositories cannot disagree about
           what is covered. */
        const covers = tasks
          .map((t) => ({
            t,
            children: s.tasks.filter(
              (c) => c.parentTaskId === t.id && !c.deletedAt,
            ),
          }))
          .filter((x) => x.children.length > 0)
          .map((x) =>
            requirementCoverage(
              completionState(x.t, x.children).requirements,
            ),
          );
        return {
          unassignedRequirements: covers.flatMap((c) => c.pending),
          requirementsAssigned: covers.reduce(
            (n, c) => n + c.assigned.length,
            0,
          ),
          requirementsTotal: covers.reduce((n, c) => n + c.total, 0),
        };
      })(),
    };
  }

  async listProjects(q: ProjectQuery): Promise<Page<ProjectView>> {
    const s = getStore();
    const viewer = await this.getViewer();
    let list = s.projects.filter((p) => {
      if (!p.isRestricted) return true;
      // Restricted projects: members plus organisation-scoped roles only.
      const isMember = s.projectMembers.some(
        (m) => m.projectId === p.id && m.employeeId === viewer.employeeId,
      );
      const orgScope = viewer.roles.some((r) =>
        r.permissions.some(
          (x) => x.scope === "organisation" && x.capability === "people.view",
        ),
      );
      return isMember || orgScope;
    });

    if (q.status?.length)
      list = list.filter((p) => q.status!.includes(p.status));
    if (q.ownerId) list = list.filter((p) => p.ownerId === q.ownerId);
    if (q.memberId)
      list = list.filter((p) =>
        s.projectMembers.some(
          (m) => m.projectId === p.id && m.employeeId === q.memberId,
        ),
      );
    if (q.search) {
      const needle = q.search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.reference.toLowerCase().includes(needle),
      );
    }

    const views = list.map((p) => this.#projectView(p));
    const sort = q.sort ?? "name";
    views.sort((a, b) => {
      if (sort === "progress")
        return b.progress.progressPercent - a.progress.progressPercent;
      if (sort === "target")
        return (a.project.targetDate ?? "9999").localeCompare(
          b.project.targetDate ?? "9999",
        );
      if (sort === "health") {
        const order = { off_track: 0, at_risk: 1, on_track: 2, unknown: 3 };
        return order[a.progress.health] - order[b.progress.health];
      }
      return a.project.name.localeCompare(b.project.name);
    });

    const limit = q.limit ?? 24;
    const start = q.cursor ? Number(q.cursor) : 0;
    return delay({
      items: views.slice(start, start + limit),
      nextCursor: start + limit < views.length ? String(start + limit) : null,
      total: views.length,
    });
  }

  async getProject(id: ProjectId) {
    const p = getStore().projects.find((x) => x.id === id);
    return delay(p ? this.#projectView(p) : null);
  }

  async createProject(
    input: CreateProjectInput,
  ): Promise<ActionResult<Project>> {
    const g = guard();
    if (g) return g;
    if (!input.name.trim())
      return fail("validation_failed", "Name the project.", "name");
    tick();
    const s = getStore();
    const id = nextId("pr");
    const p: Project = {
      organisationId: actingOrganisationId(),
      id,
      reference: `PRJ-${id.split("-")[1]}`,
      name: input.name.trim(),
      description: input.description ?? null,
      /* A project is a folder: whoever makes it owns it, and it starts
         active. Neither is asked for any more. */
      ownerId: input.ownerId ?? actingId(),
      status: input.status ?? "active",
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      completedAt: null,
      tags: input.tags ?? [],
      priority: input.priority ?? null,
      isRestricted: false,
      createdById: actingId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
    };
    s.projects.push(p);
    s.projectMembers.push({
      id: nextId("pm"),
      projectId: id,
      employeeId: input.ownerId ?? actingId(),
      role: "owner",
      addedAt: nowIso(),
      addedById: actingId(),
    });
    for (const m of (input.memberIds ?? []).filter((x) => x !== input.ownerId)) {
      s.projectMembers.push({
        id: nextId("pm"),
        projectId: id,
        employeeId: m,
        role: "member",
        addedAt: nowIso(),
        addedById: actingId(),
      });
    }
    for (const tid of input.initialTaskIds ?? []) {
      s.projectTaskLinks.push({
        id: nextId("ptl"),
        projectId: id,
        taskId: tid,
        linkedAt: nowIso(),
        linkedById: actingId(),
        milestoneId: null,
      });
      const t = s.tasks.find((x) => x.id === tid);
      if (t) t.projectId = id;
    }
    this.#projectActivity(id, "created", "Project created");
    return delay(ok(p));
  }

  async updateProject(
    id: ProjectId,
    patch: Partial<Project>,
  ): Promise<ActionResult<Project>> {
    const g = guard();
    if (g) return g;
    const p = getStore().projects.find((x) => x.id === id);
    if (!p) return fail("not_found", "Project not found.");
    tick();
    const statusChanged = patch.status && patch.status !== p.status;
    Object.assign(p, patch, { updatedAt: nowIso() });
    if (statusChanged)
      this.#projectActivity(
        id,
        "status_changed",
        `Status changed to ${p.status}`,
      );
    return delay(ok(p));
  }

  async archiveProject(id: ProjectId): Promise<ActionResult<Project>> {
    const g = guard();
    if (g) return g;
    const p = getStore().projects.find((x) => x.id === id);
    if (!p) return fail("not_found", "Project not found.");
    tick();
    p.status = "archived";
    p.archivedAt = nowIso();
    p.updatedAt = nowIso();
    this.#projectActivity(id, "archived", "Project archived");
    return delay(ok(p));
  }

  async addProjectMember(
    projectId: ProjectId,
    employeeId: EmployeeId,
    role: ProjectMember["role"],
  ): Promise<ActionResult<ProjectMember>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    if (
      s.projectMembers.some(
        (m) => m.projectId === projectId && m.employeeId === employeeId,
      )
    )
      return fail("conflict", "That person is already a member.");
    tick();
    const m: ProjectMember = {
      id: nextId("pm"),
      projectId,
      employeeId,
      role,
      addedAt: nowIso(),
      addedById: actingId(),
    };
    s.projectMembers.push(m);
    const emp = s.employees.find((e) => e.id === employeeId);
    this.#projectActivity(
      projectId,
      "member_added",
      `${emp?.displayName ?? employeeId} added`,
    );
    return delay(ok(m));
  }

  async removeProjectMember(
    projectId: ProjectId,
    employeeId: EmployeeId,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const i = s.projectMembers.findIndex(
      (m) => m.projectId === projectId && m.employeeId === employeeId,
    );
    if (i === -1) return fail("not_found", "Not a member.");
    if (s.projectMembers[i].role === "owner")
      return fail(
        "invalid_state",
        "Transfer ownership before removing the owner.",
      );
    tick();
    const emp = s.employees.find((e) => e.id === employeeId);
    s.projectMembers.splice(i, 1);
    this.#projectActivity(
      projectId,
      "member_removed",
      `${emp?.displayName ?? employeeId} removed`,
    );
    return delay(ok(undefined));
  }

  async linkTask(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<ActionResult<ProjectTaskLink>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    if (
      s.projectTaskLinks.some(
        (l) => l.projectId === projectId && l.taskId === taskId,
      )
    )
      return fail("conflict", "That task is already in this project.");
    tick();
    const link: ProjectTaskLink = {
      id: nextId("ptl"),
      projectId,
      taskId,
      linkedAt: nowIso(),
      linkedById: actingId(),
      milestoneId: null,
    };
    s.projectTaskLinks.push(link);
    const t = s.tasks.find((x) => x.id === taskId);
    if (t) {
      t.projectId = projectId;
      t.updatedAt = nowIso();
    }
    this.#projectActivity(
      projectId,
      "task_linked",
      `“${t?.title ?? taskId}” linked`,
    );
    this.#event(taskId, "project_linked", "Linked to a project");
    return delay(ok(link));
  }

  /** Unlinking never deletes the task (brief §8.3). */
  async unlinkTask(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const i = s.projectTaskLinks.findIndex(
      (l) => l.projectId === projectId && l.taskId === taskId,
    );
    if (i === -1) return fail("not_found", "That task is not in this project.");
    tick();
    s.projectTaskLinks.splice(i, 1);
    const t = s.tasks.find((x) => x.id === taskId);
    if (t) {
      t.projectId = null;
      t.updatedAt = nowIso();
    }
    this.#projectActivity(
      projectId,
      "task_unlinked",
      `“${t?.title ?? taskId}” removed from the project`,
    );
    this.#event(
      taskId,
      "project_unlinked",
      "Removed from a project — the task still exists",
    );
    return delay(ok(undefined));
  }

  async listProjectTasks(projectId: ProjectId): Promise<TaskView[]> {
    const s = getStore();
    const ids = s.projectTaskLinks
      .filter((l) => l.projectId === projectId)
      .map((l) => l.taskId);
    return delay(
      s.tasks
        .filter((t) => ids.includes(t.id) && !t.deletedAt)
        .map((t) => this.#view(t)),
    );
  }

  async listProjectActivity(projectId: ProjectId): Promise<ProjectActivity[]> {
    return delay(
      getStore()
        .projectActivity.filter((a) => a.projectId === projectId)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    );
  }

  async addMilestone(
    projectId: ProjectId,
    title: string,
    targetDate: string,
  ): Promise<ActionResult<ProjectMilestone>> {
    const g = guard();
    if (g) return g;
    if (!title.trim())
      return fail("validation_failed", "Name the milestone.", "title");
    tick();
    const s = getStore();
    const m: ProjectMilestone = {
      id: nextId("ms"),
      projectId,
      title: title.trim(),
      targetDate,
      completedAt: null,
      taskIds: [],
      order: s.milestones.filter((x) => x.projectId === projectId).length + 1,
    };
    s.milestones.push(m);
    this.#projectActivity(
      projectId,
      "milestone_added",
      `Milestone “${m.title}” added`,
    );
    return delay(ok(m));
  }

  /* ── Score ──────────────────────────────────────────────────────────────── */

  async getScoreOverview(
    employeeId: EmployeeId,
    periodKey?: string,
  ): Promise<ScoreOverview> {
    const s = getStore();
    const { units, ledger } = projectScores(s, employeeId);
    const key = periodKey ?? periodKeyFor(nowIso());
    const inPeriod = units.filter((u) => u.periodKey === key);
    const prevKey = previousPeriodKey(key);
    const prevUnits = units.filter((u) => u.periodKey === prevKey);
    const prev =
      prevUnits.length > 0
        ? buildOverview(employeeId, prevKey, prevUnits, ledger, null)
            .overallPercentage
        : null;
    return delay(buildOverview(employeeId, key, inPeriod, ledger, prev));
  }

  async listScoreUnits(
    employeeId: EmployeeId,
    component?: ChannelId,
    periodKey?: string,
  ) {
    const { units } = projectScores(getStore(), employeeId);
    const key = periodKey ?? periodKeyFor(nowIso());
    return delay(
      units.filter(
        (u) => u.periodKey === key && (!component || u.component === component),
      ),
    );
  }

  async listLedger(
    employeeId: EmployeeId,
    component?: ChannelId,
    periodKey?: string,
  ) {
    const { ledger } = projectScores(getStore(), employeeId);
    const key = periodKey ?? periodKeyFor(nowIso());
    return delay(
      ledger
        .filter(
          (e) =>
            e.periodKey === key && (!component || e.component === component),
        )
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)),
    );
  }

  async listScoreHistory(employeeId: EmployeeId) {
    const { units, ledger } = projectScores(getStore(), employeeId);
    const keys = [...new Set(units.map((u) => u.periodKey))].sort();
    return delay(
      keys.map((key) => {
        const inPeriod = units.filter((u) => u.periodKey === key);
        const ov = buildOverview(employeeId, key, inPeriod, ledger, null);
        return {
          periodKey: key,
          overall: ov.overallPercentage,
          channels: {
            c1: ov.channels[0].percentage,
            c2: ov.channels[1].percentage,
            c3: ov.channels[2].percentage,
            c4: ov.channels[3].percentage,
          } as Record<ChannelId, number>,
        };
      }),
    );
  }

  /* ── Scoring rules ──────────────────────────────────────────────────────── */

  /**
   * Publishing a version is the only way a rule value changes.
   *
   * Three things happen together and must not come apart: the old version is
   * closed with an `effectiveTo`, the new one is appended to the history, and
   * the engine override is set. Skipping the third would reproduce exactly the
   * bug this whole path exists to fix — a card that says 0.5 while every score
   * is still computed at 0.2.
   *
   * Nothing is ever overwritten. A ledger entry cites the version that produced
   * it, so a superseded version has to remain readable or the entry becomes
   * unexplainable.
   */
  async publishRuleVersion(
    id: string,
    input: {
      parameters: Record<string, number>;
      effectiveFrom: string;
      note?: string;
    },
  ): Promise<ActionResult<ScoringRuleVersion>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    const s = getStore();
    const rule = s.rules.find((r) => r.id === id);
    if (!rule) return fail("not_found", "Rule not found.");
    if (rule.archivedAt)
      return fail("invalid_state", "An archived rule cannot be published.");

    const bad = Object.entries(input.parameters).find(
      ([, v]) => !Number.isFinite(v) || v < 0,
    );
    if (bad)
      return fail(
        "validation_failed",
        `"${bad[0]}" must be zero or a positive number.`,
        bad[0],
      );
    if (!input.effectiveFrom)
      return fail(
        "validation_failed",
        "A version needs an effective date.",
        "effectiveFrom",
      );

    tick();
    const previous = rule.version;
    previous.effectiveTo = input.effectiveFrom;

    const next: ScoringRuleVersion = {
      id: nextId("rv"),
      ruleId: id,
      version: bumpVersion(previous.version),
      parameters: { ...input.parameters },
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      createdById: actingId(),
      createdAt: nowIso(),
      supersedesVersionId: previous.id,
      /* An administrator publishing a value RESOLVES it. The provisional flag
         means "nobody has decided this", and somebody just did. */
      isProvisional: false,
      provisionalNote: input.note ?? null,
    };

    s.ruleVersions.push(next);
    rule.version = next;
    rule.currentVersionId = next.id;
    rule.engineKeys = Object.keys(input.parameters);

    this.#applyRuleToEngine(rule);
    return delay(ok(next));
  }

  /** Push a rule's effective parameters into the engine's override layer. */
  #applyRuleToEngine(rule: ScoringRule & { version: ScoringRuleVersion }) {
    for (const [key, value] of Object.entries<number>(
      rule.version.parameters,
    )) {
      if (rule.isActive && !rule.archivedAt) setRuleOverride(key, value);
      else clearRuleOverride(key);
    }
  }

  async updateScoringRule(
    id: string,
    patch: Partial<
      Pick<
        ScoringRule,
        "displayName" | "description" | "isActive" | "appliesTo"
      >
    >,
  ) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    const s = getStore();
    const rule = s.rules.find((r) => r.id === id);
    if (!rule) return fail("not_found", "Rule not found.");
    if (patch.displayName !== undefined && !patch.displayName.trim())
      return fail("validation_failed", "A rule needs a name.", "displayName");

    tick();
    Object.assign(rule, patch);
    /* Deactivating must withdraw the override, or a switched-off rule would
       carry on scoring people. */
    this.#applyRuleToEngine(rule);
    return delay(ok(rule));
  }

  async createScoringRule(input: {
    key: string;
    component: ChannelId;
    displayName: string;
    description: string;
  }) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    const s = getStore();
    if (!input.displayName.trim())
      return fail("validation_failed", "A rule needs a name.", "displayName");
    if (s.rules.some((r) => r.key === input.key))
      return fail("conflict", "That rule key already exists.", "key");

    tick();
    const id = nextId("rule");
    const version: ScoringRuleVersion = {
      id: nextId("rv"),
      ruleId: id,
      version: "1.0.0",
      parameters: {},
      effectiveFrom: nowIso().slice(0, 10),
      effectiveTo: null,
      createdById: actingId(),
      createdAt: nowIso(),
      supersedesVersionId: null,
      isProvisional: false,
      provisionalNote: null,
    };
    const rule: ScoringRule & { version: ScoringRuleVersion } = {
      id,
      key: input.key,
      component: input.component,
      displayName: input.displayName.trim(),
      description: input.description,
      currentVersionId: version.id,
      /* Created inactive. A new rule with no parameters that immediately
         started scoring people would be the wrong default by a wide margin. */
      isActive: false,
      archivedAt: null,
      appliesTo: { departmentIds: [], roleIds: [] },
      engineKeys: [],
      version,
    };
    s.rules.push(rule);
    s.ruleVersions.push(version);
    return delay(ok(rule));
  }

  async archiveScoringRule(id: string): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    const s = getStore();
    const rule = s.rules.find((r) => r.id === id);
    if (!rule) return fail("not_found", "Rule not found.");
    tick();
    /* Archived, never deleted: ledger entries cite the version that produced
       them, and a hard delete would make those entries unexplainable. */
    rule.archivedAt = nowIso();
    rule.isActive = false;
    this.#applyRuleToEngine(rule);
    return delay(ok(undefined));
  }

  async restoreScoringRule(id: string): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    const rule = getStore().rules.find((r) => r.id === id);
    if (!rule) return fail("not_found", "Rule not found.");
    tick();
    rule.archivedAt = null;
    this.#applyRuleToEngine(rule);
    return delay(ok(undefined));
  }

  async listRuleVersions(id: string) {
    return delay(
      getStore()
        .ruleVersions.filter((v) => v.ruleId === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async revertRuleVersion(id: string, versionId: string) {
    const s = getStore();
    const old = s.ruleVersions.find(
      (v) => v.id === versionId && v.ruleId === id,
    );
    if (!old) return fail("not_found", "That version does not exist.");
    /* A revert is a new version carrying the old parameters, not a deletion of
       everything since. The history has to show that a rollback happened. */
    return this.publishRuleVersion(id, {
      parameters: old.parameters,
      effectiveFrom: nowIso().slice(0, 10),
      note: `Reverted to ${old.version}`,
    });
  }

  async listScoringRules() {
    return delay([...getStore().rules]);
  }

  /* ── Goals, conduct, attendance ─────────────────────────────────────────── */

  /**
   * The C2 pool, from the seeded goals.
   *
   * The engine keeps the company total in a settings document; the prototype
   * has no such document, so a fixed pool stands in and the CLAIMED share is
   * computed from the seeded goals — which is the half that has to be real, so
   * the creation form's "what is left" figure moves as goals are added.
   */
  async getGoalPool() {
    const globalMaxPoints = 200;
    const claimed = claimedPercent(
      getStore()
        .goals.filter((g) => g.status === "active" || g.status === "draft")
        .map((g) => ({ weightagePercent: g.weightPercent })),
    );
    return delay({
      globalMaxPoints,
      claimedPercent: claimed,
      remainingPercent: remainingPercent(claimed),
    });
  }

  async validateGoalWeightage(input: {
    weightagePercent: number;
    excludeTaskId?: string | null;
  }) {
    /* The same rule the form applies, asked of the store — so the prototype
       refuses exactly what the engine would, in the same words. */
    const pool = await this.getGoalPool();
    const error = weightageRefusal({
      weightagePercent: input.weightagePercent,
      remainingPercent: pool.remainingPercent,
      globalMaxPoints: pool.globalMaxPoints,
    });
    return {
      valid: error === null,
      remainingPercent: pool.remainingPercent,
      error,
    };
  }

  /**
   * A goal task's roadmap, from the store.
   *
   * The prototype keeps the steps on the task itself, the way the engine keeps
   * them on the document — one array, replaced wholesale — so the two behave
   * the same when a roadmap is reordered or a step removed.
   */
  /**
   * Where this task's hours came from, from the store.
   *
   * The seeded repository records no credits, so this answers "given, and
   * nothing since" — which reconciles, and is honest: nothing in the prototype
   * has ever credited a budget back.
   */
  async getBudgetHistory(taskId: TaskId) {
    const t = getStore().tasks.find((x) => x.id === taskId);
    const current = t?.estimatedEffortSecs ?? 0;
    return delay({
      givenSecs: current,
      currentSecs: current,
      credits: [] as {
        id: string;
        at: string;
        previousSecs: number;
        newSecs: number;
        reason: string;
        byEmployeeId: string | null;
      }[],
    });
  }

  async getGoalRoadmap(taskId: TaskId) {
    const held = getStore().goalRoadmaps.find((r) => r.taskId === taskId);
    const taskMaxPoints = held?.taskMaxPoints ?? 0;
    return delay({
      activities: (held?.activities ?? []).map((a) => ({
        ...a,
        points: nodePointsFor(a.weightPercent, taskMaxPoints),
        perUserStatus: a.perUserStatus ?? null,
      })),
      submitted: held?.submitted ?? false,
      submittedAt: held?.submittedAt ?? null,
      taskMaxPoints,
      targetDate: held?.targetDate ?? null,
      goalStatement: held?.goalStatement ?? null,
    });
  }

  async saveGoalRoadmap(input: {
    taskId: TaskId;
    activities: {
      id: string;
      heading: string;
      description: string;
      deadline: string | null;
      weightPercent: number;
    }[];
  }): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    if (!s.tasks.some((t) => t.id === input.taskId))
      return fail("not_found", "That task could not be found.");
    tick();
    const held = s.goalRoadmaps.find((r) => r.taskId === input.taskId);
    /* Status and report are carried from what is already held, not taken from
       the caller: editing a step's heading must not reset it to `pending` or
       discard the report handed in against it. The same rule the engine
       adapter applies, for the same reason. */
    const carried = (
      activities: typeof input.activities,
      previous: {
        id: string;
        status: string;
        report: unknown;
        perUserStatus?: Record<string, Partial<GoalStepPerson>> | null;
      }[],
    ) =>
      activities.map((a) => {
        const was = previous.find((p) => p.id === a.id);
        return {
          ...a,
          status: was?.status ?? "pending",
          report: (was?.report ?? null) as {
            text: string;
            submittedAt: string | null;
            submittedBy: string | null;
            files: GoalReportFile[];
          } | null,
          /* Carried for the same reason as the report, and it matters more:
             this holds every OTHER assignee's progress, and a save built from
             the editor alone would delete all of it. */
          perUserStatus: was?.perUserStatus ?? null,
        };
      });

    if (held) held.activities = carried(input.activities, held.activities);
    else
      s.goalRoadmaps.push({
        taskId: String(input.taskId),
        /* The prototype has no `c2Config` on its tasks, so a roadmap saved
           against a task that never had a pool gets the seed's default — enough
           for the panel's arithmetic to be exercised. */
        taskMaxPoints: 40,
        submitted: false,
        submittedAt: null,
        /* The prototype's tasks carry no goal config, so a roadmap saved here
           has no agreed target date — the panel says so rather than inventing
           one. */
        targetDate: null,
        goalStatement: null,
        activities: carried(input.activities, []),
      });
    return ok(undefined);
  }

  async submitGoalRoadmap(taskId: TaskId): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const held = getStore().goalRoadmaps.find((r) => r.taskId === taskId);
    if (!held) return fail("not_found", "That roadmap could not be found.");
    /* Once, like the engine — a roadmap already handed over is left alone
       rather than stamped with a second, later moment. */
    if (held.submitted) return ok(undefined);
    tick();
    held.submitted = true;
    held.submittedAt = nowIso();
    return ok(undefined);
  }

  async submitGoalStepReport(input: {
    taskId: TaskId;
    stepId: string;
    text: string;
    files?: GoalReportFile[];
    personId?: string;
  }): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const held = getStore().goalRoadmaps.find((r) => r.taskId === input.taskId);
    const step = held?.activities.find((a) => a.id === input.stepId);
    if (!step) return fail("not_found", "That step could not be found.");
    const refusal = reportRefusal(input.text);
    if (refusal) return fail("validation_failed", refusal, "text");
    tick();
    /* The flat report, always — the engine writes it either way and everything
       that is not the per-person panel reads it. */
    const report = {
      text: input.text.trim(),
      submittedAt: nowIso(),
      submittedBy: actingId(),
      files: input.files ?? [],
    };
    step.report = report;

    if (!input.personId) {
      step.status = "pending_approval";
      return ok(undefined);
    }

    const assigneeIds = this.#goalAssignees(input.taskId);
    step.perUserStatus = withReport({
      step: { status: step.status, report, perUserStatus: step.perUserStatus },
      personId: input.personId,
      report,
    });
    step.status = rollUpStatus({
      step: { status: step.status, report, perUserStatus: step.perUserStatus },
      assigneeIds,
      next: step.perUserStatus,
    });
    return ok(undefined);
  }

  /** Who a goal task is assigned to. Empty rather than throwing. */
  #goalAssignees(taskId: TaskId): string[] {
    return getStore()
      .assignments.filter((a) => a.taskId === taskId)
      .map((a) => String(a.employeeId));
  }

  /**
   * A file, stood up without a store behind it.
   *
   * The seeded repository has no Drive, so the link is a `blob:` URL for the
   * file the person actually picked — it opens, for as long as the page lives.
   * That is enough to demonstrate attach-and-open, and it is honestly nothing
   * more: nothing here survives a reload, exactly like the rest of the mock.
   */
  async uploadGoalReportFile(file: File): Promise<ActionResult<GoalReportFile>> {
    const g = guard();
    if (g) return g;
    tick();
    const url = URL.createObjectURL(file);
    return ok({
      name: file.name,
      driveUrl: url,
      downloadUrl: url,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
  }

  async decideGoalStep(input: {
    taskId: TaskId;
    stepId: string;
    approve: boolean;
    personId?: string;
  }): Promise<ActionResult<{ pointsEarned: number }>> {
    const g = guard();
    if (g) return g;
    const held = getStore().goalRoadmaps.find((r) => r.taskId === input.taskId);
    const step = held?.activities.find((a) => a.id === input.stepId);
    if (!held || !step) return fail("not_found", "That step could not be found.");
    tick();

    const points = nodePointsFor(step.weightPercent, held.taskMaxPoints);
    /* The same rule the engine applies: on or before earns, after earns
       nothing. Held in one place so the prototype cannot pay for a late step
       the product would refuse. */
    const outcome = approvalOutcome({
      submittedAt:
        (input.personId
          ? step.perUserStatus?.[input.personId]?.report?.submittedAt
          : step.report?.submittedAt) ?? null,
      deadline: step.deadline,
      points,
    });

    if (input.personId) {
      const assigneeIds = this.#goalAssignees(input.taskId);
      const asStep = {
        status: step.status,
        report: step.report,
        perUserStatus: step.perUserStatus,
      };
      step.perUserStatus = withDecision({
        step: asStep,
        personId: input.personId,
        approve: input.approve,
        points,
        late: input.approve && !outcome.earns,
        nowIso: nowIso(),
      });
      step.status = rollUpStatus({
        step: asStep,
        assigneeIds,
        next: step.perUserStatus,
      });
      return ok({ pointsEarned: input.approve ? outcome.points : 0 });
    }

    if (!input.approve) {
      /* Sent back, so another report can be handed in. */
      step.status = "pending";
      step.report = null;
      return ok({ pointsEarned: 0 });
    }

    step.status = "done";
    return ok({ pointsEarned: outcome.points });
  }

  /**
   * Where somebody's C2 came from, from the store.
   *
   * Built from the roadmaps rather than kept as a second figure: the prototype
   * has no cache to read, and summing the approved steps is the same arithmetic
   * the engine performs when it writes its own.
   */
  async getC2Breakdown(employeeId: EmployeeId) {
    const s = getStore();
    const tasks = s.goalRoadmaps
      .map((r) => {
        const task = s.tasks.find((t) => t.id === r.taskId);
        const mine = s.assignments.some(
          (a) => a.taskId === r.taskId && String(a.employeeId) === String(employeeId),
        );
        if (!task || !mine) return null;
        const earned = r.activities
          .filter((a) => a.status === "done")
          .reduce(
            (sum, a) =>
              sum +
              approvalOutcome({
                submittedAt: a.report?.submittedAt ?? null,
                deadline: a.deadline,
                points: nodePointsFor(a.weightPercent, r.taskMaxPoints),
              }).points,
            0,
          );
        return {
          taskId: r.taskId,
          taskTitle: task.title,
          taskMaxPoints: r.taskMaxPoints,
          earnedPoints: Number(earned.toFixed(2)),
          weightagePercent: 0,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort((a, b) => b.earnedPoints - a.earnedPoints);

    return delay({
      totalEarned: Number(
        tasks.reduce((sum, t) => sum + t.earnedPoints, 0).toFixed(2),
      ),
      globalMaxPoints: 200,
      tasks,
    });
  }

  async listGoals(employeeId?: EmployeeId): Promise<Goal[]> {
    const s = getStore();
    return delay(
      s.goals.filter((g) => !employeeId || g.ownerId === employeeId),
    );
  }

  async getGoal(id: string) {
    const s = getStore();
    const goal = s.goals.find((g) => g.id === id);
    if (!goal) return delay(null);
    return delay({
      goal,
      activities: s.goalActivities.filter((a) => a.goalId === id),
    });
  }

  async updateGoalActivity(
    activityId: string,
    patch: Partial<GoalActivity>,
  ): Promise<ActionResult<GoalActivity>> {
    const g = guard();
    if (g) return g;
    const a = getStore().goalActivities.find((x) => x.id === activityId);
    if (!a) return fail("not_found", "Activity not found.");
    tick();
    Object.assign(a, patch);
    return delay(ok(a));
  }

  async listConductEvents(employeeId: EmployeeId): Promise<ConductEvent[]> {
    return delay(
      getStore().conductEvents.filter((c) => c.employeeId === employeeId),
    );
  }
  async listConductPolicies(): Promise<ConductPolicy[]> {
    return delay([...getStore().conductPolicies]);
  }

  async listAttendance(
    employeeId: EmployeeId,
    from: string,
    to: string,
  ): Promise<AttendanceDay[]> {
    return delay(
      getStore()
        .attendance.filter(
          (d) => d.employeeId === employeeId && d.date >= from && d.date <= to,
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    );
  }

  async recordAttendance(input: {
    employeeId: EmployeeId;
    date: string;
    status: AttendanceStatus;
    lateMinutes?: number;
    earlyDepartureMinutes?: number;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    actualStart?: string | null;
    actualEnd?: string | null;
    isExpectedWorkingDay?: boolean;
  }): Promise<ActionResult<AttendanceDay>> {
    const g = guard();
    if (g) return g;
    // Scope is enforced against the SUBJECT: a manager only their reports,
    // People Ops and admins anyone, nobody their own (nobody reports to
    // themselves, so `direct_reports` excludes it).
    const denied = this.#deny("attendance.record", input.employeeId);
    if (denied) return denied;

    const s = getStore();
    if (!s.employees.some((e) => e.id === input.employeeId))
      return fail("not_found", "That person is not in this workspace.", "employeeId");

    const valid = validateAttendanceRecord(input);
    if (!valid.ok) return fail("validation_failed", valid.message, valid.field);
    const v = valid.value;

    tick();
    const existing = s.attendance.find(
      (d) => d.employeeId === v.employeeId && d.date === v.date,
    );
    if (existing) {
      // Correcting a day rewrites it in place; the score reprojects from state.
      existing.status = v.status;
      existing.isExpectedWorkingDay = v.isExpectedWorkingDay;
      existing.lateMinutes = v.lateMinutes;
      existing.earlyDepartureMinutes = v.earlyDepartureMinutes;
      existing.scheduledStart = v.scheduledStart;
      existing.scheduledEnd = v.scheduledEnd;
      existing.actualStart = v.actualStart;
      existing.actualEnd = v.actualEnd;
      return delay(ok(existing));
    }

    const record: AttendanceDay = {
      organisationId: actingOrganisationId(),
      id: nextId("att"),
      employeeId: v.employeeId,
      date: v.date,
      isExpectedWorkingDay: v.isExpectedWorkingDay,
      scheduledStart: v.scheduledStart,
      scheduledEnd: v.scheduledEnd,
      actualStart: v.actualStart,
      actualEnd: v.actualEnd,
      lateMinutes: v.lateMinutes,
      earlyDepartureMinutes: v.earlyDepartureMinutes,
      status: v.status,
    };
    s.attendance.push(record);
    return delay(ok(record));
  }

  /* ── Material Request Forms ─────────────────────────────────────────────── */

  async listMyMrfs(): Promise<{ requests: MrfRequest[]; stats: ReturnType<typeof mrfStats> }> {
    const meId = actingId();
    const requests = getStore()
      .mrfs.filter((m) => m.requesterId === meId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return delay({ requests, stats: mrfStats(requests) });
  }

  async listMrfApprovals(
    status: MrfStatus | "all" = "pending",
  ): Promise<{ requests: MrfRequest[]; stats: ReturnType<typeof mrfApprovalStats> }> {
    const meId = actingId();
    const mine = getStore().mrfs.filter((m) => m.approverId === meId);
    const requests = mine
      .filter((m) => status === "all" || m.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return delay({ requests, stats: mrfApprovalStats(mine) });
  }

  async getMrf(id: string): Promise<MrfRequest | null> {
    const meId = actingId();
    const m = getStore().mrfs.find((x) => x.id === id);
    if (!m || (m.requesterId !== meId && m.approverId !== meId)) return delay(null);
    return delay(m);
  }

  async createMrf(input: NewMrfInput): Promise<ActionResult<MrfRequest>> {
    const g = guard();
    if (g) return g;
    const v = validateNewMrf(input);
    if (!v.ok) return fail("validation_failed", v.message, v.field);

    const s = getStore();
    const meId = actingId();
    const me = s.employees.find((e) => e.id === meId);
    if (!me) return fail("not_found", "Your record could not be found.");

    /* The approver is the requester's active reporting manager. With none, the
       request skips approval and goes straight to the store. */
    const edge = s.reporting.find((r) => r.employeeId === meId && !r.effectiveTo);
    const mgr = edge ? s.employees.find((e) => e.id === edge.managerId) : null;
    const approverActive = !!mgr && !mgr.exitedAt;
    const approverId = approverActive ? mgr!.id : null;
    const autoForwarded = !approverId;
    const dept = s.departments.find((d) => d.id === me.departmentId);

    tick();
    const now = nowIso();
    const ym = now.slice(2, 4) + now.slice(5, 7);
    const req: MrfRequest = {
      organisationId: actingOrganisationId(),
      id: nextId("mrf"),
      mrfNumber: `MRF-${ym}-${String(s.mrfs.length + 1).padStart(4, "0")}`,
      requesterId: meId,
      requesterName: me.displayName,
      requesterDepartment: dept?.name ?? null,
      requestType: input.requestType,
      priority: input.priority ?? "normal",
      reason: input.reason.trim(),
      neededBy: input.neededBy ?? null,
      deadline:
        input.requestType === "time_based" ? input.deadline ?? null : null,
      status: autoForwarded ? "approved" : "pending",
      approverId,
      approverName: approverId ? mgr!.displayName : null,
      autoForwarded,
      rejectionNote: null,
      items: input.items.map((it) => ({
        id: nextId("mrfi"),
        name: it.name.trim(),
        sku: it.sku ?? null,
        isUnmatched: it.isUnmatched ?? !it.rawItemId,
        requestedQty: it.requestedQty,
        unit: it.unit.trim(),
        description: it.description ?? null,
        status: autoForwarded ? "approved" : "pending",
        rawItemId: it.rawItemId ?? null,
        variantId: it.variantId ?? null,
        variantCombination: it.variantCombination ?? [],
        images: it.images ?? [],
      })),
      history: [
        {
          at: now,
          action: autoForwarded ? "auto_forwarded" : "created",
          actorName: me.displayName,
          detail: autoForwarded
            ? "No manager resolved — sent straight to the store."
            : null,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    s.mrfs.push(req);
    return delay(ok(req));
  }

  async cancelMrf(
    id: string,
    note?: string,
  ): Promise<ActionResult<MrfRequest>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const m = s.mrfs.find((x) => x.id === id);
    if (!m) return fail("not_found", "That request no longer exists.");
    if (!canCancelMrf(m, actingId()))
      return fail(
        "permission_denied",
        "Only the requester can withdraw this, and only before the store acts.",
      );
    tick();
    m.status = "cancelled";
    m.updatedAt = nowIso();
    m.history.push({
      at: m.updatedAt,
      action: "cancelled",
      actorName: this.#nameOf(actingId()),
      detail: note?.trim() || null,
    });
    return delay(ok(m));
  }

  async decideMrf(
    id: string,
    decision: {
      approve: boolean;
      note?: string;
      itemDecisions?: Record<string, "approved" | "rejected">;
    },
  ): Promise<ActionResult<MrfRequest>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const m = s.mrfs.find((x) => x.id === id);
    if (!m) return fail("not_found", "That request no longer exists.");
    if (!canDecideMrf(m, actingId()))
      return fail(
        "permission_denied",
        "Only the assigned approver can decide, and only while it is pending.",
      );
    if (!decision.approve && !decision.note?.trim())
      return fail("validation_failed", "Give a reason when you reject.", "note");

    tick();
    const now = nowIso();
    const actor = this.#nameOf(actingId());

    if (decision.approve) {
      m.items = m.items.map((it) => ({
        ...it,
        status:
          decision.itemDecisions?.[it.id] === "rejected" ? "rejected" : "approved",
      }));
      const anyApproved = m.items.some((it) => it.status === "approved");
      m.status = anyApproved ? "approved" : "rejected";
      m.rejectionNote = anyApproved ? null : "No items were approved.";
      m.history.push({
        at: now,
        action: anyApproved ? "approved" : "rejected",
        actorName: actor,
        detail: decision.note?.trim() || null,
      });
    } else {
      m.items = m.items.map((it) => ({ ...it, status: "rejected" as const }));
      m.status = "rejected";
      m.rejectionNote = decision.note!.trim();
      m.history.push({
        at: now,
        action: "rejected",
        actorName: actor,
        detail: decision.note!.trim(),
      });
    }
    m.updatedAt = now;
    return delay(ok(m));
  }

  async listMrfChat(id: string): Promise<MrfChatMessage[]> {
    const meId = actingId();
    const m = getStore().mrfs.find((x) => x.id === id);
    if (!m || (m.requesterId !== meId && m.approverId !== meId)) return delay([]);
    return delay(
      getStore()
        .mrfChat.filter((c) => c.mrfId === id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async sendMrfChat(
    id: string,
    body: string,
  ): Promise<ActionResult<MrfChatMessage>> {
    const g = guard();
    if (g) return g;
    if (!body.trim()) return fail("validation_failed", "Type a message.");
    const s = getStore();
    const meId = actingId();
    const m = s.mrfs.find((x) => x.id === id);
    if (!m) return fail("not_found", "That request no longer exists.");
    if (m.requesterId !== meId && m.approverId !== meId)
      return fail(
        "permission_denied",
        "Only the requester, approver or store can post here.",
      );
    tick();
    const msg: MrfChatMessage = {
      id: nextId("mc"),
      mrfId: id,
      senderId: meId,
      senderName: this.#nameOf(meId),
      senderRole: m.approverId === meId ? "tl" : "employee",
      body: body.trim(),
      isSystem: false,
      createdAt: nowIso(),
    };
    s.mrfChat.push(msg);
    return delay(ok(msg));
  }

  async searchMrfItems(query: string): Promise<RawItemHit[]> {
    const q = query.trim().toLowerCase();
    if (!q) return delay([]);
    return delay(
      getStore()
        .mrfCatalogue.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            (it.sku ?? "").toLowerCase().includes(q),
        )
        .slice(0, 8),
    );
  }

  /* ── Collaboration ──────────────────────────────────────────────────────── */

  async listConversations() {
    const s = getStore();
    return delay(
      s.conversations
        .filter((c) => c.participantIds.includes(actingId()))
        .map((c) => ({
          ...c,
          participants: c.participantIds
            .map((id) => s.employees.find((e) => e.id === id))
            .filter(Boolean) as Employee[],
        })),
    );
  }

  async listMessages(conversationId: string, opts?: { limit?: number }) {
    const pageSize = Math.max(1, opts?.limit ?? MESSAGE_PAGE_SIZE);
    const all = getStore()
      .messages.filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const hasMore = all.length > pageSize;
    return delay({
      messages: hasMore ? all.slice(all.length - pageSize) : all,
      hasMore,
    });
  }

  async sendMessage(
    conversationId: string,
    text: string,
    attachments?: MessageAttachment[],
    replyTo?: MessageReply | null,
  ): Promise<ActionResult<Message>> {
    const g = guard();
    if (g) return g;
    const media = attachments ?? [];
    if (!text.trim() && media.length === 0)
      return fail("validation_failed", "Write a message.", "text");
    tick();
    const s = getStore();
    const me = s.employees.find((e) => e.id === actingId())!;
    const m: Message = {
      id: nextId("mg"),
      conversationId,
      senderId: actingId(),
      senderName: me.displayName,
      text: text.trim(),
      attachmentIds: [],
      attachments: media,
      replyToId: replyTo?.messageId ?? null,
      replyTo: replyTo ?? null,
      createdAt: nowIso(),
      readBy: [actingId()],
    };
    s.messages.push(m);
    const c = s.conversations.find((x) => x.id === conversationId);
    if (c) {
      c.lastMessageAt = m.createdAt;
      c.lastMessagePreview = m.text || (media.length ? "📎 Attachment" : "");
      /* Your own message cannot leave you with something unread. Without this
         the badge counts the sender's own text and never clears, which reads as
         a broken thread rather than a full one. */
      c.unreadCount = 0;
    }
    return delay(ok(m));
  }

  /**
   * Start a conversation, or hand back the one that already exists.
   *
   * The caller names the OTHER people and is added here, so a client cannot
   * create a thread it is not in. Direct messages are keyed on the pair rather
   * than on creation order: `sorted(a, b)` matches regardless of who started
   * it, which is what stops "message Tobias" twice producing two threads.
   */
  async editMessage(
    conversationId: string,
    messageId: string,
    text: string,
  ): Promise<ActionResult<Message>> {
    const g = guard();
    if (g) return g;
    const body = text.trim();
    if (!body)
      return fail(
        "validation_failed",
        "A message cannot be emptied by editing — delete it instead.",
        "text",
      );
    const s = getStore();
    const m = s.messages.find(
      (x) => x.id === messageId && x.conversationId === conversationId,
    );
    if (!m) return fail("not_found", "That message is gone.");
    if (m.senderId !== actingId())
      return fail("permission_denied", "You can only edit your own messages.");
    if (m.isDeleted)
      return fail("invalid_state", "A deleted message cannot be edited.");
    tick();
    m.text = body;
    m.editedAt = nowIso();
    return delay(ok(m));
  }

  async deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const m = s.messages.find(
      (x) => x.id === messageId && x.conversationId === conversationId,
    );
    if (!m) return delay(ok(undefined));
    if (m.senderId !== actingId())
      return fail("permission_denied", "You can only delete your own messages.");
    tick();
    m.isDeleted = true;
    m.text = "";
    m.attachments = [];
    return delay(ok(undefined));
  }

  async createConversation(
    input: CreateConversationInput,
  ): Promise<ActionResult<Conversation>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const me = actingId();

    const others = [...new Set(input.participantIds)].filter((id) => id !== me);
    if (others.length === 0)
      return fail(
        "validation_failed",
        input.kind === "group"
          ? "Choose at least two people for a group."
          : "Choose somebody to message.",
        "participantIds",
      );

    const unknown = others.find(
      (id) => !s.employees.some((e) => e.id === id && !e.exitedAt),
    );
    if (unknown)
      return fail(
        "validation_failed",
        "One of the people chosen is no longer in the directory.",
        "participantIds",
      );

    if (input.kind === "direct") {
      if (others.length > 1)
        return fail(
          "validation_failed",
          "A direct message is between two people. Create a group instead.",
          "participantIds",
        );
      const pair = directConversationKey([me, others[0]]);
      const existing = s.conversations.find(
        (c) =>
          c.kind === "direct" && directConversationKey(c.participantIds) === pair,
      );
      /* Returning the existing thread rather than refusing: "you already have
         this conversation" is not an error a person can act on — it is the
         thread they asked for. */
      if (existing) return delay(ok(existing));
    }

    const title = (input.title ?? "").trim();
    if (input.kind === "group") {
      if (others.length < 2)
        return fail(
          "validation_failed",
          "A group needs at least two other people.",
          "participantIds",
        );
      if (!title)
        return fail("validation_failed", "Give the group a name.", "title");
    }

    tick();
    const c: Conversation = {
      organisationId: actingOrganisationId(),
      id: nextId("cv"),
      kind: input.kind,
      participantIds: [me, ...others],
      title: input.kind === "group" ? title : null,
      /* No `Group` record — see `CreateConversationInput`. A chat group and an
         administered group are different objects and this is the former. */
      groupId: null,
      /* The creator is the first admin of a group; a direct thread has none, so
         the key is omitted rather than set to `undefined`. */
      ...(input.kind === "group" ? { adminIds: [me] } : {}),
      lastMessageAt: null,
      lastMessagePreview: null,
      unreadCount: 0,
    };
    s.conversations.push(c);
    return delay(ok(c));
  }

  async markConversationRead(
    conversationId: string,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const c = s.conversations.find((x) => x.id === conversationId);
    if (!c) return fail("not_found", "Conversation not found.");
    if (!c.participantIds.includes(actingId()))
      return fail("permission_denied", "This conversation is not yours.");
    c.unreadCount = 0;
    for (const m of s.messages) {
      if (m.conversationId === conversationId && !m.readBy.includes(actingId()))
        m.readBy.push(actingId());
    }
    return delay(ok(undefined));
  }

  #groupConv(id: string) {
    return getStore().conversations.find(
      (c) => c.id === id && c.kind === "group",
    );
  }

  async updateGroup(
    groupId: string,
    patch: { title?: string },
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const c = this.#groupConv(groupId);
    if (!c) return fail("not_found", "Group not found.");
    if (!(c.adminIds ?? []).includes(actingId()))
      return fail("permission_denied", "Only a group admin can edit the group.");
    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (!t) return fail("validation_failed", "A group needs a name.", "title");
      c.title = t;
    }
    tick();
    return delay(ok(undefined));
  }

  async addGroupMember(
    groupId: string,
    employeeId: string,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const c = this.#groupConv(groupId);
    if (!c) return fail("not_found", "Group not found.");
    if (!(c.adminIds ?? []).includes(actingId()))
      return fail("permission_denied", "Only a group admin can add members.");
    if (!c.participantIds.includes(employeeId))
      c.participantIds = [...c.participantIds, employeeId];
    tick();
    return delay(ok(undefined));
  }

  async removeGroupMember(
    groupId: string,
    employeeId: string,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const c = this.#groupConv(groupId);
    if (!c) return fail("not_found", "Group not found.");
    if (employeeId !== actingId() && !(c.adminIds ?? []).includes(actingId()))
      return fail(
        "permission_denied",
        "Only a group admin can remove members.",
      );
    c.participantIds = c.participantIds.filter((x) => x !== employeeId);
    c.adminIds = (c.adminIds ?? []).filter((x) => x !== employeeId);
    tick();
    return delay(ok(undefined));
  }

  async setGroupAdmin(
    groupId: string,
    employeeId: string,
    isAdmin: boolean,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const c = this.#groupConv(groupId);
    if (!c) return fail("not_found", "Group not found.");
    if (!(c.adminIds ?? []).includes(actingId()))
      return fail(
        "permission_denied",
        "Only a group admin can change who administers it.",
      );
    const admins = new Set(c.adminIds ?? []);
    if (isAdmin) {
      /* Additive — promoting a second, third, … admin never displaces the
         first. A group can carry as many admins as it likes. */
      admins.add(employeeId);
      if (!c.participantIds.includes(employeeId))
        c.participantIds = [...c.participantIds, employeeId];
    } else {
      if (admins.size <= 1 && admins.has(employeeId))
        return fail("invalid_state", "A group needs at least one admin.");
      admins.delete(employeeId);
    }
    c.adminIds = [...admins];
    tick();
    return delay(ok(undefined));
  }

  async listGroups() {
    return delay([...getStore().groups]);
  }
  async getGroup(id: string) {
    const s = getStore();
    const g = s.groups.find((x) => x.id === id);
    if (!g) return delay(null);
    return delay({
      ...g,
      members: g.memberIds
        .map((mid) => s.employees.find((e) => e.id === mid))
        .filter(Boolean) as Employee[],
    });
  }
  /* ── Documents ────────────────────────────────────────────────────────── */

  /**
   * Documents this person may open.
   *
   * Membership, not visibility-by-hierarchy. A document is a place people write
   * together and being somebody's manager is not by itself a reason to be in
   * one — unlike a task, where the reporting line IS the visibility rule.
   */
  async listDocuments(kind: DocumentKind = "doc"): Promise<DocumentSummary[]> {
    const me = actingId();
    const s = getStore();
    return delay(
      s.documents
        .filter((d) => !d.deletedAt && (d.kind ?? "doc") === kind && canViewDocument(d, me))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((d) => ({
          ...d,
          preview: previewOfHtml(
            s.documentBodies.find((b) => b.documentId === d.id)?.html ?? "",
          ),
        })),
    );
  }

  async getDocument(id: string): Promise<CoworkDocument | null> {
    const me = actingId();
    const d = getStore().documents.find((x) => x.id === id && !x.deletedAt);
    return delay(d && canViewDocument(d, me) ? d : null);
  }

  async getDocumentBody(id: string): Promise<CoworkDocumentBody | null> {
    const doc = await this.getDocument(id);
    if (!doc) return null;
    return delay(
      getStore().documentBodies.find((b) => b.documentId === id) ?? {
        documentId: id,
        html: "",
        cells: null,
        ydocState: null,
        pageSetup: null,
        updatedAt: doc.updatedAt,
      },
    );
  }

  async createDocument(input: {
    title: string;
    kind?: DocumentKind;
    memberIds?: EmployeeId[];
  }): Promise<ActionResult<CoworkDocument>> {
    const g = guard();
    if (g) return g;
    const me = actingId();
    tick();
    const now = nowIso();
    /* The creator is always a member. A document nobody can open is not a
       document, and the commonest way to write one is to pass a member list
       that forgot the author. */
    const memberIds = [...new Set([me, ...(input.memberIds ?? [])])];
    const members = memberIds.map((employeeId) => ({
      employeeId,
      /* The creator owns it; anybody named at creation can write. */
      role: (employeeId === me ? "owner" : "editor") as DocumentRole,
      addedAt: now,
    }));
    const doc: CoworkDocument = {
      organisationId: actingOrganisationId(),
      id: nextId("doc"),
      kind: input.kind ?? "doc",
      title: input.title.trim() || "Untitled document",
      createdById: me,
      lastEditedById: null,
      members,
      memberIds,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      driveFileId: null,
      driveSyncedAt: null,
    };
    const s = getStore();
    s.documents.push(doc);
    s.documentBodies.push({
      documentId: doc.id,
      html: "",
      cells: null,
      ydocState: null,
      pageSetup: null,
      updatedAt: now,
    });
    persistStore();
    return delay(ok(doc));
  }

  async renameDocument(
    id: string,
    title: string,
  ): Promise<ActionResult<CoworkDocument>> {
    const g = guard();
    if (g) return g;
    const doc = getStore().documents.find((d) => d.id === id && !d.deletedAt);
    if (!doc) return fail("not_found", "Document not found.");
    if (!canManageDocument(doc, actingId()))
      return fail("permission_denied", "Only an owner can rename this document.");
    const next = title.trim();
    if (!next) return fail("validation_failed", "Give the document a name.");
    tick();
    doc.title = next;
    doc.updatedAt = nowIso();
    persistStore();
    return delay(ok(doc));
  }

  async deleteDocument(id: string): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const doc = getStore().documents.find((d) => d.id === id && !d.deletedAt);
    if (!doc) return fail("not_found", "Document not found.");
    /* Only the author. Membership is permission to WRITE in a document, not to
       remove one out from under everybody else in it. */
    if (!canManageDocument(doc, actingId()))
      return fail("permission_denied", "Only an owner can delete this document.");
    tick();
    doc.deletedAt = nowIso();
    persistStore();
    return delay(ok(undefined));
  }

  async saveDocumentBody(
    id: string,
    body: {
      html?: string;
      cells?: string | null;
      ydocState?: string | null;
      pageSetup?: DocumentPageSetup | null;
    },
  ): Promise<ActionResult<CoworkDocumentBody>> {
    const g = guard();
    if (g) return g;
    const me = actingId();
    const s = getStore();
    const doc = s.documents.find((d) => d.id === id && !d.deletedAt);
    if (!doc) return fail("not_found", "Document not found.");
    const refusal = editRefusal(doc, me);
    if (refusal) return fail("permission_denied", refusal);
    tick();
    const now = nowIso();
    let record = s.documentBodies.find((b) => b.documentId === id);
    if (!record) {
      record = {
        documentId: id,
        html: "",
        cells: null,
        ydocState: null,
        pageSetup: null,
        updatedAt: now,
      };
      s.documentBodies.push(record);
    }
    /* Each field only when given. A sheet save carries no html and must not
       blank a document's prose, and vice versa. */
    if (body.html !== undefined) record.html = body.html;
    if (body.cells !== undefined) record.cells = body.cells;
    /* Only overwritten when given. A phase-1 save carries no CRDT state and
       must not erase the state a collaborative session wrote. */
    if (body.ydocState !== undefined) record.ydocState = body.ydocState;
    /* Validated at the write, not only in the dialog. Margins that leave no
       measure would produce a page nobody can type on for everybody who opens
       the document afterwards. */
    if (body.pageSetup !== undefined) {
      const refusal = body.pageSetup ? pageSetupRefusal(body.pageSetup) : null;
      if (refusal) return fail("validation_failed", refusal);
      record.pageSetup = body.pageSetup;
    }
    record.updatedAt = now;
    doc.updatedAt = now;
    doc.lastEditedById = me;
    persistStore();
    return delay(ok(record));
  }

  async setDocumentMember(
    id: string,
    employeeId: EmployeeId,
    role: DocumentRole | null,
  ): Promise<ActionResult<CoworkDocument>> {
    const g = guard();
    if (g) return g;
    const doc = getStore().documents.find((d) => d.id === id && !d.deletedAt);
    if (!doc) return fail("not_found", "Document not found.");
    const refusal = memberChangeRefusal({
      doc,
      actorId: actingId(),
      targetId: employeeId,
      nextRole: role,
    });
    if (refusal) return fail("permission_denied", refusal);
    tick();
    const next = writeMembers(doc.members, {
      employeeId,
      role,
      at: nowIso(),
    });
    doc.members = next.members;
    doc.memberIds = next.memberIds;
    doc.updatedAt = nowIso();
    persistStore();
    return delay(ok(doc));
  }

  /**
   * Version history — an in-memory stand-in for the real service's Firestore
   * subcollection. See the `documentVersions` field on `Store` for what a
   * "version" holds here and why it is narrower than the real `ydocState`
   * checkpoint.
   */
  async listDocumentVersions(id: string): Promise<DocumentVersionSummary[]> {
    const me = actingId();
    const s = getStore();
    const doc = s.documents.find((d) => d.id === id && !d.deletedAt);
    if (!doc || !canViewDocument(doc, me)) return delay([]);
    return delay(
      s.documentVersions
        .filter((v) => v.documentId === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ documentId: _documentId, html: _html, cells: _cells, ...summary }) => summary),
    );
  }

  async saveDocumentVersion(
    id: string,
    label?: string,
  ): Promise<ActionResult<DocumentVersionSummary>> {
    const g = guard();
    if (g) return g;
    const me = actingId();
    const s = getStore();
    const doc = s.documents.find((d) => d.id === id && !d.deletedAt);
    if (!doc) return fail("not_found", "Document not found.");
    const refusal = editRefusal(doc, me);
    if (refusal) return fail("permission_denied", refusal);
    const body = s.documentBodies.find((b) => b.documentId === id);
    tick();
    const version = {
      documentId: id,
      id: nextId("docver"),
      createdAt: nowIso(),
      authorId: me,
      authorName: s.employees.find((e) => e.id === me)?.displayName ?? "Someone",
      label: label?.trim() || null,
      html: body?.html ?? "",
      cells: body?.cells ?? null,
    };
    s.documentVersions.push(version);
    persistStore();
    const { documentId: _documentId, html: _html, cells: _cells, ...summary } = version;
    return delay(ok(summary));
  }

  async restoreDocumentVersion(
    id: string,
    versionId: string,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const me = actingId();
    const s = getStore();
    const doc = s.documents.find((d) => d.id === id && !d.deletedAt);
    if (!doc) return fail("not_found", "Document not found.");
    const refusal = editRefusal(doc, me);
    if (refusal) return fail("permission_denied", refusal);
    const version = s.documentVersions.find(
      (v) => v.documentId === id && v.id === versionId,
    );
    if (!version) return fail("not_found", "That version no longer exists.");
    tick();
    const now = nowIso();
    let body = s.documentBodies.find((b) => b.documentId === id);
    if (!body) {
      body = { documentId: id, html: "", cells: null, ydocState: null, pageSetup: null, updatedAt: now };
      s.documentBodies.push(body);
    }
    /* A replacement, matching the real route: whatever is current is
       overwritten with the version's own text, not merged with it. */
    body.html = version.html;
    body.cells = version.cells;
    body.updatedAt = now;
    doc.updatedAt = now;
    persistStore();
    return delay(ok(undefined));
  }

  /* ── Mindmaps ────────────────────────────────────────────────────────────
   *
   * The real implementation posts to `/cowork/mindmaps` and the ENGINE
   * validates the card tree. This one validates it here, and that duplication
   * is deliberate rather than an oversight: the mock is what the UI is
   * developed and tested against, so a mock that accepted a two-rooted tree
   * would let a screen be built that only fails against the real backend.
   *
   * `mindmapTreeRefusal` is the shared sentence-for-sentence check, so the two
   * cannot drift into refusing different things.
   */
  async listMindMaps(): Promise<MindMapSummary[]> {
    const me = actingId();
    return delay(
      getStore()
        .mindmaps.filter(
          (m) => !m.deletedAt && m.memberIds.includes(me),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((m) => ({ ...m })),
    );
  }

  async getMindMap(id: string): Promise<MindMapDetail | null> {
    const me = actingId();
    const s = getStore();
    const mindmap = s.mindmaps.find(
      (m) => m.id === id && !m.deletedAt && m.memberIds.includes(me),
    );
    /* Not a member is indistinguishable from not existing, matching the route:
       a 403 on an id confirms the id is real. */
    if (!mindmap) return delay(null);
    const body = s.mindmapNodes.find((b) => b.mindmapId === id);
    return delay({ mindmap: { ...mindmap }, nodes: [...(body?.nodes ?? [])] });
  }

  async createMindMap(input: {
    title: string;
    memberIds?: EmployeeId[];
    nodes?: MindNode[];
  }): Promise<ActionResult<MindMapRecord>> {
    const g = guard();
    if (g) return g;
    const me = actingId();
    tick();
    const now = nowIso();
    const title = input.title.trim() || "Untitled mindmap";

    /* Supplied cards are validated exactly as a later save is. An import is not
       a trusted path just because it is the first write. */
    let nodes: MindNode[];
    if (input.nodes !== undefined) {
      const refusal = mindmapTreeRefusal(input.nodes);
      if (refusal) return fail("validation_failed", refusal);
      nodes = input.nodes.map((n) => ({ ...n }));
    } else {
      /* Created WITH a root. An empty mindmap cannot be drawn and its only
         possible first action is "add the root", so shipping that state would
         be shipping a screen whose only exit is one button. */
      nodes = [
        {
          id: "root",
          parentId: null,
          title,
          description: "",
          links: [],
          images: [],
          collapsed: false,
        },
      ];
    }

    const memberIds = [...new Set([me, ...(input.memberIds ?? [])])];
    const record: MindMapRecord = {
      organisationId: actingOrganisationId(),
      id: nextId("mm"),
      title,
      createdById: me,
      lastEditedById: null,
      members: memberIds.map((employeeId) => ({
        employeeId,
        role: employeeId === me ? "owner" : "editor",
        addedAt: now,
      })),
      memberIds,
      nodeCount: nodes.length,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const s = getStore();
    s.mindmaps.push(record);
    s.mindmapNodes.push({ mindmapId: record.id, nodes, updatedAt: now });
    persistStore();
    return delay(ok({ ...record }));
  }

  async renameMindMap(
    id: string,
    title: string,
  ): Promise<ActionResult<MindMapRecord>> {
    const g = guard();
    if (g) return g;
    const next = title.trim();
    if (!next) return fail("validation_failed", "Give the mindmap a name.", "title");
    const me = actingId();
    const map = getStore().mindmaps.find(
      (m) => m.id === id && !m.deletedAt && m.memberIds.includes(me),
    );
    if (!map) return fail("not_found", "Mindmap not found.");
    if (!map.members.some((m) => m.employeeId === me && m.role === "owner"))
      return fail("permission_denied", "Only an owner can rename this mindmap.");
    tick();
    map.title = next;
    map.updatedAt = nowIso();
    map.lastEditedById = me;
    persistStore();
    return delay(ok({ ...map }));
  }

  async deleteMindMap(id: string): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const me = actingId();
    const map = getStore().mindmaps.find(
      (m) => m.id === id && !m.deletedAt && m.memberIds.includes(me),
    );
    if (!map) return fail("not_found", "Mindmap not found.");
    if (!map.members.some((m) => m.employeeId === me && m.role === "owner"))
      return fail("permission_denied", "Only an owner can delete this mindmap.");
    tick();
    /* Soft, and the cards are left where they are. Reaping them at the same
       moment would make the record recoverable and the map itself not. */
    map.deletedAt = nowIso();
    map.updatedAt = map.deletedAt;
    persistStore();
    return delay(ok(undefined));
  }

  async saveMindMapNodes(
    id: string,
    nodes: MindNode[],
  ): Promise<ActionResult<MindMapDetail>> {
    const g = guard();
    if (g) return g;
    const me = actingId();
    const s = getStore();
    const map = s.mindmaps.find(
      (m) => m.id === id && !m.deletedAt && m.memberIds.includes(me),
    );
    if (!map) return fail("not_found", "Mindmap not found.");
    if (
      !map.members.some(
        (m) => m.employeeId === me && (m.role === "owner" || m.role === "editor"),
      )
    )
      return fail("permission_denied", "You can view this mindmap but not change it.");

    const refusal = mindmapTreeRefusal(nodes);
    if (refusal) return fail("validation_failed", refusal);

    tick();
    const now = nowIso();
    const stored = nodes.map((n) => ({ ...n }));
    const body = s.mindmapNodes.find((b) => b.mindmapId === id);
    if (body) {
      body.nodes = stored;
      body.updatedAt = now;
    } else {
      s.mindmapNodes.push({ mindmapId: id, nodes: stored, updatedAt: now });
    }
    /* `nodeCount` is written here, in the one place that writes cards, so the
       list's figure cannot drift from the tree it describes. */
    map.nodeCount = stored.length;
    map.updatedAt = now;
    map.lastEditedById = me;
    persistStore();
    return delay(ok({ mindmap: { ...map }, nodes: [...stored] }));
  }

  async setMindMapMember(
    id: string,
    employeeId: EmployeeId,
    role: MindMapRole | null,
  ): Promise<ActionResult<MindMapRecord>> {
    const g = guard();
    if (g) return g;
    const me = actingId();
    const map = getStore().mindmaps.find(
      (m) => m.id === id && !m.deletedAt && m.memberIds.includes(me),
    );
    if (!map) return fail("not_found", "Mindmap not found.");
    if (!map.members.some((m) => m.employeeId === me && m.role === "owner"))
      return fail(
        "permission_denied",
        "Only an owner can change who is on this mindmap.",
      );

    const existing = map.members.find((m) => m.employeeId === employeeId);
    const rest = map.members.filter((m) => m.employeeId !== employeeId);
    const next =
      role === null
        ? rest
        : [
            ...rest,
            {
              employeeId,
              role,
              addedAt: existing?.addedAt ?? nowIso(),
            },
          ];
    if (!next.some((m) => m.role === "owner"))
      return fail(
        "validation_failed",
        "A mindmap needs an owner. Make somebody else an owner before removing this one.",
      );

    tick();
    map.members = next;
    map.memberIds = [...new Set(next.map((m) => m.employeeId))];
    map.updatedAt = nowIso();
    persistStore();
    return delay(ok({ ...map }));
  }

  /**
   * External sharing, in the demo tenant — an in-memory ledger, not routed
   * through any engine. There is no real email to send in mock mode, so
   * `inviteExternal` just files the invite as `"pending"`; nothing here can
   * be accepted from outside because there is no accept endpoint in the
   * mock (the guest flow only exists against the real engine). This exists
   * so `ShareMenu` can be exercised in the demo tenant without throwing.
   */
  #externalShares = new Map<string, ExternalShareInvite[]>();

  async listExternalShares(
    kind: ExternalShareKind,
    id: string,
  ): Promise<ExternalShareInvite[]> {
    const list = this.#externalShares.get(`${kind}:${id}`) ?? [];
    return delay([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async inviteExternal(
    kind: ExternalShareKind,
    id: string,
    email: string,
    role: ExternalShareRole,
  ): Promise<ActionResult<ExternalShareInvite>> {
    const g = guard();
    if (g) return g;
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes("@"))
      return fail("validation_failed", "That doesn't look like an email address.");
    const me = getStore().employees.find((e) => e.id === actingId());
    const key = `${kind}:${id}`;
    /* Re-inviting the same email supersedes its previous live invite rather
       than piling up a second one — same rule the real engine enforces. */
    const invite: ExternalShareInvite = {
      id: nextId("share"),
      targetKind: kind,
      targetId: id,
      email: normalized,
      role,
      status: "pending",
      invitedByName: me?.displayName ?? "A teammate",
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      acceptedAt: null,
    };
    const next = (this.#externalShares.get(key) ?? [])
      .filter((i) => i.email !== normalized)
      .concat(invite);
    this.#externalShares.set(key, next);
    tick();
    return delay(ok(invite));
  }

  async revokeExternal(
    kind: ExternalShareKind,
    id: string,
    inviteId: string,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const key = `${kind}:${id}`;
    const list = this.#externalShares.get(key) ?? [];
    const idx = list.findIndex((i) => i.id === inviteId);
    if (idx === -1) return fail("not_found", "That invite could not be found.");
    const next = [...list];
    next[idx] = { ...next[idx], status: "revoked" };
    this.#externalShares.set(key, next);
    tick();
    return delay(ok(undefined));
  }

  async listMeetings() {
    return delay(
      [...getStore().meetings].sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      ),
    );
  }
  async getMeeting(id: string) {
    return delay(getStore().meetings.find((m) => m.id === id) ?? null);
  }
  async getMeetingByToken(token: string) {
    return delay(
      getStore().meetings.find((m) => m.joinToken === token) ?? null,
    );
  }
  async createMeeting(
    input: CreateMeetingInput,
  ): Promise<ActionResult<Meeting>> {
    const g = guard();
    if (g) return g;
    if (!input.title.trim())
      return fail("validation_failed", "Give the meeting a title.", "title");
    tick();
    const m: Meeting = {
      organisationId: actingOrganisationId(),
      id: nextId("mt"),
      title: input.title.trim(),
      description: input.description ?? null,
      organiserId: actingId(),
      participantIds: input.participantIds,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "scheduled",
      joinToken: `cw-${nextId("tok")}`,
      recordingEnabled: false,
      hasSummary: false,
      livekitRoomName: null,
      agenda: (input.agenda ?? []).map((a) => a.trim()).filter(Boolean),
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      startedAt: null,
      endedAt: null,
      actualDurationSecs: null,
      transcriptId: null,
      actionItems: [],
    };
    const s = getStore();
    s.meetings.push(m);

    /* Everybody invited gets a participant record now, not on first join. The
       invitation IS the record — without it there is no way to say who was
       asked and did not come, which is the difference between an absence and a
       person who was never invited. */
    for (const employeeId of [m.organiserId, ...m.participantIds]) {
      this.#addMeetingParticipant(m, employeeId);
    }
    this.#meetingEvent(m, "created", m.title);
    for (const id of m.participantIds) {
      this.#notify(
        id,
        "meeting_invitation",
        "Meeting invitation",
        `${this.#nameOf(actingId())} invited you to “${m.title}”.`,
        "meeting",
        m.id,
      );
    }
    persistStore();
    return delay(ok(m));
  }

  /* ── Mail ───────────────────────────────────────────────────────────────── */

  /**
   * The unified mailbox.
   *
   * ONE list, whatever the transport. `folder` is a view over per-person state,
   * not a partition — trash is `trashedBy`, sent is `sentAt` plus authorship.
   * Legacy had two inboxes and made a person know which system a message lived
   * in before they could look for it.
   */
  async listMailThreads(query: {
    folder: MailFolder;
    transport?: MailTransport;
    search?: string;
  }): Promise<MailThread[]> {
    const s = getStore();
    const me = actingId();

    const mine = s.mailMessages.filter((m) => this.#mailVisible(m, me));
    const byThread = new Map<string, MailMessage[]>();
    for (const m of mine) {
      if (!this.#inFolder(m, me, query.folder)) continue;
      const list = byThread.get(m.threadId) ?? [];
      list.push(m);
      byThread.set(m.threadId, list);
    }

    let threads = s.mailThreads.filter((t) => byThread.has(t.id));
    if (query.transport)
      threads = threads.filter((t) => t.transport === query.transport);
    if (query.search?.trim()) {
      const needle = query.search.trim().toLowerCase();
      threads = threads.filter((t) => {
        if (t.subject.toLowerCase().includes(needle)) return true;
        if (t.participants.some((p) =>
          `${p.displayName} ${p.address}`.toLowerCase().includes(needle),
        ))
          return true;
        return (byThread.get(t.id) ?? []).some((m) =>
          m.body.toLowerCase().includes(needle),
        );
      });
    }
    return delay(
      [...threads].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    );
  }

  /** A message reaches you if you sent it or it was addressed to you. */
  #mailVisible(m: MailMessage, me: EmployeeId): boolean {
    return mailVisibleTo(m, me);
  }

  #inFolder(m: MailMessage, me: EmployeeId, folder: MailFolder): boolean {
    const trashed = m.trashedBy.includes(me);
    if (folder === "trash") return trashed;
    if (trashed) return false;
    if (folder === "drafts") return m.sentAt === null && m.from.employeeId === me;
    if (m.sentAt === null) return false;
    if (folder === "sent") return m.from.employeeId === me;
    /* Inbox: addressed to me, and not something I sent. */
    return m.from.employeeId !== me;
  }

  async listMailMessages(threadId: string): Promise<MailMessage[]> {
    const me = actingId();
    return delay(
      getStore()
        .mailMessages.filter(
          (m) => m.threadId === threadId && this.#mailVisible(m, me),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        /* The read that would otherwise disclose the blind copy. Everybody but
           the sender gets an empty list. */
        .map((m) => redactBcc(m, me)),
    );
  }

  async listMailAttachments(ids: string[]): Promise<MailAttachment[]> {
    return delay(getStore().mailAttachments.filter((a) => ids.includes(a.id)));
  }

  async getMailUnreadCount(): Promise<number> {
    const s = getStore();
    const me = actingId();
    return delay(
      s.mailMessages.filter(
        (m) =>
          this.#mailVisible(m, me) &&
          this.#inFolder(m, me, "inbox") &&
          !m.readBy.includes(me),
      ).length,
    );
  }

  async setMailRead(
    messageId: string,
    read: boolean,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const m = s.mailMessages.find((x) => x.id === messageId);
    if (!m) return fail("not_found", "Message not found.");
    if (!this.#mailVisible(m, actingId()))
      return fail("permission_denied", "That message is not yours.");
    m.readBy = read
      ? [...new Set([...m.readBy, actingId()])]
      : m.readBy.filter((id) => id !== actingId());
    persistStore();
    return delay(ok(undefined));
  }

  async setMailFlag(
    messageId: string,
    flag: "starred" | "trashed",
    on: boolean,
  ): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const m = s.mailMessages.find((x) => x.id === messageId);
    if (!m) return fail("not_found", "Message not found.");
    if (!this.#mailVisible(m, actingId()))
      return fail("permission_denied", "That message is not yours.");
    const key = flag === "starred" ? "starredBy" : "trashedBy";
    m[key] = on
      ? [...new Set([...m[key], actingId()])]
      : m[key].filter((id) => id !== actingId());
    persistStore();
    return delay(ok(undefined));
  }

  /**
   * Send, or keep as a draft when the transport cannot carry it.
   *
   * The transport is decided by the RECIPIENTS, never by the caller — see
   * `lib/mail/transport.ts`. An internal message is delivered here and
   * notified; an external one is handed to Gmail by the route above this, and
   * if Gmail is unavailable the message is kept with `deliveryError` set rather
   * than discarded. Somebody wrote it; losing it would be worse than not
   * sending it.
   */
  async sendMail(input: {
    to: MailParty[];
    cc?: MailParty[];
    bcc?: MailParty[];
    subject: string;
    body: string;
    attachmentIds?: string[];
    threadId?: string | null;
    /** Set by the Gmail route after a successful external send. */
    gmail?: { messageId: string; threadId: string } | null;
    deliveryError?: string | null;
  }): Promise<ActionResult<MailMessage>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const meEmp = s.employees.find((e) => e.id === actingId());
    if (!meEmp) return fail("not_found", "Employee not found.");

    const cc = input.cc ?? [];
    /* Bcc counts toward the transport exactly as To does: one external blind
       copy makes the whole message external. Deciding transport from the
       visible fields alone would send a message internally while one of its
       recipients sat outside the company. */
    const bcc = input.bcc ?? [];
    const transport = transportFor([...input.to, ...cc, ...bcc]);
    const refusal =
      recipientRefusal({ to: input.to, cc, bcc }) ??
      sendRefusal({
      recipients: [...input.to, ...cc, ...bcc],
      subject: input.subject,
      /* An internal send is never blocked by Gmail being down — the whole
         reason the transports are separate.
         For an EXTERNAL send the server has already decided: `/api/mail/send`
         resolves the connection through `getGmailConnection` and either returns
         Gmail's ids or the reason it refused. This used to read `!!input.gmail`
         as a stand-in for that route before it existed, which meant every
         external send was refused while Settings said "Connected". */
      gmailAvailable:
        transport === "internal" || !!input.gmail || !!input.deliveryError,
      });
    if (refusal && !input.deliveryError)
      return fail("validation_failed", refusal);

    tick();
    const from: MailParty = {
      kind: "employee",
      employeeId: meEmp.id,
      address: meEmp.email ?? `${meEmp.id}@cowork.local`,
      displayName: meEmp.displayName,
    };
    const now = nowIso();

    let thread = input.threadId
      ? (s.mailThreads.find((t) => t.id === input.threadId) ?? null)
      : null;
    if (!thread) {
      thread = {
        organisationId: actingOrganisationId(),
        id: nextId("mth"),
        subject: input.subject.trim(),
        participants: threadParticipants(from, input.to, cc),
        lastMessageAt: now,
        lastMessagePreview: input.body.slice(0, 140),
        messageCount: 0,
        transport,
        gmailThreadId: input.gmail?.threadId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      s.mailThreads.push(thread);
    }

    const message: MailMessage = {
      id: nextId("mmsg"),
      threadId: thread.id,
      transport,
      from,
      to: input.to,
      cc,
      bcc,
      subject: input.subject.trim(),
      body: input.body,
      attachmentIds: input.attachmentIds ?? [],
      readBy: [meEmp.id],
      starredBy: [],
      trashedBy: [],
      archivedBy: [],
      labels: [],
      sentAt: input.deliveryError ? null : now,
      createdAt: now,
      gmailMessageId: input.gmail?.messageId ?? null,
      deliveryError: input.deliveryError ?? null,
    };
    s.mailMessages.push(message);

    thread.lastMessageAt = now;
    thread.lastMessagePreview = input.body.slice(0, 140);
    thread.messageCount += 1;
    thread.updatedAt = now;

    /* Internal recipients get a Cowork notification. External ones get an
       email; notifying them here would be notifying nobody. */
    if (!input.deliveryError) {
      for (const p of [...input.to, ...cc, ...bcc]) {
        if (!p.employeeId) continue;
        this.#notify(
          p.employeeId,
          "mail_received",
          meEmp.displayName,
          input.subject.trim() || "(no subject)",
          "mail",
          thread.id,
        );
      }
    }
    persistStore();
    return delay(ok(message));
  }

  /**
   * Fold synced Gmail messages into the mailbox.
   *
   * Idempotent by `gmailMessageId`: a sync that overlaps a previous one — which
   * every delta sync does, because Gmail's `after:` filter has day granularity —
   * must not double every message it re-sees.
   *
   * Threads are keyed on Gmail's own thread id, so a reply arriving later joins
   * the conversation it belongs to instead of starting a new one.
   *
   * Addresses are resolved back to EMPLOYEES where the directory knows them, so
   * a colleague who happened to reply by email still shows with their profile
   * rather than as a stranger. That resolution belongs here, not in the parser:
   * only this layer knows who works here.
   */
  async importGmailMessages(
    messages: MailMessage[],
    /**
     * The address of the mailbox these came from.
     *
     * Required, and the fix for a bug that made every synced message vanish.
     * Visibility is decided by `employeeId`, and an imported party only gets one
     * by matching the workspace directory on `Employee.email`. Inbound Gmail is
     * addressed to `GmailConnection.email` — a DIFFERENT field, with no reason
     * to be equal. When they differed, messages imported cleanly, resolved to
     * external parties with a null `employeeId`, and were then invisible to the
     * person who had just synced them: "12 new messages", empty inbox.
     */
    mailboxAddress: string,
  ): Promise<ActionResult<{ added: number }>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const me = actingId();

    const directory = new Map(
      s.employees
        .filter((e) => e.email)
        .map((e) => [e.email!.toLowerCase(), e]),
    );
    const meEmp = s.employees.find((e) => e.id === me);
    const mailbox = mailboxAddress.trim().toLowerCase();

    const resolve = (p: MailParty): MailParty => {
      const address = p.address.toLowerCase();
      /* The connected mailbox is THIS person, whatever their Cowork address
         says. Checked before the directory so a connected Gmail that also
         appears in the directory still resolves to the right employee. */
      if (mailbox && address === mailbox && meEmp)
        return {
          kind: "employee",
          employeeId: meEmp.id,
          address: p.address,
          displayName: meEmp.displayName,
        };
      const emp = directory.get(address);
      return emp
        ? {
            kind: "employee",
            employeeId: emp.id,
            address: emp.email!,
            displayName: emp.displayName,
          }
        : p;
    };

    let added = 0;
    for (const raw of messages) {
      if (
        raw.gmailMessageId &&
        s.mailMessages.some((m) => m.gmailMessageId === raw.gmailMessageId)
      )
        continue;

      const from = resolve(raw.from);
      const to = raw.to.map(resolve);
      const cc = raw.cc.map(resolve);

      let thread = s.mailThreads.find((t) => t.id === raw.threadId);
      if (!thread) {
        thread = {
          organisationId: actingOrganisationId(),
          id: raw.threadId,
          subject: raw.subject,
          participants: [from, ...to, ...cc],
          lastMessageAt: raw.sentAt ?? raw.createdAt,
          lastMessagePreview: raw.body.slice(0, 140),
          messageCount: 0,
          transport: "gmail",
          gmailThreadId: raw.threadId.replace(/^gt-/, ""),
          createdAt: raw.createdAt,
          updatedAt: raw.createdAt,
        };
        s.mailThreads.push(thread);
      }

      s.mailMessages.push({
        ...raw,
        from,
        to,
        cc,
        /* A message this person sent is already read by them; one that arrived
           is not. Marking everything read would empty the unread count the
           moment a sync ran. */
        readBy: from.employeeId === me ? [me] : [],
      });
      added += 1;

      const at = raw.sentAt ?? raw.createdAt;
      if (at > thread.lastMessageAt) {
        thread.lastMessageAt = at;
        thread.lastMessagePreview = raw.body.slice(0, 140);
      }
      thread.messageCount += 1;
      thread.updatedAt = at;
    }

    if (added > 0) persistStore();
    return delay(ok({ added }));
  }

  /* ── Meeting lifecycle ──────────────────────────────────────────────────── */

  #nameOf(employeeId: EmployeeId): string {
    return (
      getStore().employees.find((e) => e.id === employeeId)?.displayName ??
      employeeId
    );
  }

  #meetingViewer(): MeetingViewer {
    return {
      employeeId: actingId(),
      seesOrganisation: this.#ctx()
        ? scopeFor(this.#ctx(), "task.view") === "organisation"
        : false,
      hierarchyIds: this.#closure(actingId()),
    };
  }

  #meetingEvent(m: Meeting, type: MeetingEventType, detail: string): void {
    getStore().meetingEvents.push({
      id: nextId("mev"),
      meetingId: m.id,
      type,
      actorId: actingId(),
      actorName: this.#nameOf(actingId()),
      detail,
      createdAt: nowIso(),
    });
  }

  #addMeetingParticipant(m: Meeting, employeeId: EmployeeId): void {
    const s = getStore();
    if (
      s.meetingParticipants.some(
        (p) => p.meetingId === m.id && p.employeeId === employeeId,
      )
    )
      return;
    s.meetingParticipants.push({
      id: nextId("mp"),
      meetingId: m.id,
      employeeId,
      role: employeeId === m.organiserId ? "organiser" : "participant",
      joinedAt: null,
      leftAt: null,
      attendanceStatus: "invited",
    });
  }

  async listMeetingParticipants(meetingId: string) {
    return delay(
      getStore().meetingParticipants.filter((p) => p.meetingId === meetingId),
    );
  }

  async listMeetingEvents(meetingId: string) {
    return delay(
      getStore()
        .meetingEvents.filter((e) => e.meetingId === meetingId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  /**
   * Open the room, or start the meeting, or end it.
   *
   * One method because they are one decision — "the organiser moved this along"
   * — and splitting it into three near-identical permission checks is how they
   * come to disagree. `manageRefusal` is the only gate, and it is the same
   * predicate the page renders its buttons from.
   */
  async setMeetingStatus(
    meetingId: string,
    next: "waiting" | "live" | "completed" | "cancelled" | "archived",
  ): Promise<ActionResult<Meeting>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const m = s.meetings.find((x) => x.id === meetingId);
    if (!m) return fail("not_found", "Meeting not found.");

    const refusal = manageRefusal(m, actingId());
    if (refusal) return fail("permission_denied", refusal);

    tick();
    if (next === "waiting" || next === "live") {
      /* The room name is minted once and kept. A name recomputed per call is a
         name the token route and the client can disagree about. */
      m.livekitRoomName ??= meetingRoomName(m.id);
    }
    if (next === "live" && !m.startedAt) m.startedAt = nowIso();
    if (next === "completed") {
      m.endedAt = nowIso();
      m.actualDurationSecs = m.startedAt
        ? Math.max(
            0,
            Math.round(
              (Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 1000,
            ),
          )
        : 0;
      /* Anybody still in the room is out of it now. */
      for (const p of s.meetingParticipants) {
        if (p.meetingId === m.id && p.joinedAt && !p.leftAt) {
          p.leftAt = m.endedAt;
          p.attendanceStatus = "left";
        } else if (p.meetingId === m.id && !p.joinedAt) {
          p.attendanceStatus = "absent";
        }
      }
    }
    m.status = next;

    const EVENT: Record<string, MeetingEventType> = {
      waiting: "opened",
      live: "started",
      completed: "ended",
      cancelled: "cancelled",
      archived: "archived",
    };
    this.#meetingEvent(m, EVENT[next], m.title);

    if (next === "live" || next === "cancelled") {
      for (const id of m.participantIds) {
        this.#notify(
          id,
          next === "live" ? "meeting_started" : "meeting_cancelled",
          next === "live" ? "Meeting started" : "Meeting cancelled",
          next === "live"
            ? `“${m.title}” has started.`
            : `“${m.title}” was cancelled.`,
          "meeting",
          m.id,
        );
      }
    }
    persistStore();
    return delay(ok(m));
  }

  /**
   * Open the room.
   *
   * Delegates to `setMeetingStatus("live")`, which already mints the room name
   * and stamps `startedAt` — the engine does the same two things in the other
   * order, creating the room and setting the status as a consequence. Written
   * as a delegation rather than a copy so the two cannot drift.
   *
   * Idempotent: a meeting already live returns as it stands.
   */
  async openMeetingRoom(meetingId: string): Promise<ActionResult<Meeting>> {
    const g = guard();
    if (g) return g;
    const m = getStore().meetings.find((x) => x.id === meetingId);
    if (!m) return fail("not_found", "Meeting not found.");
    if (m.status === "live") return delay(ok(m));
    return this.setMeetingStatus(meetingId, "live");
  }

  async setMeetingParticipants(
    meetingId: string,
    participantIds: EmployeeId[],
  ): Promise<ActionResult<Meeting>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const m = s.meetings.find((x) => x.id === meetingId);
    if (!m) return fail("not_found", "Meeting not found.");
    const refusal = manageRefusal(m, actingId());
    if (refusal) return fail("permission_denied", refusal);

    tick();
    const before = new Set(m.participantIds);
    const after = new Set(participantIds.filter((id) => id !== m.organiserId));
    m.participantIds = [...after];

    for (const id of after) {
      if (before.has(id)) continue;
      this.#addMeetingParticipant(m, id);
      this.#meetingEvent(m, "participant_added", this.#nameOf(id));
      this.#notify(
        id,
        "meeting_invitation",
        "Meeting invitation",
        `${this.#nameOf(actingId())} invited you to “${m.title}”.`,
        "meeting",
        m.id,
      );
    }
    for (const id of before) {
      if (after.has(id)) continue;
      s.meetingParticipants = s.meetingParticipants.filter(
        (p) => !(p.meetingId === m.id && p.employeeId === id),
      );
      this.#meetingEvent(m, "participant_removed", this.#nameOf(id));
    }
    persistStore();
    return delay(ok(m));
  }

  /**
   * Record that somebody entered or left the room.
   *
   * Called by the room itself on connect and disconnect. It records attendance;
   * it does not grant access — the token route is what decides whether somebody
   * gets into the room at all, and it refuses through the same `joinRefusal`.
   */
  async recordMeetingPresence(
    meetingId: string,
    present: boolean,
  ): Promise<ActionResult<MeetingParticipant>> {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const m = s.meetings.find((x) => x.id === meetingId);
    if (!m) return fail("not_found", "Meeting not found.");
    const refusal = joinRefusal(m, this.#meetingViewer());
    if (refusal) return fail("permission_denied", refusal);

    const p = s.meetingParticipants.find(
      (x) => x.meetingId === meetingId && x.employeeId === actingId(),
    );
    if (!p) return fail("not_found", "You are not on this invitation.");

    tick();
    if (present) {
      p.joinedAt ??= nowIso();
      p.leftAt = null;
      p.attendanceStatus = "joined";
      this.#meetingEvent(m, "joined", this.#nameOf(actingId()));
    } else {
      p.leftAt = nowIso();
      p.attendanceStatus = "left";
      this.#meetingEvent(m, "left", this.#nameOf(actingId()));
    }
    persistStore();
    return delay(ok(p));
  }

  /** Meetings attached to one task, for the task detail panel. */
  /* ── A task's own meeting ────────────────────────────────────────────────
   *
   * The fixture runs the REAL rules over the fixture's own tasks, so the flow
   * is exercised against genuine arithmetic rather than a hand-written result
   * that could drift from it.
   */

  async joinTaskMeeting(taskId: TaskId) {
    const s = getStore();
    const task = s.tasks.find((t) => t.id === taskId && !t.deletedAt);
    if (!task) {
      return fail("not_found", "That task could not be found.");
    }
    const me = String(actingId());

    /* The same membership rule the legacy repository applies, from the same
       module — a room joinable in one and refused in the other would make the
       prototype disagree with the product about who is in a conversation. */
    const refusal = taskJoinRefusal(
      {
        createdById: task.createdById ? String(task.createdById) : null,
        /* Assignment is its own record in the mock store, the way it is its own
           collection in the engine — the task does not carry the list. */
        assigneeIds: s.assignments
          .filter((a) => a.taskId === task.id)
          .map((a) => String(a.employeeId)),
        pendingAssigneeIds: task.pendingAssigneeIds.map(String),
        /* The people the task itself names as owing it a decision — the hours,
           or a cross-department gate. The meeting is usually the conversation
           that settles what they have to decide. */
        approverIds: task.approverIds.map(String),
      },
      me,
    );
    if (refusal) return fail("permission_denied", refusal);

    const nowIso = new Date().toISOString();

    /* Re-enter the session that is already running rather than opening a
       second one — two rooms for one task would split the attendance and
       credit each half separately. */
    /* The NEWEST open one, matching the engine and the panel — both of which
       read newest-first. Taking the first in insertion order picked the OLDEST,
       so with two sessions open a joiner was recorded against one while the
       panel displayed the other, and neither could see the other's attendance. */
    let session = [...s.taskMeetingSessions]
      .filter((x) => x.taskId === taskId && x.endedAt === null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .at(0);
    if (!session) {
      session = {
        id: `tms-${s.taskMeetingSessions.length + 1}`,
        taskId,
        startedAt: nowIso,
        endedAt: null,
        creditedSecs: 0,
        attendance: [],
        creditedTaskIds: [],
      };
      s.taskMeetingSessions.push(session);
    }
    /* A rejoin is a NEW span, not an edit of the old one — `creditableSecs`
       merges overlaps, so recording both is safe and losing one is not. */
    session.attendance.push({
      employeeId: me,
      joinedAt: nowIso,
      leftAt: null,
      /* The first beat — see `touchTaskMeeting`. A row nobody beats lapses. */
      lastSeenAt: nowIso,
    });

    return ok({
      sessionId: session.id,
      roomName: taskMeetingRoomName(String(taskId)),
      token: `mock-token-${taskId}-${me}`,
      url: "wss://mock.livekit.local",
    });
  }

  /** The beat that keeps a row alive — see the contract, and `departureOf`. */
  async touchTaskMeeting(input: { taskId: TaskId; sessionId: string }) {
    const s = getStore();
    const session = s.taskMeetingSessions.find((x) => x.id === input.sessionId);
    /* Silent on every miss. A dropped beat is not worth an error on a panel
       somebody is talking over, and a closed session is never beaten open. */
    if (!session || session.endedAt !== null) return ok(undefined);
    const me = String(actingId());
    const open = [...session.attendance]
      .reverse()
      .find((a) => a.employeeId === me && a.leftAt === null);
    if (open) open.lastSeenAt = new Date().toISOString();
    return ok(undefined);
  }

  async leaveTaskMeeting(input: { taskId: TaskId; sessionId: string }) {
    const s = getStore();
    const session = s.taskMeetingSessions.find((x) => x.id === input.sessionId);
    if (!session) return fail("not_found", "That meeting could not be found.");
    const me = String(actingId());
    const open = [...session.attendance]
      .reverse()
      .find((a) => a.employeeId === me && a.leftAt === null);
    if (open) open.leftAt = new Date().toISOString();

    /* Leaving LAST closes it — the ordinary way out of a meeting is closing the
       tab, which can record a departure and cannot await a settlement. Without
       this the room stays open for ever and nobody is credited.
       "Last" means nobody still BEATING, not nobody with an open row: a
       departure write that never landed leaves a row open permanently, and one
       of those used to hold the meeting open indefinitely. */
    if (
      session.endedAt === null &&
      roomIsEmpty(toMeetingAttendance(session.attendance), Date.now())
    ) {
      await this.endTaskMeeting(input);
    }
    return ok(undefined);
  }

  async endTaskMeeting(input: { taskId: TaskId; sessionId: string }) {
    const s = getStore();
    const session = s.taskMeetingSessions.find((x) => x.id === input.sessionId);
    if (!session) return fail("not_found", "That meeting could not be found.");
    const task = s.tasks.find((t) => t.id === session.taskId);
    if (!task) return fail("not_found", "That task could not be found.");

    /* **Closed by the LAST person out, not the first.** Everybody calls this on
       their way out; closing on the first call clamped everybody still talking
       to that instant, so a one-minute visitor ended a ten-minute meeting. */
    if (
      session.endedAt === null &&
      !roomIsEmpty(toMeetingAttendance(session.attendance), Date.now())
    ) {
      return ok({ creditedSecs: 0, creditedTaskIds: [] as string[] });
    }

    /* Closed ONCE. Everybody in the room calls this on the way out, and reading
       the clock each time stretched the span of anybody still marked present —
       so the meeting was worth more with every person who left.
       And closed AT THE MOMENT IT EMPTIED: a session abandoned by a closed tab
       is found up to `PRESENCE_TIMEOUT_MS` later, and closing at discovery
       would credit that gap to whoever happened to look. */
    const endedAtMs = session.endedAt
      ? Date.parse(session.endedAt)
      : (roomEmptiedAtMs(
          toMeetingAttendance(session.attendance),
          Date.now(),
        ) ?? Date.now());
    session.endedAt = new Date(endedAtMs).toISOString();

    /* Whose deadlines move: the RECEIVER of the work, not the creator.
       `pendingAssigneeIds` first, for the same reason the engine resolves it
       that way — a gated task holds no assignment record until it clears. */
    const assigneeId = String(
      task.pendingAssigneeIds[0] ??
        s.assignments.find((a) => a.taskId === session.taskId)?.employeeId ??
        "",
    );

    /** One person's live queue, shaped for the settlement. */
    const queueOf = (employeeId: string) =>
      s.tasks
        .filter((t) => !t.deletedAt)
        .map((t) => ({
          taskId: t.id,
          /* A task handed over with its hours agreed is live work, whatever
             gate it is waiting at — the same reading the legacy adapter takes
             in `settlementStatusOf`, because a cross-department task sits at a
             departmental gate for exactly as long as a kickoff is worth
             holding, and refusing it credit moved nothing for anybody. */
          status:
            t.status === "pending_approval" &&
            (t.deadline.currentWindowSecs ?? 0) > 0
              ? "assigned"
              : t.status,
          /* The person a task was handed to holds it, whether or not the
             assignment has been confirmed. `creditTargets` asks whose task it
             is, and on a gated task the answer is the pending assignee. */
          assigneeIds: [
            ...s.assignments
              .filter((a) => a.taskId === t.id)
              .map((a) => String(a.employeeId)),
            ...t.pendingAssigneeIds.map(String),
          ],
          /* Defensive: one task without meeting totals used to throw and take
             the whole settlement — everybody's credit — down with it. */
          totals: {
            firstStartedAtMs: t.meetings?.firstStartedAt
              ? Date.parse(t.meetings.firstStartedAt)
              : null,
            lastEndedAtMs: t.meetings?.lastEndedAt
              ? Date.parse(t.meetings.lastEndedAt)
              : null,
            totalSecs: t.meetings?.totalSecs ?? 0,
          },
          dueAtMs: t.deadline.dueAt ? Date.parse(t.deadline.dueAt) : null,
          windowSecs: t.deadline.currentWindowSecs ?? null,
          rank:
            s.assignments.find(
              (a) => a.taskId === t.id && a.employeeId === employeeId,
            )?.rank ?? 999,
        }));

    /* **One composition, shared with the engine.** `settleSession` decides what
       changes; this only persists it. Two implementations each composing the
       same three rules in their own order is how a mock and an engine come to
       disagree about a number somebody is scored on. */
    const iso = (ms: number | null) =>
      ms === null ? null : new Date(ms).toISOString();
    const meetingSession = {
      counterpartyId: String(task.createdById),
      endedAtMs,
      startedAtMs: Date.parse(session.startedAt),
      attendance: session.attendance.map((a) => ({
        employeeId: String(a.employeeId),
        joinedAtMs: Date.parse(a.joinedAt),
        leftAtMs: a.leftAt === null ? null : Date.parse(a.leftAt),
      })),
    };
    const alreadyCredited = session.creditedTaskIds.map(String);

    /* Two rules, and the TASK decides which — the same branch the engine makes,
       so a cross-department meeting cannot settle one way in the prototype and
       another in the product. */
    /* One queue per person who EARNED something. Both rules need it now: an
       ordinary meeting credits everybody in the room against their own queue,
       exactly as a cross-department one does, and only the window they are
       measured against differs. */
    const queuesFor = (credits: readonly { employeeId: string }[]) =>
      new Map(credits.map((c) => [c.employeeId, queueOf(c.employeeId)]));

    const settlement = task.isCrossDepartment
      ? settleCrossDeptSession({
          session: { ...meetingSession, receiverId: assigneeId },
          onTaskId: String(session.taskId),
          /* **The two sides of the work, in the room together** — OWNER
             DECISION, 17 Aug 2026. This used `creditsInWindow`, whose window
             is any two people, so a room holding two colleagues credited time
             on a task the assignee had never joined. Same window as the
             ordinary rule now; see `crossDeptWindow`. */
          tasksByEmployee: queuesFor(
            creditsIn(
              meetingSession,
              crossDeptWindow({ ...meetingSession, receiverId: assigneeId }),
            ),
          ),
          alreadyCredited,
        })
      : settleSession({
          session: meetingSession,
          onTaskId: String(session.taskId),
          receiverId: assigneeId,
          tasksByEmployee: queuesFor(
            creditsIn(
              meetingSession,
              ordinaryWindow({ ...meetingSession, receiverId: assigneeId }),
            ),
          ),
          alreadyCredited,
        });

    const creditedSecs = settlement.creditedSecs;
    session.creditedSecs = creditedSecs;

    for (const update of settlement.updates) {
      const target = s.tasks.find((t) => t.id === update.taskId);
      if (!target) continue;
      target.meetings = {
        firstStartedAt: iso(update.totals.firstStartedAtMs),
        lastEndedAt: iso(update.totals.lastEndedAtMs),
        totalSecs: update.totals.totalSecs,
      };
      /* The deadline moves through the SAME path a break or an offline span
         uses, so the History tab gets its `previous → why → current` row for
         free rather than growing a second way to say the same thing.
         **Either axis is enough.** Gated on the DATE alone, a task carrying a
         budget and no stored due date — the ordinary shape, since the date is
         derived from the receiver's queue — had its grown window discarded, and
         the window is what Expected completion is computed from. */
      if (update.newDueAtMs !== null || update.newWindowSecs !== null) {
        this.#extendDeadline({
          task: target,
          proposalId: null,
          previousWindowSecs: target.deadline.currentWindowSecs ?? 0,
          /* The settlement's figure, not one computed here — see
             `Settlement.newWindowSecs`. */
          newWindowSecs: update.newWindowSecs ?? target.deadline.currentWindowSecs,
          /* Written back UNCHANGED rather than as null when there is no date to
             move: `#extendDeadline` assigns `dueAt` outright, so passing null
             would erase a date this credit had no business touching. */
          newDueAt:
            update.newDueAtMs !== null
              ? new Date(update.newDueAtMs).toISOString()
              : target.deadline.dueAt,
          waivePenalty: false,
        });
        this.#event(target.id, "extension_decided", update.reason);
      }
      session.creditedTaskIds.push(update.taskId);
    }

    const targets = settlement.updates.map((u) => u.taskId);
    return ok({ creditedSecs, creditedTaskIds: targets });
  }

  async listTaskMeetingSessions(taskId: TaskId) {
    return delay(
      getStore()
        .taskMeetingSessions.filter((x) => x.taskId === taskId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    );
  }

  async listMeetingsForTask(taskId: TaskId) {
    const viewer = this.#meetingViewer();
    return delay(
      getStore()
        .meetings.filter((m) => m.taskId === taskId && canView(m, viewer))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    );
  }

  /* ── Notifications ──────────────────────────────────────────────────────── */

  async listNotifications(): Promise<Notification[]> {
    return delay(
      getStore()
        .notifications.filter((n) => n.recipientId === actingId())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async markNotificationRead(id: string): Promise<ActionResult<void>> {
    const n = getStore().notifications.find((x) => x.id === id);
    if (!n) return fail("not_found", "Notification not found.");
    tick();
    n.readAt = nowIso();
    return delay(ok(undefined));
  }

  async markAllNotificationsRead(): Promise<ActionResult<void>> {
    tick();
    getStore()
      .notifications.filter((n) => n.recipientId === actingId() && !n.readAt)
      .forEach((n) => {
        n.readAt = nowIso();
      });
    return delay(ok(undefined));
  }

  /* ── Focus Music ─────────────────────────────────────────────────────────
     Reads and writes the browser-backed music store. Deliberately the only
     persistent state in the prototype, and deliberately isolated: no method
     here touches a task, a timer, a work commit or the score ledger. */
  async listMusicFavourites() {
    return delay(musicStore.favourites());
  }
  async toggleMusicFavourite(item: MusicResult) {
    return delay(ok(musicStore.toggleFavourite(item)));
  }
  async getMusicQueue() {
    return delay(musicStore.queue());
  }
  async saveMusicQueue(queue: MusicQueue) {
    musicStore.saveQueue(queue);
    return delay(ok(undefined));
  }
  async listMusicSearches() {
    return delay(musicStore.searches());
  }
  async recordMusicSearch(query: string) {
    musicStore.recordSearch(query);
    return delay(ok(undefined));
  }
  async clearMusicSearches() {
    musicStore.clearSearches();
    return delay(ok(undefined));
  }
  async listMusicPlayed() {
    return delay(musicStore.played());
  }
  async recordMusicPlayed(item: MusicResult) {
    musicStore.recordPlayed(item);
    return delay(ok(undefined));
  }
  async getMusicPreferences() {
    return delay(musicStore.preferences());
  }
  async saveMusicPreferences(patch: Partial<MusicPreferences>) {
    return delay(ok(musicStore.savePreferences(patch)));
  }
  async listMusicPlaylists() {
    return delay(musicStore.playlists());
  }
  async createMusicPlaylist(name: string) {
    return delay(ok(musicStore.createPlaylist(name)));
  }
  async renameMusicPlaylist(id: string, name: string) {
    return delay(ok(musicStore.renamePlaylist(id, name)));
  }
  async deleteMusicPlaylist(id: string) {
    return delay(ok(musicStore.deletePlaylist(id)));
  }
  async addToMusicPlaylist(id: string, item: MusicResult) {
    return delay(ok(musicStore.addToPlaylist(id, item)));
  }
  async removeFromMusicPlaylist(id: string, trackId: string) {
    return delay(ok(musicStore.removeFromPlaylist(id, trackId)));
  }
  async moveMusicPlaylistTrack(id: string, from: number, to: number) {
    return delay(ok(musicStore.movePlaylistTrack(id, from, to)));
  }

  /* ── Live monitoring ────────────────────────────────────────────────────── */

  /**
   * Six reads, each answering for one provider.
   *
   * They are gated by the reporting chain rather than by a role name: a
   * manager may monitor the people beneath them and nobody else, which is the
   * same boundary the score's comparative view uses. The check lives here
   * because the repository is the only layer that can enforce it — a component
   * that decides for itself who it may render is a permission bug waiting for
   * a second caller.
   */
  #monitorable(id: EmployeeId): Employee | null {
    const s = getStore();
    if (!this.#closure(actingId()).includes(id)) return null;
    return s.employees.find((e) => e.id === id) ?? null;
  }

  async getMonitoringSubject(id: EmployeeId) {
    const e = this.#monitorable(id);
    return delay(e ? monitoring.monitoringSubject(e) : null);
  }
  async listActivityEvents(id: EmployeeId, limit = 40) {
    if (!this.#monitorable(id)) return delay([]);
    return delay(monitoring.activityEvents(id, limit));
  }
  async getMonitoringPerformance(id: EmployeeId) {
    if (!this.#monitorable(id)) return delay(null);
    return delay(monitoring.monitoringPerformance(id));
  }
  async getDailySummary(id: EmployeeId) {
    if (!this.#monitorable(id)) return delay(null);
    return delay(monitoring.dailySummary(id));
  }
  async getDeviceInfo(id: EmployeeId) {
    if (!this.#monitorable(id)) return delay(null);
    return delay(monitoring.deviceInfo(id));
  }
  async listObservations(id: EmployeeId) {
    if (!this.#monitorable(id)) return delay([]);
    return delay(monitoring.observations(id));
  }
  async listInterventions(id: EmployeeId) {
    if (!this.#monitorable(id)) return delay([]);
    return delay(monitoring.interventions(id));
  }

  /* The team rows and their totals are scoped to the DIRECT reports rather than
     the full closure: this is the "who is working right now" list, and a
     skip-level's grandchildren are a different question with a different
     surface. */
  #directReports(): Employee[] {
    const s = getStore();
    const ids = s.reporting
      .filter((r) => r.managerId === actingId() && !r.effectiveTo)
      .map((r) => r.employeeId);
    return s.employees.filter((e) => ids.includes(e.id));
  }

  async listTeamMonitoring() {
    return delay(this.#directReports().map(monitoring.teamRow));
  }
  async getTeamAnalytics() {
    return delay(
      monitoring.teamAnalytics(this.#directReports().map(monitoring.teamRow)),
    );
  }

  /* ── Administration ─────────────────────────────────────────────────────── */

  /**
   * Every write below is gated on a capability and then on a structural
   * invariant, in that order. The invariants are the part worth stating,
   * because they are what stops a configurable system from being configured
   * into an unsafe one:
   *
   *  · Nobody may create or hold a role at or above their own administrative
   *    level. Without this, "make roles editable" is a privilege-escalation
   *    feature — anyone with role editing could mint themselves an owner.
   *  · The reporting graph stays acyclic. Legacy had no cycle check at all, and
   *    a cycle makes the closure walk, the approval chain and score visibility
   *    all wrong at once.
   *  · At least one person keeps `people.change_role`. Removing the last
   *    administrator locks everyone out of the system permanently.
   */

  async createRole(input: CreateRoleInput): Promise<ActionResult<Role>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_role");
    if (denied) return denied;
    const s = getStore();

    if (!input.displayName.trim())
      return fail("validation_failed", "A role needs a name.", "displayName");
    if (s.roles.some((r) => r.key === input.key))
      return fail("conflict", "That role key is already used.", "key");

    const ceiling = this.#levelOf(actingId());
    if (input.administrativeLevel >= ceiling)
      return fail(
        "permission_denied",
        `You can only create roles below your own level (${ceiling}).`,
        "administrativeLevel",
      );

    const role: Role = {
      organisationId: actingOrganisationId(),
      id: nextId("role"),
      key: input.key,
      displayName: input.displayName.trim(),
      archetype: input.archetype,
      administrativeLevel: input.administrativeLevel,
      isSystem: false,
      permissions: input.permissions.map((p, i) => ({
        id: `${nextId("perm")}-${i}`,
        capability: p.capability,
        scope: p.scope,
      })),
    };
    tick();
    s.roles.push(role);
    return delay(ok(role));
  }

  async updateRole(id: RoleId, patch: UpdateRoleInput) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_role");
    if (denied) return denied;
    const s = getStore();
    const role = s.roles.find((r) => r.id === id);
    if (!role) return fail("not_found", "Role not found.");

    const ceiling = this.#levelOf(actingId());
    if (role.administrativeLevel >= ceiling)
      return fail(
        "permission_denied",
        "You cannot edit a role at or above your own level.",
      );
    if (
      patch.administrativeLevel !== undefined &&
      patch.administrativeLevel >= ceiling
    )
      return fail(
        "permission_denied",
        `Level must stay below your own (${ceiling}).`,
        "administrativeLevel",
      );

    tick();
    Object.assign(role, patch);
    return delay(ok(role));
  }

  async deleteRole(id: RoleId): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_role");
    if (denied) return denied;
    const s = getStore();
    const role = s.roles.find((r) => r.id === id);
    if (!role) return fail("not_found", "Role not found.");
    if (role.isSystem)
      return fail(
        "invalid_state",
        "System roles can be edited but not deleted — something has to remain.",
      );
    const holders = s.employees.filter((e) => e.roleIds.includes(id));
    if (holders.length)
      return fail(
        "conflict",
        `${holders.length} ${holders.length === 1 ? "person holds" : "people hold"} this role. Reassign them first.`,
      );
    tick();
    s.roles = s.roles.filter((r) => r.id !== id);
    return delay(ok(undefined));
  }

  async setRolePermissions(
    id: RoleId,
    permissions: { capability: Capability; scope: Scope }[],
  ) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_role");
    if (denied) return denied;
    const s = getStore();
    const role = s.roles.find((r) => r.id === id);
    if (!role) return fail("not_found", "Role not found.");

    const ceiling = this.#levelOf(actingId());
    if (role.administrativeLevel >= ceiling)
      return fail(
        "permission_denied",
        "You cannot change permissions on a role at or above your own level.",
      );

    /* You cannot grant what you do not hold. Otherwise role editing is a
       self-service escalation: grant `people.delete` to a role, assign it to
       yourself, done. */
    const mine = new Set(
      this.#ctx()
        .roles.filter((r) =>
          s.employees.find((e) => e.id === actingId())?.roleIds.includes(r.id),
        )
        .flatMap((r) => r.permissions.map((p) => p.capability)),
    );
    const overreach = permissions
      .map((p) => p.capability)
      .filter((c) => !mine.has(c));
    if (overreach.length)
      return fail(
        "permission_denied",
        `You cannot grant a capability you do not hold yourself: ${overreach.join(", ")}.`,
      );

    tick();
    role.permissions = permissions.map((p, i) => ({
      id: `${role.id}-p${i}`,
      capability: p.capability,
      scope: p.scope,
    }));
    return delay(ok(role));
  }

  async assignRoles(employeeId: EmployeeId, roleIds: RoleId[]) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_role", employeeId);
    if (denied) return denied;
    const s = getStore();
    const emp = s.employees.find((e) => e.id === employeeId);
    if (!emp) return fail("not_found", "Employee not found.");

    const ceiling = this.#levelOf(actingId());
    const granting = s.roles.filter((r) => roleIds.includes(r.id));
    const tooHigh = granting.find((r) => r.administrativeLevel >= ceiling);
    if (tooHigh)
      return fail(
        "permission_denied",
        `You cannot grant ${tooHigh.displayName} — it is at or above your own level.`,
      );

    /* Never remove the last administrator. */
    const adminCap: Capability = "people.change_role";
    const stillAdmin = s.employees.filter((e) => {
      const ids = e.id === employeeId ? roleIds : e.roleIds;
      return s.roles.some(
        (r) =>
          ids.includes(r.id) &&
          r.permissions.some((p) => p.capability === adminCap),
      );
    });
    if (stillAdmin.length === 0)
      return fail(
        "invalid_state",
        "This would leave nobody able to administer roles. Grant it to someone else first.",
      );

    tick();
    emp.roleIds = [...roleIds];
    return delay(ok(emp));
  }

  /* ── Employees ──────────────────────────────────────────────────────────── */

  async createEmployee(input: {
    firstName: string;
    lastName: string;
    email: string;
    employeeCode: string;
    departmentId: string | null;
    designation: string | null;
    roleIds: RoleId[];
    managerId: EmployeeId | null;
  }): Promise<ActionResult<Employee>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.create");
    if (denied) return denied;
    const s = getStore();
    if (!input.firstName.trim() || !input.lastName.trim())
      return fail(
        "validation_failed",
        "A first and last name are required.",
        "firstName",
      );
    if (s.employees.some((e) => e.employeeCode === input.employeeCode))
      return fail(
        "conflict",
        "That employee code is already used.",
        "employeeCode",
      );

    /* Validated and de-duplicated HERE, not only in the form. The address is
       what an invitation is sent to and what an account is later matched on, so
       two people sharing one would make "invite Priya" ambiguous — and the
       ambiguity would only surface at the moment somebody tried to sign in. */
    const email = input.email.trim().toLowerCase();
    if (!email)
      return fail("validation_failed", "Enter a work email address.", "email");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return fail(
        "validation_failed",
        "That does not look like an email address.",
        "email",
      );
    if (s.employees.some((e) => e.email?.toLowerCase() === email))
      return fail(
        "conflict",
        "Somebody in this workspace already has that email address.",
        "email",
      );

    /* You cannot create somebody at or above your own level, for the same
       reason you cannot promote yourself: role editing would otherwise be a
       one-step escalation. */
    const ceiling = this.#levelOf(actingId());
    const tooHigh = s.roles.find(
      (r) => input.roleIds.includes(r.id) && r.administrativeLevel >= ceiling,
    );
    if (tooHigh)
      return fail(
        "permission_denied",
        `You cannot grant ${tooHigh.displayName} — it is at or above your own level.`,
      );

    tick();
    const dept = s.departments.find((d) => d.id === input.departmentId);
    const emp: Employee = {
      organisationId: actingOrganisationId(),
      id: nextId("e"),
      /* Somebody added by an administrator never founded the organisation. */
      isFounder: false,
      userId: nextId("u"),
      employeeCode: input.employeeCode,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      displayName: `${input.firstName.trim()} ${input.lastName.trim()}`,
      initials: `${input.firstName.trim()[0]}${input.lastName.trim()[0]}`,
      /* Nobody arrives with a face. They set one, or they keep the monogram. */
      profilePictureUrl: null,
      email,
      hue: (s.employees.length % 6) as 0 | 1 | 2 | 3 | 4 | 5,
      departmentId: input.departmentId,
      departmentName: dept?.name ?? null,
      designation: input.designation,
      roleIds: input.roleIds.length ? [...input.roleIds] : ["role-employee"],
      timezone: "Asia/Kolkata",
      workCalendarId: "cal-standard",
      joinedAt: nowIso(),
      exitedAt: null,
    };
    s.employees.push(emp);

    if (input.managerId) {
      s.reporting.push({
        organisationId: actingOrganisationId(),
        id: nextId("rel"),
        employeeId: emp.id,
        managerId: input.managerId,
        type: "primary",
        effectiveFrom: nowIso(),
        effectiveTo: null,
        createdBy: actingId(),
        createdAt: nowIso(),
      });
    }
    return delay(ok(emp));
  }

  async updateEmployee(
    id: EmployeeId,
    patch: Partial<
      Pick<
        Employee,
        "firstName" | "lastName" | "designation" | "timezone" | "email"
      >
    >,
  ) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_reporting", id);
    if (denied) return denied;
    const s = getStore();
    const emp = s.employees.find((e) => e.id === id);
    if (!emp) return fail("not_found", "Employee not found.");

    /* The same address rule as creation, applied to the same field. Two entry
       points enforcing one invariant differently is how a duplicate gets in
       through the side door. */
    if (patch.email !== undefined) {
      const email = (patch.email ?? "").trim().toLowerCase();
      if (!email)
        return fail("validation_failed", "Enter a work email address.", "email");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return fail(
          "validation_failed",
          "That does not look like an email address.",
          "email",
        );
      if (s.employees.some((e) => e.id !== id && e.email?.toLowerCase() === email))
        return fail(
          "conflict",
          "Somebody in this workspace already has that email address.",
          "email",
        );
      patch = { ...patch, email };
    }

    tick();
    Object.assign(emp, patch);
    emp.displayName = `${emp.firstName} ${emp.lastName}`;
    emp.initials = `${emp.firstName[0] ?? ""}${emp.lastName[0] ?? ""}`;
    return delay(ok(emp));
  }

  async setEmployeeActive(id: EmployeeId, active: boolean) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.deactivate", id);
    if (denied) return denied;
    const s = getStore();
    const emp = s.employees.find((e) => e.id === id);
    if (!emp) return fail("not_found", "Employee not found.");

    if (!active) {
      /* Deactivating somebody who still has reports would silently orphan them
         — their approvals would resolve to a person who is gone. */
      const reports = s.reporting.filter(
        (r) => r.managerId === id && !r.effectiveTo,
      );
      if (reports.length)
        return fail(
          "invalid_state",
          `${emp.displayName} still manages ${reports.length} ${reports.length === 1 ? "person" : "people"}. Move them first.`,
        );
    }

    tick();
    /* Deactivation, not deletion. Every submission, review and ledger entry
       cites this person; removing the record would orphan all of it. */
    emp.exitedAt = active ? null : nowIso();
    return delay(ok(emp));
  }

  /* ── Company policies ───────────────────────────────────────────────────── */

  async createConductPolicy(input: {
    name: string;
    percent: number;
    description: string;
    severity: ConductSeverity | null;
    scope: "global" | "department";
    departmentIds: string[];
  }) {
    const g = guard();
    if (g) return g;
    /**
     * **Written by a manager, not by a permission.** Anybody with somebody
     * reporting to them may write a conduct rule — it applies to nobody until
     * their own manager approves it, which is where the authority actually
     * sits. Gating the writing instead would mean the rules a team works to
     * could only be proposed by people who do not manage anybody.
     */
    const s = getStore();
    const me = actingId();
    const hasReports = s.reporting.some(
      (r) => r.managerId === me && !r.effectiveTo,
    );
    if (!hasReports && this.#deny("score.configure")) {
      return fail(
        "permission_denied",
        "Only a manager can write a conduct rule — it is approved by your own manager before it applies to anybody.",
      );
    }
    if (!input.name.trim())
      return fail("validation_failed", "A policy needs a name.", "name");
    if (!(input.percent > 0) || input.percent > 100) {
      return fail(
        "validation_failed",
        "The cut must be a percentage above zero and no more than 100.",
        "percent",
      );
    }

    /* The approver is named now, from the line — so the decision belongs to one
       person who can be told about it rather than to a role. */
    const author = s.employees.find((e) => e.id === me) ?? null;
    const approver =
      s.employees.find((e) => e.id === this.#primaryManagerOf(me)) ?? null;

    const policy: ConductPolicy = {
      organisationId: actingOrganisationId(),
      id: nextId("pol"),
      name: input.name.trim(),
      percent: input.percent,
      description: input.description,
      severity: input.severity,
      scope: input.scope,
      departmentIds: input.scope === "department" ? input.departmentIds : [],
      isActive: true,
      /* Always pending, including one written by an administrator. A rule that
         takes points off people is not something to nod through because of who
         wrote it — that is what an approval step is for. */
      status: "pending",
      createdById: me,
      createdByName: author?.displayName ?? null,
      approverId: approver?.id ?? null,
      approverName: approver?.displayName ?? null,
      decidedByName: null,
      rejectedReason: null,
    };
    tick();
    s.conductPolicies.push(policy);
    return delay(ok(policy));
  }

  /* ── C3 · the four acts ─────────────────────────────────────────────────── */

  /**
   * Whose reporting line answers for this person.
   *
   * The live line — an entry with no `effectiveTo` — rather than a field on the
   * employee, because a reorganisation writes a new line and closes the old one
   * rather than editing a pointer, and reading a closed one would answer with
   * the manager somebody used to have.
   */
  #primaryManagerOf(employeeId: string): string | null {
    return (
      getStore().reporting.find(
        (r) => r.employeeId === employeeId && !r.effectiveTo && r.type === "primary",
      )?.managerId ?? null
    );
  }

  async listConductApprovals() {
    const g = guard();
    if (g) return [];
    const s = getStore();
    const me = actingId();
    const admin = !this.#deny("score.configure");
    return delay(
      s.conductPolicies.filter(
        (p) =>
          p.status === "pending" &&
          /* Addressed to one person. An administrator additionally sees the
             ones the line cannot answer — written by somebody with nobody
             above them — because otherwise those wait for ever. */
          (p.approverId === me || (admin && !p.approverId)),
      ),
    );
  }

  async decideConductPolicy(
    id: string,
    decision: "approve" | "reject",
    reason?: string,
  ) {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const policy = s.conductPolicies.find((p) => p.id === id);
    if (!policy) return fail("not_found", "Rule not found.");

    const me = actingId();
    const refusal = approvalRefusal({
      actor: { employeeId: me, isAdmin: !this.#deny("score.configure") },
      authorId: policy.createdById ?? "",
      approverId: policy.approverId,
      status: policy.status,
    });
    if (refusal) return fail("permission_denied", refusal);

    tick();
    policy.status = decision === "approve" ? "approved" : "rejected";
    policy.decidedByName =
      s.employees.find((e) => e.id === me)?.displayName ?? null;
    policy.rejectedReason = decision === "reject" ? (reason ?? "").trim() : null;
    return delay(ok(undefined));
  }

  async applyConductPolicy(input: {
    employeeId: EmployeeId;
    policyId: string;
    reason: string;
  }) {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const policy = s.conductPolicies.find((p) => p.id === input.policyId);
    if (!policy) return fail("not_found", "Rule not found.");
    const subject = s.employees.find((e) => e.id === input.employeeId);
    if (!subject) return fail("not_found", "Employee not found.");

    const me = actingId();
    const refusal = applyRefusal({
      actor: { employeeId: me, isAdmin: !this.#deny("score.configure") },
      subjectId: subject.id,
      subjectManagerId: this.#primaryManagerOf(subject.id),
      ruleStatus: policy.status,
    });
    if (refusal) return fail("permission_denied", refusal);

    tick();
    s.conductEvents.push({
      id: nextId("ce"),
      employeeId: subject.id,
      policyId: policy.id,
      policyName: policy.name,
      severity: policy.severity ?? "minor",
      description: input.reason.trim(),
      occurredOn: nowIso().slice(0, 10),
      appliedById: me,
      appliedByName: s.employees.find((e) => e.id === me)?.displayName ?? "",
      appliedAt: nowIso(),
      disputeStatus: "none",
      disputeNote: null,
      reversalLedgerEntryId: null,
    });
    return delay(ok(undefined));
  }

  async requestConductRecheck(input: { entryId: string; note: string }) {
    const g = guard();
    if (g) return g;
    const event = getStore().conductEvents.find((c) => c.id === input.entryId);
    if (!event) return fail("not_found", "That deduction was not found.");
    /* Your own record only. Disputing somebody else's is not a thing to have
       a message for — it is a thing to be unable to do. */
    if (event.employeeId !== actingId())
      return fail("permission_denied", "You can only dispute your own deductions.");
    if (event.disputeStatus === "overturned")
      return fail("validation_failed", "This deduction was already reversed.");
    tick();
    event.disputeStatus = "requested";
    event.disputeNote = input.note.trim();
    return delay(ok(undefined));
  }

  async listConductDisputes() {
    const g = guard();
    if (g) return [];
    const s = getStore();
    const me = actingId();
    const admin = !this.#deny("score.configure");
    return delay(
      s.conductEvents
        .filter((c) => c.disputeStatus === "requested")
        .filter((c) => {
          return admin || this.#primaryManagerOf(c.employeeId) === me;
        })
        .map((c) => ({
          employeeId: c.employeeId,
          employeeName:
            s.employees.find((e) => e.id === c.employeeId)?.displayName ?? c.employeeId,
          entryId: c.id,
          policyName: c.policyName,
          percent:
            s.conductPolicies.find((p) => p.id === c.policyId)?.percent ?? 0,
          date: c.occurredOn,
          requestNote: c.disputeNote,
        })),
    );
  }

  async decideConductRecheck(input: {
    employeeId: EmployeeId;
    entryId: string;
    overturn: boolean;
    note: string;
  }) {
    const g = guard();
    if (g) return g;
    const s = getStore();
    const event = s.conductEvents.find((c) => c.id === input.entryId);
    if (!event) return fail("not_found", "That deduction was not found.");
    const subject = s.employees.find((e) => e.id === event.employeeId);

    const me = actingId();
    if (
      !mayDecideFor({
        actor: { employeeId: me, isAdmin: !this.#deny("score.configure") },
        subjectId: event.employeeId,
        subjectManagerId: this.#primaryManagerOf(event.employeeId),
      })
    ) {
      return fail(
        "permission_denied",
        "Only their own primary manager, or an administrator, can decide this recheck.",
      );
    }

    tick();
    /* Overturned means the EMPLOYEE was right and the deduction is reversed.
       Upheld means it stands. Neither word is legacy's, deliberately: its own
       term is "confirm", which reads as confirming the deduction. */
    event.disputeStatus = input.overturn ? "overturned" : "upheld";
    event.disputeNote = input.note.trim() || event.disputeNote;
    return delay(ok(undefined));
  }

  async updateConductPolicy(
    id: string,
    patch: Partial<Omit<ConductPolicy, "id">>,
  ) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("score.configure");
    if (denied) return denied;
    const policy = getStore().conductPolicies.find((p) => p.id === id);
    if (!policy) return fail("not_found", "Policy not found.");
    if (patch.name !== undefined && !patch.name.trim())
      return fail("validation_failed", "A policy needs a name.", "name");
    tick();
    Object.assign(policy, patch);
    if (policy.scope === "global") policy.departmentIds = [];
    return delay(ok(policy));
  }

  /* ── Departments ────────────────────────────────────────────────────────── */

  async listDepartments() {
    return delay([...getStore().departments]);
  }

  async createDepartment(input: {
    name: string;
    hodEmployeeId: EmployeeId | null;
    parentDepartmentId: string | null;
  }) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_reporting");
    if (denied) return denied;
    if (!input.name.trim())
      return fail("validation_failed", "A department needs a name.", "name");
    const s = getStore();
    const dept: Department = {
      organisationId: actingOrganisationId(),
      id: input.name.trim().toLowerCase().replace(/\s+/g, "-"),
      name: input.name.trim(),
      hodEmployeeId: input.hodEmployeeId,
      parentDepartmentId: input.parentDepartmentId,
      isActive: true,
    };
    if (s.departments.some((d) => d.id === dept.id))
      return fail("conflict", "A department with that name exists.", "name");
    tick();
    s.departments.push(dept);
    return delay(ok(dept));
  }

  async updateDepartment(
    id: string,
    patch: Partial<
      Pick<
        Department,
        "name" | "hodEmployeeId" | "parentDepartmentId" | "isActive"
      >
    >,
  ) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_reporting");
    if (denied) return denied;
    const s = getStore();
    const dept = s.departments.find((d) => d.id === id);
    if (!dept) return fail("not_found", "Department not found.");
    if (patch.parentDepartmentId === id)
      return fail(
        "validation_failed",
        "A department cannot be its own parent.",
      );
    tick();
    Object.assign(dept, patch);
    return delay(ok(dept));
  }

  async setEmployeeDepartment(
    employeeId: EmployeeId,
    departmentId: string | null,
  ) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_reporting", employeeId);
    if (denied) return denied;
    const s = getStore();
    const emp = s.employees.find((e) => e.id === employeeId);
    if (!emp) return fail("not_found", "Employee not found.");
    const dept = s.departments.find((d) => d.id === departmentId);
    tick();
    emp.departmentId = departmentId;
    emp.departmentName = dept?.name ?? null;
    return delay(ok(emp));
  }

  /* ── Reporting lines ────────────────────────────────────────────────────── */

  async setReportingManager(
    employeeId: EmployeeId,
    managerId: EmployeeId | null,
    type: ReportingRelationship["type"] = "primary",
  ) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("people.change_reporting", employeeId);
    if (denied) return denied;
    const s = getStore();
    if (!s.employees.some((e) => e.id === employeeId))
      return fail("not_found", "Employee not found.");
    if (managerId === employeeId)
      return fail("validation_failed", "Nobody reports to themselves.");

    if (managerId) {
      if (!s.employees.some((e) => e.id === managerId))
        return fail("not_found", "That manager does not exist.");
      /* Cycle detection — legacy had none, and a cycle breaks the closure walk,
         the approval chain and score visibility simultaneously. */
      let cur: EmployeeId | null = managerId;
      for (let i = 0; i < 50 && cur; i++) {
        if (cur === employeeId)
          return fail(
            "validation_failed",
            "That would create a reporting loop.",
            "managerId",
          );
        cur =
          s.reporting.find(
            (r) =>
              r.employeeId === cur && !r.effectiveTo && r.type === "primary",
          )?.managerId ?? null;
      }
    }

    tick();
    /* Close the old line rather than overwrite it. A score computed last
       quarter must stay visible to whoever managed the person THEN — which is
       the whole reason the relationship is time-bounded. */
    for (const r of s.reporting) {
      if (r.employeeId === employeeId && r.type === type && !r.effectiveTo) {
        r.effectiveTo = nowIso();
      }
    }
    if (!managerId) return delay(ok(null));

    const rel: ReportingRelationship = {
      organisationId: actingOrganisationId(),
      id: nextId("rel"),
      employeeId,
      managerId,
      type,
      effectiveFrom: nowIso(),
      effectiveTo: null,
      createdBy: actingId(),
      createdAt: nowIso(),
    };
    s.reporting.push(rel);
    return delay(ok(rel));
  }

  /* ── Approval workflows ─────────────────────────────────────────────────── */

  async listWorkflows() {
    return delay([...getStore().workflows]);
  }

  async createWorkflow(input: { name: string; trigger: WorkflowTrigger }) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("integration.configure");
    if (denied) return denied;
    if (!input.name.trim())
      return fail("validation_failed", "A workflow needs a name.", "name");
    const s = getStore();
    const wf: ApprovalWorkflow = {
      organisationId: actingOrganisationId(),
      id: nextId("wf"),
      name: input.name.trim(),
      description: "",
      trigger: input.trigger,
      stages: [],
      appliesTo: { departmentIds: [], crossDepartmentOnly: false },
      order: 50,
      isActive: false,
      isSystem: false,
    };
    tick();
    s.workflows.push(wf);
    return delay(ok(wf));
  }

  async updateWorkflow(
    id: string,
    patch: Partial<
      Pick<
        ApprovalWorkflow,
        "name" | "description" | "isActive" | "order" | "appliesTo"
      >
    >,
  ) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("integration.configure");
    if (denied) return denied;
    const s = getStore();
    const wf = s.workflows.find((w) => w.id === id);
    if (!wf) return fail("not_found", "Workflow not found.");
    if (patch.isActive && wf.stages.length === 0)
      return fail(
        "invalid_state",
        "A workflow with no stages would approve everything automatically.",
      );
    tick();
    Object.assign(wf, patch);
    return delay(ok(wf));
  }

  async setWorkflowStages(id: string, stages: Omit<ApprovalStage, "id">[]) {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("integration.configure");
    if (denied) return denied;
    const s = getStore();
    const wf = s.workflows.find((w) => w.id === id);
    if (!wf) return fail("not_found", "Workflow not found.");
    if (stages.some((st) => !st.name.trim()))
      return fail("validation_failed", "Every stage needs a name.");
    tick();
    wf.stages = stages.map((st, i) => ({
      ...st,
      id: `${wf.id}-s${i}`,
      order: i + 1,
    }));
    if (wf.stages.length === 0) wf.isActive = false;
    return delay(ok(wf));
  }

  async deleteWorkflow(id: string): Promise<ActionResult<void>> {
    const g = guard();
    if (g) return g;
    const denied = this.#deny("integration.configure");
    if (denied) return denied;
    const s = getStore();
    const wf = s.workflows.find((w) => w.id === id);
    if (!wf) return fail("not_found", "Workflow not found.");
    if (wf.isSystem)
      return fail(
        "invalid_state",
        "System workflows can be edited or deactivated, but not deleted.",
      );
    tick();
    s.workflows = s.workflows.filter((w) => w.id !== id);
    return delay(ok(undefined));
  }

  async previewWorkflow(workflowId: string, subjectId: EmployeeId) {
    const s = getStore();
    const wf = s.workflows.find((w) => w.id === workflowId);
    if (!wf) return delay([]);
    const subjectDept =
      s.employees.find((e) => e.id === subjectId)?.departmentId ?? null;
    return delay(
      resolveWorkflow(this.#resolveCtx(), wf, subjectId, subjectDept),
    );
  }

  /* ── Help ───────────────────────────────────────────────────────────────── */

  async searchHelp(question: string, category?: HelpCategory) {
    return delay(searchHelp(question, category ? { category } : {}));
  }

  async listHelpArticles(category?: HelpCategory) {
    return delay(
      category
        ? HELP_ARTICLES.filter((a) => a.category === category)
        : [...HELP_ARTICLES],
    );
  }

  async getHelpArticle(id: string) {
    return delay(HELP_ARTICLES.find((a) => a.id === id) ?? null);
  }

  /* ── Demo control ───────────────────────────────────────────────────────── */

  /**
   * Act as someone else. Development only — see `lib/config/profileSwitcher`.
   *
   * This is the mock standing in for a session. It cannot grant anything: the
   * permission layer resolves from whoever this names, using that person's own
   * roles, so an Employee profile really does lose admin access.
   */
  /**
   * Provision (or find) the employee an authenticated session acts as.
   *
   * Called once when a session is established. The lookup comes first and is
   * the common path — signing in again must not mint a second record — and the
   * creation branch runs only for an account that has never had a workspace
   * identity, which is every first administrator.
   *
   * The role is chosen from the archetype rather than passed in, for the same
   * reason the signup endpoint does not accept an archetype: a caller that
   * could name its own role could name `system_admin`.
   */
  async ensureSessionEmployee(input: {
    employeeId: EmployeeId;
    displayName: string;
    email: string;
    archetype: RoleArchetype;
    organisationName: string;
    organisationId: string;
    isFounder?: boolean;
  }): Promise<Employee> {
    return delay(this.#provisionEmployee(input));
  }

  /**
   * Build and store one employee from an account, or return the one already
   * there. Synchronous and latency-free on purpose: `ensureDirectoryEmployees`
   * calls it once per organisation member on every session load, and paying
   * the simulated 120ms per person would put seconds onto the first paint of a
   * workspace that has done nothing wrong except have colleagues.
   */
  #provisionEmployee(input: {
    employeeId: EmployeeId;
    displayName: string;
    email: string;
    archetype: RoleArchetype;
    organisationName: string;
    organisationId: string;
    isFounder?: boolean;
  }): Employee {
    const s = getStore();
    const existing = s.employees.find((e) => e.id === input.employeeId);
    if (existing) return existing;

    /* Match on archetype, not on a role id. Role records are data an
       organisation edits; hard-coding `role-admin` here would break the moment
       somebody renamed it. */
    const role =
      s.roles.find((r) => r.archetype === input.archetype) ??
      s.roles.find((r) => r.archetype === "employee");

    const deptId = input.organisationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (deptId && !s.departments.some((d) => d.id === deptId)) {
      s.departments.push({
        organisationId: actingOrganisationId(),
        id: deptId,
        name: input.organisationName,
        /* No head yet. The founder heads nothing until an administrator says
           so — inventing a headship here would create an approval route
           nobody chose. */
        hodEmployeeId: null,
        parentDepartmentId: null,
        isActive: true,
      });
    }

    const parts = input.displayName.trim().split(/\s+/);
    const employee: Employee = {
      organisationId: actingOrganisationId(),
      id: input.employeeId,
      /* From the identity store, which is the only record of who created the
         organisation. Absent means false — a session payload that predates the
         field describes somebody who is not being claimed as founder. */
      isFounder: input.isFounder ?? false,
      userId: `u-${input.employeeId}`,
      employeeCode: `CW-${input.employeeId.slice(-4).toUpperCase()}`,
      firstName: parts[0] ?? input.displayName,
      lastName: parts.slice(1).join(" "),
      displayName: input.displayName,
      initials:
        (parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : ""),
      profilePictureUrl: null,
      /* Deterministic from the id, so the monogram colour is stable across
         sessions rather than changing on every sign-in. */
      hue: (input.employeeId
        .split("")
        .reduce((n, c) => n + c.charCodeAt(0), 0) % 6) as 0 | 1 | 2 | 3 | 4 | 5,
      email: input.email || null,
      departmentId: deptId || null,
      departmentName: input.organisationName || null,
      designation: input.archetype === "system_admin" ? "Administrator" : null,
      roleIds: role ? [role.id] : [],
      timezone: "UTC",
      workCalendarId: "cal-standard",
      joinedAt: nowIso(),
      exitedAt: null,
    };
    s.employees.push(employee);
    persistStore();
    return employee;
  }

  /**
   * Reconcile the workspace against the organisation's real membership.
   *
   * The employee list is a per-browser store, so it only ever knew about the
   * seed plus whoever had signed in on THIS machine. Somebody created on
   * another browser existed server-side and was absent here — not filtered
   * out, absent — which is why an administrator could not see them in People
   * or reach them for assignment.
   *
   * Provisioning only. It adds employees who are missing and leaves every
   * existing record untouched, so a locally-edited department or designation is
   * never overwritten by a directory that does not know about it. It writes no
   * reporting relationships either: who reports to whom is an administrator's
   * decision, and inventing one here would silently widen `#closure()` — which
   * is what team visibility, monitoring and assignment scope all read.
   */
  async ensureDirectoryEmployees(
    members: {
      employeeId: EmployeeId;
      displayName: string;
      email: string;
      archetype: RoleArchetype;
      isFounder?: boolean;
    }[],
    organisationName: string,
    organisationId: string,
  ): Promise<number> {
    let added = 0;
    let corrected = 0;
    for (const m of members) {
      if (!m.employeeId) continue;
      const existing = getStore().employees.find((e) => e.id === m.employeeId);
      if (existing) {
        /* Founder is the ONE field reconciled onto a record that already
           exists, and only because the identity store is its only authority.
           The signed-in user is self-provisioned a moment before this runs and
           cannot know whether they founded the organisation, so their own
           record would otherwise be stuck claiming they did not — and the
           unplaced list would report the top of the company as a gap.
           Everything else is left alone: a locally-edited department or
           designation is never overwritten by a directory that does not
           track it. */
        if (m.isFounder !== undefined && existing.isFounder !== m.isFounder) {
          existing.isFounder = m.isFounder;
          corrected += 1;
        }
        continue;
      }
      this.#provisionEmployee({ ...m, organisationName, organisationId });
      added += 1;
    }
    /* One write for the whole batch. `#provisionEmployee` persists per record,
       which is right for a single sign-in and wasteful for thirty. */
    if (added > 0 || corrected > 0) persistStore();
    return added;
  }

  /**
   * Everyone the reporting tree does not place.
   *
   * Derived on every read from `reporting` — nothing is stored, so the tree
   * stays the single source of truth and this cannot drift from it. An employee
   * is unattached when they hold no ACTIVE primary reporting row and did not
   * found the organisation.
   *
   * The founder exclusion is the whole point: the top of an organisation has no
   * manager and never will, so reporting them as a gap would train an
   * administrator to ignore the list that exists to be acted on.
   *
   * It reports, and never repairs. Assigning a manager automatically would put
   * somebody's work under a person who never agreed to receive it and widen
   * `#closure()` — team visibility, monitoring and assignment scope all read
   * that tree — without a decision being made by anyone.
   */
  async listUnattachedEmployees(): Promise<Employee[]> {
    const s = getStore();
    return delay(unattachedEmployees(s.employees, s.reporting));
  }

  setActingEmployee(employeeId: EmployeeId | null): void {
    /* Employee only. Preserves the organisation deliberately — the development
       profile switcher moves you WITHIN a tenant, never between them. */
    setActingId(employeeId);
  }

  /**
   * The full request context, from a verified session.
   *
   * The organisation is the half that matters for isolation: every read is
   * scoped to it and every write is stamped with it. `SessionProvider` calls
   * this once the session resolves, before any query runs.
   */
  setActingContext(context: {
    employeeId: EmployeeId;
    organisationId: string;
  } | null): void {
    setActingContext(context);
  }

  /** The tenant this repository is currently answering for. */
  actingOrganisationId(): string {
    return actingOrganisationId();
  }

  async resetDemoData(): Promise<void> {
    // Reset clears the failure switch first, so it is always a way OUT of a
    // simulated failure rather than another thing that fails.
    resetStore();
    /* Rule overrides live outside the store — they are read by the engine, not
       by a query — so resetting the data without clearing them would leave the
       prototype scoring with values no visible rule claims. */
    clearAllRuleOverrides();
    getStore().failure = "none";
    return delay(undefined);
  }
  setSimulatedFailure(mode: SimulatedFailure) {
    getStore().failure = mode;
  }
  getSimulatedFailure(): SimulatedFailure {
    return getStore().failure;
  }

  /* ── Internals ──────────────────────────────────────────────────────────── */

  /**
   * Tell the parent's owner that a subtask landed, and by how much.
   *
   * Only fires for a subtask that claims requirements. `createSubtask` is the
   * only way to make one and it requires at least one claim, so in practice
   * this always fires — the guard is for records that predate that rule rather
   * than a second creation route.
   */
  #announceToParent(child: Task): void {
    if (!child.parentTaskId || child.satisfiesRequirementIds.length === 0)
      return;
    const s = getStore();
    const parent = s.tasks.find((t) => t.id === child.parentTaskId);
    if (!parent) return;

    const siblings = s.tasks.filter(
      (x) => x.parentTaskId === parent.id && !x.deletedAt,
    );
    const state = completionState(parent, siblings);

    this.#event(
      parent.id,
      "requirement_satisfied",
      `“${child.title}” completed — ${state.satisfiedCount} of ${state.total} requirements satisfied`,
    );

    /* The owner and the person carrying the parent, deduplicated. Often the
       same person; when they are not, both are accountable for it landing. */
    const parentAssignee = s.assignments.find(
      (a) => a.taskId === parent.id,
    )?.employeeId;
    const recipients = [...new Set([parent.createdById, parentAssignee])].filter(
      (id): id is EmployeeId => !!id && id !== actingId(),
    );

    for (const id of recipients) {
      this.#notify(
        id,
        "subtask_completed",
        state.canComplete
          ? "Every requirement is satisfied"
          : "A subtask completed",
        state.canComplete
          ? `“${parent.title}” has all ${state.total} requirements satisfied and can be submitted.`
          : `“${child.title}” is done — ${state.satisfiedCount} of ${state.total} requirements on “${parent.title}” are satisfied.`,
        "task",
        parent.id,
      );
    }
  }

  /**
   * Resolve the project a subtask hangs off, and the requirements it claims.
   *
   * Reads the PARENT's requirement state, so the status a subtask displays is
   * the same fact the project panel displays — one source of truth, per the
   * data-integrity rule. Nothing is copied onto the child.
   */
  #parentContext(task: Task): ParentContext | null {
    if (!task.parentTaskId) return null;
    const s = getStore();
    const parent = s.tasks.find((t) => t.id === task.parentTaskId);
    if (!parent) return null;

    /* The parent's own state, computed over ITS children — which includes this
       task. That is what makes `isSoleClaimant` answerable. */
    const siblings = s.tasks.filter(
      (t) => t.parentTaskId === parent.id && !t.deletedAt,
    );
    const state = completionState(parent, siblings);

    return {
      id: parent.id,
      title: parent.title,
      reference: parent.reference,
      ownerName:
        s.employees.find((e) => e.id === parent.createdById)?.displayName ??
        null,
      claimedRequirements: state.requirements
        .filter((r) => task.satisfiesRequirementIds.includes(r.requirement.id))
        .map((r) => ({
          id: r.requirement.id,
          text: r.requirement.text,
          isSatisfied: r.isSatisfied,
          isSoleClaimant:
            r.claimants.length === 1 && r.claimants[0]?.id === task.id,
        })),
    };
  }

  #event(taskId: TaskId, type: TaskEvent["type"], summary: string) {
    const s = getStore();
    const me = s.employees.find((e) => e.id === actingId())!;
    const seq = s.taskEvents.filter((e) => e.taskId === taskId).length + 1;
    s.taskEvents.push({
      id: nextId("te"),
      taskId,
      sequence: seq,
      type,
      actorId: actingId(),
      actorLabel: me.displayName,
      summary,
      payload: {},
      occurredAt: nowIso(),
    });
  }

  #notify(
    recipientId: EmployeeId,
    type: string,
    title: string,
    body: string,
    sourceType: string,
    sourceId: string,
  ) {
    if (recipientId === actingId() && type !== "priority_cascade") return;
    getStore().notifications.push({
      organisationId: actingOrganisationId(),
      id: nextId("nt"),
      recipientId,
      type,
      title,
      body,
      data: {},
      sourceType,
      sourceId,
      channels: ["in_app", "push"],
      readAt: null,
      createdAt: nowIso(),
    });
  }

  #projectActivity(
    projectId: ProjectId,
    type: ProjectActivity["type"],
    summary: string,
  ) {
    const s = getStore();
    const me = s.employees.find((e) => e.id === actingId())!;
    s.projectActivity.push({
      id: nextId("pa"),
      projectId,
      type,
      actorId: actingId(),
      actorLabel: me.displayName,
      summary,
      occurredAt: nowIso(),
    });
  }
}

function formatSecs(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export const mockRepository = new MockRepository();
