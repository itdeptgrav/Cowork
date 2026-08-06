/**
 * In-memory mutable store for the prototype.
 *
 * Deliberately a plain module singleton with a `reset()` — this is the
 * temporary state layer the brief asks for, and the whole point is that it can
 * be deleted wholesale when the production repository lands.
 *
 * Nothing outside `lib/repositories/mock/` may import this. UI code talks to
 * the `CoworkRepository` interface only.
 */

import type {
  TaskMeetingSession,
  CoworkDocument,
  CoworkDocumentBody,
  MindMapRecord,
  MindNode,
  Approval,
  Attachment,
  AttendanceDay,
  ConductEvent,
  ConductPolicy,
  Conversation,
  DailyReport,
  DeadlineCounter,
  DeadlineChangeRequest,
  BreakSession,
  OfficeHoursVersion,
  EmergencyRequest,
  OrganisationSettings,
  DeadlineExtension,
  DeadlineProposal,
  Employee,
  Goal,
  GoalActivity,
  Group,
  MailAttachment,
  MailMessage,
  MailThread,
  Meeting,
  MeetingEvent,
  MeetingParticipant,
  Message,
  Notification,
  PriorityAcknowledgement,
  PriorityCascade,
  PriorityChange,
  Project,
  ProjectActivity,
  ProjectMember,
  ProjectMilestone,
  ProjectTaskLink,
  Rejection,
  ApprovalWorkflow,
  Department,
  ReportingRelationship,
  MrfRequest,
  MrfChatMessage,
  RawItemHit,
  ReworkRequest,
  Role,
  ScoreLedgerEntry,
  ScoreUnit,
  ScoringRule,
  ScoringRuleVersion,
  Task,
  TaskAssignment,
  TaskChatMessage,
  TaskEvent,
  TaskReview,
  TaskSubmission,
  TimerSession,
  WorkCommit,
} from "@/lib/domain";
import * as seed from "@/lib/seed/seed";
import type { SimulatedFailure } from "../types";
/* A value, not a type — the store's default has to exist at runtime. */
import { DEFAULT_MAX_BREAK_MINUTES_PER_DAY } from "../../domain/breaks.ts";
import * as persistence from "./persistence";

/**
 * WHO the repository is acting as, and WHICH ORGANISATION they are acting in.
 *
 * Both together, because they are one fact — a request is made by a person
 * inside a tenant, and an employee id without its organisation is what makes a
 * cross-tenant read possible. Held here rather than threaded through ninety
 * methods because this singleton stands in for a server that would read the
 * pair off a verified session.
 *
 * **This is not authentication and it is not authorisation.** It is the
 * request context those two produce. `SessionProvider` sets it from
 * `/api/auth/session`; the development profile switcher may change the employee
 * within the same organisation. When the repository moves behind a real API,
 * this becomes the server's per-request context and the client holds nothing.
 *
 * The organisation is what a future Postgres deployment enforces as a row-level
 * security predicate. Until then it is enforced at the repository boundary —
 * see `#scoped()` — so the enforcement point moves rather than being invented.
 */
export interface ActingContext {
  employeeId: string;
  organisationId: string;
}

let acting: ActingContext | null = null;

export function actingId(): string {
  return acting?.employeeId ?? seed.CURRENT_EMPLOYEE_ID;
}

/**
 * The tenant every read is scoped to and every write is stamped with.
 *
 * Falls back to the seeded organisation so the fixtures remain a coherent
 * tenant of their own. A session that predates tenanting therefore reads the
 * demo data rather than reading everything — the safe direction to fail.
 */
export function actingOrganisationId(): string {
  return acting?.organisationId ?? seed.SEED_ORGANISATION_ID;
}

export function setActingContext(next: ActingContext | null): void {
  acting = next;
}

/**
 * Employee-only setter, kept for the development profile switcher.
 *
 * Switching who you are acting as must NOT silently move you to another
 * tenant — so it preserves the current organisation rather than clearing it.
 */
export function setActingId(id: string | null): void {
  if (id === null) {
    acting = null;
    return;
  }
  acting = { employeeId: id, organisationId: actingOrganisationId() };
}

import type { AuditEntry } from "@/lib/rules/settings/audit";
import type {
  DeadlineExtensionRecord,
  TimeBudgetExtensionRecord,
} from "@/lib/rules/tasks/extensionRecords";

export interface Store {
  employees: Employee[];
  roles: Role[];
  reporting: ReportingRelationship[];
  departments: Department[];
  workflows: ApprovalWorkflow[];
  mrfs: MrfRequest[];
  mrfChat: MrfChatMessage[];
  mrfCatalogue: RawItemHit[];

