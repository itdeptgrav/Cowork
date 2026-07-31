import type { Employee, EmployeeId, Meeting, MonitoringSubject, Notification, Role, ScoreOverview, ScoreUnit, Viewer } from "@/lib/domain";
import { ROLE_ADMIN, systemRoles } from "../../auth/systemRoles.ts";
import { presenceIdentityFor } from "../../integrations/livekit/identity.ts";
import {
  STALE_AFTER_MS,
  dailyHoursSecs,
  dutyTransition,
  heartbeatPatch,
  ownsClaim,
  readDutyMode,
  storedMode,
  type DutyDocument,
  type DutyMode,
} from "../../rules/presence/duty.ts";
import { bankableRunSecs } from "../../rules/tasks/timer.ts";
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
import type { ActionResult, ActionableItem, ChangePriorityInput, CoworkRepository, CreateTaskInput, Page, TaskQuery, TaskView } from "../types";
import { actionableFor } from "../../rules/tasks/actionable.ts";
import { emergencyRequestRefusal } from "../../rules/tasks/emergency.ts";
import type { BlockedDate, DailyReport, DeadlineExtension, DeadlineProposal, Department, EmergencyRequest, PriorityCascade, PriorityChange, PriorityConflict, ReworkRequest, Task, TaskChatMessage, TaskId, TaskReview, TaskSubmission, TimerSession, WorkCommit } from "@/lib/domain";
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
  startTask as startTaskRequest,
  submitCompletion,
  proposeDeadline as proposeDeadlineRequest,
  acceptAssignorWindow as acceptAssignorWindowRequest,
  rejectAssignorWindow as rejectAssignorWindowRequest,
  approveDeadline as approveDeadlineRequest,
} from "../../legacy/taskWrites.ts";
import { listMembers } from "../../legacy/employees.ts";
import { toHierarchyId } from "../../legacy/identityMap.ts";
import {
  buildReportingTree,
  fetchMyManagers,
  type LegacyManagers,
  type ReportingNode,
  type ReportingTree,
} from "../../legacy/hierarchy.ts";
import { fetchDashboard } from "../../legacy/scoring.ts";
import { fetchLedger } from "../../legacy/sop.ts";
import { legacyFetch } from "../../legacy/http.ts";
import { LEGACY_ORGANISATION_ID, toEmployee, toScoreHistory, toScoreOverview, toViewer } from "./map.ts";
import { toTaskStatus, toTaskView } from "./taskMap.ts";
import { activeQueuePositions } from "../../rules/tasks/activeQueue.ts";
import {
  holdersOf,
  resolveTaskPriority,
} from "../../rules/tasks/resolveTaskPriority.ts";
import { resolveTimeBudget } from "../../rules/tasks/resolveTimeBudget.ts";
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
import { readDueAtMs, readInstant, readTask } from "../../legacy/tasks.ts";
import { firstNumber } from "../../legacy/wire.ts";
import {
  toMeetings,
  toNotifications,
  toWorkloadRows,
  type LegacyWorkloadRow,
} from "./workMap.ts";

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

const emptyPage = <T,>(): Page<T> => ({ items: [], nextCursor: null, total: 0 });

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
  const startedAtRealMs =
    typeof data.lastStartTime === "number" ? data.lastStartTime : null;
  return {
    organisationId: LEGACY_ORGANISATION_ID,
    taskId: taskId as TaskId,
    employeeId,
    isActive: data.isActive === true,
    accumulatedSecs: firstNumber(data, "totalSeconds", "totalSecs") ?? 0,
    /* Legacy stores one real timestamp and no prototype clock. Presenting the
       real one as both keeps a session readable without inventing a second
       reading of when it began. */
    startedAt:
      startedAtRealMs !== null ? new Date(startedAtRealMs).toISOString() : null,
    startedAtRealMs,
  };
}

