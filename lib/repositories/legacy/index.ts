import type { AttendanceDay, ConductPolicy, ConductSeverity, Conversation, Employee, EmployeeId, TaskStatus, Meeting, Message, MessageAttachment, MessageReply, MonitoringSubject, MusicPreferences, MusicQueue, MusicResult, Notification, Role, ScoreOverview, ScoreUnit, Viewer } from "@/lib/domain";
import { MESSAGE_PAGE_SIZE } from "@/lib/domain/work";
import type { MrfAvailability, MrfChatMessage, MrfItemStatus, MrfRequest, MrfStatus, RawItemHit } from "@/lib/domain/mrf";
import {
  mrfApprovalStats,
  mrfStats,
  readMrfApprovalStats,
  type NewMrfInput,
} from "@/lib/rules/mrf/lifecycle";
import { ROLE_ADMIN, systemRoles } from "../../auth/systemRoles.ts";
import { presenceIdentityFor } from "../../integrations/livekit/identity.ts";
import {
  STALE_AFTER_MS,
  dailyHoursSecs,
  dutyDayKey,
  dutyTransition,
  heartbeatPatch,
  ownsClaim,

  readDutyMode,
  readDutySnapshot,
  storedMode,
  type DutyDocument,
  type DutyHistoryEntry,
  type DutyMode,
  type DutySnapshot,
} from "../../rules/presence/duty.ts";
import type { DutyFacts } from "../../rules/presence/roster.ts";
import {
  bankableRunSecs,
  TIMER_BANKABLE_GRACE_MS,
} from "../../rules/tasks/timer.ts";
import { presenceWriteRefusal } from "../../rules/presence/taskGate.ts";
import {
  currentStageOf,
  readReviewFlow,
  stagesOf,
  type ReviewerRole,
} from "../../rules/tasks/reviewChain.ts";
import {
  anchorMsFor,
  chainDeadlines,
  officeOpenMsFor,
  queueFor,
} from "../../rules/tasks/priorityDeadline.ts";
import { dutyStatusPath, fetchBlockedDates } from "../../legacy/attendance.ts";
import {
  readOfficePolicy,
  validateOfficePolicy,
  writeOfficePolicy,
  type OfficePolicy,
} from "../../legacy/officePolicy.ts";
import { compositeId, taskIdOf } from "./compositeId.ts";
import {
  canManagerViewTask,
  reportingSubtree,
} from "../../rules/tasks/managerVisibility.ts";
import {
  calculateDeadlineFeasibility,
  type Feasibility,
} from "../../rules/tasks/deadlineFeasibility.ts";
import {
  acceptBudget as acceptBudgetRequest,
  fetchTaskTabActivity,
  markTaskTabSeen as markTaskTabSeenRequest,
  declineAssignment as declineAssignmentRequest,
  setActiveTaskBudget,
  setPriorityOrder,
  counterBudget as counterBudgetRequest,
} from "../../legacy/taskWrites.ts";
import {
  deleteAttachment as deleteAttachmentRequest,
  downloadAttachment as downloadAttachmentRequest,
  listAttachments as listAttachmentsRequest,
  uploadAttachment as uploadAttachmentRequest,
  type AttachmentEntity,
  type AttachmentMeta,
} from "../../legacy/attachments.ts";
import { fetchHierarchy } from "../../legacy/employees.ts";
import {
  taskIdOfProposal,
  toDeadlineProposals,
  toGrantedExtensions,
  toPendingExtension,
} from "./deadlineMap.ts";
import type { ActionResult, ActionableItem, ChangePriorityInput, CoworkRepository, CreateConversationInput, CreateProjectInput, CreateMeetingInput, CreateTaskInput, DocumentVersionSummary, ExternalShareInvite, ExternalShareKind, ExternalShareRole, GoalReportFile, GoalStepPerson, Page, ProjectQuery, ProjectView, ReworkQueuePreview, SetOutputsInput, TaskQuery, TaskScope, TaskView, TimerSopStatus, UploadedMedia } from "../types";
import { DEFAULT_TIMER_SOP_CONFIG, computeTodayTarget, evaluateTimerSop, type TimerSopConfig } from "@/lib/rules/scoring/timerSop";
import { todayWindow } from "@/lib/rules/scoring/workTime";
import { actionableFor } from "../../rules/tasks/actionable.ts";
import { istDayKey, isReportPending, workedToday } from "../../rules/tasks/dailyReport.ts";
import { emergencyRequestRefusal } from "../../rules/tasks/emergency.ts";
import type { CascadeOrderEntry, CoworkDocument, CoworkDocumentBody, DocumentKind, DocumentPageSetup, DocumentRole, DocumentSummary, MindMapDetail, MindMapRecord, MindMapRole, MindMapSummary, MindNode, WorkloadFlow, BlockedDate, DailyReport, DeadlineExtension, DeadlineProposal, Department, EmergencyRequest, MeetingEvent, MeetingParticipant, MeetingRecording, PriorityAcknowledgement, PriorityCascade, PriorityChange, PriorityConflict, Project, ProjectId, ProjectStatus, ReportAttachment, ReworkRequest, Task, TaskChatMessage, TaskEvent, TaskEventType, TaskId, TaskReview, TaskSubmission, TimerSession, WorkCommit } from "@/lib/domain";
import type { LegacyResult } from "../../legacy/envelope";
import { notifyRepositoryChanged } from "../events.ts";
import {
  confirmTask as confirmTaskRequest,
  counterDeadline,
  createSubtask as createSubtaskRequest,
  createTask as createTaskRequest,
  deleteTask as deleteTaskRequest,
  requestDeadlineExtension,
  respondToCounter as respondToCounterRequest,
  reviewDeadlineExtension,
  sendTaskChat as sendTaskChatRequest,
  setDepartmentHours,
  departmentApprove,
  editTaskDeadline,
  editTaskDetails,
  resetTaskToDraft,
  reviewCompletion,
  reworkTask,
  reworkQueuePreview as reworkQueuePreviewCall,
  startTask as startTaskRequest,
  fetchOutputIndex,
  reviewOutput,
  setTaskOutputs,
  submitCompletion,
  submitOutput,
  proposeDeadline as proposeDeadlineRequest,
  acceptAssignorWindow as acceptAssignorWindowRequest,
  rejectAssignorWindow as rejectAssignorWindowRequest,
  approveDeadline as approveDeadlineRequest,
} from "../../legacy/taskWrites.ts";
import { listMembers } from "../../legacy/employees.ts";
import { fromHierarchyId, toHierarchyId } from "../../legacy/identityMap.ts";
import {
  buildReportingTree,
  fetchMyManagers,
  type LegacyManagers,
  type ReportingNode,
  type ReportingTree,
} from "../../legacy/hierarchy.ts";
import { fetchDashboard } from "../../legacy/scoring.ts";
import {
  applySop,
  createSop,
  decideSop,
  fetchLedger,
  fetchPendingApprovals,
  fetchPendingRechecks,
  type LegacySop,
  listSops,
  readSop,
  requestRecheck,
  reviewRecheck,
} from "../../legacy/sop.ts";
import { legacyFetch } from "../../legacy/http.ts";
import {
  creditNode,
  fetchC2Pool,
  fetchC2Score,
  fetchRoadmap,
  saveRoadmap,
  submitNodeReport,
  uploadReportFile,
  validateWeightage,
} from "../../legacy/goals.ts";
import {
  rollUpStatus,
  withDecision,
  withReport,
  type StepWithPeople,
} from "../../rules/scoring/goalPeople.ts";
import { taskMaxPointsFor } from "../../rules/scoring/goalPoints.ts";
import { approvalOutcome, nodePointsFor } from "../../rules/scoring/goalNodes.ts";
import { LEGACY_ORGANISATION_ID, hueFor, initialsOf, toEmployee, toScoreHistory, toScoreOverview, toViewer } from "./map.ts";
import { computeProgress } from "../mock/progress.ts";
/* Playlists are browser-local personal state with no engine counterpart — see
   the music block below for why these are wired rather than stubbed out. */
import { musicStore } from "../mock/musicStore.ts";
import { toTaskStatus, toTaskView } from "./taskMap.ts";
import { hasStartableOutput } from "@/lib/rules/tasks/outputs";
import {
  activeQueuePositions,
  provisionalQueuePositions,
} from "../../rules/tasks/activeQueue.ts";
import {
  holdersOf,
  resolveTaskPriority,
} from "../../rules/tasks/resolveTaskPriority.ts";
import { resolveTimeBudget } from "../../rules/tasks/resolveTimeBudget.ts";
import { readSubmissionAttachments } from "../../rules/tasks/submissionFiles.ts";
import { extensionFromAddition } from "../../rules/tasks/deadlineExtension.ts";
import type { RoleArchetype } from "../../domain/identity.ts";
import type {
  MailAttachment,
  MailFolder,
  MailMessage,
  MailParty,
  MailThread,
  MailTransport,
} from "../../domain/mail.ts";
import {
  MAIL_COLLECTION,
  deriveThread,
  inFolder,
  mailMessageBody,
  mailVisible,
  readMailMessage,
  resolveParty,
  threadMatchesSearch,
  transportForParties,
} from "./mail.ts";
import {
  DM_COLLECTION,
  GROUP_COLLECTION,
  attachmentPreview,
  debounce,
  directDocId,
  driveFileId,
  messageWriteBody,
  pairOf,
  previewOf,
  readDirectConversationDoc,
  readGroupConversationDoc,
  readMessageDoc,
  readPinnedMessages,
  readReactions,
} from "./messaging.ts";
import { attachmentKind } from "../../rules/messages/attachmentKind.ts";
import { readTaskChatMessage } from "./taskChat.ts";
import { reactionChanges } from "../../rules/messages/reactions.ts";
import { withPin, withoutPin } from "../../rules/messages/pins.ts";
import {
  recipientRefusal,
  redactBcc,
} from "../../rules/mail/blindCopy.ts";
import {
  APPROVED_LEGACY_STATUSES,
  buildWorkloadFlow,
  CANCELLED_LEGACY_STATUSES,
  CLOSED_LEGACY_STATUSES,
  type FlowEvent,
} from "../../rules/dashboard/workloadFlow.ts";
import {
  DOCUMENT_BODY_COLLECTION,
  DOCUMENT_COLLECTION,
  documentBody as documentRecordFields,
  readDocument,
  readDocumentVersion,
} from "./documents.ts";
import {
  readMindMapRecord,
  readMindNodes,
} from "../../legacy/mindmaps.ts";
import {
  readExternalShareInvite,
  readExternalShareInvites,
} from "../../legacy/shareInvites.ts";
import { previewOfHtml } from "../../rules/documents/preview.ts";
import { pageSetupRefusal, readPageSetup } from "../../rules/documents/pageSetup.ts";
import {
  emergencyCompensationMs,
  emergencyDecisionRefusal,
} from "../../rules/tasks/emergency.ts";
import { storedPictureRefusal } from "../../rules/people/profilePicture.ts";
import {
  HISTORY_FIELD,
  cascadeFromEntries,
  entryFor,
  groupKey,
  readEntry,
  type QueueDeadlineMove,
  type StoredCascadeEntry,
} from "./priorityCascades.ts";
import { absenceCreditMs } from "../../rules/presence/workingTime.ts";
import {
  grantBreakCredit,
  readBreakLedger,
  writeBreakLedger,
} from "../../rules/presence/breakAllowance.ts";
import {
  canManage as canManageDocument,
  editRefusal,
  memberChangeRefusal,
  writeMembers,
} from "../../rules/documents/access.ts";
import { applySettingsChange } from "../../rules/settings/service.ts";
import {
  AUDIT_REQUIRED,
  BUDGET_EXTENSION_REQUIRED,
  DEADLINE_EXTENSION_REQUIRED,
  documentBody,
  PayloadError,
} from "../../rules/settings/firestorePayload.ts";
import { OFFICE_POLICY_CHANGED, type AuditEntry } from "../../rules/settings/audit.ts";
import {
  AUDIT_SECTION,
  HR_HOLIDAY_SYNC_CHANGED,
  PROVISIONAL_RULES_CHANGED,
  SCORING_CHANGED,
  TASK_RULES_CHANGED,
  WORKFLOW_ROUTING_CHANGED,
} from "../../rules/settings/sections.ts";
import {
  DEFAULT_TASK_RULES,
  readTaskRules,
  submissionRefusal,
  validateTaskRules,
  writeTaskRules,
  type TaskRules,
} from "../../rules/settings/taskRules.ts";
import {
  DEFAULT_WORKFLOW_ROUTING,
  readWorkflowRouting,
  routedBudgetApproverId,
  routedDeadlineApproverId,
  routingRefusal,
  validateWorkflowRouting,
  writeWorkflowRouting,
  type WorkflowRouting,
} from "../../rules/settings/workflowRouting.ts";
import {
  readScoringSettings,
  scoringSyncBody,
  validateScoringSettings,
  writeScoringSettings,
  type ScoringSettings,
} from "../../rules/settings/scoringSettings.ts";
import {
  readRuleOverrides,
  validateRuleOverrides,
  writeRuleOverrides,
  type RuleOverrides,
} from "../../rules/settings/ruleOverrides.ts";
import { applyRuleOverrides } from "../../config/settings.ts";
import {
  describeQueueFault,
  isActiveWorkload,
  normalizePriorityQueue,
} from "../../rules/tasks/priorityQueue.ts";
import { completionState } from "../../rules/tasks/completion.ts";
import { requirementCoverage } from "../../rules/tasks/requirementCoverage.ts";
import {
  maySettings,
  mayReadAuditLog,
  AUDIT_REFUSAL,
  SETTINGS_REFUSAL,
} from "../../rules/settings/access.ts";
import {
  agreedOrRequestedSecs,
  hasLiveBudgetExtension,
  transitionRefusal,
} from "../../rules/tasks/extensionAuthority.ts";
import { acceptanceRefusal } from "../../rules/tasks/assignmentAcceptance.ts";
import {
  deadlineExtension,
  liveDeadline,
  timeBudgetExtension,
  type DeadlineExtensionRecord,
  type TimeBudgetExtensionRecord,
} from "../../rules/tasks/extensionRecords.ts";
import {
  toC1Units,
  toC2Units,
  type LegacyC1Response,
  type LegacyC2Response,
} from "./scoreMap.ts";
import { readTimerFigures } from "../../rules/tasks/timerSession.ts";
import {
  type Attendance as MeetingAttendance,
  creditsIn,
  crossDeptWindow,
  ordinaryWindow,
  roomEmptiedAtMs,
  roomIsEmpty,
  settleCrossDeptSession,
  settleSession,
} from "../../rules/meetings/meetingCredit.ts";

/**
 * Firestore attendance rows in the shape the meeting rules read.
 *
 * The rules answer "is anybody still in there" and the repository has to ask
 * them, not re-implement the answer — a second copy of the presence rule is
 * how a room that looks live becomes one that cannot be joined.
 */
/**
 * A task's status **for the purposes of meeting credit**.
 *
 * `toTaskStatus` collapses five legacy `pending_*` states into one
 * `pending_approval`, and for this one question that loses a distinction that
 * matters. Two very different tasks arrive under that name:
 *
 *   - one still NEGOTIATING its hours, which has no agreed budget and so no
 *     committed deadline for a meeting to move; and
 *   - one already handed over with its hours agreed, waiting on a department
 *     head to wave the handover through. That is live work somebody is holding,
 *     and it is the exact shape of the task a cross-department kickoff is held
 *     about.
 *
 * The second was being refused credit along with the first, so a meeting about
 * cross-department work moved nothing. The agreed budget is what tells them
 * apart: an hours negotiation has none, by definition.
 */
function settlementStatusOf(task: LegacyTask): TaskStatus {
  const status = toTaskStatus(task);
  if (status !== "pending_approval") return status;
  const handedOver = Boolean(task.pendingAssigneeId || task.assigneeIds.length);
  return handedOver && resolveTimeBudget(task) > 0 ? "assigned" : status;
}

function toAttendanceRows(rows: readonly unknown[]): MeetingAttendance[] {
  return rows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const at = (v: unknown) => {
      const ms = v ? Date.parse(String(v)) : NaN;
      return Number.isFinite(ms) ? ms : null;
    };
    return {
      employeeId: String(row.employeeId ?? ""),
      joinedAtMs: at(row.joinedAt) ?? 0,
      leftAtMs: at(row.leftAt),
      lastSeenAtMs: at(row.lastSeenAt),
    };
  });
}
import {
  taskJoinRefusal,
  taskMeetingRoomName,
} from "../../rules/meetings/taskRoom.ts";
import type { TaskMeetingSession } from "../../domain/tasks.ts";
import {
  restoreBlockedDeadlines,
  readDueAtMs,
  readInstant,
  readTask,
  type LegacyTask,
} from "../../legacy/tasks.ts";
import { firstNumber } from "../../legacy/wire.ts";
import * as meetHttp from "../../legacy/meetings.ts";
import { listMeetingRecordings as listMeetingRecordingsHttp } from "../../legacy/meetingMedia.ts";
import {
  toMeeting,
  toMeetingEvents,
  toMeetingParticipants,
  toMeetings,
  toNotifications,
  toWorkloadRows,
  type LegacyWorkloadRow,
} from "./workMap.ts";

/**
 * A readable name for a file we only have a URL for.
 *
 * Legacy stores a report's files as bare URLs, so the name was never recorded.
 * Rendering the URL as the label is what the reports tab did, and a Drive URL
 * says nothing about what the file is. The last path segment is a guess, but it
 * is a guess in the right shape, and "Attachment" is the honest fallback when
 * even that yields nothing.
 */
function nameFromUrl(url: string): string {
  try {
    const path = new URL(url, "https://x.invalid").pathname;
    const last = path.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last) || "Attachment";
  } catch {
    return "Attachment";
  }
}

/* `istDayKey` used to be defined here as well as in `lib/rules/tasks/
   dailyReport.ts`, which is now imported above. Two identical copies of the
   rule that decides which day a report is filed against is exactly the
   disagreement that module's own comment warns about, so the local one is
   gone rather than kept in sync by hand. */

/**
 * The Cowork repository, backed by the legacy engine.
 *
 * **Four methods are real. Everything else is explicitly not connected.**
 *
 * That is the whole design, and it is deliberate. A decorator that delegated
 * unmigrated methods to the mock repository would have been faster to write and
 * would have produced the worst possible screen: real tasks beside invented
 * projects, a real score beside a fabricated meeting, with nothing to tell them
 * apart. During a migration the danger is never the empty panel — it is the
 * populated one that happens to be wrong.
 *
 * So unmigrated reads return empty, and unmigrated writes throw. An empty list
 * shows a card's own empty state; a throw surfaces where a screen is trying to
 * do something the engine has not been wired for yet. Both are visible. Neither
 * misleads.
 *
 * ## What is real
 *
 * | Method | Source | Verified |
 * |---|---|---|
 * | `getViewer` | `GET /cowork/me` | ✅ |
 * | `listEmployees` | `GET /cowork/employee/list-members` | ✅ |
 * | `getScoreOverview` | `GET /cowork/pmp/:id/dashboard` | ✅ |
 * | `listTasks` | `GET /cowork/task/list-hierarchy` | ✅ |
 *
 * Nothing here computes a business value. `pmpService` owns every score,
 * `taskForward.js` owns every lifecycle decision, and this maps what they send.
 */

export interface LegacyRepositoryContext {
  /** A live Firebase ID token. Asked for per call — tokens refresh. */
  getToken: () => Promise<string | null>;
  employeeId: EmployeeId;
  legacyRole: unknown;
  hasManager: boolean;
  /**
   * The authorisation archetype, resolved server-side when the session was
   * established.
   *
   * **Carried, never inferred.** This repository used to derive "is an
   * administrator" from `legacyRole === "ceo"`, which is an HR fact standing in
   * for an authorisation decision — a second door into the admin permissions
   * that nothing documented. Undefined means unknown, and unknown is refused.
   */
  archetype?: RoleArchetype | null;
}

/** Thrown when a screen reaches for something the engine is not wired to yet. */
export class NotConnectedError extends Error {
  constructor(method: string) {
    super(
      `${method} is not connected to the Cowork engine yet. It is not available in this build rather than empty.`,
    );
    this.name = "NotConnectedError";
  }
}

/**
 * A person the directory could not resolve, rendered as their id.
 *
 * For the handful of places the domain requires a non-null `Employee` and the
 * engine can only supply an id — a task raised by somebody since removed from
 * `cowork_employees`, most often. The id is shown as the name because that is
 * what `lib/legacy/employees.ts` does everywhere else a person cannot be
 * resolved: a visible identifier can be looked up, and a blank card cannot.
 *
 * Deliberately not a lookup with a silent fallback baked in — callers that CAN
 * resolve somebody should, and this is what they reach for when they cannot.
 */
function unknownEmployee(id: string): Employee {
  return {
    organisationId: LEGACY_ORGANISATION_ID,
    id,
    userId: id,
    employeeCode: id,
    firstName: id,
    lastName: "",
    displayName: id,
    initials: initialsOf(id, "", id),
    hue: hueFor(id),
    profilePictureUrl: null,
    email: null,
    /* Empty, not a guess. `departmentsDiffer` treats an unknown department as
       raising no boundary, so an invented one here would make the
       cross-department gate fire against somebody who does not exist. */
    departmentId: "",
    departmentName: "",
    designation: "",
    roleIds: [],
    timezone: "Asia/Kolkata",
    workCalendarId: "",
    joinedAt: "",
    exitedAt: null,
    isFounder: false,
  };
}

/**
 * A Firestore failure, rewritten when it is a missing composite index.
 *
 * Firestore's own message is `The query requires an index. You can create it
 * here: <console URL>`. Accurate, and it lands on the wrong person: whoever is
 * looking at the screen is usually not whoever can deploy an index, and the
 * message says nothing about which query broke or who it affects.
 *
 * So this names the role whose queries failed and points at the file that
 * declares the indexes, while keeping Firestore's console link — it is the
 * fastest fix for whoever *can* act.
 *
 * The error is still **thrown**. Turning an index failure into an empty list
 * would be indistinguishable from having no tasks, which is the failure mode
 * this whole path was written to avoid.
 */
function asIndexError(error: unknown, role: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (!/requires an index|FAILED_PRECONDITION/i.test(message)) {
    return error instanceof Error ? error : new Error(message);
  }
  const wrapped = new Error(
    `Your task list needs a Firestore index that has not been deployed. ` +
      `This affects the "${role}" role only — other roles load normally, which ` +
      `is why it can look like a problem with one account. ` +
      `The required indexes are declared in firestore.indexes.json; deploy them ` +
      `with \`firebase deploy --only firestore:indexes\`. ` +
      `Firestore's own message follows — its link creates the index directly.\n\n${message}`,
  );
  wrapped.name = "FirestoreIndexMissing";
  return wrapped;
}

/**
 * The `completionStatus` values that put a task in the Submitted tab.
 *
 * Verbatim from `app/coworking/tasks/page.js:996-999`. Note that it includes
 * the rejections: a rejected submission stays in the tab, because the decision
 * is part of the record the tab exists to show. Dropping them would make a
 * rejection look like it never happened.
 */
const SUBMITTED_LIFECYCLE = new Set([
  "submitted",
  "tl_approved",
  "tl_rejected",
  "ceo_rejected",
  "tl_final_approved",
  "ceo_approved",
]);

/**
 * Raw legacy statuses whose deadline an absence must not move.
 *
 * Transcribed from legacy's own `_TERMINAL` in the drag-deadline handler
 * (`page.js`), plus `rejected`: a finished, cancelled or rejected task is a
 * record, and adding lost time to it would rewrite history.
 */
const ABSENCE_TERMINAL_STATUSES = new Set([
  "done",
  "cancelled",
  "rejected",
  "tl_final_approved",
  "ceo_approved",
]);

/**
 * One timer document, as the domain reads it.
 *
 * Extracted so the one-shot read and the live watcher cannot drift: two
 * mappings of one document is how a manager's view and an employee's come to
 * disagree about whether a clock is running.
 */
function toTimerSession(
  data: Record<string, unknown>,
  taskId: string,
  employeeId: string,
): TimerSession {
  /* ONE reading, shared with `getActiveTimer` — see `readTimerFigures`. The two
     used to read this document independently and disagreed about which field
     held the total and which shapes of start instant were acceptable, which is
     the reported "different time after a reload". */
  const figures = readTimerFigures(data);
  const startedAtRealMs = figures.startedAtRealMs;
  return {
    organisationId: LEGACY_ORGANISATION_ID,
    taskId: taskId as TaskId,
    employeeId,
    isActive: data.isActive === true,
    accumulatedSecs: figures.accumulatedSecs,
    /* Legacy stores one real timestamp and no prototype clock. Presenting the
       real one as both keeps a session readable without inventing a second
       reading of when it began. */
    startedAt:
      startedAtRealMs !== null ? new Date(startedAtRealMs).toISOString() : null,
    startedAtRealMs,
    heartbeatAtRealMs: figures.heartbeatAtRealMs,
  };
}

/**
 * A step's per-person map, as the engine stored it.
 *
 * Null rather than `{}` where there is none: absent means this goal was never
 * shared and its flat fields are the whole truth, which is a different thing
 * from a shared goal where nobody has started yet.
 */
function readPerUser(
  raw: unknown,
): Record<string, Partial<GoalStepPerson>> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, Partial<GoalStepPerson>>;
}

/**
 * A task document's per-output submissions, as `TaskSubmission` records.
 *
 * Newest first. Only those still AWAITING a decision are returned: a decided
 * one is history, and the review screen reads `[0]` as the thing to act on — so
 * including a settled submission would offer a decision on work already judged.
 *
 * The id is composite (`taskId:outputId`) rather than stored, because legacy
 * keeps these in a map keyed by output and never mints a submission id. It is
 * stable, which is all the screen needs it for.
 */
function readOutputSubmissionRecords(
  doc: Record<string, unknown>,
  taskId: string,
): TaskSubmission[] {
  const map = doc.outputSubmissions;
  if (!map || typeof map !== "object") return [];
  const reviewer =
    (typeof doc.assignedBy === "string" && doc.assignedBy) ||
    (typeof doc.createdBy === "string" && doc.createdBy) ||
    null;
  const out: TaskSubmission[] = [];
  for (const [outputId, value] of Object.entries(
    map as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (v.review) continue;
    const submittedBy = typeof v.submittedBy === "string" ? v.submittedBy : "";
    if (!submittedBy) continue;
    const files = readSubmissionAttachments(v);
    out.push({
      id: `${taskId}:${outputId}`,
      taskId: taskId as TaskId,
      outputId,
      attempt: typeof v.attempt === "number" ? v.attempt : 1,
      submittedById: submittedBy as EmployeeId,
      submittedAt: typeof v.submittedAt === "string" ? v.submittedAt : "",
      message: typeof v.message === "string" ? v.message : "",
      /**
       * **The files, read the same way a task submission's are.**
       *
       * These were both `[]`. The engine has always stored `imageUrls` and
       * `pdfAttachments` on an output submission — the record is the same shape
       * a task submission uses — but this dropped them, so a reviewer opening a
       * submitted output saw the covering note and no way to reach the work it
       * was describing.
       */
      attachments: files,
      /* Derived FROM the list above rather than gathered separately, so the two
         cannot come to disagree about what was submitted. */
      attachmentIds: files.map((f) => f.url),
      /* One reviewer, one stage — this engine resolves the assigner of record
         and their approval is final (owner decision, 16 Aug 2026). */
      reviewChain: reviewer ? [reviewer as EmployeeId] : [],
      currentStage: 1,
      supersededById: null,
      wasLate: false,
    });
  }
  return out.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/**
 * Is there anything on this task its assignee could sit down and start?
 *
 * **One definition, three readers**: the viewer's own queue, every OTHER
 * subject's queue in `#activeQueueOf`, and the timer gate. Each of them derived
 * this separately, and two of them disagreeing is precisely the bug that put a
 * P1 badge beside a row reading "Waiting on Puri pg" — so the answer is
 * computed once here and the readers are left with nothing to disagree about.
 *
 * Takes a loose shape on purpose: the queue passes a `readTask` result and the
 * timer gate passes a raw Firestore document. Both carry the same two fields,
 * and neither should have to be converted to ask this question.
 *
 * A task with no outputs is workable — every task that predates them.
 */
function taskIsWorkable(
  source: { outputs?: unknown; outputSubmissions?: unknown },
  approvedOutputIds: ReadonlySet<string>,
): boolean {
  const subs = (source.outputSubmissions ?? {}) as Record<
    string,
    { review?: { approved?: boolean } | null } | undefined
  >;
  return hasStartableOutput({
    outputs: (Array.isArray(source.outputs) ? source.outputs : []) as {
      id: string;
      needsOutputIds: string[];
    }[],
    approvedOutputIds,
    stateOf: (outputId) => {
      const sub = subs[outputId];
      if (!sub) return "not_started";
      if (!sub.review) return "in_review";
      return sub.review.approved ? "approved" : "rework";
    },
  });
}

export class LegacyRepository {
  /* Per-viewer, and static so it survives the repository instances a render
     creates. Only a round-trip saver — the engine decides what is written. */
  static #lastQueueSyncMs = new Map<string, number>();

  #ctx: LegacyRepositoryContext;
  /**
   * The directory, resolved once per instance.
   *
   * Tasks name assignees by id and a `TaskView` carries whole `Employee`
   * records, so every task list needs the directory. Fetching it per task would
   * be N requests for one answer; caching it on the repository matches how the
   * engine itself caches the list server-side.
   */
  #directory: Promise<Map<string, Employee>> | null = null;
  /** The derived reporting tree. Lazy — N requests, paid only when asked. */
  #tree: Promise<ReportingTree> | null = null;

  /**
   * When the people caches were filled, so they can go stale.
   *
   * **They had no invalidation at all**, and that is the whole of the reported
   * bug: a manager changed for somebody, changed back, and the app kept showing
   * the first answer until the page was reloaded.
   *
   * A time bound rather than an event, because this application does not own
   * the mutation. There is no `setManager` here — reporting lines are edited in
   * the HR system, so there is no action to hang an invalidation off. Nothing
   * inside this app can know the tree changed; it can only stop believing an
   * old answer indefinitely.
   *
   * Sixty seconds is chosen against what these answers cost and how often they
   * change: the directory is one request, the tree is N, and a reporting line
   * changes a few times a year. A minute is far longer than a person needs to
   * see their own edit and far shorter than a session.
   */
  #peopleFetchedAtMs = 0;
  /**
   * The picture we know is in Firestore, held until the engine agrees.
   *
   * **This exists because invalidating the cache would make a new photograph
   * DISAPPEAR rather than appear.** The directory comes from the engine's
   * `/employee/list-members`, and the engine caches that list for five minutes
   * with nothing a browser can call to clear it. So dropping our own 60-second
   * cache after a write simply fetches the stale list sooner and overwrites the
   * picture the person just set, on their own screen, seconds after they set it.
   *
   * Writing through instead: the value is applied to the cached row, and
   * re-applied to each freshly-fetched list until the engine's own copy carries
   * it — at which point this retires itself.
   */
  #ownPicture: string | null = null;

  /** How long a directory or tree answer is trusted. */
  static readonly PEOPLE_TTL_MS = 60_000;

  /**
   * Drop the people caches so the next read is fresh.
   *
   * Called on a TTL lapse, and available to a caller that knows better — a
   * screen that has just edited a reporting line should not wait out the
   * window.
   */
  invalidatePeople(): void {
    this.#directory = null;
    this.#tree = null;
    this.#peopleFetchedAtMs = 0;
  }

  /** True when the cached people answers are older than the window. */
  #peopleAreStale(): boolean {
    return (
      this.#peopleFetchedAtMs !== 0 &&
      Date.now() - this.#peopleFetchedAtMs > LegacyRepository.PEOPLE_TTL_MS
    );
  }

  constructor(ctx: LegacyRepositoryContext) {
    this.#ctx = ctx;
  }

  async #token(): Promise<string> {
    const token = await this.#ctx.getToken();
    if (!token) throw new NotConnectedError("Cowork sign-in");
    return token;
  }

  /**
   * The directory.
   *
   * **`/employee/list-members`, never `/employee/list`.** The two return
   * identical data from the same `listCoworkEmployees()` call, but `/list` is
   * gated `verifyCeoOrTL` (`cowork.js:322`) while `/list-members` needs only a
   * valid employee token (`:49`) — and additionally strips `tempPassword`,
   * `authUid` and `fcmTokens`.
   *
   * Calling the gated one was a single-word bug with a wide blast radius:
   * every ordinary employee got a 403, the map came back empty, and everything
   * downstream of the directory reported an absence rather than a refusal —
   * their own name and id missing from the top bar, an empty assignee picker,
   * an empty Team, and unresolved assignee names on every task. It was
   * invisible to anyone testing as a TL or the CEO, which is why it survived.
   *
   * Legacy never calls `/list` from the client either: `listAllEmployees()`
   * reads `cowork_employees` from Firestore and falls back to
   * `/list-members`.
   *
   * A failed fetch now **throws** rather than resolving to an empty map. An
   * empty directory is indistinguishable from a company with no staff, and
   * every caller here treats it as fact — `getCurrentEmployee` returned null
   * for a real signed-in person because of it.
   */
  async #employeesById(): Promise<Map<string, Employee>> {
    if (this.#peopleAreStale()) this.invalidatePeople();
    this.#directory ??= (async () => {
      const token = await this.#token();
      const result = await listMembers(token);
      if (!result.ok) {
        /* Cleared so a later call can retry. A cached rejection would leave
           the session permanently identity-less after one transient failure. */
        this.#directory = null;
        throw new Error(
          `The employee directory could not be read: ${result.error.message}`,
        );
      }
      const map = new Map<string, Employee>();
      for (const row of result.data) {
        map.set(String(row.employeeId), toEmployee(row));
      }
      /* Our own picture, re-applied over the engine's copy of us until the two
         agree — see `#ownPicture`. Retired the moment the engine catches up, so
         a picture removed elsewhere is not held on screen forever. */
      const me = String(this.#ctx.employeeId ?? "");
      const mine = me ? map.get(me) : undefined;
      if (this.#ownPicture !== null && mine) {
        if (mine.profilePictureUrl === this.#ownPicture) this.#ownPicture = null;
        else map.set(me, { ...mine, profilePictureUrl: this.#ownPicture });
      }
      /* Stamped on SUCCESS only. Stamping before the fetch would start the
         window running against an answer that might never arrive. */
      this.#peopleFetchedAtMs = Date.now();
      return map;
    })();
    return this.#directory;
  }

  /**
   * The reporting tree, derived once per instance.
   *
   * **Legacy has no tree endpoint.** `my-managers` answers upward, one level,
   * one employee at a time, so the only way to a tree is to ask for everybody
   * and invert. That is N requests, which is why this is cached like
   * `#directory` and why it is lazy: a screen that never asks about hierarchy
   * never pays for it.
   *
   * Failures resolve to "no manager" rather than rejecting. One employee's HR
   * record being unreachable must cost that one edge, not the whole tree —
   * and legacy itself returns `success: true` with null managers for somebody
   * absent from HR, so an unknown and an absent manager already arrive
   * indistinguishable.
   */
  #reportingTree(): Promise<ReportingTree> {
    if (this.#peopleAreStale()) this.invalidatePeople();
    this.#tree ??= (async () => {
      const token = await this.#token();
      const employees = await this.#employeesById();
      const ids = [...employees.keys()];

      const answers = new Map<string, LegacyManagers>();
      /* Bounded concurrency. A directory of a few hundred would otherwise open
         a few hundred sockets at once and be rate-limited into looking like an
         outage. */
      const BATCH = 8;
      for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        const results = await Promise.all(
          slice.map((id) =>
            fetchMyManagers({ token, employeeId: id }).catch(() => null),
          ),
        );
        results.forEach((result, index) => {
          answers.set(
            slice[index],
            result?.ok
              ? result.data
              : { primaryManager: null, secondaryManager: null },
          );
        });
      }
      /* Same stamp as the directory: the two are filled together and expire
         together, so a fresh tree can never be read against a stale directory. */
      this.#peopleFetchedAtMs = Date.now();
      return buildReportingTree(answers);
    })();
    return this.#tree;
  }

  /* ── Real ───────────────────────────────────────────────────────────────── */

  /**
   * The acting identity, with its reporting closure resolved.
   *
   * `hierarchyIds` and `directReportIds` used to be empty — a deliberate
   * under-show while there was no way to fill them. There is now: the tree is
   * derived from `my-managers`, so a manager's scope reaches the people who
   * actually report to them instead of nobody.
   *
   * `hasManager` likewise comes from the tree rather than the constructor's
   * hardcoded `false`, which withheld the self-reorder control from everybody
   * including people who plainly have a manager.
   */
  async getViewer(employeeId?: EmployeeId): Promise<Viewer> {
    const id = String(employeeId ?? this.#ctx.employeeId);
    /**
     * **Identity must not depend on the directory being readable.**
     *
     * The tree is ~17 HTTP calls (one `my-managers` per employee) and it is
     * awaited here for two booleans. `#employeesById` throws outright when the
     * directory read fails, so ANY failure in that chain rejected `getViewer`,
     * `useViewerId()` returned null, and null viewerId is load-bearing far
     * beyond this method: it greys out Go online, empties the score pill, and
     * makes both of `DutySync`'s effects return early — so presence is never
     * published and the account cannot go online at all.
     *
     * A person who cannot be placed in the hierarchy is still a person with an
     * employee id. Degrade to "no manager, no reports" — the same answer the
     * tree already gives for somebody absent from HR — rather than refusing to
     * say who they are.
     */
    let tree: ReportingTree | null = null;
    try {
      tree = await this.#reportingTree();
    } catch (e) {
      console.warn(
        "[legacy] reporting tree unavailable; viewer resolved without hierarchy:",
        e instanceof Error ? e.message : e,
      );
    }
    /* **Resolve to the hierarchy identity before reading the tree.**
     *
     * The Cowork account and the HR record are the same string for 15 of 16
     * people; for the CEO they are `E000` and `GR0000`, two records in two
     * stores sharing no key. Reading the tree under the sign-in id put the CEO
     * at a node nobody reports to, which presented as "you have no reports"
     * while eight people reported to the other record.
     *
     * See `lib/legacy/identityMap.ts` — the mapping is written down rather
     * than guessed, because nothing in the data derives it. */
    const node = tree?.byEmployee.get(toHierarchyId(id));
    return {
      ...toViewer({
        employeeId: id,
        legacyRole: this.#ctx.legacyRole,
        hasManager: node?.managerId !== null && node?.managerId !== undefined,
        /* **The manager role is earned from the tree, not from a title.**
         *
         * Somebody with a report holds it whatever `cowork_employees.role`
         * says, because every manager grant is `direct_reports`-scoped and so
         * reaches exactly those reports and nobody else. Reading it off the
         * role string instead would have left a manager whom HR records as an
         * employee without the surfaces for people who plainly report to
         * them — the same shape of bug as the empty directory, where the data
         * was right and the screen said there was none. */
        hasDirectReports: (node?.directReportIds ?? []).length > 0,
      }),
      /* **Direct reports only — not the transitive closure.**
       *
       * `hierarchyIds` gates Team, monitoring and every hierarchy-scoped
       * permission, and it now stops at one level for EVERYONE. A CEO with a
       * TL beneath them sees that TL and not the TL's own people; a TL sees
       * their own people and not anyone further down.
       *
       * This is narrower than the closure that was here before, and the
       * narrowing is the point: reach should be earned one relationship at a
       * time rather than inherited by sitting near the top. It applies
       * uniformly, so a CEO is a manager whose reach is computed the same way
       * as any other manager's — the whole of the "Admin = TL + settings"
       * model, expressed in one line rather than in a role check.
       *
       * `descendantsOf` still exists in `lib/legacy/hierarchy.ts` and is
       * tested, for an org-chart surface where showing the whole structure is
       * the purpose rather than a permission. It is deliberately not used
       * here: a permission list and a diagram are different things and should
       * not share a source. */
      hierarchyIds: node?.directReportIds ?? [],
      directReportIds: node?.directReportIds ?? [],
    };
  }

  /**
   * The whole tree, for a hierarchy screen.
   *
   * Returns the derived nodes as they are — this application does not own the
   * relationships and must not present a tidier tree than HR actually has. An
   * unresolvable `depth` stays null.
   */
  async listReportingLines(): Promise<ReportingNode[]> {
    const tree = await this.#reportingTree();
    return [...tree.byEmployee.values()];
  }

  /** Who reports to this employee directly. */
  async listDirectReports(employeeId: EmployeeId): Promise<Employee[]> {
    const tree = await this.#reportingTree();
    const employees = await this.#employeesById();
    return (tree.byEmployee.get(String(employeeId))?.directReportIds ?? [])
      .map((id) => employees.get(id))
      .filter((e): e is Employee => e !== undefined);
  }

  /**
   * One employee, from the directory already fetched.
   *
   * No extra request: `listEmployees` is cached per instance, and legacy's
   * `/cowork/employee/:id` returns the same `cowork_employees` document. Reading
   * from the map keeps a profile page from issuing a second call for a record
   * the repository is already holding.
   *
   * `null` for somebody absent, which is a real state — a task can name an
   * assignee who has since left the directory, and inventing a placeholder
   * would put a fabricated name on their work.
   */
  async getEmployee(id: EmployeeId): Promise<Employee | null> {
    const map = await this.#employeesById();
    return map.get(String(id)) ?? null;
  }

  /**
   * Who this viewer may assign work to.
   *
   * **Everyone except themselves**, which is legacy's rule exactly:
   * `listAllEmployees()` reads the whole `cowork_employees` collection from
   * Firestore, and `CreateTaskModal.jsx:408` applies the only filter there is —
   * `emps.filter(e => e.employeeId !== currentEmployeeId)`.
   *
   * No role filter, no department filter, and **no hierarchy filter**. In
   * Cowork assignment is consent rather than permission: anyone may assign to
   * anyone, and the approval gates on the create endpoint are what hold the
   * work — a cross-department assignment is not refused, it is parked at
   * `pending_department_approval` until an approver clears it. Narrowing this
   * list would enforce at the picker a rule the engine deliberately enforces
   * later, and would silently remove people the engine would have accepted.
   *
   * This method being absent is what emptied the assignee picker: the
   * repository proxy throws `NotConnectedError` for anything unimplemented, so
   * the query never resolved, the list stayed empty, and the form submitted
   * `assigneeIds: []` — which the engine rejected with its own raw
   * "assigneeIds required".
   *
   * Self-exclusion is not a permission check. A self-assigned task is a real
   * thing in legacy, created through the self-assign path with an approver
   * rather than by picking yourself out of this list.
   */
  async listAssignableEmployees(): Promise<Employee[]> {
    const viewerId = String(this.#ctx.employeeId);
    const employees = await this.listEmployees();
    return employees.filter((e) => String(e.id) !== viewerId);
  }

  async listEmployees(): Promise<Employee[]> {
    const map = await this.#employeesById();
    return [...map.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  /**
   * The score, from the engine.
   *
   * A refusal is **not** an empty score. The engine scopes this endpoint — a TL
   * may only read their own department — so a 403 means "not yours to see",
   * which must not render as a person with no performance. It throws; a card
   * showing zero would be a false statement about somebody's work.
   */
  async getScoreOverview(employeeId?: EmployeeId): Promise<ScoreOverview> {
    const id = String(employeeId ?? this.#ctx.employeeId);
    const token = await this.#token();
    const result = await fetchDashboard({ token, employeeId: id });
    if (!result.ok) throw new Error(result.error.message);
    return toScoreOverview(result.data, id);
  }

  /**
   * Tasks, from the engine.
   *
   * Filtering happens **here**, not on the engine: `list-hierarchy` takes no
   * query parameters, so scope, status and search are applied to what it
   * returns. Sorting and pagination likewise. That is honest about where the
   * work happens and keeps the engine's contract untouched.
   */
  async listTasks(q: TaskQuery): Promise<Page<TaskView>> {
    const employeesById = await this.#employeesById();
    const viewerId = String(this.#ctx.employeeId);
    const nowMs = Date.now();

    /* Read the SAME documents, with the SAME role-dependent queries, as
       `cowork-old-frontend`'s task page — see `lib/legacy-ui/useCoworkTaskList.js`,
       ported verbatim from it.

       Firestore rather than `GET /cowork/task/list-hierarchy`, because the old
       app reads tasks from Firestore and its visibility rules live in the
       QUERIES: an employee sees `assigneeIds array-contains me`, a TL and a CEO
       additionally see `assignedBy == me`, and a CEO also sees
       `approverId == me`. Firestore has no OR across fields, so that is three
       listeners merged by id — and the API endpoint expresses none of it.

       One-shot `getDocs` rather than a live listener: `listTasks` is a promise,
       and `useQuery` re-runs it whenever a mutation invalidates. The live
       version is `useCoworkTaskList`, for surfaces that want push. */
    const docs = await this.#taskDocuments(viewerId);
    let legacyTasks = docs
      .map((raw) => readTask(raw))
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .filter((t) => !t.isDeleted);

    /* Scope is decided on the RAW assignee ids, before the directory is
       consulted.
       It used to be decided on the RESOLVED `assignees`, which are directory
       lookups — so a task assigned to somebody absent from `cowork_employees`
       resolved to an empty list, failed `isMine`, and disappeared from "my
       tasks" entirely. A directory gap must cost a name on screen, never a
       whole task. */
    const assignedToMe = (t: { assigneeIds: string[] }) =>
      t.assigneeIds.includes(viewerId);
    /**
     * Assigned to me, INCLUDING work a cross-department gate is still holding.
     *
     * A task held at the gate is created with **empty `assigneeIds`** and the
     * target parked in `pendingAssigneeId` (`taskForward.js:338`). So
     * `assignedToMe` is false for the very person it is for, and My Tasks —
     * which filters on it — showed them nothing. The task was visible to the
     * sender and to both department heads, and invisible to the one person
     * waiting to receive it.
     *
     * This is the receiving half of the same trade the visibility filter above
     * already makes for the other three parties. It widens nothing: the gate
     * still holds the work, the status is still `pending_approval`, and nobody
     * gains an action they did not have.
     */
    const assignedOrPendingToMe = (t: {
      assigneeIds: string[];
      pendingAssigneeId: string | null;
    }) => assignedToMe(t) || t.pendingAssigneeId === viewerId;
    /* The CEO sees every submission (`page.js:1019`) — the only role clause in
       the tab, and the reason a CEO's Submitted list is not merely their own. */
    const isCeo = String(this.#ctx.legacyRole ?? "") === "ceo";

    /* **Scope the gate query before anything else reads it.**
     *
     * `#taskDocuments` fetches every `pending_department_approval` task in the
     * organisation, because Firestore cannot filter on a field inside
     * `departmentApprovals[]`. Unscoped, that is a straight permission leak —
     * every employee would see every held task company-wide, including titles
     * and who they are for.
     *
     * So a held task survives only for the three people legacy shows it to:
     * the sender, the approvers, and the person it is being assigned to. The
     * old page reaches the same set (`page.js:6932`) by filtering the same
     * org-wide listener. */
    /**
     * Who manages the person each BUDGET-gated task is for.
     *
     * Resolved before the filter because the scoping below needs it and a
     * `filter` cannot await. One memoised tree read and then map lookups —
     * `#assigneeManagerId` is the product’s source of truth for who manages
     * whom, and the same relationship `budgetOwner` is built from, so the row
     * a manager can see and the approval they are offered cannot disagree.
     */
    const budgetTargetOf = (t: {
      pendingAssigneeId: string | null;
      assigneeIds: string[];
    }) => t.pendingAssigneeId ?? t.assigneeIds[0] ?? "";
    /**
     * A tree manager id, back in COWORK id space.
     *
     * `ReportingNode.managerId` is the HR record’s `biometricId`, which for
     * fifteen of sixteen people is also their Cowork id — and for the CEO is
     * not: they sign in as `E000` and HR calls them `GR0000`, two records in
     * two stores sharing no key. Comparing the raw value against `viewerId`
     * would therefore hide a budget-gated task from precisely one person: the
     * one who manages somebody reporting to the top of the company. Same trap
     * `getViewer` documents, resolved the same way rather than left to the
     * fifteen cases where it happens not to matter.
     */
    const toCoworkId = (hierarchyId: string | null): string | null => {
      if (!hierarchyId) return null;
      if (employeesById.has(hierarchyId)) return hierarchyId;
      return fromHierarchyId(hierarchyId)[0] ?? null;
    };
    const budgetManagerByTarget = new Map<string, string | null>();
    await Promise.all(
      [...new Set(
        legacyTasks
          .filter((t) => t.status === "pending_tl_hours")
          .map(budgetTargetOf)
          .filter((id) => id !== ""),
      )].map(async (id) =>
        budgetManagerByTarget.set(
          id,
          toCoworkId(await this.#assigneeManagerId(id)),
        ),
      ),
    );

    legacyTasks = legacyTasks.filter((t) => {
      if (t.status === "pending_department_approval") {
        if (t.createdById === viewerId) return true;
        if (t.pendingAssigneeId === viewerId) return true;
        return t.departmentApproverIds.includes(viewerId);
      }
      /* The BUDGET gate, scoped for the same reason as the one above — its
         query is org-wide because the responsible person is recorded nowhere
         on the document — and to the same people, PLUS the one who can
         actually clear it: the manager of the person the work is for. That
         last clause is the whole fix. Everyone else already had a route to
         the task and they had none, which is why it reached them only as a
         notification.

         Visibility here is the reporting relationship; the ACTION is narrower
         and stays where it was — `pendingApprovalsFor` offers the form only to
         the assignee’s own manager, and the engine 403s anybody else. */
      if (t.status === "pending_tl_hours") {
        if (t.createdById === viewerId) return true;
        /* The person it is FOR, by either route: the gate parks them in
           `pendingAssigneeId`, but a task created straight into this state
           can carry them in `assigneeIds`. */
        if (t.pendingAssigneeId === viewerId) return true;
        if (t.assigneeIds.includes(viewerId)) return true;
        if (t.departmentApproverIds.includes(viewerId)) return true;
        return budgetManagerByTarget.get(budgetTargetOf(t)) === viewerId;
      }
      return true;
    });

    /* The old task page's own tab predicates, from `page.js:6016-6040`.
       These were approximations before, and each approximation dropped or
       added real rows:

       · `mine` filtered `status !== "draft"` — a status the engine has never
         written. Legacy's held states are `pending_tl_approval`,
         `pending_department_approval`, `pending_tl_hours` and
         `repeat_pending_confirmation`; none was excluded, and "draft" excluded
         nothing. The filter did nothing at all.
       · `assigned_out` required `!assignedToMe`, so a task somebody created
         AND was working on vanished from their Created tab. Legacy excludes
         only self-assigned tasks there, and by a different rule. */
    /* ── Root-only, with the hierarchy consulted ────────────────────────────
     *
     * `page.js:6010-6012` strips non-root tasks BEFORE the tab predicates, and
     * the rule is role-dependent:
     *
     * · an employee keeps roots, forward-created tasks, and any task whose
     *   parent is not in the loaded set — an orphan is shown rather than
     *   hidden, because its parent being out of reach is not a reason to lose
     *   the work;
     * · a TL or CEO keeps roots only;
     * · **Submitted keeps everything**, because submissions live on subtasks —
     *   stripping them would empty the tab.
     *
     * Without this, every subtask appeared as its own top-level row and the
     * list showed the same work several times over. */
    /*
     * The viewer's live queue positions, computed BEFORE any tab or scope
     * filter narrows the set.
     *
     * It has to be here. Every filter below answers "what does this tab show",
     * and a position derived after one of them would be a rank within a tab —
     * so the same task would read P1 in Submitted and P4 in My Tasks, and both
     * would be wrong. The queue is a property of the person, not of the screen
     * they are looking at.
     *
     * Derived rather than stored: see `activeQueue.ts`. Closing a task
     * renumbers nothing on disk, so there is no write to race and every viewer
     * computes the same positions from the same stored ranks.
     */
    /* Once for the whole page, and BEFORE the queue is built: workability is a
       sort key, so the entries need it. Each row needs the index too, and forty
       rows fetching it separately would be forty round trips for one screen. */
    const outputIndex = await this.#outputIndex();

    const myQueueEntries = legacyTasks
      /* `holdersOf`, not `assigneeIds`: a cross-department task waiting at
         the gate keeps its person in `pendingAssigneeId` with an EMPTY
         `assigneeIds`, so it was missing from its own assignee's queue. */
      .filter((t) =>
        holdersOf({
          assigneeIds: t.assigneeIds,
          pendingAssigneeIds: t.pendingAssigneeId ? [t.pendingAssigneeId] : [],
        }).includes(viewerId),
      )
      .map((t) => ({
        taskId: t.id,
        /* The DOMAIN status, via the same mapper the view uses. The raw field
           is legacy's vocabulary — `done`, `open`, `pending_tl_approval` —
           and legacy leaves `status` at `open` through an entire review
           cycle while `completionStatus` moves. Testing the raw string would
           have kept approved work in the queue for ever, which is the bug
           this is here to fix. */
        status: toTaskStatus(t),
        /* The shared resolver, not a fifth copy of legacy's expression —
           the list must sort by exactly the number the screen shows. */
        storedRank: resolveTaskPriority(t, viewerId),
        order: t.order,
        createdAtMs: t.createdAtMs,
        /* Out of the queue until the hours are agreed — a task can be
           `assigned` while its budget is still being negotiated. */
        budgetState: t.budgetNegotiation?.state ?? null,
        /* And out of it until the assignee has accepted. Unaccepted work is
           not yet workload, and letting it hold a slot ranks accepted work
           behind something that may never be accepted. */
        accepted: t.confirmedByIds.includes(viewerId),
        /* A broken-down task is a project, not workload — see
           `#activeQueueOf`, which excludes it for the identical reason. */
        isContainer: t.subtaskIds.length > 0,
        /**
         * Can anything on this task be started?
         *
         * False only when EVERY declared output is waiting on somebody else's
         * approval. It keeps its place in the queue and its stored rank; it
         * simply sorts below work that can be started, so the next task becomes
         * P1 and this one P2 until its input lands.
         *
         * A task with no outputs is workable — every task that predates them.
         */
        isWorkable: taskIsWorkable(t, outputIndex.approved),
        /* Not a queue property — it decides only whether this viewer is worth
           sweeping for a restore. A queue with no outputs anywhere can neither
           be blocked nor have been pushed. */
        hasOutputs: t.outputs.length > 0,
      }));
    const myQueue = activeQueuePositions(myQueueEntries);
    /* The badge moved; the DEADLINE has to move with it. Fire-and-forget, and
       never awaited — see `#cascadeBlockedDeadlines`. */
    void this.#syncQueueDeadlines(viewerId, myQueueEntries, myQueue);
    /* The viewer's own SEPARATE sequence for work not yet accepted or
       budget-settled — see `provisionalQueuePositions`. Computed from the
       SAME entries so the two sequences can never disagree about which task
       is a container or what its stored rank is. */
    const myProvisionalQueue = provisionalQueuePositions(myQueueEntries);

    /* Chained once for the whole list, not per row. The order is the derived
       queue, so the dates agree with the positions shown beside them. */
    const myDueDates = await this.#chainQueue(
      viewerId,
      [...myQueue.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id),
      legacyTasks,
    );

    const byId = new Map(legacyTasks.map((t) => [t.id, t]));
    if (q.scope !== "submitted" && !q.includeSubtasks) {
      legacyTasks = legacyTasks.filter((t) => {
        if (!t.parentTaskId) return true;
        /*
         * **Work you hold or raised is never rolled up into its parent.**
         *
         * The two clauses below are legacy's, and they belong to legacy's
         * TREE: the old list rendered a parent row you could expand, so
         * collapsing a child into it lost nothing. A caller with no tree has
         * nowhere to put a child, so every subtask those clauses dropped
         * simply ceased to exist on screen — and the role clause dropped them
         * UNCONDITIONALLY, so a TL or CEO assigned a subtask never saw it in
         * any tab. Somebody breaks work out, the confirmation succeeds, and
         * the task is nowhere.
         *
         * A parent is still a legitimate stand-in for children that are
         * somebody else's business. It is never a stand-in for your own.
         *
         * A caller that CAN nest asks for `includeSubtasks` and skips this
         * block entirely — see `TaskQuery.includeSubtasks` for why that is not
         * simply the default.
         */
        if (assignedOrPendingToMe(t) || t.createdById === viewerId) return true;
        /**
         * **A decision you owe is your own business too.**
         *
         * The clause below rolls a child up into its parent for anybody it does
         * not belong to — and for a TL or the CEO it does so unconditionally.
         * That is right for work somebody else is doing inside a folder, and
         * wrong for the one case where the child is waiting on the reader
         * personally.
         *
         * A self-assigned task inside a project is exactly that case: it is
         * raised by, and assigned to, the person doing it, so both clauses
         * above name THEM — while the hours are decided by their manager, who
         * is usually a TL and is therefore dropped here without appeal. Their
         * Actionable tab said "Nothing waiting on you" while the task said
         * "Waiting for {manager} to decide".
         *
         * Nothing is widened: a manager who is not being waited on still sees
         * the parent stand in for the child, exactly as before.
         */
        if (t.budgetNegotiation?.waitingForId === viewerId) return true;
        if (isCeo || String(this.#ctx.legacyRole ?? "") === "tl") return false;
        return t.isForwardedTask || !byId.has(t.parentTaskId);
      });
    }

    /* A parent counts as mine when a descendant is, so work reached through a
       subtask is not lost when the parent alone fails the predicate
       (`page.js:6021-6031`).

       A **forward-created** descendant does not count: once work is forwarded
       the original above it stays hidden, which is the whole point of
       forwarding. `visited` guards a cycle — `subtaskIds` is written by the
       engine and a malformed chain must not hang the list. */
    const hasAssignedDescendant = (
      taskId: string,
      visited = new Set<string>(),
    ): boolean => {
      if (visited.has(taskId)) return false;
      visited.add(taskId);
      const t = byId.get(taskId);
      if (!t) return false;
      if (t.isForwardedTask) return false;
      if (t.assigneeIds.includes(viewerId) && t.createdById !== viewerId)
        return true;
      return t.subtaskIds.some((sid) => hasAssignedDescendant(sid, visited));
    };

    if (q.scope === "team") {
      /*
       * **My Team is a REPORTING question, and it had no branch at all.**
       *
       * `scope: "team"` fell through every filter, so the view showed whatever
       * the viewer's own three queries returned — their assignments, what they
       * created, and what they approve. A reportee's task was therefore visible
       * only while the viewer was an approver of it, and the org-wide
       * `pending_department_approval` fetch is what surfaced it. Approving
       * changes the status, that fetch stops matching, and the task vanished at
       * the moment the reportee began work on it.
       *
       * Fetched separately because filtering cannot help: those documents were
       * never in the set. `array-contains-any` caps at 30, so a wide
       * organisation is queried in chunks.
       */
      const tree = await this.#reportingTree();
      const reach = [...reportingSubtree(tree, viewerId)];
      const { collection, getDocs, query, where } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");

      const chunks: string[][] = [];
      for (let i = 0; i < reach.length; i += 30) {
        chunks.push(reach.slice(i, i + 30));
      }

      const snaps = await Promise.all(
        chunks.map((ids) =>
          getDocs(
            query(
              collection(legacyDb(), "cowork_tasks"),
              where("assigneeIds", "array-contains-any", ids),
            ),
          ),
        ),
      );

      /* Merged by id with what the viewer could already see, so a task held at
         a gate — where the person is in `pendingAssigneeId` and NOT in
         `assigneeIds`, so the query above cannot find it — is not lost. That
         stage is precisely when a receiving manager most needs it. */
      const byId = new Map(legacyTasks.map((t) => [t.id, t]));
      for (const snap of snaps) {
        for (const d of snap.docs) {
          const t = readTask({ ...d.data(), id: d.id });
          if (t && !t.isDeleted && !byId.has(t.id)) byId.set(t.id, t);
        }
      }

      /*
       * **May-I-see-it and is-it-my-team's are different questions.**
       *
       * This filtered on `canManagerViewTask` alone, and that predicate reads
       * `reportingSubtree`, which seeds itself with the manager — correctly, for
       * a permission check: a manager may of course view their own task. Used as
       * the SCOPE filter it also let their own assignments into "My team", so a
       * manager looking at what their reports are carrying found their own work
       * in the list, and on the grouped view, a group under their own name.
       *
       * Permission is still the first test, unchanged. The second says the task
       * is somebody else's: at least one of the people holding it is not the
       * viewer. A task held jointly by a manager and a report stays — it is
       * genuinely the report's work too.
       */
      const heldByAnother = (t: { assigneeIds: string[]; pendingAssigneeId?: string | null }) =>
        [...t.assigneeIds, ...(t.pendingAssigneeId ? [t.pendingAssigneeId] : [])]
          .some((id) => String(id) !== viewerId);

      legacyTasks = [...byId.values()].filter(
        (t) =>
          canManagerViewTask(
            viewerId,
            {
              assigneeIds: t.assigneeIds,
              pendingAssigneeIds: t.pendingAssigneeId
                ? [t.pendingAssigneeId]
                : [],
            },
            tree,
          ) && heldByAnother(t),
      );
    } else if (q.scope === "mine") {
      legacyTasks = legacyTasks.filter((t) => {
        /* A self-assigned task is "assigned to me" only when I raised it. */
        if (t.isSelfAssigned)
          return assignedToMe(t) && t.createdById === viewerId;
        /* Work someone else gave me — including work still held at a
           cross-department gate, which is addressed to me and simply has not
           landed yet. */
        if (assignedOrPendingToMe(t) && t.createdById !== viewerId) return true;
        /* …or a parent of work that is mine. */
        return hasAssignedDescendant(t.id);
      });
    } else if (q.scope === "assigned_out") {
      legacyTasks = legacyTasks.filter((t) => {
        /* On a self-assigned task the creator is the requester; the people who
           see it under Created are the approver and anyone named on it. */
        if (t.isSelfAssigned)
          return t.approverId === viewerId || t.visibleTo.includes(viewerId);
        if (t.createdById === viewerId) return true;
        /* A TL who supplied the hours owns the task's progress even though
           they did not create it. */
        return t.tlHoursSetBy === viewerId;
      });
    } else if (q.scope === "self_assigned") {
      /* `page.js:6040` — Self Tasks is exactly this pair. */
      legacyTasks = legacyTasks.filter(
        (t) => t.isSelfAssigned && assignedToMe(t),
      );
    } else if (q.scope === "submitted") {
      /* `page.js:1015` — `isInSubmittedTab`.
         Note what it does NOT check: the tab is deliberately not "tasks I
         submitted". It is every submission I am party to, whether I sent it or
         owe it a decision, which is why the reviewer clauses are ORed in. */
      legacyTasks = legacyTasks.filter((t) => {
        if (!t.completionStatus) return false;
        if (!SUBMITTED_LIFECYCLE.has(t.completionStatus)) return false;
        if (t.status === "cancelled") return false;
        if (isCeo) return true;
        if (assignedToMe(t)) return true;
        if (t.submittedById === viewerId) return true;
        if (t.createdById === viewerId) return true;
        if (t.originalAssignedBy === viewerId) return true;
        return t.tlHoursSetBy === viewerId;
      });
    }

    /* **Priority is a property of the PERSON, not the viewer.**
     *
     * This attached only the VIEWER's derived queue to every row
     * (`ownerId: viewerId`). So when a manager listed a report's task, the
     * per-assignee gate in `toTaskView` left the report's `queuePosition` null
     * and the badge fell through to the report's RAW stored rank — the gaps and
     * duplicates a completed task leaves behind (stored 1, 2, 4) — while the
     * report, viewing their OWN list, saw the derived gap-free 1, 2, 3. Same
     * task, two different P-numbers and two different orders.
     *
     * So compute each SUBJECT's active queue — exactly as the detail page does
     * via `#activeQueueOf` — and give every row its own subject's positions. The
     * viewer's own queue is already computed as `myQueue`/`myDueDates`, so it is
     * reused rather than re-fetched; only OTHER people's queues cost a read, one
     * per distinct report in the list, run in parallel. */
    const subjectOf = (t: (typeof legacyTasks)[number]): string | null => {
      const holders = holdersOf({
        assigneeIds: t.assigneeIds,
        pendingAssigneeIds: t.pendingAssigneeId ? [t.pendingAssigneeId] : [],
      });
      return holders.includes(viewerId) ? viewerId : (holders[0] ?? null);
    };
    const queuesBySubject = new Map<
      string,
      {
        ownerId: string;
        positions: Map<string, number>;
        provisionalPositions: Map<string, number>;
        dueDates: Map<string, string>;
      }
    >([
      [
        viewerId,
        {
          ownerId: viewerId,
          positions: myQueue,
          provisionalPositions: myProvisionalQueue,
          dueDates: myDueDates,
        },
      ],
    ]);
    const otherSubjects = [
      ...new Set(
        legacyTasks
          .map(subjectOf)
          .filter((id): id is string => id !== null && id !== viewerId),
      ),
    ];
    await Promise.all(
      otherSubjects.map(async (subjectId) => {
        try {
          const q = await this.#activeQueueOf(subjectId);
          queuesBySubject.set(subjectId, {
            ownerId: subjectId,
            positions: new Map(q.order.map((id, i) => [id, i + 1])),
            provisionalPositions: q.provisionalPositions,
            dueDates: q.dueDates,
          });
        } catch {
          /* One report's failed queue read means their rows fall back to the
             stored rank — better than failing the whole list. Same tolerance the
             detail path uses. */
        }
      }),
    );

    /* Parents by id, from the documents ALREADY loaded — so a task can name the
       project it sits in without a read per row. Folders are still in this set
       at this point; they are filtered out of the RESULT further down, which is
       a different thing from not having fetched them. */
    const docsById = new Map(legacyTasks.map((t) => [String(t.id), t]));

    let views = legacyTasks.map((legacy) => {
      const subjectId = subjectOf(legacy);
      return toTaskView({
        legacy,
        employeesById,
        viewerId,
        nowMs,
        /* Only to name the container — `toTaskView` reads nothing else off it
           here, and the detail path passes a fully-read parent for the rest. */
        projectParent: legacy.parentTaskId
          ? (docsById.get(String(legacy.parentTaskId)) ?? null)
          : null,
        approvedOutputIds: outputIndex.approved,
        outputLabels: outputIndex.labels,
        /* The ROW's subject queue — the person who actually holds this task — so
           the derived, gap-free 1..N a manager sees is identical to what the
           report sees on their own list, and the operational date agrees too.
           Falls back to undefined (→ stored rank) only when unresolved. */
        queue: (subjectId && queuesBySubject.get(subjectId)) || undefined,
        viewerLegacyRole: this.#ctx.legacyRole,
        /* **Supplied on the list path too, not only on the detail page.**
           `pendingApprovalsFor` produces the `effort_estimate` approval only
           when it is handed the assignee’s manager, so without this the row
           reached the viewer and still carried no obligation — the Actionable
           inbox, whose membership is decided by `actionableFor` reading exactly
           that approval, stayed empty on a task plainly waiting for them.
           Resolved above from the memoised tree, so this costs no round trip
           per row. */
        budgetOwner:
          legacy.status === "pending_tl_hours"
            ? (employeesById.get(
                budgetManagerByTarget.get(budgetTargetOf(legacy)) ?? "",
              ) ?? null)
            : null,
      });
    });

    if (q.status?.length) {
      const wanted = new Set(q.status);
      views = views.filter((v) => wanted.has(v.task.status));
    }
    if (q.assigneeId) {
      const wanted = String(q.assigneeId);
      /* `v.assignees` is resolved against the employee directory and may be
         empty when the directory lookup misses; `v.assignments` is built
         directly from the task document and is always authoritative. */
      views = views.filter((v) =>
        v.assignments.some((a) => a.employeeId === wanted) ||
        v.task.createdById === wanted,
      );
    }
    /*
     * **This never existed, and every project's task table showed the whole
     * scope regardless of which project the reader opened.** `TaskTable`
     * passes `projectId` straight through expecting it to narrow the list;
     * nothing here ever read it, so it silently did nothing.
     *
     * A project IS a broken-down task (`#projectFromContainer`), so its id is
     * that task's id, and "this project's tasks" is exactly the set
     * `#projectFromContainer` already builds `taskLinks` from: the container's
     * own subtasks. Filtering on `parentTaskId` is what keeps this in
     * lock-step with `taskLinks` and with `pr.totalTasks` — three readings of
     * one relationship, not three.
     *
     * The container's OWN row is excluded on purpose. The reader is already on
     * that task's page; repeating it as a row inside its own task list would
     * say nothing a heading does not already say.
     */
    if (q.projectId) {
      const wanted = String(q.projectId);
      views = views.filter(
        (v) => String(v.task.parentTaskId ?? "") === wanted,
      );
    }
    if (q.overdueOnly) views = views.filter((v) => v.isOverdue);
    if (q.search) {
      const needle = q.search.toLowerCase();
      views = views.filter((v) => v.task.title.toLowerCase().includes(needle));
    }

    /* **Surface the extension decisions the viewer owns.**
     *
     * Both a time-budget extension (`cowork_task_budget_extensions`) and a
     * deadline extension (`cowork_task_deadline_extensions`) live in their own
     * collections that the task document never references — and a deadline
     * extension, unlike the initial proposal, does not even flip the task's
     * status. So a manager was NEVER told a report had asked for more time or a
     * later date: the request only ever appeared on the task detail, which the
     * manager had no reason to open. One query per collection for everything
     * waiting on THEM, then the matching tasks are flagged so `nextAction`
     * routes them into "Awaiting your decision" beside review decisions.
     *
     * Filtered by `approverId`, so a task is flagged only for the person the
     * record actually routed to — under cross-department rules that is the
     * assignee's primary manager, not the creator. */
    try {
      const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
      if (me && views.length) {
        const { collection, getDocs, query, where } = await import(
          "firebase/firestore"
        );
        const { legacyDb } = await import("../../legacy/firebase.ts");
        const pendingFor = async (name: string): Promise<Set<string>> => {
          const snap = await getDocs(
            query(collection(legacyDb(), name), where("approverId", "==", me)),
          );
          return new Set(
            snap.docs
              .map((d) => d.data() as Record<string, unknown>)
              .filter(
                (x) =>
                  x.status === "pending" || x.status === "counter_proposed",
              )
              .map((x) => String(x.taskId)),
          );
        };
        const [budgetToDecide, deadlineToDecide] = await Promise.all([
          pendingFor("cowork_task_budget_extensions"),
          pendingFor("cowork_task_deadline_extensions"),
        ]);
        if (budgetToDecide.size || deadlineToDecide.size) {
          for (const v of views) {
            const id = String(v.task.id);
            const vv = v as {
              budgetDecisionPending?: boolean;
              deadlineDecisionPending?: boolean;
            };
            if (budgetToDecide.has(id)) vv.budgetDecisionPending = true;
            if (deadlineToDecide.has(id)) vv.deadlineDecisionPending = true;
          }
        }
      }
    } catch (e) {
      /* Non-fatal: the list still renders, just without the decision flags. */
      console.error("[listTasks] extension-decision flags:", e);
    }

    /**
     * **A project is not work, so it is not in a list of work.**
     * OWNER CLARIFICATION: assigning a project assigns the PROJECT, not the
     * tasks under it.
     *
     * A folder is stored as a task — that is how the engine models it — so it
     * has always been returned here alongside real tasks. It went unnoticed
     * while folders had no assignee: `scope: "mine"` matches on
     * `assigneeIds array-contains me`, so an unassigned folder could never
     * appear in anybody's own list.
     *
     * The moment a project can be assigned, it does. It would show in that
     * person's Tasks as a thing to do, and worse, the engine stamps a priority
     * rank on every task it creates — so assigning a project would take a queue
     * position and push everyone's P-numbers down for work nobody can do,
     * because a folder has no timer and nothing to submit.
     *
     * Filtered here rather than in each screen so no list can forget. Opt in
     * with `includeFolders`, which is precisely what `listProjects` does — it
     * needs the containers, and it is the only caller that does.
     */
    if (!q.includeFolders) views = views.filter((v) => !v.task.isFolder);

    views.sort(comparerFor(q.sort));

    const total = views.length;
    const limit = q.limit ?? total;
    return { items: views.slice(0, limit), nextCursor: null, total };
  }

  /**
   * One task, by id.
   *
   * **The id in the URL is the Firestore document id and the `taskId` field —
   * they are the same string.** `taskForward.service.js:378` writes with
   * `.doc(taskId).set(task)`, so there is no mapping to do and no second
   * identifier to reconcile. Verified against T620 in production: `docId ===
   * taskId`.
   *
   * This method simply did not exist, and that is the whole of the "Task not
   * found" bug. The repository proxy throws `NotConnectedError` for anything
   * unimplemented, so every detail page failed identically no matter which
   * task was opened — the list and the detail were never inconsistent about
   * ids, one of them was just never wired.
   *
   * `null` is reserved for a document that genuinely is not there. A read that
   * fails for any other reason throws, so the page can tell "deleted" from
   * "could not ask".
   */
  async getTask(id: TaskId): Promise<TaskView | null> {
    return this.#readTaskView(String(id));
  }

  /**
   * A task's children, as documents.
   *
   * **Two sources, unioned, and the redundancy is the point.** `subtaskIds` is
   * the array the engine maintains with `arrayUnion`, and it is what the rest
   * of the engine reads — but it lives on a DIFFERENT document from the child,
   * written by a second `update()` after the child's `set()`. A subtask whose
   * parent update failed, a parent moved between folders, a document imported
   * without the array: in every one of those the child exists, names its
   * parent, and is missing from the list. That is a task nobody can see.
   *
   * So the array is unioned with `where("parentTaskId", "==", id)`. The earlier
   * note here said that query "would need another composite index" — it does
   * not: it is a single-field equality filter, which Firestore indexes
   * automatically. Nothing had to be given up to close the gap.
   *
   * Deleted children are dropped, and a failure of either source leaves the
   * other's answer standing rather than emptying the list.
   */
  async #childDocs(parentId: string, knownIds: string[]): Promise<LegacyTask[]> {
    const { collection, doc, getDoc, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const db = legacyDb();
    const byId = new Map<string, LegacyTask>();

    const keep = (data: Record<string, unknown>, id: string) => {
      const t = readTask({ ...data, id } as never);
      /* A cancelled child still counts — `completionState` filters those
         itself, and dropping them here would hide the record of work that was
         called off. Only a DELETED document is gone. */
      if (t && !t.isDeleted) byId.set(t.id, t);
    };

    const [snaps, found] = await Promise.all([
      Promise.all(
        knownIds.map((childId) =>
          getDoc(doc(db, "cowork_tasks", childId)).catch(() => null),
        ),
      ),
      getDocs(
        query(
          collection(db, "cowork_tasks"),
          where("parentTaskId", "==", parentId),
        ),
      ).catch((e: unknown) => {
        console.error(`[childDocs] ${parentId}: parentTaskId query:`, e);
        return null;
      }),
    ]);

    for (const snap of snaps) {
      if (snap?.exists()) keep(snap.data() as Record<string, unknown>, snap.id);
    }
    for (const d of found?.docs ?? []) {
      keep(d.data() as Record<string, unknown>, d.id);
    }

    /* Creation order, so the Subtasks list does not reshuffle between reads —
       the two sources arrive in different orders and a set has none of its
       own. Id is the tie-break for documents with no timestamp. */
    return [...byId.values()].sort(
      (a, b) =>
        (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0) || a.id.localeCompare(b.id),
    );
  }

  /** One raw task document, or null. Used where a `TaskView` is too much. */
  async #taskDoc(taskId: string): Promise<LegacyTask | null> {
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", taskId));
    if (!snap.exists()) return null;
    return readTask({
      ...(snap.data() as Record<string, unknown>),
      id: snap.id,
    } as never);
  }

  /**
   * A task's children, as views.
   *
   * The parent and the sibling set are read ONCE and handed to every child, so
   * a project with five subtasks does not read its own document six times to
   * answer the same question about each of them.
   */
  async getSubtasks(id: TaskId): Promise<TaskView[]> {
    const parentId = String(id);
    const parent = await this.#taskDoc(parentId);
    if (!parent) return [];

    const children = await this.#childDocs(parentId, parent.subtaskIds);
    if (children.length === 0) return [];

    const views = await Promise.all(
      children.map((child) =>
        this.#readTaskView(child.id, {
          parent,
          parentSubtasks: children,
        }).catch(() => null),
      ),
    );
    return views.filter((v): v is TaskView => v !== null);
  }

  /* ── Task writes ────────────────────────────────────────────────────────
   *
   * Every one of these is an HTTP call to the engine. **No task write in this
   * application touches Firestore**, even though every task READ does — see
   * the header of `lib/legacy/taskWrites.ts` for why the asymmetry is correct
   * rather than an inconsistency.
   *
   * They share `#write`, which turns a `LegacyResult` into an `ActionResult`
   * and then re-reads the task. The re-read is not ceremony: the engine
   * decides `status`, `taskId`, `priority` and the approval gate, so the only
   * honest way to report what happened is to ask what the document now says.
   */

  /**
   * A legacy mutation as an `ActionResult`, with the task re-read after.
   *
   * `taskId` may be null for a create, where the id is not known until the
   * engine answers.
   */
  async #write<T>(
    run: (token: string) => Promise<LegacyResult<T>>,
    taskIdOf: (data: T) => string | null,
    /**
     * People who held the task BEFORE this write, where the write can move it
     * between them.
     *
     * The one thing this method cannot work out for itself: after a reassignment
     * the read-back names the NEW holders, and the person losing the work is gone
     * from the document. Their queue still has a gap where the task was, so they
     * have to be named by the caller — and a test asserts that any method
     * changing assignees does.
     */
    priorHolders: string[] = [],
  ): Promise<ActionResult<Task>> {
    const token = await this.#token();
    const result = await run(token);
    if (!result.ok) {
      return {
        ok: false,
        /* The engine's own refusal, mapped rather than restated. A gate
           declining an assignment is `permission_denied`, not a validation
           failure, and the two are actioned differently on screen. */
        code:
          result.error.kind === "permission"
            ? "permission_denied"
            : result.error.kind === "not_found"
              ? "not_found"
              : "validation_failed",
        message: result.error.message,
      };
    }

    const taskId = taskIdOf(result.data);
    if (!taskId) {
      return {
        ok: false,
        code: "validation_failed",
        message:
          "The engine accepted the change but did not say which task it applied to.",
      };
    }

    const view = await this.#readTaskView(taskId);
    if (!view) {
      return {
        ok: false,
        code: "not_found",
        message: `The engine accepted the change but task ${taskId} could not be read back.`,
      };
    }
    /*
     * **Renumber the affected queues, here, so no caller has to remember.**
     *
     * Every task lifecycle mutation funnels through this method — 22 call sites,
     * including acceptance, completion, review, budget changes and creation. A
     * normalise bolted onto each one is 22 chances to forget, and the one that
     * was forgotten is where duplicates come back.
     *
     * AFTER the engine write and after the read-back, never before and never
     * during a read: normalisation is a consequence of a change that has already
     * landed. A write during a render is the race the brief rules out.
     *
     * Failure is deliberately swallowed. The mutation the caller asked for HAS
     * succeeded; reporting it as failed because a renumbering could not complete
     * would send somebody to do it again. `normalizePriorities` is idempotent, so
     * the next mutation — or an explicit repair — closes it.
     */
    await this.#normalizeAfterWrite(view, priorHolders);

    /* Push the change to every open query. The Firestore listeners will fire
       too, but only for documents matching this viewer's watched queries —
       a task created into a department gate has no assignees and matches
       none of them, so without this the creator would see nothing happen. */
    notifyRepositoryChanged();
    /* The `Task`, not the `TaskView` wrapping it. `NewTaskForm` navigates to
       `/tasks/${r.data.id}` on success, and a `TaskView` has no `id` — it has
       a `task` that does. Returning the wrapper sent every successful create
       to `/tasks/undefined`. */
    return { ok: true, data: view.task };
  }

  /**
   * Renumber every queue this write could have disturbed.
   *
   * Holders of the task as it now stands, plus anybody who held it before —
   * a reassignment leaves a gap in the queue of the person who lost the work,
   * and they are no longer named on the document.
   *
   * Each queue is normalised independently, because a rank is per person: moving
   * one task cannot renumber somebody else's day.
   */
  async #normalizeAfterWrite(
    view: TaskView,
    priorHolders: string[] = [],
  ): Promise<void> {
    const affected = new Set<string>(priorHolders.filter(Boolean));
    for (const a of view.assignments) affected.add(String(a.employeeId));
    for (const p of view.pendingAssignees) affected.add(String(p.id));

    for (const employeeId of affected) {
      try {
        await this.normalizePriorities(employeeId as EmployeeId);
      } catch (error) {
        /* Reported for a developer, not to the caller: their change landed. */
        console.error(
          `[normalizeAfterWrite] ${employeeId}'s queue could not be renumbered:`,
          error,
        );
      }
    }
  }

  /**
   * One task, read back through the same mapper the list uses.
   *
   * `preloaded` lets a caller that has already read this task's family supply
   * it — `getSubtasks` reads the parent and the sibling set once for the whole
   * list rather than once per child.
   */
  async #readTaskView(
    taskId: string,
    preloaded?: { parent?: LegacyTask | null; parentSubtasks?: LegacyTask[] },
  ): Promise<TaskView | null> {
    const legacy = await this.#taskDoc(taskId);
    if (!legacy) return null;
    const viewerId = String(this.#ctx.employeeId);

    /*
     * The family, because a task cannot describe its own place in it.
     *
     * Read HERE and not in the mapper, which is pure and shared with the list
     * path — fifty rows must not become fifty more round trips. The detail page
     * is one task, so it can afford to ask.
     *
     * Its absence is the whole of the vanishing-subtask fault: with no children
     * `completionState` reports `isProject: false` and `ProjectPanel` renders
     * no Subtasks section, and with no parent the child shows no
     * `ResponsibilityPanel`. The work was in Firestore the entire time.
     */
    const subtasks = await this.#childDocs(
      legacy.id,
      legacy.subtaskIds,
    ).catch((e: unknown) => {
      /* A failed hierarchy read must not fail the task. The task renders as a
         plain one, which is what it did before this existed. */
      console.error(`[readTaskView] ${taskId}: children could not be read:`, e);
      return [] as LegacyTask[];
    });

    let parent: LegacyTask | null = preloaded?.parent ?? null;
    let parentSubtasks: LegacyTask[] = preloaded?.parentSubtasks ?? [];
    if (legacy.parentTaskId && !parent) {
      try {
        parent = await this.#taskDoc(legacy.parentTaskId);
        if (parent) {
          parentSubtasks = await this.#childDocs(parent.id, parent.subtaskIds);
        }
      } catch (e) {
        console.error(`[readTaskView] ${taskId}: parent could not be read:`, e);
        parent = null;
        parentSubtasks = [];
      }
    }

    /*
     * The detail page derives a position too, from the SUBJECT's whole queue.
     *
     * It used to pass none, so a single task fell back to its stored rank —
     * and the same employee saw a derived P1 in their list and a stored P2 on
     * the task itself. One extra query buys agreement between the two screens,
     * and between the assignee and whoever else opens the task: the subject is
     * the viewer when they are assigned, otherwise the first assignee, so a
     * manager and an admin are shown the employee's real position rather than
     * the stored number behind it.
     *
     * Queried by assignee, so the set is complete for that person no matter
     * who is looking — which a viewer-scoped list can never guarantee.
     */
    /* PENDING COUNTS. A cross-department task at the gate has an empty
       `assigneeIds`, so this resolved to null and no queue was fetched at all
       — the task fell back to stored ranks, and the person actually holding it
       saw no position on their own work. */
    const holders = holdersOf({
      assigneeIds: legacy.assigneeIds,
      pendingAssigneeIds: legacy.pendingAssigneeId
        ? [legacy.pendingAssigneeId]
        : [],
    });
    const subjectId = holders.includes(viewerId)
      ? viewerId
      : (holders[0] ?? null);

    let queue:
      | {
          ownerId: string;
          positions: Map<string, number>;
          provisionalPositions: Map<string, number>;
          dueDates: Map<string, string>;
        }
      | undefined;
    if (subjectId) {
      try {
        const q = await this.#activeQueueOf(subjectId);
        queue = {
          ownerId: subjectId,
          positions: new Map(q.order.map((id, i) => [id, i + 1])),
          provisionalPositions: q.provisionalPositions,
          dueDates: q.dueDates,
        };
      } catch {
        /* A failed queue read must not fail the task. Without it the view falls
           back to stored ranks — a number that may lag, which is better than an
           unopenable task. */
        queue = undefined;
      }
    }

    /*
     * Who may set a time budget: the ASSIGNEE'S MANAGER.
     *
     * Read here rather than derived in the mapper because it is a reporting
     * question and the reporting line is not in the task document or the
     * directory snapshot — `my-managers` is one call per employee, so it is
     * made only for the one task being opened and only when a budget is
     * actually outstanding.
     *
     * It replaces a department-TL lookup. The two answer different questions:
     * a department lead owns "may this cross-department work happen", and a
     * manager owns "how many hours does this person get". Only the second is a
     * decision about an individual's work, and the endpoint now agrees.
     */
    const employeesById = await this.#employeesById();
    let budgetOwner: Employee | null = null;
    if (legacy.isSelfAssigned) {
      /* On a self task the budget's approver is the assignee's MANAGER — the
         assigner of record, which the derived negotiation already names as the
         one being waited on. Surfaced here so the negotiation card can say
         "waiting for {manager}" rather than leaving the turn unnamed (the creator
         and the assignee are the same person, so neither of those names them). */
      const mgrId = legacy.budgetNegotiation?.waitingForId ?? null;
      budgetOwner = mgrId ? (employeesById.get(String(mgrId)) ?? null) : null;
    } else if (legacy.status === "pending_tl_hours") {
      const target = legacy.pendingAssigneeId ?? legacy.assigneeIds[0] ?? null;
      if (target) {
        try {
          const token = await this.#token();
          const r = await fetchHierarchy({ token, employeeId: target });
          const managerId = r.ok ? (r.data.primaryManager?.employeeId ?? null) : null;
          budgetOwner = managerId ? (employeesById.get(managerId) ?? null) : null;
        } catch {
          /* A failed hierarchy read leaves the stage unnamed rather than
             failing the task or naming somebody it cannot verify. */
          budgetOwner = null;
        }
      }
    }

    /*
     * Time already banked on this task, read from the timer session.
     *
     * `loggedSecs` was hardcoded 0. It is DESIGNED as the sum of `WorkCommit`s
     * — but legacy writes no commits: `cowork_task_timers/{employee}/sessions/
     * {task}` accumulates into `totalSeconds` and that is the only record of
     * work done. So on this adapter the accumulator IS the committed work, and
     * zero was simply wrong.
     *
     * One zero caused three of the reported timer faults, because
     * `TimerControl` renders `view.loggedSecs + ticked`:
     *   · a paused session showed "0m" instead of its real total;
     *   · resuming counted from 00:00:01 rather than continuing;
     *   · a refresh appeared to lose the time, which was never lost — T634
     *     holds `totalSeconds: 152` and displayed nothing.
     *
     * Read for the ASSIGNEE, not the viewer, so a manager opening the task sees
     * the time the person actually worked rather than their own zero.
     */
    /* `holders`, for the same reason as the queue above: a task at the
       cross-department gate has an empty `assigneeIds`, so this resolved to
       null and no session was read at all. */
    const timeSubject = holders.includes(viewerId)
      ? viewerId
      : (holders[0] ?? null);
    let loggedSecs = 0;
    if (timeSubject) {
      try {
        const { getDoc } = await import("firebase/firestore");
        const snap = await getDoc(
          await this.#timerSession(timeSubject, legacy.id),
        );
        const data = snap.exists()
          ? (snap.data() as { totalSeconds?: unknown })
          : null;
        loggedSecs = Number(data?.totalSeconds) || 0;
      } catch {
        /* A timer read must not fail the task. Zero here is the same figure
           that was always shown, so a failure is no worse than before. */
        loggedSecs = 0;
      }
    }

    const detailOutputIndex = await this.#outputIndex();
    return toTaskView({
      legacy,
      employeesById,
      approvedOutputIds: detailOutputIndex.approved,
      outputLabels: detailOutputIndex.labels,
      viewerId,
      nowMs: Date.now(),
      queue,
      viewerLegacyRole: this.#ctx.legacyRole,
      budgetOwner,
      loggedSecs,
      subtasks,
      parent,
      parentSubtasks,
    });
  }

  /**
   * Create a task.
   *
   * **Only what the handler reads is sent.** `taskForward.js:137` does not
   * destructure `status`, `createdBy`, `createdByRole` or `dueDate` — it
   * computes all four. Sending them would describe an intention the engine
   * discards, and would read to a maintainer as though we chose them.
   */
  async createTask(input: CreateTaskInput): Promise<ActionResult<Task>> {
    const fixed = input.deadlineMode === "fixed";
    const viewerId = String(this.#ctx.employeeId);

    /* A self-assigned task is assigned to the person raising it.
     *
     * The picker cannot express this — it lists everyone EXCEPT the viewer,
     * exactly as legacy's does — so without this a self-assigned task would go
     * out with `assigneeIds: []` and be rejected by the engine's own
     * "assigneeIds required". Legacy's self-assign path sends `[me]` with
     * `isSelfAssigned: true` and an approver; so does this. */
    const selfAssigned = input.type === "self_assigned";
    const assigneeIds = selfAssigned
      ? [viewerId]
      : input.assigneeIds.map(String);

    if (assigneeIds.length === 0) {
      /* Refused HERE rather than at the engine. The engine's message is
         "assigneeIds required" — a field name, from a payload the reader never
         saw. Legacy says "Assign to at least one person."
         (`CreateTaskModal.jsx:681`) and says it before submitting. */
      return {
        ok: false,
        code: "validation_failed",
        field: "assigneeIds",
        message: "Assign to at least one person.",
      };
    }
    return this.#write(
      (token) =>
        createTaskRequest({
          token,
          body: {
            title: input.title,
            description: input.description ?? "",
            /* The tag, stored as given. Sent always rather than only when true
               so the field exists on the document and can be turned off again
               by writing `false` — see `Task.isImportant`. */
            isImportant: input.isImportant === true,
            notes: "",
            requirements: input.requirements ?? [],
            assigneeIds,
            parentTaskId: input.parentTaskId ?? null,
            /* `hasTimer: false` is what selects a fixed deadline; the engine
               then reads `fixedDeadline` and ignores it otherwise. */
            hasTimer: !fixed,
            fixedDeadline: fixed ? (input.fixedDueAt ?? null) : null,
            senderTimerWindowSecs: input.senderWindowSecs ?? 0,
            etcHours: input.estimatedEffortSecs
              ? input.estimatedEffortSecs / 3600
              : 0,
            approverId: input.approverId ?? null,
            /* From the chosen type, not inferred from the assignee list.
               Inferring it made any single-assignee task that happened to be
               mine self-assigned, which changes who the engine records as the
               assigner and puts it in a different tab. */
            isSelfAssigned: selfAssigned,
            /**
             * C2 · a goal task carries the share it claims.
             *
             * `isGoldTask` is the engine's own accounting key: `/cowork/c2/config`
             * sums `c2Config.weightagePercent` across tasks carrying it, and
             * `goal-credit` gates the C2 score cache on it. The Gold Task
             * CONCEPT is gone from the interface — every goal task scores C2,
             * so an opt-in was one state too many — but the flag is still set,
             * because a goal this app wrote must be counted in the same pool
             * the old app is counting.
             *
             * `globalMaxPointsAtCreation` is the snapshot: change the company
             * pool later and a task already agreed keeps what it was agreed
             * for.
             */
            ...(input.type === "goal" && input.c2WeightagePercent
              ? {
                  isGoal: true,
                  isGoldTask: true,
                  /**
                   * The old app's own field names, so a goal written here is
                   * readable by it rather than being a second shape.
                   *
                   * `goalDescription` is the GOAL STATEMENT, not the task's
                   * description — it used to be fed the description, which
                   * meant the outcome being aimed at and the work to be done
                   * were recorded as the same sentence. `deadline` is the
                   * target date, which used to be fed `fixedDueAt` and is now
                   * always null on a goal: a goal task carries no task-level
                   * deadline, so that field could only ever have been empty.
                   */
                  goalConfig: {
                    goalDescription: input.goalStatement ?? "",
                    deadline: input.goalDeadline ?? null,
                  },
                  c2Config: {
                    weightagePercent: input.c2WeightagePercent,
                    taskMaxPoints: taskMaxPointsFor(
                      input.c2WeightagePercent,
                      input.c2GlobalMaxPoints ?? 0,
                    ),
                    globalMaxPointsAtCreation: input.c2GlobalMaxPoints ?? 0,
                  },
                }
              : {}),
          },
        }),
      (task) => (typeof task.taskId === "string" ? task.taskId : null),
    );
  }

  async updateTask(
    id: TaskId,
    patch: { title?: string; description?: string | null; requirements?: string[] },
  ): Promise<ActionResult<Task>> {
    const taskId = String(id);
    return this.#write(
      (token) =>
        editTaskDetails({
          token,
          taskId,
          title: patch.title,
          description: patch.description ?? undefined,
          requirements: patch.requirements,
        }),
      () => taskId,
    );
  }

  /**
   * Change the due date, with the reason that moved it.
   *
   * **The mutation the due date never had.** `updateTask` sends `title`,
   * `description` and `requirements` — a changed date reached no endpoint at
   * all, so the form saved and the document did not move.
   *
   * The reason is refused here rather than at the engine when it is blank. The
   * route 400s on it (`taskForward.js:1365`) and the engine's bare message says
   * "reason required" without naming the field the form should highlight.
   *
   * Reading the task back through `#write` is what makes the new date appear
   * without a reload: the engine also rewrites `deadlineStatus`,
   * `deadlineColor` and appends to `deadlineHistory`, none of which the caller
   * could reconstruct.
   */
  async setTaskDeadline(
    id: TaskId,
    newDueAt: string | null,
    reason: string,
  ): Promise<ActionResult<Task>> {
    const taskId = String(id);
    if (!reason.trim()) {
      return {
        ok: false,
        code: "validation_failed",
        message:
          "A deadline change needs a reason. It is recorded in the task's deadline history, which is what makes a moved date accountable afterwards.",
        field: "reason",
      };
    }

    /**
     * **A fixed-deadline task cannot be moved by this route, and that is the
     * engine's defect rather than ours.**
     *
     * Legacy keeps a task's date in one of two fields and picks by mode —
     * `deadlineField = task.hasTimer === false ? "fixedDeadline" : "dueDate"`,
     * applied consistently in the rework and review paths
     * (`taskForward.service.js:1305, 1389`). Its own reader follows the same
     * precedence (`fixedDeadline || dueDate`, `:2132`).
     *
     * `editTaskDeadline` ignores that convention: it writes `dueDate`
     * unconditionally (`:1036`). On a `hasTimer === false` task the write lands
     * in a field every reader passes over, so the date does not move — in the
     * old app either. Sending it anyway would report success for a change
     * nobody will ever see, which is the exact failure being fixed here.
     *
     * So it is refused, with the reason. Writing `fixedDeadline` ourselves was
     * the alternative and is worse: it would put this app's write outside the
     * engine's route, skip `deadlineHistory`, and make two systems disagree
     * about how a deadline moves.
     */
    const doc = await this.#taskDocument(taskId);
    if (doc && doc.hasTimer === false) {
      return {
        ok: false,
        code: "invalid_state",
        message:
          "This task carries a fixed deadline, and the Cowork engine's deadline route only moves dates on timed tasks — the change would be written where nothing reads it. Use the deadline negotiation on this task instead.",
      };
    }

    return this.#write(
      (token) =>
        editTaskDeadline({
          token,
          taskId,
          newDueDate: newDueAt,
          reason: reason.trim(),
        }),
      () => taskId,
    );
  }

  /**
   * The assignee accepts the work.
   *
   * **Authorised through `acceptanceRefusal`, the same resolver the card renders
   * from.** The engine enforces `assigneeIds.includes(employeeId)` itself and
   * 403s otherwise, so this is not the only gate — but it is what makes the
   * screen and the write answer one question. The inline condition that used to
   * decide this had no viewer check at all, so the task's creator was offered a
   * confirmation the engine would refuse.
   *
   * It deliberately does NOT re-check whether a deadline exists. That precondition
   * is the engine's — it skips it entirely for budget tasks — and duplicating it
   * is what hid the control from the person who owed the acceptance. Where the
   * engine does refuse, its message is actionable and reaches the card unchanged.
   */
  async confirmTask(id: TaskId): Promise<ActionResult<Task>> {
    const taskId = String(id);
    const view = await this.getTask(id).catch(() => null);
    if (view) {
      const refusal = acceptanceRefusal({
        viewerId: this.#ctx.employeeId ? String(this.#ctx.employeeId) : null,
        view,
      });
      if (refusal) {
        return { ok: false, code: "permission_denied", message: refusal };
      }
    }
    return this.#write((token) => confirmTaskRequest({ token, taskId }), () => taskId);
  }

  async startTask(id: TaskId): Promise<ActionResult<Task>> {
    const taskId = String(id);
    return this.#write((token) => startTaskRequest({ token, taskId }), () => taskId);
  }

  async resetTaskToDraft(id: TaskId): Promise<ActionResult<Task>> {
    const taskId = String(id);
    return this.#write((token) => resetTaskToDraft({ token, taskId }), () => taskId);
  }

  /**
   * File a completion for review.
   *
   * `attachmentIds` is dropped, deliberately: legacy takes `imageUrls` and
   * `pdfAttachments` — resolved URLs from its own upload endpoints — not ids
   * into a store this application does not have. Passing ids through would put
   * strings the engine cannot resolve into a permanent submission record.
   */
  /**
   * Hand work over for review, subject to the configured gates.
   *
   * **The gate is checked HERE, not only in the form.** A screen decides what to
   * offer; this decides what is accepted, and the two are not the same question —
   * a stale tab, a second window or a direct call all reach this and not the
   * dialog. `submissionRefusal` is the same function the dialog calls, so the
   * words on screen and the words in the refusal are one string.
   *
   * Defaults reproduce today's behaviour exactly, so an unsaved rules document
   * refuses nothing that used to be accepted.
   */
  /**
   * Declare what a task hands over.
   *
   * The engine owns the rules — who may set them, and that an output already
   * submitted may be renamed but not removed. This layer neither restates nor
   * pre-empts them: a refusal comes back as the engine's own words.
   */
  async setOutputs(input: SetOutputsInput): Promise<ActionResult<Task>> {
    const taskId = String(input.taskId);
    return this.#write(
      (token) =>
        setTaskOutputs({
          token,
          taskId,
          outputs: input.outputs.map((o: SetOutputsInput["outputs"][number]) => ({
            id: o.id,
            label: o.label,
            needsOutputIds: o.needsOutputIds,
          })),
        }),
      () => taskId,
    );
  }

  /**
   * Hand ONE output over for review.
   *
   * Routed to the per-output endpoint, never to `submit-completion`: that one
   * moves `completionStatus` and would stop the assignee's clock while they
   * still have outputs to deliver.
   */
  async submitOutput(input: {
    taskId: TaskId;
    outputId: string;
    message: string;
    attachments?: ReportAttachment[];
  }): Promise<ActionResult<Task>> {
    const taskId = String(input.taskId);
    /* Split by type, exactly as `submitDailyReport` does and for the same
       reason: the route has always taken two typed arrays, and the old
       application reads those two and knows nothing about anything else. */
    const files = input.attachments ?? [];
    const imageUrls = files
      .filter((a) => a.mimeType.startsWith("image/"))
      .map((a) => a.url);
    const pdfAttachments = files
      .filter((a) => !a.mimeType.startsWith("image/"))
      /* The object form, not the bare URL: `readSubmissionAttachments` reads a
         name off it, and a string leaves the reviewer with a URL to squint at
         instead of a filename. */
      .map((a) => ({ url: a.url, name: a.name, mimeType: a.mimeType }));

    return this.#write(
      (token) =>
        submitOutput({
          token,
          taskId,
          outputId: input.outputId,
          message: input.message,
          imageUrls,
          pdfAttachments,
        }),
      () => taskId,
    );
  }

  /** Approve or return ONE output. The last approval finishes the task. */
  async reviewOutput(input: {
    taskId: TaskId;
    outputId: string;
    approved: boolean;
    note?: string;
  }): Promise<ActionResult<Task>> {
    const taskId = String(input.taskId);
    return this.#write(
      (token) =>
        reviewOutput({
          token,
          taskId,
          outputId: input.outputId,
          approved: input.approved,
          note: input.note ?? "",
        }),
      () => taskId,
    );
  }

  async submitCompletion(input: {
    taskId: TaskId;
    message: string;
    attachmentIds: string[];
  }): Promise<ActionResult<Task>> {
    const taskId = String(input.taskId);

    const rules = await this.getTaskRules().catch(() => DEFAULT_TASK_RULES);

    /* The view is read only when a rule actually needs it. Under the defaults
       neither does, so an unsaved rules document adds no request to a path every
       submission takes.

       `view.completion` and `view.loggedSecs` are already derived on every read —
       re-deriving them here with `completionState` would give the detail page and
       this gate two chances to disagree about whether a task may be submitted,
       which is precisely what `TaskView.completion` exists to prevent. */
    const needsView =
      rules.requirementsBeforeSubmit === "block" ||
      rules.timerBeforeSubmit === "require";
    const view = needsView
      ? await this.getTask(input.taskId).catch(() => null)
      : null;

    const refusal = submissionRefusal({
      rules,
      /* An unreadable view is NOT treated as "nothing outstanding". Defaulting to
         permissive there would let the gate be bypassed by whatever made the read
         fail; defaulting to blocked would refuse honest work over a network
         blip. So the read failing means the gate does not apply, and the engine
         still decides — this layer never invents a refusal it cannot justify. */
      outstandingRequirements:
        rules.requirementsBeforeSubmit === "block"
          ? (view?.completion.outstanding ?? [])
          : [],
      loggedSecs: view?.loggedSecs ?? 0,
      note: input.message,
    });
    if (refusal) {
      return { ok: false, code: "validation_failed", message: refusal };
    }

    return this.#write(
      (token) => submitCompletion({ token, taskId, message: input.message }),
      () => taskId,
    );
  }

  /**
   * Decide on a submission.
   *
   * **`submissionId` IS the task id.** Legacy has no submission entity — the
   * record is a `completionSubmission` object embedded in the task, one at a
   * time, and every review endpoint is keyed by `:taskId`. Inventing a
   * separate id here would mean maintaining a mapping to something that does
   * not exist.
   *
   * Which endpoint applies is the engine's decision, not ours: under
   * `tl_final` the first approval completes the task, under `tl_then_ceo` it
   * only clears the first stage. This calls the first-stage route and lets
   * `_reviewFlow` decide what that means.
   */
  /**
   * Decide a submission — approve, send back for rework, or reject.
   *
   * **The id is DECODED, not assumed.** This used the `submissionId` verbatim as
   * a task id, which held only while submissions were unwired. Once
   * `listSubmissions` began minting `T626#submission`, the engine was asked for
   * a task by that name, could not find one, and the reviewer was told "Task
   * not found." See `compositeId.ts`.
   *
   * **Three decisions, three routes**, because the engine has three behaviours
   * and they are not interchangeable:
   *
   * · `approved` → `review-completion`, which advances or closes the stage.
   * · `rejected` → `review-completion` with the reason, closing it against the
   *   submission.
   * · `rework`   → `/rework`, which returns the task to `in_progress` for the
   *   assignee to fix and increments `reworksReceived` — the counter the C1
   *   rework deduction is taken from. Routing this as a rejection would both
   *   score somebody for a rejection they did not receive and fail to give the
   *   work back to them.
   */
  async reviewSubmission(input: {
    submissionId: string;
    decision: string;
    reason: string;
    waiveDeduction?: boolean;
    reworkRequirements?: string[];
    reworkNote?: string;
    reworkAttachmentIds?: string[];
    reworkPriority?: number | null;
  }): Promise<ActionResult<Task>> {
    const taskId = taskIdOf(String(input.submissionId));

    if (input.decision === "rework") {
      return this.#write(
        (token) =>
          reworkTask({
            token,
            taskId,
            reworkReason: input.reason,
            waiveDeduction: input.waiveDeduction === true,
            reworkRequirements: input.reworkRequirements ?? [],
            reworkNote: input.reworkNote ?? "",
            reworkAttachmentIds: input.reworkAttachmentIds ?? [],
            reworkPriority: input.reworkPriority ?? null,
          }),
        () => taskId,
      );
    }

    const approved = input.decision === "approved";
    return this.#write(
      (token) =>
        reviewCompletion({
          token,
          taskId,
          approved,
          rejectionReason: approved ? "" : input.reason,
          /* Only ever sent with a rejection. An approval carries none, which
             is what stops an approve request from being refused for missing
             something it has no use for. */
          reworkRequirements: approved ? [] : (input.reworkRequirements ?? []),
          reworkNote: approved ? "" : (input.reworkNote ?? ""),
          reworkAttachmentIds: approved ? [] : (input.reworkAttachmentIds ?? []),
        }),
      () => taskId,
    );
  }

  /**
   * Approve or reject a cross-department assignment.
   *
   * `approvalId` is the task id, for the same reason `submissionId` is: the
   * approvals live in a `departmentApprovals` array on the task, and
   * `/department-approve` is keyed by `:taskId`.
   */
  async decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<ActionResult<Task>> {
    /*
     * Decoded, not used verbatim.
     *
     * An approval id is `${taskId}#approval-${n}` — the composite this
     * repository uses everywhere it has to name a row inside a task document.
     * Passing it straight through sent `T631#approval-0` to an endpoint that
     * looks up a task by id, which is exactly the "Task not found" that
     * `reviewSubmission` produced before it was given the same decode.
     */
    const taskId = taskIdOf(approvalId);
    return this.#write(
      (token) =>
        departmentApprove({
          token,
          taskId,
          /* The ONE translation point between the domain's vocabulary and the
             engine's. `approved` describes the state a decision is in;
             `approve` is the act being asked for, and the route accepts only
             the latter. The parameter's type is a two-member union, so this
             ternary is exhaustive — widening it would fail to compile here
             rather than silently posting an unrecognised verb. */
          decision: decision === "approved" ? "approve" : "reject",
          rejectionReason: reason ?? "",
        }),
      () => taskId,
    );
  }

  /**
   * Delete a task. **Recursive** — the engine removes subtasks with it
   * (`taskForward.service.js:1077`).
   *
   * Returns before re-reading, because there is nothing left to read.
   */
  async deleteTask(id: TaskId): Promise<ActionResult<void>> {
    const token = await this.#token();
    const result = await deleteTaskRequest({ token, taskId: String(id) });
    if (!result.ok) {
      return {
        ok: false,
        code:
          result.error.kind === "permission" ? "permission_denied" : "not_found",
        message: result.error.message,
      };
    }
    notifyRepositoryChanged();
    return { ok: true, data: undefined };
  }

  /**
   * Propose a working window and the date it implies.
   *
   * **Both are sent.** `taskForward.js:1658` rejects the call without
   * `proposedDate`, and the window is what the deadline model actually runs on
   * — the engine does not derive one from the other. A UI that asks "how long
   * do you need?" computes the date from the duration and passes both, so the
   * question put to the assignee and the record the engine keeps stay in step.
   */
  async proposeDeadline(input: {
    taskId: TaskId;
    proposedDueAt: string;
    windowSecs: number;
    reason?: string;
  }): Promise<ActionResult<Task>> {
    const taskId = String(input.taskId);
    return this.#write(
      (token) =>
        proposeDeadlineRequest({
          token,
          taskId,
          proposedDate: input.proposedDueAt,
          windowSecs: input.windowSecs,
        }),
      () => taskId,
    );
  }

  /**
   * Accept the window the assignor set at creation.
   *
   * This is the case where a manager already decided the budget: legacy writes
   * it as `senderTimerWindowSecs` and shows the receiver the figure rather than
   * an empty proposal form. Accepting copies it to `deadlineWindowSecs` and
   * moves the task to `deadline_approved`.
   */
  async acceptAssignorWindow(id: TaskId): Promise<ActionResult<Task>> {
    const taskId = String(id);
    return this.#write(
      (token) => acceptAssignorWindowRequest({ token, taskId }),
      () => taskId,
    );
  }

  /** Counter the assignor's window, which opens the negotiation. */
  async rejectAssignorWindow(
    id: TaskId,
    reason: string,
  ): Promise<ActionResult<Task>> {
    const taskId = String(id);
    return this.#write(
      (token) => rejectAssignorWindowRequest({ token, taskId, reason }),
      () => taskId,
    );
  }

  /** The assignor decides on a proposed deadline. */
  async counterBudget(
    taskId: TaskId,
    proposedSecs: number,
    reason?: string,
  ): Promise<ActionResult<void>> {
    const token = await this.#token();
    const r = await counterBudgetRequest({
      token,
      taskId: String(taskId),
      proposedSecs,
      reason,
    });
    if (!r.ok) {
      return {
        ok: false,
        code:
          r.error.kind === "permission" ? "permission_denied" : "invalid_state",
        message: r.error.message,
      };
    }
    notifyRepositoryChanged();
    return { ok: true, data: undefined };
  }

  async acceptBudget(taskId: TaskId): Promise<ActionResult<void>> {
    const token = await this.#token();
    const r = await acceptBudgetRequest({ token, taskId: String(taskId) });
    if (!r.ok) {
      return {
        ok: false,
        code:
          r.error.kind === "permission" ? "permission_denied" : "invalid_state",
        message: r.error.message,
      };
    }
    notifyRepositoryChanged();
    return { ok: true, data: undefined };
  }

  async decideDeadline(
    id: TaskId,
    approved: boolean,
    rejectionReason?: string,
    /** The agreed date, for the record-based deadline-extension flow. When set,
        the engine applies it directly instead of reading `task.proposedDeadline`
        and requiring `pending_deadline_approval` — a status that flow never sets. */
    explicitDueDate?: string,
  ): Promise<ActionResult<Task>> {
    const taskId = String(id);
    return this.#write(
      (token) =>
        approveDeadlineRequest({
          token,
          taskId,
          approved,
          rejectionReason,
          explicitDueDate,
        }),
      () => taskId,
    );
  }

  /**
   * Break work out of a task.
   *
   * `POST /task/:taskId/subtask` — legacy's own delegation route, and the one
   * that replaced Forward when forwarding was removed. The engine owns parent
   * linkage and the approval gates a subtask inherits.
   *
   * **`satisfiesRequirementIds` is SENT.** It used to be dropped, on the
   * reasoning that requirements are a new-product concept with no legacy field
   * and inventing one would create a second source of truth. The first half was
   * true and the conclusion did not follow: the engine stores the array
   * verbatim without interpreting it, so there is exactly one source — the
   * subtask's own document — and dropping it meant every subtask arrived
   * claiming nothing. A subtask that claims nothing leaves its parent's
   * requirements undelegated, and an undelegated project is not a project, so
   * the Subtasks section never rendered and the child was invisible.
   *
   * A build talking to an engine that predates the field is unharmed: the
   * engine ignores what it does not read, and the claims come back empty —
   * exactly the state the dropped version produced.
   */
  async createSubtask(input: {
    parentTaskId: TaskId;
    title: string;
    description?: string | null;
    assigneeIds: EmployeeId[];
    satisfiesRequirementIds?: string[];
    /** The child's OWN acceptance criteria — see `CreateSubtaskInput`. */
    requirements?: string[];
    estimatedEffortSecs?: number | null;
    fixedDueAt?: string | null;
    senderWindowSecs?: number | null;
  }): Promise<ActionResult<Task>> {
    const parentId = String(input.parentTaskId);
    /* A fixed date is chosen by SUPPLYING one, exactly as `createTask` decides
       it — there is no separate mode flag on this input, and inferring the
       timer from a missing window instead would put a task with no estimate
       yet onto a date nobody picked. */
    const onFixedDate = !!input.fixedDueAt;
    return this.#write(
      (token) =>
        createSubtaskRequest({
          token,
          taskId: parentId,
          title: input.title,
          assigneeIds: input.assigneeIds.map(String),
          description: input.description ?? "",
          satisfiesRequirementIds: [
            ...new Set(input.satisfiesRequirementIds ?? []),
          ],
          /* The child's OWN criteria. Left out of this call until 16 Aug 2026:
             the form offered the field, the engine stored it, and only the wire
             between them dropped it — so a subtask created WITH criteria
             arrived with none and nothing said so. */
          requirements: input.requirements ?? [],
          hasTimer: !onFixedDate,
          /* `estimatedEffortSecs` is the fallback rather than an equal: the
             sender's window is what the engine binds the child to, and an
             estimate is only a stand-in where no window was stated. */
          senderTimerWindowSecs:
            input.senderWindowSecs ?? input.estimatedEffortSecs ?? 0,
          fixedDeadline: input.fixedDueAt ?? null,
        }),
      (data) => {
        /* **The route answers `{ success, subtask }`** — `taskForward.js:1490`
           — and this looked for `taskId` and `task.taskId`, neither of which it
           sends. So every create fell through to the parent id and the caller
           was handed the PROJECT as its own new subtask. The dialog of the day
           only refetched, so it survived; the form that replaced it navigates
           to the result and would have landed on the wrong task. The other two names are kept for
           an engine that answers either. */
        const d = data as {
          taskId?: unknown;
          task?: { taskId?: unknown };
          subtask?: { taskId?: unknown };
        };
        const id = d?.subtask?.taskId ?? d?.taskId ?? d?.task?.taskId;
        return typeof id === "string" ? id : parentId;
      },
    );
  }

  /**
   * The receiving department's lead states the effort.
   *
   * Its own route in legacy (`department-tl-set-hours`) rather than part of the
   * generic approval, because it supplies a NUMBER rather than a yes/no — and
   * supplying it converts the task from a fixed deadline to a budget.
   */
  async setEffortEstimate(
    id: TaskId,
    secs: number,
  ): Promise<ActionResult<Task>> {
    const taskId = String(id);
    return this.#write(
      (token) => setDepartmentHours({ token, taskId, windowSecs: secs }),
      () => taskId,
    );
  }

  /**
   * A message on the task thread.
   *
   * Through the engine, not straight to Firestore: `sendTaskChat` fans out the
   * notification, and a message appended to the document would reach the thread
   * and nobody's bell.
   *
   * The draft thread is a separate legacy route (`draft-chat`) and is not wired;
   * asking for it refuses rather than silently posting to the main thread, which
   * would put a private note in front of everybody on the task.
   */
  async sendTaskChat(
    taskId: TaskId,
    thread: "chat" | "draft",
    text: string,
    attachments: MessageAttachment[] = [],
    replyTo: MessageReply | null = null,
  ): Promise<ActionResult<never>> {
    if (thread === "draft") {
      return {
        ok: false,
        code: "invalid_state",
        message:
          "The draft thread is not connected yet. Posting here would put the note on the main task thread, where everyone on the task would see it.",
      } as unknown as ActionResult<never>;
    }
    const id = String(taskId);
    /* The route stores the attachment array verbatim and reads `type` off the
       first one to type the message, so send the backend's own inline shape
       (`type`/`url`/`name`) plus the handles the reader needs to render it: the
       Drive `fileId` for the media proxy, and size/duration for the file card.
       This is the same object `listTaskChat` maps straight back to a
       `MessageAttachment`. */
    const wire = attachments.map((a) => ({
      type: a.kind,
      url: a.url,
      name: a.name ?? null,
      fileId: a.fileId ?? null,
      sizeBytes: a.sizeBytes ?? null,
      durationSecs: a.durationSecs ?? null,
    }));
    const result = await this.#write(
      (token) =>
        sendTaskChatRequest({
          token,
          taskId: id,
          message: text,
          attachments: wire,
          replyTo,
        }),
      () => id,
    );
    return result as unknown as ActionResult<never>;
  }

  /* ── Task chat, beyond sending ──────────────────────────────────────────
   *
   * Reply, edit, delete, react, star, pin and read receipts, so a task's
   * discussion behaves the way the message thread does rather than being a
   * send-only log.
   *
   * **All of it writes to the SAME subcollection the older application reads**
   * — `cowork_tasks/{taskId}/chat` — using fields it does not know about.
   * Every one is additive: a document without them reads exactly as it always
   * did, and the other application ignores what it cannot see rather than
   * breaking on it. Nothing already stored is migrated or rewritten.
   *
   * `#taskChatRef` is the one place the path is built, so a rename cannot leave
   * half these methods writing somewhere else.
   */

  async #taskChatRef(taskId: TaskId, messageId: string) {
    const { collection, doc, getDocs, query, where, limit } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const chat = collection(legacyDb(), "cowork_tasks", String(taskId), "chat");

    /* The id a message is KNOWN by is `messageId`, a field — legacy writes it
       and the document id is whatever Firestore generated. So the document is
       found by query first, and only falls back to treating the id as the
       document's own when no row carries it. Skipping this wrote every edit to
       a document that did not exist. */
    const found = await getDocs(query(chat, where("messageId", "==", messageId), limit(1)));
    if (!found.empty) return found.docs[0].ref;
    return doc(chat, messageId);
  }

  /**
   * Change the text of your own task-chat message.
   *
   * Text only. An edit that could add or remove files would let the record of
   * what was handed over change after the fact, which on a task is the thing
   * people argue about.
   */
  async editTaskChat(
    taskId: TaskId,
    messageId: string,
    text: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    const body = text.trim();
    if (!body)
      return {
        ok: false,
        code: "validation_failed",
        message: "A message cannot be emptied by editing — delete it instead.",
        field: "text",
      };
    try {
      const { getDoc, setDoc } = await import("firebase/firestore");
      const ref = await this.#taskChatRef(taskId, messageId);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return { ok: false, code: "not_found", message: "That message is gone." };
      const data = snap.data() as Record<string, unknown>;
      if (String(data.senderId ?? "") !== me)
        return {
          ok: false,
          code: "permission_denied",
          message: "You can only edit your own messages.",
        };
      if (data.isDeleted === true)
        return {
          ok: false,
          code: "invalid_state",
          message: "This message was deleted.",
        };
      await setDoc(
        ref,
        { text: body, editedAt: new Date().toISOString() },
        { merge: true },
      );
      notifyRepositoryChanged("listTaskChat");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[editTaskChat]", e);
      return { ok: false, code: "offline", message: "The edit could not be saved." };
    }
  }

  /**
   * Delete your own task-chat message — softly.
   *
   * The row keeps its place and reads as deleted. A working thread that
   * silently loses a line leaves everybody wondering what was said, and on a
   * task that line may be the only record of an instruction.
   */
  async deleteTaskChat(
    taskId: TaskId,
    messageId: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { getDoc, setDoc } = await import("firebase/firestore");
      const ref = await this.#taskChatRef(taskId, messageId);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return { ok: false, code: "not_found", message: "That message is gone." };
      const data = snap.data() as Record<string, unknown>;
      if (String(data.senderId ?? "") !== me)
        return {
          ok: false,
          code: "permission_denied",
          message: "You can only delete your own messages.",
        };
      await setDoc(
        ref,
        { isDeleted: true, deletedAt: new Date().toISOString() },
        { merge: true },
      );
      notifyRepositoryChanged("listTaskChat");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[deleteTaskChat]", e);
      return {
        ok: false,
        code: "offline",
        message: "The message could not be deleted.",
      };
    }
  }

  /**
   * Add or change your reaction. One per person, as in a direct message.
   *
   * `setDoc` + merge rather than `updateDoc`: an emoji is not a valid segment
   * in an `updateDoc` field path, and merge applies the whole map at once.
   * Which emoji move is `reactionChanges` — the same rule the message thread
   * uses, so the two cannot disagree about what "one per person" means.
   */
  async toggleTaskChatReaction(
    taskId: TaskId,
    messageId: string,
    emoji: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { arrayRemove, arrayUnion, getDoc, setDoc } = await import(
        "firebase/firestore"
      );
      const ref = await this.#taskChatRef(taskId, messageId);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return { ok: false, code: "not_found", message: "That message is gone." };
      const current = readReactions(
        (snap.data() as Record<string, unknown>).reactions,
      );
      const changes = reactionChanges(current, emoji, me);
      const patch: Record<string, unknown> = {};
      for (const [e, move] of Object.entries(changes))
        patch[e] = move === "add" ? arrayUnion(me) : arrayRemove(me);
      await setDoc(ref, { reactions: patch }, { merge: true });
      notifyRepositoryChanged("listTaskChat");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[toggleTaskChatReaction]", e);
      return {
        ok: false,
        code: "offline",
        message: "The reaction could not be saved.",
      };
    }
  }

  /** Star a task-chat message for yourself alone. Nobody else sees it. */
  async toggleTaskChatStar(
    taskId: TaskId,
    messageId: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { arrayRemove, arrayUnion, getDoc, setDoc } = await import(
        "firebase/firestore"
      );
      const ref = await this.#taskChatRef(taskId, messageId);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return { ok: false, code: "not_found", message: "That message is gone." };
      const data = snap.data() as Record<string, unknown>;
      const starred =
        Array.isArray(data.starredBy) && data.starredBy.includes(me);
      await setDoc(
        ref,
        { starredBy: starred ? arrayRemove(me) : arrayUnion(me) },
        { merge: true },
      );
      notifyRepositoryChanged("listTaskChat");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[toggleTaskChatStar]", e);
      return { ok: false, code: "offline", message: "The star could not be saved." };
    }
  }

  /**
   * Mark every task-chat message read by this viewer.
   *
   * **A task thread is not a direct message.** A DM has one other person, so
   * "read" is one fact; a task carries an assignor, its assignees and a
   * reviewer, so this appends the viewer to a SET and the tick is decided from
   * who is in it — see `messageStatus`.
   *
   * Own messages are skipped: a sender reading their own line is not a receipt,
   * and writing it would make every message instantly "read by everyone" for an
   * audience of one.
   */
  async markTaskChatRead(taskId: TaskId): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { arrayUnion, collection, getDocs, query, where, writeBatch } =
        await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const db = legacyDb();
      const chat = collection(db, "cowork_tasks", String(taskId), "chat");
      /* Only what somebody else sent, and only what this viewer has not
         already been recorded on — otherwise every open of the tab rewrites
         every row and the live listener answers its own write for ever. */
      const snap = await getDocs(query(chat, where("senderId", "!=", me)));
      const unread = snap.docs.filter((d) => {
        const by = (d.data() as Record<string, unknown>).readBy;
        return !Array.isArray(by) || !by.includes(me);
      });
      if (!unread.length) return { ok: true, data: undefined };

      const batch = writeBatch(db);
      for (const d of unread) batch.set(d.ref, { readBy: arrayUnion(me) }, { merge: true });
      await batch.commit();
      notifyRepositoryChanged("listTaskChat");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[markTaskChatRead]", e);
      /* Not surfaced: a receipt that does not land costs somebody else's tick a
         few seconds and is not worth an error in front of the reader. */
      return { ok: true, data: undefined };
    }
  }


  /* ── Deadline negotiation ───────────────────────────────────────────────
   *
   * Legacy addresses every one of these by TASK — `/task/:taskId/...` — while
   * this interface addresses them by PROPOSAL. The gap is bridged by the id
   * scheme in `deadlineMap.ts`: a proposal's id encodes the task it belongs to,
   * because legacy stores history as array members with no identity of their
   * own and there is no proposal collection to look one up in.
   */

  /**
   * The assignor decides on a proposed deadline.
   *
   * Routed to `approve-deadline`, the same endpoint `decideDeadline` uses —
   * they are two callers for one decision, differing only in whether the caller
   * is holding a task or a proposal.
   */
  async decideProposal(
    proposalId: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<ActionResult<never>> {
    const taskId = taskIdOfProposal(proposalId);
    const result = await this.#write(
      (token) =>
        approveDeadlineRequest({
          token,
          taskId,
          approved: decision === "approved",
          rejectionReason: reason,
        }),
      () => taskId,
    );
    return result as unknown as ActionResult<never>;
  }

  /**
   * The assignor counters with their own date.
   *
   * `counterWindowSecs` is passed through rather than dropped: on a budget task
   * the counter is a duration, and the route's own comment calls it "typed
   * duration in seconds (for extension-aware accounting)".
   */
  async counterProposal(
    proposalId: string,
    counterDueAt: string,
    counterWindowSecs: number,
    message: string,
  ): Promise<ActionResult<never>> {
    const taskId = taskIdOfProposal(proposalId);
    const result = await this.#write(
      (token) =>
        counterDeadline({
          token,
          taskId,
          counterDate: counterDueAt,
          counterWindowSecs,
          message,
        }),
      () => taskId,
    );
    return result as unknown as ActionResult<never>;
  }

  /** The assignee answers a counter. `accepted` must be a real boolean — the
   *  engine tests its type and 400s rather than coercing. */
  async respondToCounter(
    counterId: string,
    accepted: boolean,
    message?: string,
  ): Promise<ActionResult<never>> {
    const taskId = taskIdOfProposal(counterId);
    const result = await this.#write(
      (token) =>
        respondToCounterRequest({ token, taskId, accepted, rejectMessage: message }),
      () => taskId,
    );
    return result as unknown as ActionResult<never>;
  }

  /**
   * The assignee asks for more time.
   *
   * **`proposedDate` is mandatory** and the engine derives nothing from a
   * window — it 400s without a date. The caller supplies one; this does not
   * invent it from `windowSecs`, which would put a date on the record that
   * nobody chose.
   */
  async requestExtension(input: {
    taskId: TaskId;
    proposedDueAt?: string;
    /**
     * Seconds being added, and the window they are added to.
     *
     * **This method used to accept `windowSecs` and forward neither.** The
     * form sends `additionalSecs`; the parameter was named `windowSecs`; and
     * the body built below carried only a date and a reason. So the number the
     * person chose was dropped here, one layer below the form that got it
     * right — which is why the request succeeded and the history read zero.
     */
    additionalSecs?: number;
    previousWindowSecs?: number;
    reason?: string;
  }): Promise<ActionResult<never>> {
    const taskId = String(input.taskId);
    if (!input.proposedDueAt) {
      return {
        ok: false,
        code: "validation_failed",
        message:
          "An extension needs the date you are asking for. The engine does not work one out from a duration.",
        field: "proposedDueAt",
      } as unknown as ActionResult<never>;
    }
    const result = await this.#write(
      (token) =>
        requestDeadlineExtension({
          token,
          taskId,
          proposedDate: input.proposedDueAt!,
          reason: input.reason,
          /* `extensionFromAddition` owns the sum. Nothing here adds the two
             numbers together — a second sum is how the form and the stored
             record come to disagree about what was asked for. */
          ...(() => {
            const e = extensionFromAddition({
              previousWindowSecs: input.previousWindowSecs ?? 0,
              addedSecs: input.additionalSecs ?? 0,
            });
            return {
              previousWindowSecs: e.previousSecs,
              addedSecs: e.addedSecs,
              proposedWindowSecs: e.totalSecs,
            };
          })(),
        }),
      () => taskId,
    );
    return result as unknown as ActionResult<never>;
  }

  /**
   * The manager decides an extension.
   *
   * Three actions at the engine — approve, reject, counter — but this signature
   * offers two, so a decision maps to approve/reject and a counter goes through
   * `counterProposal`. `waivePenalty` has no field on this route: legacy waives
   * through `extension-deduction`, a separate endpoint, so accepting it here
   * silently would be a promise this call cannot keep.
   */
  async decideExtension(
    proposalId: string,
    decision: "approved" | "rejected",
    waivePenalty: boolean,
    reason?: string,
    raiseParent?: boolean,
  ): Promise<ActionResult<never>> {
    const taskId = taskIdOfProposal(proposalId);
    if (waivePenalty) {
      return {
        ok: false,
        code: "invalid_state",
        message:
          "Waiving the deduction is a separate step in the Cowork engine and is not wired yet. Decide the extension without the waiver, or set the deduction from the task's scoring panel.",
      } as unknown as ActionResult<never>;
    }
    const result = await this.#write(
      (token) =>
        reviewDeadlineExtension({
          token,
          taskId,
          action: decision === "approved" ? "approve" : "reject",
          newDate: reason && decision === "approved" ? undefined : undefined,
          /* Carried through so an approver who has agreed to move the project
             can take that in the same press — see `reviewDeadlineExtension`.
             Absent by default, so the cap refuses first and asks. */
          raiseParent,
        }),
      () => taskId,
    );
    return result as unknown as ActionResult<never>;
  }

  /**
   * A task's deadline history.
   *
   * `deadlineHistory[]` on the task document, read through both of the shapes
   * legacy writes it in — see `deadlineMap.ts`. The pending extension request
   * is prepended when there is one, because it is the only entry that is still
   * a question rather than a record.
   */
  /**
   * Time budget extensions — hours, in their own collection.
   *
   * **`cowork_task_budget_extensions`, not the deadline history.** The two were
   * sharing `deadlineExtRequest`: one row, one status, so approving a capacity
   * request and approving a commitment change were indistinguishable. They are
   * different decisions with different owners and they now have different rows.
   *
   * Written directly to Firestore rather than over HTTP because legacy has no
   * route for this concept — the same exception the timer, duty status and
   * priority writes already take. Nothing here touches `cowork_tasks`; the
   * budget itself moves through `setEffortEstimate`, which is legacy's own
   * endpoint for it.
   */
  async requestTimeBudgetExtension(input: {
    taskId: TaskId;
    requestedAdditionalSecs: number;
    reason?: string;
  }): Promise<ActionResult<TimeBudgetExtensionRecord>> {
    const taskId = String(input.taskId);
    const me = this.#ctx.employeeId ?? "";
    const { addDoc, collection, doc, getDoc } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", taskId));
    if (!snap.exists()) {
      return {
        ok: false,
        code: "not_found",
        message: "That task does not exist.",
      } as ActionResult<TimeBudgetExtensionRecord>;
    }
    const legacy = readTask({ ...snap.data(), id: taskId });

    /* **One extension in flight at a time.** Without this an assignee could ask
       for three hours, then four, then five before the manager answered any of
       them — each a record the manager must separately dispose of, only the last
       figure meaning anything. Refused HERE and not only on screen, because the
       request is a browser write: the rule cannot live on the form alone. The
       loop reopens the moment the manager answers (the record leaves `pending` /
       `counter_proposed` / `approved`), which is where the next ask belongs. */
    const existing = await this.listTimeBudgetExtensions(taskId);
    if (hasLiveBudgetExtension(existing)) {
      return {
        ok: false,
        code: "invalid_state",
        message:
          "You already have an extension request in progress. Wait for your manager to answer it — or respond to their offer — before asking for a different amount.",
      } as ActionResult<TimeBudgetExtensionRecord>;
    }

    /* The window being extended, from the one budget resolver. */
    const previousBudgetSecs = legacy ? resolveTimeBudget(legacy) : 0;

    /* Hours are the primary manager's call. Resolved from HR, never from a
       department mapping. A failure leaves the approver unnamed rather than
       naming somebody unverified. */
    let primaryManagerId: string | null = null;
    try {
      const token = await this.#token();
      const r = await fetchHierarchy({ token, employeeId: me });
      primaryManagerId = r.ok
        ? (r.data.primaryManager?.employeeId ?? null)
        : null;
    } catch {
      primaryManagerId = null;
    }

    /* **The configured fallback, for the case the rule cannot answer.**
       `routedBudgetApproverId` returns the primary manager whenever there is one,
       so the administrator's setting only decides what happens when HR names
       nobody. That used to be an unconditional `?? assigneeId` — the person
       approving their own hours — which is right for somebody with nobody above
       them and wrong for a new joiner whose record is incomplete, and the code
       could not tell those apart.

       A refusal is returned rather than a record with a null approver: a request
       waiting on nobody looks exactly like one waiting on somebody who will never
       answer, and only the first is fixable by an administrator. */
    const routing = await this.getWorkflowRouting().catch(
      () => DEFAULT_WORKFLOW_ROUTING,
    );
    const approverId = routedBudgetApproverId({
      routing,
      primaryManagerId,
      assigneeId: me,
    });
    if (!approverId) {
      return {
        ok: false,
        code: "validation_failed",
        message:
          routingRefusal({ routing, primaryManagerId, assigneeId: me }) ??
          "This request has nobody to decide it.",
      } as ActionResult<TimeBudgetExtensionRecord>;
    }

    const record = timeBudgetExtension({
      taskId,
      requestedBy: me,
      approverId,
      previousBudgetSecs,
      requestedAdditionalSecs: input.requestedAdditionalSecs,
      reason: input.reason ?? null,
      createdAt: new Date().toISOString(),
    });

    try {
      const ref = await addDoc(
        collection(legacyDb(), "cowork_task_budget_extensions"),
        /* `documentBody` strips the client-side id and refuses a payload
           Firestore would reject. `{ ...record, id: undefined }` was here and
           it does not remove the key — it sets it to `undefined`, the one
           value Firestore refuses outright. */
        documentBody(record, BUDGET_EXTENSION_REQUIRED),
      );
      /* The whole point of the record is that somebody has to answer it. Until
         now it was filed and the approver was never told. */
      this.#announce("budget_extension_requested", {
        taskId,
        seconds: input.requestedAdditionalSecs,
        reason: input.reason ?? "",
      });
      notifyRepositoryChanged();
      return { ok: true, data: { ...record, id: ref.id } };
    } catch (e) {
      /*
       * The SDK's own words never reach the screen.
       *
       * "Function addDoc() called with invalid data. Unsupported field value:
       * undefined (found in field id in …)" was shown to somebody asking for
       * two more hours. It is precise, it is for a developer, and it tells the
       * reader nothing they can act on. The cause is logged; the message is
       * short.
       */
      console.error("[requestTimeBudgetExtension]", e);
      return {
        ok: false,
        code: e instanceof PayloadError ? "validation_failed" : "offline",
        message: "Unable to submit extension request. Please try again.",
      } as ActionResult<TimeBudgetExtensionRecord>;
    }
  }

  /**
   * The manager's decision on the hours.
   *
   * Approving raises the BUDGET through legacy's own endpoint and writes no
   * date at all. Whether the commitment can hold is a separate question that
   * has already been answered before this runs — and if the answer was no, a
   * `DEADLINE_EXTENSION` was raised instead of this being approved.
   */
  /**
   * The manager's answer to a request for hours.
   *
   * ## Two bugs fixed here
   *
   * **1. It applied the budget through a route that always refused.** Approval
   * called `setEffortEstimate` → `POST /cowork/task/:id/department-tl-set-hours`,
   * whose handler opens with:
   *
   * ```js
   * if (task.status !== "pending_tl_hours") return res.status(400).json(...)
   * ```
   *
   * An extension is requested on work that is already running, so that check
   * refused every time. The manager pressed Approve and was told the task "may
   * already be active" — and because the failure returned early, the record stayed
   * `pending` with no sign of what had happened.
   *
   * **2. Approval was terminal.** Even had it landed, the figure would have been
   * applied without the assignee agreeing to it. A manager may grant FEWER hours
   * than were asked for, so their answer is an offer about somebody else's week.
   *
   * So approval now **records the granted figure and hands the turn to the
   * assignee**. The budget is applied when they confirm — see
   * `confirmTimeBudgetExtension`, which is also where the working route is called.
   */
  async decideTimeBudgetExtension(
    recordId: string,
    decision: "approved" | "rejected",
    options?: { reason?: string; grantedSecs?: number },
  ): Promise<ActionResult<TimeBudgetExtensionRecord | null>> {
    const { doc, getDoc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const ref = doc(legacyDb(), "cowork_task_budget_extensions", recordId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return {
        ok: false,
        code: "not_found",
        message: "That request does not exist.",
      } as ActionResult<TimeBudgetExtensionRecord | null>;
    }
    const record = timeBudgetExtension({
      ...(snap.data() as Record<string, unknown>),
      id: recordId,
    } as never);

    /* **The same question the card asked before it rendered a button.** One
       function, so a control that appears is a write that lands and a write that
       is refused was never offered. It also delivers "you cannot decide your own
       request": after asking, you are never the one waited on. */
    const refusal = transitionRefusal({
      viewerId: this.#ctx.employeeId ? String(this.#ctx.employeeId) : null,
      state: { budget: record },
      intent: decision === "rejected" ? "reject" : "accept",
    });
    if (refusal) {
      return {
        ok: false,
        code: "permission_denied",
        message: refusal,
      } as ActionResult<TimeBudgetExtensionRecord | null>;
    }

    const decidedAt = new Date().toISOString();

    if (decision === "rejected") {
      /* Nothing is applied and nothing else moves. The record keeps the refusal
         so the timeline can show that the conversation ended and how. */
      await updateDoc(ref, {
        status: "rejected",
        approvedAt: decidedAt,
        ...(options?.reason ? { reason: options.reason } : {}),
      });
      /* The assignee is blocked waiting on this answer — a refusal they are
         not told about reads as a request nobody ever looked at. */
      this.#announce("budget_extension_decided", {
        taskId: record.taskId,
        approved: false,
        reason: options?.reason ?? "",
      });
      notifyRepositoryChanged();
      return {
        ok: true,
        data: {
          ...record,
          status: "rejected",
          approvedAt: decidedAt,
          reason: options?.reason ?? record.reason,
        },
      };
    }

    /* The manager's own figure, as a new TOTAL. Null when they granted exactly
       what was asked — which is the only thing the decision card offers. */
    const granted =
      options?.grantedSecs !== undefined &&
      Math.round(options.grantedSecs) !== record.newBudgetSecs
        ? Math.max(1, Math.round(options.grantedSecs))
        : null;

    /* **The manager's approval APPLIES the budget and settles the request, in
       one step.** The hours belong to the manager and the backend authorises
       only them to set hours — `/set-budget` refuses anyone else (taskForward.js:
       "Only … who manages the assignee, can set hours") — so the manager is the
       one party who can make the grant take effect, and they are the caller here.
       The earlier design left the record at `approved` for the ASSIGNEE to
       confirm and apply, but the assignee's apply always 403'd, so that step
       could never land. Applying here, as the manager, is what makes "approve"
       mean the budget moved — which is what this card's own contract promised. */
    const agreedSecs = granted ?? record.newBudgetSecs;
    const applied = await this.#applyAgreedBudget(record.taskId, agreedSecs);
    if (!applied.ok) {
      return {
        ok: false,
        code: "conflict",
        message: applied.message,
      } as ActionResult<TimeBudgetExtensionRecord | null>;
    }

    const approver = this.#ctx.employeeId ? String(this.#ctx.employeeId) : null;
    await updateDoc(ref, {
      status: "accepted",
      approvedAt: decidedAt,
      approvedSecs: granted,
      confirmedAt: decidedAt,
      confirmedBy: approver,
      ...(options?.reason ? { reason: options.reason } : {}),
    });
    /* Approval APPLIES the budget here, so this is the moment the assignee's
       working window actually changes. They were never told. */
    this.#announce("budget_extension_decided", {
      taskId: record.taskId,
      approved: true,
      seconds: agreedSecs,
    });
    notifyRepositoryChanged();
    return {
      ok: true,
      data: {
        ...record,
        status: "accepted",
        approvedAt: decidedAt,
        approvedSecs: granted,
        confirmedAt: decidedAt,
        confirmedBy: approver,
        reason: options?.reason ?? record.reason,
      },
    };
  }

  /**
   * The assignee's answer, and the only place the budget is actually applied.
   *
   * `accept` settles the conversation and raises the budget. `counter` puts a
   * different total forward and hands the turn back to the manager — the loop,
   * which exits only on agreement. There is no reject: a refusal would leave the
   * work carrying a figure neither side settled.
   *
   * ## Applying it
   *
   * The engine's own accept route (`POST /cowork/task/:id/budget/accept`) is
   * preferred, because it is transactional, it writes `senderTimerWindowSecs` —
   * the field the rest of the product reads as the agreed budget — and it appends
   * to the negotiation history the timeline renders. It is used only when the
   * engine's negotiation already has this figure on the table and names this
   * person as the one waited on; otherwise its `assertTurn` would refuse.
   *
   * Where it cannot be used, `setEffortEstimate` is tried and **its refusal is
   * surfaced rather than swallowed**. The record stays at `approved` — still the
   * assignee's turn — so a failure leaves a state somebody can retry from rather
   * than a settled record over a budget that never moved.
   */
  async confirmTimeBudgetExtension(
    recordId: string,
    answer: "accept" | "counter",
    options?: { counterSecs?: number; reason?: string },
  ): Promise<ActionResult<TimeBudgetExtensionRecord | null>> {
    const { doc, getDoc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const ref = doc(legacyDb(), "cowork_task_budget_extensions", recordId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return {
        ok: false,
        code: "not_found",
        message: "That request does not exist.",
      } as ActionResult<TimeBudgetExtensionRecord | null>;
    }
    const record = timeBudgetExtension({
      ...(snap.data() as Record<string, unknown>),
      id: recordId,
    } as never);

    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : null;
    const refusal = transitionRefusal({
      viewerId: me,
      state: { budget: record },
      intent: answer === "accept" ? "accept" : "negotiate",
    });
    if (refusal) {
      return {
        ok: false,
        code: "permission_denied",
        message: refusal,
      } as ActionResult<TimeBudgetExtensionRecord | null>;
    }

    const now = new Date().toISOString();

    if (answer === "counter") {
      const counterSecs = Math.max(1, Math.round(options?.counterSecs ?? 0));
      if (!Number.isFinite(counterSecs) || counterSecs <= 0) {
        return {
          ok: false,
          code: "validation_failed",
          message: "Say how many hours in total you need.",
        } as ActionResult<TimeBudgetExtensionRecord | null>;
      }
      /* Back to the manager, one round on. `approvedSecs` carries the assignee's
         figure now — whoever is waited on is being asked about the number in that
         field, which is what keeps one reading of "what is on the table". */
      const next = {
        status: "counter_proposed" as const,
        approvedSecs: counterSecs,
        round: record.round + 1,
        approvedAt: null,
        ...(options?.reason ? { reason: options.reason } : {}),
      };
      await updateDoc(ref, next);
      notifyRepositoryChanged();
      return { ok: true, data: { ...record, ...next } };
    }

    /* Accepting. Apply the budget FIRST — a record marked settled over a budget
       that never moved is the worse failure, because nothing afterwards would
       report the difference. */
    const agreedSecs = agreedOrRequestedSecs(record);
    const applied = await this.#applyAgreedBudget(record.taskId, agreedSecs);
    if (!applied.ok) {
      return {
        ok: false,
        code: "conflict",
        message: applied.message,
      } as ActionResult<TimeBudgetExtensionRecord | null>;
    }

    await updateDoc(ref, {
      status: "accepted",
      confirmedAt: now,
      confirmedBy: me,
    });

    /* **The extension cascade needs no write here.** A settled budget grows this
     * task's remaining work, so every task below it starts later — but the queue
     * and its operational dates are DERIVED on every read from `#chainQueue`,
     * which reads the new budget the instant it lands. Applying the budget above
     * is the whole of "the queue recalculates"; storing a derived date here would
     * be a second, stale copy of a number nothing needs kept (see `budgetLoop`
     * test 7, which pins exactly that). The read side is simply told to re-run. */
    notifyRepositoryChanged();
    return {
      ok: true,
      data: {
        ...record,
        status: "accepted",
        confirmedAt: now,
        confirmedBy: me,
      },
    };
  }

  /**
   * Raise the agreed budget, by whichever route the engine will accept.
   *
   * Neither route works in every case, which is why this exists rather than a
   * single call: the negotiation route refuses anybody it is not waiting on, and
   * `department-tl-set-hours` refuses any task that is not `pending_tl_hours`. A
   * failure returns its reason rather than a generic message — "the budget did
   * not change" with no cause is the report that cannot be acted on.
   */
  /**
   * The assignee refuses the work outright.
   *
   * **Was `rejectAssignorWindow`, which is a different act.** That route sends
   * the proposed TIME back and leaves the task with the assignee; there was no
   * way to hand work back at all, so the card offered "Ask for different terms"
   * and the decline the product wanted did not exist. The engine now has
   * `/decline-assignment`, so this is the real transition.
   *
   * The reason is required by the route and checked here too, so the refusal
   * arrives as a sentence rather than as a 400.
   */
  async declineAssignment(
    id: TaskId,
    reason: string,
  ): Promise<ActionResult<Task>> {
    const taskId = String(id);
    if (!reason?.trim()) {
      return {
        ok: false,
        code: "validation_failed",
        message: "Say why you are declining. It is sent to whoever assigned it.",
        field: "reason",
      };
    }
    return this.#write(
      (token) => declineAssignmentRequest({ token, taskId, reason: reason.trim() }),
      () => taskId,
    );
  }

  async #applyAgreedBudget(
    taskId: string,
    agreedSecs: number,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : null;

    /* The engine's transactional accept, where its negotiation is already
       holding this figure and waiting on this person. It writes
       `senderTimerWindowSecs` and appends the history the timeline reads. */
    const view = await this.getTask(taskId as TaskId).catch(() => null);
    const negotiation = view?.budgetNegotiation ?? null;
    if (
      me &&
      negotiation &&
      negotiation.waitingForId === me &&
      negotiation.currentSecs === agreedSecs
    ) {
      const token = await this.#token();
      const r = await acceptBudgetRequest({ token, taskId });
      if (r.ok) return { ok: true };
      /* Falls through rather than failing: the other route may still work, and
         the engine's refusal here is about ITS state rather than about the
         budget being wrong. */
    }

    /* **`/set-budget`, not `setEffortEstimate`.** The latter posts to
       `department-tl-set-hours`, which opens with
       `if (task.status !== "pending_tl_hours") return 400` — so every attempt to
       apply an approved extension to a running task failed, and the record was
       left at `approved` with no sign of why. The engine now has a sibling route
       for the active case; the old one is untouched and still serves the gate. */
    const token = await this.#token();
    const applied = await setActiveTaskBudget({
      token,
      taskId,
      secs: agreedSecs,
    });
    if (applied.ok) return { ok: true };
    return {
      ok: false,
      message:
        applied.error.message ??
        "The agreed budget could not be applied to the task.",
    };
  }

  /**
   * What is new on each tab, and when this viewer last looked.
   *
   * Both halves in ONE read: a message arriving between two requests would
   * count as unread against a mark written after it, so the badge would never
   * clear. The engine keys both maps by tab id and this method never names
   * one — a tab added later is carried through untouched.
   */
  async readTaskTabActivity(taskId: TaskId): Promise<{
    activity: Record<string, { lastAt: string | null; items?: { at: string; by?: string | null }[] }>;
    seen: Record<string, string | null>;
  }> {
    const empty = { activity: {}, seen: {} };
    try {
      const token = await this.#token();
      const r = await fetchTaskTabActivity({ token, taskId: String(taskId) });
      if (!r.ok) return empty;
      const body = (r.data ?? {}) as Record<string, unknown>;
      return {
        activity:
          body.activity && typeof body.activity === "object"
            ? (body.activity as never)
            : {},
        seen:
          body.seen && typeof body.seen === "object" ? (body.seen as never) : {},
      };
    } catch {
      /* A badge is an affordance, never the page. An unreachable engine costs
         the dots and nothing else. */
      return empty;
    }
  }

  async markTaskTabSeen(
    taskId: TaskId,
    tabId: string,
  ): Promise<ActionResult<null>> {
    try {
      const token = await this.#token();
      const r = await markTaskTabSeenRequest({
        token,
        taskId: String(taskId),
        tabId,
      });
      if (!r.ok) {
        return { ok: false, code: "offline", message: "Could not mark the tab as read." };
      }
      return { ok: true, data: null };
    } catch {
      return { ok: false, code: "offline", message: "Could not mark the tab as read." };
    }
  }

  async listTimeBudgetExtensions(
    taskId: TaskId,
  ): Promise<TimeBudgetExtensionRecord[]> {
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_task_budget_extensions"),
        where("taskId", "==", String(taskId)),
      ),
    );
    return snap.docs.map((d) =>
      timeBudgetExtension({ ...(d.data() as Record<string, unknown>), id: d.id } as never),
    );
  }

  /**
   * A manager escalating a deadline to the assignor.
   *
   * **`cowork_task_deadline_extensions`, not `deadlineExtRequest`.** The old
   * record was shared with the hours conversation and had one status for both,
   * so "the manager granted the time" and "the assignor moved the date" were
   * the same transition. It also had no room for a counter-offer, which is the
   * ordinary answer rather than an edge case.
   *
   * Dates only. There is no duration parameter, so `oldDeadline + hours` — the
   * sum that is always wrong — cannot be expressed here.
   */
  async requestDeadlineExtensionRecord(input: {
    taskId: TaskId;
    proposedDeadline: string;
    reason?: string;
    /** Who decides the date. On a cross-department task this is the assignee's
        PRIMARY MANAGER — the same person who owns the hours — not the assignor:
        the assignor set the original date, but any change to the assignee's week
        is the manager's. Passed in by the decision card, which already resolved
        the manager for the hours. Falls back to the assignor only when absent. */
    approverId?: string;
  }): Promise<ActionResult<DeadlineExtensionRecord>> {
    const taskId = String(input.taskId);
    const { addDoc, collection, doc, getDoc } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", taskId));
    if (!snap.exists()) {
      return {
        ok: false,
        code: "not_found",
        message: "That task does not exist.",
      } as ActionResult<DeadlineExtensionRecord>;
    }
    const data = snap.data() as Record<string, unknown>;
    const dueMs = readDueAtMs(data as never);

    /* The assignor decides a date, and the configured fallback covers only the
       case where the task records none — historical work that has lost its
       assignor. `block` is the default, which offers no control at all: a
       commitment with no owner is not one somebody else may quietly move. */
    const deadlineRouting = await this.getWorkflowRouting().catch(
      () => DEFAULT_WORKFLOW_ROUTING,
    );

    const record = deadlineExtension({
      taskId,
      requestedBy: this.#ctx.employeeId ?? "",
      /* **The assignee's PRIMARY MANAGER owns the date, not the assignor.** The
         decision card passes the manager it already resolved for the hours; the
         same person moves the commitment, so a cross-department extension never
         leaves the assignee's management chain. Only where no manager is known
         does it fall back to the assignor (`routedDeadlineApproverId`), which is
         better than a commitment nobody can move. */
      approverId:
        input.approverId ||
        routedDeadlineApproverId({
          routing: deadlineRouting,
          createdById:
            (data.assignedBy as string) ?? (data.createdBy as string) ?? null,
        }),
      previousDeadline: dueMs === null ? null : new Date(dueMs).toISOString(),
      proposedDeadline: input.proposedDeadline,
      reason: input.reason ?? null,
      createdAt: new Date().toISOString(),
    });

    try {
      const ref = await addDoc(
        collection(legacyDb(), "cowork_task_deadline_extensions"),
        documentBody(record, DEADLINE_EXTENSION_REQUIRED),
      );
      /* Filed, and until now waiting on somebody who was never told. */
      this.#announce("deadline_extension_requested", {
        taskId: String(input.taskId),
        reason: input.reason ?? "",
      });
      notifyRepositoryChanged();
      return { ok: true, data: { ...record, id: ref.id } };
    } catch (e) {
      /* The SDK's words stay out of the UI. See the budget request above. */
      console.error("[requestDeadlineExtensionRecord]", e);
      return {
        ok: false,
        code: e instanceof PayloadError ? "validation_failed" : "offline",
        message: "Unable to submit extension request. Please try again.",
      } as ActionResult<DeadlineExtensionRecord>;
    }
  }

  /**
   * The assignor's answer: approve, refuse, or offer another date.
   *
   * Only an approval moves the commitment, and it moves it through legacy's own
   * `approve-deadline` route rather than by writing `cowork_tasks` here. A
   * counter-offer is an answer rather than a decision — the conversation
   * continues — and a refusal changes nothing at all.
   */
  async decideDeadlineExtension(
    recordId: string,
    decision: "approved" | "rejected" | "counter_proposed",
    input?: { counterDeadline?: string; reason?: string },
  ): Promise<ActionResult<DeadlineExtensionRecord | null>> {
    if (decision === "counter_proposed" && !input?.counterDeadline) {
      return {
        ok: false,
        code: "validation_failed",
        message: "A counter-offer needs a date.",
        field: "counterDeadline",
      } as ActionResult<DeadlineExtensionRecord | null>;
    }
    const { doc, getDoc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const ref = doc(legacyDb(), "cowork_task_deadline_extensions", recordId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return {
        ok: false,
        code: "not_found",
        message: "That request does not exist.",
      } as ActionResult<DeadlineExtensionRecord | null>;
    }
    const record = deadlineExtension({
      ...(snap.data() as Record<string, unknown>),
      id: recordId,
    } as never);

    if (decision === "approved") {
      /* The date ON THE TABLE. Once a counter has been made that is the figure
         being accepted; `proposedDeadline` is the one it answered. Passed as the
         EXPLICIT due date — not the rejection reason, which is where it used to
         land, so the agreed date never reached the task and the engine 400'd
         "No pending deadline proposal." on the missing on-task status. */
      const r = await this.decideDeadline(
        record.taskId as TaskId,
        true,
        undefined,
        liveDeadline(record),
      );
      if (!r.ok) return r as ActionResult<DeadlineExtensionRecord | null>;
    }

    const approvedAt = new Date().toISOString();
    await updateDoc(ref, {
      status: decision,
      approvedAt,
      decidedBy: this.#ctx.employeeId ?? "",
      ...(input?.counterDeadline
        ? { counterDeadline: input.counterDeadline }
        : {}),
      ...(input?.reason ? { reason: input.reason } : {}),
    });
    /* Approved, refused or countered — the assignee planned around this answer
       and had no way of knowing it had come. A counter is announced as a
       refusal of the date asked for, because that is what it is to the person
       waiting: the date they proposed is not the date they got. */
    this.#announce("deadline_extension_decided", {
      taskId: record.taskId,
      approved: decision === "approved",
      reason: input?.reason ?? "",
    });
    notifyRepositoryChanged();
    return {
      ok: true,
      data: {
        ...record,
        status: decision,
        approvedAt,
        decidedBy: this.#ctx.employeeId ?? "",
        counterDeadline: input?.counterDeadline ?? record.counterDeadline,
        reason: input?.reason ?? record.reason,
      },
    };
  }

  /**
   * The date conversation: the typed collection, then pre-migration rows.
   *
   * Old `deadlineHistory` entries stay readable and are marked `isHistorical`
   * so a screen can name them rather than offering decisions on them. Nothing
   * is migrated and no new write touches the old store.
   */
  async listDeadlineExtensionRecords(
    taskId: TaskId,
  ): Promise<DeadlineExtensionRecord[]> {
    const id = String(taskId);
    const { collection, doc, getDoc, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    const [own, snap] = await Promise.all([
      getDocs(
        query(
          collection(legacyDb(), "cowork_task_deadline_extensions"),
          where("taskId", "==", id),
        ),
      ).catch(() => null),
      getDoc(doc(legacyDb(), "cowork_tasks", id)),
    ]);

    const out: DeadlineExtensionRecord[] = (own?.docs ?? []).map((d) =>
      deadlineExtension({
        ...(d.data() as Record<string, unknown>),
        id: d.id,
      } as never),
    );

    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      const history = Array.isArray(data.deadlineHistory)
        ? data.deadlineHistory
        : [];
      for (const p of toDeadlineProposals(history, id)) {
        if (!p.proposedDueAt) continue;
        out.push(
          deadlineExtension({
            id: p.id,
            taskId: id,
            requestedBy: p.proposedById,
            approverId: p.decidedById,
            previousDeadline: null,
            proposedDeadline: p.proposedDueAt,
            reason: p.reason,
            status: "approved",
            createdAt: p.createdAt,
            approvedAt: p.decidedAt,
            decidedBy: p.decidedById,
            isHistorical: true,
          }),
        );
      }
    }
    return out;
  }

  async listProposals(taskId: TaskId): Promise<DeadlineProposal[]> {
    const id = String(taskId);
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", id));
    if (!snap.exists()) return [];
    const data = snap.data() as Record<string, unknown>;

    const history = Array.isArray(data.deadlineHistory) ? data.deadlineHistory : [];
    const proposals = toDeadlineProposals(history, id);
    const pending = toPendingExtension(data, id);
    return pending ? [pending, ...proposals] : proposals;
  }

  /**
   * Granted extensions — the chain of time actually added.
   *
   * **This returned `DeadlineProposal[]` while its contract says
   * `DeadlineExtension[]`.** The two are different shapes, and the chain
   * renderer reads three fields a proposal does not have: `newWindowSecs`,
   * `penaltyWaived` and `elapsedPercentAtRequest`. All three arrived
   * `undefined`, which is why the chain showed "+00:00:00 · 00:00:00 →
   * 00:00:00 · Penalty charged" and `Math.round(undefined)` printed NaN.
   *
   * It also returned the PENDING request, which is a question rather than a
   * record and already appears under negotiation history. Listing it here
   * duplicated it and gave it an approver it does not have.
   *
   * Legacy folds granted extensions into `deadlineHistory`, so that is the
   * ledger. Entries written before the request route carried seconds have no
   * amount and are skipped rather than shown as zeroes.
   */
  async listExtensions(taskId: TaskId): Promise<DeadlineExtension[]> {
    const id = String(taskId);
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", id));
    if (!snap.exists()) return [];
    const data = snap.data() as Record<string, unknown>;
    const history = Array.isArray(data.deadlineHistory) ? data.deadlineHistory : [];
    return toGrantedExtensions(history, id);
  }

  /**
   * Company holidays and this person's approved leave.
   *
   * The one path from HR data into Cowork's deadline maths, and it was already
   * built in `lib/legacy/attendance.ts` — it just had no repository method in
   * front of it, so the deadline picker offered dates the engine would refuse.
   */
  async listBlockedDates(
    employeeId: EmployeeId,
    from: string,
    to: string,
  ): Promise<BlockedDate[]> {
    /* The HR disconnect switch (Administration → Settings → Provisional
       rules). OFF means NOTHING is fetched from the HR side — no holidays, no
       leave — and every day reads as available. The deadline walk, the person
       calendar and the feasibility preview all pass through this method, so
       one gate covers every consumer. */
    if (!(await this.getHrHolidaySync())) return [];
    const token = await this.#token();
    /* `from` and `to` pass straight through — the live route takes a range and
       400s without both. It previously took a start plus a day COUNT, on a path
       that turned out never to have been mounted. */
    const result = await fetchBlockedDates({
      token,
      employeeId: String(employeeId),
      from,
      to,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.data.map((d) => ({
      date: d.date,
      kind: d.kind,
      label: d.label,
    })) as BlockedDate[];
  }

  /* ── Timer ──────────────────────────────────────────────────────────────
   *
   * **Firestore, not HTTP — and this is the one place that is correct.**
   *
   * Every task *write* in this application goes through the engine, because the
   * engine owns the lifecycle rules. Timers are the exception, and not by
   * oversight: legacy has **no REST endpoint for them at all**. `useTaskTimer`
   * writes `cowork_task_timers/{employeeId}/sessions/{taskId}` and appends to
   * `cowork_timer_events/{employeeId}/logs` straight from the browser, and the
   * server never sees a timer transition.
   *
   * So these write the same two documents, with the same field names and the
   * same arithmetic as the hook — verified field-for-field against live
   * production sessions. A different shape here would produce sessions the old
   * app cannot read, on the collection that feeds attendance and C4.
   */

  #timerSession(employeeId: string, taskId: string) {
    return import("firebase/firestore").then(async ({ doc }) => {
      const { legacyDb } = await import("../../legacy/firebase.ts");
      return doc(legacyDb(), "cowork_task_timers", employeeId, "sessions", taskId);
    });
  }

  /** Append to the event log. Failure here must not fail the transition. */
  async #logTimerEvent(
    employeeId: string,
    type: "start" | "pause",
    taskId: string,
    taskTitle: string,
    reason: string | null = null,
  ): Promise<void> {
    try {
      const { addDoc, collection, serverTimestamp } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      await addDoc(
        collection(legacyDb(), "cowork_timer_events", employeeId, "logs"),
        {
          type,
          taskId,
          /* The hook's own fallback: a session whose title never loaded logs
             the id rather than an empty string. */
          taskTitle: taskTitle || taskId,
          reason,
          at: serverTimestamp(),
        },
      );
    } catch (error) {
      /* The session document is the record; the log is the audit trail beside
         it. Losing a log line must not leave a timer half-started. */
      console.error("[timer] event log failed:", error);
    }
  }

  /**
   * Start or resume work on a task.
   *
   * Resume is not a separate operation — legacy has none. Starting a task that
   * already has accumulated seconds continues from that total, which is exactly
   * what resuming means and why `useTaskTimer` has no `resume`.
   *
   * **One timer at a time.** Any other running session is paused first, with
   * `switched_task` as the reason, matching the hook (`useTaskTimer:219-225`).
   * Without it a person accrues time against two tasks at once and the day's
   * total exceeds the day.
   */
  async startTimer(taskId: TaskId): Promise<ActionResult<unknown>> {
    const employeeId = String(this.#ctx.employeeId);
    const id = String(taskId);
    console.info("[timerdbg] ▶ startTimer invoked", { id }, new Error().stack);
    const { getDoc, setDoc } = await import("firebase/firestore");

    /**
     * **Three independent reads, asked at once.**
     *
     * These ran one after another — the task view, then presence, then the
     * active timer, then the session document — four sequential round trips
     * before a single byte was written. On a slow connection that stacked past
     * `TIMER_WRITE_TIMEOUT_MS` and the press came back with "That did not reach
     * the server in time", which is the reported lag.
     *
     * None of them depends on another's answer, so nothing is reordered by
     * asking together: the refusal below still reads presence, the task-switch
     * pause below still reads the active timer, and both still run in the same
     * order against the same values. Only the waiting is shared.
     *
     * The session document is fetched here too, for the same reason — it is
     * keyed by ids already in hand.
     */
    const [taskDoc, dutyMode, active, existing] = await Promise.all([
      /**
       * **The raw document, not the whole view.**
       *
       * This was `#readTaskView`, which builds a complete `TaskView` — the
       * queue chain, the office calendar, blocked dates, every sibling task —
       * and it was awaited before a single byte of the session was written.
       * All of that to read one string: `taskTitle`, a label written beside
       * the session and passed to a fire-and-forget log. It decides nothing.
       *
       * On a slow connection the view alone could outlast
       * `TIMER_WRITE_TIMEOUT_MS`, so pressing Resume returned "That did not
       * reach the server in time" while the clock stayed off. One document
       * read cannot.
       */
      this.#taskDoc(id),
      this.getDutyMode(),
      this.getActiveTimer(),
      /**
       * **The session document joins the batch instead of following it.**
       *
       * Reading it was a whole extra round trip AFTER these had all answered,
       * for one number — the banked `totalSeconds` to resume from. Nothing in
       * it depends on the three above, and the reference it needs costs no
       * network at all: `#timerSession` only builds a path.
       *
       * That trip is why starting felt slower than pausing. `pauseTimer` is one
       * read and one write, with the work commit and the event log deliberately
       * un-awaited behind it; starting was three reads, then a fourth read,
       * then the write. Now both are one round of reads and one write.
       *
       * Safe to read before the task-switch pause below: that pause writes the
       * session of a DIFFERENT task — the branch requires `active.taskId !== id`
       * — so it cannot change the document being read here.
       */
      this.#timerSession(employeeId, id).then((r) => getDoc(r)),
    ]);
    const ref = existing.ref;
    const taskTitle =
      (typeof taskDoc?.title === "string" && taskDoc.title.trim()) || id;

    /* **The offline restriction, held at the write.**
     *
     * Legacy's version of this rule lived entirely in render conditions — six
     * of them, in one 10,000-line file — so the same write reached Firestore
     * untouched from anywhere a condition had been forgotten. Putting it here
     * means a person who is on a break cannot start a clock whose minutes are
     * simultaneously being credited back to their deadlines, whatever screen
     * they found the button on.
     *
     * Pausing is deliberately NOT gated: stopping a clock is always allowed,
     * and refusing it would strand a running session for as long as somebody
     * stayed away. Legacy's auto-pause makes this rare rather than impossible —
     * a session started before a laptop slept is still running when it wakes. */
    const refusal = presenceWriteRefusal(dutyMode);
    if (refusal) return refusal;

    /**
     * **Nothing to work on means no clock — held at the write, like the rule
     * above it.**
     *
     * A task whose every declared output is waiting on somebody else's approval
     * cannot be started, and running the clock against it would bank time that
     * was never work. That is the exact unfairness the waiting model exists to
     * prevent, and it also contradicts the queue in the same breath: the task
     * has already given up P1 because nothing on it can be done.
     *
     * A task with SOME workable output is allowed. That is the point of
     * per-output delivery — Puri waiting on its input does not stop anybody
     * building Gopalpur, and blocking the whole task would put the batch back.
     *
     * A task with no outputs is unaffected: every task that predates them.
     */
    const outputs = Array.isArray(taskDoc?.outputs) ? taskDoc.outputs : [];
    if (outputs.length > 0) {
      const index = await this.#outputIndex();
      /* The SAME question the queue asks. An output already with a reviewer is
         not something its assignee can pick up, so a task whose only released
         output has been handed over has nothing to start — and must not be
         able to run a clock against it. */
      const anyWorkable = taskIsWorkable(taskDoc ?? {}, index.approved);
      if (!anyWorkable) {
        const firstNeed = outputs
          .flatMap((o) =>
            Array.isArray((o as { needsOutputIds?: unknown }).needsOutputIds)
              ? ((o as { needsOutputIds: string[] }).needsOutputIds ?? [])
              : [],
          )
          .find((n) => !index.approved.has(n));
        const label = firstNeed ? index.labels.get(firstNeed)?.label : null;
        return {
          ok: false,
          code: "invalid_state",
          message: label
            ? `Nothing on this task can be started yet — every output is waiting on “${label}”.`
            : "Nothing on this task can be started yet — every output is waiting on work that has not been approved.",
        };
      }
    }

    /* Pause whatever else is running. Still sequential and deliberately so —
       one timer at a time is the rule, and starting this one before the other
       has stopped would leave two running. */
    if (active && active.taskId !== id) {
      await this.pauseTimer(active.taskId, null, "switched_task" as never);
    }

    const accumulated = existing.exists()
      ? Number((existing.data() as { totalSeconds?: number }).totalSeconds) || 0
      : 0;

    const startNow = Date.now();
    await setDoc(
      ref,
      {
        employeeId,
        taskId: id,
        taskTitle,
        totalSeconds: accumulated,
        isActive: true,
        lastStartTime: startNow,
        /* The liveness beat, seeded at the start so a session paused before its
           first heartbeat still measures against a real timestamp. Moved forward
           by `heartbeatTimer` while the clock runs; the gap between the last beat
           and a pause is what `pauseTimer` refuses to bank. */
        heartbeatAt: startNow,
        updatedAt: startNow,
      },
      { merge: true },
    );
    /* Not awaited, for the reason spelled out in `pauseTimer`: the session
       write is the record and this is the audit trail beside it. Awaiting it
       let a slow log line decide whether a start could be confirmed. */
    void this.#logTimerEvent(employeeId, "start", id, taskTitle);

    /* **Starting the clock must NOT move this task's deadline.**
     *
     * An earlier version re-anchored the queue's `dueDate` at `Date.now()` on
     * every start, to mirror legacy's Play handler. But `startTimer` is also the
     * resume path, so it fired on every play — and `now + remaining` marches the
     * deadline forward each time the clock is (re)started, which is exactly the
     * drift this must not do. The deadline is the COMMITMENT: it is frozen while
     * a person is online and working, and moves only when availability is lost
     * (offline / break / emergency), by the lost working time. Actively burning
     * the budget is not lost time — it is the budget being spent as intended. See
     * `lib/rules/tasks/deadlineCompensation.ts`. The queue's operational
     * projection is still derived per read by `#chainQueue`; nothing needs to be
     * written here. */
    notifyRepositoryChanged();
    return { ok: true, data: { taskId: id, accumulatedSecs: accumulated } };
  }

  /**
   * Pause work, banking the elapsed time.
   *
   * The arithmetic is the hook's: `totalSeconds + floor((now - lastStartTime) /
   * 1000)`. Computed here rather than read from a tick, so a paused session is
   * correct even if the tab was throttled or asleep while it ran.
   */
  async pauseTimer(
    taskId: TaskId,
    message: string | null,
    reason: unknown,
  ): Promise<ActionResult<unknown>> {
    const employeeId = String(this.#ctx.employeeId);
    const id = String(taskId);
    console.info("[timerdbg] ⏸ pauseTimer invoked", { id, reason });
    const { addDoc, collection, getDoc, serverTimestamp, setDoc } = await import("firebase/firestore");

    const ref = await this.#timerSession(employeeId, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return {
        ok: false,
        code: "invalid_state",
        message: "There is no timer running on this task.",
      };
    }

    const data = snap.data() as {
      totalSeconds?: number;
      lastStartTime?: number;
      taskTitle?: string;
      heartbeatAt?: number;
    };
    const base = Number(data.totalSeconds) || 0;
    const startedAt = Number(data.lastStartTime) || Date.now();
    /* **Bank only the time the session was demonstrably alive.**
     *
     * A running clock writes `heartbeatAt` every ~45s (`heartbeatTimer`). When
     * the tab is closed or the laptop sleeps the beats stop — so time past the
     * last beat, plus the same staleness grace presence uses, was NOT worked and
     * must not be credited. Without this cap a session left "running" across a
     * two-hour gap banked the whole two hours the instant it was paused, which is
     * the "1:59:39 for a five-minute run" figure. A live pause is unaffected: its
     * last beat is at most one interval old, well inside the grace. */
    const elapsed = bankableRunSecs({
      startedAtRealMs: startedAt,
      heartbeatAtRealMs: Number(data.heartbeatAt) || null,
      nowRealMs: Date.now(),
      graceMs: TIMER_BANKABLE_GRACE_MS,
    });
    const total = base + elapsed;
    const pauseReason =
      message || (typeof reason === "string" ? reason : null) || null;

    await setDoc(
      ref,
      {
        employeeId,
        taskId: id,
        totalSeconds: total,
        isActive: false,
        /* Null, not deleted — the hook reads this key and a missing one would
           be indistinguishable from a session that never started. */
        lastStartTime: null,
        lastPauseReason: pauseReason,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    /**
     * **The session write above IS the pause. Everything below is an audit
     * trail, and it must not be awaited.**
     *
     * This used to `await` a work-commit `addDoc` and then a timer-event
     * `addDoc`, and only then call `notifyRepositoryChanged()` and return. Both
     * are `try`/`catch`ed, which handles a REJECTION and does nothing at all for
     * a write that simply does not come back — and a Firestore write does not
     * come back while the client is offline, it queues.
     *
     * The result was a pause that had visibly happened and could not be
     * confirmed. Firestore applies a write locally before the server
     * acknowledges it, so the task page's live listener showed "Paused"
     * immediately — while this promise sat behind two audit writes, the caller
     * timed out, and `notifyRepositoryChanged()` never ran, so the top-bar pill
     * never re-read and went on counting a session that had already stopped.
     * That is the reported "paused here, still running up there", and the red
     * "did not reach the server in time" beneath a clock that had plainly
     * stopped.
     *
     * So the notify and the return happen the moment the record is safe. The two
     * writes still go out and still land; they simply no longer decide whether
     * the person is told their pause worked. `#logTimerEvent`'s own note already
     * draws this line — "losing a log line must not leave a timer half-started"
     * — and a log line that is merely SLOW must not either.
     */
    notifyRepositoryChanged();

    if (elapsed > 0) {
      const nowMs = Date.now();
      void (async () => {
        const { legacyDb } = await import("../../legacy/firebase.ts");
        await addDoc(collection(legacyDb(), "cowork_work_commits"), {
          organisationId: LEGACY_ORGANISATION_ID,
          employeeId,
          taskId: id,
          taskTitle: data.taskTitle ?? id,
          startedAt: new Date(nowMs - elapsed * 1000).toISOString(),
          endedAt: new Date(nowMs).toISOString(),
          durationSecs: elapsed,
          createdAt: serverTimestamp(),
        });
      })().catch((e) =>
        console.error("[timer] work commit failed:", e?.message ?? e),
      );
    }

    void this.#logTimerEvent(
      employeeId,
      "pause",
      id,
      data.taskTitle ?? id,
      pauseReason,
    );

    return { ok: true, data: { taskId: id, loggedSecs: total } };
  }

  /**
   * Keep a running session alive — the record that stops a gap being paid for.
   *
   * Called on an interval by the timer control while the clock is genuinely
   * running (the assignee, online, not mid-reconnect). Its only job is to move
   * `heartbeatAt` forward. `pauseTimer` banks time only up to the last beat plus
   * the staleness grace, so a beat that never comes — a closed tab, a sleeping
   * laptop — is precisely what keeps the untracked hours out of the total.
   *
   * If the previous beat is already older than the staleness window, the gap
   * between them was not worked and is not credited — but the clock is NOT
   * stopped. See `#closeGapAndKeepRunning`.
   */
  async heartbeatTimer(taskId: TaskId): Promise<ActionResult<void>> {
    const employeeId = String(this.#ctx.employeeId);
    const id = String(taskId);
    const { getDoc, setDoc } = await import("firebase/firestore");
    const ref = await this.#timerSession(employeeId, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: true, data: undefined };
    const data = snap.data() as {
      isActive?: boolean;
      heartbeatAt?: number;
      lastStartTime?: number;
    };
    console.info("[timerdbg] ♥ heartbeatTimer", { id, isActiveOnRead: data.isActive });
    if (data.isActive !== true) return { ok: true, data: undefined };

    const now = Date.now();
    const lastBeat =
      Number(data.heartbeatAt) || Number(data.lastStartTime) || now;
    /* The BANKING grace, not the presence one. A gap shorter than this costs
       nothing — `bankableRunSecs` credits it in full — so reconciling at two
       minutes restarted the run for gaps that were never going to lose a
       second. This fires only where time would actually be dropped. */
    if (now - lastBeat > TIMER_BANKABLE_GRACE_MS) {
      await this.#closeGapAndKeepRunning(ref, id);
      return { ok: true, data: undefined };
    }
    await setDoc(ref, { heartbeatAt: now, updatedAt: now }, { merge: true });
    return { ok: true, data: undefined };
  }

  /**
   * A beat arrived after a quiet gap. Bank what was worked; keep running.
   *
   * **This used to call `pauseTimer(…, "went_away")`, and that was the bug.**
   * A beat is written BY the running tab, so a beat arriving is proof the tab is
   * alive — stopping the clock at the moment the evidence of life shows up is
   * self-contradictory. What actually happened in practice: a backgrounded tab
   * has its interval throttled (Chrome clamps a hidden tab's timers to about
   * once a minute, and an occluded window or a sleeping laptop stops them
   * outright), so an ordinary 45s beat lands past the 120s window, and somebody
   * working at their desk in another window came back to a stopped timer. The
   * event log shows eight of these against one task, each restarted by hand
   * within twenty seconds.
   *
   * **The integrity property is unchanged.** The gap is still not paid for:
   * `bankableRunSecs` is the same function `pauseTimer` uses, and it caps the
   * credit at the last beat plus the grace. The difference is only what happens
   * to the clock afterwards — the run restarts from now instead of stopping, so
   * a person who never left does not have to notice and press Start again.
   *
   * A genuine departure is still handled, and by the thing that actually knows
   * about it: going on break or offline pauses the timer through presence, and a
   * tab that is truly gone sends no beat at all, so nothing here runs and the
   * cap applies whenever the session is finally closed.
   *
   * Done in a TRANSACTION because two beats can race — the log shows every
   * `went_away` written twice in the same second, which is this path firing
   * concurrently. Two un-transacted resumes would each bank the same gap.
   */
  async #closeGapAndKeepRunning(
    ref: import("firebase/firestore").DocumentReference,
    id: string,
  ): Promise<void> {
    const { runTransaction } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    try {
      await runTransaction(legacyDb(), async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists()) return;
        const d = fresh.data() as {
          isActive?: boolean;
          totalSeconds?: number;
          lastStartTime?: number;
          heartbeatAt?: number;
        };
        /* Re-checked inside the transaction: the racing beat may have closed
           this gap already, and banking it twice is the failure this exists to
           prevent. */
        if (d.isActive !== true) return;
        const now = Date.now();
        const lastBeat =
          Number(d.heartbeatAt) || Number(d.lastStartTime) || now;
        /* Same threshold as the caller, re-checked inside the transaction: a
           racing beat may have closed this gap already. */
        if (now - lastBeat <= TIMER_BANKABLE_GRACE_MS) return;

        const banked = bankableRunSecs({
          startedAtRealMs: Number(d.lastStartTime) || now,
          heartbeatAtRealMs: Number(d.heartbeatAt) || null,
          nowRealMs: now,
          graceMs: TIMER_BANKABLE_GRACE_MS,
        });
        tx.set(
          ref,
          {
            totalSeconds: (Number(d.totalSeconds) || 0) + banked,
            /* The run restarts HERE. Everything between the last beat and now
               is outside both the old run and the new one, which is exactly
               how it goes uncredited without the clock stopping. */
            lastStartTime: now,
            heartbeatAt: now,
            isActive: true,
            updatedAt: now,
          },
          { merge: true },
        );
      });
      console.info("[timerdbg] ↻ gap closed, still running", { id });
    } catch (e) {
      /* A failed reconcile leaves the session running with an old beat. The
         next beat tries again, and the cap in `pauseTimer` still protects the
         total whenever it is eventually stopped. */
      console.error(
        "[timer] gap reconcile failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /* ── Office policy ──────────────────────────────────────────────────────
   *
   * `cowork_settings/office`, which legacy writes from the browser with no REST
   * route — the same exception class as the timer and the duty document. Every
   * field in it already drives something in this app; see `officePolicy.ts`.
   */

  async getOfficePolicy(): Promise<OfficePolicy> {
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), "cowork_settings", "office"));
    /* An absent document is a workspace that has never opened the settings
       page, not a fault. `readOfficePolicy` supplies legacy's own defaults. */
    return readOfficePolicy(
      snap.exists() ? (snap.data() as Record<string, unknown>) : null,
    );
  }

  /**
   * Save the policy.
   *
   * Validated here rather than only in the form, because these values feed
   * deadline arithmetic directly: a working day of negative length makes
   * `addWorkingSecs` produce a due date in the past, and a form is not the
   * only thing that can call this.
   *
   * Merged, not replaced — the document carries fields this app does not model
   * and overwriting it whole would drop them.
   */
  /**
   * Office hours, holidays and breaks — through the audit service, always.
   *
   * **This wrote Firestore directly.** A change that moves the expected
   * completion of every live task in the company left no record of who made it,
   * from what, or when. The only way to answer "why did my due date change?"
   * was to guess.
   *
   * The order is fixed by `applySettingsChange`: read what is in force, diff it,
   * write, then log. The old value has to be read BEFORE the write or there is
   * nothing to diff against — which is exactly the mistake a caller makes when
   * logging is bolted on afterwards.
   *
   * Permission is checked here rather than only in the route guard. A guard
   * decides who may open a page; this decides who may change the company's
   * working week, and the two are not the same question.
   */
  /**
   * **THE settings write path. There is no other, and adding one is a defect.**
   *
   * Every administrative setting — office policy, scoring values, task rules,
   * workflow routing, rule overrides — goes through this one method. It is
   * private so that it cannot be called from outside the repository, and the six
   * public setters below are thin wrappers that supply a section's own
   * validation and document shape.
   *
   * The split this closes: `OfficeSettings.tsx` called `setOfficeHours` while
   * `ProvisionalRulesArea` called `setOfficePolicy`, both targeting
   * `cowork_settings/office`, and only the second was audited. The earlier test
   * asserting "the office document is written from exactly one place" passed only
   * because `setOfficeHours` did not exist in this class at all — so it was
   * asserting the absence of a method rather than the presence of a rule.
   *
   * Five things happen here in a fixed order, and the order is the point:
   *
   *  1. **Validate.** Before the permission check, because a refusal for invalid
   *     input is not a security answer and should not read like one.
   *  2. **Authorise**, from the archetype the session resolved — never inferred
   *     from a legacy role string. `legacyRole === "ceo"` used to do that job and
   *     it is the undocumented second door this layer exists to close.
   *  3. **Read what is in force.** Without this there is no before-value, and a
   *     log that records only the new value answers a question the settings
   *     document already answers.
   *  4. **Write, then log** — `applySettingsChange`'s order. The reverse records
   *     changes that then failed to save, and a log claiming a change nobody can
   *     see is worse than a missing entry because somebody would trust it.
   *  5. **Mirror**, where a section has a second store that must not go stale.
   */
  async #writeSettingsSection<T>(input: {
    /** The audit section string. Fixed vocabulary — see `sections.ts`. */
    section: string;
    type: string;
    /** Why this cannot be saved, or null. The section's own rule. */
    refusal: string | null;
    /** What is in force now. Read by the caller, since only it knows how. */
    before: T | null;
    after: T;
    reason?: string | null;
    /** The Firestore collection and document id to merge into. */
    path: [collection: string, id: string];
    /** The document body. Field names are legacy's and are not up for tidying. */
    body: (value: T) => Record<string, unknown>;
    /**
     * A second store that must agree with the first.
     *
     * Runs only after the Firestore write has landed, and its failure is
     * reported rather than swallowed — a mirror that silently did not happen is
     * two stores disagreeing about a published score.
     */
    mirror?: (value: T) => Promise<void>;
  }): Promise<ActionResult<T>> {
    if (input.refusal) {
      return { ok: false, code: "validation_failed", message: input.refusal };
    }
    if (!maySettings({ archetype: this.#ctx.archetype ?? null })) {
      return { ok: false, code: "permission_denied", message: SETTINGS_REFUSAL };
    }

    const { addDoc, collection, doc, setDoc } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const [collectionName, documentId] = input.path;

    let mirrorFailed: string | null = null;

    const result = await applySettingsChange<T>({
      section: input.section,
      type: input.type,
      changedById: this.#ctx.employeeId ?? null,
      changedAt: new Date().toISOString(),
      /* An absent document diffs against `{}`, so the first save records every
         field as a change from "not set". That is the honest first entry: the
         values were previously the code's defaults, not something anybody chose. */
      before: (input.before ?? {}) as T,
      after: input.after,
      reason: input.reason ?? null,
      newId: () => "",
      write: async (value) => {
        try {
          await setDoc(
            doc(legacyDb(), collectionName, documentId),
            input.body(value),
            { merge: true },
          );
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error
                ? `The settings could not be saved: ${error.message}`
                : "The settings could not be saved.",
          };
        }
        /* Inside `write`, after the document has landed, so a mirror failure
           cannot report success for a write that did not happen — and so the
           audit entry still records the change that IS in force. */
        if (input.mirror) {
          try {
            await input.mirror(value);
          } catch (error) {
            mirrorFailed =
              error instanceof Error ? error.message : "the mirror call failed";
          }
        }
        return { ok: true };
      },
      log: async (entry) => {
        await addDoc(
          collection(legacyDb(), "cowork_settings_audit"),
          documentBody(entry, AUDIT_REQUIRED),
        );
      },
    });

    if (!result.ok) {
      return {
        ok: false,
        code: "conflict",
        message: result.error ?? "The settings could not be saved.",
      };
    }
    if (result.unlogged) {
      /* NOT silently ignored. The setting really did change, so the caller is
         told which half succeeded — a change with no record is the thing this
         path exists to prevent. The technical cause is logged for a developer;
         the message on screen stays short. */
      console.error(
        `[${input.section}] the setting was saved but its audit entry was not written`,
      );
      return {
        ok: false,
        code: "conflict",
        message:
          "Settings saved but audit logging failed. The change is in force and is not recorded — tell an administrator.",
      };
    }
    if (mirrorFailed) {
      console.error(`[${input.section}] mirror failed: ${mirrorFailed}`);
      return {
        ok: false,
        code: "conflict",
        message:
          "Saved, but the copy the scoring engine keeps in its own store was not updated. The two now disagree — tell an administrator before relying on a score.",
      };
    }
    notifyRepositoryChanged();
    return { ok: true, data: input.after };
  }

  async setOfficePolicy(
    policy: OfficePolicy,
    reason?: string,
  ): Promise<ActionResult<OfficePolicy>> {
    return this.#writeSettingsSection<OfficePolicy>({
      section: AUDIT_SECTION["office-policy"],
      type: OFFICE_POLICY_CHANGED,
      refusal: validateOfficePolicy(policy),
      before: await this.getOfficePolicy().catch(() => null),
      after: policy,
      reason,
      path: ["cowork_settings", "office"],
      body: (value) => writeOfficePolicy(value, String(this.#ctx.employeeId)),
    });
  }

  /* ── The other settings sections ─────────────────────────────────────────
   *
   * Each pair is a read and a write, and every write is one call to
   * `#writeSettingsSection`. The reads are NOT permission-checked: everybody may
   * see the rules they work under — that is not privileged information, and a
   * person who cannot find the working hours assumes they are not configured.
   * Only the writes are gated.
   */

  /** A settings document, or null when it has never been written. */
  async #settingsDoc(
    collectionName: string,
    documentId: string,
  ): Promise<Record<string, unknown> | null> {
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), collectionName, documentId));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  }

  async getTaskRules(): Promise<TaskRules> {
    return readTaskRules(
      await this.#settingsDoc("cowork_settings", "task_rules"),
    );
  }

  async setTaskRules(
    rules: TaskRules,
    reason?: string,
  ): Promise<ActionResult<TaskRules>> {
    return this.#writeSettingsSection<TaskRules>({
      section: AUDIT_SECTION["task-rules"],
      type: TASK_RULES_CHANGED,
      refusal: validateTaskRules(rules),
      before: await this.getTaskRules().catch(() => null),
      after: rules,
      reason,
      path: ["cowork_settings", "task_rules"],
      body: (value) => writeTaskRules(value, String(this.#ctx.employeeId)),
    });
  }

  async getWorkflowRouting(): Promise<WorkflowRouting> {
    return readWorkflowRouting(
      await this.#settingsDoc("cowork_settings", "workflow_routing"),
    );
  }

  async setWorkflowRouting(
    routing: WorkflowRouting,
    reason?: string,
  ): Promise<ActionResult<WorkflowRouting>> {
    return this.#writeSettingsSection<WorkflowRouting>({
      section: AUDIT_SECTION["workflow-routing"],
      type: WORKFLOW_ROUTING_CHANGED,
      refusal: validateWorkflowRouting(routing),
      before: await this.getWorkflowRouting().catch(() => null),
      after: routing,
      reason,
      path: ["cowork_settings", "workflow_routing"],
      body: (value) => writeWorkflowRouting(value, String(this.#ctx.employeeId)),
    });
  }

  async getScoringSettings(): Promise<ScoringSettings> {
    return readScoringSettings(
      await this.#settingsDoc("cowork_sop_settings", "task_events"),
    );
  }

  /**
   * Scoring values — Firestore **and** the MongoDB mirror.
   *
   * The mirror is not optional and not a nicety. `BandConfig.globalSettings.c1.*`
   * is a second copy of these numbers read by band resolution, while the engine's
   * `getC1Config` reads the Firestore copy. Writing one and not the other leaves
   * a score computed from one figure and explained from another, with nothing
   * anywhere reporting the divergence — the exact failure
   * `lib/config/settings.ts` was written to prevent, except across a process
   * boundary where no override layer can rescue it.
   *
   * Legacy's own page does both, in this order, from
   * `app/coworking/sop/page.js`. The route is `verifyCeoToken`, which is the same
   * authority this method has already checked.
   */
  async setScoringSettings(
    settings: ScoringSettings,
    reason?: string,
  ): Promise<ActionResult<ScoringSettings>> {
    return this.#writeSettingsSection<ScoringSettings>({
      section: AUDIT_SECTION["priority-scoring"],
      type: SCORING_CHANGED,
      refusal: validateScoringSettings(settings),
      before: await this.getScoringSettings().catch(() => null),
      after: settings,
      reason,
      path: ["cowork_sop_settings", "task_events"],
      body: (value) =>
        writeScoringSettings(
          value,
          String(this.#ctx.employeeId),
          /* The id twice rather than a display name. The context does not carry
             one, and inventing a lookup here to fill a field legacy only ever
             displays would put a directory read on the settings write path. */
          String(this.#ctx.employeeId),
        ),
      mirror: async (value) => {
        const result = await legacyFetch<unknown>({
          path: "/cowork/sop/settings/sync",
          method: "POST",
          body: scoringSyncBody(value),
          token: await this.#token(),
        });
        /* Raised, not returned. `#writeSettingsSection` catches it and reports
           the disagreement; resolving to a failure here would let a caller that
           ignored the value carry on as though both stores agreed. */
        if (!result.ok) throw new Error(result.error.message);
      },
    });
  }

  async getHrHolidaySync(): Promise<boolean> {
    const doc = await this.#settingsDoc("cowork_settings", "integrations");
    /* Absent means ON — the standing behaviour. Only an explicit false
       disconnects, so shipping this setting changes nothing by itself. */
    return doc?.hrHolidaySync !== false;
  }

  /**
   * The HR disconnect switch. `listBlockedDates` reads it on every call, so
   * flipping it takes effect on the next deadline computation — no reload.
   *
   * **Audited like every other setting**, through the shared writer. It was
   * briefly its own `setDoc`, which meant the one switch that can empty the
   * company's holiday calendar was the only settings change leaving no trace of
   * who flipped it. `affectsDeadlines` marks the row, so it surfaces in the log
   * beside the office-hours edits it behaves like.
   */
  async setHrHolidaySync(enabled: boolean): Promise<ActionResult<boolean>> {
    const result = await this.#writeSettingsSection<{ hrHolidaySync: boolean }>({
      section: AUDIT_SECTION["provisional-rules"],
      type: HR_HOLIDAY_SYNC_CHANGED,
      refusal: null,
      before: { hrHolidaySync: await this.getHrHolidaySync().catch(() => true) },
      after: { hrHolidaySync: enabled },
      path: ["cowork_settings", "integrations"],
      body: (value) => ({
        hrHolidaySync: value.hrHolidaySync,
        updatedAt: Date.now(),
        updatedBy: String(this.#ctx.employeeId),
      }),
    });
    return result.ok
      ? { ok: true, data: result.data.hrHolidaySync }
      : result;
  }

  async getRuleOverrides(): Promise<RuleOverrides> {
    return readRuleOverrides(
      await this.#settingsDoc("cowork_settings", "rule_overrides"),
    );
  }

  /**
   * Published rule values.
   *
   * The stored document is REPLACED rather than merged, unlike every other
   * section here. A cleared override has to disappear from the document — an
   * override equal to the seeded default is a different fact from no override at
   * all, and it is the fact the "Resolved" badge renders. Merging would make
   * clearing impossible and the badge permanently wrong.
   */
  async setRuleOverrides(
    overrides: RuleOverrides,
    reason?: string,
  ): Promise<ActionResult<RuleOverrides>> {
    const result = await this.#writeSettingsSection<RuleOverrides>({
      section: AUDIT_SECTION["provisional-rules"],
      type: PROVISIONAL_RULES_CHANGED,
      refusal: validateRuleOverrides(overrides),
      before: await this.getRuleOverrides().catch(() => null),
      after: overrides,
      reason,
      path: ["cowork_settings", "rule_overrides"],
      /* `overrides` is written whole, so a key removed from the map is removed
         from the document — `setDoc` with merge replaces a map-valued field
         rather than deep-merging it. */
      body: (value) => writeRuleOverrides(value, String(this.#ctx.employeeId)),
    });

    /* The engine reads through the module-level map, so a save that did not
       update it would leave this browser scoring at the previous values until
       reload — the divergence in the other direction. Applied only on success. */
    if (result.ok) applyRuleOverrides(overrides);
    return result;
  }

  /**
   * One person's duty-status document.
   *
   * `cowork_duty_status/{employeeId}` — the path helper in `attendance.ts` is
   * the single definition; this only turns it into a reference.
   */
  /**
   * The settings audit log.
   *
   * The permission is checked HERE as well as at the route. A guard decides who
   * may open a page; this decides who may read the record of every
   * configuration change ever made, and a page is not the only way to call a
   * repository.
   */
  async listSettingsAudit(limit = 100): Promise<AuditEntry[]> {
    if (!mayReadAuditLog({ archetype: this.#ctx.archetype ?? null })) {
      throw new Error(AUDIT_REFUSAL);
    }

    const { collection, getDocs, query, orderBy, limit: cap } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_settings_audit"),
        orderBy("changedAt", "desc"),
        cap(Math.max(1, Math.min(500, limit))),
      ),
    );
    return snap.docs.map(
      (d) => ({ ...(d.data() as AuditEntry), id: d.id }) as AuditEntry,
    );
  }

  #dutyDoc(employeeId: string) {
    return import("firebase/firestore").then(async ({ doc }) => {
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const [collectionName, id] = dutyStatusPath(employeeId);
      return doc(legacyDb(), collectionName, id);
    });
  }

  async #readDutyDoc(employeeId: string): Promise<DutyDocument | null> {
    const { getDoc } = await import("firebase/firestore");
    const snap = await getDoc(await this.#dutyDoc(employeeId));
    return snap.exists() ? (snap.data() as DutyDocument) : null;
  }

  async getDutyMode(employeeId?: EmployeeId): Promise<DutyMode> {
    const id = String(employeeId ?? this.#ctx.employeeId);
    return readDutyMode(await this.#readDutyDoc(id), Date.now());
  }

  /**
   * Move presence, with legacy's transition arithmetic.
   *
   * The ownership check is what makes two tabs safe. A tab that is not holding
   * the live claim may not clear it — otherwise opening a second tab, which has
   * no room and therefore sees "not sharing", would end a share the first tab
   * is still publishing to a watching manager.
   *
   * Claiming is unconditional by contrast: a tab that has just started sharing
   * IS the live one, and saying so is the whole point of the write.
   */
  async setDutyMode(input: {
    mode: DutyMode;
    connectionId: string | null;
    reason?: string | null;
    /** A person asked for this rather than a tab deriving it — see the
        interface, and the guard below. */
    deliberate?: boolean;
  }): Promise<ActionResult<DutyMode>> {
    const employeeId = String(this.#ctx.employeeId);
    const now = Date.now();
    const previous = await this.#readDutyDoc(employeeId);

    console.info("[presence] PRESENCE UPDATE RECEIVED:", {
      employeeId,
      previousMode: storedMode(previous),
      requestedMode: input.mode,
      connectionId: input.connectionId,
    });

    /**
     * **A tab that does not hold the claim may not publish a DERIVED offline.**
     *
     * A second tab has no room, so its honest reading is "nothing is being
     * shared" — publishing that would end a share the first tab is still
     * sending. That is what this refuses, and it is right.
     *
     * **It is wrong for a DELIBERATE one, and that was the bug.** Pressing Go
     * offline is a decision about a person, not a reading by a tab: presence
     * belongs to them, not to whichever connection happens to hold the claim.
     * Declining it left the document online and answered "online is in force",
     * so the caller marked that as published, no retry ever came, and every
     * device went back to green. The person pressed the button and nothing
     * happened — repeatedly.
     */
    if (
      !input.deliberate &&
      input.mode !== "online" &&
      !ownsClaim(previous, input.connectionId, now)
    ) {
      /* Not an error on screen — the other tab is right and this one is simply
         not the one holding the session. Reporting the mode that IS in force
         keeps the caller's view correct rather than telling it nothing. */
      return { ok: true, data: readDutyMode(previous, now) };
    }

    /* **The compensation is applied here, live, not banked for the old app.**
     *
     * The old plan wrote the lost span into `pendingBreakGapMs` /
     * `pendingEmergencyGapMs` and left the old frontend's
     * `applyPendingBreakGap` / `applyPendingEmergencyApproval` to act on it. But
     * a person on THIS UI never loads the old one, so those functions never run
     * and the deadline never moved — the whole point of the feature was inert in
     * production. So this build applies the shift itself, and therefore does NOT
     * bank (`bankEvenWhenRaising: false`): banking a span we also apply here is
     * how the same absence would move a deadline twice if the old app ever did
     * run. The credit is the RAW span the transition measured — legacy's
     * `now - unavailableStartedAt` — because only an EXPLICIT offline/break/
     * emergency stamps a start; a browser close resolves through staleness and
     * stamps nothing, so it contributes zero rather than a whole night. */
    const { patch, offlineToCreditMs, breakToCreditMs, emergencyToRaiseMs } =
      dutyTransition({
        previous,
        next: input.mode,
        nowMs: now,
        connectionId: input.connectionId,
        reason: input.reason ?? null,
        bankEvenWhenRaising: false,
      });

    const { setDoc, addDoc, collection } = await import("firebase/firestore");
    await setDoc(await this.#dutyDoc(employeeId), { employeeId, ...patch }, { merge: true });

    /* **The history entry — append-only, alongside the document patch.**
     *
     * `cowork_duty_status` is overwritten on every transition and remembers
     * only the current mode; nothing else records what a day actually looked
     * like. Written here rather than derived from the document later because
     * by the time anyone asks, the earlier modes are already gone — this is
     * the only place that ever sees the transition happen. Not awaited into
     * the caller's success: a person's presence changing is real the moment
     * the document above is written, and a history write failing must not
     * turn that into an error on screen. */
    void (async () => {
      const { legacyDb } = await import("../../legacy/firebase.ts");
      await addDoc(collection(legacyDb(), "cowork_duty_history"), {
        employeeId,
        mode: input.mode,
        at: now,
        reason: input.mode === "emergency" ? (input.reason ?? null) : null,
      });
    })().catch((error) => console.error("[duty] history write failed:", error));

    /* **Deadline compensation: the ONE event that moves a deadline.**
     *
     * Returning to online from an unavailable state is the only trigger — not a
     * play, a heartbeat, a refresh or a running timer. The lost time is added to
     * every active task's stored deadline, once, and then it is frozen again
     * because nothing else writes it while the person is online. */
    /**
     * **A finished break is owed whatever the person does next.**
     *
     * This used to run only on `mode === "online"`, and `derive()` says online
     * is a live screen share and nothing else — so ending a break without
     * sharing lands on `offline`, the branch never ran, and the break time was
     * silently never added to any deadline. That is the whole bug.
     *
     * The two spans are owed on different events, which is why they are now
     * separated rather than summed behind one condition:
     *
     *  · **break / emergency** — owed the moment the span ENDS. The person was
     *    unavailable for a measured stretch; what they do next cannot change
     *    that it happened.
     *  · **offline** — owed only on RETURNING, because an offline span has no
     *    end until somebody comes back, and crediting it on the way out would
     *    be crediting time that is still running.
     */
    {
      /**
       * The day's break allowance — Admin → Office policy → break time.
       *
       * Bounds the CREDIT, not the break. Somebody may take as long a break as
       * they need; the policy limits how much of it moves deadlines. A running
       * total is kept on the duty document, stamped with its day, because a cap
       * with no ledger is not a cap — three twenty-minute breaks would each be
       * under a sixty-minute allowance and together exceed it.
       *
       * Only BREAK time is capped. Emergency time is reviewed and approved on
       * its own terms, and an offline span is not an allowance somebody spends.
       */
      let creditedBreakMs = breakToCreditMs;
      if (breakToCreditMs > 0) {
        const policy = await this.getOfficePolicy().catch(() => null);
        const grant = grantBreakCredit({
          spanMs: breakToCreditMs,
          maxMinutesPerDay: policy?.maxBreakMinutesPerDay,
          ledger: readBreakLedger((previous ?? {}) as Record<string, unknown>),
          nowMs: now,
        });
        creditedBreakMs = grant.grantedMs;
        await setDoc(
          await this.#dutyDoc(employeeId),
          writeBreakLedger(grant.ledger),
          { merge: true },
        );
        if (grant.deniedMs > 0) {
          console.info("[presence] BREAK ALLOWANCE reached:", {
            employeeId,
            askedMinutes: Math.round(breakToCreditMs / 60000),
            grantedMinutes: Math.round(grant.grantedMs / 60000),
            deniedMinutes: Math.round(grant.deniedMs / 60000),
          });
        }
      }

      /**
       * **Emergency time is NOT credited here — it is only raised.**
       *
       * `dutyTransition` names the two spans with different verbs on purpose:
       * `breakToCreditMs` is "credit NOW", `emergencyToRaiseMs` is "raise for
       * approval NOW". Summing them treated an unreviewed emergency as an
       * approved one, so leaving Emergency Mode moved every deadline before a
       * manager had seen the reason or the document — which is the whole thing
       * the approval exists to prevent.
       *
       * The span still travels: `createEmergencyRequest` records it, and
       * `decideEmergencyRequest` applies it if and only if somebody approves.
       */
      const endedSpanMs = creditedBreakMs;

      /**
       * **An offline span is bounded to the working day.**
       *
       * `dutyTransition` returns the RAW wall-clock absence and its own comment
       * says the caller bounds it — no caller did. So going offline at 18:00
       * and returning at 10:00 credited sixteen hours and moved every deadline
       * a full day. Overnight was free time.
       *
       * Only the minutes inside office hours count, which is also what makes a
       * weekend contribute nothing without a special case for weekends.
       */
      let returningMs = input.mode === "online" ? offlineToCreditMs : 0;
      if (returningMs > 0) {
        const startedAtMs = now - returningMs;
        const policy = await this.getOfficePolicy().catch(() => null);
        if (!policy) {
          /* Not silently zeroed — a missing schedule must not delete somebody's
             credit, which is the quieter and worse failure. Logged instead. */
          console.warn(
            "[presence] no office policy; crediting the raw offline span",
            { employeeId, minutes: Math.round(returningMs / 60000) },
          );
        }
        returningMs = absenceCreditMs({ fromMs: startedAtMs, toMs: now, policy });
      }
      const lostMs = endedSpanMs + returningMs;
      if (lostMs > 0) {
        /* Named by CAUSE, because the history has to answer "why". The two
           spans arrive summed, so the label says which contributed — a reader
           seeing only "absence credited" cannot tell a break from an overnight
           and will assume the emergency they never had approved. */
        const mins = (ms: number) => Math.round(ms / 60000);
        const parts: string[] = [];
        if (endedSpanMs > 0) parts.push(`break ${mins(endedSpanMs)}m`);
        if (returningMs > 0) parts.push(`offline ${mins(returningMs)}m`);
        const shifted = await this.#compensateActiveDeadlines(
          employeeId,
          lostMs,
          parts.length
            ? `Time credited back — ${parts.join(" + ")}`
            : "Time credited back",
        );
        /* **Broken down by cause, because the total alone cannot be diagnosed.**
         * "My deadline moved and nobody approved anything" is a report that fits
         * two completely different mechanisms — a credited break and a credited
         * offline absence — and neither involves an emergency, which is gated on
         * `decideEmergencyRequest`. A single `lostMinutes` figure left the reader
         * to guess which had fired, and the guess was usually "the emergency".
         *
         * `emergencyMinutes` is logged as an explicit zero rather than omitted:
         * seeing it there and reading 0 is what rules the emergency out, and an
         * absent key proves nothing. */
        console.info("[presence] DEADLINE COMPENSATION applied:", {
          employeeId,
          from: input.mode,
          lostMinutes: Math.round(lostMs / 60000),
          breakMinutes: Math.round(endedSpanMs / 60000),
          offlineMinutes: Math.round(returningMs / 60000),
          emergencyMinutes: 0,
          tasksShifted: shifted,
        });
      }
    }

    /* Leaving online stops the work clock. Legacy auto-pauses on break, on
       emergency AND on going offline (`DutyStatusToggle.jsx:188, 419`), with
       `logged_out` as the reason — without it the same wall-clock minutes are
       both credited as worked and given back as deadline. */
    if (input.mode !== "online") {
      try {
        const active = await this.getActiveTimer();
        if (active) {
          await this.pauseTimer(active.taskId as TaskId, null, "logged_out");
        }
      } catch (error) {
        console.error("[duty] auto-pause failed:", error);
      }
    }

    notifyRepositoryChanged();
    return { ok: true, data: input.mode };
  }

  /**
   * Add lost availability time to every active task's stored deadline.
   *
   * The production application of the compensation rule, writing straight to
   * `cowork_tasks` in Firestore — the same store and same exception class as the
   * timer and the duty document (there is no REST route for a deadline write).
   *
   *  · **`dueAt += lostMs`, raw.** Legacy's `now - unavailableStartedAt`. Not run
   *    through the office calendar: the caller only reaches here on an explicit
   *    return to online, and the span it carries is the one the person was
   *    genuinely away.
   *  · **The field that actually carries the deadline.** `readDueAtMs` reads
   *    `fixedDeadline ?? deadline ?? dueDate`, so the shift is written back to
   *    whichever of those held the value — writing `dueDate` on a task dated by
   *    `fixedDeadline` would move a number nothing reads.
   *  · **Active only.** Terminal tasks are records; a task with no deadline has
   *    nothing to move.
   *  · **`dueDate`, never `officialDueDate`.** An absence moves the working
   *    deadline, not the scored commitment — the same separation a break makes.
   *
   * Failure is logged and swallowed: the duty transition has already been
   * written and is the thing the caller asked for, and reporting the whole change
   * as failed because a deadline write did would send them to toggle again.
   */
  /**
   * Drop any banked emergency span from the duty document.
   *
   * Failure is logged and swallowed: the decision has landed and the deadlines
   * have moved, and reporting the whole thing as failed because a cleanup write
   * did would send a manager to decide again.
   */
  async #clearPendingEmergencyGap(employeeId: string): Promise<void> {
    try {
      const { setDoc } = await import("firebase/firestore");
      await setDoc(
        await this.#dutyDoc(employeeId),
        { pendingEmergencyGapMs: null, pendingEmergencyReason: null },
        { merge: true },
      );
    } catch (error) {
      console.error("[presence] pending emergency gap not cleared:", error);
    }
  }

  /**
   * Move ONE task's deadline to a given instant, and record why.
   *
   * The absence version shifts every active task by a shared span;
   * a meeting credits each task its own figure, so this takes an absolute
   * target rather than a duration. Both write the same
   * `cowork_task_deadline_extensions` row, so one History tab answers "why is
   * this due later" whatever moved it.
   */
  /**
   * Give a task its time back, on whichever of the two axes it actually has.
   *
   * **A task can have a budget and no stored deadline, and most do.** The
   * creator sets hours; the DATE is derived from the receiver's queue and is
   * never written down. This method used to open with "find the deadline field,
   * and return if there isn't one" — so on exactly those tasks it returned
   * before touching the budget, and a credited meeting moved nothing. Expected
   * completion is computed from the WINDOW, so the one write that mattered was
   * the one being skipped.
   *
   * The two are now independent. The window is written whenever there is a new
   * one, and the date only where a date exists to move. Each leaves its own kind
   * of history record, because "your deadline moved from 17:21 to 17:26" and
   * "your budget grew by five minutes" are different sentences and only one of
   * them is true on any given task.
   */
  /**
   * File a receipt for a budget that GREW, so the growth has an account.
   *
   * **A separate collection from `cowork_task_budget_extensions`, and that is
   * the whole point.** That one is a NEGOTIATION: an approved row in it means
   * "your manager has offered you this, confirm it to put it in force", so
   * writing an automatic credit there produced a card asking somebody to accept
   * five minutes they had already been given — and accepting it would have SET
   * the budget to five minutes rather than adding to it. This collection is
   * append-only and asks nobody for anything; nothing reads it but the history.
   *
   * Never awaited into a critical path and never allowed to fail a credit. The
   * budget write is the record; this is the account of it, and losing the
   * account must not cost somebody the time.
   */
  async #fileBudgetCredit(input: {
    taskId: string;
    previousSecs: number;
    newSecs: number;
    reason: string;
    forEmployeeId: string;
  }): Promise<void> {
    /* Growth only. A credit of nothing is not an event, and a shrinking budget
       is a different thing that this history does not claim to explain. */
    if (!(input.newSecs > input.previousSecs)) return;
    try {
      const { addDoc, collection } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      await addDoc(collection(legacyDb(), "cowork_task_budget_credits"), {
        taskId: input.taskId,
        forEmployeeId: input.forEmployeeId,
        previousSecs: input.previousSecs,
        newSecs: input.newSecs,
        reason: input.reason,
        at: new Date().toISOString(),
        /* Nobody decided this — a rule applied itself. The flag is what lets a
           reader tell it from a negotiated extension. */
        automatic: true,
      });
    } catch (e) {
      console.error(
        "[budget] credit receipt write failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  async #compensateOneDeadline(input: {
    taskId: string;
    /** Null on a task whose date is derived rather than stored. */
    newDueAtMs: number | null;
    /** The window after the credit, or null to leave it alone. */
    newWindowSecs?: number | null;
    reason: string;
    byEmployeeId: string;
  }): Promise<void> {
    const { addDoc, collection, doc, getDoc, updateDoc } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const db = legacyDb();

    const snap = await getDoc(doc(db, "cowork_tasks", input.taskId));
    if (!snap.exists()) return;
    const data = snap.data() as Record<string, unknown>;

    /* The source field, so the write lands where the read looks. Null is not a
       failure here — it is the ordinary shape of a task nobody typed a date on. */
    const field =
      readInstant(data.fixedDeadline) !== null
        ? "fixedDeadline"
        : readInstant(data.deadline) !== null
          ? "deadline"
          : readInstant(data.dueDate) !== null
            ? "dueDate"
            : null;

    const movesDate = field !== null && input.newDueAtMs !== null;
    const growsWindow = typeof input.newWindowSecs === "number";
    if (!movesDate && !growsWindow) return;

    /**
     * **The budget field the READ wins on, not just the two mirrors.**
     *
     * `resolveTimeBudget` resolves four fields in order and takes the first —
     * `agreedWindowSecs`, then `deadlineWindowSecs`, then `senderWindowSecs`,
     * then `senderTimerWindowSecs`. This wrote only the second and fourth. On
     * any task whose hours have been AGREED — which is every accepted task —
     * `agreedWindowSecs` shadows both, so the grown window was written and then
     * never read: the Details panel went on printing the original figure, and
     * the queue went on laying the task out from it, so Expected completion
     * never moved either.
     *
     * That is the whole of the reported fault. A meeting settled, its minutes
     * appeared in the sessions list, the stored due date moved — which is why
     * the slack line changed by exactly the meeting's length — and the two
     * figures anybody actually looks at did not move at all.
     *
     * The date write already picks its source field for exactly this reason,
     * three lines above. The window write did not.
     */
    const budgetField = growsWindow
      ? (["agreedWindowSecs", "deadlineWindowSecs", "senderWindowSecs", "senderTimerWindowSecs"] as const).find(
          (name) => {
            const n = Number(data[name]);
            return Number.isFinite(n) && n > 0;
          },
        )
      : undefined;

    await updateDoc(doc(db, "cowork_tasks", input.taskId), {
      ...(movesDate ? { [field!]: new Date(input.newDueAtMs!).toISOString() } : {}),
      /* The winning field, plus the two mirrors legacy also reads a window
         from, so the queue and the Details panel cannot end up describing
         different amounts of work. `senderWindowSecs` is deliberately not
         mirrored: it is the assignor's original offer and is history once the
         hours are agreed. */
      ...(growsWindow
        ? {
            ...(budgetField ? { [budgetField]: input.newWindowSecs } : {}),
            deadlineWindowSecs: input.newWindowSecs,
            senderTimerWindowSecs: input.newWindowSecs,
          }
        : {}),
      updatedAt: new Date(),
    });

    /* The budget's own receipt, whether or not a date also moved. Filed here
       and not in the negotiation collection — see `#fileBudgetCredit`. This is
       what the History panel beside Time budget reads. */
    if (growsWindow && budgetField) {
      void this.#fileBudgetCredit({
        taskId: input.taskId,
        previousSecs: Number(data[budgetField]) || 0,
        newSecs: input.newWindowSecs!,
        reason: input.reason,
        forEmployeeId: input.byEmployeeId,
      });
    }

    const nowIso = new Date().toISOString();

    if (movesDate) {
      await addDoc(collection(db, "cowork_task_deadline_extensions"), {
        taskId: input.taskId,
        requestedBy: input.byEmployeeId,
        approverId: null,
        previousDeadline: new Date(readInstant(data[field!])!).toISOString(),
        proposedDeadline: new Date(input.newDueAtMs!).toISOString(),
        reason: input.reason,
        status: "approved",
        createdAt: nowIso,
        approvedAt: nowIso,
        decidedBy: null,
        /* Nobody decided this — a meeting happened and the rule applied itself. */
        automatic: true,
      }).catch((e: unknown) =>
        console.error(
          "[meeting] deadline history write failed:",
          e instanceof Error ? e.message : e,
        ),
      );
      return;
    }

    /* Window-only, and DELIBERATELY no record filed here.
     *
     * This wrote a `cowork_task_budget_extensions` row so the change would have
     * an account. That collection is not a receipt — it is a NEGOTIATION, and an
     * approved row in it means "your manager has offered you this, confirm it to
     * put it in force". So a meeting that should have applied itself silently
     * produced a card asking the assignee to accept 5m08s, and accepting it
     * would have SET the budget to 5m08s rather than adding to it. A meeting
     * needs no approval — the creator's attendance is the evidence, which is the
     * whole reason attendance is tracked — so it must never enter a flow whose
     * premise is that somebody has to agree.
     *
     * The account lives where it belongs instead: the Meetings tab lists every
     * session with its date, who was in it and what it was worth, and the task
     * carries `meetingTotalSecs`. A date that moved still files its
     * `cowork_task_deadline_extensions` receipt above — that collection records
     * decisions already taken and asks nobody for anything. */
  }

  async #compensateActiveDeadlines(
    employeeId: string,
    lostMs: number,
    /**
     * Why the deadline moved, in the words a person will read.
     *
     * **A deadline that moves without a record is the complaint, not the
     * mechanism.** This wrote nothing but a console line, so the only account of
     * an automatic shift lived in a browser nobody had open. Every move now
     * leaves a `cowork_task_deadline_extensions` row carrying the date before,
     * the reason, and the date after — the three things somebody asking "why is
     * this due later than I agreed?" actually needs.
     */
    reason: string = "Absence credited",
  ): Promise<number> {
    if (lostMs <= 0) return 0;
    let shifted = 0;
    try {
      const { addDoc, collection, query, where, getDocs, doc, writeBatch } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const db = legacyDb();

      const snap = await getDocs(
        query(
          collection(db, "cowork_tasks"),
          where("assigneeIds", "array-contains", employeeId),
        ),
      );

      /**
       * **The head of this person's queue, and why it is needed here.**
       *
       * Expected completion is computed from WINDOWS laid end to end, not from
       * stored dates — so shifting dates alone moved nothing a reader could
       * see. Most tasks carry no stored date at all (the creator sets hours and
       * the date comes from the queue), and those were skipped outright by a
       * `continue`, so an offline span credited them nothing whatsoever.
       *
       * The same shape the meeting credit settled on: exactly ONE window grows —
       * the work in hand — and the chain carries the shift to everything behind
       * it. Growing every window would make the third task in the queue move by
       * three times the absence.
       */
      const active = snap.docs.filter((d) => {
        const st = (d.data() as Record<string, unknown>).status;
        return !ABSENCE_TERMINAL_STATUSES.has(typeof st === "string" ? st : "");
      });
      const headId = [...active]
        .map((d) => ({
          id: d.id,
          rank: resolveTaskPriority(
            { ...(d.data() as Record<string, unknown>), id: d.id } as never,
            employeeId,
          ),
        }))
        .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))[0]?.id;
      const lostSecs = Math.round(lostMs / 1000);

      /**
       * **One write for the whole queue, not one per task.**
       *
       * Every task's `updateDoc` was awaited inside the loop, so a person with
       * six live tasks paid six sequential round trips while the button read
       * "Approving…" — the reported delay. A batch is one.
       *
       * It is also atomic, which matters more than the speed: a compensation
       * that failed half way through left some deadlines shifted and the rest
       * not, with no record of which. Either every deadline moves or none does.
       *
       * Nothing about WHAT is written changed — same fields, same arithmetic,
       * same receipts filed afterwards. Firestore's limit is 500 operations and
       * this is one person's live queue, so a single batch always suffices.
       */
      const batch = writeBatch(db);
      /* What to record once the batch lands — see the note at the push below. */
      const receipts: {
        taskId: string;
        budget: { previousSecs: number; newSecs: number } | null;
        date: { previousIso: string; newDueIso: string } | null;
      }[] = [];

      for (const d of active) {
        const data = d.data() as Record<string, unknown>;

        /* The source field, so the write lands where the read looks. Null is
           the ordinary shape of a task nobody typed a date on — it is not a
           reason to skip the task. */
        const field =
          readInstant(data.fixedDeadline) !== null
            ? "fixedDeadline"
            : readInstant(data.deadline) !== null
              ? "deadline"
              : readInstant(data.dueDate) !== null
                ? "dueDate"
                : null;

        const currentMs = field === null ? null : readInstant(data[field]);
        const previousIso =
          currentMs === null ? null : new Date(currentMs).toISOString();
        const newDueIso =
          currentMs === null ? null : new Date(currentMs + lostMs).toISOString();

        /* The head absorbs the lost time on its budget; the chain does the rest. */
        const growsWindow = d.id === headId && lostSecs > 0;
        const mapped = growsWindow
          ? readTask({ ...data, id: d.id } as never)
          : null;
        const currentWindow = mapped ? resolveTimeBudget(mapped) : 0;
        const newWindowSecs =
          growsWindow && currentWindow > 0 ? currentWindow + lostSecs : null;

        if (newDueIso === null && newWindowSecs === null) continue;

        batch.update(doc(db, "cowork_tasks", d.id), {
          ...(newDueIso !== null && field !== null ? { [field]: newDueIso } : {}),
          /* Both fields legacy reads a window from, so the queue and the Details
             panel cannot end up describing different amounts of work. */
          ...(newWindowSecs !== null
            ? {
                deadlineWindowSecs: newWindowSecs,
                senderTimerWindowSecs: newWindowSecs,
              }
            : {}),
          updatedAt: new Date(),
        });
        shifted += 1;

        /* **Receipts are DESCRIBED here and filed after the commit.**
           They used to be written inside the loop, immediately after each
           task's own `await updateDoc` — so a receipt only ever existed for a
           write that had already landed. The batch moves the landing to the
           end, so filing here would record shifts that a failed commit never
           made. Collected instead, and written once the writes are real. */
        receipts.push({
          taskId: d.id,
          /* The budget's receipt is kept separate from the date's, and filed
             even where no date moved: a task whose date is derived from the
             queue rather than stored — which is most of them — grew its window
             and recorded nothing at all. That is exactly how a nine-hour task
             came to read 10:26:53 with no account of the difference. */
          budget:
            newWindowSecs !== null
              ? { previousSecs: currentWindow, newSecs: newWindowSecs }
              : null,
          /* Nothing to file where no date moved — the deadline receipt names a
             previous and a proposed deadline, and there was neither. */
          date:
            previousIso !== null && newDueIso !== null
              ? { previousIso, newDueIso }
              : null,
        });
      }

      /* **Sent once, here.** The loop only queued the updates. Committing
         inside it would have reintroduced the round trip per task that this
         batch exists to remove.

         Skipped when nothing qualified, because an empty batch is still a
         network call — and `shifted` is 0 in exactly that case. */
      if (shifted > 0) await batch.commit();

      /* Only now, with the deadline writes committed. Still not awaited into
         the caller's critical path and still never allowed to fail the shift —
         the deadline write is the record, this is the account of it. */
      for (const r of receipts) {
        if (r.budget) {
          void this.#fileBudgetCredit({
            taskId: r.taskId,
            previousSecs: r.budget.previousSecs,
            newSecs: r.budget.newSecs,
            reason,
            forEmployeeId: employeeId,
          });
        }
        if (!r.date) continue;
        /* The receipt: previous → reason → current, in the same collection the
           approved extensions land in, so one history answers "why is this due
           later" whatever moved it. */
        void addDoc(collection(db, "cowork_task_deadline_extensions"), {
          taskId: r.taskId,
          requestedBy: employeeId,
          approverId: null,
          previousDeadline: r.date.previousIso,
          proposedDeadline: r.date.newDueIso,
          reason,
          status: "approved",
          createdAt: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
          decidedBy: null,
          /* Nobody decided this — it is the absence rule applying itself. The
             flag is what lets a reader tell it from a negotiated extension. */
          automatic: true,
        }).catch((e) =>
          console.error("[duty] deadline history write failed:", e?.message ?? e),
        );
      }
    } catch (error) {
      console.error("[duty] deadline compensation failed:", error);
      /* The batch is all-or-nothing, so a failure here means NO deadline moved.
         Reporting a count for writes that did not land would tell the caller —
         and the person reading "3 deadlines shifted" — something untrue. */
      return 0;
    }
    return shifted;
  }

  /**
   * Restate a live claim.
   *
   * Deliberately narrow: it writes two fields and never a mode. A heartbeat
   * that could move the mode would resurrect an `online` that something else
   * had just cleared, which is the one way a heartbeat can do harm.
   *
   * Silent when the claim is not ours — a second tab beating on the first one's
   * session would keep a dead share looking alive.
   */
  async heartbeatDuty(connectionId: string): Promise<ActionResult<void>> {
    const employeeId = String(this.#ctx.employeeId);
    const now = Date.now();
    const previous = await this.#readDutyDoc(employeeId);
    if (storedMode(previous) !== "online") return { ok: true, data: undefined };
    if (!ownsClaim(previous, connectionId, now)) return { ok: true, data: undefined };

    const { setDoc } = await import("firebase/firestore");
    await setDoc(
      await this.#dutyDoc(employeeId),
      heartbeatPatch(now, connectionId),
      { merge: true },
    );
    return { ok: true, data: undefined };
  }

  /**
   * Live presence for a set of people.
   *
   * One listener per person, matching `useDutyStatus` — legacy has no query
   * across the collection and the documents are keyed by employee, so a
   * collection query would read the whole company to render one team.
   */
  /**
   * This employee's own presence, live, with the start instants.
   *
   * One document, one listener — cheaper than `watchDutyModes` over a list of
   * one, and it emits the whole snapshot rather than a mode, because the clocks
   * are the point: a break's start belongs to the ACCOUNT, so every device
   * counts from the same instant instead of from whenever it happened to find
   * out.
   *
   * **No periodic sweep.** Both watchers used to re-emit on a timer so that an
   * `online` claim whose heartbeat had stopped would expire without anybody
   * writing anything. Nothing expires now — a status is changed by the person
   * whose status it is — so a timed re-emission has nothing left to say, and
   * saying it anyway is how a snapshot from before somebody's own choice
   * arrived after it and undid it. Emissions follow the document.
   */
  watchDutyStatus(
    onChange: (snapshot: DutySnapshot) => void,
    employeeId?: EmployeeId,
  ): () => void {
    const id = String(employeeId ?? this.#ctx.employeeId);
    let doc: DutyDocument | null = null;
    let stopped = false;
    let unsub: (() => void) | null = null;

    const emit = () => {
      if (stopped) return;
      onChange(readDutySnapshot(doc, Date.now()));
    };

    void (async () => {
      const { doc: docRef, onSnapshot } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      if (stopped) return;
      unsub = onSnapshot(
        docRef(legacyDb(), ...(dutyStatusPath(id) as [string, string])),
        (snap) => {
          doc = snap.exists() ? (snap.data() as DutyDocument) : null;
          emit();
        },
        (error) => console.error(`[duty] watch self ${id}:`, error.message),
      );
    })();

    return () => {
      stopped = true;
      unsub?.();
    };
  }

  watchDutyModes(
    employeeIds: EmployeeId[],
    onChange: (modes: Map<EmployeeId, DutyMode>) => void,
  ): () => void {
    const docs = new Map<string, DutyDocument | null>();
    const unsubscribers: (() => void)[] = [];
    let stopped = false;

    const emit = () => {
      if (stopped) return;
      const now = Date.now();
      const modes = new Map<EmployeeId, DutyMode>();
      for (const [id, doc] of docs) modes.set(id, readDutyMode(doc, now));
      onChange(modes);
    };

    void (async () => {
      const { doc: docRef, onSnapshot } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      if (stopped) return;
      for (const employeeId of employeeIds) {
        const id = String(employeeId);
        const unsub = onSnapshot(
          docRef(legacyDb(), ...(dutyStatusPath(id) as [string, string])),
          (snap) => {
            docs.set(id, snap.exists() ? (snap.data() as DutyDocument) : null);
            emit();
          },
          (error) => console.error(`[duty] watch ${id}:`, error.message),
        );
        unsubscribers.push(unsub);
      }
    })();

    /* No sweep — see `watchDutyStatus`. A dot changes when somebody changes
       their own status, and at no other time. */
    return () => {
      stopped = true;
      for (const unsub of unsubscribers) unsub();
    };
  }

  /**
   * The same documents as `watchDutyModes`, read for their CLOCKS as well as
   * their mode — the administrator's roster.
   *
   * `dailyHoursSecs` and `updatedAt` are both already on the duty document, so
   * this adds no field and no collection: it stops throwing away two facts
   * every existing listener was receiving and discarding.
   *
   * One listener per person, exactly as `watchDutyModes` does. A roster of a
   * few dozen people is a few dozen document listeners, which is what the team
   * pages already open — and a collection-wide query would need a rule change
   * on `cowork_duty_status` that the old application's own security model does
   * not grant.
   */
  watchDutyRoster(
    employeeIds: EmployeeId[],
    onChange: (facts: Map<EmployeeId, DutyFacts>) => void,
  ): () => void {
    const docs = new Map<string, DutyDocument | null>();
    const unsubscribers: (() => void)[] = [];
    let stopped = false;

    const emit = () => {
      if (stopped) return;
      const now = Date.now();
      const facts = new Map<EmployeeId, DutyFacts>();
      for (const [id, doc] of docs) {
        facts.set(id, {
          mode: readDutyMode(doc, now),
          /* Closed sessions only — the shared field's own meaning. The live
             session is added by `rosterRows`, where the reader is told the
             figure is "today so far". */
          closedSecs: dailyHoursSecs(doc, now),
          sinceMs:
            typeof doc?.updatedAt === "number" && Number.isFinite(doc.updatedAt)
              ? doc.updatedAt
              : null,
        });
      }
      onChange(facts);
    };

    void (async () => {
      const { doc: docRef, onSnapshot } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      if (stopped) return;
      for (const employeeId of employeeIds) {
        const id = String(employeeId);
        const unsub = onSnapshot(
          docRef(legacyDb(), ...(dutyStatusPath(id) as [string, string])),
          (snap) => {
            docs.set(id, snap.exists() ? (snap.data() as DutyDocument) : null);
            emit();
          },
          (error) => console.error(`[duty] roster ${id}:`, error.message),
        );
        unsubscribers.push(unsub);
      }
    })();

    return () => {
      stopped = true;
      for (const unsub of unsubscribers) unsub();
    };
  }

  /**
   * The acting employee's status changes for one day — see `DutyHistoryEntry`.
   *
   * `where("employeeId", "==", …)` bounds the read to one person rather than
   * scanning the whole collection, which is every employee's every transition
   * ever made; the day filter and the sort both happen in memory afterwards,
   * because a composite index on `employeeId` + `at` is not worth requiring
   * for a query this small.
   */
  async listDutyHistory(dayKey?: string): Promise<DutyHistoryEntry[]> {
    const employeeId = String(this.#ctx.employeeId);
    const key = dayKey ?? dutyDayKey(Date.now());
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_duty_history"),
        where("employeeId", "==", employeeId),
      ),
    );
    const out: DutyHistoryEntry[] = [];
    for (const d of snap.docs) {
      const data = d.data() as {
        mode?: DutyMode;
        at?: number;
        reason?: string | null;
      };
      if (typeof data.at !== "number" || !data.mode) continue;
      if (dutyDayKey(data.at) !== key) continue;
      out.push({
        id: d.id,
        mode: data.mode,
        at: data.at,
        reason: data.reason ?? null,
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /**
   * One day's transitions for several people — the attendance report.
   *
   * **Ranged on `at` rather than filtered per employee**, and that is what
   * makes it one read instead of one per person: `at` is a single field, so the
   * range needs no composite index, and a day of transitions across a whole
   * organisation is a small set. The employee filter is applied in memory
   * afterwards, which also drops anybody who has left the directory.
   *
   * Newest-first per person, matching `listDutyHistory` — `spanRows` reads that
   * order and closes each stretch against the one after it.
   */
  async listDutyDay(
    employeeIds: EmployeeId[],
    window: { startMs: number; endMs: number },
  ): Promise<Map<EmployeeId, DutyHistoryEntry[]>> {
    const wanted = new Set(employeeIds.map(String));
    const out = new Map<EmployeeId, DutyHistoryEntry[]>();
    if (wanted.size === 0) return out;

    const { collection, getDocs, orderBy, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_duty_history"),
        where("at", ">=", window.startMs),
        where("at", "<", window.endMs),
        orderBy("at", "desc"),
      ),
    ).catch(() => null);
    /* A refused or failed read is an empty report, never a throw: this is one
       card on a dashboard, and the rest of the page is not its business. */
    if (!snap) return out;

    for (const d of snap.docs) {
      const data = d.data() as {
        employeeId?: unknown;
        mode?: DutyMode;
        at?: unknown;
        reason?: string | null;
      };
      const employeeId =
        typeof data.employeeId === "string" ? data.employeeId : null;
      if (!employeeId || !wanted.has(employeeId)) continue;
      if (typeof data.at !== "number" || !data.mode) continue;
      const list = out.get(employeeId) ?? [];
      list.push({
        id: d.id,
        mode: data.mode,
        at: data.at,
        reason: data.reason ?? null,
      });
      out.set(employeeId, list);
    }
    return out;
  }

  /**
   * Watch one person's session on one task.
   *
   * **The same shape as `watchDutyModes`, deliberately** — a subscribe that
   * returns its own unsubscribe, over the document the browser already writes.
   * There is no second realtime system here and there must not be: legacy has
   * no REST route for timers and no socket for them either, so Firestore's own
   * listener IS the live channel, and it is the one the old app uses.
   *
   * This is what lets a MANAGER see work happening. `getTimer` is a one-shot
   * read for the acting employee, so a manager saw a figure frozen at the
   * moment they opened the page and had to refresh to learn anything. Watching
   * the assignee's document instead means the same document that drives the
   * employee's own control drives the manager's view — one source, so the two
   * screens cannot disagree.
   *
   * Observation only. Nothing here writes, and the controls stay gated on being
   * an assignee.
   */
  watchTimerSession(
    employeeId: EmployeeId,
    taskId: TaskId,
    onChange: (session: TimerSession | null) => void,
  ): () => void {
    let stopped = false;
    let unsub: (() => void) | null = null;

    void (async () => {
      try {
        const { onSnapshot } = await import("firebase/firestore");
        const ref = await this.#timerSession(String(employeeId), String(taskId));
        if (stopped) return;
        unsub = onSnapshot(
          ref,
          (snap) => {
            onChange(
              snap.exists()
                ? toTimerSession(
                    snap.data() as Record<string, unknown>,
                    String(taskId),
                    String(employeeId),
                  )
                : null,
            );
          },
          (error) => {
            /* A dead listener must not take the page with it. The view keeps
               whatever it last knew, which is the same state a one-shot read
               would have left it in. */
            console.error(`[timer] watch ${employeeId}/${taskId}:`, error.message);
          },
        );
      } catch (error) {
        console.error("[timer] watch failed to attach:", error);
      }
    })();

    return () => {
      stopped = true;
      if (unsub) unsub();
    };
  }

  /**
   * One task's session for the acting employee.
   *
   * **`TimerControl` calls this for every row it renders**, so leaving it to
   * the throwing proxy meant every task in the list — and the detail page —
   * surfaced "getTimer is not connected to the Cowork engine yet" where the
   * elapsed time should be. The write half was connected the whole time; the
   * read that the control renders from was not.
   *
   * `null` for a task that has never been worked, which is the honest answer
   * and what the control already expects — it renders "Start" rather than a
   * zero. A missing document and a document of zeroes are different facts.
   */
  /* ── Attachments ─────────────────────────────────────────────────────────
   *
   * Private, through the engine's authenticated routes. Nothing here returns a
   * storage URL — an id is the handle and bytes come back as a blob, so there
   * is no second path to a file that skips the permission check.
   */

  async uploadAttachment(input: {
    file: File;
    entityType: AttachmentEntity;
    entityId: string;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  }): Promise<ActionResult<AttachmentMeta>> {
    const token = await this.#token();
    const r = await uploadAttachmentRequest({ token, ...input });
    if (!r.ok) {
      return {
        ok: false,
        code:
          r.error.kind === "permission" || r.error.kind === "auth"
            ? "permission_denied"
            : "validation_failed",
        message: r.error.message,
      };
    }
    notifyRepositoryChanged();
    return { ok: true, data: r.data };
  }

  async getAttachments(
    entityType: AttachmentEntity,
    entityId: string,
  ): Promise<ActionResult<AttachmentMeta[]>> {
    const token = await this.#token();
    const r = await listAttachmentsRequest({ token, entityType, entityId });
    if (!r.ok) {
      /* The failure is REPORTED, not flattened to an empty array. The previous
         version returned `[]` on any error so a task would still open — which
         it still does, because the caller renders an error state rather than
         throwing — but "no files" and "could not ask" are different facts and a
         reader must be able to tell them apart. */
      return {
        ok: false,
        code:
          r.error.kind === "permission" || r.error.kind === "auth"
            ? "permission_denied"
            /* `offline` is the existing code for "the service could not be
               reached", which is what an unconfigured or unreachable storage
               backend is from the reader's side. */
            : "offline",
        message: r.error.message,
      };
    }
    return { ok: true, data: r.data };
  }

  async downloadAttachment(id: string): Promise<ActionResult<Blob>> {
    const token = await this.#token();
    const r = await downloadAttachmentRequest({ token, id: String(id) });
    if (!r.ok) {
      return {
        ok: false,
        code:
          r.error.kind === "permission" || r.error.kind === "auth"
            ? "permission_denied"
            : "not_found",
        message: r.error.message,
      };
    }
    return { ok: true, data: r.data };
  }

  async deleteAttachment(id: string): Promise<ActionResult<void>> {
    const token = await this.#token();
    const r = await deleteAttachmentRequest({ token, id: String(id) });
    if (!r.ok) {
      return {
        ok: false,
        code:
          r.error.kind === "permission" || r.error.kind === "auth"
            ? "permission_denied"
            : "not_found",
        message: r.error.message,
      };
    }
    notifyRepositoryChanged();
    return { ok: true, data: undefined };
  }

  async getTimer(taskId: TaskId): Promise<TimerSession | null> {
    const employeeId = String(this.#ctx.employeeId);
    const id = String(taskId);
    const { getDoc } = await import("firebase/firestore");

    const snap = await getDoc(await this.#timerSession(employeeId, id));
    if (!snap.exists()) return null;
    return toTimerSession(snap.data() as Record<string, unknown>, id, employeeId);
  }

  /* ── Concepts the Cowork engine does not have ───────────────────────────
   *
   * These are the last five task-module methods with nothing behind them, and
   * none of them is unfinished wiring: the engine has no field, collection or
   * route for any of them. They are left here rather than to the throwing proxy
   * so the sentence a person reads is about the PRODUCT — "the engine does not
   * record this" — instead of `NotConnectedError`'s "not connected to the
   * Cowork engine yet", which describes our build to somebody who cannot act on
   * it and reads as a defect.
   *
   * The distinction the proxy exists to make still holds: a method that is
   * merely unwired must keep throwing, so an unfinished screen fails loudly.
   * These are not unwired. They are absent.
   */

  /**
   * A task's event log.
   *
   * Legacy keeps none. There is no `cowork_task_events` collection anywhere in
   * the old app, and the history a task does keep is spread across
   * `deadlineHistory[]` (read by `listProposals`) and the chat thread's system
   * messages (read by `listTaskChat`). Returning `[]` here would claim nothing
   * has ever happened to the task, which is false for every task in the system.
   */
  /**
   * The task's change history — requirement and ET adjustments, newest first.
   *
   * **This used to refuse outright**, because the engine kept no event log and
   * the History tab fell back to deadline and priority records alone. It now
   * does keep one: `edit-details` appends to a `cowork_tasks/{id}/events`
   * subcollection whenever a requirement or the estimate changes, and this
   * reads it. The `HistoryPanel` already merged this source in — it simply
   * always came back empty — so nothing downstream changes shape.
   *
   * A read failure is not fatal to the panel: it tolerates an errored event
   * list and still shows the deadline and priority history, so a missing
   * subcollection on an old task degrades to exactly the previous behaviour.
   */
  async listTaskEvents(taskId: TaskId): Promise<TaskEvent[]> {
    const { collection, getDocs, query, orderBy } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const ref = collection(
      legacyDb(),
      "cowork_tasks",
      String(taskId),
      "events",
    );
    /* Ordered by the sequence the engine stamps, descending — newest first, the
       order the panel renders. No composite index needed: one field, one task's
       subcollection. */
    const snap = await getDocs(query(ref, orderBy("sequence", "desc")));
    const out: TaskEvent[] = [];
    snap.forEach((d) => {
      const e = d.data() as Record<string, unknown>;
      out.push({
        id: d.id,
        taskId: taskId as TaskId,
        sequence: Number(e.sequence) || 0,
        type: (e.type as TaskEvent["type"]) ?? "edited",
        actorId: (e.actorId as TaskEvent["actorId"]) ?? "system",
        actorLabel: String(e.actorLabel ?? "System"),
        summary: String(e.summary ?? ""),
        payload: (e.payload as Record<string, unknown>) ?? {},
        /* `readInstant` gives ms (or null) from whatever shape the field holds
           — a Firestore Timestamp, a number, an ISO string. The domain wants an
           ISO string; an unreadable stamp becomes "" rather than an invalid
           date, which the panel renders as no time rather than "Invalid Date". */
        occurredAt: (() => {
          const ms = readInstant(e.occurredAt);
          return ms === null ? "" : new Date(ms).toISOString();
        })(),
      });
    });
    return out;
  }

  /**
   * Attachments by id.
   *
   * Legacy has no attachment entity: files are stored as URLs inline on the
   * record that owns them — a chat message's `attachments[]`, a submission's
   * `imageUrls`. Callers already hold the URL, so there is nothing to look up,
   * and an empty result for an empty id list is the correct answer rather than
   * a refusal.
   */
  async listAttachments(ids: string[]): Promise<never[]> {
    if (ids.length === 0) return [];
    return Promise.reject(
      new Error(
        "The Cowork engine stores files on the message or submission that carries them, not as records with their own ids.",
      ),
    );
  }

  /**
   * Acknowledging a priority cascade.
   *
   * **This used to refuse, on a premise that was false.** The comment here said
   * "the Cowork engine does not record priority cascades, so there is nothing to
   * acknowledge" — but the engine writes one per shifted task into
   * `cowork_tasks.deadlineAutoExtendedHistory[]`, and the old frontend's
   * `PriorityChangeAckModal.jsx` has been reading and clearing them all along.
   * The refusal was the reason the blocking gate could never be dismissed.
   *
   * The write is the old modal's, verbatim: read the task, map the entries in
   * this group to `acknowledgedByEmployee: true`, put the array back. A whole-
   * array rewrite rather than an `arrayUnion`, because the flag is being flipped
   * on an existing element and Firestore cannot address one by index.
   */
  async acknowledgeCascade(
    cascadeId: string,
    timerPausedTaskId: TaskId | null,
  ): Promise<ActionResult<PriorityAcknowledgement>> {
    const me = String(this.#ctx.employeeId ?? "");
    if (!me)
      return {
        ok: false,
        code: "permission_denied",
        message: "Sign in to acknowledge a priority change.",
      };

    const groups = await this.#pendingCascadeGroups(me);
    const group = groups.get(cascadeId);
    if (!group || group.length === 0)
      /* Success, not an error. The gate polls every couple of seconds against a
         modal with no Cancel and no close cross, so a second confirmation
         arriving after the first landed must clear it rather than trap somebody
         in a receipt they have already answered. */
      return {
        ok: true,
        data: {
          id: `ack_${cascadeId}`,
          cascadeId,
          employeeId: me,
          affectedTaskIds: [],
          acknowledgedAt: new Date().toISOString(),
          timerPausedTaskId: timerPausedTaskId ? String(timerPausedTaskId) : null,
        },
      };

    const { doc, getDoc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    for (const { taskId } of group) {
      const ref = doc(legacyDb(), "cowork_tasks", taskId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const raw = (snap.data() as Record<string, unknown>)[HISTORY_FIELD];
      if (!Array.isArray(raw)) continue;
      const next = raw.map((row) => {
        const entry = readEntry(row);
        if (!entry || groupKey(entry) !== cascadeId) return row;
        return { ...(row as Record<string, unknown>), acknowledgedByEmployee: true };
      });
      await updateDoc(ref, { [HISTORY_FIELD]: next });
    }

    notifyRepositoryChanged();
    return {
      ok: true,
      data: {
        id: `ack_${cascadeId}`,
        cascadeId,
        employeeId: me,
        affectedTaskIds: group.map((g) => g.taskId),
        acknowledgedAt: new Date().toISOString(),
        timerPausedTaskId: timerPausedTaskId ? String(timerPausedTaskId) : null,
      },
    };
  }

  /**
   * The unacknowledged history entries this person holds, grouped into events.
   *
   * The key is legacy's — `shiftedByTaskId|at` — so N tasks bumped by one action
   * become ONE receipt rather than a wall of modals, and so this app and the old
   * one agree about what counts as a single event.
   */
  async #pendingCascadeGroups(
    employeeId: string,
  ): Promise<Map<string, { entry: StoredCascadeEntry; taskId: string; taskTitle: string }[]>> {
    const { collection, getDocs, query, where } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_tasks"),
        where("assigneeIds", "array-contains", employeeId),
      ),
    );

    const groups = new Map<
      string,
      { entry: StoredCascadeEntry; taskId: string; taskTitle: string }[]
    >();
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const history = data[HISTORY_FIELD];
      if (!Array.isArray(history)) continue;
      const title = typeof data.title === "string" ? data.title : d.id;
      for (const row of history) {
        const entry = readEntry(row);
        if (!entry || entry.acknowledgedByEmployee) continue;
        const key = groupKey(entry);
        groups.set(key, [
          ...(groups.get(key) ?? []),
          { entry, taskId: d.id, taskTitle: title },
        ]);
      }
    }
    return groups;
  }

  /**
   * Completion requirements — what has to be true before a task is done.
   *
   * **This method refused outright, and that refusal is what broke subtasks.**
   * The stated reason was that the checklist is a new-product concept with no
   * legacy field. It is not: `cowork_tasks` carries `requirements` as an array
   * of strings, `createTask` has always sent it (`taskForward.js:386`),
   * `edit-details` has always accepted it (`:1682`), and `toTask` has always
   * read it back. The field was there the whole time.
   *
   * What the refusal cost was the entire delegation flow, because every gate
   * downstream counts requirements:
   *
   * ```
   * addRequirements refuses  →  task.requirements stays []
   *                          →  ProjectPanel renders no "Break this down"
   *                             button (it needs `c.total > 0`)
   *                          →  subtaskRefusal refuses anyway
   *                             ("Add completion requirements … first")
   * ```
   *
   * So a task created without requirements could never gain any, and a task
   * with no requirements can never be broken down. Every task the legacy app
   * ever created is in that state. Subtasks were reachable only for a task
   * created through `NewTaskForm` with its checklist filled in up front —
   * which is why this read as "subtasks do not work" rather than as a
   * refusal somebody could act on.
   *
   * **Read, then append — never send the caller's list alone.** `edit-details`
   * REPLACES `requirements` with whatever it is given, so passing only the new
   * texts silently deletes every existing one. Deleting them is worse than it
   * sounds: requirement ids are POSITIONAL (`compositeId(taskId, "req-" + i)`),
   * subtasks store those ids in `satisfiesRequirementIds`, and shifting the
   * array repoints every claim at the wrong requirement or at nothing. Append
   * is the only mutation that leaves existing indices where they are, which is
   * also why this adds and never removes or reorders.
   *
   * The engine's own gate stands (`taskForward.js:1660-1676`): before the task
   * passes draft only CEO or TL may edit it, and after it has passed only the
   * sender who assigned it. Its refusal is surfaced verbatim rather than
   * pre-empted here — `lib/legacy/permissions.ts` is the module that mirrors
   * the engine, and duplicating the rule in a second place is how the two come
   * to disagree.
   */
  async addRequirements(
    taskId: TaskId,
    texts: string[],
  ): Promise<ActionResult<Task>> {
    const id = String(taskId);

    const clean = texts.map((t) => t.trim()).filter(Boolean);
    if (clean.length === 0) {
      return {
        ok: false,
        code: "validation_failed",
        field: "texts",
        message: "Write at least one requirement.",
      };
    }

    /* The document, not the `TaskView` — this needs the raw string array in the
       order the engine holds it, and a view would have already turned it into
       domain requirements with minted ids that cannot be sent back. */
    const current = await this.#taskDoc(id);
    if (!current) {
      return {
        ok: false,
        code: "not_found",
        message: "Task not found.",
      };
    }

    return this.#write(
      (token) =>
        editTaskDetails({
          token,
          taskId: id,
          requirements: [...current.requirements, ...clean],
        }),
      () => id,
    );
  }

  /**
   * Replace the requirement list, and optionally move the estimate with it.
   *
   * The same route `addRequirements` uses — the engine has always replaced the
   * whole array — so editing and deleting cost no new endpoint and inherit the
   * permission rule that is already there: before the task has left draft only
   * a CEO or TL may edit it, and afterwards only the sender who assigned it.
   *
   * **The time adjustment rides the SAME request.** Two writes would leave a
   * window where the requirement had changed and the estimate had not, and a
   * failure between them would strand the task in it with nothing on screen
   * saying which half had landed.
   */
  async setRequirements(
    taskId: TaskId,
    texts: string[],
    etAdjustment?: { secs: number; reason?: string },
    changeLog?: {
      summary: string;
      eventType: TaskEventType;
      payload?: Record<string, unknown>;
    },
  ): Promise<ActionResult<Task>> {
    const id = String(taskId);
    /* Empty is legitimate: a task may have its last requirement removed and
       become an ordinary task again. Only blank LINES are dropped. */
    const clean = texts.map((t) => t.trim()).filter(Boolean);

    const delta = Math.round(Number(etAdjustment?.secs) || 0);

    return this.#write(
      (token) =>
        editTaskDetails({
          token,
          taskId: id,
          requirements: clean,
          /* Omitted entirely when there is nothing to move, so a rewording
             sends the request `addRequirements` has always sent. */
          ...(delta !== 0
            ? {
                etAdjustSecs: delta,
                etAdjustReason: etAdjustment?.reason,
              }
            : {}),
          /* The log rides the same request, so the History event, the chat
             message and the notification are written in the one transaction
             that changed the task — never in a second call that could land
             without the first. */
          ...(changeLog
            ? {
                changeSummary: changeLog.summary,
                changeEventType: changeLog.eventType,
                changePayload: changeLog.payload,
              }
            : {}),
        }),
      () => id,
    );
  }

  /**
   * Tick a requirement off directly.
   *
   * Genuinely absent from the engine — unlike the requirement text itself,
   * there is no per-item state on the document to record a tick against. It
   * has no caller: `ProjectPanel` renders requirements read-only, because
   * acceptance criteria are the reviewer's reference during review rather than
   * a checklist the submitter ticks to unlock submission. The refusal stays so
   * that a future caller is told why rather than silently doing nothing.
   */
  async setRequirementSatisfied(): Promise<ActionResult<never>> {
    return {
      ok: false,
      code: "invalid_state",
      message:
        "Requirements are not part of the Cowork engine's task model, so they cannot be ticked off. A subtask's own status is what records progress.",
    } as unknown as ActionResult<never>;
  }

  /**
   * Emergency Mode approval requests.
   *
   * `cowork_emergency_approvals`, which the old app writes from the browser
   * (`lib/emergencyApproval.js:62`) with no REST route — the same exception
   * class as the timer and the duty document.
   *
   * `mine` and `to_decide` are both filtered here rather than by query: the
   * collection carries `employeeId` and `tlId`, and a composite index for two
   * one-field reads over a collection this size would be a deploy for nothing.
   */
  /**
   * Raise an Emergency Mode approval request.
   *
   * Written straight to `cowork_emergency_approvals` — the same collection
   * `listEmergencyRequests` reads and `decideEmergencyRequest` writes, and the
   * same one the old app creates in from the browser (`lib/emergencyApproval.js`)
   * with no REST route. So this is a transcription, and it is what closes the
   * `NotConnectedError` the End-Emergency dialog hit: the method existed nowhere,
   * so the proxy refused it with "not connected to the Cowork engine".
   *
   * **No deadline is moved here.** The operational compensation already runs when
   * the person returns online (`#compensateActiveDeadlines`); this request is the
   * manager's record and their score decision, not the time itself.
   */
  async createEmergencyRequest(input: {
    startedAt: string;
    endedAt: string;
    reason: string;
    document: { filename: string; mimeType: string; sizeBytes: number } | null;
  }): Promise<ActionResult<EmergencyRequest>> {
    const me = String(this.#ctx.employeeId);
    const durationSecs = Math.max(
      0,
      Math.round((Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000),
    );

    /* The primary manager decides, resolved from HR exactly as the budget
       approver is — never from a department mapping. */
    let managerId: string | null = null;
    try {
      const token = await this.#token();
      const r = await fetchHierarchy({ token, employeeId: me });
      managerId = r.ok ? (r.data.primaryManager?.employeeId ?? null) : null;
    } catch {
      managerId = null;
    }

    /* The one predicate the dialog also uses, so the form cannot submit what
       this refuses — plus the manager check only the server can make. */
    const refusal = emergencyRequestRefusal({
      durationSecs,
      reason: input.reason,
      document: input.document,
      managerId,
    });
    if (refusal) {
      return { ok: false, code: "validation_failed", message: refusal };
    }

    const directory = await this.#employeesById();
    const employeeName = directory.get(me)?.displayName ?? me;
    const managerName = managerId
      ? (directory.get(managerId)?.displayName ?? managerId)
      : "";

    const { addDoc, collection } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    try {
      /* The document shape `listEmergencyRequests` reads: `gapMs` + `createdAt`,
         from which the start is derived by subtraction. Legacy stores no
         attachment, so the filename is recorded as a note rather than a link. */
      const ref = await addDoc(
        collection(legacyDb(), "cowork_emergency_approvals"),
        {
          employeeId: me,
          employeeName,
          tlId: managerId,
          tlName: managerName,
          gapMs: durationSecs * 1000,
          reason: input.reason.trim(),
          status: "pending",
          createdAt: new Date(),
          ...(input.document ? { documentName: input.document.filename } : {}),
        },
      );
      notifyRepositoryChanged();
      return {
        ok: true,
        data: {
          organisationId: LEGACY_ORGANISATION_ID,
          id: ref.id,
          employeeId: me as EmployeeId,
          employeeName,
          managerId: (managerId ?? "") as EmployeeId,
          managerName,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          durationSecs,
          reason: input.reason.trim(),
          attachmentId: input.document?.filename ?? "",
          status: "pending",
          decisionReason: null,
          decidedAt: null,
          appliedTaskIds: [],
          /* Nothing has been applied — that is what "pending" means, and it is
             the state the whole gate exists to hold. */
          compensationAppliedAt: null,
          createdAt: new Date().toISOString(),
        } as EmergencyRequest,
      };
    } catch (error) {
      return {
        ok: false,
        code: "not_found",
        message:
          error instanceof Error
            ? `The emergency request could not be saved: ${error.message}`
            : "The emergency request could not be saved.",
      };
    }
  }

  async listEmergencyRequests(
    scope: "mine" | "to_decide",
  ): Promise<EmergencyRequest[]> {
    const me = String(this.#ctx.employeeId);
    const { collection, getDocs } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      collection(legacyDb(), "cowork_emergency_approvals"),
    );

    const out: EmergencyRequest[] = [];
    for (const d of snap.docs) {
      const r = d.data() as Record<string, unknown>;
      const employeeId = typeof r.employeeId === "string" ? r.employeeId : "";
      const tlId = typeof r.tlId === "string" ? r.tlId : "";
      if (scope === "mine" ? employeeId !== me : tlId !== me) continue;

      const createdAtMs = readInstant(r.createdAt);
      const gapMs = Number(r.gapMs) || 0;
      const endedAt = createdAtMs ? new Date(createdAtMs) : null;
      const status = typeof r.status === "string" ? r.status : "pending";

      out.push({
        organisationId: LEGACY_ORGANISATION_ID,
        id: d.id,
        employeeId: employeeId as EmployeeId,
        employeeName: typeof r.employeeName === "string" ? r.employeeName : employeeId,
        managerId: tlId as EmployeeId,
        managerName: typeof r.tlName === "string" ? r.tlName : tlId,
        /* Legacy records the SPAN and the moment it was raised, not the two
           endpoints. The start is derived by subtraction, which is exactly what
           the span means — nothing is invented. */
        startedAt:
          endedAt ? new Date(endedAt.getTime() - gapMs).toISOString() : "",
        endedAt: endedAt ? endedAt.toISOString() : "",
        durationSecs: Math.max(0, Math.round(gapMs / 1000)),
        reason: typeof r.reason === "string" ? r.reason : "",
        /* Legacy requires no document. Empty rather than a fabricated id — the
           panel renders "no attachment" instead of a broken link. */
        attachmentId: "",
        status:
          status === "approved"
            ? "approved"
            : status === "rejected" || status === "declined"
              ? "declined"
              : "pending",
        decisionReason: null,
        decidedAt: readInstant(r.resolvedAt)
          ? new Date(readInstant(r.resolvedAt)!).toISOString()
          : null,
        /* Legacy does not record which deadlines an approval moved. Empty is
           the honest answer; listing the person's open tasks would claim a
           causal link nothing measured. */
        appliedTaskIds: [],
        /* The consumed marker, read back so a second approval finds it. Absent
           on every record written before this existed, which reads as "not yet
           applied" — correct, because those were decided by a path that shifted
           on approval and could not shift twice from a single decision. */
        compensationAppliedAt: readInstant(r.compensationAppliedAt)
          ? new Date(readInstant(r.compensationAppliedAt)!).toISOString()
          : null,
        createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : "",
      } as EmergencyRequest);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Decide one.
   *
   * A Firestore write for the same reason the list is a Firestore read: the old
   * app resolves these from the browser and the engine has no route for it.
   * **Approving does not move any deadline here** — legacy's shift is applied
   * by the employee's own client when it next comes online and reads
   * `pendingEmergencyGapMs`, so doing it here as well would move the same
   * deadlines twice.
   */
  /**
   * One stored emergency request, read back for its measured span.
   *
   * Read from the STORE rather than trusting a figure the deciding client
   * sends: the span is what the person was actually away for, and a browser is
   * not the right authority on how much time to give back.
   */
  /**
   * One emergency request, mapped the way the list maps them.
   *
   * **This read the wrong field, and the effect was total.** It looked for
   * `durationSecs`, which nothing writes — `createEmergencyRequest` stores the
   * span as `gapMs`, and so does the old application's own
   * `requestEmergencyApproval`. So the duration was always 0, `lostMs` was
   * always 0, and **approving an emergency on the real backend moved nothing at
   * all.** The gate worked; the payout never happened.
   *
   * It returns the whole record now rather than two fields, because the decision
   * needs the named manager, the status and the consumed marker as well — and
   * because a second, narrower reader of the same document is exactly how the
   * field names drifted apart in the first place.
   */
  async #emergencyRequestById(
    requestId: string,
  ): Promise<EmergencyRequest | null> {
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(
      doc(legacyDb(), "cowork_emergency_approvals", requestId),
    );
    if (!snap.exists()) return null;
    const raw = snap.data() as Record<string, unknown>;
    const employeeId =
      typeof raw.employeeId === "string"
        ? raw.employeeId
        : typeof raw.requestedBy === "string"
          ? raw.requestedBy
          : null;
    if (!employeeId) return null;

    /* `gapMs` is the stored span. `durationSecs` is accepted as well so a
       record written by a future path is not silently read as zero — the bug
       above, in the other direction. */
    const gapMs =
      typeof raw.gapMs === "number" && Number.isFinite(raw.gapMs)
        ? Math.max(0, raw.gapMs)
        : typeof raw.durationSecs === "number" && Number.isFinite(raw.durationSecs)
          ? Math.max(0, raw.durationSecs) * 1000
          : 0;

    const status = typeof raw.status === "string" ? raw.status : "pending";
    const resolvedAtMs = readInstant(raw.resolvedAt);
    const createdAtMs = readInstant(raw.createdAt);
    const appliedAtMs = readInstant(raw.compensationAppliedAt);
    const endedAtMs = resolvedAtMs ?? createdAtMs;

    return {
      organisationId: LEGACY_ORGANISATION_ID,
      id: requestId,
      employeeId: employeeId as EmployeeId,
      employeeName:
        typeof raw.employeeName === "string" ? raw.employeeName : employeeId,
      /* The NAMED decider, frozen when the request was raised. The whole
         authorisation rests on this one string. */
      managerId: (typeof raw.tlId === "string" ? raw.tlId : "") as EmployeeId,
      managerName: typeof raw.tlName === "string" ? raw.tlName : "",
      startedAt: endedAtMs ? new Date(endedAtMs - gapMs).toISOString() : "",
      endedAt: endedAtMs ? new Date(endedAtMs).toISOString() : "",
      durationSecs: Math.max(0, Math.round(gapMs / 1000)),
      reason: typeof raw.reason === "string" ? raw.reason : "",
      attachmentId: typeof raw.documentName === "string" ? raw.documentName : "",
      status:
        status === "approved"
          ? "approved"
          : status === "rejected" || status === "declined"
            ? "declined"
            : "pending",
      decisionReason:
        typeof raw.decisionReason === "string" ? raw.decisionReason : null,
      decidedAt: resolvedAtMs ? new Date(resolvedAtMs).toISOString() : null,
      appliedTaskIds: [],
      compensationAppliedAt: appliedAtMs
        ? new Date(appliedAtMs).toISOString()
        : null,
      createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : "",
    };
  }

  async decideEmergencyRequest(
    requestId: string,
    approve: boolean,
    decisionReason?: string,
  ): Promise<ActionResult<EmergencyRequest>> {
    const me = String(this.#ctx.employeeId);

    /**
     * **Read first, decide second, write third.**
     *
     * This used to write the status and then shift, with no check of any kind:
     * whoever called it approved it. The requester could approve their own
     * emergency, so could a secondary manager, so could anybody who reached the
     * method — and approving twice moved every deadline twice.
     *
     * The record NAMES its decider (`tlId`, frozen when the request was raised),
     * and `emergencyDecisionRefusal` compares against that identity rather than
     * against a capability. That is what makes "the employee cannot approve
     * their own" and "an administrator does not bypass this" true without either
     * being written as a special case.
     */
    const request = await this.#emergencyRequestById(requestId);
    if (!request)
      return { ok: false, code: "not_found", message: "Request not found." };

    const refusal = emergencyDecisionRefusal({
      request,
      actorId: me,
      approve,
      decisionReason: decisionReason ?? "",
    });
    if (refusal)
      return {
        ok: false,
        code: refusal.startsWith("A reason")
          ? "validation_failed"
          : "permission_denied",
        message: refusal,
      };

    /**
     * **What the approval is worth, decided by the rule and not here.**
     *
     * Computed BEFORE the write, from the record as it was read, so the amount
     * is the one the refusal above was taken against. Zero for a rejection, zero
     * for a request already applied, zero for anybody who is not the named
     * manager — the same arithmetic the demo runs.
     */
    const lostMs = emergencyCompensationMs({ request, actorId: me, approve });
    const decidedAt = new Date();

    const { doc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    try {
      await updateDoc(
        doc(legacyDb(), "cowork_emergency_approvals", requestId),
        {
          status: approve ? "approved" : "rejected",
          resolvedAt: decidedAt,
          resolvedBy: me,
          resolvedByName: me,
          /* The consumed marker, written in the SAME update as the status.
             Separating them would leave a window in which the request reads as
             approved and unapplied, which is exactly the state a retry pays out
             against a second time. */
          ...(lostMs > 0 ? { compensationAppliedAt: decidedAt } : {}),
          ...(decisionReason ? { decisionReason } : {}),
        },
      );
    } catch (error) {
      return {
        ok: false,
        code: "not_found",
        message:
          error instanceof Error
            ? `The decision could not be saved: ${error.message}`
            : "The decision could not be saved.",
      };
    }

    /**
     * **The one place an emergency moves a deadline.**
     *
     * Applied on APPROVAL BY THE NAMED MANAGER and nowhere else. A rejected
     * request shifts nothing, which is what makes the decision mean something —
     * before this, the time was already in the deadlines by the time the manager
     * saw the request, so approving and rejecting had the same effect.
     */
    if (lostMs > 0) {
      const shifted = await this.#compensateActiveDeadlines(
        String(request.employeeId),
        lostMs,
        `Emergency approved (${Math.round(lostMs / 60000)}m)${
          decisionReason ? ` — ${decisionReason}` : ""
        }`,
      );
      console.info("[presence] EMERGENCY APPROVED, deadlines shifted:", {
        employeeId: request.employeeId,
        decidedBy: me,
        minutes: Math.round(lostMs / 60000),
        tasksShifted: shifted,
      });
    }

    /**
     * **Whatever was decided, the pending gap is spent.**
     *
     * `dutyTransition` no longer banks an emergency span, but the OLD
     * application still writes `pendingEmergencyGapMs` on its own exits, and its
     * `applyPendingEmergencyApproval` turns whatever it finds there into ANOTHER
     * approval request on its next online transition. Left behind, one emergency
     * would come back for a second decision and a second shift.
     *
     * Cleared on a rejection too — a refused emergency owes nothing and must not
     * leave a claim lying on the document.
     */
    await this.#clearPendingEmergencyGap(String(request.employeeId));

    notifyRepositoryChanged();
    const mine = await this.listEmergencyRequests("to_decide");
    const updated = mine.find((r) => r.id === requestId);
    return updated
      ? { ok: true, data: updated }
      : {
          ok: false,
          code: "not_found",
          message: "The decision was saved but the request could not be read back.",
        };
  }

  /**
   * A task's daily reports.
   *
   * `cowork_tasks/{taskId}/dailyReports` — a subcollection, like chat, and the
   * service's own header says so: "stored in task's own subcollection".
   */
  async listDailyReports(taskId: TaskId): Promise<DailyReport[]> {
    const id = String(taskId);
    const { collection, getDocs } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      collection(legacyDb(), "cowork_tasks", id, "dailyReports"),
    );
    return snap.docs.map((d) => {
      const r = d.data() as Record<string, unknown>;
      const created = readInstant(r.createdAt);
      const urls = [
        ...(Array.isArray(r.imageUrls) ? r.imageUrls : []),
        ...(Array.isArray(r.pdfAttachments) ? r.pdfAttachments : []),
      ].filter((u): u is string => typeof u === "string");
      const attachments: ReportAttachment[] = (
        Array.isArray(r.attachments) ? r.attachments : []
      )
        .map((a) => {
          const o = (a ?? {}) as Record<string, unknown>;
          const url = typeof o.url === "string" ? o.url : "";
          if (!url) return null;
          return {
            url,
            name: typeof o.name === "string" && o.name ? o.name : nameFromUrl(url),
            mimeType: typeof o.mimeType === "string" ? o.mimeType : "",
          };
        })
        .filter((a): a is ReportAttachment => a !== null);
      return {
        id: d.id,
        taskId: id as TaskId,
        employeeId: (typeof r.employeeId === "string" ? r.employeeId : "") as EmployeeId,
        reportDate: typeof r.reportDate === "string" ? r.reportDate : "",
        message: typeof r.message === "string" ? r.message : "",
        progressPercent: Number(r.progressPercent) || 0,
        attachmentIds: urls.length ? urls : attachments.map((a) => a.url),
        /* `attachments` is what this application writes; the flat URL arrays
           are what legacy wrote and still writes. A report from either era
           resolves to the same list — one with real names, one with names
           recovered from the URL. */
        attachments: attachments.length
          ? attachments
          : urls.map((url) => ({
              url,
              name: nameFromUrl(url),
              mimeType: "",
            })),
        documentId: typeof r.documentId === "string" ? r.documentId : null,
        documentTitle:
          typeof r.documentTitle === "string" ? r.documentTitle : null,
        createdAt: created ? new Date(created).toISOString() : "",
      };
    });
  }

  /**
   * File a daily report against a task.
   *
   * **This did not exist.** The interface declared it, the modal called it and
   * the mock implemented it — so every report written since the end-of-day flow
   * shipped hit the throwing proxy at the bottom of this file and was lost. The
   * caller used `Promise.allSettled`, so nothing surfaced: a person wrote their
   * day up, pressed submit, went offline, and the Reports tab stayed empty.
   *
   * Writes to `cowork_tasks/{taskId}/dailyReports`, the subcollection
   * `listDailyReports` already reads, and in the shape it already parses —
   * `imageUrls` and `pdfAttachments` are populated as well as `attachments` so
   * a report filed here is readable by the old application too.
   */
  async submitDailyReport(input: {
    taskId: TaskId;
    message: string;
    progressPercent: number;
    attachmentIds: string[];
    attachments?: ReportAttachment[];
    documentId?: string | null;
    documentTitle?: string | null;
  }): Promise<ActionResult<DailyReport>> {
    const employeeId = String(this.#ctx.employeeId);
    if (!employeeId)
      return {
        ok: false,
        code: "permission_denied",
        message: "Sign in to file a report.",
      };

    const message = input.message.trim();
    const documentId = input.documentId ?? null;
    /* A report has to say something. A document counts as saying it — the text
       box is the short form, not the only form. */
    if (!message && !documentId)
      return {
        ok: false,
        code: "validation_failed",
        message: "Write what you did, or attach a document.",
        field: "message",
      };

    const taskId = String(input.taskId);
    const attachments =
      input.attachments ??
      input.attachmentIds.map((url) => ({
        url,
        name: nameFromUrl(url),
        mimeType: "",
      }));

    /* Split by type so the old application, which reads two typed arrays and
       knows nothing about `attachments`, still shows the files. */
    const imageUrls = attachments
      .filter((a) => a.mimeType.startsWith("image/"))
      .map((a) => a.url);
    const pdfAttachments = attachments
      .filter((a) => !a.mimeType.startsWith("image/"))
      .map((a) => a.url);

    const { addDoc, collection, serverTimestamp } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    const reportDate = istDayKey(Date.now());
    const createdAt = new Date().toISOString();

    try {
      const ref = await addDoc(
        collection(legacyDb(), "cowork_tasks", taskId, "dailyReports"),
        {
          organisationId: LEGACY_ORGANISATION_ID,
          employeeId,
          taskId,
          reportDate,
          message,
          progressPercent: Math.max(
            0,
            Math.min(100, Math.round(input.progressPercent)),
          ),
          attachments,
          imageUrls,
          pdfAttachments,
          documentId,
          documentTitle: input.documentTitle ?? null,
          createdAt: serverTimestamp(),
        },
      );
      notifyRepositoryChanged();
      return {
        ok: true,
        data: {
          id: ref.id,
          taskId: taskId as TaskId,
          employeeId: employeeId as EmployeeId,
          reportDate,
          message,
          progressPercent: input.progressPercent,
          attachmentIds: attachments.map((a) => a.url),
          attachments,
          documentId,
          documentTitle: input.documentTitle ?? null,
          createdAt,
        },
      };
    } catch (error) {
      return {
        ok: false,
        code: "conflict",
        message:
          error instanceof Error
            ? error.message
            : "That report could not be saved.",
      };
    }
  }

  /**
   * Every commit on one day, across tasks, for the timeline.
   *
   * `cowork_work_commits` is top-level precisely so a day can be read across
   * tasks — the opposite of chat, which is nested so it cannot be. The employee
   * and task title are joined from the directory and the task documents this
   * repository already caches, rather than denormalised onto the commit.
   */
  async listDayCommits(
    date: string,
  ): Promise<(WorkCommit & { employee: Employee; taskTitle: string })[]> {
    const employeeId = String(this.#ctx.employeeId);
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_work_commits"),
        where("employeeId", "==", employeeId),
      ),
    );

    const employees = await this.#employeesById();
    const me = employees.get(employeeId);
    if (!me) return [];

    const out: (WorkCommit & { employee: Employee; taskTitle: string })[] = [];
    for (const d of snap.docs) {
      const c = d.data() as Record<string, unknown>;
      const endedAtMs = readInstant(c.endedAt) ?? readInstant(c.createdAt);
      if (endedAtMs === null) continue;
      /* Filtered in memory rather than by query: legacy stores no day key, and
         adding a composite index for a range read of one person's commits is a
         deploy this does not need. IST-aware: UTC midnight ≠ IST midnight, so a
         session that runs until after 18:30 IST must not be dropped by a UTC
         date comparison. */
      if (istDayKey(endedAtMs) !== date) continue;
      const startedAtMs = readInstant(c.startedAt) ?? endedAtMs;
      const taskId = typeof c.taskId === "string" ? c.taskId : "";
      out.push({
        organisationId: LEGACY_ORGANISATION_ID,
        id: d.id,
        taskId: taskId as TaskId,
        employeeId: employeeId as EmployeeId,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
        durationSecs: firstNumber(c, "durationSecs", "totalSeconds", "seconds") ?? 0,
        message: typeof c.message === "string" ? c.message : null,
        attachmentIds: [],
        pauseReason: "manual" as const,
        employee: me,
        taskTitle:
          typeof c.taskTitle === "string" && c.taskTitle.trim()
            ? c.taskTitle
            : taskId,
      });
    }
    return out;
  }

  /**
   * The completion submission.
   *
   * **At most one.** Legacy keeps a single `completionSubmission` object on the
   * task and OVERWRITES it on resubmission (`taskForward.service.js:1201`) —
   * the domain's own comment on `supersededById` notes that it "overwrote
   * silently". So a list is the right shape for the interface and a one-element
   * list is the truthful content: earlier attempts are genuinely gone, and
   * fabricating an attempt history would invent a record of work that no longer
   * exists anywhere.
   */
  /**
   * The workspace's outputs, briefly cached.
   *
   * Every task view needs it — to know whether its inputs are approved and what
   * they are called — and a list of forty tasks would otherwise fetch it forty
   * times for one screen. Two seconds is long enough to serve one render pass
   * and short enough that an approval shows up on the next interaction.
   *
   * A failed read yields an EMPTY index, which renders as "waiting on an output
   * you cannot see" rather than as work being ready. Falling the other way
   * would tell somebody to start on an input that has not landed.
   */
  #outputIndexCache: {
    at: number;
    value: {
      approved: Set<string>;
      labels: Map<string, { label: string; taskTitle: string }>;
    };
  } | null = null;

  async #outputIndex() {
    const fresh = this.#outputIndexCache && Date.now() - this.#outputIndexCache.at < 2000;
    if (fresh) return this.#outputIndexCache!.value;
    const token = await this.#token();
    const res = await fetchOutputIndex({ token }).catch(() => null);
    const approved = new Set<string>();
    const labels = new Map<string, { label: string; taskTitle: string }>();
    if (res?.ok) {
      for (const item of res.data.items ?? []) {
        labels.set(item.outputId, { label: item.label, taskTitle: item.taskTitle });
        if (item.approved) approved.add(item.outputId);
      }
    }
    const value = { approved, labels };
    this.#outputIndexCache = { at: Date.now(), value };
    return value;
  }

  async listSubmissions(taskId: TaskId): Promise<TaskSubmission[]> {
    const id = String(taskId);
    const doc = await this.#taskDocument(id);
    if (!doc) return [];

    /**
     * Output submissions first, because a task that delivers by output has no
     * task-level one at all.
     *
     * The review screen reads this list. Returning only `completionSubmission`
     * meant a submitted output showed "Nothing has been submitted for review
     * yet" on the very page its reviewer had just been sent to.
     *
     * Newest first, so `[0]` is the one awaiting a decision — the same ordering
     * the mock repository returns and the same the screen assumes.
     */
    const outputs = readOutputSubmissionRecords(doc, id);

    const raw = doc.completionSubmission;
    if (!raw || typeof raw !== "object") return outputs;
    const sub = raw as Record<string, unknown>;

    const submittedAtMs = readInstant(sub.submittedAt);
    const submissionFiles = readSubmissionAttachments(sub);
    const chain = await this.#reviewChainOf(doc);
    return [
      {
        id: compositeId(id, "submission"),
        taskId: id as TaskId,
        /* One record, so one attempt. Counting resubmissions would need a
           history legacy does not keep. */
        outputId: null,
      attempt: 1,
        submittedById: (typeof sub.submittedBy === "string" ? sub.submittedBy : "") as EmployeeId,
        submittedAt: submittedAtMs ? new Date(submittedAtMs).toISOString() : "",
        message: typeof sub.message === "string" ? sub.message : "",
        /* Names and download links kept, not flattened away — see
           `readSubmissionAttachments`. The reviewer's screen is the one that
           has to open these, and a bare URL cannot be shown to anybody. */
        attachments: submissionFiles,
        /* Derived FROM the list above rather than gathered separately, so the
           two cannot come to disagree about what was submitted. */
        attachmentIds: submissionFiles.map((f) => f.url),
        reviewChain: chain.chain,
        currentStage: chain.currentStage,
        supersededById: null,
        /* Legacy does not stamp lateness on the submission; deriving it here
           against a deadline that may since have moved would put a late flag on
           work that was not. */
        wasLate: false,
      },
      ...outputs,
    ];
  }

  /**
   * What sending this task back at a given priority would do to that
   * person's other work.
   *
   * The engine answers by running its real queue walk in simulation, so the
   * figures the reviewer is shown are the ones the commit will produce. A
   * failure returns null rather than throwing: the picker still works, it
   * just cannot show consequences, and a rework must never be blocked by a
   * preview.
   */
  async reworkQueuePreview(
    taskId: TaskId,
    priority: number | null,
  ): Promise<ReworkQueuePreview | null> {
    const token = await this.#token();
    if (!token) return null;
    const r = await reworkQueuePreviewCall({ token, taskId: String(taskId), priority });
    if (!r.ok) return null;
    const body = r.data as Partial<ReworkQueuePreview> | null;
    if (!body || !Array.isArray(body.rows)) return null;
    return {
      leftoverSecs:
        typeof body.leftoverSecs === "number" ? body.leftoverSecs : null,
      currentRank: typeof body.currentRank === "number" ? body.currentRank : null,
      rank: typeof body.rank === "number" ? body.rank : null,
      rows: body.rows.map((row) => ({
        taskId: String(row.taskId) as TaskId,
        title: String(row.title ?? row.taskId),
        rank: Number(row.rank) || 0,
        isRework: row.isRework === true,
        from: row.from ?? null,
        to: String(row.to ?? ""),
      })),
    };
  }

  /**
   * Who has reviewed, and what they decided.
   *
   * Legacy keeps two named slots rather than a list — `tlReview` and
   * `ceoReview` — because its chain is fixed at two stages
   * (`reviewFlow: "tl_then_ceo"`). Both are read, in stage order, and an empty
   * slot is simply a stage nobody has reached.
   */
  async listReviews(taskId: TaskId): Promise<TaskReview[]> {
    const id = String(taskId);
    const doc = await this.#taskDocument(id);
    if (!doc) return [];

    const out: TaskReview[] = [];
    const slots: [unknown, number, boolean][] = [
      [doc.tlReview, 1, false],
      [doc.ceoReview, 2, true],
    ];
    for (const [raw, stage, isFinal] of slots) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const at = readInstant(r.reviewedAt);
      out.push({
        id: compositeId(id, `review-${stage}`),
        submissionId: compositeId(id, "submission"),
        taskId: id as TaskId,
        stage,
        isFinalStage: isFinal,
        reviewerId: (typeof r.reviewedBy === "string" ? r.reviewedBy : "") as EmployeeId,
        decision: r.approved === true ? "approved" : "rejected",
        reason:
          typeof r.rejectionReason === "string" && r.rejectionReason.trim()
            ? r.rejectionReason.trim()
            : null,
        reviewedAt: at ? new Date(at).toISOString() : "",
      });
    }
    return out;
  }

  /**
   * Rework requests.
   *
   * A rejection IS the rework request in legacy — `/task/:id/rework` sets
   * `completionStatus: "tl_rejected"` and returns the task to `in_progress`,
   * with the reason on the review. There is no separate record, so this derives
   * from the rejections rather than reading a collection that does not exist.
   */
  async listReworkRequests(taskId: TaskId): Promise<ReworkRequest[]> {
    const reviews = await this.listReviews(taskId);
    return reviews
      .filter((r) => r.decision === "rejected")
      .map((r, index) => ({
        id: compositeId(r.id, "rework"),
        reviewId: r.id,
        taskId: r.taskId,
        occurrence: index + 1,
        reason: r.reason ?? "",
        requestedById: r.reviewerId,
        requestedAt: r.reviewedAt,
      })) as ReworkRequest[];
  }

  /** One task document, or null. Shared by the completion reads above. */
  async #taskDocument(taskId: string): Promise<Record<string, unknown> | null> {
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", taskId));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  }

  /**
   * The review chain, from the engine's own `reviewFlow`.
   *
   * Legacy resolves reviewers at submission time and stores the SHAPE
   * (`"tl_then_ceo"`) rather than the people, so the chain is derived from
   * which slots are filled. `currentStage` is 1-based to match the domain.
   */
  /**
   * Who reviews this submission, resolved FORWARD from the workflow.
   *
   * **This used to read backwards** — it listed whoever had already reviewed,
   * which is nobody until somebody does. `reviewChain.includes(me)` was
   * therefore false for every person on every fresh submission, so the review
   * step could never begin and the task told its own owner that the submission
   * was "with someone else".
   *
   * The chain now comes from the flow legacy stamped on the task
   * (`reviewFlow`), with each stage resolved to a real person:
   *
   * · **creator** — the team lead who raised it, for `tl_final`.
   * · **chief executive** — read from the directory by role, matching legacy's
   *   own `verifyCeoToken` gate on `ceo-review`, which asks for the role rather
   *   than for a named person.
   * · **assignee's manager** — from the reporting tree, which is this product's
   *   source of truth for who manages whom.
   *
   * A stage that cannot be resolved is dropped rather than filled with a guess.
   * An unresolvable stage means nobody is named for it, and putting the wrong
   * name there would send somebody to chase a colleague who cannot help — but
   * it also must not silently widen access, which is why it is dropped rather
   * than replaced with "anyone".
   */
  async #reviewChainOf(doc: Record<string, unknown>): Promise<{
    chain: EmployeeId[];
    currentStage: number;
  }> {
    const flow = readReviewFlow(doc);
    const stages = stagesOf(flow);

    const assigneeId = Array.isArray(doc.assigneeIds)
      ? String(doc.assigneeIds[0] ?? "")
      : "";
    const creatorId =
      typeof doc.createdBy === "string"
        ? doc.createdBy
        : typeof doc.assignedBy === "string"
          ? doc.assignedBy
          : "";

    const chain: EmployeeId[] = [];
    for (const role of stages) {
      const resolved = await this.#resolveReviewer(role, {
        creatorId,
        assigneeId,
      });
      if (resolved) chain.push(resolved as EmployeeId);
    }

    return { chain, currentStage: currentStageOf(doc, chain.length) };
  }

  async #resolveReviewer(
    role: ReviewerRole,
    ids: { creatorId: string; assigneeId: string },
  ): Promise<string | null> {
    if (role === "creator") {
      /* **A self task's creator IS its assignee, and nobody reviews their own
         submission.** So this stage belongs to the assignee's MANAGER — exactly
         who the two-stage flow's `assignee_manager` resolves to. Without this a
         self task took the `tl_final` shape (one stage, "creator") and routed the
         review straight back to the person who submitted it: the chain was
         `[submitter]`, `mayReview` excluded them, and their manager — the one
         person who SHOULD see it — was told the work was "with someone else". */
      if (ids.creatorId && ids.creatorId === ids.assigneeId) {
        return this.#assigneeManagerId(ids.assigneeId);
      }
      return ids.creatorId || null;
    }

    if (role === "chief_executive") {
      /* By ROLE, not by a hardcoded id — legacy's `ceo-review` is guarded by
         `verifyCeoToken`, which asks the same question. */
      const employees = await this.#employeesById();
      for (const person of employees.values()) {
        if (person.roleIds.includes(ROLE_ADMIN)) return person.id;
      }
      return null;
    }

    /* The assignee's manager, from the reporting tree. */
    return this.#assigneeManagerId(ids.assigneeId);
  }

  /** The assignee's manager id, from the reporting tree — the product's source
      of truth for who manages whom. Null where the tree names nobody. */
  async #assigneeManagerId(assigneeId: string): Promise<string | null> {
    if (!assigneeId) return null;
    const tree = await this.#reportingTree();
    const node = tree.byEmployee.get(toHierarchyId(assigneeId));
    return node?.managerId ?? null;
  }

  /**
   * A task's chat thread.
   *
   * `cowork_tasks/{taskId}/chat` — a **subcollection**, so a flat query finds
   * nothing. The service's own comment is emphatic about why it is nested:
   * "completely isolated per task … NEVER mixed with other tasks".
   *
   * The draft thread is a different legacy route and is not read here; asking
   * for it returns empty rather than quietly showing the main thread, which
   * would put working messages where private notes are expected.
   */
  async listTaskChat(
    taskId: TaskId,
    thread: "chat" | "draft",
  ): Promise<TaskChatMessage[]> {
    if (thread === "draft") return [];
    const id = String(taskId);
    const { collection, getDocs, query, orderBy } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_tasks", id, "chat"),
        orderBy("createdAt", "asc"),
      ),
    );

    return snap.docs.map((d) =>
      readTaskChatMessage(
        id as TaskId,
        d.id,
        d.data() as Record<string, unknown>,
        readInstant((d.data() as Record<string, unknown>).createdAt)
          ? new Date(readInstant((d.data() as Record<string, unknown>).createdAt)!).toISOString()
          : "",
      ),
    );
  }

  /**
   * Work commits — the daily reports a task accumulates.
   *
   * `cowork_work_commits`, filtered to this task. It is a top-level collection
   * in legacy rather than a subcollection, unlike chat, because the same
   * records feed a person's day across every task they touched.
   */
  async listWorkCommits(taskId: TaskId): Promise<WorkCommit[]> {
    const id = String(taskId);
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_work_commits"),
        where("taskId", "==", id),
      ),
    );

    return snap.docs.map((d) => {
      const c = d.data() as Record<string, unknown>;
      const startedAtMs = readInstant(c.startedAt);
      const endedAtMs = readInstant(c.endedAt) ?? readInstant(c.createdAt);
      return {
        organisationId: LEGACY_ORGANISATION_ID,
        id: d.id,
        taskId: id as TaskId,
        employeeId: (typeof c.employeeId === "string" ? c.employeeId : "") as EmployeeId,
        startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : "",
        endedAt: endedAtMs ? new Date(endedAtMs).toISOString() : "",
        durationSecs: firstNumber(c, "durationSecs", "totalSeconds", "seconds") ?? 0,
        message: typeof c.message === "string" ? c.message : null,
        attachmentIds: [],
        pauseReason: "manual" as const,
      };
    });
  }

  /**
   * Departments, derived from the directory.
   *
   * **Legacy has no department entity.** `cowork_employees.department` is a
   * bare string and every join in the engine is a string comparison on it
   * (`taskForward.js:94`). So the set of departments IS the set of distinct
   * normalised names on the directory — deriving it here is reading the same
   * fact the engine reads, not inventing a table.
   *
   * `hodEmployeeId` is null throughout: legacy names no head of department
   * anywhere, and picking one — the longest-serving, the highest role — would
   * put a name against an approval nobody appointed them to.
   */
  async listDepartments(): Promise<Department[]> {
    const employees = await this.#employeesById();
    const byId = new Map<string, Department>();
    for (const person of employees.values()) {
      const id = person.departmentId;
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        organisationId: LEGACY_ORGANISATION_ID,
        id,
        name: person.departmentName || id,
        hodEmployeeId: null,
        parentDepartmentId: null,
        isActive: true,
      });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The action inbox.
   *
   * One resolver, `actionableFor`, applied to the tasks this viewer can already
   * see — the repository decides membership and the UI renders what it is
   * handed. A list filtered client-side would eventually disagree with the
   * count on the tab, which is the arrangement this method exists to prevent.
   */
  async listActionable(): Promise<ActionableItem[]> {
    const viewerId = String(this.#ctx.employeeId);
    const page = await this.listTasks({ scope: "all", limit: 200 });
    const out: ActionableItem[] = [];
    for (const view of page.items) {
      const verdict = actionableFor(view, viewerId);
      if (!verdict) continue;
      out.push({
        view,
        reason: verdict.reason,
        label: verdict.label,
        href: verdict.href,
        /* The second line names the other party, which is the fact a reader
           needs to act. Empty rather than invented when the task has no
           counterpart resolved. */
        subtitle: view.owner?.displayName ?? "",
        approvalKind:
          view.pendingApprovals.find((a) => a.approverId === viewerId)?.kind ??
          null,
      });
    }
    out.push(...(await this.#dailyReportActionable(viewerId, out)));
    return out;
  }

  /**
   * Unfiled daily reports, as inbox items.
   *
   * Separate from the loop above on purpose: `actionableFor` decides from the
   * task's OWN state, and whether today's timer activity has been reported on
   * is not part of that — it lives in `cowork_work_commits` /
   * `cowork_task_timers`, keyed by employee and day, not on the task. Scoped
   * to tasks actually WORKED today (`workedToday`), which is a handful of
   * rows, rather than the full visible task list — the same distinction
   * `listDayCommits` makes.
   *
   * Best-effort: a failure here must not take the whole inbox down with it.
   */
  async #dailyReportActionable(
    viewerId: string,
    already: ActionableItem[],
  ): Promise<ActionableItem[]> {
    try {
      const today = istDayKey(Date.now());
      const [commits, timers] = await Promise.all([
        this.listDayCommits(today),
        this.listTimers(),
      ]);
      const worked = workedToday(
        commits,
        timers as Parameters<typeof workedToday>[1],
        Date.now(),
      );
      if (worked.length === 0) return [];

      const seen = new Set(already.map((i) => i.view.task.id));
      const out: ActionableItem[] = [];
      for (const w of worked) {
        /* A task already carrying another obligation (an approval, a review,
           a blocker) keeps that one — a second row for the same task would
           double-count it against the tab's own badge. */
        if (seen.has(w.taskId as TaskId)) continue;
        const reports = await this.listDailyReports(w.taskId as TaskId);
        if (
          !isReportPending({
            reports,
            worked,
            taskId: w.taskId,
            employeeId: viewerId,
            date: today,
          })
        )
          continue;
        const view = await this.#readTaskView(w.taskId);
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
    } catch (err) {
      console.error("[actionable:dr] error:", err);
      return [];
    }
  }

  /** Every session this employee holds, running or not. */
  async listTimers(): Promise<unknown[]> {
    const employeeId = String(this.#ctx.employeeId);
    const { collection, getDocs } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      collection(legacyDb(), "cowork_task_timers", employeeId, "sessions"),
    );
    return snap.docs.map((d) => {
      const t = d.data() as Record<string, unknown>;
      return {
        taskId: d.id,
        employeeId,
        isActive: t.isActive === true,
        accumulatedSecs: Number(t.totalSeconds) || 0,
        startedAtRealMs: Number(t.lastStartTime) || null,
        taskTitle: typeof t.taskTitle === "string" ? t.taskTitle : d.id,
        loggedSecs: Number(t.totalSeconds) || 0,
      };
    });
  }

  /**
   * Notifications. `GET /cowork/notifications`.
   *
   * Shape confirmed against a live response, not inferred from the route file.
   */
  async listNotifications(): Promise<Notification[]> {
    /* Firestore, the same query the old app runs.
       `cowork_notifications` where `recipientEmployeeId == me`,
       `orderBy createdAt desc`, `limit(50)` — copied from
       `lib/legacy-ui/useCoworkNotifications.ts:188-193`, which is the old app's
       own listener.

       It read `GET /cowork/notifications` before, and that was a parity bug of
       the worst kind: the bell already used the ported Firestore listener while
       the list and the /notifications page used the API. Two sources for one
       fact, so the badge could count a notification the list below it did not
       show. The old app has exactly one source, and now so does this. */
    const employeeId = String(this.#ctx.employeeId);
    const { collection, getDocs, limit, orderBy, query, where } =
      await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_notifications"),
        where("recipientEmployeeId", "==", employeeId),
        orderBy("createdAt", "desc"),
        limit(50),
      ),
    );
    return toNotifications(
      snap.docs.map((d) => ({ ...(d.data() as object), id: d.id })) as never[],
    );
  }

  /**
   * Mark one notification read. `PATCH /cowork/notifications/:id/read`.
   *
   * ## Neither of these existed, and the bell could not be cleared
   *
   * `markNotificationRead` and `markAllNotificationsRead` were implemented on
   * the MOCK repository only. Against the real engine both fell through to the
   * throwing proxy, so every press of "mark read" on `/notifications` raised
   * `NotConnectedError` and the badge stayed exactly where it was — on a page
   * whose entire purpose is clearing it.
   *
   * Written through the engine rather than to Firestore, which is the rule for
   * every write, and here it also carries the recipient check: the browser
   * holds a document id in a collection every employee shares, so "is this
   * yours" is not a question the client can be trusted to answer.
   *
   * A refusal reads as `not_found` whether the row is missing or belongs to
   * somebody else — the engine does not distinguish them, deliberately.
   */
  async markNotificationRead(id: string): Promise<ActionResult<void>> {
    const token = await this.#token();
    const r = await legacyFetch<{ success?: boolean; error?: string }>({
      path: `/cowork/notifications/${encodeURIComponent(String(id))}/read`,
      method: "PATCH",
      token,
    });
    if (!r.ok) {
      return {
        ok: false,
        code: r.error.kind === "permission" ? "permission_denied" : "not_found",
        message: r.error.message,
      };
    }
    /* `success: false` with HTTP 200 is legacy's own failure shape — the trap
       `envelope.ts` exists to pin. Reporting it as success would leave a row
       looking cleared until the next read put it back unread. */
    if (r.data?.success === false) {
      return {
        ok: false,
        code: "not_found",
        message: r.data.error ?? "That notification could not be marked read.",
      };
    }
    notifyRepositoryChanged();
    return { ok: true, data: undefined };
  }

  /** Clear the whole inbox. `PATCH /cowork/notifications/read-all`. */
  async markAllNotificationsRead(): Promise<ActionResult<void>> {
    const token = await this.#token();
    const r = await legacyFetch<{ success?: boolean; error?: string }>({
      path: "/cowork/notifications/read-all",
      method: "PATCH",
      token,
    });
    if (!r.ok) {
      return {
        ok: false,
        code: r.error.kind === "permission" ? "permission_denied" : "conflict",
        message: r.error.message,
      };
    }
    if (r.data?.success === false) {
      return {
        ok: false,
        code: "conflict",
        message: r.data.error ?? "Those notifications could not be cleared.",
      };
    }
    notifyRepositoryChanged();
    return { ok: true, data: undefined };
  }

  /* ── Documents ──────────────────────────────────────────────────────────
   *
   * `cowork_documents` and `cowork_document_bodies`, browser-to-Firestore.
   *
   * **Not through the engine, and deliberately so.** There is no document route
   * on `grav-cms-backend` and adding one would be the write-inversion this
   * migration was told not to do. The collection is new — legacy has nothing
   * like it — so nothing here has to stay legible to the old app.
   *
   * Bodies are a SEPARATE collection keyed by document id rather than a field
   * on the record: a list read would otherwise pull every body to render a
   * sidebar, and Firestore bills per document read.
   */
  async listDocuments(kind: DocumentKind = "doc"): Promise<DocumentSummary[]> {
    const me = String(this.#ctx.employeeId);
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      query(
        collection(legacyDb(), DOCUMENT_COLLECTION),
        where("memberIds", "array-contains", me),
      ),
    );
    const docs = snap.docs
      .map((d) => readDocument(d.id, d.data() as Record<string, unknown>))
      .filter((d): d is CoworkDocument => d !== null && !d.deletedAt && d.kind === kind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    /* Previews come from the bodies of the documents already listed, read in
       parallel. Capped, because a person in two hundred documents would
       otherwise issue two hundred reads to draw a sidebar. */
    const withPreview = await Promise.all(
      docs.slice(0, 40).map(async (d) => ({
        ...d,
        preview: previewOfHtml((await this.#documentBodyHtml(d.id)) ?? ""),
      })),
    );
    return [
      ...withPreview,
      ...docs.slice(40).map((d) => ({ ...d, preview: "" })),
    ];
  }

  async #documentBodyHtml(id: string): Promise<string | null> {
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), DOCUMENT_BODY_COLLECTION, id));
    if (!snap.exists()) return null;
    const raw = snap.data() as Record<string, unknown>;
    return typeof raw.html === "string" ? raw.html : "";
  }

  async getDocument(id: string): Promise<CoworkDocument | null> {
    const me = String(this.#ctx.employeeId);
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), DOCUMENT_COLLECTION, id));
    if (!snap.exists()) return null;
    const record = readDocument(id, snap.data() as Record<string, unknown>);
    /* Not a member is indistinguishable from not existing, on purpose: a 403
       on a document id confirms the document is real. */
    if (!record || record.deletedAt || !record.memberIds.includes(me))
      return null;
    return record;
  }

  async getDocumentBody(id: string): Promise<CoworkDocumentBody | null> {
    const record = await this.getDocument(id);
    if (!record) return null;
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), DOCUMENT_BODY_COLLECTION, id));
    if (!snap.exists())
      return {
        documentId: id,
        html: "",
        cells: null,
        ydocState: null,
        pageSetup: null,
        updatedAt: record.updatedAt,
      };
    const raw = snap.data() as Record<string, unknown>;
    return {
      documentId: id,
      html: typeof raw.html === "string" ? raw.html : "",
      cells: typeof raw.cells === "string" ? raw.cells : null,
      ydocState: typeof raw.ydocState === "string" ? raw.ydocState : null,
      /* Null rather than the default, so the editor can tell "laid out for
         Letter" from "written before page setup existed". Both open the same
         way; only one of them is a decision somebody made. */
      pageSetup: raw.pageSetup ? readPageSetup(raw.pageSetup) : null,
      updatedAt:
        typeof raw.updatedAt === "string" ? raw.updatedAt : record.updatedAt,
    };
  }

  async createDocument(input: {
    title: string;
    kind?: DocumentKind;
    memberIds?: EmployeeId[];
  }): Promise<ActionResult<CoworkDocument>> {
    const me = String(this.#ctx.employeeId);
    const { doc, setDoc, collection } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const now = new Date().toISOString();
    const ref = doc(collection(legacyDb(), DOCUMENT_COLLECTION));
    /* The creator is always a member — a document nobody can open is not a
       document, and a member list that forgot the author is how that happens. */
    const memberIds = [
      ...new Set([me, ...(input.memberIds ?? []).map(String)]),
    ];
    const members = memberIds.map((employeeId) => ({
      employeeId,
      /* The creator owns it; anybody named at creation can write. */
      role: (employeeId === me ? "owner" : "editor") as DocumentRole,
      addedAt: now,
    }));
    const record: CoworkDocument = {
      organisationId: LEGACY_ORGANISATION_ID,
      id: ref.id,
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
    try {
      await setDoc(ref, documentRecordFields(record));
      await setDoc(doc(legacyDb(), DOCUMENT_BODY_COLLECTION, ref.id), {
        html: "",
        cells: null,
        ydocState: null,
        updatedAt: now,
      });
    } catch (e) {
      return {
        ok: false,
        code: "validation_failed",
        message: e instanceof Error ? e.message : "The document could not be created.",
      };
    }
    return { ok: true, data: record };
  }

  async renameDocument(
    id: string,
    title: string,
  ): Promise<ActionResult<CoworkDocument>> {
    const next = title.trim();
    if (!next)
      return { ok: false, code: "validation_failed", message: "Give the document a name.", field: "title" };
    const record = await this.getDocument(id);
    if (!record)
      return { ok: false, code: "not_found", message: "Document not found." };
    if (!canManageDocument(record, String(this.#ctx.employeeId)))
      return {
        ok: false,
        code: "permission_denied",
        message: "Only an owner can rename this document.",
      };
    const { doc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const now = new Date().toISOString();
    await updateDoc(doc(legacyDb(), DOCUMENT_COLLECTION, id), {
      title: next,
      updatedAt: now,
    });
    /* Announced AFTER the write, so the route reads the new title from the
       record rather than being told it — the same reason it is never sent any
       words at all. */
    this.#announce("document_renamed", { documentId: id });
    return { ok: true, data: { ...record, title: next, updatedAt: now } };
  }

  async deleteDocument(id: string): Promise<ActionResult<void>> {
    const me = String(this.#ctx.employeeId);
    const record = await this.getDocument(id);
    if (!record)
      return { ok: false, code: "not_found", message: "Document not found." };
    /* Membership is permission to WRITE in a document, not to remove one out
       from under everybody else in it. */
    if (!canManageDocument(record, me))
      return {
        ok: false,
        code: "permission_denied",
        message: "Only an owner can delete this document.",
      };
    const { doc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    /* Soft. The body is left alone — a delete that destroyed the text would
       make the record unrecoverable while still looking recoverable. */
    /* Announced BEFORE the write, unlike the rename: `loadDocument` on the
       route reads the record to resolve members and compose the title, and a
       soft-deleted document would still be readable but is not a thing to be
       relying on at that moment. The order matters and it differs between the
       two for that reason alone. */
    this.#announce("document_deleted", { documentId: id });
    await updateDoc(doc(legacyDb(), DOCUMENT_COLLECTION, id), {
      deletedAt: new Date().toISOString(),
    });
    return { ok: true, data: undefined };
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
    const me = String(this.#ctx.employeeId);
    const record = await this.getDocument(id);
    if (!record)
      return { ok: false, code: "not_found", message: "Document not found." };
    const refusal = editRefusal(record, me);
    if (refusal)
      return { ok: false, code: "permission_denied", message: refusal };
    const { doc, setDoc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const now = new Date().toISOString();

    /* `merge` so a phase-1 save carrying no CRDT state cannot erase the state a
       collaborative session wrote. */
    /* Each field only when given, so a sheet save cannot blank a document's
       prose and a phase-1 save cannot erase CRDT state. */
    const patch: Record<string, unknown> = { updatedAt: now };
    if (body.html !== undefined) patch.html = body.html;
    if (body.cells !== undefined) patch.cells = body.cells;
    if (body.ydocState !== undefined) patch.ydocState = body.ydocState;
    if (body.pageSetup !== undefined) {
      /* Validated at the write, not only in the dialog: the dialog is one
         caller, and margins that leave no measure produce a page nobody can
         type on for everybody who opens it afterwards. */
      if (body.pageSetup !== null) {
        const refusal = pageSetupRefusal(body.pageSetup);
        if (refusal)
          return { ok: false, code: "validation_failed", message: refusal };
      }
      patch.pageSetup = body.pageSetup;
    }
    await setDoc(doc(legacyDb(), DOCUMENT_BODY_COLLECTION, id), patch, {
      merge: true,
    });
    await updateDoc(doc(legacyDb(), DOCUMENT_COLLECTION, id), {
      updatedAt: now,
      lastEditedById: me,
    });
    return {
      ok: true,
      data: {
        documentId: id,
        html: body.html ?? "",
        cells: body.cells ?? null,
        ydocState: body.ydocState ?? null,
        pageSetup: body.pageSetup ?? null,
        updatedAt: now,
      },
    };
  }

  async setDocumentMember(
    id: string,
    employeeId: EmployeeId,
    role: DocumentRole | null,
  ): Promise<ActionResult<CoworkDocument>> {
    const record = await this.getDocument(id);
    if (!record)
      return { ok: false, code: "not_found", message: "Document not found." };
    const refusal = memberChangeRefusal({
      doc: record,
      actorId: String(this.#ctx.employeeId),
      targetId: String(employeeId),
      nextRole: role,
    });
    if (refusal)
      return { ok: false, code: "permission_denied", message: refusal };

    const next = writeMembers(record.members, {
      employeeId: String(employeeId),
      role,
      at: new Date().toISOString(),
    });
    const { doc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const now = new Date().toISOString();
    /* Both lists in ONE write. Firestore cannot query inside an array of
       objects, so `memberIds` is the `array-contains` index — writing them
       separately would leave somebody with a role but no way to find the
       document, or the reverse. */
    await updateDoc(doc(legacyDb(), DOCUMENT_COLLECTION, id), {
      members: next.members,
      memberIds: next.memberIds,
      updatedAt: now,
    });

    /* **Tell them.** Sharing a document with somebody who is never told is
       sharing it with nobody: `/workspace` lists what you are a member of, so
       until they happen to look, a document handed to them does not exist.
       Removal matters more — a document that silently vanishes from the list
       reads as data loss.

       Through the ENGINE, not Firestore, even though the membership write
       above is a direct one. A notification is a row addressed to somebody
       else, and a browser that could write those could put any message in
       anybody's inbox. The route re-derives that this caller really is an
       owner before it announces anything.

       Deliberately not awaited into the result: the membership change is
       committed and correct whatever happens next, and failing the whole
       action because an announcement did not send would leave the caller
       retrying a write that already succeeded. */
    void (async () => {
      try {
        const token = await this.#token();
        await legacyFetch({
          path: `/cowork/documents/${encodeURIComponent(id)}/notify-member`,
          method: "POST",
          token,
          body: { employeeId: String(employeeId), role },
        });
      } catch {
        /* Nothing to do and nothing to say: the share worked. */
      }
    })();

    return {
      ok: true,
      data: { ...record, members: next.members, memberIds: next.memberIds, updatedAt: now },
    };
  }

  /**
   * Version history.
   *
   * `/cowork/documents/:id/versions`, through the engine — unlike the rest of
   * a document, which is written browser-direct to Firestore. The reason is
   * the same one mindmaps already have, one section down: a checkpoint holds
   * raw Yjs bytes copied server-side from whatever the live save already
   * wrote, and a restore replaces `ydocState` outright. Neither is safe as a
   * browser-direct write — a client has no business reading or overwriting
   * another session's CRDT state without the server checking membership
   * first.
   */
  async listDocumentVersions(id: string): Promise<DocumentVersionSummary[]> {
    const token = await this.#token();
    const r = await legacyFetch<{ versions?: unknown[] }>({
      path: `/cowork/documents/${encodeURIComponent(id)}/versions`,
      token,
    });
    if (!r.ok) throw new Error(r.error.message);
    return (r.data.versions ?? [])
      .map(readDocumentVersion)
      .filter((v): v is DocumentVersionSummary => v !== null);
  }

  async saveDocumentVersion(
    id: string,
    label?: string,
  ): Promise<ActionResult<DocumentVersionSummary>> {
    const token = await this.#token();
    const r = await legacyFetch<{ version?: unknown }>({
      path: `/cowork/documents/${encodeURIComponent(id)}/versions`,
      method: "POST",
      token,
      body: label ? { label } : {},
    });
    if (!r.ok)
      return {
        ok: false,
        code: r.error.status === 403 ? "permission_denied" : "validation_failed",
        message: r.error.message,
      };
    const version = readDocumentVersion(r.data.version);
    if (!version)
      return {
        ok: false,
        code: "validation_failed",
        message: "The version was saved but could not be read back.",
      };
    return { ok: true, data: version };
  }

  async restoreDocumentVersion(
    id: string,
    versionId: string,
  ): Promise<ActionResult<void>> {
    const token = await this.#token();
    const r = await legacyFetch<{ success?: boolean }>({
      path: `/cowork/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
      method: "POST",
      token,
    });
    if (!r.ok)
      return {
        ok: false,
        code: r.error.status === 403 ? "permission_denied" : "not_found",
        message: r.error.message,
      };
    return { ok: true, data: undefined };
  }

  /* ── Mindmaps ────────────────────────────────────────────────────────────
   *
   * `/cowork/mindmaps`, through the engine.
   *
   * **The one place this deliberately differs from documents**, which write
   * browser-direct to Firestore. A document body is opaque text and cannot be
   * malformed; a card tree can be — two roots, a parent that is not in the
   * map, a cycle — and none of those render wrong, they fail to render at all,
   * for every member of that map. A check that lives in this file is one an
   * edited request skips, so it lives in `coworkMindmaps.js` instead.
   *
   * Every refusal below is the SERVER's sentence, passed through unchanged.
   * The route names the card that is wrong; replacing that with a generic
   * "could not save" here would throw away the only part a person can act on.
   */
  async listMindMaps(): Promise<MindMapSummary[]> {
    const token = await this.#token();
    const r = await legacyFetch<{ mindmaps?: unknown[] }>({
      path: "/cowork/mindmaps",
      token,
    });
    if (!r.ok) throw new Error(r.error.message);
    return (r.data.mindmaps ?? [])
      .map(readMindMapRecord)
      .filter((m): m is MindMapRecord => m !== null);
  }

  async getMindMap(id: string): Promise<MindMapDetail | null> {
    const token = await this.#token();
    const r = await legacyFetch<{ mindmap?: unknown; nodes?: unknown }>({
      path: `/cowork/mindmaps/${encodeURIComponent(id)}`,
      token,
    });
    /* A map you are not a member of answers 404, exactly as one that does not
       exist does — so "not found" is the whole answer here and there is
       nothing to distinguish. */
    if (!r.ok) {
      if (r.error.status === 404) return null;
      throw new Error(r.error.message);
    }
    const mindmap = readMindMapRecord(r.data.mindmap);
    if (!mindmap) return null;
    const nodes = readMindNodes(r.data.nodes);
    /* A tree that cannot be laid out is a failure, not an empty map. Returning
       `[]` would draw "this map has no cards" over a map that has plenty, and
       the next save would make that true. */
    if (nodes === null)
      throw new Error(
        "This mindmap's cards could not be read — the map is stored but its shape is not one that can be drawn.",
      );
    return { mindmap, nodes };
  }

  async createMindMap(input: {
    title: string;
    memberIds?: EmployeeId[];
    nodes?: MindNode[];
  }): Promise<ActionResult<MindMapRecord>> {
    const token = await this.#token();
    const r = await legacyFetch<{ mindmap?: unknown }>({
      path: "/cowork/mindmaps",
      method: "POST",
      token,
      body: {
        title: input.title,
        ...(input.memberIds ? { memberIds: input.memberIds.map(String) } : {}),
        ...(input.nodes ? { nodes: input.nodes } : {}),
      },
    });
    if (!r.ok)
      return {
        ok: false,
        code: r.error.status === 400 ? "validation_failed" : "offline",
        message: r.error.message,
      };
    const record = readMindMapRecord(r.data.mindmap);
    if (!record)
      return {
        ok: false,
        code: "offline",
        message: "The mindmap was created but not returned.",
      };
    return { ok: true, data: record };
  }

  async renameMindMap(
    id: string,
    title: string,
  ): Promise<ActionResult<MindMapRecord>> {
    const next = title.trim();
    if (!next)
      return {
        ok: false,
        code: "validation_failed",
        message: "Give the mindmap a name.",
        field: "title",
      };
    const token = await this.#token();
    const r = await legacyFetch<{ mindmap?: unknown }>({
      path: `/cowork/mindmaps/${encodeURIComponent(id)}`,
      method: "PATCH",
      token,
      body: { title: next },
    });
    if (!r.ok) return this.#mindMapRefusal(r.error);
    const record = readMindMapRecord(r.data.mindmap);
    if (!record)
      return {
        ok: false,
        code: "offline",
        message: "The mindmap was renamed but not returned.",
      };
    return { ok: true, data: record };
  }

  async deleteMindMap(id: string): Promise<ActionResult<void>> {
    const token = await this.#token();
    const r = await legacyFetch<unknown>({
      path: `/cowork/mindmaps/${encodeURIComponent(id)}`,
      method: "DELETE",
      token,
    });
    if (!r.ok) return this.#mindMapRefusal(r.error);
    return { ok: true, data: undefined };
  }

  async saveMindMapNodes(
    id: string,
    nodes: MindNode[],
  ): Promise<ActionResult<MindMapDetail>> {
    const token = await this.#token();
    const r = await legacyFetch<{ mindmap?: unknown; nodes?: unknown }>({
      path: `/cowork/mindmaps/${encodeURIComponent(id)}/nodes`,
      /* `legacyFetch` speaks GET/POST/PATCH/DELETE. The route accepts PUT
         because replacing the whole tree is what PUT means, and POST is
         reserved for creating a map — so the method is widened there rather
         than the shape bent here. */
      method: "PUT",
      token,
      body: { nodes },
    });
    if (!r.ok) return this.#mindMapRefusal(r.error);
    const mindmap = readMindMapRecord(r.data.mindmap);
    const saved = readMindNodes(r.data.nodes);
    if (!mindmap || saved === null)
      return {
        ok: false,
        code: "offline",
        message: "The mindmap was saved but not returned.",
      };
    return { ok: true, data: { mindmap, nodes: saved } };
  }

  async setMindMapMember(
    id: string,
    employeeId: EmployeeId,
    role: MindMapRole | null,
  ): Promise<ActionResult<MindMapRecord>> {
    const token = await this.#token();
    const r = await legacyFetch<{ mindmap?: unknown }>({
      path: `/cowork/mindmaps/${encodeURIComponent(id)}/members/${encodeURIComponent(String(employeeId))}`,
      method: "PUT",
      token,
      body: { role },
    });
    if (!r.ok) return this.#mindMapRefusal(r.error);
    const record = readMindMapRecord(r.data.mindmap);
    if (!record)
      return {
        ok: false,
        code: "offline",
        message: "The change was made but the mindmap was not returned.",
      };
    return { ok: true, data: record };
  }

  /**
   * An engine refusal, as an `ActionResult` the UI can branch on.
   *
   * The status decides the CODE and the engine decides the SENTENCE. That
   * split matters: the codes are what the product switches on, and the
   * messages are the only part that knows which card is malformed or which
   * owner cannot be removed.
   */
  #mindMapRefusal(error: {
    status: number;
    message: string;
  }): ActionResult<never> {
    if (error.status === 404)
      return { ok: false, code: "not_found", message: "Mindmap not found." };
    if (error.status === 403)
      return { ok: false, code: "permission_denied", message: error.message };
    if (error.status === 400)
      return { ok: false, code: "validation_failed", message: error.message };
    return { ok: false, code: "offline", message: error.message };
  }

  /* ── External sharing ────────────────────────────────────────────────────
   *
   * `grav-cms-backend`'s `/cowork/share/*` — a system parallel to, never an
   * extension of, `setDocumentMember`/`setMindMapMember`. See
   * `ExternalShareInvite`'s own doc comment in `../types.ts` for why: an
   * external invite must never become a `DocumentMember`/`MindMapMember`,
   * because those are tied to a real `cowork_employees` identity and this
   * deliberately is not. */

  /** Every invite for one target, newest first. An empty list on any failure
      — including "not an owner" — rather than throwing: this backs a share
      panel that already shows nothing extra when there is nothing to show. */
  async listExternalShares(
    kind: ExternalShareKind,
    id: string,
  ): Promise<ExternalShareInvite[]> {
    const token = await this.#token();
    const r = await legacyFetch<unknown[]>({
      path: `/cowork/share/${kind}/${encodeURIComponent(id)}/invites`,
      token,
      envelopeKey: "invites",
    });
    if (!r.ok) return [];
    return readExternalShareInvites(r.data);
  }

  async inviteExternal(
    kind: ExternalShareKind,
    id: string,
    email: string,
    role: ExternalShareRole,
  ): Promise<ActionResult<ExternalShareInvite>> {
    const token = await this.#token();
    const r = await legacyFetch<unknown>({
      path: `/cowork/share/${kind}/${encodeURIComponent(id)}/invite`,
      method: "POST",
      token,
      body: { email, role },
      envelopeKey: "invite",
    });
    if (!r.ok) return this.#externalShareRefusal(r.error);
    const invite = readExternalShareInvite(r.data);
    if (!invite)
      return {
        ok: false,
        code: "offline",
        message: "The invite was sent but not returned.",
      };
    return { ok: true, data: invite };
  }

  async revokeExternal(
    kind: ExternalShareKind,
    id: string,
    inviteId: string,
  ): Promise<ActionResult<void>> {
    const token = await this.#token();
    const r = await legacyFetch<unknown>({
      path: `/cowork/share/${kind}/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}/revoke`,
      method: "POST",
      token,
    });
    if (!r.ok) return this.#externalShareRefusal(r.error);
    return { ok: true, data: undefined };
  }

  /** Same shape as `#mindMapRefusal` — the status decides the code, the
      engine's own sentence is shown as-is. */
  #externalShareRefusal(error: { status: number; message: string }): ActionResult<never> {
    if (error.status === 404)
      return { ok: false, code: "not_found", message: error.message || "Not found." };
    if (error.status === 403)
      return { ok: false, code: "permission_denied", message: error.message };
    if (error.status === 400)
      return { ok: false, code: "validation_failed", message: error.message };
    return { ok: false, code: "offline", message: error.message };
  }

  /** Scheduled meetings. `GET /cowork/schedule-meet/list`. */
  async listMeetings(): Promise<Meeting[]> {
    const token = await this.#token();
    const result = await meetHttp.listMeets({ token });
    if (!result.ok) throw new Error(result.error.message);
    return toMeetings((result.data ?? []) as never[]);
  }

  /**
   * Meetings, beyond the list.
   *
   * **The page these serve was reading one method and throwing on nine.**
   * `listMeetings` above was the only one implemented here; every other meeting
   * call fell through to the `NotConnectedError` proxy, so the list rendered and
   * opening any single meeting failed. It worked against the mock, which
   * implements all ten — which is exactly how it survived to here.
   *
   * The read-back after a write is the same pattern the task writes use: the
   * engine answers a mutation with `{success:true}` rather than the document, so
   * the document is fetched again and mapped, and the caller gets a `Meeting`
   * that came from the store rather than one assembled from the request.
   */
  async #meetingWrite(
    meetingId: string,
    run: (token: string) => Promise<LegacyResult<unknown>>,
  ): Promise<ActionResult<Meeting>> {
    const token = await this.#token();
    const result = await run(token);
    if (!result.ok) {
      return {
        ok: false,
        code:
          result.error.kind === "permission"
            ? "permission_denied"
            : result.error.kind === "not_found"
              ? "not_found"
              : "validation_failed",
        message: result.error.message,
      };
    }
    const after = await this.getMeeting(meetingId);
    if (!after) {
      return {
        ok: false,
        code: "not_found",
        message: "The meeting was changed but could not be read back.",
      };
    }
    return { ok: true, data: after };
  }

  async getMeeting(id: string): Promise<Meeting | null> {
    const token = await this.#token();
    const result = await meetHttp.getMeet({ token, meetId: String(id) });
    /* A meeting that is not there is null, not an error — the detail page
       renders "Meeting not found" for it, and throwing would show a failure
       banner for the ordinary case of a stale link. */
    if (!result.ok) {
      if (result.error.kind === "not_found") return null;
      throw new Error(result.error.message);
    }
    return toMeeting((result.data ?? {}) as never);
  }

  /* ── A task's own meeting ────────────────────────────────────────────────
   *
   * Written browser-to-Firestore, like duty status and timers, rather than
   * through a route: the engine has no endpoint for a per-task room, and the
   * arithmetic that matters — what a session is worth and who it reaches — is
   * `settleSession`, which both this and the mock hand the same inputs.
   *
   * `cowork_task_meetings/{taskId}/sessions/{sessionId}`, beside every other
   * Cowork collection.
   */

  #taskMeetingSessions(taskId: string) {
    return ["cowork_task_meetings", taskId, "sessions"] as const;
  }

  async joinTaskMeeting(taskId: TaskId) {
    const me = String(this.#ctx.employeeId);
    try {
      const { doc: fsDoc, getDoc: fsGetDoc } = await import("firebase/firestore");
      const { legacyDb: fsDb } = await import("../../legacy/firebase.ts");

      /* ── Membership before anything else.
       *
       * A task room's name is derivable from the task id, so nothing about it
       * is secret; this is what stands between an authenticated employee and
       * every task conversation in the organisation. Checked before the token
       * is asked for, so a refusal costs one read and mints nothing. */
      const hostSnap = await fsGetDoc(
        fsDoc(fsDb(), "cowork_tasks", String(taskId)),
      );
      const host = hostSnap.exists()
        ? readTask({ ...hostSnap.data(), id: String(taskId) } as never)
        : null;
      if (!host) {
        return {
          ok: false as const,
          code: "not_found" as const,
          message: "That task could not be found.",
        };
      }
      const refusal = taskJoinRefusal(
        {
          createdById: host.createdById,
          /* Differs from the creator only on a SELF task, where it is the
             manager — the counterparty for the budget, the priority and the
             review, and so a party to the meeting. */
          assignedById: host.assignedById,
          assigneeIds: host.assigneeIds.map(String),
          pendingAssigneeIds: host.pendingAssigneeId
            ? [String(host.pendingAssigneeId)]
            : [],
          approverIds: [host.approverId, ...host.departmentApproverIds],
        },
        me,
      );
      if (refusal) {
        return {
          ok: false as const,
          code: "permission_denied" as const,
          message: refusal,
        };
      }

      /* ── The seat comes next, and attendance only after it is granted.
       *
       * Attendance is what moves deadlines. Writing "joined at 10:00" and then
       * failing to get a token leaves a span open on a room the person never
       * entered — and because a session stays open until somebody closes it,
       * that phantom span keeps widening. Order it the other way and a refused
       * join costs nothing: no row, no credit, no meeting that did not happen.
       *
       * The seat itself is the meeting stack's, unchanged. `POST` with the room
       * in the BODY is what the route declares; identity is the server's
       * business — it reads the principal from the cookie and ignores anything
       * the caller says about who it is. */
      const roomName = taskMeetingRoomName(String(taskId));
      const res = await fetch("/api/meetings/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomName }),
      });
      if (!res.ok) {
        /* The route's own words, not a flat replacement for them. "Meetings are
           not configured on this server" is a fixable sentence; "The meeting
           room could not be joined" is a dead end, and that is exactly what
           this returned while three separate things were wrong. */
        const said: unknown = await res.json().catch(() => null);
        const reason =
          typeof said === "object" && said !== null && "error" in said
            ? String((said as { error?: unknown }).error)
            : `The room refused the connection (${res.status}).`;
        return {
          ok: false as const,
          code: (res.status === 401 ? "permission_denied" : "conflict") as
            | "permission_denied"
            | "conflict",
          message: reason,
        };
      }
      const creds = (await res.json()) as { token: string; url: string };

      const { addDoc, collection, doc, getDocs, query, updateDoc, where, arrayUnion } =
        await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const db = legacyDb();
      const path = this.#taskMeetingSessions(String(taskId));

      /* Clock read here rather than at entry, so the recorded join is when the
         person actually got in — not when they pressed a button that then spent
         a round-trip being authorised. */
      const nowIso = new Date().toISOString();

      /* Re-enter the session already running rather than opening a second one:
         two rooms for one task would split the attendance and credit each half
         separately. */
      const open = await getDocs(
        query(collection(db, ...path), where("endedAt", "==", null)),
      );
      /**
       * **The NEWEST open session, not whichever Firestore returned first.**
       *
       * The query is unordered, so with more than one session open this picked
       * arbitrarily — while the panel, whose list is sorted newest-first, picked
       * the newest. Two people could then be in one video room (its name is
       * derived from the task id, so there is only ever one) and recorded
       * against two different sessions, each unable to see the other in the
       * attendance they were reading. Both sides choose the same session now.
       */
      const existing =
        [...open.docs]
          .sort((a, b) =>
            String(b.data()?.startedAt ?? "").localeCompare(
              String(a.data()?.startedAt ?? ""),
            ),
          )
          .at(0) ?? null;

      const attendance = {
        employeeId: me,
        joinedAt: nowIso,
        leftAt: null as string | null,
        /* The first beat. Without one, a row whose browser dies before the
           heartbeat starts would still have to lapse from `joinedAt` — which
           it does, but stamping it here means every row is read the same way
           rather than one path relying on a fallback. */
        lastSeenAt: nowIso,
      };

      let sessionId: string;
      if (existing) {
        sessionId = existing.id;
        /* A rejoin is a NEW span, never an edit of the old one —
           `creditableSecs` merges overlaps, so recording both is safe and
           losing one is not. */
        await updateDoc(doc(db, ...path, sessionId), {
          attendance: arrayUnion(attendance),
        });
      } else {
        const created = await addDoc(collection(db, ...path), {
          taskId: String(taskId),
          startedAt: nowIso,
          endedAt: null,
          creditedSecs: 0,
          attendance: [attendance],
          creditedTaskIds: [],
        });
        sessionId = created.id;
      }

      return { ok: true as const, data: { sessionId, roomName, ...creds } };
    } catch (error) {
      return {
        ok: false as const,
        code: "conflict" as const,
        message:
          error instanceof Error
            ? `The meeting could not be joined: ${error.message}`
            : "The meeting could not be joined.",
      };
    }
  }

  /**
   * **The beat that keeps an attendance row alive.**
   *
   * Called every twenty seconds by the panel while somebody is in the room.
   * Stops when their tab does — which is the point: no beat, and the row
   * lapses ninety seconds later, so a meeting settles even when the departure
   * write was lost. See `departureOf` in `lib/rules/meetings/meetingCredit.ts`.
   *
   * Failure is silent by design. A dropped beat is not worth an error on a
   * panel somebody is talking over, and four have to be missed before anything
   * changes.
   */
  async touchTaskMeeting(input: { taskId: TaskId; sessionId: string }) {
    const me = String(this.#ctx.employeeId);
    try {
      const { doc, getDoc, updateDoc } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const ref = doc(
        legacyDb(),
        ...this.#taskMeetingSessions(String(input.taskId)),
        input.sessionId,
      );
      const snap = await getDoc(ref);
      if (!snap.exists()) return { ok: true as const, data: undefined };
      const data = snap.data() as { attendance?: unknown; endedAt?: unknown };
      /* A closed session is not beaten back open. Whoever closed it settled the
         credit, and moving a row afterwards would claim time against a meeting
         that had finished. */
      if (data.endedAt != null) return { ok: true as const, data: undefined };

      const rows = Array.isArray(data.attendance) ? [...data.attendance] : [];
      const nowIso = new Date().toISOString();
      let touched = false;
      /* The LAST open row for this person, matching how a departure is written
         — a rejoin leaves earlier rows closed, and beating one of those would
         reopen a span that has already ended. */
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i] as { employeeId?: unknown; leftAt?: unknown };
        if (String(row.employeeId) === me && !row.leftAt) {
          rows[i] = { ...(row as object), lastSeenAt: nowIso };
          touched = true;
          break;
        }
      }
      if (touched) await updateDoc(ref, { attendance: rows });
      return { ok: true as const, data: undefined };
    } catch {
      return { ok: true as const, data: undefined };
    }
  }

  async leaveTaskMeeting(input: { taskId: TaskId; sessionId: string }) {
    const me = String(this.#ctx.employeeId);
    try {
      const { doc, getDoc, updateDoc } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const db = legacyDb();
      const ref = doc(
        db,
        ...this.#taskMeetingSessions(String(input.taskId)),
        input.sessionId,
      );
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return { ok: false as const, code: "not_found" as const, message: "That meeting could not be found." };
      }
      const data = snap.data() as { attendance?: unknown; endedAt?: unknown };
      const rows = Array.isArray(data.attendance) ? [...data.attendance] : [];
      /* The LAST open span for this person — a rejoin leaves earlier rows
         already closed, and rewriting one of those would erase a real span. */
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i] as { employeeId?: unknown; leftAt?: unknown };
        if (String(row.employeeId) === me && !row.leftAt) {
          rows[i] = { ...(row as object), leftAt: new Date().toISOString() };
          break;
        }
      }
      await updateDoc(ref, { attendance: rows });

      /**
       * **Leaving last CLOSES the meeting, so the credit does not wait for a
       * button nobody presses.**
       *
       * `endTaskMeeting` is the explicit close, and it only acts once the room
       * is empty. But the ordinary way out of a meeting is closing the tab, and
       * that fires `beforeunload` — which can record a departure and cannot
       * await a settlement. So everybody leaving by tab left the session open
       * for ever and nobody was credited anything.
       *
       * Recording the departure and finding the room empty IS the last-one-out
       * condition, so it settles here. Doing it through the same method rather
       * than beside it keeps one implementation of what a meeting is worth.
       */
      /* Not "has an open row" — "is still being beaten". A tab that died
         without its departure landing leaves an open row for ever, and that
         one row used to hold the meeting open indefinitely: never empty, never
         closed, never credited. See `departureOf`. */
      const stillInside = !roomIsEmpty(toAttendanceRows(rows), Date.now());
      if (!stillInside && data.endedAt == null) {
        await this.endTaskMeeting({
          taskId: input.taskId,
          sessionId: input.sessionId,
        });
      }
      return { ok: true as const, data: undefined };
    } catch (error) {
      return {
        ok: false as const,
        code: "conflict" as const,
        message: error instanceof Error ? error.message : "That could not be saved.",
      };
    }
  }

  async endTaskMeeting(input: { taskId: TaskId; sessionId: string }) {
    try {
      const { collection, doc, getDoc, getDocs, query, updateDoc, where } =
        await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const db = legacyDb();
      const ref = doc(
        db,
        ...this.#taskMeetingSessions(String(input.taskId)),
        input.sessionId,
      );
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return { ok: false as const, code: "not_found" as const, message: "That meeting could not be found." };
      }
      const session = snap.data() as Record<string, unknown>;

      /**
       * **A meeting closes when the LAST person leaves, not the first.**
       *
       * Every participant calls this on their way out, and it closed the session
       * outright — so a head of department who looked in for one minute and left
       * ended the meeting for everybody. The two people still talking had their
       * spans clamped to that instant: a ten-minute conversation settled as one
       * minute, and the live figure stopped counting while they were still in
       * the room. Reported exactly that way.
       *
       * Their leave is already recorded by `leaveTaskMeeting`, so nothing is
       * lost by returning here. Whoever is last out closes it, and by then every
       * span is complete.
       */
      if (session.endedAt == null) {
        const rows = Array.isArray(session.attendance) ? session.attendance : [];
        /* Same question, same answer as `leaveTaskMeeting` — a row still being
           beaten. Asked through `roomIsEmpty` so the two can never drift. */
        const stillInside = !roomIsEmpty(toAttendanceRows(rows), Date.now());
        if (stillInside) {
          return {
            ok: true as const,
            data: { creditedSecs: 0, creditedTaskIds: [] as string[] },
          };
        }
      }

      const hostTask = readTask({
        ...(await getDoc(doc(db, "cowork_tasks", String(input.taskId)))).data(),
        id: String(input.taskId),
      } as never);
      if (!hostTask) {
        return { ok: false as const, code: "not_found" as const, message: "That task could not be found." };
      }

      /**
       * Whose deadlines move: the RECEIVER of the work.
       *
       * **`pendingAssigneeId` FIRST**, and the engine resolves it the same way
       * in `department-tl-set-hours`. A gated task carries `assigneeIds: []`
       * until its approvals clear — the engine's own visibility rule, so the
       * work stays invisible to somebody who has not been given it yet — and
       * reading `assigneeIds[0]` alone therefore returned "" on exactly the
       * tasks a kickoff meeting is held about. The queue lookup was skipped,
       * the settlement was handed an empty task list, and an hour of
       * cross-department kickoff credited nobody anything at all.
       */
      const assigneeId = String(
        hostTask.pendingAssigneeId || hostTask.assigneeIds[0] || "",
      );

      /**
       * One person's live queue, shaped for the settlement.
       *
       * **Two queries, not one — and this is why cross-department meetings
       * credited nobody.** A task that crossed a department boundary carries
       * `assigneeIds: []` until its approval clears; the person it was handed
       * to sits in `pendingAssigneeId` alone. That is the engine's own
       * visibility rule, and it meant the one kind of task a cross-department
       * kickoff is held about was invisible to its own settlement: the meeting
       * computed its worth, found no task to put it on, and moved nothing.
       * Reported with a nine-minute meeting sitting above a budget that had not
       * changed.
       *
       * Firestore has no OR across fields, so it is two reads unioned here.
       */
      const queueOf = async (employeeId: string) => {
        if (!employeeId) return [];
        const [asAssignee, asPending] = await Promise.all([
          getDocs(
            query(
              collection(db, "cowork_tasks"),
              where("assigneeIds", "array-contains", employeeId),
            ),
          ),
          getDocs(
            query(
              collection(db, "cowork_tasks"),
              where("pendingAssigneeId", "==", employeeId),
            ),
          ),
        ]);
        const seen = new Set<string>();
        return [...asAssignee.docs, ...asPending.docs]
          .filter((d) => !seen.has(d.id) && seen.add(d.id))
          .map((d) => readTask({ ...d.data(), id: d.id } as never))
          .filter((t): t is NonNullable<typeof t> => t !== null && !t.isDeleted)
          .map((t) => ({
            taskId: t.id,
            status: settlementStatusOf(t),
            /* The person it was handed to counts as holding it. `creditTargets`
               asks whether the task is theirs, and on a gated task the answer
               lives in `pendingAssigneeId` rather than in an empty array. */
            assigneeIds: [
              ...t.assigneeIds.map(String),
              ...(t.pendingAssigneeId ? [String(t.pendingAssigneeId)] : []),
            ],
            totals: {
              firstStartedAtMs: t.meetingFirstStartedAtMs,
              lastEndedAtMs: t.meetingLastEndedAtMs,
              totalSecs: t.meetingTotalSecs ?? 0,
            },
            dueAtMs: t.dueAtMs,
            /* The agreed window, read through the shared resolver so the queue
               is laid out from the same seconds the Details panel shows. */
            windowSecs: resolveTimeBudget(t) || null,
            /* The queue position, from the SAME function the queue is sorted by
               — the settlement grows exactly one window and this is what picks
               it. A rank invented here would choose a different head than the
               chain actually works through, and the shift would land behind the
               task the person is on. */
            rank: resolveTaskPriority(t as never, employeeId),
          }));
      };

      const tasks = await queueOf(assigneeId);

      /**
       * **A meeting closes ONCE, and every later call settles against that
       * instant.**
       *
       * Everybody in the room calls this on their way out — a three-person
       * meeting is three calls — and reading `Date.now()` each time re-closed an
       * already-closed session at a later instant. Anybody still marked present
       * (`leftAt: null`) then had their span stretched to the new close, so the
       * same meeting was worth more every time somebody else left. A ten-minute
       * visitor came out with fifteen.
       */
      const rows = Array.isArray(session.attendance) ? session.attendance : [];
      /* And it closes AT THE MOMENT THE ROOM EMPTIED, not when somebody
         noticed. A session abandoned by a closed tab is discovered up to
         `PRESENCE_TIMEOUT_MS` later; closing at discovery would credit that
         gap as meeting time. `roomEmptiedAtMs` is the last instant anybody was
         known to be there — and because `presenceOf` clamps an open row to the
         close, the credit arithmetic then needs no special case at all. */
      const endedAtMs =
        readInstant(session.endedAt) ??
        roomEmptiedAtMs(toAttendanceRows(rows), Date.now()) ??
        Date.now();

      /* **The same composition the mock runs.** One decision, two persisters. */
      const meetingSession = {
        counterpartyId: String(hostTask.assignedById ?? hostTask.createdById ?? ""),
        startedAtMs: readInstant(session.startedAt) ?? endedAtMs,
        endedAtMs,
        attendance: rows.map((r) => {
          const row = r as Record<string, unknown>;
          return {
            employeeId: String(row.employeeId),
            joinedAtMs: readInstant(row.joinedAt) ?? endedAtMs,
            leftAtMs: readInstant(row.leftAt),
          };
        }),
      };
      const alreadyCredited = Array.isArray(session.creditedTaskIds)
        ? session.creditedTaskIds.map(String)
        : [];

      /**
       * Two rules, and the task decides which — OWNER DECISION.
       *
       * Work that crossed a department boundary settles on the shared-window
       * rule: the clock runs only while both sides are in the room, and every
       * person in that window is credited their own time against their own
       * queue. Everything else keeps the ordinary rule, where the receiver's
       * deadlines are the only ones that move.
       *
       * The branch is on the TASK rather than on who happens to be in the room,
       * so the same meeting cannot settle two different ways depending on who
       * joined it.
       */
      /* One queue read per person who EARNED something — not per attendee, so
         somebody who looked in after the window closed costs nothing. Both
         rules need this now: an ordinary meeting credits everybody in the room
         against their own queue, exactly as a cross-department one does, and
         only the window they are measured against differs. */
      /* **Both rules now measure the same window** — OWNER DECISION, 17 Aug
         2026. Cross-department used `creditsInWindow`, whose window is any two
         people, so a room holding Rishee and Rakesh credited time on a task
         Umung had not joined. Both branches are kept rather than collapsed:
         they take the window from their own named rule, so changing one back
         does not silently change the other. */
      const earners = hostTask.isCrossDepartment
        ? creditsIn(
            meetingSession,
            crossDeptWindow({ ...meetingSession, receiverId: assigneeId }),
          )
        : creditsIn(
            meetingSession,
            /* Both sides, so neither can mint time alone — see ordinaryWindow. */
            ordinaryWindow({ ...meetingSession, receiverId: assigneeId }),
          );

      const queues = new Map<string, Awaited<ReturnType<typeof queueOf>>>();
      for (const c of earners) {
        if (queues.has(c.employeeId)) continue;
        queues.set(
          c.employeeId,
          /* The receiver's queue is already in hand — it is the one read
             unconditionally above — so this does not fetch it twice. */
          c.employeeId === assigneeId ? tasks : await queueOf(c.employeeId),
        );
      }

      const settlement = hostTask.isCrossDepartment
        ? settleCrossDeptSession({
            session: { ...meetingSession, receiverId: assigneeId },
            onTaskId: String(input.taskId),
            tasksByEmployee: queues,
            alreadyCredited,
          })
        : settleSession({
            session: meetingSession,
            onTaskId: String(input.taskId),
            receiverId: assigneeId,
            tasksByEmployee: queues,
            alreadyCredited,
          });

      /**
       * **MERGED, never replaced.** This wrote only what the current call had
       * credited, so the second person to leave — whose call correctly credited
       * nothing, because the first had already done it — wiped the record back
       * to empty. The third person's call then found nothing marked and paid
       * the whole meeting a second time. With three people in a room the credit
       * landed roughly twice, which is how a fifteen-minute meeting moved a
       * deadline by three quarters of an hour.
       */
      /**
       * **Say why nothing moved, when nothing moves.**
       *
       * A settlement that computes a credit and applies it to no task is
       * indistinguishable, from the outside, from one that never ran: the
       * session records its minutes, the panel prints them, and no deadline
       * changes. That has now been reported twice and both times cost a round
       * of guessing, because the reason is never on screen and never in a log.
       *
       * One line, only in the case that is wrong, naming what the settlement
       * actually saw. Not an error — a meeting where nobody has live work is a
       * legitimate nothing.
       */
      /* Always, not only when nothing was credited. A settlement that produces
         updates can still move nothing anybody looks at — the budget write has
         now been aimed at the wrong field twice — and the only way to tell the
         two apart from outside is to print what was decided. */
      if (settlement.creditedSecs > 0) {
        console.warn(
          "[meeting] settled",
          JSON.stringify({
            onTask: String(input.taskId),
            secs: settlement.creditedSecs,
            applied: settlement.updates.map((u) => ({
              task: u.taskId,
              for: u.forEmployeeId,
              newWindowSecs: u.newWindowSecs,
              newDueAtMs: u.newDueAtMs,
            })),
            /* The queues the head was chosen from. Exactly one task per person
               grows a window — the lowest rank — so this is what says whether
               the task somebody is staring at was ever a candidate. */
            queues: [...queues].map(([who, q]) => ({
              who,
              tasks: q.map((t) => ({
                id: t.taskId,
                status: t.status,
                rank: t.rank,
                window: t.windowSecs,
                holders: t.assigneeIds,
              })),
            })),
          }),
        );
      }

      if (settlement.creditedSecs > 0 && settlement.updates.length === 0) {
        console.warn(
          "[meeting] credited nothing",
          JSON.stringify({
            taskId: String(input.taskId),
            crossDepartment: hostTask.isCrossDepartment,
            secs: settlement.creditedSecs,
            receiver: assigneeId,
            alreadyCredited,
            earners: earners.map((c) => ({
              who: c.employeeId,
              secs: c.secs,
              queue: (queues.get(c.employeeId) ?? []).map((t) => ({
                id: t.taskId,
                status: t.status,
                holders: t.assigneeIds,
                window: t.windowSecs,
              })),
            })),
          }),
        );
      }

      const creditedTaskIds = [
        ...new Set([...alreadyCredited, ...settlement.updates.map((u) => u.taskId)]),
      ];
      await updateDoc(ref, {
        endedAt: new Date(endedAtMs).toISOString(),
        creditedSecs: settlement.creditedSecs,
        creditedTaskIds,
      });

      for (const update of settlement.updates) {
        await updateDoc(doc(db, "cowork_tasks", update.taskId), {
          meetingFirstStartedAt:
            update.totals.firstStartedAtMs === null
              ? null
              : new Date(update.totals.firstStartedAtMs).toISOString(),
          meetingLastEndedAt:
            update.totals.lastEndedAtMs === null
              ? null
              : new Date(update.totals.lastEndedAtMs).toISOString(),
          meetingTotalSecs: update.totals.totalSecs,
          updatedAt: new Date(),
        }).catch((e: unknown) =>
          console.error(
            "[meeting] totals write failed",
            update.taskId,
            e instanceof Error ? e.message : e,
          ),
        );

        /* The deadline moves through the SAME collection an approved extension
           and a credited absence use, so one History tab answers "why is this
           due later" whatever moved it.
           **Either axis is enough to be worth writing.** This was gated on the
           DATE alone, and a task whose date is derived from the queue rather
           than stored reports `newDueAtMs: null` — so the grown window, the one
           value Expected completion is actually computed from, was thrown away
           on precisely the tasks people were meeting about. */
        if (update.newDueAtMs !== null || update.newWindowSecs !== null) {
          await this.#compensateOneDeadline({
            taskId: update.taskId,
            newDueAtMs: update.newDueAtMs,
            /* The WINDOW too, not only the date. The queue is laid out from
               windows, so a meeting that moved the date alone would never reach
               Expected completion — and this repository used to do exactly
               that while the mock did not. */
            newWindowSecs: update.newWindowSecs,
            reason: update.reason,
            byEmployeeId: update.forEmployeeId,
          }).catch((e: unknown) =>
            console.error(
              "[meeting] deadline shift failed",
              update.taskId,
              e instanceof Error ? e.message : e,
            ),
          );
        }
      }

      /* **Every open screen has just gone stale.** This moved deadlines and
         budgets on as many tasks as the person has running, and without this
         the Details panel keeps rendering the figures it fetched before the
         meeting — which reads as "the credit did not work" no matter how
         correctly it was written. Every other mutation in this file ends here;
         this one did not, and that alone made a working feature look broken. */
      notifyRepositoryChanged();

      return {
        ok: true as const,
        data: {
          creditedSecs: settlement.creditedSecs,
          creditedTaskIds: settlement.updates.map((u) => u.taskId),
        },
      };
    } catch (error) {
      return {
        ok: false as const,
        code: "conflict" as const,
        message:
          error instanceof Error
            ? `The meeting could not be closed: ${error.message}`
            : "The meeting could not be closed.",
      };
    }
  }

  async listTaskMeetingSessions(taskId: TaskId): Promise<TaskMeetingSession[]> {
    try {
      const { collection, getDocs } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const snap = await getDocs(
        collection(legacyDb(), ...this.#taskMeetingSessions(String(taskId))),
      );
      return snap.docs
        .map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            taskId,
            startedAt: String(raw.startedAt ?? ""),
            endedAt: raw.endedAt ? String(raw.endedAt) : null,
            creditedSecs:
              typeof raw.creditedSecs === "number" ? raw.creditedSecs : 0,
            attendance: (Array.isArray(raw.attendance) ? raw.attendance : []).map(
              (r) => {
                const row = r as Record<string, unknown>;
                return {
                  employeeId: String(row.employeeId),
                  joinedAt: String(row.joinedAt ?? ""),
                  leftAt: row.leftAt ? String(row.leftAt) : null,
                  /* Absent on rows written before beats existed. Null rather
                     than the join time, so `departureOf` applies its own
                     fallback in one place. */
                  lastSeenAt: row.lastSeenAt ? String(row.lastSeenAt) : null,
                };
              },
            ),
            creditedTaskIds: (Array.isArray(raw.creditedTaskIds)
              ? raw.creditedTaskIds
              : []
            ).map(String),
          } as TaskMeetingSession;
        })
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    } catch {
      /* An unreadable log must not blank the tab that shows it. */
      return [];
    }
  }

  async listMeetingsForTask(taskId: TaskId): Promise<Meeting[]> {
    const token = await this.#token();
    const result = await meetHttp.listMeetsForTask({
      token,
      taskId: String(taskId),
    });
    if (!result.ok) throw new Error(result.error.message);
    return toMeetings((result.data ?? []) as never[]);
  }

  /**
   * Participants, derived from the meeting document rather than fetched.
   *
   * The engine sends `participants` and `presence` on the meeting itself, so a
   * dedicated endpoint would be a second round trip for data already in hand —
   * and a second chance for the two to disagree.
   */
  async listMeetingParticipants(
    meetingId: string,
  ): Promise<MeetingParticipant[]> {
    const token = await this.#token();
    const result = await meetHttp.getMeet({ token, meetId: String(meetingId) });
    if (!result.ok) {
      if (result.error.kind === "not_found") return [];
      throw new Error(result.error.message);
    }
    return toMeetingParticipants((result.data ?? {}) as never);
  }

  /**
   * Every participant's recorded audio for one meeting.
   *
   * Read defensively field by field: these documents are written by the engine
   * over a long period and by two routes — a signed-in participant's finalize
   * and a guest's — so a record from an older build may be missing a name or a
   * size. A missing field is shown as unknown; it is never a reason to refuse
   * to list a file that exists.
   */
  async listMeetingRecordings(meetingId: string): Promise<MeetingRecording[]> {
    const token = await this.#token();
    const result = await listMeetingRecordingsHttp({
      token,
      meetId: String(meetingId),
    });
    if (!result.ok) {
      /* A meeting nobody recorded, or an engine without the route: an empty
         list, not an error over a page whose meeting is perfectly fine. */
      if (result.error.kind === "not_found") return [];
      throw new Error(result.error.message);
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    const text = (v: unknown): string => (typeof v === "string" ? v : "");
    const num = (v: unknown): number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;

    return rows
      .map((raw) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        const id = text(r.id);
        if (!id) return null;
        return {
          id,
          meetingId: String(meetingId),
          employeeId: text(r.employeeId) as EmployeeId,
          /* The engine already falls back to "Unknown" when it writes these;
             this covers a document written before it did. */
          employeeName: text(r.employeeName) || text(r.firstName) || "Unknown",
          fileName: text(r.fileName),
          sizeBytes: num(r.fileSize),
          mimeType: text(r.mimeType),
          viewUrl: text(r.driveViewUrl),
          downloadUrl: text(r.driveDownloadUrl) || text(r.driveViewUrl),
          /* The engine writes a Firestore server timestamp, which arrives as
             an object rather than a string.  already knows every
             shape this legacy store uses. */
          uploadedAt: (() => {
            const ms = readInstant(r.uploadedAt);
            return ms === null ? "" : new Date(ms).toISOString();
          })(),
          isRejoin: r.isRejoin === true,
          isBackup: r.isBackup === true,
          recordedByName:
            typeof r.recordedByName === "string" ? r.recordedByName : "",
        } satisfies MeetingRecording;
      })
      .filter((r): r is MeetingRecording => r !== null)
      /* Newest first: a rejoin's second segment is the one somebody is looking
         for when they come to check whether the last stretch was captured. */
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async listMeetingEvents(meetingId: string): Promise<MeetingEvent[]> {
    const token = await this.#token();
    const result = await meetHttp.listMeetEvents({
      token,
      meetId: String(meetingId),
    });
    if (!result.ok) {
      /* An audit trail that cannot be read is an empty trail, not a broken
         page: the meeting itself is fine and the events are supporting detail.
         A meeting created before the log existed genuinely has none. */
      if (result.error.kind === "not_found") return [];
      throw new Error(result.error.message);
    }
    return toMeetingEvents(String(meetingId), (result.data ?? []) as never[]);
  }

  async setMeetingStatus(
    meetingId: string,
    next: "waiting" | "live" | "completed" | "cancelled" | "archived",
  ): Promise<ActionResult<Meeting>> {
    return this.#meetingWrite(meetingId, (token) =>
      meetHttp.setMeetStatus({ token, meetId: String(meetingId), status: next }),
    );
  }

  async setMeetingParticipants(
    meetingId: string,
    participantIds: EmployeeId[],
  ): Promise<ActionResult<Meeting>> {
    return this.#meetingWrite(meetingId, (token) =>
      meetHttp.setMeetParticipants({
        token,
        meetId: String(meetingId),
        participants: participantIds.map(String),
      }),
    );
  }

  async openMeetingRoom(meetingId: string): Promise<ActionResult<Meeting>> {
    return this.#meetingWrite(meetingId, (token) =>
      meetHttp.startMeetRoom({ token, meetId: String(meetingId) }),
    );
  }

  /**
   * Attendance, and only attendance.
   *
   * Returns the caller's own participant row read back from the store, so a
   * `joinedAt` that the engine stamped is what the caller sees rather than the
   * time the browser happened to send.
   */
  async recordMeetingPresence(
    meetingId: string,
    present: boolean,
  ): Promise<ActionResult<MeetingParticipant>> {
    const token = await this.#token();
    const result = await meetHttp.recordMeetPresence({
      token,
      meetId: String(meetingId),
      joined: present,
    });
    if (!result.ok) {
      return {
        ok: false,
        code:
          result.error.kind === "permission"
            ? "permission_denied"
            : result.error.kind === "not_found"
              ? "not_found"
              : "validation_failed",
        message: result.error.message,
      };
    }
    const me = await this.getCurrentEmployee();
    const rows = await this.listMeetingParticipants(meetingId);
    const mine = me ? rows.find((r) => r.employeeId === me.id) : undefined;
    if (!mine) {
      return {
        ok: false,
        code: "not_found",
        message: "Your attendance was recorded but could not be read back.",
      };
    }
    return { ok: true, data: mine };
  }

  async createMeeting(
    input: CreateMeetingInput,
  ): Promise<ActionResult<Meeting>> {
    const title = input.title?.trim();
    if (!title) {
      return {
        ok: false,
        code: "validation_failed",
        message: "Give the meeting a title.",
        field: "title",
      };
    }
    if (!input.startsAt) {
      return {
        ok: false,
        code: "validation_failed",
        message: "Say when the meeting starts.",
        field: "startsAt",
      };
    }
    /* Checked here rather than left to the engine, which stores `endsAt`
       without reading it: a meeting that ends before it starts would be
       accepted and then render a negative duration. */
    if (input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
      return {
        ok: false,
        code: "validation_failed",
        message: "The meeting has to end after it starts.",
        field: "endsAt",
      };
    }

    const token = await this.#token();
    const result = await meetHttp.createMeet({
      token,
      title,
      description: input.description?.trim() || null,
      participants: (input.participantIds ?? []).map(String),
      dateTime: input.startsAt,
      endsAt: input.endsAt || null,
      agenda: (input.agenda ?? []).map((a) => a.trim()).filter(Boolean),
      taskId: input.taskId ? String(input.taskId) : null,
    });
    if (!result.ok) {
      return {
        ok: false,
        code:
          result.error.kind === "permission"
            ? "permission_denied"
            : "validation_failed",
        message: result.error.message,
      };
    }
    const created = toMeeting((result.data ?? {}) as never);
    if (!created) {
      return {
        ok: false,
        code: "validation_failed",
        message: "The meeting was created but the engine returned no record.",
      };
    }
    return { ok: true, data: created };
  }

  /**
   * The per-employee workload table. `GET /cowork/workload/summary`.
   *
   * **Not `getWorkloadFlow`.** That returns a weekly series of work arriving
   * against work leaving, which legacy does not report and cannot be derived
   * from these rows. Exposed under its own name so the difference stays
   * visible rather than being smoothed over by a lossy mapping.
   *
   * Gated to CEO or TL; an employee account is refused by the engine.
   */
  async listWorkloadRows(): Promise<LegacyWorkloadRow[]> {
    const token = await this.#token();
    const result = await legacyFetch<unknown[]>({
      path: "/cowork/workload/summary",
      envelopeKey: "summary",
      token,
    });
    if (!result.ok) throw new Error(result.error.message);
    return toWorkloadRows((result.data ?? []) as never[]);
  }

  /* ── Not connected ──────────────────────────────────────────────────────── */

  /**
   * Everything else.
   *
   * Reads answer empty so a card renders its own empty state; writes throw so a
   * screen cannot appear to succeed at something that never reached the engine.
   * Both are deliberate, and neither is mock data.
   */
  /**
   * Projects — the tasks that have been broken down.
   *
   * **This returned an empty page, so the Projects tab was blank forever.** The
   * stub was honest at the time: a `Project` in `lib/domain/projects.ts` is a
   * managed initiative with members, milestones and its own status, and the
   * Cowork engine has no collection for one. Nothing could be listed because
   * nothing was stored.
   *
   * What the stub missed is that the product already has projects and stores
   * them in `cowork_tasks`. Breaking a task down converts it into a container:
   * it stops holding a timer, a deadline, a submission and a review, and starts
   * holding a title, a brief, completion requirements and the work items that
   * answer them. That is a project in everything but the name, and the task
   * detail has always called it one — `ProjectPanel` renders the heading
   * "Project" the moment `isProject` turns true.
   *
   * So a project here is DERIVED, not stored, and the consequences are worth
   * being explicit about:
   *
   *  · Nothing has to be created. A project appears the moment somebody breaks
   *    work out, and disappears if the last subtask is deleted — which is the
   *    behaviour people expect from a container and the reason the old app's
   *    folders needed no separate lifecycle.
   *  · Milestones are empty and members are derived from who holds the
   *    subtasks. Neither has anywhere to be stored, and inventing a second
   *    store for them would put project membership out of step with the
   *    assignees that actually determine it.
   *  · `createProject` and `updateProject` stay unimplemented. There is nothing
   *    to write to, and a form that appeared to save would be the worse
   *    failure.
   *
   * Progress comes from `computeProgress`, the same function the mock uses, so
   * the health band and the percentage cannot drift between the two.
   */
  async listProjects(q: ProjectQuery): Promise<Page<ProjectView>> {
    /* Scope "all", because a project is a thing you look at rather than a thing
       assigned to you: a manager's own queue would exclude the very containers
       whose subtasks they handed out. `includeSubtasks` is what makes the
       children available to group under them — see `TaskQuery`. */
    /* `includeFolders`, because containers are the whole point of this list —
       every other caller gets tasks only, so an assigned project cannot turn up
       in somebody's work queue. */
    const page = await this.listTasks({
      scope: "all",
      includeSubtasks: true,
      includeFolders: true,
    });
    const views = page.items;

    const childrenOf = new Map<string, TaskView[]>();
    for (const v of views) {
      const parentId = v.task.parentTaskId ? String(v.task.parentTaskId) : null;
      if (!parentId) continue;
      const bucket = childrenOf.get(parentId);
      if (bucket) bucket.push(v);
      else childrenOf.set(parentId, [v]);
    }

    /**
     * **Folders, and only folders.** OWNER DECISION, 18 Aug 2026.
     *
     * This used to show any parent task that happened to have children, so
     * breaking one task into two silently produced a "project" nobody asked
     * for — and that container was a real task, with a deadline and a timer
     * running on it, which is the opposite of a folder.
     *
     * A folder made on purpose and a task that grew subtasks are structurally
     * identical, so `isFolder` is the only thing that can tell them apart.
     *
     * A folder with nothing in it yet still belongs here — somebody made it
     * deliberately, and hiding it until it has tasks would mean creating one
     * appeared to do nothing.
     */
    let projects = views
      .filter((v) => !v.task.parentTaskId && v.task.isFolder === true)
      .map((v) => this.#projectFromContainer(v, childrenOf.get(v.task.id) ?? []));

    if (q.status?.length) {
      const wanted = new Set(q.status);
      projects = projects.filter((p) => wanted.has(p.project.status));
    }
    if (q.ownerId) {
      const wanted = String(q.ownerId);
      projects = projects.filter((p) => p.project.ownerId === wanted);
    }
    if (q.memberId) {
      const wanted = String(q.memberId);
      projects = projects.filter((p) =>
        p.members.some((m) => m.employeeId === wanted),
      );
    }
    if (q.search) {
      const needle = q.search.toLowerCase();
      projects = projects.filter(
        (p) =>
          p.project.name.toLowerCase().includes(needle) ||
          p.project.reference.toLowerCase().includes(needle),
      );
    }

    projects.sort((a, b) => {
      switch (q.sort) {
        case "progress":
          return b.progress.progressPercent - a.progress.progressPercent;
        case "target":
          /* Undated last rather than first — a project with no target date is
             not the most urgent one. */
          return (a.project.targetDate ?? "9999").localeCompare(
            b.project.targetDate ?? "9999",
          );
        case "health": {
          const order: Record<string, number> = {
            off_track: 0,
            at_risk: 1,
            unknown: 2,
            on_track: 3,
          };
          return order[a.progress.health] - order[b.progress.health];
        }
        default:
          return a.project.name.localeCompare(b.project.name);
      }
    });

    const total = projects.length;
    return {
      items: projects.slice(0, q.limit ?? total),
      nextCursor: null,
      total,
    };
  }

  /**
   * One project, by the id of the task it is.
   *
   * Reads the container and its children directly rather than filtering the
   * list — a project page should not cost a whole-organisation task read.
   */
  async getProject(id: ProjectId): Promise<ProjectView | null> {
    const taskId = String(id);
    const container = await this.#readTaskView(taskId);
    if (!container || container.task.parentTaskId) return null;
    /* A folder is a project the moment it exists. This used to require
       children, so a project you had just made said "Project not found" — the
       one page you needed in order to put tasks in it. */
    if (!container.task.isFolder) return null;
    const children = await this.getSubtasks(taskId);
    return this.#projectFromContainer(container, children);
  }

  /**
   * A broken-down task, as a project.
   *
   * Everything is read off the task and its children; nothing is invented and
   * nothing is stored. Where the domain requires a field the engine has no
   * answer for — milestones, tags, project priority — it is empty rather than
   * guessed, so a reader is never shown a value nobody set.
   */
  #projectFromContainer(
    container: TaskView,
    children: TaskView[],
  ): ProjectView {
    const t = container.task;
    const live = children.filter((c) => c.task.status !== "cancelled");

    /* The task's own lifecycle IS the project's. A container completes when its
       requirements are satisfied, which happens when its subtasks complete, so
       there is no second status to keep in step. */
    const status: ProjectStatus =
      t.status === "completed"
        ? "completed"
        : t.status === "cancelled" || t.status === "assignment_rejected"
          ? "archived"
          : "active";

    /**
     * The project's OWN deadline where one was set, and the derived one where
     * it was not.
     *
     * A container used to have no date of its own, so the only honest answer
     * was the latest commitment its children were held to. A project may now
     * be given one outright, and when it has been it is the answer — a date
     * somebody typed is a promise, while the derived one is only an
     * observation about what is currently inside.
     *
     * **The fallback is unchanged and load-bearing.** Every project created
     * before this, and every one created without filling the field in, keeps
     * exactly the behaviour it had. That is what makes this additive.
     */
    const derivedTargetDate =
      live
        .map((c) => c.task.deadline.officialDueAt ?? c.task.deadline.dueAt)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(-1) ?? null;
    const targetDate =
      t.deadline.officialDueAt ?? t.deadline.dueAt ?? derivedTargetDate;

    const project: Project = {
      organisationId: LEGACY_ORGANISATION_ID,
      id: t.id,
      reference: t.reference,
      name: t.title,
      description: t.description || null,
      /**
       * Whoever the project was ASSIGNED to, falling back to whoever made it.
       *
       * This is what puts a project under somebody's name: `listProjects`
       * already filters on `ownerId`, so assigning one is the whole of "it
       * appears in their projects" — no second list and no membership record.
       *
       * The fallback is the previous behaviour verbatim, so an unassigned
       * project still belongs to its creator and nothing that exists moves.
       */
      ownerId: (container.assignees[0]?.id ?? t.createdById) as EmployeeId,
      status,
      startDate: t.createdAt,
      targetDate,
      completedAt: status === "completed" ? t.updatedAt : null,
      tags: [],
      priority: null,
      isRestricted: false,
      createdById: t.createdById,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      archivedAt: status === "archived" ? t.updatedAt : null,
    };

    /* Whoever holds a subtask is a member, and the person who broke the work
       out owns it. Derived every read rather than stored, so somebody
       reassigning a subtask cannot leave a stale member behind. */
    const seen = new Set<string>();
    const members: ProjectView["members"] = [];
    for (const child of children) {
      for (const employee of child.assignees) {
        if (seen.has(employee.id)) continue;
        seen.add(employee.id);
        members.push({
          id: `${t.id}#member-${employee.id}`,
          projectId: t.id,
          employeeId: employee.id,
          role: employee.id === t.createdById ? "owner" : "member",
          addedAt: child.task.createdAt,
          addedById: t.createdById,
          employee,
        });
      }
    }

    return {
      project,
      /* `ProjectView.owner` is not nullable, and a task whose creator has left
         the directory still has to render. The stand-in carries the id as the
         name, which is what `employees.ts` does everywhere else a person cannot
         be resolved — a visible id beats a blank card. */
      owner: container.owner ?? unknownEmployee(t.createdById),
      members,
      progress: computeProgress(
        project,
        live.map((c) => c.task),
        [],
        [],
        new Date(),
      ),
      milestones: [],
      taskLinks: children.map((c) => ({
        id: `${t.id}#link-${c.task.id}`,
        projectId: t.id,
        taskId: c.task.id,
        linkedAt: c.task.createdAt,
        linkedById: t.createdById,
        milestoneId: null,
      })),
      /**
       * The part of the contract nobody picked up.
       *
       * Read off `container.completion`, which already resolved each
       * requirement against the live children — so this agrees with the
       * Completion requirements panel by construction rather than by a second
       * calculation that could drift from it.
       *
       * A gap here is invisible in every other figure on the card: the missing
       * work has no task, so it is in no count and no percentage. Completion
       * can read 100% with a requirement still nobody's.
       */
      /**
       * **Computed from the CHILDREN, not from `container.completion`.**
       *
       * That was the bug: a list row's completion state is built from the task
       * document alone — a list maps each row independently and no row knows
       * its own children — so every requirement came back with zero claimants
       * and the card reported ALL of them as unclaimed. T047 showed "6
       * requirements have no subtask yet" while its subtask was claiming three
       * of them, and the three it named first were exactly the claimed ones.
       *
       * `children` is already in hand here and is the whole point of this
       * function, so the state is derived once against the real subtasks. That
       * also makes this card agree with the task page by construction, since
       * both now answer from `completionState` over the same children.
       */
      ...(() => {
        const coverage = requirementCoverage(
          completionState(
            container.task,
            live.map((c) => c.task),
          ).requirements,
        );
        return {
          unassignedRequirements: coverage.pending,
          requirementsAssigned: coverage.assigned.length,
          requirementsTotal: coverage.total,
        };
      })(),
    };
  }

  /**
   * Project membership is not editable, because it is not stored.
   *
   * A project's tasks ARE its subtasks — `#projectFromContainer` derives the
   * links from them every read. So there is no link table to add a row to, and
   * "connect this existing task" has no meaning: a task belongs to a project by
   * being broken out of it, and leaves by being deleted.
   *
   * These refuse rather than being absent. An unimplemented method throws
   * `NotConnectedError`, which the screen renders as a generic failure the
   * reader can only read as a bug; a refusal can say what to do instead. Same
   * treatment, and the same reasoning, as `setRequirementSatisfied`.
   */
  async linkTask(): Promise<ActionResult<never>> {
    return {
      ok: false,
      code: "invalid_state",
      message:
        "A project's tasks are its subtasks, so a task cannot be connected to one. Open the project and use Add a subtask to break out more work.",
    } as unknown as ActionResult<never>;
  }

  async unlinkTask(): Promise<ActionResult<never>> {
    return {
      ok: false,
      code: "invalid_state",
      message:
        "A project's tasks are its subtasks, so they cannot be disconnected. Cancel or delete the subtask itself to take it out of the project.",
    } as unknown as ActionResult<never>;
  }

  /**
   * A project's own fields are the task's, so they are edited on the task.
   *
   * Its name is the task title, its description the brief, its dates and status
   * derived. Accepting a patch here would write to a project record that does
   * not exist, and the change would vanish on the next read.
   */
  async updateProject(): Promise<ActionResult<never>> {
    return {
      ok: false,
      code: "invalid_state",
      message:
        "A project is a task that has been broken down, so its name, description and dates are the task's. Edit the task itself — the project follows it.",
    } as unknown as ActionResult<never>;
  }

  /**
   * Make a project.
   *
   * **A folder, which the engine has always had and this client never used.**
   * OWNER DECISION, 18 Aug 2026: a project is a container you make on purpose,
   * carrying a name and a description and nothing else — no deadline, no
   * timer, no priority, no assignee. Tasks are created inside it afterwards and
   * each one is an ordinary task in every respect.
   *
   * That is exactly `isFolder` on `task/create`: the route skips its own
   * "assigneeIds required" check for a folder, never gives it a due date, and
   * skips the cross-department gate. So this is not a new kind of record — it
   * is the kind the engine already had, finally reachable.
   *
   * Everything else on `CreateProjectInput` is ignored rather than half-stored:
   * a project has no dates of its own (its date is the latest of its tasks'),
   * and its members are whoever holds those tasks. Writing those into fields
   * nothing reads would be a lie the next reader has to discover.
   */
  async createProject(input: CreateProjectInput): Promise<ActionResult<Project>> {
    const name = String(input?.name ?? "").trim();
    if (!name) {
      return {
        ok: false,
        code: "validation_failed",
        message: "Name the project.",
        field: "name",
      } as unknown as ActionResult<Project>;
    }
    const description = String(input?.description ?? "").trim();

    const token = await this.#token();
    if (!token) {
      return {
        ok: false,
        code: "unauthenticated",
        message: "Sign in again to create a project.",
      } as unknown as ActionResult<Project>;
    }

    /**
     * A project may now carry a deadline and an owner. Both optional.
     *
     * This reverses part of the 18 Aug 2026 decision that a project is a name
     * and a description and nothing else — OWNER DECISION, later. What has NOT
     * changed is that both are optional and that omitting them leaves the old
     * behaviour exactly intact: no deadline means the project is still judged
     * on the latest commitment its children carry, and no owner still means the
     * creator owns it. Nothing that already exists moves.
     *
     * The engine stores both on a folder without any special casing —
     * `taskForward.js:389` writes `fixedDeadline` whatever `isFolder` says, and
     * `:151` requires `assigneeIds` only for a NON-folder. So this is the
     * ordinary create path with two fields filled in, not a new one.
     *
     * `hasTimer: false` is what makes the deadline stick: `createTaskRequest`
     * nulls `fixedDeadline` when a task is on a timer, because a timer derives
     * its own date. A folder has no timer, so the typed date survives.
     */
    const deadline = input?.targetDate ? String(input.targetDate) : null;
    const owner = input?.ownerId ? String(input.ownerId) : null;

    const r = await createTaskRequest({
      token,
      body: {
        title: name,
        description,
        isFolder: true,
        /* Empty is still allowed and still the default — the route permits it
           for a folder, and an unassigned project belongs to its creator. */
        assigneeIds: owner ? [owner] : [],
        hasTimer: false,
        fixedDeadline: deadline,
      },
    });
    if (!r.ok) {
      return {
        ok: false,
        code: "request_failed",
        message: r.error.message,
      } as unknown as ActionResult<Project>;
    }

    /**
     * Built from what was sent rather than re-read.
     *
     * The engine answers a create with an id, and the caller wants somewhere
     * to navigate. A second round trip to fetch the record we just wrote would
     * buy nothing: every field below is either what was sent or fixed by what a
     * folder IS — no dates, no priority, no tags — and the project page
     * refetches from the engine anyway.
     */
    const id = String(r.data?.taskId ?? "") as ProjectId;
    const now = new Date().toISOString();
    return {
      ok: true,
      data: {
        organisationId: LEGACY_ORGANISATION_ID,
        id,
        reference: id,
        name,
        description: description || null,
        ownerId: "" as EmployeeId,
        status: "active" as ProjectStatus,
        startDate: now,
        /* No tasks yet, so no deadline — the empty case the owner named. */
        targetDate: null,
        completedAt: null,
        tags: [],
        priority: null,
        isRestricted: false,
        createdById: "" as EmployeeId,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      },
    } as unknown as ActionResult<Project>;
  }

  async listReviewQueue() { return []; }
  /* ── Priority ───────────────────────────────────────────────────────────
   *
   * **Firestore, and legacy leaves us no choice.** There is no priority route
   * anywhere in `taskForward.js` — `PERMISSIONS_AND_ROLES_SPEC.md` §2 records it as
   * "**none — client-side Firestore write**", and lists it as defect P6 for
   * exactly that reason. The old app writes `cowork_tasks/{taskId}` straight
   * from the browser in `page.js:1767-1812`.
   *
   * So this writes the same three fields, with legacy's own arithmetic:
   *
   *   priority                        clamped to 1..10
   *   assigneePriorities.{employeeId} per-person, DOT NOTATION
   *   updatedAt                       new Date()
   *
   * The dot notation is load-bearing and is why this uses `updateDoc` rather
   * than a merged `setDoc`: `assigneePriorities` is a map keyed by employee,
   * and writing the whole object would erase every other assignee's rank. The
   * old app's comment says so in as many words — "updates only this key, leaves
   * other employees' priorities untouched".
   */

  /**
   * One employee's ACTIVE tasks, in the order they currently display.
   *
   * Queried by assignee rather than taken from the viewer's list, because the
   * person whose queue is being reordered is usually not the person doing the
   * reordering — a manager sets a report's priority, and the viewer-scoped
   * queries would return the manager's own tasks.
   *
   * Returns ACTIVE tasks only. A closed task is deliberately absent rather
   * than appended at the end: appending would hand it a live position, which
   * is the exact claim the "was P1" treatment exists to avoid.
   */
  /**
   * Seconds already worked, per task, for one person.
   *
   * **One read.** Sessions live at
   * `cowork_task_timers/{employeeId}/sessions/{taskId}`, so the whole queue's
   * logged time is a single subcollection fetch rather than one per task.
   *
   * A RUNNING session counts its live elapsed time too. Somebody working right
   * now is burning down the remainder as they go, and a prediction that only
   * moved when they paused would sit still for hours while the work happened.
   */
  async #loggedSecsByTask(employeeId: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const { collection, getDocs } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const snap = await getDocs(
        collection(legacyDb(), "cowork_task_timers", employeeId, "sessions"),
      );
      const now = Date.now();
      for (const d of snap.docs) {
        const data = d.data() as {
          totalSeconds?: unknown;
          isActive?: unknown;
          lastStartTime?: unknown;
        };
        let secs = Number(data.totalSeconds);
        secs = Number.isFinite(secs) && secs > 0 ? secs : 0;
        if (data.isActive === true && typeof data.lastStartTime === "number") {
          /* Floored at zero: a clock skew that put the start in the future
             would otherwise SUBTRACT from what the person has done. */
          secs += Math.max(0, Math.floor((now - data.lastStartTime) / 1000));
        }
        out.set(d.id, secs);
      }
    } catch {
      /* No timer data means full budgets are scheduled — the old behaviour,
         pessimistic rather than wrong in kind. Never a reason to lose the
         queue. */
    }
    return out;
  }

  /**
   * When each task in an ordered queue really lands.
   *
   * **The operational rule, in one place.** Each task starts where the one
   * above it finished, and its own accepted budget is walked through the
   * office calendar — nights, weekends, holidays, that person's leave, breaks.
   * The anchor is now; nothing here reads a stored deadline, a creation time
   * or an approval time.
   *
   * Shared by the list and the task page, because a person's queue must not
   * produce one set of dates on their task list and another on the task
   * itself. Returns an empty map on any failure: the caller then shows the
   * committed date alone, which is honest, rather than a guessed one.
   */
  async #chainQueue(
    employeeId: string,
    order: string[],
    tasks: { id: string }[],
  ): Promise<Map<string, string>> {
    const dueDates = new Map<string, string>();
    if (order.length === 0) return dueDates;
    try {
      const { chainDeadlines } = await import(
        "../../rules/tasks/priorityDeadline.ts"
      );
      const { addWorkingSecs } = await import(
        "../../legacy-ui/officeDueDate.js"
      );
      const nowMs = Date.now();
      const from = new Date(nowMs).toISOString().slice(0, 10);
      const to = new Date(nowMs + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const [policy, blockedDates, logged] = await Promise.all([
        this.getOfficePolicy(),
        this.listBlockedDates(employeeId, from, to).catch(() => []),
        /* What is already done. Still read, and still passed to the chain — it
           is `loggedSecs` on each queue entry — but with `budget: "full"` below
           the chain no longer subtracts it from the figure it lays out. The
           value remains part of the queue shape and other readers of it. Work
           done at 04:53 counts in full; the office calendar governs only when the
           remainder can happen. */
        this.#loggedSecsByTask(employeeId),
        /* Presence is no longer read here. The projection is anchored at the
           day's opening and lays out the FULL budget, so it holds still whether
           or not the person is online — which is what freezing against the duty
           document was reaching for, and could not achieve while the figure it
           anchored was shrinking. See the anchor below. */
      ]);
      const blocked = new Set(blockedDates.map((b) => b.date));
      const byId = new Map(tasks.map((t) => [t.id, t as never]));

      /**
       * **The day's opening. Fixed, and not a function of presence.**
       *
       * This was `queueAnchorMs(duty, nowMs)` — the online-session start while
       * available, `now` otherwise. Paired with the `"remaining"` budget below
       * it produced a date that ran BACKWARDS: the anchor stood still while
       * `budget − logged` shrank, so every minute worked pulled the completion
       * a minute earlier. Followed far enough, a task worked continuously
       * predicted its own completion at the moment the person started.
       *
       * The cause was two definitions of "working" in one formula — the anchor
       * treated being ONLINE as work, the remainder treated only TIMER time as
       * work, and the same hour was counted twice. `chainDeadlines` already
       * documents the intended pairing: a fixed anchor with the FULL budget,
       * "decided once and then holds still". Only half of it was ever wired.
       *
       * `officeOpenMsFor` is that fixed point, and the rule it implements is
       * already tested in `anchorStability.test.ts` — "the anchor is always the
       * day's opening, whatever the leader did". Each task's `createdAtMs`
       * below moves it later where the work arrived mid-day, which is the "or
       * when the task was handed to you if that is later" half of the rule.
       *
       * What this leaves, and what the owner asked for: working moves the date
       * nothing, being online and idle moves it nothing, and an absence moves
       * it by exactly what was credited back to the budget — once, not twice.
       */
      const anchorMs = officeOpenMsFor(policy.schedule, nowMs);

      const chained = chainDeadlines({
        queue: order
          .map((id) => byId.get(id))
          .filter((t): t is NonNullable<typeof t> => t !== undefined)
          .map((t: never) => {
            const x = t as unknown as {
              id: string;
              assigneeIds: string[];
              assigneePriorities: Record<string, number>;
              priority: number | null;
              agreedWindowSecs: number | null;
              senderWindowSecs: number | null;
              createdAtMs: number | null;
              clockStartsAtMs: number | null;
            };
            return {
              taskId: x.id,
              assigneeIds: x.assigneeIds,
              assigneePriorities: x.assigneePriorities,
              priority: x.priority ?? undefined,
              /* The shared resolver, so the chain lays out exactly the
                 seconds the Details panel shows. */
              senderTimerWindowSecs: resolveTimeBudget(x),
              loggedSecs: logged.get(x.id) ?? 0,
              /* A task cannot be due before it existed. Without this a queue
                 anchored at the office opening spent the morning against work
                 that only arrived in the afternoon. */
              createdAtMs: x.createdAtMs,
              /* Nor before its own clock starts — the instant the budget is
                 counted from. Creation says when the work arrived; this says
                 when the person could first have begun it, and the gap between
                 them is where "Deadline 11:30 · Counted from 13:17" came
                 from. */
              clockStartsAtMs: x.clockStartsAtMs,
            };
          }) as never,
        anchorMs,
        /**
         * **The whole agreed budget, not what is left of it.**
         *
         * The other half of the pairing `chainDeadlines` documents, and the
         * half that was never passed — so it defaulted to `"remaining"` and
         * gave the fixed anchor a shrinking figure to add, which is what made
         * the date walk backwards as work was logged.
         *
         * Expected completion is a PLAN: when this work lands if it is done as
         * agreed. Subtracting logged time turns it into a running estimate that
         * improves as you work, which is a different thing wearing the same
         * label — and it double-counts, because the hour you spent has already
         * passed on the clock the anchor is measured from.
         *
         * Progress is not lost from the screen: the Time budget line beside
         * this reads "00:52:33 of 10:26:53", which is where progress belongs.
         * And a plan that has been passed is allowed to read in the past — the
         * Overdue mark is what says so, rather than the date sliding along to
         * meet the clock.
         */
        budget: "full",
        addWorkingSecs: (fromMs: number, secs: number) =>
          addWorkingSecs(fromMs, secs, policy.schedule, blocked, policy.breaks),
      });
      for (const c of chained) {
        if (!c.dueDate) continue;
        /**
         * **The chained date stands, including when it is in the past.**
         *
         * This used to floor the answer at `now` — "show it as due NOW rather
         * than as a past date, which reads as broken". The cost was that the
         * moment a projection fell behind the clock it BECAME the clock: read
         * at 16:00 it said 16:00, read at 16:03 it said 16:03, and the
         * companion line reported the deadline being missed by a figure that
         * grew a second per second while nobody touched the task.
         *
         * It also overrode, at the last step, the exact rule the layer below
         * exists to hold. `anchorStability.test.ts` puts it plainly: a due date
         * that has passed means the work is LATE, which is information, and an
         * anchor that follows the clock is a deadline nobody can ever miss
         * because it retreats as they approach it. `dueDateCases` CASE 12
         * asserts two reads minutes apart are equal. Both still passed — they
         * test the rule, and this clamped its output afterwards.
         *
         * A past date is not the display problem it was taken for: the task
         * already carries an Overdue chip, and "this was due at 15:30" is the
         * honest reading of a plan that has not been kept.
         */
        dueDates.set(String(c.taskId), c.dueDate);
      }
    } catch {
      /* A failed calendar read costs the derived date, not the queue. */
    }
    return dueDates;
  }

  /**
   * One person's active queue, in order, WITH the date each task really lands.
   *
   * **The operational due date is computed here and nowhere else.** Legacy
   * stores a `deadline` on the task, written when the hours were set, as
   * roughly "the moment of assignment plus the budget". That figure is
   * queue-blind: it assumes the person starts the instant they are given the
   * work. For anybody with anything else on, it is wrong by the total of
   * everything ahead — a four-hour task handed over at 09:30 stored 13:30
   * while three hours of committed work sat in front of it.
   *
   * So the stored value is kept for what it honestly is — the COMMITMENT, and
   * what scoring measures — and the operational date is derived from the same
   * chain the preview uses. One calculation, two readers, no way to disagree.
   *
   * Both queries are needed: `assigneeIds` misses a cross-department task held
   * at the gate, where the person sits in `pendingAssigneeId`. Firestore cannot
   * OR across fields, so it is two reads merged by id.
   */
  /**
   * Keep this viewer's stored deadlines in step with the order actually shown.
   *
   * **The dependency feature does exactly one thing: it swaps priority.**
   * Everything about dates stays the engine's — anchors from
   * `resolveAcceptanceAnchor`, dates walked through the office calendar,
   * chaining by `rechainQueueFor`. There is no deadline rule for blocked work
   * and there must not be one.
   *
   * That is not a gap. A blocked task drops to P2, and the ordinary chain then
   * anchors it after the task that overtook it — which IS the clock stopping
   * while its input is unavailable, paid for by the swap. An earlier version
   * pushed the blocked deadline out directly and gave it back on approval; it
   * computed the same answer twice from two anchors, and the two disagreed the
   * moment either moved.
   *
   * What still has to happen is the ASKING: `workableFirst` reorders for
   * display without touching a stored rank, so nothing on the engine side knows
   * the order changed until somebody tells it. This is that telling.
   *
   * Never awaited, and it swallows its own failures — a stale date is a thing
   * to fix on the next load, not a reason to cost anybody their task list.
   */
  async #syncQueueDeadlines(
    viewerId: string,
    entries: readonly {
      taskId: string;
      isWorkable?: boolean;
      /* Whether the task declares outputs at all — decides only whether this
         viewer is worth syncing, never anything about the queue. */
      hasOutputs?: boolean;
    }[],
    positions: Map<string, number>,
  ): Promise<void> {
    try {
      /* Neither blocked nor carrying outputs: every queue in the product
         today, and nothing here can apply to it. */
      if (!entries.some((e) => e.isWorkable === false || e.hasOutputs)) return;

      const order = [...positions.entries()].sort((a, b) => a[1] - b[1]);
      if (order.length === 0) return;

      /* A list can render many times a minute, and `rechainQueueFor` writes
         only where a date actually moves — so this spares the round trip, not
         the writes. */
      const nowMs = Date.now();
      const last = LegacyRepository.#lastQueueSyncMs.get(viewerId) ?? 0;
      if (nowMs - last < 60_000) return;
      LegacyRepository.#lastQueueSyncMs.set(viewerId, nowMs);

      await restoreBlockedDeadlines({
        token: await this.#token(),
        employeeId: String(viewerId),
        /* The head of the DERIVED queue — what this person is actually meant
           to be working on once a blocked task has been dropped past. The
           engine announces a change from it; it cannot compute it. */
        effectiveP1TaskId: order[0]?.[0] ?? null,
      }).catch(() => null);
    } catch {
      /* Deliberately silent — see the note above. */
    }
  }

  async #activeQueueOf(employeeId: string): Promise<{
    order: string[];
    dueDates: Map<string, string>;
    /* This same person's position among work not yet accepted or
       budget-settled — its own independent sequence. See
       `TaskAssignment.provisionalPosition`. */
    provisionalPositions: Map<string, number>;
  }> {
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    /* Two reads, because Firestore cannot OR across fields and a
       cross-department task at the gate sits in `pendingAssigneeId` with an
       empty `assigneeIds`. The office calendar is fetched by `#chainQueue`,
       which owns the dates. */
    const [mine, held] = await Promise.all([
      getDocs(
        query(
          collection(legacyDb(), "cowork_tasks"),
          where("assigneeIds", "array-contains", employeeId),
        ),
      ),
      getDocs(
        query(
          collection(legacyDb(), "cowork_tasks"),
          where("pendingAssigneeId", "==", employeeId),
        ),
      ).catch(() => null),
    ]);

    const docs = new Map<string, Record<string, unknown>>();
    for (const d of [...mine.docs, ...(held?.docs ?? [])]) {
      docs.set(d.id, { ...d.data(), id: d.id });
    }

    const tasks = [...docs.values()]
      .map((d) => readTask(d as never))
      .filter((t): t is NonNullable<typeof t> => t !== null && !t.isDeleted);

    /* The approved-anywhere set, for `isWorkable` below. Cached, so a list
       page resolving several reports' queues pays for this once. */
    const outputIndex = await this.#outputIndex();

    const entries = tasks.map((t) => ({
      taskId: t.id,
      status: toTaskStatus(t),
      storedRank: t.assigneePriorities[employeeId] ?? t.priority ?? null,
      order: t.order,
      createdAtMs: t.createdAtMs,
      /* Same rule as the list: an unsettled budget is not a queue slot. */
      budgetState: t.budgetNegotiation?.state ?? null,
      /* **Whether THIS person has accepted it.** `assigned` is the
         awaiting-acceptance state, and work nobody has taken on must not hold a
         slot ahead of work somebody has committed to. `confirmedBy` is the
         engine's own record — `confirmTaskReceipt` does `arrayUnion(employeeId)`
         — so this is the same fact the acceptance card reads. */
      accepted: t.confirmedByIds.includes(employeeId),
      /* A broken-down task holds no slot in this queue at all — see
         `QueueEntry.isContainer`. Without this, a project's leftover stored
         rank kept competing for a place the way a completed task's used to,
         which is why a queue of five could read P1, P3, P5 with nothing at P2
         or P4: two of the five documents had become containers. */
      isContainer: t.subtaskIds.length > 0,
      /**
       * Blocked work does not lead this person's queue.
       *
       * **This is the queue OTHER people see** — a manager reading their
       * report's row, and the task detail page. It was the one queue builder
       * without this, so Rakesh's own list demoted his blocked P1 while every
       * screen showing Rakesh's queue to somebody else still called it P1: two
       * P-numbers for one task, which is the exact fault the surrounding
       * comments describe for stored ranks.
       */
      isWorkable: taskIsWorkable(t, outputIndex.approved),
    }));

    /* The same ordering the screen derives, so a reorder starts from what the
       manager was looking at rather than from raw stored numbers that may
       contain gaps or duplicates. */
    const positions = activeQueuePositions(entries);
    const order = [...positions.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);

    /* The SEPARATE sequence for work still awaiting acceptance or a settled
       budget — never merged into `order`, which stays accepted-only because
       `#chainQueue` below reads it to compute committed dates: chaining
       unaccepted work into it would push an accepted deadline out for
       something that may never be accepted at all. */
    const provisionalPositions = provisionalQueuePositions(entries);

    const dueDates = await this.#chainQueue(employeeId, order, tasks);

    return { order, dueDates, provisionalPositions };
  }

  /**
   * Would this task meet its deadline at this position?
   *
   * A dry run. Nothing is written, and the answer is computed entirely by
   * `calculateDeadlineFeasibility` — this method's whole job is to fetch the
   * right inputs, which is where the question "whose workload?" is actually
   * decided.
   *
   * **The queue is the EVALUATED employee's, never the viewer's.** A sales
   * manager previewing a placement for a production employee is asking about
   * the production employee's week; their own is irrelevant. The query is by
   * `assigneeIds array-contains employeeId`, so the caller's identity cannot
   * leak into the answer.
   *
   * The office policy comes from the same document production deadlines use, so
   * a preview cannot promise a date the engine would then contradict.
   */
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
    const employeeId = String(input.employeeId);
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");

    /*
     * Blocked dates are a SEPARATE source from the office policy — holidays and
     * this person's own leave, per employee, over a range. Fetched for the
     * evaluated employee for the same reason the queue is: a preview must
     * respect the days THEY are away, not the viewer's.
     *
     * A year forward is the window: long enough that a distant deadline is
     * still computed against real holidays, bounded so the range query stays
     * cheap.
     */
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const [snap, policy, blockedDates, logged] = await Promise.all([
      getDocs(
        query(
          collection(legacyDb(), "cowork_tasks"),
          where("assigneeIds", "array-contains", employeeId),
        ),
      ),
      this.getOfficePolicy(),
      /* A failed blocked-date read must not fail the preview: the answer is
         then computed against office hours alone, which is optimistic by at
         most the holidays in the window rather than wrong in kind. */
      this.listBlockedDates(employeeId, from, to).catch(() => []),
      /* The same deduction the operational chain makes. Without it a preview
         would re-schedule work already done and disagree with the date on the
         task it is previewing. */
      this.#loggedSecsByTask(employeeId),
    ]);

    /* The raw documents, mapped only as far as the rule needs. Filtering by
       what counts as workload is the RULE's job — `isActivePriorityTask` — so
       that a preview and a workload count cannot disagree about who is busy. */
    const tasks = snap.docs
      .map((d) => readTask({ ...d.data(), id: d.id }))
      .filter((t): t is NonNullable<typeof t> => t !== null && !t.isDeleted)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        status: toTaskStatus(t),
        budgetState: t.budgetNegotiation?.state ?? null,
        assigneeIds: t.assigneeIds,
        assigneePriorities: t.assigneePriorities,
        priority: t.priority ?? undefined,
        /* The shared resolver, so the preview measures exactly the seconds
           the Details panel shows. */
        senderTimerWindowSecs: resolveTimeBudget(t),
        loggedSecs: logged.get(t.id) ?? 0,
        parentTaskId: t.parentTaskId,
        /* A broken-down task holds no place in this preview — see
           `FeasibilityTask.isContainer`. */
        isContainer: t.subtaskIds.length > 0,
        committedDueAt: t.dueAtMs === null ? null : new Date(t.dueAtMs).toISOString(),
        /* A task cannot be due before it existed — the chain floors each task's
           start at this. See `QueueTask.createdAtMs`. */
        createdAtMs: t.createdAtMs,
      }));

    const { addWorkingSecs, explainAddWorkingSecs } = await import(
      "../../legacy-ui/officeDueDate.js"
    );
    const blocked = new Set(blockedDates.map((b) => b.date));
    const blockedInfo = new Map(
      blockedDates.map((b) => [b.date, { type: b.kind, name: b.label }]),
    );

    return calculateDeadlineFeasibility({
      taskId: input.taskId ? String(input.taskId) : undefined,
      employeeId,
      proposedPriority: input.proposedPriority,
      estimatedWorkSeconds: input.estimatedWorkSeconds,
      alreadyWorkedSeconds:
        input.alreadyWorkedSeconds ??
        (input.taskId ? (logged.get(String(input.taskId)) ?? 0) : 0),
      committedDeadline: input.committedDeadline ?? null,
      orderOverride: input.orderOverride ?? null,
      tasks,
      nowMs: Date.now(),
      /* The FIXED origin for a queue with nothing started — the same function
         the real chain anchors to. Without it the preview falls back to
         midnight, which is stable but schedules into hours nobody works. */
      officeOpenMs: officeOpenMsFor(policy.schedule, Date.now()),
      addWorkingSecs: (anchorMs, windowSecs) =>
        addWorkingSecs(anchorMs, windowSecs, policy.schedule, blocked, policy.breaks),
      /* The step log takes a MAP rather than a set, so it can say WHICH reason
         a day was skipped for — "Republic Day", not merely "closed". */
      /* `.steps` — the helper returns the final date alongside the log, and the
         rule wants only the log. */
      explainWorkingSecs: (anchorMs, windowSecs) =>
        explainAddWorkingSecs(
          anchorMs,
          windowSecs,
          policy.schedule,
          blockedInfo,
          policy.breaks,
        ).steps,
    });
  }

  /** Legacy's own clamp, from `handleUpdatePriority`. */
  #clampRank(rank: number): number {
    return Math.max(1, Math.min(10, Math.round(Number(rank) || 1)));
  }

  /**
   * Move one task's rank for one person.
   *
   * Returns `null` rather than a `PriorityCascade`: a cascade is a record of
   * every deadline that moved as a consequence, and legacy neither computes nor
   * stores one. Inventing the effects here would put a list of "affected
   * deadlines" on screen that nothing had actually changed — the acknowledgement
   * gate would then ask people to confirm shifts that never happened.
   *
   * The REASON is likewise not persisted, and that is a real gap rather than an
   * oversight: `cowork_tasks` has no field for it and legacy never captured one.
   * Recording it would mean adding a field the engine does not read, which is
   * defensible for presence (where the old app ignores unknown keys and the
   * data is ours) but not here — priority is scored, and a half-written audit
   * trail that only this app can see is worse than an acknowledged absence.
   * `listPriorityChanges` says so rather than returning an empty history that
   * reads as "nobody has ever changed this".
   */
  async changePriority(
    input: ChangePriorityInput,
  ): Promise<ActionResult<PriorityCascade | null>> {
    const taskId = String(input.taskId);
    const employeeId = String(input.employeeId);
    if (!employeeId) {
      return {
        ok: false,
        code: "validation_failed",
        message: "A priority is per person, so the change needs somebody to apply it to.",
        field: "employeeId",
      };
    }

    const rank = this.#clampRank(input.newRank);
    const { doc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    /*
     * **Moving one task moves the queue, so the whole queue is written.**
     *
     * Writing only this task's rank was the bug behind "I moved C to P1 and A
     * is still P1". Setting C to 1 while A also holds 1 leaves two tasks at the
     * same rank, and the displayed order then falls to a tie-break — which put
     * the OLDER task first and silently defeated the manager's move. The
     * dialog's own preview showed C, A, B; storage said otherwise.
     *
     * So the intended order is computed and persisted in one batch, exactly as
     * legacy's drag handler does (`page.js:1748`, ported as
     * `reorderPriorities`). The two entry points now agree, because a rank
     * typed into the dialog and a task dragged up the list are the same act.
     *
     * Only ACTIVE tasks are renumbered. A closed task keeps the rank it
     * finished with — it is a record, it is displayed as "was", and pulling it
     * into the renumbering would rewrite history to make room for live work.
     */
    /* The moved task is added if the query missed it — `assigneeIds` and the
       priority map can disagree, and renumbering a queue without the task being
       renumbered would be worse than the bug being fixed. */
    const { order: queue } = await this.#activeQueueOf(employeeId);
    if (queue.length > 1 || (queue.length === 1 && !queue.includes(taskId))) {
      const without = queue.filter((id) => id !== taskId);
      const at = Math.max(0, Math.min(without.length, rank - 1));
      without.splice(at, 0, taskId);
      const result = await this.reorderPriorities(employeeId, without, "");
      if (!result.ok) return result;
      notifyRepositoryChanged();
      return { ok: true, data: null };
    }

    try {
      await updateDoc(doc(legacyDb(), "cowork_tasks", taskId), {
        priority: rank,
        /* Dot notation — see the note above. Bracketed because the key is
           computed, which is also what stops it being written as a nested
           object and clobbering the map. */
        [`assigneePriorities.${employeeId}`]: rank,
        updatedAt: new Date(),
      });
    } catch (error) {
      return {
        ok: false,
        code: "not_found",
        message:
          error instanceof Error
            ? `The priority could not be saved: ${error.message}`
            : "The priority could not be saved.",
      };
    }

    /*
     * Renumber first, then re-schedule.
     *
     * This branch writes ONE rank — it is the single-task case, where the queue
     * held nothing else to reorder. That still leaves the invariant to check: the
     * rank came from `#clampRank`, so a caller asking for P7 on a one-task queue
     * would store 7 and leave nothing at 1..6.
     *
     * Before the re-schedule, because the dates are chained in queue ORDER and
     * chaining a queue that is about to be renumbered would compute them twice.
     */
    await this.normalizePriorities(employeeId as EmployeeId);

    /* **Priority is a scheduling input, so the deadline follows it.**
       Writing the rank alone is what produced "priority changed but nothing
       happened": in legacy a task's due date is derived from where it sits in
       its assignee's queue, so re-ranking re-anchors the date. Legacy does this
       in the browser right after the same write — `recalcDueDateForPriorityChange`
       — and so does this. */
    await this.#recalculateQueueDeadlines(employeeId, await this.#parentOf(taskId));

    /* **This branch only.** The branch above delegates to `reorderPriorities`,
       which posts to `/employee/:id/priority-order` — and that route announces
       the reorder itself, so announcing here as well would ring twice for one
       drag. This is the single-rank write, which reaches no route at all.

       Announcing unconditionally is safe: the event filters the actor out of
       its own recipients, so setting your own rank still notifies nobody. */
    this.#announce("task_priority_changed", {
      taskId,
      rank,
      reason: input.reason ?? "",
    });

    /* The live `onSnapshot` will deliver this too, but not necessarily before
       the dialog closes. Nudging the caches here is what makes the new rank
       appear the moment the write returns rather than a beat later. */
    notifyRepositoryChanged();
    return { ok: true, data: null };
  }

  /**
   * Re-anchor a task's deadline after its rank moved.
   *
   * A transcription of `recalcDueDateForPriorityChange`
   * (`cowork-old-frontend/app/coworking/tasks/page.js`), which is the whole of
   * legacy's rule — there is no server route, because legacy computes this in
   * the browser and writes `cowork_tasks.dueDate` directly. Same exception
   * class as the timer and the duty document.
   *
   * The shape, in legacy's order:
   *
   *  1. Skip unless the task is timed AND already has a date. Legacy's comment:
   *     *"a task that hasn't been played yet gets it right on first Play"* — and
   *     a fixed deadline is somebody's decision, not arithmetic's to overwrite.
   *  2. Find the task immediately ahead of this one in the assignee's queue.
   *  3. New date = that task's finish + this task's window, snapped into office
   *     hours; or computed from the window alone when nothing is ahead.
   *
   * **Failure is swallowed deliberately, exactly as legacy swallows it.** The
   * rank has already been written and is the thing the person asked for; a
   * re-anchoring that fails must not report the whole change as failed and send
   * them to do it again. Legacy logs and moves on, and the next Play recomputes
   * the date anyway.
   */
  /**
   * A task's parent, or null.
   *
   * The queue a re-rank rewrites is scoped to one parent — legacy filters
   * siblings on `(t.parentTaskId || null) !== (parentId || null)` — because
   * subtasks of different parents are different queues and laying them
   * end-to-end would schedule unrelated work in sequence.
   */
  async #parentOf(taskId: string): Promise<string | null> {
    const doc = await this.#taskDocument(taskId);
    const parent = doc?.parentTaskId;
    return typeof parent === "string" && parent ? parent : null;
  }

  async #recalculateQueueDeadlines(
    employeeId: string,
    parentTaskId: string | null,
  ): Promise<QueueDeadlineMove[]> {
    try {
      const { collection, doc, getDoc, getDocs, query, where, updateDoc } =
        await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const db = legacyDb();

      const settingsSnap = await getDoc(doc(db, "cowork_settings", "office"));
      const schedule = settingsSnap.exists()
        ? ((settingsSnap.data() as Record<string, unknown>).schedule ?? null)
        : null;

      /* A LIVE read, not the cached directory. This runs immediately after the
         rank write, and legacy's own comment on the same pattern says the local
         cache can lag a just-written priority by a second or two. */
      const peers = await getDocs(
        query(
          collection(db, "cowork_tasks"),
          where("assigneeIds", "array-contains", employeeId),
        ),
      );

      const raw = peers.docs.map((d) => ({
        taskId: d.id,
        ...(d.data() as Record<string, unknown>),
      }));
      const queue = queueFor({ tasks: raw, employeeId, parentTaskId });
      if (queue.length === 0) return [];

      /* What each date WAS, read before anything is written. The receipt the
         person whose queue this is has to acknowledge is built from the
         difference, and a "previous" read after the write would be the new value
         under an old name. */
      const wasDue = new Map<string, string | null>();
      const titles = new Map<string, string>();
      for (const t of raw) {
        const read = readTask(t as never);
        wasDue.set(
          String(t.taskId),
          read?.dueAtMs == null ? null : new Date(read.dueAtMs).toISOString(),
        );
        titles.set(String(t.taskId), read?.title ?? String(t.taskId));
      }

      const nowMs = Date.now();
      const { addWorkingSecs } = await import("../../legacy-ui/officeDueDate.js");
      const moved = chainDeadlines({
        queue,
        anchorMs: anchorMsFor({
          leader: queue[0],
          officeOpenMs: officeOpenMsFor(
            schedule as Record<string, { isOff?: boolean; inTime?: string }> | null,
            nowMs,
          ),
          nowMs,
        }),
        addWorkingSecs: (anchorMs, windowSecs) =>
          addWorkingSecs(anchorMs, windowSecs, schedule),
      });

      /* One write per task, as legacy does, rather than a batch: a batch that
         fails takes the whole queue's dates with it, and a partially-rewritten
         queue is still ordered correctly — each date was computed from the one
         before it. */
      const applied: QueueDeadlineMove[] = [];
      for (const { taskId, dueDate } of moved) {
        await updateDoc(doc(db, "cowork_tasks", taskId), {
          dueDate,
          updatedAt: new Date(),
        });
        applied.push({
          taskId,
          title: titles.get(taskId) ?? taskId,
          previousDueAt: wasDue.get(taskId) ?? null,
          newDueAt: dueDate,
        });
      }
      return applied;
    } catch (error) {
      /* Legacy's own `console.error("[drag-priority-conflict]", …)`, and its own
         decision to swallow. The RANK has already been written and is what the
         person asked for; failing the whole change because the re-scheduling
         failed would send them to do it again, and the next Play recomputes the
         date anyway. */
      console.error("[priority-deadline] queue recalculation failed:", error);
      /* Nothing moved, as far as anybody can tell. An empty list is the honest
         answer here — the ranks landed and the dates did not — and it keeps the
         receipt from announcing shifts that never happened. */
      return [];
    }
  }

  /**
   * Re-rank a whole queue in one write.
   *
   * Legacy's drag handler (`page.js:1748-1764`) commits a `writeBatch` and
   * renumbers from 1, writing `order = (idx + 1) * 1000` alongside the rank.
   * `order` exists so a drag can be expressed without renumbering everything —
   * the old page sorts on `assigneePriorities[me] ?? order ?? priority * 1000`
   * — so it is written here for the same reason and read by the same sort.
   *
   * One batch, not N writes: a partial reorder leaves two tasks holding the
   * same rank, and the queue then has no defined order at all.
   */
  /**
   * Repair one person's stored ranks so they satisfy the invariant.
   *
   * **The stored ranks are what everybody except the queue owner reads.** The
   * derivation numbers by index and cannot emit a duplicate or a gap — but a list
   * read fetches only the viewer's queue, so a manager reading a report's tasks
   * falls through to the raw stored numbers. Legacy wrote those per assignee
   * independently (`open count + 1`, computed before the sibling existed), and
   * nothing has ever normalised the set.
   *
   * So this makes the data satisfy the rule rather than compensating for it at
   * every read.
   *
   * **Idempotent, and reports so.** `normalizePriorityQueue` returns only the
   * tasks whose stored rank actually disagrees, so a healthy queue is zero writes
   * and `changed: 0`. That is what makes it safe to call after any priority
   * write — and the sort is total, so the same queue always normalises to the
   * same order rather than churning.
   *
   * ⚠ **A queue longer than ten cannot be fully expressed.** The stored rank is
   * legacy's 1–10 scale and the old app reads the same field, so writing 11 would
   * make the task render as unranked there. Positions beyond ten are clamped and
   * therefore duplicate at the tail. The DERIVED position is unbounded and is
   * what the queue owner sees, so the tail duplication is invisible to them —
   * it shows only to somebody reading another person's stored ranks. Fixing it
   * properly needs a field the old app does not share.
   */
  async normalizePriorities(
    employeeId: EmployeeId,
  ): Promise<ActionResult<{ changed: number; fault: string | null }>> {
    const id = String(employeeId);
    const { collection, doc, getDocs, query, where, writeBatch } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const db = legacyDb();

    /* Both reads, for the same reason `#activeQueueOf` makes them: Firestore
       cannot OR across fields and a task at the gate sits in
       `pendingAssigneeId` with an empty `assigneeIds`. */
    const [mine, held] = await Promise.all([
      getDocs(
        query(collection(db, "cowork_tasks"), where("assigneeIds", "array-contains", id)),
      ),
      getDocs(
        query(collection(db, "cowork_tasks"), where("pendingAssigneeId", "==", id)),
      ).catch(() => null),
    ]);

    const docs = new Map<string, Record<string, unknown>>();
    for (const d of [...mine.docs, ...(held?.docs ?? [])]) {
      docs.set(d.id, { ...d.data(), id: d.id });
    }
    const tasks = [...docs.values()]
      .map((d) => readTask(d as never))
      .filter((t): t is NonNullable<typeof t> => t !== null && !t.isDeleted);

    const queue = normalizePriorityQueue(
      tasks.map((t) => ({
        taskId: t.id,
        status: toTaskStatus(t),
        storedRank: t.assigneePriorities[id] ?? t.priority ?? null,
        order: t.order,
        createdAtMs: t.createdAtMs,
        budgetState: t.budgetNegotiation?.state ?? null,
        accepted: t.confirmedByIds.includes(id),
      })),
    );

    const fault = describeQueueFault(queue);
    if (queue.isNormal) return { ok: true, data: { changed: 0, fault } };

    /*
     * ## Concurrency
     *
     * A client-side Firestore transaction cannot run a QUERY — only
     * `tx.get(docRef)` — so a queue derived from `where(...)` cannot be read and
     * written atomically. What makes the race safe anyway is the shape of the
     * calculation rather than a lock:
     *
     * `calculatePriorityOrder` is a TOTAL sort over stored fields, so two
     * concurrent normalisations of the same data converge on the same answer.
     * The invariant — no duplicates, no gaps — therefore survives any
     * interleaving. What a race can cost is the ORDERING intent: a normalise
     * computed from data one write behind will persist that slightly older order,
     * and the later mutation's normalise then corrects it.
     *
     * So the guarantee is: **the queue is never left invalid; the ordering is
     * last-writer-wins.** The retry below narrows the window rather than closing
     * it, and closing it properly needs a per-person document to hold the queue —
     * which the old app does not share.
     */
    try {
      const batch = writeBatch(db);
      for (const change of queue.changes) {
        const position = queue.order.indexOf(change.taskId);
        batch.update(doc(db, "cowork_tasks", change.taskId), {
          /* **Dot notation.** Writing `assigneePriorities` whole would erase
             every other assignee's rank — the document shape IS the contract
             here, because priority has no REST route. */
          [`assigneePriorities.${id}`]: this.#clampRank(change.to),
          order: (position + 1) * 1000,
          updatedAt: new Date(),
        });
      }
      await batch.commit();
    } catch (error) {
      return {
        ok: false,
        code: "conflict",
        message:
          error instanceof Error
            ? `The queue could not be renumbered: ${error.message}`
            : "The queue could not be renumbered.",
      };
    }

    notifyRepositoryChanged();
    return { ok: true, data: { changed: queue.changes.length, fault } };
  }

  /**
   * Repair every user's queue. **Admin and diagnostic use; no UI yet.**
   *
   * Scans `cowork_tasks` once, groups by holder, and normalises each person's
   * queue independently — a rank is per person, so one scan serves everybody and
   * nobody's numbering can leak into anybody else's.
   *
   * **Completed history is never touched.** `normalizePriorityQueue` returns
   * changes only for ACTIVE tasks, so a closed task keeps the rank it finished
   * with and continues to render as "was P3".
   *
   * One read of the collection rather than two queries per person: at company
   * scale the per-person version is O(people × tasks) reads, which is the
   * difference between a diagnostic somebody runs and one they avoid.
   */
  async normalizePrioritiesAllUsers(): Promise<
    ActionResult<{
      scanned: number;
      users: number;
      changed: number;
      perUser: { employeeId: string; changed: number; fault: string | null }[];
    }>
  > {
    if (!maySettings({ archetype: this.#ctx.archetype ?? null })) {
      return { ok: false, code: "permission_denied", message: SETTINGS_REFUSAL };
    }

    const { collection, doc, getDocs, writeBatch } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const db = legacyDb();

    const snap = await getDocs(collection(db, "cowork_tasks"));
    const tasks = snap.docs
      .map((d) => readTask({ ...(d.data() as Record<string, unknown>), id: d.id } as never))
      .filter((t): t is NonNullable<typeof t> => t !== null && !t.isDeleted);

    /* Group by holder. `holdersOf` rather than `assigneeIds`, so somebody behind
       a cross-department gate is repaired too — they are exactly the person whose
       queue nobody has been looking at. */
    const byPerson = new Map<string, typeof tasks>();
    for (const t of tasks) {
      for (const id of holdersOf({
        assigneeIds: t.assigneeIds,
        pendingAssigneeIds: t.pendingAssigneeId ? [t.pendingAssigneeId] : [],
      })) {
        byPerson.set(id, [...(byPerson.get(id) ?? []), t]);
      }
    }

    const perUser: { employeeId: string; changed: number; fault: string | null }[] =
      [];
    let changed = 0;
    /* One batch per person rather than one for everybody: Firestore caps a batch
       at 500 writes, and a partial commit that renumbered half a queue would be
       worse than not having run. */
    for (const [employeeId, theirs] of byPerson) {
      const queue = normalizePriorityQueue(
        theirs.map((t) => ({
          taskId: t.id,
          status: toTaskStatus(t),
          storedRank: t.assigneePriorities[employeeId] ?? t.priority ?? null,
          order: t.order,
          createdAtMs: t.createdAtMs,
          budgetState: t.budgetNegotiation?.state ?? null,
          accepted: t.confirmedByIds.includes(employeeId),
        })),
      );
      const fault = describeQueueFault(queue);
      if (queue.isNormal) {
        perUser.push({ employeeId, changed: 0, fault });
        continue;
      }
      try {
        const batch = writeBatch(db);
        for (const change of queue.changes) {
          batch.update(doc(db, "cowork_tasks", change.taskId), {
            [`assigneePriorities.${employeeId}`]: this.#clampRank(change.to),
            order: (queue.order.indexOf(change.taskId) + 1) * 1000,
            updatedAt: new Date(),
          });
        }
        await batch.commit();
        changed += queue.changes.length;
        perUser.push({ employeeId, changed: queue.changes.length, fault });
      } catch (error) {
        /* One person's failure does not abandon the rest — a repair that stopped
           at the first conflict would leave the scan half-done with no record of
           where. */
        console.error(`[normalizePrioritiesAllUsers] ${employeeId}:`, error);
        perUser.push({ employeeId, changed: 0, fault });
      }
    }

    notifyRepositoryChanged();
    return {
      ok: true,
      data: { scanned: tasks.length, users: byPerson.size, changed, perUser },
    };
  }

  async reorderPriorities(
    employeeId: EmployeeId,
    orderedTaskIds: TaskId[],
    /* Accepted and not persisted — `cowork_tasks` has no field for it. See
       `listPriorityChanges` for why a half-written audit trail is worse than
       an acknowledged absence. */
    _reason: string,
  ): Promise<ActionResult<PriorityCascade | null>> {
    void _reason;
    const id = String(employeeId);
    if (!orderedTaskIds.length) return { ok: true, data: null };

    /* **Through the engine, not a browser batch.**
     *
     * This wrote the whole queue with `writeBatch` — which is atomic per commit
     * but cannot READ inside the transaction, so two tabs reordering at once
     * could each compute from stale data and leave duplicate ranks. The engine's
     * `/priority-order` runs `getAll` + writes inside one `runTransaction`,
     * which a browser SDK simply cannot do.
     *
     * **The ORDER is still decided here.** The route writes 1..N over whatever
     * list it is given and does not sort — `calculatePriorityOrder` remains the
     * only place that decides sequence. No rule moved. */
    /* Read BEFORE the write, or "previous" is the new value under an old name.
       The manager's confirmation needed this same snapshot a moment ago; this is
       the authoritative one, taken as late as possible. */
    const before = await this.#queueSnapshot(id).catch(() => [] as CascadeOrderEntry[]);

    const posted = await setPriorityOrder({
      token: await this.#token(),
      employeeId: id,
      orderedTaskIds: orderedTaskIds.map((t) => String(t)),
    });
    if (!posted.ok) {
      return {
        ok: false,
        code: "conflict",
        message: posted.error.message ?? "The queue could not be reordered.",
      };
    }

    /*
     * **Renumber after the write, even though the write is already 1..N.**
     *
     * It looks redundant and is not, for two reasons. The order the caller passed
     * may omit an active task — `changePriority` inserts the moved task if the
     * query missed it, but a direct caller need not — and anything omitted keeps a
     * stale rank that then duplicates one of these. And `#clampRank` caps at ten,
     * so a queue longer than that writes duplicate tens here; normalising re-reads
     * the whole queue and produces the best 1..10 the field can hold.
     *
     * Idempotent, so a queue that really was already correct costs two reads and
     * no write.
     */
    await this.normalizePriorities(employeeId);

    /* The same re-scheduling a single rank change triggers. A reorder IS the
       drag path legacy runs this from, so it is if anything the more important
       of the two — the whole queue has just been renumbered. It now REPORTS what
       it moved, which is what makes an honest receipt possible. */
    const moves = await this.#recalculateQueueDeadlines(
      id,
      await this.#parentOf(String(orderedTaskIds[0])),
    );

    notifyRepositoryChanged();

    /* ── The receipt ──────────────────────────────────────────────────────
     *
     * Written LAST, and never at the cost of the reorder. The ranks are already
     * committed — transactionally, by the engine — so a failure here loses a
     * notification, not state. Retrying the whole call would double-apply.
     *
     * Nothing is written when the actor is reordering their own queue: a receipt
     * telling somebody that they themselves moved their work is a modal they
     * cannot dismiss for news they already have. */
    const actor = String(this.#ctx.employeeId ?? "");
    if (actor === id) return { ok: true, data: null };

    try {
      const cascade = await this.#recordReorderReceipt({
        employeeId: id,
        orderedTaskIds: orderedTaskIds.map(String),
        before,
        moves,
        reason: _reason,
      });
      return { ok: true, data: cascade };
    } catch (error) {
      /* Legacy's own decision on the same class of failure, and for the same
         reason: the change the person asked for has landed. Failing it now would
         send them to do it again. */
      console.error("[priority-cascade] the receipt could not be written:", error);
      return { ok: true, data: null };
    }
  }

  /**
   * Read a person's queue as an ordered, dated list.
   *
   * Used either side of a reorder, so the two snapshots are read the same way
   * and can be compared. Titles and dates come from `readTask`, which is the one
   * place a stored task becomes a domain one.
   */
  async #queueSnapshot(
    employeeId: string,
    orderOverride?: readonly string[],
  ): Promise<CascadeOrderEntry[]> {
    const { collection, getDocs, query, where } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDocs(
      query(
        collection(legacyDb(), "cowork_tasks"),
        where("assigneeIds", "array-contains", employeeId),
      ),
    );
    const byId = new Map<string, { title: string; dueAt: string | null; rank: number }>();
    for (const d of snap.docs) {
      const t = readTask({ ...(d.data() as Record<string, unknown>), id: d.id } as never);
      if (!t || t.isDeleted) continue;
      const storedRank = t.assigneePriorities[employeeId] ?? t.priority ?? null;
      if (
        !isActiveWorkload({
          taskId: t.id,
          status: toTaskStatus(t),
          storedRank,
          budgetState: t.budgetNegotiation?.state ?? null,
          accepted: t.confirmedByIds.includes(employeeId),
          isContainer: t.subtaskIds.length > 0,
        })
      )
        continue;
      byId.set(t.id, {
        title: t.title,
        dueAt: t.dueAtMs === null ? null : new Date(t.dueAtMs).toISOString(),
        rank: typeof storedRank === "number" ? storedRank : Number.MAX_SAFE_INTEGER,
      });
    }

    /* The order asked for, then anything it did not name — dropping the rest
       would report a queue shorter than the one the person actually holds. */
    const ids = orderOverride
      ? [
          ...orderOverride.filter((tid) => byId.has(tid)),
          ...[...byId.keys()].filter((tid) => !orderOverride.includes(tid)),
        ]
      : [...byId.keys()].sort((a, b) => byId.get(a)!.rank - byId.get(b)!.rank);

    return ids.map((taskId, i) => ({
      taskId,
      taskTitle: byId.get(taskId)!.title,
      rank: i + 1,
      dueAt: byId.get(taskId)!.dueAt,
    }));
  }

  /**
   * Write the history entries the acknowledgement is built from.
   *
   * Into `cowork_tasks.deadlineAutoExtendedHistory[]` — **the engine's own
   * field**, the one its P1 path writes and the one the old frontend's modal
   * reads. That is deliberate: a parallel collection would leave two products
   * keeping two records of one event, and somebody acknowledging in this app
   * would still be shown the old app's modal for the same change.
   *
   * A browser-to-Firestore write with no route behind it, which is the same
   * documented exception the timer and the duty document carry — and for the
   * same reason: legacy's own client performs this identical write
   * (`PriorityChangeAckModal.jsx` flips the flag the same way) and no engine
   * route exists for it.
   */
  async #recordReorderReceipt(input: {
    employeeId: string;
    orderedTaskIds: string[];
    before: CascadeOrderEntry[];
    moves: QueueDeadlineMove[];
    reason: string;
  }): Promise<PriorityCascade | null> {
    if (input.moves.length === 0 && input.before.length === 0) return null;

    const after = await this.#queueSnapshot(input.employeeId, input.orderedTaskIds);
    const rankBefore = new Map(input.before.map((r) => [r.taskId, r.rank]));
    const rankAfter = new Map(after.map((r) => [r.taskId, r.rank]));

    /* The task the reorder was about: the one that moved furthest, in either
       direction. An insert moves exactly one row by more than one place. */
    let subject = after[0] ?? input.before[0] ?? null;
    let furthest = -1;
    for (const row of after) {
      const was = rankBefore.get(row.taskId);
      if (was === undefined) continue;
      const distance = Math.abs(was - row.rank);
      if (distance > furthest) {
        furthest = distance;
        subject = row;
      }
    }
    if (!subject) return null;

    const me = await this.getCurrentEmployee().catch(() => null);
    const at = new Date().toISOString();
    const { doc, updateDoc, arrayUnion } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    for (const move of input.moves) {
      /* The task that triggered it does not receive a receipt about itself. */
      if (move.taskId === subject.taskId) continue;
      await updateDoc(doc(legacyDb(), "cowork_tasks", move.taskId), {
        [HISTORY_FIELD]: arrayUnion(
          entryFor({
            move,
            triggeringTaskId: subject.taskId,
            triggeringTaskTitle: subject.taskTitle,
            previousRank: rankBefore.get(move.taskId) ?? null,
            newRank: rankAfter.get(move.taskId) ?? null,
            reason: input.reason,
            changedById: String(this.#ctx.employeeId ?? ""),
            changedByName: me?.displayName ?? "",
            at,
            queueBefore: input.before,
            queueAfter: after,
          }),
        ),
      });
    }

    return {
      id: `${subject.taskId}|${at}`,
      triggeringTaskId: subject.taskId,
      triggeringTaskTitle: subject.taskTitle,
      employeeId: input.employeeId,
      reason: input.reason || "No reason was given.",
      changedById: String(this.#ctx.employeeId ?? ""),
      changedByName: me?.displayName ?? "",
      effects: input.moves
        .filter((m) => m.taskId !== subject.taskId)
        .map((m) => ({
          taskId: m.taskId,
          taskTitle: m.title,
          previousRank: rankBefore.get(m.taskId) ?? 0,
          newRank: rankAfter.get(m.taskId) ?? 0,
          previousDueAt: m.previousDueAt,
          newDueAt: m.newDueAt,
          previousWindowSecs: null,
          newWindowSecs: null,
          shiftedBySecs:
            m.previousDueAt === null
              ? 0
              : Math.max(
                  0,
                  Math.round(
                    (Date.parse(m.newDueAt) - Date.parse(m.previousDueAt)) / 1000,
                  ),
                ),
          creditedWorkedSecs: 0,
        })),
      previousOrder: input.before,
      newOrder: after,
      createdAt: at,
      acknowledgedAt: null,
    };
  }

  /**
   * The audit trail, which legacy does not keep.
   *
   * Throws rather than returning `[]`. An empty list here is a claim — "this
   * task's priority has never been changed" — and it would be false for every
   * task the old app has ever reordered. The panel renders the unavailable
   * state instead, which is the honest one: the changes happened, and nothing
   * recorded them.
   *
   * Closing this needs a place to write history. That is a product decision
   * (P6 in the spec proposes exactly it), not something to improvise here.
   */
  listPriorityChanges(): Promise<PriorityChange[]> {
    throw new NotConnectedError("listPriorityChanges");
  }

  /**
   * Stored priority ranks held by more than one of a person's ACTIVE tasks.
   *
   * **This returned `[]` until now, and that was the real bug behind "people
   * have duplicate priorities and nothing flags it".** The derived queue
   * (`activeQueuePositions`) numbers by index and cannot repeat a number, so the
   * QUEUE OWNER never sees a duplicate — but everyone else reads the STORED rank
   * (`assigneePriorities[id]`), and legacy writes those per assignee
   * independently (`open count + 1`, computed before a sibling existed), never
   * normalising the set. Two tasks assigned close together get the same number,
   * a completed task leaves a gap, and a queue longer than ten clamps its tail to
   * a duplicate `10`. With this method stubbed, none of it surfaced.
   *
   * It now scans the person's tasks the same way `normalizePriorities` does —
   * both id fields, active workload only (a completed P1 is a record, not a
   * conflict) — and reports each stored rank two or more of them hold. The fix
   * for what it finds is `normalizePriorities(id)`, which the UI offers beside
   * the warning.
   */
  async listPriorityConflicts(
    employeeId: EmployeeId,
  ): Promise<PriorityConflict[]> {
    const id = String(employeeId);
    if (!id) return [];
    try {
      const { collection, getDocs, query, where } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const db = legacyDb();

      /* Both reads, for the reason `#activeQueueOf` makes them: a task at the
         cross-department gate sits in `pendingAssigneeId` with empty
         `assigneeIds`, and its rank collides just the same. */
      const [mine, held] = await Promise.all([
        getDocs(
          query(
            collection(db, "cowork_tasks"),
            where("assigneeIds", "array-contains", id),
          ),
        ),
        getDocs(
          query(collection(db, "cowork_tasks"), where("pendingAssigneeId", "==", id)),
        ).catch(() => null),
      ]);

      const docs = new Map<string, Record<string, unknown>>();
      for (const d of [...mine.docs, ...(held?.docs ?? [])]) {
        docs.set(d.id, { ...d.data(), id: d.id });
      }

      const byRank = new Map<number, string[]>();
      for (const raw of docs.values()) {
        const t = readTask(raw as never);
        if (!t || t.isDeleted) continue;
        const storedRank = t.assigneePriorities[id] ?? t.priority ?? null;
        /* Active workload only — the same predicate the queue and the normaliser
           use, so "conflict", "held slot" and "gets renumbered" are one answer. */
        if (
          !isActiveWorkload({
            taskId: t.id,
            status: toTaskStatus(t),
            storedRank,
            budgetState: t.budgetNegotiation?.state ?? null,
            accepted: t.confirmedByIds.includes(id),
            isContainer: t.subtaskIds.length > 0,
          })
        )
          continue;
        if (typeof storedRank !== "number" || !Number.isFinite(storedRank))
          continue;
        byRank.set(storedRank, [...(byRank.get(storedRank) ?? []), t.id]);
      }

      return [...byRank.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([rank, taskIds]) => ({
          employeeId: id as EmployeeId,
          rank,
          taskIds: taskIds as TaskId[],
        }))
        .sort((a, b) => a.rank - b.rank);
    } catch (error) {
      console.error("[priority] conflict scan failed:", error);
      return [];
    }
  }
  /**
   * Legacy has no role entities — only the three strings `ceo`, `tl` and
   * `employee`, compared inline. An empty list is the truthful answer, and it
   * keeps the profile switcher from taking the shell down.
   */
  /**
   * The role table.
   *
   * Returned it as `[]` until now, which read as "this organisation has defined
   * no roles" and was consumed as "nobody may do anything": `can()` finds a
   * capability by intersecting the viewer's roles with this list, so an empty
   * list denied every capability to every person. Three screens were dark
   * because of it, none of them by any decision anybody made.
   *
   * A constant rather than a fetch, because legacy stores no role entity — see
   * `lib/auth/systemRoles.ts`. It is the same table the seed tenant uses, so a
   * capability behaves identically whichever backend is behind it.
   */
  async listRoles(): Promise<Role[]> {
    return systemRoles(LEGACY_ORGANISATION_ID);
  }

  /**
   * Editing a role, refused with the reason.
   *
   * These four are the exception to "unimplemented methods throw" — not a
   * softening of it. The proxy throws for a method that is *not wired yet*, so
   * an unfinished screen fails loudly instead of looking empty. This is a
   * different fact: there is nothing to wire. The engine has no role entity, so
   * a saved permission would have nowhere to go, and `NotConnectedError` would
   * tell an administrator to wait for a connection that is not coming.
   *
   * A refusal rather than a hidden control, because the table is worth reading
   * even when it cannot be changed — it is the answer to "why can that person
   * approve this", and the editor is the only place it is legible.
   */
  async #roleEditingUnavailable(): Promise<ActionResult<never>> {
    return {
      ok: false,
      code: "invalid_state",
      message:
        "Roles are fixed while the Cowork engine is the backend. It stores a role as one of three words on each employee, not as a record with permissions, so there is nowhere to save a change to this table.",
    };
  }
  async createRole() { return this.#roleEditingUnavailable(); }
  async updateRole() { return this.#roleEditingUnavailable(); }
  async deleteRole() { return this.#roleEditingUnavailable(); }
  async setRolePermissions() { return this.#roleEditingUnavailable(); }
  /**
   * Break lives in Firestore `cowork_duty_status` and `cowork_settings/office`,
   * both written from the browser in legacy with **no REST endpoint**. Reaching
   * them needs the server-side proxy and `LEGACY_FIREBASE_SERVICE_ACCOUNT`.
   *
   * Left to the throwing proxy on purpose rather than returning a zero budget:
   * a break allowance of zero is a factual claim about somebody's entitlement,
   * and `useQuery` now renders it as unavailable rather than crashing.
   */
  /**
   * The flow graph. Legacy reports no weekly arrival or departure counts, so
   * there is nothing to build it from — see `listWorkloadRows`.
   */
  /**
   * The dashboard's signature graph, from the tasks this viewer can see.
   *
   * **This was `async getWorkloadFlow() { return null; }`** — a one-line stub,
   * so the graph rendered an empty state in production for its whole life while
   * looking complete against the mock, which computes the series in full.
   *
   * Reads the SAME documents as `listTasks`, through the same
   * `#taskDocuments(viewerId)` — so the graph can never show work the task list
   * would not, which is the failure mode a second, cheaper query would have.
   *
   * Only four of the six channels can be answered from legacy's records; see
   * `lib/rules/dashboard/workloadFlow.ts` for which, and why the missing two
   * stay at zero rather than being folded into `completed`.
   */
  async getWorkloadFlow(q: {
    scope: TaskScope;
    weeks: number;
  }): Promise<WorkloadFlow> {
    const viewerId = String(this.#ctx.employeeId);

    /* "Team" is the reporting closure, exactly as every other team-scoped read
       resolves it — never a department mapping. A viewer whose closure cannot
       be read falls back to themselves rather than to everybody. */
    let scopeIds = new Set<string>([viewerId]);
    if (q.scope === "team") {
      try {
        const viewer = await this.getViewer();
        scopeIds = new Set<string>([viewerId, ...viewer.hierarchyIds.map(String)]);
      } catch {
        scopeIds = new Set<string>([viewerId]);
      }
    }
    const inScope = (id: string | null | undefined) =>
      !!id && scopeIds.has(String(id));

    const docs = await this.#taskDocuments(viewerId);
    const tasks = docs
      .map((raw) => readTask(raw))
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .filter((t) => !t.isDeleted);

    const events: FlowEvent[] = [];
    for (const t of tasks) {
      const createdIso = t.createdAtMs
        ? new Date(t.createdAtMs).toISOString()
        : null;
      const assignedHere = t.assigneeIds.some(inScope) || inScope(t.pendingAssigneeId);
      const createdHere = inScope(t.createdById) || inScope(t.originalAssignedBy);

      /* Two populations, not one event twice — work pushed out against work
         landed on. Legacy assigns at creation, so both read `createdAt`. */
      if (createdHere) events.push({ at: createdIso, channel: "created" });
      if (assignedHere) events.push({ at: createdIso, channel: "assigned" });

      /* A departure counts only for the scope that was CARRYING the work.
         Counting a close against the person who handed it out would show a
         manager clearing everything their team finished. */
      if (assignedHere) {
        const status = String(t.status ?? "");
        const closedIso = t.updatedAtMs
          ? new Date(t.updatedAtMs).toISOString()
          : createdIso;
        if (CLOSED_LEGACY_STATUSES.includes(status))
          events.push({ at: closedIso, channel: "completed" });
        if (APPROVED_LEGACY_STATUSES.includes(status))
          events.push({ at: closedIso, channel: "approved" });
        if (CANCELLED_LEGACY_STATUSES.includes(status))
          events.push({ at: closedIso, channel: "cancelled" });

        for (const r of t.reworkHistory) {
          events.push({ at: r.requestedAt, channel: "rework" });
        }
      }
    }

    return buildWorkloadFlow(events, Date.now(), q.weeks);
  }

  async getCurrentEmployee(): Promise<Employee | null> {
    const map = await this.#employeesById();
    return map.get(String(this.#ctx.employeeId)) ?? null;
  }

  /**
   * Set — or remove — your own profile picture.
   *
   * **Self only, and there is no id parameter to make it otherwise.** Legacy's
   * own settings page writes exactly one document, its author's
   * (`cowork-old-frontend/app/coworking/settings/page.js:124`), and the engine
   * exposes no route that could answer "may this person change that person's
   * face". A method that took an id would be asking a question nothing can
   * decide.
   *
   * ## Another browser-to-Firestore write, and the same named exception
   *
   * The engine has no endpoint for this field. `cowork_employees.profilePicUrl`
   * is written straight from the browser by the old application today, which is
   * both why the Firestore rules already permit it and why writing it here adds
   * a CALLER rather than a capability — the same argument the timer,
   * `cowork_duty_status` and `cowork_settings` rest on.
   *
   * The value is validated here as well as at the picker, because the size that
   * matters is the ENCODED one and a file picker cannot know it until the canvas
   * has run.
   */
  async setMyProfilePicture(
    dataUrl: string | null,
  ): Promise<ActionResult<Employee>> {
    const employeeId = String(this.#ctx.employeeId ?? "");
    if (!employeeId)
      return {
        ok: false,
        code: "permission_denied",
        message: "Sign in to change your profile picture.",
      };

    if (dataUrl !== null) {
      const refusal = storedPictureRefusal(dataUrl);
      if (refusal)
        return { ok: false, code: "validation_failed", message: refusal };
    }

    const { doc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    try {
      /* `updateDoc`, never `setDoc(..., { merge: true })`: a missing employee
         record must fail loudly rather than be created as a document holding
         nothing but a face. */
      await updateDoc(doc(legacyDb(), "cowork_employees", employeeId), {
        /* LEGACY'S FIELD NAME. The old app reads this same key, so a picture set
           here shows up there and vice versa — one picture per person, not two. */
        profilePicUrl: dataUrl,
      });
    } catch (error) {
      return {
        ok: false,
        code: "conflict",
        message:
          error instanceof Error
            ? `Your picture could not be saved: ${error.message}`
            : "Your picture could not be saved.",
      };
    }

    /* Written through rather than invalidated — see `#ownPicture`. */
    this.#ownPicture = dataUrl;
    const map = await this.#employeesById();
    const me = map.get(employeeId);
    if (me) map.set(employeeId, { ...me, profilePictureUrl: dataUrl });
    notifyRepositoryChanged();

    const updated = map.get(employeeId);
    if (!updated)
      return {
        ok: false,
        code: "not_found",
        message: "Your employee record could not be read back.",
      };
    return { ok: true, data: updated };
  }

  /**
   * The running timer, read from Firestore.
   *
   * `cowork_task_timers/{employeeId}/sessions/{taskId}` — a **subcollection**,
   * so a flat query finds nothing. Legacy writes these documents straight from
   * the browser and there is no REST endpoint, which is why this reads Firestore
   * directly rather than calling the backend.
   *
   * A one-shot read, matching the `getActiveTimer()` contract the card expects.
   * The live listener is `useTaskTimer`, ported verbatim, for surfaces that need
   * the ticking value rather than a snapshot.
   *
   * A session is running when `isActive` says so. Whichever started most
   * recently wins if several are open.
   *
   * ## This read the wrong field name, and returned null for everything
   *
   * It asked for `data.startedAt`, and skipped any document without one. The
   * legacy writer — `hooks/useTaskTimer.js` in `Coworking`, the only thing that
   * writes this collection — stores `{ totalSeconds, isActive, lastStartTime,
   * taskTitle }`. There is no `startedAt` on any session document, so
   * `readInstant` returned null every time and the loop skipped every session:
   * against the real backend this method could only ever answer "nothing is
   * running", however many timers were.
   *
   * `toTimerSession` a few hundred lines up already read `lastStartTime`
   * correctly, which is why `TimerControl` showed a live clock on the task row
   * while the shell pill, the Now card, the stats row and Today's Work all
   * showed nothing. One collection, two readers, one of them looking for a
   * field that was never written.
   *
   * Both spellings are accepted per the adapter's rule for legacy's duplicate
   * field names, so a document from any vintage reads.
   */
  async getActiveTimer() {
    const employeeId = String(this.#ctx.employeeId);
    const { collection, getDocs } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    let running: {
      taskId: string;
      startedAtMs: number;
      totalSecs: number;
      title: string;
    } | null = null;
    try {
      const snap = await getDocs(
        collection(legacyDb(), "cowork_task_timers", employeeId, "sessions"),
      );
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        /* A paused session keeps its document. Without this check the most
           recently *touched* session would be reported as running forever. */
        if (data.isActive !== true) return;
        /* The SAME reading the task page uses — see `readTimerFigures`. These
           two read one document and used to disagree about it. */
        const { accumulatedSecs, startedAtRealMs } = readTimerFigures(data);
        if (startedAtRealMs === null) return;
        if (!running || startedAtRealMs > running.startedAtMs) {
          running = {
            taskId: d.id,
            startedAtMs: startedAtRealMs,
            totalSecs: accumulatedSecs,
            /* Written beside the session by `startTimer`, so it is already in
               this snapshot. A session written before the field existed falls
               back to the id — a real handle on the task, not an invented
               name. */
            title:
              typeof data.taskTitle === "string" && data.taskTitle.trim()
                ? data.taskTitle.trim()
                : "",
          };
        }
      });
    } catch {
      /* An unreadable timer must not blank the card that shows it. */
      return null;
    }
    if (!running) return null;
    const session = running as {
      taskId: string;
      startedAtMs: number;
      totalSecs: number;
      title: string;
    };

    /**
     * **The title comes off the session document, which is already in hand.**
     *
     * It used to come from `listTasks({ scope: "all" })` — every task this
     * viewer may see, fetched to fill one display string. The comment beside it
     * claimed it "costs no extra request"; it cost the largest one in the
     * repository.
     *
     * That mattered far beyond this method. `startTimer` awaits
     * `getActiveTimer()` to find out what else is running, so EVERY press of
     * Play or Resume waited on the whole task list. `Promise.all` waits for its
     * slowest member, so parallelising the reads around it did not help — this
     * was still the floor, and on a slow connection it outlasted
     * `TIMER_WRITE_TIMEOUT_MS` and returned "That did not reach the server in
     * time" with the clock still off.
     *
     * The same mistake as the `#readTaskView` call removed from `startTimer`,
     * one level deeper: an expensive fetch paying for a label that decides
     * nothing.
     */

    return {
      organisationId: LEGACY_ORGANISATION_ID,
      taskId: session.taskId,
      employeeId,
      isActive: true,
      accumulatedSecs: session.totalSecs,
      startedAt: new Date(session.startedAtMs).toISOString(),
      startedAtRealMs: session.startedAtMs,
      taskTitle: session.title,
      loggedSecs: session.totalSecs,
    };
  }

  /**
   * Every task document this viewer may see, by their role.
   *
   * Transcribed from the ported hook. The role branches are the visibility
   * model — widening one shows somebody a colleague's work, dropping one hides
   * work they own — so they are copied rather than reasoned about afresh.
   *
   * Merged by id across queries, because Firestore cannot express
   * "created by me OR assigned to me" in a single one.
   */
  async #taskDocuments(viewerId: string): Promise<Record<string, unknown>[]> {
    const { collection, getDocs, limit, orderBy, query, where } =
      await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const role = String(this.#ctx.legacyRole ?? "employee");
    const ref = collection(legacyDb(), "cowork_tasks");

    const queries = [];
    /**
     * **Work you ASSIGNED, whatever your role.**
     *
     * This query used to be for a TL or a CEO only, and an ordinary employee got
     * `assigneeIds array-contains` alone — so a task they had given to somebody
     * else was reachable only while it happened to be theirs too. It is not:
     * `taskForward.js` writes `assigneeIds: []` on a cross-department task and
     * parks the target in `pendingAssigneeId`, so nothing an employee queried
     * could match it. They sent the work to another department and it vanished
     * from their own list the moment the approvals cleared and it stopped
     * appearing in the held-task query below.
     *
     * Seniority was never the right test. Whether you can see a task you
     * assigned is a question about YOUR relationship to that task, and the
     * answer is the same for everybody.
     */
    queries.push(query(ref, where("assignedBy", "==", viewerId), orderBy("updatedAt", "desc"), limit(100)));
    queries.push(query(ref, where("assigneeIds", "array-contains", viewerId), orderBy("updatedAt", "desc"), limit(100)));
    if (role === "ceo") {
      queries.push(query(ref, where("approverId", "==", viewerId), orderBy("updatedAt", "desc"), limit(100)));
    }

    /* Tasks held at a cross-department gate.
     *
     * These are invisible to every query above, and not by accident: the gate
     * creates them with **empty `assigneeIds`** and parks the target in
     * `pendingAssigneeId` (`taskForward.js:338`), so `array-contains` cannot
     * match and `assignedBy` only matches the sender. The approver — the one
     * person who has to act — saw nothing at all.
     *
     * Queried by status alone, exactly as `page.js:3596` does, because
     * Firestore cannot filter on a field inside `departmentApprovals[]`. The
     * scoping is done below on the returned documents. That is legacy's own
     * trade and it is why this query carries no `orderBy`: adding one would
     * need another composite index for a set that is small by construction —
     * only tasks actively waiting on a decision are ever in it. */
    queries.push(query(ref, where("status", "==", "pending_department_approval"), limit(100)));

    /**
     * Tasks whose TIME BUDGET is waiting on this viewer to decide.
     *
     * Invisible to every query above, and for a reason that is only obvious
     * once written down. A SELF-ASSIGNED task is raised by the person who will
     * do it, so `assignedBy` and `assigneeIds` both name THEM — and the person
     * who has to decide the hours is their MANAGER, who appears in neither.
     * `approverId` would reach it, but that query is CEO-only.
     *
     * So the manager's copy of the task was never fetched at all. Their
     * Actionable tab said "Nothing waiting on you" while the task itself said
     * "Waiting for {manager} to decide" — the two screens reading the same
     * record and disagreeing, because one of them could not see it.
     *
     * `actionable.ts` already handles this case correctly (`budgetTurn`); it
     * had nothing to handle it ON. This is the missing document, not a missing
     * rule.
     *
     * **No `orderBy`, deliberately** — the same trade the gate query above
     * makes. A `where` on one field ordered by another needs a composite index
     * and a deploy; without one this rides the automatic single-field index and
     * works the moment it ships. The set is small by construction: only budgets
     * actively waiting on somebody are ever in it, and `listTasks` sorts the
     * merged result anyway.
     */
    queries.push(
      query(
        ref,
        where("budgetNegotiation.waitingForId", "==", viewerId),
        limit(100),
      ),
    );

    /* Folder parents, backfilled for employees only (`page.js:3872-3910`).
     *
     * An employee's single query returns tasks assigned to them, which for
     * work filed in a folder means the CHILD without the folder above it. The
     * folder is not assigned to anyone, so no query of theirs can reach it,
     * and the grouping collapses — every foldered task appears loose at the
     * top level.
     *
     * A TL or CEO needs none of this: they already receive the folder through
     * `assignedBy`, having created it.
     *
     * Legacy's own test for "is this a folder" is deliberately loose — the
     * flag, OR an absent flag on a task with no assignees — because folders
     * predate the flag and the older ones simply have no assignees. Both are
     * then forced to `isFolder: true` so the rest of the pipeline treats them
     * alike. Copied rather than tightened: narrowing it here would drop the
     * historical folders that motivated the looseness. */
    const backfillFolderParents = async (
      loaded: Map<string, Record<string, unknown>>,
    ): Promise<void> => {
      if (role === "ceo" || role === "tl") return;
      const missing = [
        ...new Set(
          [...loaded.values()]
            .map((t) => t.parentTaskId)
            .filter(
              (id): id is string =>
                typeof id === "string" && id !== "" && !loaded.has(id),
            ),
        ),
      ];
      if (missing.length === 0) return;

      const { doc, getDoc } = await import("firebase/firestore");
      const snaps = await Promise.all(
        missing.map((id) => getDoc(doc(legacyDb(), "cowork_tasks", id))),
      );
      for (const snap of snaps) {
        if (!snap.exists()) continue;
        const data = snap.data() as Record<string, unknown>;
        const isFolder =
          data.isFolder === true ||
          (data.isFolder === undefined &&
            !(Array.isArray(data.assigneeIds) && data.assigneeIds.length > 0));
        if (!isFolder) continue;
        loaded.set(snap.id, { ...data, id: snap.id, isFolder: true });
      }
    };

    /* Failures are RAISED, not swallowed.
       These used to be `.catch(() => null)`, which hid the single most likely
       fault: a `where(...) + orderBy(...)` pair needs a Firestore composite
       index, and without one the query throws. Swallowing it emptied the task
       list with no error anywhere — indistinguishable from having no tasks.
       Firestore's own message names the index and links to create it, so it is
       worth far more on screen than silence. */
    const merged = new Map<string, Record<string, unknown>>();
    const snaps = await Promise.all(
      queries.map((q) =>
        getDocs(q).catch((error: unknown) => {
          throw asIndexError(error, role);
        }),
      ),
    );
    for (const snap of snaps) {
      snap.forEach((d) => {
        merged.set(d.id, { ...(d.data() as Record<string, unknown>), id: d.id });
      });
    }
    await backfillFolderParents(merged);
    return [...merged.values()];
  }

  /**
   * The score ledger, from the SOP points record.
   *
   * `GET /cowork/sop/bleach/:employeeId` → `Employee.sopPoints[]` in MongoDB.
   * This is legacy's ledger: every entry that moved somebody's score, with who
   * applied it and when.
   *
   * **The credit/debit inversion is handled once, in `lib/legacy/wire.ts`.**
   * Legacy's `bleachType: "credit"` means a VIOLATION — it raises the penalty —
   * and `"debit"` is a reward. `signedPoints()` converts that to a signed value
   * where positive is a penalty, matching `totalDeducted`'s own direction, so
   * these entries sum to the figure `pmpService` computed. Anything that read
   * the raw words would have the sign backwards.
   *
   * Entries carry `type: "C1".."C4"`, so this is not a conduct-only ledger —
   * filtering by component is a filter, not a different source.
   *
   * Fields the domain keeps that legacy does not send — rule ids, config
   * snapshots, before/after totals — are empty or zero rather than derived.
   * Deriving `pointsBefore`/`pointsAfter` would mean recomputing a running
   * total this side of the engine, and a total computed twice eventually
   * disagrees with itself.
   */
  async listLedger(employeeId: EmployeeId, component?: string) {
    const token = await this.#token();
    const result = await fetchLedger({ token, employeeId: String(employeeId) });
    if (!result.ok) throw new Error(result.error.message);

    const wanted = component ? String(component).toUpperCase() : null;
    const entries = result.data.flatMap((year) =>
      year.entries
        .filter((e) => !wanted || e.component === wanted)
        .map((e, i) => ({
          organisationId: LEGACY_ORGANISATION_ID,
          /* The entry's own id where legacy sends one. The old composite —
             year plus RULE id — repeated itself whenever the same rule was
             applied to somebody twice, and `requestConductRecheck` addresses
             one deduction, so it needs the one that is actually unique. */
          id: e.entryId ?? `${year.year}-${e.sopId ?? e.policyId ?? i}`,
          employeeId: String(employeeId),
          component: (e.component ?? "C3").toLowerCase() as never,
          sourceType: (e.policyId ? "conduct_event" : "task") as never,
          sourceId: e.sopId ?? e.policyId ?? "",
          sourceLabel: e.name,
          scoreUnitId: "",
          eventType: (e.isPenalty ? "deduction" : "credit") as never,
          maximumPoints: 0,
          /* Signed once, at the wire boundary. Positive = penalty. */
          deduction: e.isPenalty ? e.points : 0,
          credit: e.isPenalty ? 0 : Math.abs(e.points),
          pointsBefore: 0,
          pointsAfter: 0,
          reason: e.description ?? "",
          actorId: (e.appliedByName ? e.appliedByName : "system") as never,
          actorLabel: e.appliedByName ?? "System",
          effectiveDate: e.date ?? "",
          periodKey: String(year.year),
          createdAt: e.date ?? "",
          ruleId: "",
          ruleVersion: "",
          configSnapshot: {},
          isManualAdjustment: e.sopId === null && e.policyId === null,
          adjustmentReason: null,
          reversalOf: null,
          /* The argument about this entry, carried through rather than
             dropped. The reader is the person whose score it is: they have to
             see that they already asked, and what the answer was. */
          disputeStatus: e.recheck.status,
          disputeNote: e.recheck.requestNote,
          disputeReviewNote: e.recheck.reviewNote,
          disputeReviewedBy: e.recheck.reviewedByName,
        })),
    );
    return entries;
  }

  /* ── C3 · the conduct rules and the four acts ────────────────────────────
   *
   * Every one of these is a REQUEST. The engine decides who may do it, from
   * the reporting line — a rule is approved by its author's own manager, a
   * breach applied by the employee's own manager, a dispute settled by that
   * same person — and refuses everyone else. `lib/rules/scoring/conduct.ts`
   * asks the same questions on this side so the interface can grey out a
   * control before it is pressed, but the refusal that matters comes from the
   * engine and is shown as it was written.
   */

  /**
   * One legacy rule as a `ConductPolicy`.
   *
   * `department` is a name in legacy and an id in the domain; there is no
   * department id on a SOP to map, so `departmentIds` stays empty and `scope`
   * is derived from whether the rule names a department at all.
   */
  #toConductPolicy(sop: LegacySop): ConductPolicy {
    return {
      organisationId: LEGACY_ORGANISATION_ID,
      id: sop.id,
      name: sop.name,
      description: sop.description ?? "",
      percent: sop.percent,
      severity: sop.severity,
      scope: sop.department ? "department" : "global",
      departmentIds: [],
      /* Legacy has no active flag on a rule; a rejected one is the closest
         thing it has to withdrawn, and `isApplicable` is the engine's own
         answer to "may this be applied". */
      isActive: sop.status !== "rejected",
      status: sop.status,
      createdById: sop.createdById,
      createdByName: sop.createdByName,
      approverId: sop.approverId,
      approverName: sop.approverName,
      decidedByName: sop.approvedByName,
      rejectedReason: sop.rejectedReason,
    };
  }

  /** A legacy refusal as an `ActionResult`, keeping the engine's wording. */
  #refusal(error: { kind: string; message: string }): ActionResult<never> {
    return {
      ok: false,
      code:
        error.kind === "permission"
          ? "permission_denied"
          : error.kind === "not_found"
            ? "not_found"
            : "validation_failed",
      message: error.message,
    };
  }

  async listConductPolicies(): Promise<ConductPolicy[]> {
    const result = await listSops(await this.#token());
    if (!result.ok) throw new Error(result.error.message);
    return result.data.map((s) => this.#toConductPolicy(s));
  }

  async createConductPolicy(input: {
    name: string;
    percent: number;
    description: string;
    severity: ConductSeverity | null;
    scope: "global" | "department";
    departmentIds: string[];
  }): Promise<ActionResult<ConductPolicy>> {
    /**
     * Legacy stores the department by NAME, and **requires one**.
     *
     * The domain passes ids, so a chosen department is resolved back through
     * the directory. What is new is the fallback: an unnamed department used to
     * send `""`, and the engine refuses that — `name, percent, description,
     * department are required`. So a rule written from the C3 page, which asks
     * for no department at all, could never be saved.
     *
     * A rule written by somebody with no department chosen is filed under THEIR
     * OWN — owner decision. It is the department the rule came out of, it keeps
     * the rule visible to the team it was written for (the catalogue is filtered
     * by department for a team lead), and it asks the author for nothing.
     */
    const chosen =
      input.scope === "department"
        ? ((await this.listDepartments()).find(
            (d) => d.id === input.departmentIds[0],
          )?.name ?? "")
        : "";
    const department =
      chosen ||
      (await this.#employeesById()).get(String(this.#ctx.employeeId))
        ?.departmentName ||
      "";

    const result = await createSop({
      token: await this.#token(),
      name: input.name,
      percent: input.percent,
      description: input.description,
      department,
      severity: input.severity,
    });
    if (!result.ok) return this.#refusal(result.error);

    const written = readSop(result.data.sop);
    if (!written) {
      return {
        ok: false,
        code: "validation_failed",
        message: "The rule was saved but came back unreadable.",
      };
    }
    return { ok: true, data: this.#toConductPolicy(written) };
  }

  async listConductApprovals(): Promise<ConductPolicy[]> {
    const result = await fetchPendingApprovals({ token: await this.#token() });
    if (!result.ok) throw new Error(result.error.message);
    return result.data.map((s) => this.#toConductPolicy(s));
  }

  async decideConductPolicy(
    id: string,
    decision: "approve" | "reject",
    reason?: string,
  ): Promise<ActionResult<void>> {
    const result = await decideSop({
      token: await this.#token(),
      sopId: id,
      decision,
      reason,
    });
    return result.ok
      ? { ok: true, data: undefined }
      : this.#refusal(result.error);
  }

  async applyConductPolicy(input: {
    employeeId: EmployeeId;
    policyId: string;
    reason: string;
  }): Promise<ActionResult<void>> {
    const result = await applySop({
      token: await this.#token(),
      targetEmployeeId: String(input.employeeId),
      sopId: input.policyId,
      description: input.reason,
    });
    return result.ok
      ? { ok: true, data: undefined }
      : this.#refusal(result.error);
  }

  async requestConductRecheck(input: {
    entryId: string;
    note: string;
  }): Promise<ActionResult<void>> {
    /* Always the viewer's own record. The engine refuses an employee raising a
       dispute on somebody else's, and nothing in the interface offers it. */
    const result = await requestRecheck({
      token: await this.#token(),
      employeeId: String(this.#ctx.employeeId),
      entryId: input.entryId,
      note: input.note,
    });
    return result.ok
      ? { ok: true, data: undefined }
      : this.#refusal(result.error);
  }

  async listConductDisputes() {
    const result = await fetchPendingRechecks({ token: await this.#token() });
    if (!result.ok) throw new Error(result.error.message);
    return result.data.flatMap((person) =>
      person.entries.map((e) => ({
        employeeId: person.employeeId,
        employeeName: person.employeeName,
        entryId: e.entryId,
        policyName: e.name,
        percent: e.points,
        date: e.date,
        requestNote: e.requestNote,
      })),
    );
  }

  async decideConductRecheck(input: {
    employeeId: EmployeeId;
    entryId: string;
    overturn: boolean;
    note: string;
  }): Promise<ActionResult<void>> {
    const result = await reviewRecheck({
      token: await this.#token(),
      employeeId: String(input.employeeId),
      entryId: input.entryId,
      /* `"confirm"` REVERSES the deduction in legacy's vocabulary — it
         confirms the employee's complaint, not the penalty. The word stops
         here; `overturn` is what the rest of the project says. */
      action: input.overturn ? "confirm" : "reject",
      reviewNote: input.note,
    });
    return result.ok
      ? { ok: true, data: undefined }
      : this.#refusal(result.error);
  }

  /**
   * Score units for one component, from the engine's own breakdown.
   *
   * `GET /cowork/pmp/:id/c1` and `/c2`, mapped from live payloads captured at
   * `/legacy/validate`. Nothing is computed — `c1Net`, `c2Max` and the rest are
   * passed through as the engine sent them, including `null`, which means "not
   * scored" and is not the same as zero.
   *
   * Both are fetched when no component is named, because a caller asking for
   * "all units" wants both channels; the engine has no combined endpoint.
   */
  async listScoreUnits(
    employeeId: EmployeeId,
    component?: string,
    periodKey?: string,
  ) {
    const token = await this.#token();
    const id = encodeURIComponent(String(employeeId));
    const wanted = component ? String(component).toLowerCase() : null;
    const units: ScoreUnit[] = [];

    if (!wanted || wanted === "c1") {
      const r = await legacyFetch<LegacyC1Response>({ path: `/cowork/pmp/${id}/c1`, token });
      if (r.ok) units.push(...toC1Units(r.data));
    }
    if (!wanted || wanted === "c2") {
      const r = await legacyFetch<LegacyC2Response>({ path: `/cowork/pmp/${id}/c2`, token });
      /* C2 carries no quarter or year, so the period comes from the request. */
      if (r.ok) units.push(...toC2Units(r.data, periodKey ?? ""));
    }
    /* C3 and C4 have no breakdown endpoint. Their figures reach the UI through
       `getScoreOverview`, which is already connected. */
    return units;
  }

  /**
   * Score history — `annual.quarters[]` from the dashboard.
   *
   * This used to return empty on the reasoning that `/pmp/:id/dashboard`
   * answers for one quarter and no route returns a series. **Half right**: it
   * answers for one quarter AND returns the whole annual strip alongside it,
   * every quarter with its score, status, weight and channels. The live payload
   * settled it; the route file had not.
   *
   * So no stitching of quarter-by-quarter requests, and no invented periods —
   * one request, and the engine names the periods itself.
   */
  async listScoreHistory(employeeId?: EmployeeId) {
    const id = String(employeeId ?? this.#ctx.employeeId);
    const token = await this.#token();
    const result = await fetchDashboard({ token, employeeId: id });
    if (!result.ok) throw new Error(result.error.message);
    return toScoreHistory(result.data);
  }

  /**
   * Monitoring, attendance and goals — no path from this frontend.
   *
   * | Method | Why |
   * |---|---|
   * | monitoring ×7 | Firestore + LiveKit only. Legacy writes them from its own browser; there is no REST endpoint |
   * | `listAttendance` | `/api/employee/attendance/*` needs the **HR JWT**, a second credential this app does not hold |
   * | `listGoals` | `/cowork/task/:id/goal-activities` exists but has never been exercised — and goal activities carry points feeding C2, so mapping it from the route file rather than a real response is how a score comes out wrong |
   *
   * Empty rather than throwing: `/people` and `/team` mount these, and a
   * rejection blanks the page instead of the panel.
   */
  /**
   * The monitoring roster — **still empty, and the caller must not read that as
   * "this manager has nobody".**
   *
   * `TeamMonitoringRow` requires `workloadPercent` and `workloadBand`, and the
   * domain is explicit that both are *stated, not derived*. Legacy states hours
   * (`/cowork/workload/summary` sends `totalHours`, `pendingHours`,
   * `overdueCount`) and no capacity to divide them by, so a percentage invented
   * here would be a figure about somebody's workload that nothing measured —
   * and filling it with 0 is the same fabrication wearing a friendlier face.
   *
   * It resolves rather than throwing because `workMap.test.ts` pins that: a
   * rejection from any of the `/team` reads takes the page down instead of the
   * panel. So the honest signal has to be carried by the caller, and
   * `MonitoringArea` now distinguishes an empty roster from an unavailable one
   * by asking the viewer whether they have reports at all.
   *
   * The manager's live-screen path does NOT depend on this: `/team/{id}` reads
   * `getMonitoringSubject`, which is wired above and carries the
   * `presenceIdentity` the viewer matches on.
   */
  async listTeamMonitoring() { return []; }
  /**
   * The person a manager is watching.
   *
   * **This returning `null` is why a manager could join the room and never see
   * a screen.** Nothing was wrong with LiveKit: the employee published
   * correctly under `employee-<id>`, the manager's seat subscribed, and the
   * track arrived. But `LiveScreenViewer` matches incoming tracks against
   * `subject.presenceIdentity`, and with no subject there was no identity to
   * match — `PersonMonitor` rendered `NoSubjectFrame` instead of the viewer at
   * all, and `ScreenDialog` was handed `presenceIdentity=""`, which equals no
   * participant that has ever existed. The screen was in the room the whole
   * time with nobody asking for it.
   *
   * Every field below comes from something real. `presenceIdentity` is derived
   * by the same function the publisher uses, so the two cannot disagree about
   * who a track belongs to — that shared derivation is the entire point of
   * `lib/integrations/livekit/identity.ts`.
   *
   * Nothing is invented to fill the shape. `onlineSecondsToday` comes from the
   * duty document's own `dailyHours`, the current activity from the running
   * timer, and where legacy holds nothing the field is null rather than zero.
   */
  async getMonitoringSubject(
    employeeId: EmployeeId,
  ): Promise<MonitoringSubject | null> {
    const id = String(employeeId);

    /* **Resolves to null on failure rather than rejecting**, which is not the
       repository's usual "failures raise" rule and is pinned by
       `workMap.test.ts`: a rejection from any `/team` read takes the page down
       instead of the panel that asked. Null is also the honest answer here —
       an unidentifiable subject is no subject — and the viewer's own
       placeholder says which of the reasons applies. Logged rather than
       swallowed, so a token problem is still visible to whoever is looking. */
    let person: Employee | undefined;
    let doc: DutyDocument | null = null;
    let running: { taskId: string; taskTitle: string } | null = null;
    try {
      person = (await this.#employeesById()).get(id);
      /* Absent from the directory is a real state — somebody may have left —
         and a placeholder subject would put a fabricated name over a live
         screen, which is the mis-attribution the identity match exists to
         prevent. */
      if (!person) return null;
      doc = await this.#readDutyDoc(id);
      running = await this.#runningSessionOf(id);
    } catch (error) {
      console.error("[monitoring] subject could not be resolved:", error);
      return null;
    }

    const now = Date.now();

    return {
      employeeId: id,
      displayName: person.displayName,
      initials: person.initials,
      hue: person.hue,
      departmentName: person.departmentName || null,
      designation: person.designation || null,
      /* **The field the whole viewer turns on.** */
      presenceIdentity: presenceIdentityFor(id),
      presence: readDutyMode(doc, now),
      /* When the current claim was last proven, not when the person signed in.
         Null when nothing is claimed, which is the honest answer rather than
         a timestamp standing in for "never". */
      presenceSince:
        typeof doc?.heartbeatAt === "number"
          ? new Date(doc.heartbeatAt).toISOString()
          : null,
      onlineSecondsToday: dailyHoursSecs(doc, now),
      currentActivity: running?.taskTitle ?? null,
      currentTaskId: running?.taskId ?? null,
      timezone: person.timezone,
    };
  }

  /**
   * Somebody else's running timer.
   *
   * `getActiveTimer` answers for the acting employee only; a manager needs it
   * for the person they are watching, which is the same subcollection under a
   * different id. Read-only and failure-tolerant: an unreadable timer must
   * leave the activity line blank, not take down the page around it.
   */
  async #runningSessionOf(
    employeeId: string,
  ): Promise<{ taskId: string; taskTitle: string } | null> {
    try {
      const { collection, getDocs } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const snap = await getDocs(
        collection(legacyDb(), "cowork_task_timers", employeeId, "sessions"),
      );
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        if (data.isActive !== true) continue;
        return {
          taskId: d.id,
          taskTitle:
            typeof data.taskTitle === "string" && data.taskTitle.trim()
              ? data.taskTitle
              : d.id,
        };
      }
    } catch {
      /* Fall through to null. */
    }
    return null;
  }
  async getMonitoringPerformance() { return null; }
  async getDailySummary() { return null; }
  async getDeviceInfo() { return null; }
  async listActivityEvents() { return []; }
  async listObservations() { return []; }
  async listAttendance() { return []; }
  async recordAttendance(): Promise<ActionResult<AttendanceDay>> {
    /* The legacy backend has no attendance-write endpoint — attendance was
       ingested from HR only. Recording is a new-model action; the mock backend
       carries it. */
    return {
      ok: false,
      code: "offline",
      message: "Recording attendance is not available on the legacy backend.",
    };
  }
  /**
   * The Timer SOP engine already exists on the legacy backend — its config is
   * the Firestore document `cowork_sop_settings/task_events` (the same one the
   * old SOP settings page writes) and its accumulators come from
   * `GET /cowork/timer-sop/accum/:employeeId`. These map the new UI onto them.
   */
  async getTimerSopConfig(): Promise<TimerSopConfig> {
    try {
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const { doc, getDoc } = await import("firebase/firestore");
      const snap = await getDoc(doc(legacyDb(), "cowork_sop_settings", "task_events"));
      const d = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
      const num = (v: unknown, fallback: number) => {
        const n = parseFloat(String(v));
        return Number.isFinite(n) ? n : fallback;
      };
      return {
        enabled: d.timerSopEnabled === true,
        dailyMinHours: num(d.timerMinDailyHrs, DEFAULT_TIMER_SOP_CONFIG.dailyMinHours),
        dailyMinPercent: num(d.timerMinDailyPct, DEFAULT_TIMER_SOP_CONFIG.dailyMinPercent),
        deficitThresholdHours: num(
          d.timerDeficitThresholdHrs,
          DEFAULT_TIMER_SOP_CONFIG.deficitThresholdHours,
        ),
        deficitPoints: num(d.timerDeficitPoints, DEFAULT_TIMER_SOP_CONFIG.deficitPoints),
        overtimeThresholdHours: num(
          d.timerOvertimeThresholdHrs,
          DEFAULT_TIMER_SOP_CONFIG.overtimeThresholdHours,
        ),
        overtimePoints: num(
          d.timerOvertimePoints,
          DEFAULT_TIMER_SOP_CONFIG.overtimePoints,
        ),
      };
    } catch {
      return { ...DEFAULT_TIMER_SOP_CONFIG };
    }
  }

  async setTimerSopConfig(
    config: TimerSopConfig,
  ): Promise<ActionResult<TimerSopConfig>> {
    try {
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const { doc, getDoc, setDoc } = await import("firebase/firestore");
      const ref = doc(legacyDb(), "cowork_sop_settings", "task_events");
      /* The engine stamps `timerSopEnabledAt` when it is switched on and uses it
         for its off-period amnesty. Keep an existing stamp; set a new one only on
         the transition into enabled. */
      let enabledAt: unknown = undefined;
      if (config.enabled) {
        const snap = await getDoc(ref);
        const prev = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
        enabledAt =
          prev.timerSopEnabled === true && prev.timerSopEnabledAt
            ? prev.timerSopEnabledAt
            : new Date();
      }
      await setDoc(
        ref,
        {
          timerSopEnabled: config.enabled,
          ...(config.enabled ? { timerSopEnabledAt: enabledAt } : {}),
          timerMinDailyHrs: config.dailyMinHours,
          timerMinDailyPct: config.dailyMinPercent,
          timerDeficitThresholdHrs: config.deficitThresholdHours,
          timerDeficitPoints: config.deficitPoints,
          timerOvertimeThresholdHrs: config.overtimeThresholdHours,
          timerOvertimePoints: config.overtimePoints,
        },
        { merge: true },
      );
      return { ok: true, data: { ...config } };
    } catch (e) {
      return {
        ok: false,
        code: "offline",
        message:
          e instanceof Error
            ? e.message
            : "The engine settings could not be saved.",
      };
    }
  }

  async getTimerSopStatus(employeeId?: EmployeeId): Promise<TimerSopStatus> {
    const config = await this.getTimerSopConfig();
    const subject = employeeId || this.#ctx.employeeId;
    if (!config.enabled) {
      return {
        employeeId: subject,
        config,
        result: evaluateTimerSop([], config),
        today: null,
      };
    }
    /* Today's live target — computed from the office schedule and today's
       reconstructed work segments. Best-effort: if the work log cannot be read
       the card still shows the target with nothing worked yet. */
    let today = null as TimerSopStatus["today"];
    try {
      const policy = await this.getOfficePolicy();
      const istDate = new Date(Date.now() + 5.5 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      let commits: WorkCommit[] = [];
      try {
        commits = await this.#timerCommitsForDay(subject, istDate);
      } catch {
        commits = [];
      }
      today = computeTodayTarget(todayWindow(commits, policy, istDate), config);
    } catch {
      today = null;
    }
    try {
      const token = await this.#token();
      /* Freshen the caller's own accumulators first — the engine evaluates the
         token's identity, so this only refreshes the signed-in person. */
      if (subject === this.#ctx.employeeId) {
        await legacyFetch({
          path: "/cowork/timer-sop/evaluate",
          method: "POST",
          token,
          body: { wait: true },
        });
      }
      const r = await legacyFetch<{
        timerDeficitAccumHrs?: number;
        timerOvertimeAccumHrs?: number;
      }>({
        path: `/cowork/timer-sop/accum/${encodeURIComponent(subject)}`,
        token,
      });
      const deficit = r.ok ? Number(r.data?.timerDeficitAccumHrs) || 0 : 0;
      const overtime = r.ok ? Number(r.data?.timerOvertimeAccumHrs) || 0 : 0;
      return {
        employeeId: subject,
        config,
        result: {
          paused: false,
          deficitAccumHours: deficit,
          overtimeAccumHours: overtime,
          /* The accumulator endpoint returns the running hours only; the
             cumulative points and trigger counts live in the score ledger and
             are not exposed here, so the counter shows the hours it can prove. */
          deficitTriggers: 0,
          overtimeTriggers: 0,
          pointsDeducted: 0,
          pointsAdded: 0,
          netPoints: 0,
          days: [],
        },
        today,
      };
    } catch {
      return {
        employeeId: subject,
        config,
        result: evaluateTimerSop([], config),
        today,
      };
    }
  }

  /**
   * Today's work segments, reconstructed from the legacy per-task cumulative
   * commit log into the new per-segment shape. Timestamps are shifted to IST so
   * they line up with the IST office schedule, matching the legacy engine.
   */
  async #timerCommitsForDay(
    employeeId: string,
    istDate: string,
  ): Promise<WorkCommit[]> {
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const { collection, getDocs } = await import("firebase/firestore");
    const snap = await getDocs(
      collection(legacyDb(), "cowork_work_commits", employeeId, "logs"),
    );

    const toMillis = (v: unknown): number | null => {
      if (!v) return null;
      const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
      if (typeof o.toMillis === "function") return o.toMillis();
      if (typeof o._seconds === "number") return o._seconds * 1000;
      if (typeof o.seconds === "number") return o.seconds * 1000;
      const t = new Date(v as string).getTime();
      return Number.isNaN(t) ? null : t;
    };

    const parsed: { taskId: string; stoppedMs: number; cumulative: number }[] = [];
    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const ms = toMillis(data.stoppedAt);
      const cum = Number(data.secondsWorked) || 0;
      if (ms === null || cum <= 0) return;
      parsed.push({ taskId: String(data.taskId ?? "_"), stoppedMs: ms, cumulative: cum });
    });

    const byTask = new Map<string, typeof parsed>();
    for (const p of parsed) {
      const arr = byTask.get(p.taskId) ?? [];
      arr.push(p);
      byTask.set(p.taskId, arr);
    }

    const IST = 5.5 * 3_600_000;
    const out: WorkCommit[] = [];
    for (const entries of byTask.values()) {
      entries.sort((a, b) => a.stoppedMs - b.stoppedMs);
      let prev = 0;
      for (const e of entries) {
        const secs =
          e.cumulative > prev
            ? e.cumulative - prev
            : e.cumulative < prev
              ? e.cumulative
              : 0;
        prev = e.cumulative;
        if (secs <= 0) continue;
        const endIso = new Date(e.stoppedMs + IST).toISOString();
        const startIso = new Date(e.stoppedMs - secs * 1000 + IST).toISOString();
        if (endIso.slice(0, 10) !== istDate && startIso.slice(0, 10) !== istDate)
          continue;
        out.push({
          organisationId: "",
          id: "",
          taskId: e.taskId,
          employeeId,
          startedAt: startIso,
          endedAt: endIso,
          durationSecs: secs,
          message: null,
          attachmentIds: [],
          pauseReason: "manual",
        });
      }
    }
    return out;
  }
  /* ── Material Request Forms ─────────────────────────────────────────────── */

  /** Legacy MRF (UPPERCASE enums, richer store lifecycle) → the cowork model. */
  #readMrf(raw: Record<string, unknown>): MrfRequest | null {
    const id = raw._id ?? raw.id;
    if (!id) return null;
    const up = (v: unknown) => String(v ?? "").toUpperCase();
    const status = ((): MrfStatus => {
      const u = up(raw.status);
      if (u === "PENDING") return "pending";
      if (u === "REJECTED" || u === "UNFULFILLED") return "rejected";
      if (u === "CANCELLED") return "cancelled";
      return "approved"; // approved and anything downstream at the store
    })();
    const itemStatus = (v: unknown): MrfItemStatus => {
      switch (up(v)) {
        case "PENDING": return "pending";
        case "APPROVED": return "approved";
        case "REJECTED": return "rejected";
        case "PARTIALLY_ISSUED": return "partially_issued";
        case "ISSUED": return "issued";
        case "PARTIALLY_RETURNED": return "partially_returned";
        case "RETURNED": return "returned";
        case "OVERDUE": return "overdue";
        case "UNFULFILLED": return "unfulfilled";
        default: return "approved";
      }
    };
    const availability = (v: unknown): MrfAvailability => {
      switch (up(v)) {
        case "AVAILABLE": return "available";
        case "PARTIAL": return "partial";
        case "NOT_AVAILABLE": return "not_available";
        case "ALTERNATIVE": return "alternative";
        default: return "unreviewed";
      }
    };
    const priority = ((): MrfRequest["priority"] => {
      const u = up(raw.priority);
      return u === "LOW" || u === "HIGH" || u === "URGENT"
        ? (u.toLowerCase() as MrfRequest["priority"])
        : "normal";
    })();
    const items = Array.isArray(raw.items) ? raw.items : [];
    const history = Array.isArray(raw.statusHistory) ? raw.statusHistory : [];
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      organisationId: "legacy",
      id: String(id),
      mrfNumber: String(raw.mrfNumber ?? id),
      requesterId: String(raw.requestedForId ?? raw.requesterCoworkId ?? ""),
      requesterName: String(raw.requestedForName ?? "Unknown"),
      requesterDepartment: s(raw.requestedForDept),
      requestType: up(raw.requestType) === "TIME_BASED" ? "time_based" : "uses_based",
      priority,
      reason: String(raw.reason ?? ""),
      neededBy: s(raw.neededBy),
      deadline: s(raw.deadline),
      status,
      approverId: s(raw.approverBiometricId),
      approverName: s(raw.approverName),
      autoForwarded: raw.autoForwarded === true,
      rejectionNote: s(raw.tlRejectionNote) ?? s(raw.rejectionNote),
      storeNote: s(raw.storeNotes),
      items: (items as Record<string, unknown>[]).map((it) => ({
        id: String(it._id ?? it.id ?? ""),
        name: String(it.rawItemName ?? it.itemName ?? "Item"),
        sku: s(it.rawItemSku),
        isUnmatched: !it.rawItem,
        requestedQty: Number(it.requestedQty) || 0,
        unit: String(it.unit ?? ""),
        description: s(it.description),
        status: itemStatus(it.itemStatus),
        issuedQty: Number(it.issuedQty) || 0,
        returnedQty: Number(it.returnedQty) || 0,
        availability: availability(it.availability),
        availableQty: it.availableQty == null ? null : Number(it.availableQty),
        availabilityNote: s(it.availabilityNote),
        rawItemId: it.rawItem ? String(it.rawItem) : null,
        variantId: it.variantId ? String(it.variantId) : null,
        variantCombination: Array.isArray(it.variantCombination)
          ? (it.variantCombination as unknown[]).map((x) => String(x))
          : [],
        images: (Array.isArray(it.images) ? it.images : [])
          .map((im) => {
            const o = (im ?? {}) as Record<string, unknown>;
            return typeof o.url === "string"
              ? {
                  url: o.url,
                  name: typeof o.name === "string" ? o.name : null,
                  fileId: typeof o.fileId === "string" && o.fileId ? o.fileId : null,
                }
              : null;
          })
          .filter(
            (x): x is { url: string; name: string | null; fileId: string | null } =>
              x !== null
          ),
      })),
      history: (history as Record<string, unknown>[]).map((h) => ({
        at: String(h.at ?? ""),
        action: String(h.action ?? "").toLowerCase(),
        actorName: String(h.actorName ?? "System"),
        detail: s(h.detail),
      })),
      createdAt: String(raw.createdAt ?? ""),
      updatedAt: String(raw.updatedAt ?? raw.createdAt ?? ""),
    };
  }

  async listMyMrfs() {
    const token = await this.#token();
    const r = await legacyFetch<{ mrfs?: Record<string, unknown>[] }>({
      path: "/api/cowork/mrf/",
      token,
    });
    const requests = r.ok
      ? (r.data.mrfs ?? [])
          .map((m) => this.#readMrf(m))
          .filter((m): m is MrfRequest => m !== null)
      : [];
    return { requests, stats: mrfStats(requests) };
  }

  async listMrfApprovals(status: MrfStatus | "all" = "pending") {
    const token = await this.#token();
    const legacyStatus =
      status === "all"
        ? "ALL"
        : status === "pending"
          ? "PENDING"
          : status.toUpperCase();
    const r = await legacyFetch<{
      mrfs?: Record<string, unknown>[];
      stats?: unknown;
    }>({
      path: "/api/cowork/mrf/approvals",
      query: { status: legacyStatus },
      token,
    });
    const requests = r.ok
      ? (r.data.mrfs ?? [])
          .map((m) => this.#readMrf(m))
          .filter((m): m is MrfRequest => m !== null)
      : [];
    /* The counts come from the server, not from `requests`. That list is one
       page of the queue, already narrowed to `legacyStatus` — counting it
       would make the tiles and the tab badge describe the page rather than the
       queue. `readMrfApprovalStats` explains the failure modes; the fallback
       keeps an older backend approximately right rather than empty. */
    const served = r.ok ? readMrfApprovalStats(r.data.stats) : null;
    return { requests, stats: served ?? mrfApprovalStats(requests) };
  }

  async getMrf(id: string): Promise<MrfRequest | null> {
    const token = await this.#token();
    const r = await legacyFetch<{ mrf?: Record<string, unknown> }>({
      path: `/api/cowork/mrf/${encodeURIComponent(id)}`,
      token,
    });
    return r.ok && r.data.mrf ? this.#readMrf(r.data.mrf) : null;
  }

  async createMrf(input: NewMrfInput): Promise<ActionResult<MrfRequest>> {
    const token = await this.#token();
    const r = await legacyFetch<{ mrf?: Record<string, unknown> }>({
      path: "/api/cowork/mrf/",
      method: "POST",
      token,
      body: {
        requestType: input.requestType.toUpperCase(),
        priority: (input.priority ?? "normal").toUpperCase(),
        reason: input.reason,
        neededBy: input.neededBy ?? null,
        deadline: input.deadline ?? null,
        items: input.items.map((it) =>
          it.rawItemId
            ? {
                rawItemId: it.rawItemId,
                variantId: it.variantId ?? null,
                variantCombination: it.variantCombination ?? [],
                requestedQty: it.requestedQty,
                unit: it.unit,
                description: it.description ?? "",
                images: it.images ?? [],
              }
            : {
                itemName: it.name,
                category: it.category ?? "",
                unit: it.unit,
                requestedQty: it.requestedQty,
                notes: it.description ?? "",
                images: it.images ?? [],
              },
        ),
      },
    });
    if (!r.ok)
      return { ok: false, code: "offline", message: r.error.message };
    const mrf = r.data.mrf ? this.#readMrf(r.data.mrf) : null;
    return mrf
      ? { ok: true, data: mrf }
      : { ok: false, code: "offline", message: "The request was not returned." };
  }

  async cancelMrf(id: string, note?: string): Promise<ActionResult<MrfRequest>> {
    const token = await this.#token();
    const r = await legacyFetch<{ mrf?: Record<string, unknown> }>({
      path: `/api/cowork/mrf/${encodeURIComponent(id)}/cancel`,
      method: "PATCH",
      token,
      body: { cancellationNote: note ?? "" },
    });
    if (!r.ok) return { ok: false, code: "offline", message: r.error.message };
    const mrf = r.data.mrf ? this.#readMrf(r.data.mrf) : await this.getMrf(id);
    return mrf
      ? { ok: true, data: mrf }
      : { ok: false, code: "not_found", message: "Request not found after cancel." };
  }

  async decideMrf(
    id: string,
    decision: {
      approve: boolean;
      note?: string;
      itemDecisions?: Record<string, "approved" | "rejected">;
    },
  ): Promise<ActionResult<MrfRequest>> {
    const token = await this.#token();
    const path = decision.approve
      ? `/api/cowork/mrf/${encodeURIComponent(id)}/tl-approve`
      : `/api/cowork/mrf/${encodeURIComponent(id)}/tl-reject`;
    const itemDecisions: Record<string, string> = {};
    for (const [k, v] of Object.entries(decision.itemDecisions ?? {}))
      itemDecisions[k] = v.toUpperCase();
    const r = await legacyFetch<{ mrf?: Record<string, unknown> }>({
      path,
      method: "PATCH",
      token,
      body: decision.approve
        ? { itemDecisions, note: decision.note ?? "" }
        : { note: decision.note ?? "" },
    });
    if (!r.ok) return { ok: false, code: "offline", message: r.error.message };
    const mrf = r.data.mrf ? this.#readMrf(r.data.mrf) : await this.getMrf(id);
    return mrf
      ? { ok: true, data: mrf }
      : { ok: false, code: "not_found", message: "Request not found after decision." };
  }

  #readMrfMsg(raw: Record<string, unknown>, mrfId: string): MrfChatMessage {
    const role = String(raw.senderRole ?? "").toLowerCase();
    return {
      id: String(raw._id ?? raw.id ?? ""),
      mrfId,
      senderId:
        typeof raw.senderBiometricId === "string" ? raw.senderBiometricId : null,
      senderName: String(raw.senderName ?? "Unknown"),
      senderRole:
        role === "tl" || role === "ceo"
          ? "tl"
          : role === "store"
            ? "store"
            : role === "system" || raw.isSystem === true
              ? "system"
              : "employee",
      body: String(raw.body ?? ""),
      isSystem: raw.isSystem === true,
      createdAt: String(raw.createdAt ?? ""),
    };
  }

  async listMrfChat(id: string): Promise<MrfChatMessage[]> {
    const token = await this.#token();
    const r = await legacyFetch<{ messages?: Record<string, unknown>[] }>({
      path: `/api/cowork/mrf/${encodeURIComponent(id)}/chat`,
      token,
    });
    return r.ok
      ? (r.data.messages ?? []).map((m) => this.#readMrfMsg(m, id))
      : [];
  }

  async sendMrfChat(
    id: string,
    body: string,
  ): Promise<ActionResult<MrfChatMessage>> {
    const token = await this.#token();
    const r = await legacyFetch<{ message?: Record<string, unknown> }>({
      path: `/api/cowork/mrf/${encodeURIComponent(id)}/chat`,
      method: "POST",
      token,
      body: { body },
    });
    if (!r.ok) return { ok: false, code: "offline", message: r.error.message };
    return r.data.message
      ? { ok: true, data: this.#readMrfMsg(r.data.message, id) }
      : { ok: false, code: "offline", message: "The message was not returned." };
  }

  async searchMrfItems(query: string): Promise<RawItemHit[]> {
    if (!query.trim()) return [];
    const token = await this.#token();
    const r = await legacyFetch<{ rawItems?: Record<string, unknown>[] }>({
      path: "/api/cowork/mrf/data/raw-items",
      query: { search: query },
      token,
    });
    if (!r.ok) return [];
    return (r.data.rawItems ?? []).map((it) => {
      const baseUnit = String(it.baseUnit ?? "unit");
      const conversions = Array.isArray(it.conversions) ? it.conversions : [];
      const units = [
        baseUnit,
        ...conversions
          .map((c) =>
            c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string"
              ? (c as { name: string }).name
              : null,
          )
          .filter((n): n is string => !!n),
      ];
      const variants = Array.isArray(it.variants) ? it.variants : [];
      return {
        id: String(it._id ?? it.id ?? ""),
        name: String(it.name ?? ""),
        sku: typeof it.sku === "string" ? it.sku : null,
        baseUnit,
        quantity: Number(it.quantity) || 0,
        units,
        variants: (variants as Record<string, unknown>[]).map((v) => ({
          id: String(v._id ?? v.id ?? ""),
          combination: Array.isArray(v.combination)
            ? (v.combination as unknown[]).map((x) => String(x))
            : [],
          quantity: Number(v.quantity) || 0,
          sku: typeof v.sku === "string" && v.sku ? v.sku : null,
        })),
      };
    });
  }

  /**
   * The C2 pool, from the engine's own accounting.
   *
   * `GET /cowork/c2/config` sums the live goal tasks' shares and reports what
   * is left. Read rather than recomputed here: the engine excludes done and
   * cancelled tasks, and a second opinion about the same number is how two
   * screens come to disagree about what a goal may claim.
   *
   * A failure answers an empty pool, which the form renders as "no C2 points
   * have been set" — the same thing an unconfigured company sees. That is the
   * safe direction: it refuses the share rather than granting one against a
   * pool nobody could read.
   */
  async getGoalPool() {
    const r = await fetchC2Pool(await this.#token());
    return r.ok
      ? r.data
      : { globalMaxPoints: 0, claimedPercent: 0, remainingPercent: 0 };
  }

  async validateGoalWeightage(input: {
    weightagePercent: number;
    excludeTaskId?: string | null;
  }) {
    const r = await validateWeightage({
      token: await this.#token(),
      weightagePercent: input.weightagePercent,
      excludeTaskId: input.excludeTaskId ?? null,
    });
    return r.ok
      ? r.data
      : { valid: false, remainingPercent: 0, error: r.error.message };
  }

  /**
   * A goal task's roadmap, with the pool it is spent against.
   *
   * The pool comes from the task's own `c2Config.taskMaxPoints` — the figure
   * agreed when the goal was created and snapshotted there, so a later change
   * to the company total cannot rewrite what this roadmap is dividing up.
   */
  /**
   * Where this task's hours came from.
   *
   * `givenSecs` reads `etcHours`, which is the creator's figure and is not
   * rewritten by a credit — the growth paths touch only the window fields. That
   * is what makes it usable as a baseline, and it is the only field on the task
   * that still remembers what was originally agreed.
   *
   * Sorted here rather than in the query: the collection has no composite index
   * on `taskId` + `at`, and adding one for a panel this small would be a
   * migration to pay for a sort of a handful of rows.
   */
  async getBudgetHistory(taskId: TaskId) {
    const empty = { givenSecs: 0, currentSecs: 0, credits: [] };
    try {
      const { collection, doc, getDoc, getDocs, query, where } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const db = legacyDb();

      const [taskSnap, creditSnap] = await Promise.all([
        getDoc(doc(db, "cowork_tasks", String(taskId))),
        getDocs(
          query(
            collection(db, "cowork_task_budget_credits"),
            where("taskId", "==", String(taskId)),
          ),
        ),
      ]);
      if (!taskSnap.exists()) return empty;

      const data = taskSnap.data() as Record<string, unknown>;
      const hours = Number(data.etcHours);
      /* `readTask` answers null on a document it cannot map. Zero is the honest
         current budget then — the panel says the account is incomplete rather
         than inventing a figure to reconcile against. */
      const mapped = readTask({ ...data, id: String(taskId) } as never);

      return {
        givenSecs: Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600) : 0,
        currentSecs: mapped ? resolveTimeBudget(mapped) : 0,
        credits: creditSnap.docs.map((d) => {
          const c = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            at: typeof c.at === "string" ? c.at : "",
            previousSecs: Number(c.previousSecs) || 0,
            newSecs: Number(c.newSecs) || 0,
            reason: typeof c.reason === "string" ? c.reason : "",
            byEmployeeId:
              typeof c.forEmployeeId === "string" ? c.forEmployeeId : null,
          };
        }),
      };
    } catch (e) {
      /* The panel this feeds hangs off Details. A history that cannot be read
         must cost the history, never the task page. */
      console.error(
        "[budget] history read failed:",
        e instanceof Error ? e.message : e,
      );
      return empty;
    }
  }

  async getGoalRoadmap(taskId: TaskId) {
    const token = await this.#token();
    const [roadmap, taskDoc] = await Promise.all([
      fetchRoadmap({ token, taskId: String(taskId) }),
      (async () => {
        const { doc, getDoc } = await import("firebase/firestore");
        const { legacyDb } = await import("../../legacy/firebase.ts");
        const snap = await getDoc(
          doc(legacyDb(), "cowork_tasks", String(taskId)),
        );
        return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      })(),
    ]);

    const c2 = (taskDoc?.c2Config ?? {}) as Record<string, unknown>;
    const taskMaxPoints = Number(c2.taskMaxPoints) || 0;
    /* The old app's own field, read under its own name. */
    const goalCfg = (taskDoc?.goalConfig ?? {}) as Record<string, unknown>;
    const targetDate =
      typeof goalCfg.deadline === "string" && goalCfg.deadline
        ? goalCfg.deadline
        : null;
    const goalStatement =
      typeof goalCfg.goalDescription === "string" && goalCfg.goalDescription
        ? goalCfg.goalDescription
        : null;

    if (!roadmap.ok) {
      /* A roadmap that cannot be read is an empty one, not a crash. The panel
         says so and offers to build it; throwing would take the task page
         down over a feature the task may not even use. */
      return {
        activities: [],
        submitted: false,
        submittedAt: null,
        taskMaxPoints,
        targetDate,
        goalStatement,
      };
    }

    return {
      activities: roadmap.data.activities.map((a) => ({
        id: a.id,
        heading: a.heading,
        description: a.description,
        deadline: a.deadline,
        /* `percentage` is the engine's name for the share. Where an older
           roadmap has points but no percentage, the share is derived back from
           the pool so the editor has something to show. */
        weightPercent:
          a.percentage ??
          (taskMaxPoints > 0 ? (a.points / taskMaxPoints) * 100 : 0),
        points: a.points,
        status: a.status,
        report: a.report,
        /* The engine's own per-person map, carried through `rest` untouched.
           Absent on every goal that was never shared, which is why this reads
           as null rather than as an empty object — the difference is "nobody
           has ever written per-person state here" versus "everybody's row is
           empty", and only the first is true of a single-assignee goal. */
        perUserStatus: readPerUser(a.rest.perUserStatus),
      })),
      submitted: roadmap.data.submitted,
      submittedAt: roadmap.data.submittedAt,
      taskMaxPoints,
      targetDate,
      goalStatement,
    };
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
    const token = await this.#token();
    /* Read first, to recover everything the engine keeps that this app does
       not render — `status`, `report`, `history`, `perUserStatus`. The write
       replaces the array, so a save built only from what is on screen would
       delete work somebody had already submitted. */
    const existing = await fetchRoadmap({ token, taskId: String(input.taskId) });
    const byId = new Map(
      (existing.ok ? existing.data.activities : []).map((a) => [a.id, a]),
    );
    const current = await this.getGoalRoadmap(input.taskId);

    const result = await saveRoadmap({
      token,
      taskId: String(input.taskId),
      activities: input.activities.map((a) => ({
        id: a.id,
        heading: a.heading,
        description: a.description,
        deadline: a.deadline,
        percentage: a.weightPercent,
        points: nodePointsFor(a.weightPercent, current.taskMaxPoints),
        /* Carried from what the engine already holds. Editing a step's heading
           must not reset its status or discard the report handed in against
           it — a new step simply has neither. */
        status: byId.get(a.id)?.status ?? "pending",
        report: byId.get(a.id)?.report ?? null,
        rest: byId.get(a.id)?.rest ?? {},
      })),
    });

    return result.ok
      ? { ok: true, data: undefined }
      : this.#refusal(result.error);
  }

  /**
   * Hand the roadmap over, once.
   *
   * The engine announces this on the TRANSITION — `submitted === true` while
   * the stored flag is still false — so submitting an already-submitted
   * roadmap would either re-announce it or, worse, be relied upon to. Read
   * first and return early: handing something over twice is not a thing that
   * happens, and the second attempt is a no-op rather than a refusal, because
   * the roadmap is in exactly the state the caller asked for.
   *
   * The steps are re-sent unchanged: the engine replaces the array on every
   * write, so submitting without them would hand over an empty roadmap.
   */
  async submitGoalRoadmap(taskId: TaskId): Promise<ActionResult<void>> {
    const token = await this.#token();
    const existing = await fetchRoadmap({ token, taskId: String(taskId) });
    if (!existing.ok) return this.#refusal(existing.error);
    if (existing.data.submitted) return { ok: true, data: undefined };

    const result = await saveRoadmap({
      token,
      taskId: String(taskId),
      activities: existing.data.activities,
      submitted: true,
      submittedAt: new Date().toISOString(),
    });
    return result.ok
      ? { ok: true, data: undefined }
      : this.#refusal(result.error);
  }

  async submitGoalStepReport(input: {
    taskId: TaskId;
    stepId: string;
    text: string;
    files?: GoalReportFile[];
    personId?: string;
  }): Promise<ActionResult<void>> {
    const token = await this.#token();
    /* The engine's own call, ALWAYS, and first. It writes the flat report, sets
       `reportSubmitted` and sends the head their two emails — none of which
       this app reimplements. On a single-assignee goal it is the whole of the
       work, exactly as before. */
    const r = await submitNodeReport({
      token,
      taskId: String(input.taskId),
      activityId: input.stepId,
      text: input.text,
      files: input.files,
    });
    if (!r.ok) return this.#refusal(r.error);
    if (!input.personId) return { ok: true, data: undefined };

    /* Shared: record it against this person's own row too, so a second
       assignee handing in does not overwrite the first one's report. Read back
       first — the engine has just rewritten the array, and saving from a copy
       taken before that call would undo it. */
    const after = await this.#writePerson({
      token,
      taskId: input.taskId,
      stepId: input.stepId,
      personId: input.personId,
      change: (step, assigneeIds) => ({
        perUserStatus: withReport({
          step,
          personId: input.personId!,
          report: step.report,
        }),
        assigneeIds,
      }),
    });
    /* A failure here leaves the engine's flat report written and this person's
       row not — visible as "handed in" to the head, which is the safe way for
       it to fail. Reported so it is not silent. */
    return after;
  }

  /**
   * Rewrite one person's row on one step, and roll the flat status up.
   *
   * Read-modify-write over the whole activity array, because that is the only
   * shape the engine's roadmap route accepts. Everything it holds that this app
   * does not render survives — `history`, `reportSubmitted`, and every OTHER
   * person's row.
   */
  async #writePerson(input: {
    token: string;
    taskId: TaskId;
    stepId: string;
    personId: string;
    change: (
      step: StepWithPeople,
      assigneeIds: string[],
    ) => {
      perUserStatus: Record<string, Partial<GoalStepPerson>>;
      assigneeIds: string[];
    };
  }): Promise<ActionResult<void>> {
    const [existing, assigneeIds] = await Promise.all([
      fetchRoadmap({ token: input.token, taskId: String(input.taskId) }),
      this.#assigneesOf(input.taskId),
    ]);
    if (!existing.ok) return this.#refusal(existing.error);

    const found = existing.data.activities.find((a) => a.id === input.stepId);
    if (!found)
      return { ok: false, code: "not_found", message: "That step could not be found." };

    const asStep: StepWithPeople = {
      status: found.status,
      report: found.report,
      perUserStatus: readPerUser(found.rest.perUserStatus),
    };
    const { perUserStatus } = input.change(asStep, assigneeIds);

    const next = existing.data.activities.map((a) =>
      a.id !== input.stepId
        ? a
        : {
            ...a,
            /* Flat `done` only once EVERYBODY is — the engine counts finished
               steps from this field, and it must not claim a step is complete
               while somebody still owes a report. */
            status: rollUpStatus({ step: asStep, assigneeIds, next: perUserStatus }),
            rest: { ...a.rest, perUserStatus },
          },
    );

    const saved = await saveRoadmap({
      token: input.token,
      taskId: String(input.taskId),
      activities: next,
    });
    return saved.ok ? { ok: true, data: undefined } : this.#refusal(saved.error);
  }

  /** Who the task is assigned to. Empty rather than throwing. */
  async #assigneesOf(taskId: TaskId): Promise<string[]> {
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", String(taskId)));
    if (!snap.exists()) return [];
    const data = snap.data() as Record<string, unknown>;
    const ids = Array.isArray(data.assigneeIds) ? data.assigneeIds : [];
    /* `pendingAssigneeId` counts: somebody who has been handed the task but has
       not accepted it yet is still one of the people who has to do it, and
       leaving them out would let the flat status roll up to done without
       them. */
    const all = [...ids, data.pendingAssigneeId]
      .map((v) => String(v ?? ""))
      .filter(Boolean);
    return [...new Set(all)];
  }

  /**
   * One file, to Drive, ready to be named on a report.
   *
   * Nothing is written to the task here — the returned link is only stored
   * when the report is submitted. An upload the person then abandons leaves an
   * orphaned Drive file and no half-written report, which is the right way
   * round.
   */
  async uploadGoalReportFile(file: File): Promise<ActionResult<GoalReportFile>> {
    const r = await uploadReportFile({ token: await this.#token(), file });
    return r.ok ? { ok: true, data: r.data } : this.#refusal(r.error);
  }

  /**
   * Settle one step.
   *
   * Two writes, and the order is deliberate. The step is marked first, so the
   * decision is recorded even if the credit call then fails — a step approved
   * and not paid is a visible discrepancy somebody can chase, while a step paid
   * and not marked would be paid AGAIN on the next attempt.
   *
   * The engine is the one that decides whether the points are actually paid: it
   * re-checks the deadline and refuses a second credit for the same step. This
   * only asks.
   */
  async decideGoalStep(input: {
    taskId: TaskId;
    stepId: string;
    approve: boolean;
    personId?: string;
  }): Promise<ActionResult<{ pointsEarned: number }>> {
    const token = await this.#token();
    const existing = await fetchRoadmap({ token, taskId: String(input.taskId) });
    if (!existing.ok) return this.#refusal(existing.error);

    const step = existing.data.activities.find((a) => a.id === input.stepId);
    if (!step)
      return { ok: false, code: "not_found", message: "That step could not be found." };

    /* What approving WILL do. Computed before the write, because the write for
       a shared goal needs to record whether this person was late, and both
       sides must be the same judgement rather than two. */
    const outcome = approvalOutcome({
      submittedAt:
        (input.personId
          ? readPerUser(step.rest.perUserStatus)?.[input.personId]?.report
              ?.submittedAt
          : step.report?.submittedAt) ?? null,
      deadline: step.deadline,
      points: step.points,
    });

    const decidedAt = new Date().toISOString();

    if (input.personId) {
      /* Shared: this person's row alone, and the flat status rolled up from
         everybody's. Another assignee mid-roadmap is untouched. */
      const written = await this.#writePerson({
        token,
        taskId: input.taskId,
        stepId: input.stepId,
        personId: input.personId,
        change: (asStep, assigneeIds) => ({
          perUserStatus: withDecision({
            step: asStep,
            personId: input.personId!,
            approve: input.approve,
            points: step.points,
            late: input.approve && !outcome.earns,
            nowIso: decidedAt,
          }),
          assigneeIds,
        }),
      });
      if (!written.ok) return written;
      if (!input.approve || !outcome.earns)
        return { ok: true, data: { pointsEarned: 0 } };
      return this.#creditGoalStep({
        token,
        taskId: input.taskId,
        step,
        employeeId: input.personId,
        points: outcome.points,
        submittedAt:
          readPerUser(step.rest.perUserStatus)?.[input.personId]?.report
            ?.submittedAt ?? null,
      });
    }

    const next = existing.data.activities.map((a) =>
      a.id !== input.stepId
        ? a
        : input.approve
          ? { ...a, status: "done", rest: { ...a.rest, doneAt: decidedAt } }
          : /* Sent back: the report is cleared so the person can hand in
               another, which is what `reportSubmitted: false` means to the
               engine's own screens. */
            {
              ...a,
              status: "pending",
              report: null,
              rest: { ...a.rest, report: null, reportSubmitted: false },
            },
    );

    const saved = await saveRoadmap({
      token,
      taskId: String(input.taskId),
      activities: next,
    });
    if (!saved.ok) return this.#refusal(saved.error);

    if (!input.approve || !outcome.earns)
      return { ok: true, data: { pointsEarned: 0 } };

    /* Nobody named: the one assignee, as it always was. */
    const only = (await this.#assigneesOf(input.taskId))[0] ?? "";
    return this.#creditGoalStep({
      token,
      taskId: input.taskId,
      step,
      employeeId: only,
      points: outcome.points,
      submittedAt: step.report?.submittedAt ?? null,
    });
  }

  /**
   * Pay one person for one step.
   *
   * Shared by both paths, so a shared goal and a solo one are credited by the
   * same code with a different name in it. The step is already marked done by
   * the time this runs — a credit that fails is reported and the approval is
   * NOT rolled back, because the work was approved and losing that decision
   * over a failed score write would be the worse of the two outcomes.
   */
  async #creditGoalStep(input: {
    token: string;
    taskId: TaskId;
    step: { id: string; heading: string; points: number; deadline: string | null };
    employeeId: string;
    points: number;
    /** THIS person's submission — not the step's flat one, on a shared goal. */
    submittedAt: string | null;
  }): Promise<ActionResult<{ pointsEarned: number }>> {
    const taskSnap = await (async () => {
      const { doc, getDoc } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const s = await getDoc(doc(legacyDb(), "cowork_tasks", String(input.taskId)));
      return s.exists() ? (s.data() as Record<string, unknown>) : null;
    })();
    const c2 = (taskSnap?.c2Config ?? {}) as Record<string, unknown>;

    const credited = await creditNode({
      token: input.token,
      targetEmployeeId: input.employeeId,
      taskId: String(input.taskId),
      componentId: input.step.id,
      componentName: input.step.heading,
      taskTitle: String(taskSnap?.title ?? ""),
      points: input.step.points,
      /* The engine re-checks `submittedAt <= deadline` for itself and refuses a
         late one. Both figures go across untouched so it can. */
      submittedAt: input.submittedAt,
      deadline: input.step.deadline,
      weightagePercent: Number(c2.weightagePercent) || null,
      taskMaxPoints: Number(c2.taskMaxPoints) || null,
    });

    if (!credited.ok) return this.#refusal(credited.error);
    return { ok: true, data: { pointsEarned: input.points } };
  }

  /**
   * Where somebody's C2 came from.
   *
   * The engine's own cache, written as each step is approved. Read rather than
   * reassembled from the ledger: both are written by the same call, and
   * recomputing one from the other is how a page comes to disagree with the
   * score it is explaining.
   *
   * An unreadable breakdown answers empty rather than throwing — the C2 tab's
   * other panels are independent of it, and a failed explanation must not take
   * down the figure it was explaining.
   */
  async getC2Breakdown(employeeId: EmployeeId) {
    const r = await fetchC2Score({
      token: await this.#token(),
      employeeId: String(employeeId),
    });
    return r.ok ? r.data : { totalEarned: 0, globalMaxPoints: 0, tasks: [] };
  }

  async listGoals() { return []; }

  /* ── Shell-mounted reads ────────────────────────────────────────────────── */

  /**
   * Priority acknowledgements. **Legacy has no such queue.**
   *
   * Searched: the only `acknowledge` anywhere in `cowork-old-backend` is in the
   * Accountant module's audit notes — a different product. Cowork's priority is
   * a plain numeric field written straight from the browser with no permission
   * check and no acknowledgement step; the manager-reorders-then-employee-
   * acknowledges flow is a NEW concept with nothing behind it.
   *
   * So an empty list is **the true answer**, not a placeholder: there are no
   * pending acknowledgements because the concept does not exist in the engine.
   * Throwing was wrong for a different reason — `PriorityAckGate` is mounted in
   * `ShellFrame` and polls every 2.5 seconds outside `useQuery`, so the
   * rejection escaped and took the whole shell down.
   */
  async listPendingAcknowledgements(
    employeeId?: EmployeeId,
  ): Promise<PriorityCascade[]> {
    const me = String(employeeId ?? this.#ctx.employeeId ?? "");
    if (!me) return [];
    try {
      const groups = await this.#pendingCascadeGroups(me);
      return [...groups.values()]
        .map((entries) => cascadeFromEntries({ employeeId: me, entries }))
        .filter((c): c is PriorityCascade => c !== null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch (error) {
      /* Never rejects. `PriorityAckGate` is mounted in `ShellFrame` and polls
         this outside `useQuery`, so a rejection escapes and takes the whole
         application down — which is exactly what happened when this method threw.
         An empty list degrades to "no receipt right now"; a throw degrades to a
         blank product. */
      console.error("[priority-cascade] pending acknowledgements unreadable:", error);
      return [];
    }
  }

  /**
   * Music, and the demo controls.
   *
   * New-product features with no legacy counterpart — the old app has no music
   * player and no demo bar. Both are mounted in the shell (`MusicProvider` in
   * `AppShell`, `DemoBar` in `ShellFrame`) and call the repository directly
   * rather than through `useQuery`, so a throw from any of them is a blank
   * application rather than a missing widget.
   *
   * Music answers from the BROWSER, not from the engine, and not with empties.
   *
   * It used to answer `[]` to the reads and `undefined` to the writes, on the
   * reasoning that an empty list is what "this build has no music library"
   * honestly looks like. Three methods were simply missing from that list —
   * `recordMusicPlayed`, `getMusicQueue`, `getMusicPreferences` — so the proxy
   * threw for them, and `recordMusicPlayed` is called from inside `playNow`
   * and `next` BEFORE the play intent is set. The throw took the intent with
   * it: the track changed, nothing started, and the next track never followed
   * the one that ended. That is not an honest empty state, it is a dead
   * button, and it is the shape of failure this whole file exists to avoid.
   *
   * The domain already says what music is: a personal utility, private to one
   * person, never read by scoring or by a manager. There is nothing in the
   * engine to connect it to and nothing gained by pretending to be a service,
   * so it is kept where it belongs — the browser it was played in, which is
   * also where the prototype has always kept it.
   */
  async listMusicFavourites() { return musicStore.favourites(); }
  async listMusicPlayed() { return musicStore.played(); }
  async listMusicSearches() { return musicStore.searches(); }
  async getMusicQueue() { return musicStore.queue(); }
  async getMusicPreferences() { return musicStore.preferences(); }
  async listMusicPlaylists() { return musicStore.playlists(); }
  async createMusicPlaylist(name: string) {
    return { ok: true as const, data: musicStore.createPlaylist(name) };
  }
  async renameMusicPlaylist(id: string, name: string) {
    return { ok: true as const, data: musicStore.renamePlaylist(id, name) };
  }
  async deleteMusicPlaylist(id: string) {
    return { ok: true as const, data: musicStore.deletePlaylist(id) };
  }
  async addToMusicPlaylist(id: string, item: MusicResult) {
    return { ok: true as const, data: musicStore.addToPlaylist(id, item) };
  }
  async removeFromMusicPlaylist(id: string, trackId: string) {
    return { ok: true as const, data: musicStore.removeFromPlaylist(id, trackId) };
  }
  async moveMusicPlaylistTrack(id: string, from: number, to: number) {
    return { ok: true as const, data: musicStore.movePlaylistTrack(id, from, to) };
  }
  async recordMusicPlayed(item: MusicResult) {
    musicStore.recordPlayed(item);
    return { ok: true as const, data: undefined };
  }
  async recordMusicSearch(query: string) {
    musicStore.recordSearch(query);
    return { ok: true as const, data: undefined };
  }
  async clearMusicSearches() {
    musicStore.clearSearches();
    return { ok: true as const, data: undefined };
  }
  async toggleMusicFavourite(item: MusicResult) {
    return { ok: true as const, data: musicStore.toggleFavourite(item) };
  }
  async saveMusicQueue(queue: MusicQueue) {
    musicStore.saveQueue(queue);
    return { ok: true as const, data: undefined };
  }
  async saveMusicPreferences(patch: Partial<MusicPreferences>) {
    return { ok: true as const, data: musicStore.savePreferences(patch) };
  }
  async resetDemoData() { return undefined; }
  setSimulatedFailure() { /* Prototype-only switch. Nothing to simulate. */ }

  /* ── Provisioning — no-ops, and that is the correct behaviour ───────────── */

  /**
   * These three exist to populate the per-browser mock store.
   *
   * `ensureSessionEmployee` creates the signed-in person locally,
   * `ensureDirectoryEmployees` back-fills colleagues who were created in another
   * browser, and `setActingContext` points the store at an identity. All three
   * solve a problem the mock store has and the engine does not: the engine is
   * the shared record, so there is nothing to provision and nothing to
   * reconcile.
   *
   * They must exist rather than fall through to the throwing proxy. `load()`
   * calls all three immediately after installing the repository, and a throw
   * there is swallowed by its own catch — which leaves the session at
   * `loading` forever and renders "Signing you in…" with nothing behind it.
   * That is exactly what happened, and it is why these are here as no-ops with
   * a reason rather than absent.
   */
  async ensureSessionEmployee(): Promise<void> {
    /* The engine already holds this person; there is nothing to create. */
  }

  async ensureDirectoryEmployees(): Promise<void> {
    /* The directory is fetched live from the engine on demand. */
  }

  setActingContext(): void {
    /* The acting identity is fixed at construction, from the Firebase session.
       Nothing may re-point this repository at a different person mid-session —
       the token would no longer match, and the engine would refuse. */
  }

  setActingId(): void {
    /* Same reason. Deliberately inert rather than absent, so the dev profile
       switcher cannot silently act as somebody the token does not authorise. */
  }

  /**
   * The acting employee, without a round trip.
   *
   * Safe to read at any moment precisely BECAUSE of the two methods above: the
   * identity is fixed when the repository is constructed and nothing can
   * re-point it, so this can never disagree with the `employeeId` `getViewer()`
   * reports — that method resolves it from the same field.
   */
  actingEmployeeId(): EmployeeId | null {
    return this.#ctx.employeeId ? (String(this.#ctx.employeeId) as EmployeeId) : null;
  }

  /* ── Mail ────────────────────────────────────────────────────────────────
   *
   * One document per message in `cowork_mails` (the collection legacy already
   * used, so its Firestore rules apply); threads are DERIVED on read (see
   * `./mail.ts`). There is no Express mail engine — internal mail is a
   * browser↔Firestore write like the budget-extension records, and external
   * (Gmail) send and sync go through the Next.js `/api/mail` routes, which hold
   * the sealed OAuth tokens the browser must never see.
   */

  async #mailContext() {
    const employees = await this.#employeesById();
    const me = String(this.#ctx.employeeId);
    const meEmp = employees.get(me) ?? null;
    const byEmail = new Map<string, Employee>();
    for (const e of employees.values())
      if (e.email) byEmail.set(e.email.toLowerCase(), e);
    return { me, orgId: LEGACY_ORGANISATION_ID, byEmail, meEmp };
  }

  /** Every message this person is a party to, in one `array-contains` read. */
  async #myMailMessages(): Promise<MailMessage[]> {
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const me = String(this.#ctx.employeeId);
    const snap = await getDocs(
      query(
        collection(legacyDb(), MAIL_COLLECTION),
        where("participantIds", "array-contains", me),
      ),
    );
    return snap.docs.map((d) =>
      readMailMessage(d.id, d.data() as Record<string, unknown>),
    );
  }

  async listMailThreads(q: {
    folder: MailFolder;
    transport?: MailTransport;
    search?: string;
  }): Promise<MailThread[]> {
    const me = String(this.#ctx.employeeId);
    const all = (await this.#myMailMessages()).filter((m) => mailVisible(m, me));
    /* Show a thread when it has a message in the chosen folder; SUMMARISE it
       from every visible message in the thread, so a Sent row still previews
       the latest reply rather than only what I sent. */
    const byThread = new Map<string, MailMessage[]>();
    for (const m of all) {
      const list = byThread.get(m.threadId) ?? [];
      list.push(m);
      byThread.set(m.threadId, list);
    }
    const inFolderThreads = new Set(
      all.filter((m) => inFolder(m, me, q.folder)).map((m) => m.threadId),
    );
    let threads = [...inFolderThreads].map((tid) =>
      deriveThread(tid, byThread.get(tid) ?? [], LEGACY_ORGANISATION_ID),
    );
    if (q.transport) threads = threads.filter((t) => t.transport === q.transport);
    if (q.search?.trim()) {
      const needle = q.search.trim();
      threads = threads.filter((t) =>
        threadMatchesSearch(t, byThread.get(t.id) ?? [], needle),
      );
    }
    return threads.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  async listMailMessages(threadId: string): Promise<MailMessage[]> {
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const me = String(this.#ctx.employeeId);
    const snap = await getDocs(
      query(
        collection(legacyDb(), MAIL_COLLECTION),
        where("threadId", "==", threadId),
      ),
    );
    return snap.docs
      .map((d) => readMailMessage(d.id, d.data() as Record<string, unknown>))
      .filter((m) => mailVisible(m, me))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      /* Everybody but the sender gets an empty bcc list. See the note in
         `rules/mail/blindCopy.ts` about what this does and does not guarantee
         when the read is browser-to-Firestore. */
      .map((m) => redactBcc(m, me));
  }

  async listMailAttachments(ids: string[]): Promise<MailAttachment[]> {
    if (ids.length === 0) return [];
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    /* The ids ARE the doc ids; read each rather than an `in` query (which caps
       at ten). A missing attachment is skipped, not fatal. */
    const snaps = await Promise.all(
      ids.map((id) =>
        getDoc(doc(legacyDb(), "cowork_mail_attachments", id)).catch(() => null),
      ),
    );
    const out: MailAttachment[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as Record<string, unknown>;
      out.push({
        id: s.id,
        messageId: typeof d.messageId === "string" ? d.messageId : "",
        filename: typeof d.filename === "string" ? d.filename : "file",
        mimeType:
          typeof d.mimeType === "string"
            ? d.mimeType
            : "application/octet-stream",
        sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : 0,
        storageKey: typeof d.storageKey === "string" ? d.storageKey : "",
        uploadedAt:
          typeof d.uploadedAt === "string"
            ? d.uploadedAt
            : new Date(0).toISOString(),
      });
    }
    return out;
  }

  async getMailUnreadCount(): Promise<number> {
    const me = String(this.#ctx.employeeId);
    const all = await this.#myMailMessages();
    return all.filter(
      (m) =>
        mailVisible(m, me) && inFolder(m, me, "inbox") && !m.readBy.includes(me),
    ).length;
  }

  async setMailRead(
    messageId: string,
    read: boolean,
  ): Promise<ActionResult<void>> {
    return this.#setMailArrayFlag(messageId, "readBy", read);
  }

  async setMailFlag(
    messageId: string,
    flag: "starred" | "trashed",
    on: boolean,
  ): Promise<ActionResult<void>> {
    return this.#setMailArrayFlag(
      messageId,
      flag === "starred" ? "starredBy" : "trashedBy",
      on,
    );
  }

  /** Toggle one per-person array flag on a message, after checking the reader is
   *  a party to it — the same permission the mock enforces. */
  async #setMailArrayFlag(
    messageId: string,
    field: "readBy" | "starredBy" | "trashedBy",
    on: boolean,
  ): Promise<ActionResult<void>> {
    const { arrayRemove, arrayUnion, doc, getDoc, updateDoc } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const me = String(this.#ctx.employeeId);
    const ref = doc(legacyDb(), MAIL_COLLECTION, messageId);
    const snap = await getDoc(ref);
    if (!snap.exists())
      return { ok: false, code: "not_found", message: "Message not found." };
    const m = readMailMessage(snap.id, snap.data() as Record<string, unknown>);
    if (!mailVisible(m, me))
      return {
        ok: false,
        code: "permission_denied",
        message: "That message is not yours.",
      };
    try {
      await updateDoc(ref, {
        [field]: on ? arrayUnion(me) : arrayRemove(me),
      });
      notifyRepositoryChanged();
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[setMailArrayFlag]", e);
      return {
        ok: false,
        code: "offline",
        message: "Could not update the message.",
      };
    }
  }

  async sendMail(input: {
    to: MailParty[];
    cc?: MailParty[];
    bcc?: MailParty[];
    subject: string;
    body: string;
    attachmentIds?: string[];
    threadId?: string | null;
    gmail?: { messageId: string; threadId: string } | null;
    deliveryError?: string | null;
  }): Promise<ActionResult<MailMessage>> {
    const { addDoc, collection } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const ctx = await this.#mailContext();
    if (!ctx.meEmp)
      return { ok: false, code: "not_found", message: "Employee not found." };

    const cc = input.cc ?? [];
    /* Bcc decides the transport too: one external blind copy makes the whole
       message external, exactly as it would in To. */
    const bcc = input.bcc ?? [];
    const refusal = recipientRefusal({ to: input.to, cc, bcc });
    if (refusal)
      return { ok: false, code: "validation_failed", message: refusal };
    const transport = transportForParties([...input.to, ...cc, ...bcc]);

    /* External send goes through the Gmail route, which holds the token. If it
       fails the message is KEPT as a draft with the reason on it, never lost —
       the contract the compose card reads. */
    let gmail = input.gmail ?? null;
    let deliveryError = input.deliveryError ?? null;
    if (transport === "gmail" && !gmail && !deliveryError) {
      try {
        const res = await fetch("/api/mail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: input.to,
            cc,
            bcc,
            subject: input.subject,
            body: input.body,
            gmailThreadId: null,
          }),
        });
        const payload = (await res.json().catch(() => null)) as {
          gmail?: { gmailMessageId: string; gmailThreadId: string };
          error?: string;
        } | null;
        if (res.ok && payload?.gmail) {
          gmail = {
            messageId: payload.gmail.gmailMessageId,
            threadId: payload.gmail.gmailThreadId,
          };
        } else {
          deliveryError =
            payload?.error ??
            "Gmail could not be reached, so this was kept as a draft.";
        }
      } catch {
        deliveryError =
          "Gmail could not be reached, so this was kept as a draft.";
      }
    }

    const now = new Date().toISOString();
    const from: MailParty = {
      kind: "employee",
      employeeId: ctx.meEmp.id,
      address: ctx.meEmp.email ?? `${ctx.meEmp.id}@cowork.local`,
      displayName: ctx.meEmp.displayName,
    };
    const message: Omit<MailMessage, "id"> = {
      threadId:
        input.threadId ??
        `mth-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      transport,
      from,
      to: input.to,
      cc,
      bcc,
      subject: input.subject.trim(),
      body: input.body,
      attachmentIds: input.attachmentIds ?? [],
      /* The sender has read their own message. */
      readBy: [ctx.meEmp.id],
      starredBy: [],
      trashedBy: [],
      archivedBy: [],
      labels: [],
      /* A failed external send stays a draft (null `sentAt`) carrying its error. */
      sentAt: deliveryError ? null : now,
      createdAt: now,
      gmailMessageId: gmail?.messageId ?? null,
      deliveryError,
    };
    try {
      const ref = await addDoc(
        collection(legacyDb(), MAIL_COLLECTION),
        mailMessageBody(message, ctx.orgId),
      );
      notifyRepositoryChanged();
      return { ok: true, data: { ...message, id: ref.id } };
    } catch (e) {
      console.error("[sendMail]", e);
      return {
        ok: false,
        code: "offline",
        message: "The message could not be sent.",
      };
    }
  }

  async importGmailMessages(
    messages: MailMessage[],
    mailboxAddress: string,
  ): Promise<ActionResult<{ added: number }>> {
    const { addDoc, collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const ctx = await this.#mailContext();
    const mailbox = mailboxAddress.toLowerCase();

    /* The gmail ids already stored, in one read — idempotency costs no per-message
       query, and a re-sync of the same message adds nothing. */
    const seen = new Set<string>();
    const existing = await getDocs(
      query(
        collection(legacyDb(), MAIL_COLLECTION),
        where("participantIds", "array-contains", ctx.me),
      ),
    );
    for (const d of existing.docs) {
      const g = (d.data() as Record<string, unknown>).gmailMessageId;
      if (typeof g === "string") seen.add(g);
    }

    let added = 0;
    for (const raw of messages) {
      if (raw.gmailMessageId && seen.has(raw.gmailMessageId)) continue;
      const from = resolveParty(raw.from, ctx.byEmail, mailbox, ctx.meEmp);
      const to = raw.to.map((p) =>
        resolveParty(p, ctx.byEmail, mailbox, ctx.meEmp),
      );
      const cc = raw.cc.map((p) =>
        resolveParty(p, ctx.byEmail, mailbox, ctx.meEmp),
      );
      const { id: _ignore, ...base } = raw;
      void _ignore;
      const message: Omit<MailMessage, "id"> = {
        ...base,
        from,
        to,
        cc,
        transport: "gmail",
        /* Read if I sent it; unread if it arrived. */
        readBy: from.employeeId === ctx.me ? [ctx.me] : [],
      };
      try {
        await addDoc(
          collection(legacyDb(), MAIL_COLLECTION),
          mailMessageBody(message, ctx.orgId),
        );
        if (raw.gmailMessageId) seen.add(raw.gmailMessageId);
        added += 1;
      } catch (e) {
        console.error("[importGmailMessages]", e);
      }
    }
    if (added > 0) notifyRepositoryChanged();
    return { ok: true, data: { added } };
  }

  /* ── Collaboration: messages ─────────────────────────────────────────────
   *
   * Stored exactly where the old Cowork frontend wrote them: a direct thread is
   * `cowork_direct_messages/{convId}` (convId = the two ids sorted, joined "_"),
   * a group is `cowork_groups/{groupId}`, each with a `messages` subcollection.
   * Read and written browser-direct so a conversation is SHARED between the old
   * app and this one — the rules already permit it because the old app relied on
   * the same access. Unread is DERIVED from each message's `readBy`, never
   * stored, which is how the old app counted it — no second counter to drift. */

  /** Which collection holds a conversation: a direct thread has a doc in
   *  `cowork_direct_messages`; anything else is a group. One read, so a group id
   *  and a direct pair can never be confused — with a `"_"` id treated as direct
   *  for the first message of a thread whose parent doc has not landed yet. */
  async #conversationCollection(conversationId: string): Promise<string> {
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const dm = await getDoc(doc(legacyDb(), DM_COLLECTION, conversationId));
      if (dm.exists()) return DM_COLLECTION;
    } catch {
      /* fall through to the id-shape guess */
    }
    return conversationId.includes("_") ? DM_COLLECTION : GROUP_COLLECTION;
  }

  /** How many messages in one conversation are unread FOR ME: not mine, and my
   *  id is not yet in `readBy`. A single-inequality query needs no composite
   *  index, and matches the old list's own rule. */
  async #conversationUnread(
    collectionName: string,
    conversationId: string,
    me: string,
  ): Promise<number> {
    try {
      const { collection, getDocs, query, where } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const snap = await getDocs(
        query(
          collection(legacyDb(), collectionName, conversationId, "messages"),
          where("senderId", "!=", me),
        ),
      );
      return snap.docs.filter((d) => {
        const rb = (d.data() as { readBy?: unknown }).readBy;
        return !Array.isArray(rb) || !rb.includes(me);
      }).length;
    } catch {
      return 0;
    }
  }

  async listConversations(): Promise<
    (Conversation & { participants: Employee[] })[]
  > {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me) return [];
    const { collection, getDocs, query, where } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const directory = await this.#employeesById();

    const [dmSnap, groupSnap] = await Promise.all([
      getDocs(
        query(
          collection(legacyDb(), DM_COLLECTION),
          where("participantIds", "array-contains", me),
        ),
      ).catch(() => null),
      getDocs(
        query(
          collection(legacyDb(), GROUP_COLLECTION),
          where("memberIds", "array-contains", me),
        ),
      ).catch(() => null),
    ]);

    const base: { conv: Conversation; coll: string }[] = [];
    for (const d of dmSnap?.docs ?? [])
      base.push({
        conv: readDirectConversationDoc(
          d.id,
          d.data() as Record<string, unknown>,
          LEGACY_ORGANISATION_ID,
        ),
        coll: DM_COLLECTION,
      });
    for (const d of groupSnap?.docs ?? [])
      base.push({
        conv: readGroupConversationDoc(
          d.id,
          d.data() as Record<string, unknown>,
          LEGACY_ORGANISATION_ID,
        ),
        coll: GROUP_COLLECTION,
      });

    /* Unread and participants for every conversation in parallel — the list is
       one round-trip deep rather than N sequential reads. */
    const resolved = await Promise.all(
      base.map(async ({ conv, coll }) => ({
        ...conv,
        unreadCount: await this.#conversationUnread(coll, conv.id, me),
        participants: conv.participantIds
          .map((id) => directory.get(id))
          .filter((e): e is Employee => !!e),
      })),
    );

    /* Most-recently-active first; a thread with no messages yet sorts last. */
    resolved.sort((a, b) =>
      (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
    );
    return resolved;
  }

  async listMessages(
    conversationId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<{ messages: Message[]; hasMore: boolean }> {
    const {
      collection,
      getDocs,
      limit: fsLimit,
      orderBy,
      query,
      where,
      Timestamp,
    } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const coll = await this.#conversationCollection(conversationId);
    const pageSize = Math.max(1, opts?.limit ?? MESSAGE_PAGE_SIZE);

    /**
     * The cursor, and why the comparison is `<=` rather than `<`.
     *
     * `createdAt` is a `serverTimestamp()` and is NOT unique — two messages
     * sent in the same instant share one. An exclusive cursor would step over
     * the second of them, and a message that silently never appears is a far
     * worse failure than one drawn twice. `<=` guarantees an overlap of at
     * least the cursor message itself, and `mergeMessagePages` removes it by
     * id, so the cost is one wasted row per page.
     *
     * Range and order are on the SAME field, which needs no composite index.
     */
    const cursor =
      opts?.before && !Number.isNaN(Date.parse(opts.before))
        ? Timestamp.fromDate(new Date(opts.before))
        : null;

    /* One extra row, asked for but never shown: its PRESENCE is the answer to
       `hasMore`, without a second count query. */
    const constraints = [
      ...(cursor ? [where("createdAt", "<=", cursor)] : []),
      orderBy("createdAt", "desc"),
      fsLimit(pageSize + 1),
    ];
    const snap = await getDocs(
      query(
        collection(legacyDb(), coll, conversationId, "messages"),
        ...constraints,
      ),
    ).catch(() => null);
    if (!snap) return { messages: [], hasMore: false };
    const hasMore = snap.docs.length > pageSize;
    /* Fetched newest-first so `limit` keeps the RIGHT end of a long thread —
       the recent messages, not the oldest ones — then reversed once here so
       every reader downstream still sees ascending order. */
    const messages = snap.docs
      .slice(0, pageSize)
      .map((d) =>
        readMessageDoc(d.id, conversationId, d.data() as Record<string, unknown>),
      )
      .reverse();
    return { messages, hasMore };
  }

  /**
   * Announce something this repository just wrote to Firestore.
   *
   * ## The bug class this closes
   *
   * A large part of this repository writes browser-to-Firestore — the old
   * app's own pattern, kept deliberately. But the old app pairs each such write
   * with a call that announces it, and this one did not, so an entire class of
   * event happened silently: a manager never learned an extension was waiting
   * on them, an employee never learned their answer had come, somebody added to
   * a group found out by noticing it in a list. `sendMessage` was the first of
   * these to be found; it was not the only one.
   *
   * **Only the kind and the record id go over the wire.** No title, no body, no
   * recipients — `coworkEvents.routes.js` reads the record, checks this
   * caller's standing in it, resolves who is affected and composes the words.
   * A browser that could send those directly could put any text in anybody's
   * inbox.
   *
   * Always fire-and-forget, and never awaited into a result. The write it
   * describes is already committed; failing the action because an announcement
   * did not go out would have somebody repeat a change that already happened.
   */
  #announce(kind: string, payload: Record<string, unknown>): void {
    void (async () => {
      try {
        const token = await this.#token();
        if (!token) return;
        await legacyFetch({
          path: "/cowork/notify-event",
          method: "POST",
          token,
          body: { kind, ...payload },
        });
      } catch {
        /* The change landed. There is nothing here worth surfacing. */
      }
    })();
  }

  /**
   * Tell the recipients a message was sent. Push and email; no Firestore row.
   *
   * `POST /cowork/direct-message/notify` and `POST /cowork/group/:id/notify`
   * exist for exactly this and take the message TEXT rather than an id,
   * because the engine never sees the message itself — it was written from the
   * browser. Both resolve their own recipients and both exclude the sender.
   *
   * A direct conversation's id encodes the pair, so the recipient is whichever
   * half is not the sender. A thread somehow addressed only to yourself
   * notifies nobody rather than notifying you about your own message.
   */
  async #announceMessage(
    conversationId: string,
    coll: string,
    text: string,
    media: MessageAttachment[],
  ): Promise<void> {
    try {
      const token = await this.#token();
      if (!token) return;
      const messageType = media.length ? media[0].kind : "text";

      if (coll === GROUP_COLLECTION) {
        await legacyFetch({
          path: `/cowork/group/${encodeURIComponent(conversationId)}/notify`,
          method: "POST",
          token,
          body: { text, messageType },
        });
        return;
      }

      const me = String(this.#ctx.employeeId);
      const toEmployeeId = pairOf(conversationId).find((id) => id !== me);
      if (!toEmployeeId) return;
      await legacyFetch({
        path: "/cowork/direct-message/notify",
        method: "POST",
        token,
        body: { toEmployeeId, text, messageType },
      });
    } catch {
      /* The message is sent. Nothing here is worth surfacing. */
    }
  }

  async sendMessage(
    conversationId: string,
    text: string,
    attachments?: MessageAttachment[],
    replyTo?: MessageReply | null,
  ): Promise<ActionResult<Message>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return {
        ok: false,
        code: "permission_denied",
        message: "Sign in to send a message.",
      };
    const body = text.trim();
    const media = attachments ?? [];
    /* A message may be all caption, all media, or both — but not empty. */
    if (!body && media.length === 0)
      return {
        ok: false,
        code: "validation_failed",
        message: "Write a message.",
        field: "text",
      };

    const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const coll = await this.#conversationCollection(conversationId);
    const directory = await this.#employeesById();
    const senderName = directory.get(me)?.displayName ?? me;
    const messageId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `m_${me}_${Date.now()}`;

    try {
      await setDoc(doc(legacyDb(), coll, conversationId, "messages", messageId), {
        ...messageWriteBody({
          messageId,
          conversationId,
          senderId: me,
          senderName,
          text: body,
          threadType: coll === DM_COLLECTION ? "direct" : "group",
          attachments: media,
          replyTo: replyTo ?? null,
        }),
        createdAt: serverTimestamp(),
      });

      /* Bump the parent's last-message line so the list re-sorts and previews
         without opening the thread. `merge` creates the parent if a brand-new
         direct thread has not written it yet, and never clobbers participants.
         With media and no caption the preview names the media, as the old app
         stored it. */
      const previewType = media.length ? media[0].kind : "text";
      const lastMessage = {
        text: body || (media.length ? attachmentPreview(media[0].kind) : ""),
        senderId: me,
        senderName,
        messageType: previewType,
        sentAt: serverTimestamp(),
      };
      const parent =
        coll === DM_COLLECTION
          ? {
              conversationId,
              participantIds: pairOf(conversationId),
              lastMessage,
              updatedAt: serverTimestamp(),
            }
          : { lastMessage, lastMessageTime: serverTimestamp(), updatedAt: serverTimestamp() };
      await setDoc(doc(legacyDb(), coll, conversationId), parent, {
        merge: true,
      });

      /* **Announce it. Writing the message is only half of sending one.**
       *
       * Messages are written browser-to-Firestore, which is how the old app
       * does it too — but the old app then calls a second endpoint whose only
       * job is to notify, and this did not. The result was a message that
       * arrived silently: it appeared in the thread and in the conversation
       * list, and the recipient got no push and no email, so unless they were
       * already looking at that exact conversation they never learned it
       * existed.
       *
       * These two routes deliberately do NOT write a `cowork_notifications`
       * row — they send push and email only. That is the engine's own choice
       * and it is right: the conversation IS the durable record, and a bell
       * entry per message would bury every task notification underneath chat.
       *
       * Fire-and-forget, matching `direct-messages/page.js`'s own
       * `.catch(() => {})`. The message is committed and correct by this
       * point; failing the send because a push did not go out would have
       * somebody re-send a message that already arrived. The engine likewise
       * answers 200 before it starts, for the same reason. */
      void this.#announceMessage(conversationId, coll, body, media);

      notifyRepositoryChanged("listConversations");
      return {
        ok: true,
        data: {
          id: messageId,
          conversationId,
          senderId: me,
          senderName,
          text: body,
          attachmentIds: [],
          attachments: media,
          replyToId: replyTo?.messageId ?? null,
          replyTo: replyTo ?? null,
          createdAt: new Date().toISOString(),
          readBy: [me],
        },
      };
    } catch (e) {
      console.error("[sendMessage]", e);
      return {
        ok: false,
        code: "offline",
        message: "The message could not be sent.",
      };
    }
  }

  /**
   * Upload one file to shared media storage — Google Drive.
   *
   * **The browser sends the bytes to Google, not to us.** This used to POST a
   * multipart form at `/cowork/upload/pdf`, which streams the whole file through
   * the Express process into memory before forwarding it: fine for a screenshot,
   * and the reason the backend grew a resumable route in the first place — its
   * own comment names "500MB files hammering backend RAM/bandwidth" as the
   * problem it was written to solve. The old application has used the resumable
   * path for every image and document since; this is that path, and there is no
   * longer a second, worse one for the same job.
   *
   * Cloudinary is not in this file and should not return to it. The backend's
   * `/upload/image` and `/upload/voice` routes answer "Must supply api_key" —
   * the account is not configured — and a Drive `fileId` is what every renderer
   * here actually wants.
   */
  async uploadDriveFile(
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<ActionResult<UploadedMedia>> {
    try {
      const { idToken } = await import("../../legacy/firebase.ts");
      const token = await idToken();
      if (!token)
        return {
          ok: false,
          code: "permission_denied",
          message: "Sign in to attach a file.",
        };

      const { uploadToDrive } = await import("../../legacy/driveUpload.ts");
      const r = await uploadToDrive({ token, file, onProgress });
      if (!r.ok) {
        return {
          ok: false,
          code:
            r.error.kind === "auth" || r.error.kind === "permission"
              ? "permission_denied"
              : "offline",
          message: r.error.message,
        };
      }
      return {
        ok: true,
        data: {
          fileId: r.data.fileId,
          url: r.data.url,
          name: r.data.fileName,
          mimeType: r.data.mimeType,
          sizeBytes: r.data.sizeBytes,
        },
      };
    } catch (e) {
      console.error("[uploadDriveFile]", e);
      return {
        ok: false,
        code: "offline",
        message:
          e instanceof Error && e.message
            ? e.message
            : "The upload failed. Please try again.",
      };
    }
  }

  /**
   * Upload one file for a message, returning the attachment to hand to
   * `sendMessage`.
   *
   * The kind is decided from the mime type and the storage is `uploadDriveFile`,
   * so a chat image, a voice note and a PDF all take the same route and differ
   * only in how the thread draws them. A Drive `fileId` is kept on the
   * attachment because that — not the URL — is what makes the file renderable:
   * see `lib/rules/media/driveUrls.ts`.
   */
  async uploadMessageAttachment(
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<ActionResult<MessageAttachment>> {
    /* Name AND type, because `File.type` is empty for plenty of real files —
       see `attachmentKind`. Deciding on the type alone filed videos as generic
       attachments, which render as a paperclip row instead of a player. */
    const kind = attachmentKind(file.name, file.type);

    const r = await this.uploadDriveFile(file, onProgress);
    if (!r.ok) return r;

    return {
      ok: true,
      data: {
        url: r.data.url,
        kind,
        name: r.data.name || file.name || null,
        sizeBytes: Number.isFinite(r.data.sizeBytes)
          ? r.data.sizeBytes
          : (file.size ?? null),
        durationSecs: null,
        fileId: r.data.fileId ?? driveFileId(r.data.url),
      },
    };
  }

  async editMessage(
    conversationId: string,
    messageId: string,
    text: string,
  ): Promise<ActionResult<Message>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    const body = text.trim();
    if (!body)
      return {
        ok: false,
        code: "validation_failed",
        message: "A message cannot be emptied by editing — delete it instead.",
        field: "text",
      };
    try {
      const { doc, getDoc, serverTimestamp, updateDoc } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const coll = await this.#conversationCollection(conversationId);
      const ref = doc(legacyDb(), coll, conversationId, "messages", messageId);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return { ok: false, code: "not_found", message: "That message is gone." };
      const data = snap.data() as Record<string, unknown>;
      /* Only the author edits, and never a tombstone. */
      if (data.senderId !== me)
        return {
          ok: false,
          code: "permission_denied",
          message: "You can only edit your own messages.",
        };
      if (data.isDeleted === true)
        return {
          ok: false,
          code: "invalid_state",
          message: "A deleted message cannot be edited.",
        };
      await updateDoc(ref, {
        text: body,
        isEdited: true,
        editedAt: serverTimestamp(),
      });
      notifyRepositoryChanged("listConversations");
      return {
        ok: true,
        data: readMessageDoc(messageId, conversationId, {
          ...data,
          text: body,
          isEdited: true,
          editedAt: new Date().toISOString(),
        }),
      };
    } catch (e) {
      console.error("[editMessage]", e);
      return {
        ok: false,
        code: "offline",
        message: "The edit could not be saved.",
      };
    }
  }

  async deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { doc, getDoc, serverTimestamp, updateDoc } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const coll = await this.#conversationCollection(conversationId);
      const ref = doc(legacyDb(), coll, conversationId, "messages", messageId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { ok: true, data: undefined };
      const data = snap.data() as Record<string, unknown>;
      if (data.senderId !== me)
        return {
          ok: false,
          code: "permission_denied",
          message: "You can only delete your own messages.",
        };
      /* Soft delete: keep the row so the thread's shape is preserved, but clear
         the content and mark it — the same tombstone the old app renders. */
      await updateDoc(ref, {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        text: "",
        attachments: [],
      });
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[deleteMessage]", e);
      return {
        ok: false,
        code: "offline",
        message: "The message could not be deleted.",
      };
    }
  }

  /**
   * React to a message, or take the reaction back.
   *
   * The one-per-person rule is decided by `reactionChanges` and written as
   * per-emoji `arrayUnion`/`arrayRemove` sentinels rather than by rewriting
   * the whole map — two people reacting in the same instant each land their
   * own change instead of the later write clobbering the earlier one.
   */
  async toggleMessageReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { arrayRemove, arrayUnion, doc, getDoc, setDoc } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const coll = await this.#conversationCollection(conversationId);
      const ref = doc(legacyDb(), coll, conversationId, "messages", messageId);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return { ok: false, code: "not_found", message: "That message is gone." };
      const data = snap.data() as Record<string, unknown>;
      if (data.isDeleted === true)
        return {
          ok: false,
          code: "invalid_state",
          message: "A deleted message cannot be reacted to.",
        };
      const changes = reactionChanges(readReactions(data.reactions), emoji, me);
      const reactions: Record<string, unknown> = {};
      for (const [e, change] of Object.entries(changes)) {
        reactions[e] = change === "add" ? arrayUnion(me) : arrayRemove(me);
      }
      /* `setDoc` + merge rather than `updateDoc`: an emoji is not a valid
         segment in an `updateDoc` string field path, and merge applies the
         sentinels inside the nested map the same way. */
      await setDoc(ref, { reactions }, { merge: true });
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[toggleMessageReaction]", e);
      return {
        ok: false,
        code: "offline",
        message: "The reaction could not be saved.",
      };
    }
  }

  /**
   * Star a message for the viewer, or unstar it.
   *
   * No tombstone guard, deliberately: a message somebody starred and the
   * sender later deleted must still be UN-starrable, or the bookmark is a
   * dead end nobody can clear.
   */
  async toggleMessageStar(
    conversationId: string,
    messageId: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { arrayRemove, arrayUnion, doc, getDoc, setDoc } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const coll = await this.#conversationCollection(conversationId);
      const ref = doc(legacyDb(), coll, conversationId, "messages", messageId);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return { ok: false, code: "not_found", message: "That message is gone." };
      const data = snap.data() as Record<string, unknown>;
      const starred =
        Array.isArray(data.starredBy) && data.starredBy.includes(me);
      await setDoc(
        ref,
        { starredBy: starred ? arrayRemove(me) : arrayUnion(me) },
        { merge: true },
      );
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[toggleMessageStar]", e);
      return {
        ok: false,
        code: "offline",
        message: "The star could not be saved.",
      };
    }
  }

  /**
   * Pin a message to the top of the conversation, for everyone in it.
   *
   * Read–modify–write on the parent document's `pinnedMessages` array; the
   * cap and the dedupe live in `withPin` so the prototype cannot disagree.
   * `merge: true` because a direct thread's parent is written lazily by the
   * first send — pinning in a thread nobody has spoken in must not throw.
   */
  async pinMessage(
    conversationId: string,
    message: { messageId: string; senderName: string; text: string },
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { doc, getDoc, setDoc } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const coll = await this.#conversationCollection(conversationId);
      const ref = doc(legacyDb(), coll, conversationId);
      const snap = await getDoc(ref);
      const current = readPinnedMessages(
        snap.exists()
          ? (snap.data() as Record<string, unknown>).pinnedMessages
          : [],
      );
      const verdict = withPin(current, {
        messageId: message.messageId,
        senderName: message.senderName,
        text: message.text,
        pinnedById: me,
        pinnedAt: new Date().toISOString(),
      });
      if (!verdict.ok)
        return { ok: false, code: "invalid_state", message: verdict.refusal };
      await setDoc(ref, { pinnedMessages: verdict.pins }, { merge: true });
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[pinMessage]", e);
      return {
        ok: false,
        code: "offline",
        message: "The message could not be pinned.",
      };
    }
  }

  /** Take a pinned message off the banner. Unpinning what is not pinned is a
   *  quiet success — the state asked for already holds. */
  async unpinMessage(
    conversationId: string,
    messageId: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { doc, getDoc, setDoc } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const coll = await this.#conversationCollection(conversationId);
      const ref = doc(legacyDb(), coll, conversationId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { ok: true, data: undefined };
      const current = readPinnedMessages(
        (snap.data() as Record<string, unknown>).pinnedMessages,
      );
      await setDoc(
        ref,
        { pinnedMessages: withoutPin(current, messageId) },
        { merge: true },
      );
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[unpinMessage]", e);
      return {
        ok: false,
        code: "offline",
        message: "The message could not be unpinned.",
      };
    }
  }

  async createConversation(
    input: CreateConversationInput,
  ): Promise<ActionResult<Conversation>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    const others = [...new Set(input.participantIds)].filter((id) => id !== me);
    if (others.length === 0)
      return {
        ok: false,
        code: "validation_failed",
        message:
          input.kind === "group"
            ? "Choose at least two people for a group."
            : "Choose somebody to message.",
        field: "participantIds",
      };

    const { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } =
      await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    if (input.kind === "direct") {
      if (others.length > 1)
        return {
          ok: false,
          code: "validation_failed",
          message:
            "A direct message is between two people. Create a group instead.",
          field: "participantIds",
        };
      const other = others[0];
      const id = directDocId(me, other);
      const ref = doc(legacyDb(), DM_COLLECTION, id);
      const existing = await getDoc(ref).catch(() => null);
      const participantIds = [me, other].sort();
      if (!existing?.exists()) {
        await setDoc(ref, {
          conversationId: id,
          participantIds,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        notifyRepositoryChanged("listConversations");
      }
      /* Deduplicated on the pair: messaging somebody you already have a thread
         with reopens it rather than starting a second one beside it. */
      return {
        ok: true,
        data: existing?.exists()
          ? readDirectConversationDoc(
              id,
              existing.data() as Record<string, unknown>,
              LEGACY_ORGANISATION_ID,
            )
          : {
              organisationId: LEGACY_ORGANISATION_ID,
              id,
              kind: "direct",
              participantIds,
              title: null,
              groupId: null,
              lastMessageAt: null,
              lastMessagePreview: null,
              unreadCount: 0,
            },
      };
    }

    /* Group. */
    if (others.length < 2)
      return {
        ok: false,
        code: "validation_failed",
        message: "A group needs at least two other people.",
        field: "participantIds",
      };
    const title = (input.title ?? "").trim();
    if (!title)
      return {
        ok: false,
        code: "validation_failed",
        message: "Give the group a name.",
        field: "title",
      };

    const memberIds = [me, ...others];
    const groupConv = (id: string, ids: string[]): Conversation => ({
      organisationId: LEGACY_ORGANISATION_ID,
      id,
      kind: "group",
      participantIds: ids,
      title,
      groupId: id,
      adminIds: [me],
      lastMessageAt: null,
      lastMessagePreview: null,
      unreadCount: 0,
    });
    /* Browser-direct create first. If the rules gate it — the old app restricted
       group creation to CEO/TL through the backend — fall back to that same
       endpoint with the Firebase token, so a permitted user still succeeds and
       everyone else gets a clear refusal rather than a silent failure. */
    try {
      const ref = await addDoc(collection(legacyDb(), GROUP_COLLECTION), {
        name: title,
        memberIds,
        adminIds: [me],
        createdBy: me,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessage: null,
      });
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: groupConv(ref.id, memberIds) };
    } catch (e) {
      const viaBackend = await this.#createGroupViaBackend(title, others);
      if (viaBackend) {
        notifyRepositoryChanged("listConversations");
        return { ok: true, data: viaBackend };
      }
      console.error("[createConversation:group]", e);
      return {
        ok: false,
        code: "permission_denied",
        message:
          "This group could not be created — you may not have permission to start one here.",
      };
    }
  }

  /** The backend group-create route, for when browser-direct writes to
   *  `cowork_groups` are not permitted. Gated to CEO/TL on the server, so it
   *  returns null — and the caller reports the refusal — when the viewer may not. */
  async #createGroupViaBackend(
    name: string,
    otherMemberIds: string[],
  ): Promise<Conversation | null> {
    const base = process.env.NEXT_PUBLIC_LEGACY_API_URL;
    if (!base) return null;
    try {
      const { idToken } = await import("../../legacy/firebase.ts");
      const token = await idToken();
      if (!token) return null;
      const res = await fetch(`${base}/cowork/group/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, memberIds: otherMemberIds }),
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const g = (data.group ?? data) as Record<string, unknown>;
      const id =
        typeof g.groupId === "string"
          ? g.groupId
          : typeof g.id === "string"
            ? g.id
            : null;
      if (!id) return null;
      const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
      const members = Array.isArray(g.memberIds)
        ? (g.memberIds.filter((x) => typeof x === "string") as string[])
        : [me, ...otherMemberIds];
      return {
        organisationId: LEGACY_ORGANISATION_ID,
        id,
        kind: "group",
        participantIds: members,
        title: name,
        groupId: id,
        lastMessageAt: null,
        lastMessagePreview: null,
        unreadCount: 0,
      };
    } catch {
      return null;
    }
  }

  /* ── Group administration ────────────────────────────────────────────────
   *
   * Editing a group, its membership, and who runs it — all browser-direct on the
   * `cowork_groups` doc and all gated on the actor being an admin, checked
   * against a FRESH read so the permission can never be stale. Where a legacy
   * group predates `adminIds`, its creator stands in as the admin, so no group is
   * ever left unmanageable. */

  /** Whether the viewer administers a group, read fresh. */
  async #isGroupAdmin(groupId: string, me: string): Promise<boolean> {
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const snap = await getDoc(doc(legacyDb(), GROUP_COLLECTION, groupId));
      if (!snap.exists()) return false;
      const d = snap.data() as Record<string, unknown>;
      const admins = Array.isArray(d.adminIds)
        ? (d.adminIds.filter((x) => typeof x === "string") as string[])
        : [];
      if (admins.length) return admins.includes(me);
      return typeof d.createdBy === "string" ? d.createdBy === me : false;
    } catch {
      return false;
    }
  }

  async updateGroup(
    groupId: string,
    patch: { title?: string },
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    const name = (patch.title ?? "").trim();
    if (patch.title !== undefined && !name)
      return {
        ok: false,
        code: "validation_failed",
        message: "A group needs a name.",
        field: "title",
      };
    if (!(await this.#isGroupAdmin(groupId, me)))
      return {
        ok: false,
        code: "permission_denied",
        message: "Only a group admin can edit the group.",
      };
    try {
      const { doc, serverTimestamp, updateDoc } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      await updateDoc(doc(legacyDb(), GROUP_COLLECTION, groupId), {
        ...(patch.title !== undefined ? { name } : {}),
        updatedAt: serverTimestamp(),
      });
      /* Only on a rename. A group whose name changed is a group people can no
         longer find; anything else here is not worth a bell. */
      if (patch.title !== undefined) {
        this.#announce("group_renamed", { groupId });
      }
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[updateGroup]", e);
      return {
        ok: false,
        code: "offline",
        message: "The change could not be saved.",
      };
    }
  }

  async addGroupMember(
    groupId: string,
    employeeId: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    if (!(await this.#isGroupAdmin(groupId, me)))
      return {
        ok: false,
        code: "permission_denied",
        message: "Only a group admin can add members.",
      };
    try {
      const { arrayUnion, doc, serverTimestamp, updateDoc } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      await updateDoc(doc(legacyDb(), GROUP_COLLECTION, groupId), {
        memberIds: arrayUnion(String(employeeId)),
        updatedAt: serverTimestamp(),
      });
      /* The engine's own `addGroupMember` sends this, but only for callers who
         go through its route — and this writes to Firestore directly, as the
         old app does. So the person joined a group and was never told. */
      this.#announce("group_member_added", {
        groupId,
        targetEmployeeId: String(employeeId),
      });
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[addGroupMember]", e);
      return {
        ok: false,
        code: "offline",
        message: "The member could not be added.",
      };
    }
  }

  async removeGroupMember(
    groupId: string,
    employeeId: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    const target = String(employeeId);
    /* Leaving a group is always your own to do; removing someone else is not. */
    if (target !== me && !(await this.#isGroupAdmin(groupId, me)))
      return {
        ok: false,
        code: "permission_denied",
        message: "Only a group admin can remove members.",
      };
    try {
      const { arrayRemove, doc, serverTimestamp, updateDoc } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      await updateDoc(doc(legacyDb(), GROUP_COLLECTION, groupId), {
        memberIds: arrayRemove(target),
        adminIds: arrayRemove(target),
        updatedAt: serverTimestamp(),
      });
      /* A group vanishing from your list with no explanation reads as a fault
         in the app rather than a decision somebody made. */
      this.#announce("group_member_removed", {
        groupId,
        targetEmployeeId: target,
      });
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[removeGroupMember]", e);
      return {
        ok: false,
        code: "offline",
        message: "The member could not be removed.",
      };
    }
  }

  async setGroupAdmin(
    groupId: string,
    employeeId: string,
    isAdmin: boolean,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    if (!(await this.#isGroupAdmin(groupId, me)))
      return {
        ok: false,
        code: "permission_denied",
        message: "Only a group admin can change who administers it.",
      };
    const target = String(employeeId);
    try {
      const {
        arrayRemove,
        arrayUnion,
        doc,
        getDoc,
        serverTimestamp,
        updateDoc,
      } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const ref = doc(legacyDb(), GROUP_COLLECTION, groupId);
      if (!isAdmin) {
        /* A group is never left with no admin: the last one cannot step down. */
        const snap = await getDoc(ref);
        const admins = Array.isArray(snap.data()?.adminIds)
          ? ((snap.data()!.adminIds as unknown[]).filter(
              (x) => typeof x === "string",
            ) as string[])
          : [];
        if (admins.length <= 1 && admins.includes(target))
          return {
            ok: false,
            code: "invalid_state",
            message: "A group needs at least one admin.",
          };
      }
      await updateDoc(ref, {
        adminIds: isAdmin ? arrayUnion(target) : arrayRemove(target),
        /* Promoting someone brings them into the group if they are not in it. */
        ...(isAdmin ? { memberIds: arrayUnion(target) } : {}),
        updatedAt: serverTimestamp(),
      });
      /* Gaining or losing admin changes what the controls in front of you do.
         Finding that out by pressing one and being refused is the worst way. */
      this.#announce("group_admin_changed", {
        groupId,
        targetEmployeeId: target,
        isAdmin,
      });
      notifyRepositoryChanged("listConversations");
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[setGroupAdmin]", e);
      return {
        ok: false,
        code: "offline",
        message: "The admin change could not be saved.",
      };
    }
  }

  async markConversationRead(
    conversationId: string,
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me)
      return { ok: false, code: "permission_denied", message: "Sign in first." };
    try {
      const { arrayUnion, collection, getDocs, query, where, writeBatch } =
        await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const coll = await this.#conversationCollection(conversationId);
      const snap = await getDocs(
        query(
          collection(legacyDb(), coll, conversationId, "messages"),
          where("senderId", "!=", me),
        ),
      );
      const unread = snap.docs.filter((d) => {
        const rb = (d.data() as { readBy?: unknown }).readBy;
        return !Array.isArray(rb) || !rb.includes(me);
      });
      if (unread.length) {
        const batch = writeBatch(legacyDb());
        unread.forEach((d) => batch.update(d.ref, { readBy: arrayUnion(me) }));
        await batch.commit();
        notifyRepositoryChanged("listConversations");
      }
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[markConversationRead]", e);
      return {
        ok: false,
        code: "offline",
        message: "Could not update the read state.",
      };
    }
  }

  /**
   * Stamp "my client has these" on each conversation — the grey double tick.
   *
   * One field, `delivery.{me}`, on the conversation document itself. Nothing is
   * written to any message, which is what keeps this affordable: the alternative
   * costs a write per message per recipient, and a thread in this workspace
   * already holds 173 of them.
   *
   * **`merge: true` on a dotted path, not `update`.** `update` fails outright on
   * a document that does not exist, and a direct thread's parent is written
   * lazily by the first `sendMessage` — so a conversation somebody has opened
   * but never spoken in would throw here. `setDoc(..., { merge: true })` creates
   * or amends, and touches nothing else in the document either way.
   *
   * Fire-and-forget by contract: the caller is a background effect and a failed
   * stamp costs a tick that stays grey a little longer. It must never surface as
   * an error, and it must never block a read.
   */
  async markConversationsDelivered(
    conversationIds: string[],
  ): Promise<ActionResult<void>> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me || conversationIds.length === 0)
      return { ok: true, data: undefined };
    try {
      const { doc, serverTimestamp, setDoc } = await import(
        "firebase/firestore"
      );
      const { legacyDb } = await import("../../legacy/firebase.ts");
      await Promise.all(
        conversationIds.map(async (id) => {
          const coll = await this.#conversationCollection(id);
          await setDoc(
            doc(legacyDb(), coll, id),
            { delivery: { [me]: serverTimestamp() } },
            { merge: true },
          );
        }),
      );
      /* Deliberately NOT `notifyRepositoryChanged`. The watcher on these
         documents will fire by itself, and bumping here as well would refresh
         the list twice for one stamp — on the exact path that is already
         careful not to loop. */
      return { ok: true, data: undefined };
    } catch (e) {
      console.error("[markConversationsDelivered]", e);
      return {
        ok: false,
        code: "offline",
        message: "Could not record delivery.",
      };
    }
  }

  /* ── Realtime ────────────────────────────────────────────────────────────
   *
   * The list and the open thread are `useQuery`s, and every `useQuery` re-runs
   * when `notifyRepositoryChanged()` bumps the version. So "live" is just a
   * Firestore `onSnapshot` that calls it whenever the underlying data changes —
   * a message from someone else lands and the list (and the thread, if it is
   * open) refetch on their own. The very first snapshot is skipped so mounting a
   * listener does not fire a refetch beside the query's own first read, and the
   * notify is debounced so a burst of doc changes coalesces into one refresh. */

  /** Live updates for the conversation list: any change to a thread the viewer
   *  is a party to — a new message, a new conversation, a read-receipt — refreshes
   *  the list. The returned function detaches both listeners for effect cleanup. */
  watchConversations(): () => void {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me) return () => {};
    let cleanup: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      try {
        const { collection, onSnapshot, query, where } = await import(
          "firebase/firestore"
        );
        const { legacyDb } = await import("../../legacy/firebase.ts");
        if (disposed) return;
        const bump = debounce(() => notifyRepositoryChanged("listConversations"), 250);
        const attach = (name: string, field: string) => {
          let first = true;
          return onSnapshot(
            query(
              collection(legacyDb(), name),
              where(field, "array-contains", me),
            ),
            () => {
              if (first) {
                first = false;
                return;
              }
              bump();
            },
            () => {
              /* A listener that errors (rules, connectivity) simply goes quiet;
                 the list still works from its own reads. */
            },
          );
        };
        const unDm = attach(DM_COLLECTION, "participantIds");
        const unGroup = attach(GROUP_COLLECTION, "memberIds");
        cleanup = () => {
          unDm();
          unGroup();
          bump.cancel();
        };
      } catch {
        /* Realtime is an enhancement; its absence leaves the list working. */
      }
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }

  /** Live updates for one open thread: a new, edited, deleted, or newly-read
   *  message refreshes the message list. */
  watchConversationMessages(conversationId: string): () => void {
    let cleanup: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      try {
        const { collection, onSnapshot } = await import("firebase/firestore");
        const { legacyDb } = await import("../../legacy/firebase.ts");
        const coll = await this.#conversationCollection(conversationId);
        if (disposed) return;
        const bump = debounce(() => notifyRepositoryChanged("listConversations"), 200);
        let first = true;
        const un = onSnapshot(
          collection(legacyDb(), coll, conversationId, "messages"),
          () => {
            if (first) {
              first = false;
              return;
            }
            bump();
          },
          () => {
            /* Quietly stop; the thread still works from its own read. */
          },
        );
        cleanup = () => {
          un();
          bump.cancel();
        };
      } catch {
        /* No live thread — the query still answers on its own. */
      }
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }

  /**
   * Live updates for one task's discussion.
   *
   * **Why the task thread needed its own.** A message thread has had
   * `watchConversationMessages` for as long as it has existed, so a message
   * from the other side appears on its own. The task discussion had nothing —
   * it read once on mount and again after each of the viewer's own writes, so
   * a colleague's reply simply did not arrive until something else happened to
   * refetch. Two people on one task were each looking at their own half of the
   * conversation.
   *
   * Direct on Firestore, like every other listener here: the document lives in
   * `cowork_tasks/{taskId}/chat`, the browser already reads it, and a live
   * channel through the engine would be a second delivery path for records the
   * client can already see.
   *
   * The first snapshot is skipped — it is the state the caller has just read,
   * and bumping on it would make every open of the tab refetch itself. And it
   * is debounced: a batch of read receipts is one write per message, which
   * without this is one refetch per message.
   */
  watchTaskChat(taskId: TaskId): () => void {
    let cleanup: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      try {
        const { collection, onSnapshot } = await import("firebase/firestore");
        const { legacyDb } = await import("../../legacy/firebase.ts");
        if (disposed) return;
        const bump = debounce(() => notifyRepositoryChanged("listTaskChat"), 200);
        let first = true;
        const un = onSnapshot(
          collection(legacyDb(), "cowork_tasks", String(taskId), "chat"),
          () => {
            if (first) {
              first = false;
              return;
            }
            bump();
          },
          () => {
            /* Rules or connectivity. The thread still works from its own read;
               realtime is an enhancement, never the only route to the data. */
          },
        );
        cleanup = () => {
          un();
          bump.cancel();
        };
      } catch {
        /* No live thread — the query still answers on its own. */
      }
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }

  /* ── Typing & presence ───────────────────────────────────────────────────
   *
   * Both browser-direct, because that is the whole app's shape — but confined to
   * the two Firestore locations the rules already permit. Typing is a stamp on
   * the CONVERSATION document (a fresh collection would be denied); presence is
   * read from the same `cowork_duty_status` docs the top bar uses, so "online"
   * here means exactly what it means there. */

  /** Signal that the viewer is — or is no longer — typing, as `typing.{me}` on
   *  the conversation document: a client timestamp a reader treats as live for a
   *  few seconds. Fire-and-forget; a dropped signal is only a missed ellipsis. */
  async setTyping(conversationId: string, isTyping: boolean): Promise<void> {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    if (!me) return;
    try {
      const { deleteField, doc, setDoc } = await import("firebase/firestore");
      const { legacyDb } = await import("../../legacy/firebase.ts");
      const coll = await this.#conversationCollection(conversationId);
      await setDoc(
        doc(legacyDb(), coll, conversationId),
        { typing: { [me]: isTyping ? Date.now() : deleteField() } },
        { merge: true },
      );
    } catch {
      /* Typing is a courtesy; its failure changes nothing that matters. */
    }
  }

  /** Who, other than the viewer, is typing right now — a `typing.{id}` stamp
   *  within the last few seconds. Returns an unsubscribe for effect cleanup. */
  watchTyping(
    conversationId: string,
    onChange: (typingIds: string[]) => void,
  ): () => void {
    const me = this.#ctx.employeeId ? String(this.#ctx.employeeId) : "";
    let cleanup: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      try {
        const { doc, onSnapshot } = await import("firebase/firestore");
        const { legacyDb } = await import("../../legacy/firebase.ts");
        const coll = await this.#conversationCollection(conversationId);
        if (disposed) return;
        cleanup = onSnapshot(
          doc(legacyDb(), coll, conversationId),
          (snap) => {
            const typing = (snap.data()?.typing ?? {}) as Record<
              string,
              unknown
            >;
            const now = Date.now();
            onChange(
              Object.entries(typing)
                .filter(
                  ([id, ts]) =>
                    id !== me && typeof ts === "number" && now - ts < 6000,
                )
                .map(([id]) => id),
            );
          },
          () => {
            /* Quietly stop; the thread still works without the indicator. */
          },
        );
      } catch {
        /* No live typing — the thread still works. */
      }
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }

  /** Live online/offline for a set of people, from their `cowork_duty_status`
   *  docs — "online" means actively on, not away or on a break, exactly as the
   *  top bar reads it. One listener per person; unsubscribe detaches them all. */
  watchPresence(
    employeeIds: string[],
    onChange: (online: Record<string, boolean>) => void,
  ): () => void {
    const ids = [...new Set(employeeIds)].filter(Boolean);
    let disposed = false;
    const unsubs: Array<() => void> = [];
    const online: Record<string, boolean> = {};
    void (async () => {
      try {
        const { onSnapshot } = await import("firebase/firestore");
        for (const id of ids) {
          if (disposed) return;
          const ref = await this.#dutyDoc(id);
          unsubs.push(
            onSnapshot(
              ref,
              (snap) => {
                online[id] =
                  readDutyMode(
                    snap.exists() ? (snap.data() as DutyDocument) : null,
                    Date.now(),
                  ) === "online";
                onChange({ ...online });
              },
              () => {
                /* A doc we cannot read is simply treated as not-known-online. */
              },
            ),
          );
        }
      } catch {
        /* No live presence — dots just do not show. */
      }
    })();
    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }
}

function comparerFor(sort: TaskQuery["sort"]) {
  return (a: TaskView, b: TaskView): number => {
    switch (sort) {
      case "title":
        return a.task.title.localeCompare(b.task.title);
      case "due": {
        /* Undated last. Sorting them to the top would put tasks with no
           deadline ahead of ones that are due today. */
        const av = a.task.deadline.dueAt;
        const bv = b.task.deadline.dueAt;
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av.localeCompare(bv);
      }
      case "rank":
      default: {
        const ar = a.myRank ?? Number.MAX_SAFE_INTEGER;
        const br = b.myRank ?? Number.MAX_SAFE_INTEGER;
        return ar - br;
      }
    }
  };
}

/** Satisfies the parts of `CoworkRepository` this build connects. */
export type LegacyRepositoryShape = Pick<
  CoworkRepository,
  "getViewer" | "listEmployees" | "getScoreOverview" | "listTasks"
>;

/**
 * The `LegacyRepository` as a full `CoworkRepository`.
 *
 * The interface has 187 methods; four are connected and a further handful
 * answer explicitly empty for the dashboard. Rather than stub the remaining
 * ~175 by hand — which would be pages of noise nobody could audit — a proxy
 * answers for them, and it **throws**.
 *
 * Throwing is the deliberate half of this. `useQuery` has a real error state,
 * so an unconnected read surfaces as a visible failure on the card that asked
 * for it, naming the method. The alternative — returning a plausible empty
 * value for any shape — would make an unwired screen indistinguishable from a
 * genuinely empty one, which is the confusion this whole migration has been
 * built to avoid.
 *
 * The cast is honest about what it is: this satisfies the interface at runtime
 * for the paths that are wired, and fails loudly on the paths that are not.
 */
export function toCoworkRepository(
  repository: LegacyRepository,
): CoworkRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const existing = Reflect.get(target, property, receiver);
      if (existing !== undefined) {
        return typeof existing === "function" ? existing.bind(target) : existing;
      }
      if (typeof property !== "string") return undefined;
      return () => {
        throw new NotConnectedError(property);
      };
    },
  }) as unknown as CoworkRepository;
}