  tasks: Task[];
  /** One row per sitting in a task's room — see `TaskMeetingSession`. */
  taskMeetingSessions: TaskMeetingSession[];
  assignments: TaskAssignment[];
  approvals: Approval[];
  taskEvents: TaskEvent[];
  chat: TaskChatMessage[];

  proposals: DeadlineProposal[];
  counters: DeadlineCounter[];
  extensions: DeadlineExtension[];

  priorityChanges: PriorityChange[];
  cascades: PriorityCascade[];
  acknowledgements: PriorityAcknowledgement[];

  submissions: TaskSubmission[];
  reviews: TaskReview[];
  reworkRequests: ReworkRequest[];
  rejections: Rejection[];

  timers: TimerSession[];
  /* Hours requests, in their own list. Never folded into the deadline
     negotiation — see `extensionRecords.ts`. */
  timeBudgetExtensions: TimeBudgetExtensionRecord[];
  /* Dates, in their own list. Symmetric with the hours above — same reason. */
  deadlineExtensions: DeadlineExtensionRecord[];
  /** Settings changes, newest last. Written only by the settings service. */
  settingsAudit: AuditEntry[];
  workCommits: WorkCommit[];
  dailyReports: DailyReport[];
  attachments: Attachment[];

  projects: Project[];
  projectMembers: ProjectMember[];
  projectTaskLinks: ProjectTaskLink[];
  milestones: ProjectMilestone[];
  projectActivity: ProjectActivity[];

  goals: Goal[];
  goalActivities: GoalActivity[];
  conductEvents: ConductEvent[];
  conductPolicies: ConductPolicy[];
  attendance: AttendanceDay[];

  scoreUnits: ScoreUnit[];
  ledger: ScoreLedgerEntry[];
  deadlineChangeRequests: DeadlineChangeRequest[];
  emergencyRequests: EmergencyRequest[];
  breakSessions: BreakSession[];
  /** Append-only. The latest version per organisation is the live one. */
  officeHoursVersions: OfficeHoursVersion[];
  /** Organisation configuration. Legacy's `cowork_settings/office` document. */
  settings: OrganisationSettings;
  rules: (ScoringRule & { version: ScoringRuleVersion })[];
  /** Every version ever published, newest last. The audit trail. */
  ruleVersions: ScoringRuleVersion[];

  conversations: Conversation[];
  messages: Message[];
  groups: Group[];
  meetings: Meeting[];
  mailThreads: MailThread[];
  mailMessages: MailMessage[];
  mailAttachments: MailAttachment[];
  documents: CoworkDocument[];
  documentBodies: CoworkDocumentBody[];
  /**
   * Version-history checkpoints, newest-last (the repository sorts on read).
   * The mock has no Yjs room to snapshot, so a "version" here is simply the
   * body's `html`/`cells` at the moment it was saved — enough for the panel
   * and for a restore to visibly do something, without pretending to model
   * CRDT state that does not exist in this store.
   */
  documentVersions: {
    documentId: string;
    id: string;
    createdAt: string;
    authorId: string | null;
    authorName: string;
    label: string | null;
    html: string;
    cells: string | null;
  }[];
  mindmaps: MindMapRecord[];
  /** Cards, keyed by map id — the record/body split the real store uses. */
  mindmapNodes: { mindmapId: string; nodes: MindNode[]; updatedAt: string }[];
  meetingParticipants: MeetingParticipant[];
  meetingEvents: MeetingEvent[];
  notifications: Notification[];

  /** Monotonic id counter — deterministic, never `Math.random()`. */
  seq: number;
  failure: SimulatedFailure;
  /** Set once on first mutation so relative times stay stable during SSR. */
  clockOffsetMs: number;
}

/**
 * Identifies the fixture, so a saved store written against a different
 * `lib/mock/seed.ts` is discarded rather than hiding the fixtures you just
 * added. Sizes rather than contents: cheap enough to compute at module init,
 * and it moves for every edit that adds, removes or re-shapes a collection.
 */
function seedFingerprint(): string {
  /* The SHAPE of a record, not just how many there are.
     Lengths alone were not enough, and it bit: adding `email` to every seeded
     employee changed no count, so the fingerprint matched and a store written
     before the field existed was restored over the new fixture — the People
     list showed employee codes where emails should have been, and nothing
     announced why. Sampling the key set of one record from each shape-bearing
     collection catches a field being added or removed, which is the edit that
     actually invalidates a saved store. */
  const shapeOf = (row: object | undefined) =>
    row ? Object.keys(row).sort().join(",") : "";

  return [
    shapeOf(seed.employees[0]),
    shapeOf(seed.tasks[0]),
    shapeOf(seed.roles[0]),
    seed.employees.length,
    seed.roles.length,
    seed.reporting.length,
    seed.departments.length,
    seed.workflows.length,
    seed.tasks.length,
    seed.assignments.length,
    seed.approvals.length,
    seed.taskEvents.length,
    seed.projects.length,
    seed.goals.length,
    seed.notifications.length,
    seed.CURRENT_EMPLOYEE_ID,
  ].join(".");
}