export class LegacyRepository {
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
    const tree = await this.#reportingTree();
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
    const node = tree.byEmployee.get(toHierarchyId(id));
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
    legacyTasks = legacyTasks.filter((t) => {
      if (t.status !== "pending_department_approval") return true;
      if (t.createdById === viewerId) return true;
      if (t.pendingAssigneeId === viewerId) return true;
      return t.departmentApproverIds.includes(viewerId);
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
    const myQueue = activeQueuePositions(
      legacyTasks
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
        })),
    );

    /* Chained once for the whole list, not per row. The order is the derived
       queue, so the dates agree with the positions shown beside them. */
    const myDueDates = await this.#chainQueue(
      viewerId,
      [...myQueue.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id),
      legacyTasks,
    );

    const byId = new Map(legacyTasks.map((t) => [t.id, t]));
    if (q.scope !== "submitted") {
      legacyTasks = legacyTasks.filter((t) => {
        if (!t.parentTaskId) return true;
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

      legacyTasks = [...byId.values()].filter((t) =>
        canManagerViewTask(
          viewerId,
          {
            assigneeIds: t.assigneeIds,
            pendingAssigneeIds: t.pendingAssigneeId ? [t.pendingAssigneeId] : [],
          },
          tree,
        ),
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
        dueDates: Map<string, string>;
      }
    >([
      [viewerId, { ownerId: viewerId, positions: myQueue, dueDates: myDueDates }],
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
            dueDates: q.dueDates,
          });
        } catch {
          /* One report's failed queue read means their rows fall back to the
             stored rank — better than failing the whole list. Same tolerance the
             detail path uses. */
        }
      }),
    );

    let views = legacyTasks.map((legacy) => {
      const subjectId = subjectOf(legacy);
      return toTaskView({
        legacy,
        employeesById,
        viewerId,
        nowMs,
        /* The ROW's subject queue — the person who actually holds this task — so
           the derived, gap-free 1..N a manager sees is identical to what the
           report sees on their own list, and the operational date agrees too.
           Falls back to undefined (→ stored rank) only when unresolved. */
        queue: (subjectId && queuesBySubject.get(subjectId)) || undefined,
        viewerLegacyRole: this.#ctx.legacyRole,
      });
    });

    if (q.status?.length) {
      const wanted = new Set(q.status);
      views = views.filter((v) => wanted.has(v.task.status));
    }
    if (q.assigneeId) {
      const wanted = String(q.assigneeId);
      views = views.filter((v) =>
        v.assignees.some((a) => a.id === wanted) ||
        v.task.createdById === wanted,
      );
    }
    if (q.overdueOnly) views = views.filter((v) => v.isOverdue);
    if (q.search) {
      const needle = q.search.toLowerCase();
      views = views.filter((v) => v.task.title.toLowerCase().includes(needle));
    }

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
   * A task's children.
   *
   * From `subtaskIds` on the parent, which the engine maintains with
   * `arrayUnion` as subtasks are created — rather than a `where("parentTaskId",
   * "==", id)` query, which would need another composite index and could
   * disagree with the array the rest of the engine reads.
   *
   * Missing children are skipped rather than throwing: `subtaskIds` can name a
   * task that has since been deleted, and one stale id must not empty the
   * whole list.
   */
  async getSubtasks(id: TaskId): Promise<TaskView[]> {
    /* The raw document, because `subtaskIds` is a wire field the `TaskView`
       does not carry — the view is what a screen renders, not the hierarchy
       bookkeeping. */
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", String(id)));
    if (!snap.exists()) return [];
    const raw = snap.data() as { subtaskIds?: unknown };
    const ids = Array.isArray(raw.subtaskIds)
      ? raw.subtaskIds.filter(
          (v): v is string => typeof v === "string" && v !== "",
        )
      : [];
    if (ids.length === 0) return [];

    const views = await Promise.all(
      ids.map((childId) => this.#readTaskView(childId).catch(() => null)),
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

  /** One task, read back through the same mapper the list uses. */
  async #readTaskView(taskId: string): Promise<TaskView | null> {
    const { doc, getDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");
    const snap = await getDoc(doc(legacyDb(), "cowork_tasks", taskId));
    if (!snap.exists()) return null;
    const legacy = readTask({
      ...(snap.data() as Record<string, unknown>),
      id: snap.id,
    } as never);
    if (!legacy) return null;
    const viewerId = String(this.#ctx.employeeId);

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
          dueDates: Map<string, string>;
        }
      | undefined;
    if (subjectId) {
      try {
        const q = await this.#activeQueueOf(subjectId);
        queue = {
          ownerId: subjectId,
          positions: new Map(q.order.map((id, i) => [id, i + 1])),
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

    return toTaskView({
      legacy,
      employeesById,
      viewerId,
      nowMs: Date.now(),
      queue,
      viewerLegacyRole: this.#ctx.legacyRole,
      budgetOwner,
      loggedSecs,
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
   * `satisfiesRequirementIds` is dropped rather than sent: requirements are a
   * new-product concept with no legacy field, and inventing one on the engine's
   * document would create a second source for what a subtask is for.
   */
  async createSubtask(input: {
    parentTaskId: TaskId;
    title: string;
    description?: string | null;
    assigneeIds: EmployeeId[];
    estimatedEffortSecs?: number | null;
    fixedDueAt?: string | null;
    senderWindowSecs?: number | null;
  }): Promise<ActionResult<Task>> {
    const parentId = String(input.parentTaskId);
    return this.#write(
      (token) =>
        createSubtaskRequest({
          token,
          taskId: parentId,
          title: input.title,
          assigneeIds: input.assigneeIds.map(String),
          description: input.description ?? "",
          dueDate: input.fixedDueAt ?? undefined,
          windowSecs:
            input.senderWindowSecs ?? input.estimatedEffortSecs ?? undefined,
        }),
      (data) => {
        const d = data as { taskId?: unknown; task?: { taskId?: unknown } };
        const id = d?.taskId ?? d?.task?.taskId;
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
    const result = await this.#write(
      (token) => sendTaskChatRequest({ token, taskId: id, message: text }),
      () => id,
    );
    return result as unknown as ActionResult<never>;
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
       what was asked — "granted what you asked" and "granted 4h" are different
       facts, and the confirmation card shows the second as a change. */
    const granted =
      options?.grantedSecs !== undefined &&
      Math.round(options.grantedSecs) !== record.newBudgetSecs
        ? Math.max(1, Math.round(options.grantedSecs))
        : null;

    await updateDoc(ref, {
      status: "approved",
      approvedAt: decidedAt,
      approvedSecs: granted,
      ...(options?.reason ? { reason: options.reason } : {}),
    });
    notifyRepositoryChanged();
    return {
      ok: true,
      data: {
        ...record,
        status: "approved",
        approvedAt: decidedAt,
        approvedSecs: granted,
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
      /* The MANAGER escalates; the assignor decides. */
      requestedBy: this.#ctx.employeeId ?? "",
      approverId: routedDeadlineApproverId({
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
    const { getDoc, setDoc } = await import("firebase/firestore");

    const view = await this.#readTaskView(id);
    const taskTitle = view?.task.title ?? id;

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
    const refusal = presenceWriteRefusal(await this.getDutyMode());
    if (refusal) return refusal;

    /* Pause whatever else is running. */
    const active = await this.getActiveTimer();
    if (active && active.taskId !== id) {
      await this.pauseTimer(active.taskId, null, "switched_task" as never);
    }

    const ref = await this.#timerSession(employeeId, id);
    const existing = await getDoc(ref);
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
    await this.#logTimerEvent(employeeId, "start", id, taskTitle);

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
    const { getDoc, setDoc } = await import("firebase/firestore");

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
      graceMs: STALE_AFTER_MS,
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
    await this.#logTimerEvent(
      employeeId,
      "pause",
      id,
      data.taskTitle ?? id,
      pauseReason,
    );
    notifyRepositoryChanged();
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
   * If the previous beat is ALREADY older than the staleness window, the session
   * was abandoned rather than merely between beats. It is paused here instead of
   * refreshed, which banks only the worked time up to that last beat: a person
   * returning hours later finds the clock stopped at the right figure rather
   * than still running on the gap.
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
    if (data.isActive !== true) return { ok: true, data: undefined };

    const now = Date.now();
    const lastBeat =
      Number(data.heartbeatAt) || Number(data.lastStartTime) || now;
    if (now - lastBeat > STALE_AFTER_MS) {
      /* Abandoned since the last beat — pause, which caps the banked time at
         that beat so the gap is not credited. */
      await this.pauseTimer(id as TaskId, null, "went_away" as never);
      return { ok: true, data: undefined };
    }
    await setDoc(ref, { heartbeatAt: now, updatedAt: now }, { merge: true });
    return { ok: true, data: undefined };
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

    if (input.mode !== "online" && !ownsClaim(previous, input.connectionId, now)) {
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

    const { setDoc } = await import("firebase/firestore");
    await setDoc(await this.#dutyDoc(employeeId), { employeeId, ...patch }, { merge: true });

    /* **Deadline compensation: the ONE event that moves a deadline.**
     *
     * Returning to online from an unavailable state is the only trigger — not a
     * play, a heartbeat, a refresh or a running timer. The lost time is added to
     * every active task's stored deadline, once, and then it is frozen again
     * because nothing else writes it while the person is online. */
    if (input.mode === "online") {
      const lostMs = offlineToCreditMs + breakToCreditMs + emergencyToRaiseMs;
      if (lostMs > 0) {
        const shifted = await this.#compensateActiveDeadlines(employeeId, lostMs);
        console.info("[presence] DEADLINE COMPENSATION applied:", {
          employeeId,
          lostMinutes: Math.round(lostMs / 60000),
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
  async #compensateActiveDeadlines(
    employeeId: string,
    lostMs: number,
  ): Promise<number> {
    if (lostMs <= 0) return 0;
    let shifted = 0;
    try {
      const { collection, query, where, getDocs, doc, updateDoc } = await import(
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

      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const status = typeof data.status === "string" ? data.status : "";
        if (ABSENCE_TERMINAL_STATUSES.has(status)) continue;

        /* The source field, so the write lands where the read looks. */
        const field =
          readInstant(data.fixedDeadline) !== null
            ? "fixedDeadline"
            : readInstant(data.deadline) !== null
              ? "deadline"
              : readInstant(data.dueDate) !== null
                ? "dueDate"
                : null;
        if (field === null) continue;

        const currentMs = readInstant(data[field])!;
        const newDueIso = new Date(currentMs + lostMs).toISOString();
        await updateDoc(doc(db, "cowork_tasks", d.id), {
          [field]: newDueIso,
          updatedAt: new Date(),
        });
        shifted += 1;
      }
    } catch (error) {
      console.error("[duty] deadline compensation failed:", error);
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
   *
   * The staleness window is applied **per emission and on a timer**, because a
   * claim going stale is the absence of a write: nobody is going to notify us
   * that somebody's laptop shut. Without the timer a manager's screen would
   * hold a green dot until some unrelated document happened to change.
   */
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

    /* Half the staleness window, so a dot is never more than that much out of
       date. Cheap — it re-reads documents already in memory and writes nothing. */
    const sweep = setInterval(emit, STALE_AFTER_MS / 2);

    return () => {
      stopped = true;
      clearInterval(sweep);
      for (const unsub of unsubscribers) unsub();
    };
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
  listTaskEvents(): Promise<never> {
    return Promise.reject(
      new Error(
        "The Cowork engine keeps no event log for a task. What it does record is in the deadline history and the task thread.",
      ),
    );
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
   * A cascade is a new-product concept: a record of every deadline that moved
   * because something was promoted above it. Legacy computes none — which is
   * why `listPendingAcknowledgements` is empty and this is unreachable in
   * practice rather than merely refused. Wired to a refusal anyway, so that if
   * a cascade ever does reach the gate the button says something true.
   */
  async acknowledgeCascade(): Promise<ActionResult<never>> {
    return {
      ok: false,
      code: "invalid_state",
      message:
        "The Cowork engine does not record priority cascades, so there is nothing to acknowledge.",
    } as unknown as ActionResult<never>;
  }

  /**
   * Subtask requirements.
   *
   * The requirement checklist is a new-product concept with no legacy field. A
   * subtask still works — `createSubtask` is connected — but what it satisfies
   * is not something the engine can be told.
   */
  async addRequirements(): Promise<ActionResult<never>> {
    return {
      ok: false,
      code: "invalid_state",
      message:
        "Requirements are not part of the Cowork engine's task model, so they cannot be saved. Break the work out as a subtask instead.",
    } as unknown as ActionResult<never>;
  }

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
  async decideEmergencyRequest(
    requestId: string,
    approve: boolean,
    decisionReason?: string,
  ): Promise<ActionResult<EmergencyRequest>> {
    const me = String(this.#ctx.employeeId);
    const { doc, updateDoc } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    try {
      await updateDoc(
        doc(legacyDb(), "cowork_emergency_approvals", requestId),
        {
          status: approve ? "approved" : "rejected",
          resolvedAt: new Date(),
          resolvedBy: me,
          resolvedByName: me,
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
      return {
        id: d.id,
        taskId: id as TaskId,
        employeeId: (typeof r.employeeId === "string" ? r.employeeId : "") as EmployeeId,
        reportDate: typeof r.reportDate === "string" ? r.reportDate : "",
        message: typeof r.message === "string" ? r.message : "",
        progressPercent: Number(r.progressPercent) || 0,
        attachmentIds: [
          ...(Array.isArray(r.imageUrls) ? r.imageUrls : []),
          ...(Array.isArray(r.pdfAttachments) ? r.pdfAttachments : []),
        ].filter((u): u is string => typeof u === "string"),
        createdAt: created ? new Date(created).toISOString() : "",
      };
    });
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
         deploy this does not need. */
      if (new Date(endedAtMs).toISOString().slice(0, 10) !== date) continue;
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
  async listSubmissions(taskId: TaskId): Promise<TaskSubmission[]> {
    const id = String(taskId);
    const doc = await this.#taskDocument(id);
    if (!doc) return [];
    const raw = doc.completionSubmission;
    if (!raw || typeof raw !== "object") return [];
    const sub = raw as Record<string, unknown>;

    const submittedAtMs = readInstant(sub.submittedAt);
    const chain = await this.#reviewChainOf(doc);
    return [
      {
        id: compositeId(id, "submission"),
        taskId: id as TaskId,
        /* One record, so one attempt. Counting resubmissions would need a
           history legacy does not keep. */
        attempt: 1,
        submittedById: (typeof sub.submittedBy === "string" ? sub.submittedBy : "") as EmployeeId,
        submittedAt: submittedAtMs ? new Date(submittedAtMs).toISOString() : "",
        message: typeof sub.message === "string" ? sub.message : "",
        attachmentIds: [
          ...(Array.isArray(sub.imageUrls) ? sub.imageUrls : []),
          ...(Array.isArray(sub.pdfAttachments) ? sub.pdfAttachments : []),
        ]
          .map((a) =>
            typeof a === "string"
              ? a
              : a && typeof a === "object" && typeof (a as { url?: unknown }).url === "string"
                ? (a as { url: string }).url
                : null,
          )
          .filter((u): u is string => u !== null),
        reviewChain: chain.chain,
        currentStage: chain.currentStage,
        supersededById: null,
        /* Legacy does not stamp lateness on the submission; deriving it here
           against a deadline that may since have moved would put a late flag on
           work that was not. */
        wasLate: false,
      },
    ];
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
    if (role === "creator") return ids.creatorId || null;

    if (role === "chief_executive") {
      /* By ROLE, not by a hardcoded id — legacy's `ceo-review` is guarded by
         `verifyCeoToken`, which asks the same question. */
      const employees = await this.#employeesById();
      for (const person of employees.values()) {
        if (person.roleIds.includes(ROLE_ADMIN)) return person.id;
      }
      return null;
    }

    /* The assignee's manager, from the reporting tree — the product's source of
       truth for who manages whom. */
    if (!ids.assigneeId) return null;
    const tree = await this.#reportingTree();
    const node = tree.byEmployee.get(toHierarchyId(ids.assigneeId));
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

    return snap.docs.map((d) => {
      const m = d.data() as Record<string, unknown>;
      const type = typeof m.messageType === "string" ? m.messageType : "text";
      const attachments = Array.isArray(m.attachments) ? m.attachments : [];
      return {
        id: typeof m.messageId === "string" ? m.messageId : d.id,
        taskId: id as TaskId,
        thread: "chat" as const,
        senderId:
          type === "system"
            ? ("system" as const)
            : ((typeof m.senderId === "string" ? m.senderId : "") as EmployeeId),
        senderName: typeof m.senderName === "string" ? m.senderName : "",
        text: typeof m.text === "string" ? m.text : "",
        /* Legacy stores whole attachment objects inline; the domain holds ids.
           The url is the only stable handle there is, so it stands in as the
           id — there is no attachment collection to point at. */
        attachmentIds: attachments
          .map((a) =>
            a && typeof a === "object" && typeof (a as { url?: unknown }).url === "string"
              ? ((a as { url: string }).url)
              : null,
          )
          .filter((u): u is string => u !== null),
        messageType:
          type === "system"
            ? ("system" as const)
            : attachments.length
              ? ("attachment" as const)
              : ("text" as const),
        createdAt: readInstant(m.createdAt)
          ? new Date(readInstant(m.createdAt)!).toISOString()
          : "",
      };
    });
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
    return out;
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

  /** Scheduled meetings. `GET /cowork/schedule-meet/list`. */
  async listMeetings(): Promise<Meeting[]> {
    const token = await this.#token();
    const result = await legacyFetch<unknown[]>({
      path: "/cowork/schedule-meet/list",
      envelopeKey: "meets",
      token,
    });
    if (!result.ok) throw new Error(result.error.message);
    return toMeetings((result.data ?? []) as never[]);
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
  async listProjects() { return emptyPage(); }
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
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const [policy, blockedDates, logged] = await Promise.all([
        this.getOfficePolicy(),
        this.listBlockedDates(employeeId, from, to).catch(() => []),
        /* What is already done, so the chain schedules what is LEFT. Work done
           at 04:53 counts in full; the office calendar governs only when the
           remainder can happen. */
        this.#loggedSecsByTask(employeeId),
      ]);
      const blocked = new Set(blockedDates.map((b) => b.date));
      const byId = new Map(tasks.map((t) => [t.id, t as never]));

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
            };
          }) as never,
        anchorMs: Date.now(),
        addWorkingSecs: (anchorMs: number, secs: number) =>
          addWorkingSecs(anchorMs, secs, policy.schedule, blocked, policy.breaks),
      });
      for (const c of chained) {
        if (c.dueDate) dueDates.set(String(c.taskId), c.dueDate);
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
  async #activeQueueOf(employeeId: string): Promise<{
    order: string[];
    dueDates: Map<string, string>;
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
    }));

    /* The same ordering the screen derives, so a reorder starts from what the
       manager was looking at rather than from raw stored numbers that may
       contain gaps or duplicates. */
    const positions = activeQueuePositions(entries);
    const order = [...positions.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);

    const dueDates = await this.#chainQueue(employeeId, order, tasks);

    return { order, dueDates };
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
  ): Promise<void> {
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

      const queue = queueFor({
        tasks: peers.docs.map((d) => ({
          taskId: d.id,
          ...(d.data() as Record<string, unknown>),
        })),
        employeeId,
        parentTaskId,
      });
      if (queue.length === 0) return;

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
      for (const { taskId, dueDate } of moved) {
        await updateDoc(doc(db, "cowork_tasks", taskId), {
          dueDate,
          updatedAt: new Date(),
        });
      }
    } catch (error) {
      /* Legacy's own `console.error("[drag-priority-conflict]", …)`, and its own
         decision to swallow. The RANK has already been written and is what the
         person asked for; failing the whole change because the re-scheduling
         failed would send them to do it again, and the next Play recomputes the
         date anyway. */
      console.error("[priority-deadline] queue recalculation failed:", error);
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
       of the two — the whole queue has just been renumbered. */
    await this.#recalculateQueueDeadlines(id, await this.#parentOf(String(orderedTaskIds[0])));

    notifyRepositoryChanged();
    return { ok: true, data: null };
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
  async getWorkloadFlow() { return null; }
  async getCurrentEmployee(): Promise<Employee | null> {
    const map = await this.#employeesById();
    return map.get(String(this.#ctx.employeeId)) ?? null;
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
   * A session is **running** when it carries a start stamp — legacy has no
   * explicit flag. Whichever started most recently wins if several are open.
   */
  async getActiveTimer() {
    const employeeId = String(this.#ctx.employeeId);
    const { collection, getDocs } = await import("firebase/firestore");
    const { legacyDb } = await import("../../legacy/firebase.ts");

    let running: { taskId: string; startedAtMs: number; totalSecs: number } | null = null;
    try {
      const snap = await getDocs(
        collection(legacyDb(), "cowork_task_timers", employeeId, "sessions"),
      );
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const startedAtMs = readInstant(data.startedAt);
        if (startedAtMs === null) return;
        const total =
          firstNumber(data, "totalSecs", "totalSeconds") ?? 0;
        if (!running || startedAtMs > running.startedAtMs) {
          running = { taskId: d.id, startedAtMs, totalSecs: total };
        }
      });
    } catch {
      /* An unreadable timer must not blank the card that shows it. */
      return null;
    }
    if (!running) return null;
    const session = running as { taskId: string; startedAtMs: number; totalSecs: number };

    /* The title comes from the task list the repository already holds, so this
       costs no extra request. Unknown rather than invented if absent. */
    const tasks = await this.listTasks({ scope: "all" }).catch(() => null);
    const match = tasks?.items.find((v) => v.task.id === session.taskId);

    return {
      organisationId: LEGACY_ORGANISATION_ID,
      taskId: session.taskId,
      employeeId,
      isActive: true,
      accumulatedSecs: session.totalSecs,
      startedAt: new Date(session.startedAtMs).toISOString(),
      startedAtRealMs: session.startedAtMs,
      taskTitle: match?.task.title ?? "",
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
    if (role === "ceo" || role === "tl") {
      queries.push(query(ref, where("assignedBy", "==", viewerId), orderBy("updatedAt", "desc"), limit(100)));
      queries.push(query(ref, where("assigneeIds", "array-contains", viewerId), orderBy("updatedAt", "desc"), limit(100)));
    } else {
      queries.push(query(ref, where("assigneeIds", "array-contains", viewerId), orderBy("updatedAt", "desc"), limit(100)));
    }
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
          id: `${year.year}-${e.sopId ?? e.policyId ?? i}`,
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
        })),
    );
    return entries;
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
  async listPendingAcknowledgements() { return []; }

  /**
   * Music, and the demo controls.
   *
   * New-product features with no legacy counterpart — the old app has no music
   * player and no demo bar. Both are mounted in the shell (`MusicProvider` in
   * `AppShell`, `DemoBar` in `ShellFrame`) and call the repository directly
   * rather than through `useQuery`, so a throw from any of them is a blank
   * application rather than a missing widget.
   *
   * Empty and inert, which is what "this build has no music library" honestly
   * looks like.
   */
  async listMusicFavourites() { return []; }
  async listMusicPlayed() { return []; }
  async listMusicSearches() { return []; }
  async recordMusicSearch() { return undefined; }
  async clearMusicSearches() { return undefined; }
  async toggleMusicFavourite() { return undefined; }
  async saveMusicQueue() { return undefined; }
  async saveMusicPreferences() { return undefined; }
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
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    const transport = transportForParties([...input.to, ...cc]);

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