/**
 * The store is restored from `localStorage` in development and built from the
 * seed everywhere else — see `lib/config/mockPersistence.ts`.
 *
 * Restoring at module init rather than in an effect matters for correctness:
 * the first query must already see the continued session, or a component would
 * render seeded data and then swap it, which is the flicker that makes people
 * distrust what they are looking at. It is safe to do synchronously because on
 * the server `load` short-circuits to `fresh` — server render and client
 * hydration both begin from the seed, and every query is asynchronous, so the
 * first paint is the same loading state on both sides either way.
 */
let store: Store = restore();

function restore(): Store {
  const fingerprint = seedFingerprint();
  persistence.setSeedFingerprint(fingerprint);
  return persistence.load(build(), fingerprint);
}

function build(): Store {
  const attendance = seed.employees.flatMap((e) =>
    seed.buildAttendance(e.id, 90),
  );

  return {
    employees: clone(seed.employees),
    roles: clone(seed.roles),
    reporting: clone(seed.reporting),
    departments: clone(seed.departments),
    workflows: clone(seed.workflows),
    mrfs: clone(seed.mrfRequests),
    mrfChat: clone(seed.mrfChat),
    mrfCatalogue: clone(seed.mrfCatalogue),

    tasks: clone(seed.tasks),
    taskMeetingSessions: [],
    assignments: clone(seed.assignments),
    approvals: clone(seed.approvals),
    taskEvents: clone(seed.taskEvents),
    chat: clone(seed.chatMessages),

    proposals: clone(seed.proposals),
    counters: [],
    extensions: [],

    priorityChanges: [],
    cascades: [],
    acknowledgements: [],

    submissions: clone(seed.submissions),
    reviews: clone(seed.reviews) as TaskReview[],
    reworkRequests: clone(seed.reworkRequests) as ReworkRequest[],
    rejections: [],

    timers: [],
    timeBudgetExtensions: [],
    deadlineExtensions: [],
    settingsAudit: [],
    workCommits: clone(seed.workCommits),
    dailyReports: [],
    attachments: clone(seed.attachments) as Attachment[],

    projects: clone(seed.projects),
    projectMembers: clone(seed.projectMembers),
    projectTaskLinks: clone(seed.projectTaskLinks),
    milestones: clone(seed.milestones),
    projectActivity: clone(seed.projectActivity),

    goals: clone(seed.goals),
    goalActivities: clone(seed.goalActivities),
    conductEvents: clone(seed.conductEvents),
    conductPolicies: clone(seed.conductPolicies),
    attendance,

    scoreUnits: [],
    ledger: [],
    deadlineChangeRequests: [],
    /* Never seeded: an emergency is something that happens, not a fixture. */
    emergencyRequests: [],
    breakSessions: [],
    officeHoursVersions: [],
    settings: { maxBreakMinutesPerDay: DEFAULT_MAX_BREAK_MINUTES_PER_DAY },
    rules: buildRules(),
    ruleVersions: buildRules().map((r) => r.version),

    conversations: clone(seed.conversations),
    messages: clone(seed.messages),
    groups: clone(seed.groups),
    meetings: clone(seed.meetings),
    mailThreads: [],
    mailMessages: [],
    mailAttachments: [],
    documents: [],
    documentBodies: [],
    documentVersions: [],
    mindmaps: [],
    mindmapNodes: [],
    meetingParticipants: [],
    meetingEvents: [],
    notifications: clone(seed.notifications),

    seq: 1000,
    failure: "none",
    clockOffsetMs: 0,
  };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function buildRules(): (ScoringRule & { version: ScoringRuleVersion })[] {
  const mk = (
    id: string,
    key: string,
    component: "c1" | "c2" | "c3" | "c4",
    displayName: string,
    description: string,
    /**
     * Keyed by ENGINE KEY, not by a local label.
     *
     * These were `{ deduction: 0.2 }` — a display value that named nothing the
     * scoring engine reads, which is why editing a rule card could never have
     * changed a score. Each parameter is now the exact key
     * `lib/config/settings.ts` resolves, so publishing a version and the engine
     * computing with it are the same fact.
     */
    parameters: Record<string, number>,
    isProvisional: boolean,
    provisionalNote: string | null,
  ) => ({
    id,
    key,
    component,
    displayName,
    description,
    isActive: true,
    archivedAt: null,
    appliesTo: { departmentIds: [], roleIds: [] },
    engineKeys: Object.keys(parameters),
    currentVersionId: `${id}-v1`,
    version: {
      id: `${id}-v1`,
      ruleId: id,
      version: isProvisional ? "0.1.0-provisional" : "1.0.0",
      parameters,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      createdById: "system" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      supersedesVersionId: null,
      isProvisional,
      provisionalNote,
    },
  });

  return [
    mk(
      "rule-c1-rework",
      "c1.rework",
      "c1",
      "Rework deduction",
      "Each rework deducts a fixed amount from the task's earned points.",
      { reworkDeduction: 0.2 },
      false,
      null,
    ),
    mk(
      "rule-c1-deadline",
      "c1.deadline_missed",
      "c1",
      "Missed-deadline deduction",
      "Applied when submission is later than the official scored deadline.",
      { deadlineMissDeduction: 0.2 },
      true,
      "Legacy held two conflicting values (0.5 and 0.2). Neither is approved — O6.",
    ),
    mk(
      "rule-c1-extension",
      "c1.extension_charged",
      "c1",
      "Charged-extension deduction",
      "Applied when a manager declines to waive the penalty on an extension.",
      { extensionDeduction: 0.2 },
      true,
      "Legacy configured 0.2 but multiplied it by zero, so it never applied — O6.",
    ),
    mk(
      "rule-c1-rejection",
      "c1.rejection",
      "c1",
      "Rejection deduction",
      "Applied when a submission is rejected rather than sent back for rework.",
      { rejectionDeduction: 0.4 },
      true,
      "Legacy zeroed the whole unit. The owner explicitly withheld approval — O4.",
    ),
    mk(
      "rule-c2-activity",
      "c2.activity",
      "c2",
      "Goal activity attainment",
      "A component earns its points when completed and not late.",
      { goalLateDeduction: 1 },
      true,
      "Partial credit is undecided — O8.",
    ),
    mk(
      "rule-c3-conduct",
      "c3.conduct",
      "c3",
      "Conduct deduction by severity",
      "Deduction scales with the recorded severity.",
      {
        conductMinor: 0.2,
        conductModerate: 0.5,
        conductSerious: 1,
        conductFalsification: 2,
        conductIdlePool: 0.3,
      },
      true,
      "The authoritative table (PDF §3.4) is in neither repository — O7.",
    ),
    mk(
      "rule-c4-attendance",
      "c4.attendance",
      "c4",
      "Attendance day",
      "Each expected working day is one unit; lateness deducts proportionally.",
      {
        latenessRatePerMinute: 0.01,
        latenessGracePeriodMins: 10,
        absenceDeduction: 1,
        halfDayDeduction: 0.5,
        earlyDepartureRatePerMinute: 0.01,
        overtimeCreditRate: 0.01,
        overtimeGraceMins: 15,
      },
      true,
      "Proportional lateness is confirmed; every rate, threshold and the overtime offset is not — O5.",
    ),
  ];
}

export function getStore(): Store {
  return store;
}

/**
 * Back to the seed, and stay there.
 *
 * Clearing the saved copy is the part that makes "Reset data" mean what it
 * says: without it a reset would be undone by the next reload, and the control
 * that is meant to be the way out of a confusing fixture would be the thing
 * that preserved it.
 */
export function resetStore(): void {
  persistence.clear();
  store = build();
}

/**
 * Save the store. Called after every successful mutation; a no-op in production
 * and on the server.
 *
 * Writes are coalesced into one per microtask, so a mutation that touches six
 * collections serialises once.
 */
export function persistStore(): void {
  persistence.scheduleSave(() => store);
}

export function nextId(prefix: string): string {
  store.seq += 1;
  return `${prefix}-${store.seq}`;
}

/**
 * The prototype clock. Anchored to the seed's `NOW` plus however much time the
 * session has advanced, so freshly created records sort after seeded ones
 * without depending on the real wall clock during server render.
 */
export function now(): Date {
  return new Date(seed.NOW.getTime() + store.clockOffsetMs);
}

export function nowIso(): string {
  return now().toISOString();
}

/** Advances the prototype clock so successive mutations have distinct times. */
export function tick(ms = 1000): void {
  store.clockOffsetMs += ms;
}

/** `1.2.0` → `1.3.0`. Publishing a value is a minor change, never a patch. */
export function bumpVersion(current: string): string {
  const clean = current.replace(/-provisional$/, "");
  const [maj, min] = clean.split(".").map((n) => Number(n) || 0);
  return `${maj}.${min + 1}.0`;
}
