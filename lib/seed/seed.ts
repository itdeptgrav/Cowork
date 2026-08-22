/**
 * SYNTHETIC SEED DATA — every person, project, task, goal and figure below is
 * invented. docs/architecture/PRODUCT.md records that no real team, organisational or performance
 * data exists, and that none may be fabricated as genuine. Nothing here is a
 * benchmark.
 *
 * Deterministic by construction: a fixed `NOW` anchor and no `Date.now()` at
 * module scope, so server and client render identically and hydration never
 * mismatches.
 */

import type {
  CompletionRequirement,
  Approval,
  ApprovalStage,
  ApprovalWorkflow,
  AttendanceDay,
  Department,
  ConductEvent,
  ConductPolicy,
  Conversation,
  DeadlineProposal,
  Employee,
  Goal,
  GoalActivity,
  Group,
  Meeting,
  Message,
  Notification,
  Project,
  ProjectActivity,
  ProjectMember,
  ProjectMilestone,
  ProjectTaskLink,
  ReportingRelationship,
  MrfRequest,
  MrfChatMessage,
  RawItemHit,
  Role,
  Task,
  TaskAssignment,
  TaskChatMessage,
  TaskEvent,
  TaskSubmission,
  WorkCommit,
} from "@/lib/domain";
import { systemRoles } from "../auth/systemRoles.ts";

/**
 * The organisation the fixtures belong to.
 *
 * The seed is one tenant, not a global pool. Giving it an explicit id is what
 * lets tenant scoping be exercised against the demo data instead of being
 * switched off for it — and it is the value an untenanted legacy session falls
 * back to, so such a session sees the demo organisation rather than everything.
 */
export const SEED_ORGANISATION_ID = "org-seed";

/**
 * Stamp a fixture array with the seed tenant.
 *
 * The literals below omit `organisationId` deliberately — every one of them
 * belongs to the same organisation, and repeating the key on several hundred
 * objects would bury the data that actually differs. Typing the input as
 * `Omit<T, "organisationId">` keeps the compiler checking every OTHER field,
 * so this widens exactly one property and hides nothing.
 */
function tenant<T extends { organisationId: string }>(
  rows: Omit<T, "organisationId">[],
): T[] {
  return rows.map(
    (r) => ({ ...r, organisationId: SEED_ORGANISATION_ID }) as T,
  );
}

/** Fixed clock. Every relative date in the seed derives from this. */
export const NOW = new Date("2026-07-25T10:00:00.000Z");

export function iso(offsetHours: number): string {
  return new Date(NOW.getTime() + offsetHours * 3600_000).toISOString();
}
export function day(offsetDays: number): string {
  return new Date(NOW.getTime() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const HOUR = 3600;

/* ── Roles ────────────────────────────────────────────────────────────────── */

/**
 * The five system roles, for the seed tenant.
 *
 * The table itself is **not** fixture data and no longer lives here: `can()`
 * reads it against the real backend too, and two copies of a permission matrix
 * is two answers to "may I approve this". `lib/auth/systemRoles.ts` is the one
 * copy; this stamps it with the seed's tenant.
 */
export const roles: Role[] = systemRoles(SEED_ORGANISATION_ID);

/* ── People ───────────────────────────────────────────────────────────────── */

function emp(
  id: string,
  code: string,
  first: string,
  last: string,
  hue: 0 | 1 | 2 | 3 | 4 | 5,
  dept: string,
  designation: string,
  roleIds: string[],
): Employee {
  return {
  organisationId: SEED_ORGANISATION_ID,
    id,
    /* The seed's organisation root: nobody manages e-09, and `reporting` has no
       row for them. Marking it makes that intentional rather than a gap the
       reconciliation panel would report. */
    isFounder: id === "e-09",
    userId: `u-${id}`,
    employeeCode: code,
    firstName: first,
    lastName: last,
    displayName: `${first} ${last}`,
    /* A fictional domain, per docs/architecture/PRODUCT.md: fixtures must be self-evidently
       placeholder and must never look like a real person's address. */
    email: `${first.toLowerCase()}.${last.toLowerCase()}@cowork.example`,
    initials: `${first[0]}${last[0]}`,
    hue,
    /* The seed ships no faces. Inventing one for an invented person would
       present synthetic material as genuine — the same reason `Avatar` draws a
       monogram. A real upload in the demo still works and still shows. */
    profilePictureUrl: null,
    departmentId: dept.toLowerCase(),
    departmentName: dept,
    designation,
    roleIds,
    timezone: "Asia/Kolkata",
    workCalendarId: "cal-standard",
    joinedAt: "2024-03-01T00:00:00.000Z",
    exitedAt: null,
  };
}



export const CURRENT_EMPLOYEE_ID = "e-01";

export const employees: Employee[] = [
  emp(
    "e-01",
    "CW-1001",
    "Maya",
    "Ferreira",
    2,
    "Product",
    "Senior Product Designer",
    ["role-employee", "role-manager"],
  ),
  emp("e-02", "CW-1002", "Tobias", "Lund", 4, "Product", "Product Designer", [
    "role-employee",
  ]),
  emp("e-03", "CW-1003", "Renata", "Alves", 1, "Platform", "Engineering Lead", [
    "role-employee",
    "role-manager",
  ]),
  emp("e-04", "CW-1004", "Idris", "Cheng", 5, "Platform", "Data Analyst", [
    "role-employee",
  ]),
  emp(
    "e-05",
    "CW-1005",
    "Hanne",
    "Vermeer",
    3,
    "Operations",
    "Programme Manager",
    ["role-employee", "role-manager"],
  ),
  emp("e-06", "CW-1006", "Jonas", "Weber", 0, "Product", "Content Designer", [
    "role-employee",
  ]),
  emp(
    "e-07",
    "CW-1007",
    "Priya",
    "Raman",
    1,
    "Operations",
    "Director of Delivery",
    ["role-employee", "role-skip"],
  ),
  emp(
    "e-08",
    "CW-1008",
    "Adaeze",
    "Okonkwo",
    3,
    "People",
    "People Operations Lead",
    ["role-employee", "role-people-ops"],
  ),
  /* The system administrator. Nobody held this role before, which meant
     `people.change_role` was granted to no one and the role editor would have
     been permanently locked — the exact "you can configure everything except
     who configures it" failure the administrative floor exists to prevent. */
  emp("e-09", "CW-1009", "Rishee", "Ray", 4, "Platform", "Owner", [
    "role-employee",
    "role-admin",
  ]),
];

export const reporting: ReportingRelationship[] = [
  rel("r1", "e-02", "e-01"),
  rel("r2", "e-06", "e-01"),
  rel("r3", "e-04", "e-03"),
  rel("r4", "e-01", "e-07"),
  rel("r5", "e-03", "e-07"),
  rel("r6", "e-05", "e-07"),
  rel("r7", "e-07", "e-09"),
];

/* ── Material Request Forms ───────────────────────────────────────────────────
   A couple awaiting Maya (e-01, a manager) so the Approvals tab has content, and
   a couple of Maya's own so My Requests does too. */
export const mrfRequests: MrfRequest[] = tenant<MrfRequest>([
  {
    id: "m-01",
    mrfNumber: "MRF-2608-0001",
    requesterId: "e-02",
    requesterName: "Tobias Lund",
    requesterDepartment: "Product",
    requestType: "uses_based",
    priority: "normal",
    reason: "Foam board and adhesive for the activation prototype.",
    neededBy: iso(72),
    deadline: null,
    status: "pending",
    approverId: "e-01",
    approverName: "Maya Ferreira",
    autoForwarded: false,
    rejectionNote: null,
    items: [
      { id: "mi-01", name: "Foam board A1", sku: "FB-A1", isUnmatched: false, requestedQty: 10, unit: "sheet", description: "5mm", status: "pending" },
      { id: "mi-02", name: "Spray adhesive", sku: null, isUnmatched: true, requestedQty: 2, unit: "can", description: null, status: "pending" },
    ],
    history: [{ at: iso(-6), action: "created", actorName: "Tobias Lund", detail: null }],
    createdAt: iso(-6),
    updatedAt: iso(-6),
  },
  {
    id: "m-02",
    mrfNumber: "MRF-2608-0002",
    requesterId: "e-06",
    requesterName: "Jonas Weber",
    requesterDepartment: "Product",
    requestType: "time_based",
    priority: "urgent",
    reason: "Camera kit for the launch shoot.",
    neededBy: iso(24),
    deadline: iso(96),
    status: "pending",
    approverId: "e-01",
    approverName: "Maya Ferreira",
    autoForwarded: false,
    rejectionNote: null,
    items: [
      { id: "mi-03", name: "DSLR body", sku: "CAM-01", isUnmatched: false, requestedQty: 1, unit: "unit", description: "with 50mm lens", status: "pending" },
    ],
    history: [{ at: iso(-3), action: "created", actorName: "Jonas Weber", detail: null }],
    createdAt: iso(-3),
    updatedAt: iso(-3),
  },
  {
    id: "m-03",
    mrfNumber: "MRF-2608-0003",
    requesterId: "e-01",
    requesterName: "Maya Ferreira",
    requesterDepartment: "Product",
    requestType: "uses_based",
    priority: "normal",
    reason: "Printer toner for the studio.",
    neededBy: iso(48),
    deadline: null,
    status: "approved",
    approverId: "e-07",
    approverName: "Priya Raman",
    autoForwarded: false,
    rejectionNote: null,
    items: [
      { id: "mi-04", name: "Toner cartridge", sku: "TN-55", isUnmatched: false, requestedQty: 3, unit: "unit", description: null, status: "partially_issued", issuedQty: 1, returnedQty: 0, availability: "available", availableQty: 3, availabilityNote: null },
    ],
    history: [
      { at: iso(-30), action: "created", actorName: "Maya Ferreira", detail: null },
      { at: iso(-28), action: "approved", actorName: "Priya Raman", detail: null },
    ],
    createdAt: iso(-30),
    updatedAt: iso(-28),
  },
]);

export const mrfChat: MrfChatMessage[] = [
  {
    id: "mc-01",
    mrfId: "m-01",
    senderId: "e-02",
    senderName: "Tobias Lund",
    senderRole: "employee",
    body: "Any update on the foam board?",
    isSystem: false,
    createdAt: iso(-5),
  },
  {
    id: "mc-02",
    mrfId: "m-01",
    senderId: null,
    senderName: "Store",
    senderRole: "store",
    body: "Checking stock now — back shortly.",
    isSystem: false,
    createdAt: iso(-4),
  },
];

/* A small store catalogue for the request form's search — one item with colour
   variants and their stock, plus a couple of plain items. */
export const mrfCatalogue: RawItemHit[] = [
  {
    id: "raw-01",
    name: "Suiting fabric 63/37 PC plain",
    sku: "SUIT-6337",
    baseUnit: "mtr",
    quantity: 9848,
    units: ["mtr", "roll"],
    variants: [
      { id: "v-01", combination: ["Black"], quantity: 5169.8, sku: "SUIT-BLK" },
      { id: "v-02", combination: ["Blue"], quantity: 169.8, sku: "SUIT-BLU" },
      { id: "v-03", combination: ["Navy"], quantity: 4508.4, sku: "SUIT-NVY" },
    ],
  },
  {
    id: "raw-02",
    name: "Spray adhesive",
    sku: "ADH-01",
    baseUnit: "can",
    quantity: 40,
    units: ["can"],
    variants: [],
  },
  {
    id: "raw-03",
    name: "Foam board A1 5mm",
    sku: "FB-A1",
    baseUnit: "sheet",
    quantity: 120,
    units: ["sheet"],
    variants: [],
  },
];

/* ── Departments ──────────────────────────────────────────────────────────────
   Records, not the free-text string legacy carried on each employee. Each names
   its head, so an approval stage can route to "the HOD" deterministically
   instead of legacy's unordered `where(role == "tl").limit(1)` coin flip. */

export const departments: Department[] = tenant<Department>([
  {
    id: "product",
    name: "Product",
    hodEmployeeId: "e-01",
    parentDepartmentId: null,
    isActive: true,
  },
  {
    id: "platform",
    name: "Platform",
    hodEmployeeId: "e-03",
    parentDepartmentId: null,
    isActive: true,
  },
  {
    id: "operations",
    name: "Operations",
    hodEmployeeId: "e-05",
    parentDepartmentId: null,
    isActive: true,
  },
  {
    /* Deliberately headless. A department with no HOD is a real state, and the
       workflow has to say so rather than quietly dropping the stage. */
    id: "people",
    name: "People",
    hodEmployeeId: null,
    parentDepartmentId: null,
    isActive: true,
  },
]);

/* ── Approval workflows ───────────────────────────────────────────────────────
   The default completion flow is the four-stage chain the owner described:
   Employee → Supervisor → HOD → Manager. Every stage resolves its approver by
   rule, so a re-org changes who approves without anyone editing a workflow. */

export const workflows: ApprovalWorkflow[] = tenant<ApprovalWorkflow>([
  {
    id: "wf-completion",
    name: "Standard completion review",
    description:
      "Work is reviewed by the assignee's own manager, then their department head, then one level above.",
    trigger: "task_completion",
    order: 10,
    isActive: true,
    isSystem: true,
    appliesTo: { departmentIds: [], crossDepartmentOnly: false },
    stages: [
      stage("st-1", "Supervisor", 1, "reporting_manager", { levelsUp: 1 }),
      stage("st-2", "Head of department", 2, "department_hod", {
        onUnresolved: "skip",
      }),
      stage("st-3", "Manager", 3, "reporting_manager", {
        levelsUp: 2,
        onUnresolved: "skip",
        allowOverride: true,
      }),
    ],
  },
  {
    id: "wf-cross-dept",
    name: "Cross-department assignment",
    description:
      "Work crossing a department boundary needs both heads to agree before it is assigned.",
    trigger: "cross_department",
    order: 5,
    isActive: true,
    isSystem: true,
    appliesTo: { departmentIds: [], crossDepartmentOnly: true },
    stages: [
      /* Both stages record CONSENT, not review, so a head of department who is
         themselves the resolved approver has already given it by asking. With
         the strict default, Maya — Product's head — could never assign outside
         Product: the sending stage resolved to her and blocked. Legacy skipped
         the gate in exactly this case. */
      /* Managers, not department heads.
         The authority to send work out of a team and the authority to accept
         work into one belong to the people accountable for those teams — the
         reporting managers. Routing to the department HEAD put the assignee in
         their own approval chain whenever they happened to head the receiving
         department: Hanne assigning to Maya asked Maya, who heads Product, to
         approve work being sent to Maya. Being sent work is not authority over
         being sent it. */
      stage("st-4", "Sender's manager", 1, "reporting_manager", {
        levelsUp: 1,
        onUnresolved: "block",
        onSelfApproval: "satisfied",
      }),
      stage("st-5", "Receiver's manager", 2, "target_reporting_manager", {
        onUnresolved: "block",
        onSelfApproval: "satisfied",
      }),
    ],
  },
  {
    id: "wf-self-assign",
    name: "Self-assignment approval",
    description:
      "Work someone assigns to themselves is confirmed by their manager, so C1 credit is never self-awarded.",
    trigger: "self_assignment",
    order: 10,
    isActive: true,
    isSystem: true,
    appliesTo: { departmentIds: [], crossDepartmentOnly: false },
    stages: [
      stage("st-6", "Manager", 1, "reporting_manager", {
        levelsUp: 1,
        onUnresolved: "block",
      }),
    ],
  },
  {
    id: "wf-extension",
    name: "Deadline extension",
    description: "An extension is decided by the assignee's manager.",
    trigger: "deadline_extension",
    order: 10,
    isActive: true,
    isSystem: true,
    appliesTo: { departmentIds: [], crossDepartmentOnly: false },
    stages: [
      stage("st-7", "Manager", 1, "reporting_manager", {
        levelsUp: 1,
        onUnresolved: "block",
      }),
    ],
  },
]);

function stage(
  id: string,
  name: string,
  order: number,
  rule: ApprovalStage["rule"],
  opts: {
    levelsUp?: number;
    roleId?: string;
    employeeId?: string;
    onUnresolved?: ApprovalStage["onUnresolved"];
    onSelfApproval?: ApprovalStage["onSelfApproval"];
    allowOverride?: boolean;
  } = {},
): ApprovalStage {
  return {
    id,
    name,
    order,
    rule,
    levelsUp: opts.levelsUp ?? null,
    roleId: opts.roleId ?? null,
    employeeId: opts.employeeId ?? null,
    onUnresolved: opts.onUnresolved ?? "block",
    onSelfApproval: opts.onSelfApproval ?? "block",
    allowOverride: opts.allowOverride ?? false,
  };
}

function rel(
  id: string,
  employeeId: string,
  managerId: string,
): ReportingRelationship {
  return {
  organisationId: SEED_ORGANISATION_ID,
    id,
    employeeId,
    managerId,
    type: "primary",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    createdBy: "e-08",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

/* ── Projects ─────────────────────────────────────────────────────────────── */

export const projects: Project[] = tenant<Project>([
  {
    id: "pr-01",
    reference: "PRJ-101",
    name: "Workspace shell",
    description:
      "The frosted deck, navigation and ambient score surface that every other route sits inside.",
    ownerId: "e-01",
    status: "active",
    startDate: day(-40),
    targetDate: day(18),
    completedAt: null,
    tags: ["platform", "design-system"],
    priority: "high",
    isRestricted: false,
    createdById: "e-01",
    createdAt: iso(-960),
    updatedAt: iso(-6),
    archivedAt: null,
  },
  {
    id: "pr-02",
    reference: "PRJ-102",
    name: "Performance surfaces",
    description:
      "Score overview, component drill-in and the immutable ledger view.",
    ownerId: "e-03",
    status: "active",
    startDate: day(-28),
    targetDate: day(9),
    completedAt: null,
    tags: ["scoring"],
    priority: "high",
    isRestricted: false,
    createdById: "e-03",
    createdAt: iso(-672),
    updatedAt: iso(-30),
    archivedAt: null,
  },
  {
    id: "pr-03",
    reference: "PRJ-103",
    name: "Attendance ingest",
    description: "Provider adapter, work calendar and the C4 day model.",
    ownerId: "e-05",
    status: "on_hold",
    startDate: day(-20),
    targetDate: day(30),
    completedAt: null,
    tags: ["integration"],
    priority: "normal",
    isRestricted: false,
    createdById: "e-05",
    createdAt: iso(-480),
    updatedAt: iso(-72),
    archivedAt: null,
  },
  {
    id: "pr-04",
    reference: "PRJ-104",
    name: "Compensation review",
    description: "Restricted — visible to members and People Operations only.",
    ownerId: "e-08",
    status: "planning",
    startDate: day(-5),
    targetDate: day(45),
    completedAt: null,
    tags: ["people"],
    priority: "normal",
    isRestricted: true,
    createdById: "e-08",
    createdAt: iso(-120),
    updatedAt: iso(-120),
    archivedAt: null,
  },
  {
    id: "pr-05",
    reference: "PRJ-098",
    name: "Onboarding revamp",
    description: "Shipped last quarter.",
    ownerId: "e-01",
    status: "completed",
    startDate: day(-120),
    targetDate: day(-30),
    completedAt: iso(-700),
    tags: ["growth"],
    priority: "normal",
    isRestricted: false,
    createdById: "e-01",
    createdAt: iso(-2880),
    updatedAt: iso(-700),
    archivedAt: null,
  },
  {
    id: "pr-06",
    reference: "PRJ-090",
    name: "Legacy audit",
    description: "Archived after handover.",
    ownerId: "e-07",
    status: "archived",
    startDate: day(-180),
    targetDate: day(-90),
    completedAt: iso(-2200),
    tags: [],
    priority: "low",
    isRestricted: false,
    createdById: "e-07",
    createdAt: iso(-4320),
    updatedAt: iso(-2200),
    archivedAt: iso(-2160),
  },
]);

export const projectMembers: ProjectMember[] = [
  pm("pm-01", "pr-01", "e-01", "owner"),
  pm("pm-02", "pr-01", "e-02", "member"),
  pm("pm-03", "pr-01", "e-06", "member"),
  pm("pm-04", "pr-02", "e-03", "owner"),
  pm("pm-05", "pr-02", "e-04", "member"),
  pm("pm-06", "pr-02", "e-01", "lead"),
  pm("pm-07", "pr-03", "e-05", "owner"),
  pm("pm-08", "pr-03", "e-04", "member"),
  pm("pm-09", "pr-04", "e-08", "owner"),
  pm("pm-10", "pr-05", "e-01", "owner"),
  pm("pm-11", "pr-06", "e-07", "owner"),
];

function pm(
  id: string,
  projectId: string,
  employeeId: string,
  role: ProjectMember["role"],
): ProjectMember {
  return {
    id,
    projectId,
    employeeId,
    role,
    addedAt: iso(-600),
    addedById: "e-01",
  };
}

export const milestones: ProjectMilestone[] = [
  {
    id: "ms-01",
    projectId: "pr-01",
    title: "Deck and navigation complete",
    targetDate: day(-6),
    completedAt: iso(-150),
    taskIds: ["t-06"],
    order: 1,
  },
  {
    id: "ms-02",
    projectId: "pr-01",
    title: "Task surfaces interactive",
    targetDate: day(12),
    completedAt: null,
    taskIds: ["t-01", "t-02"],
    order: 2,
  },
  {
    id: "ms-03",
    projectId: "pr-02",
    title: "Ledger view shipped",
    targetDate: day(7),
    completedAt: null,
    taskIds: ["t-08"],
    order: 1,
  },
];

/* ── Tasks ────────────────────────────────────────────────────────────────── */

function baseTask(
  over: Partial<Task> & Pick<Task, "id" | "title" | "status">,
): Task {
  return {
  organisationId: SEED_ORGANISATION_ID,
    reference: `CW-${over.id.replace("t-", "")}`,
    type: "standard",
    description: null,
    requirements: [],
    satisfiesRequirementIds: [],
    createdById: "e-01",
    createdByRoleId: "role-manager",
    /* Required by `Task`, and absent here until a meeting settlement read it
       and threw. A seeded task has held no meetings; that is a real zero. */
    meetings: { firstStartedAt: null, lastEndedAt: null, totalSecs: 0 },
    isCrossDepartment: false,
    rootCreatorEmployeeId: "e-01",
    /* Derived from the creator, and overridable per task. Cross-department
       detection compares this against each assignee's department, so a null
       here would make every task look same-department. */
    departmentId:
      employees.find((e) => e.id === (over.createdById ?? "e-01"))
        ?.departmentId ?? null,
    parentTaskId: null,
    projectId: null,
    groupId: null,
    estimatedEffortSecs: 4 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: null,
      currentWindowSecs: null,
      dueAt: null,
      officialDueAt: null,
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "unset",
      assignorWindowRejection: null,
    },
    approvalReason: null,
    approverIds: [],
    /* Empty on every fixture: a seeded task is already in whatever state it
       claims, so nobody is being held back from it. */
    pendingAssigneeIds: [],
    isScoreEligible: true,
    recurrence: null,
    goalId: null,
    outputs: [],
    isBlocked: false,
    blockedReason: null,
    tags: [],
    createdAt: iso(-200),
    updatedAt: iso(-10),
    deletedAt: null,
    ...over,
  } as Task;
}

/**
 * Requirement text → records, so fixtures keep writing plain strings.
 *
 * Ids are deterministic (`req-<task>-<n>`) rather than random: a subtask has to
 * name the requirement it satisfies, and a fixture cannot reference an id that
 * was generated at load time.
 */
function reqs(taskId: string, texts: string[]): CompletionRequirement[] {
  return texts.map((text, order) => ({
    id: `req-${taskId}-${order + 1}`,
    text,
    order,
    satisfiedAt: null,
    satisfiedById: null,
  }));
}

export const tasks: Task[] = [
  /* Maya's P1 conflict pair — two tasks both at rank 1 (O10: detected, not blocked) */
  baseTask({
    id: "t-01",
    title: "Onboarding flow — activation pass",
    description:
      "Rework the first-run sequence so the score is legible on day one.",
    requirements: reqs("t-01", [
      "Cover the empty state",
      "Keep the score ambient throughout",
    ]),
    status: "in_progress",
    projectId: "pr-01",
    estimatedEffortSecs: 6 * HOUR,
    tags: ["design"],
    deadline: {
      mode: "timer",
      originalWindowSecs: 6 * HOUR,
      currentWindowSecs: 6 * HOUR,
      dueAt: iso(30),
      officialDueAt: iso(30),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-96),
  }),
  baseTask({
    id: "t-02",
    title: "Score breakdown — component drill-in",
    description: "Every channel must trace to the events beneath it.",
    status: "in_progress",
    projectId: "pr-02",
    estimatedEffortSecs: 5 * HOUR,
    tags: ["scoring"],
    deadline: {
      mode: "timer",
      originalWindowSecs: 5 * HOUR,
      currentWindowSecs: 5 * HOUR,
      dueAt: iso(52),
      officialDueAt: iso(52),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-72),
  }),

  /* Awaiting deadline proposal — the negotiation entry point */
  baseTask({
    id: "t-03",
    title: "Policy notice copy review",
    description: "Second pass on the conduct notice wording.",
    status: "assigned",
    createdById: "e-07",
    rootCreatorEmployeeId: "e-07",
    estimatedEffortSecs: 3 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: 3 * HOUR,
      currentWindowSecs: null,
      dueAt: null,
      officialDueAt: null,
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "unset",
      assignorWindowRejection: null,
    },
    createdAt: iso(-20),
  }),

  /* Proposal pending a manager decision */
  baseTask({
    id: "t-04",
    title: "Meeting notes template",
    status: "deadline_negotiation",
    createdById: "e-01",
    estimatedEffortSecs: 2 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: null,
      currentWindowSecs: 2 * HOUR,
      dueAt: null,
      officialDueAt: null,
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "proposed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-14),
  }),

  /* Ready to submit */
  baseTask({
    id: "t-05",
    title: "Document permissions matrix",
    description: "Capability × scope, for every archetype.",
    status: "in_progress",
    projectId: "pr-01",
    estimatedEffortSecs: 4 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(20),
      officialDueAt: iso(20),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-60),
  }),

  /* Completed */
  baseTask({
    id: "t-06",
    title: "Slab primitives — stepped silhouette",
    status: "completed",
    projectId: "pr-01",
    estimatedEffortSecs: 8 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: 8 * HOUR,
      currentWindowSecs: 8 * HOUR,
      dueAt: iso(-140),
      officialDueAt: iso(-140),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-400),
    updatedAt: iso(-150),
  }),

  /* Overdue and blocked */
  baseTask({
    id: "t-07",
    title: "Attendance ingest — second source",
    status: "in_progress",
    projectId: "pr-03",
    createdById: "e-05",
    rootCreatorEmployeeId: "e-05",
    isBlocked: true,
    blockedReason: "Waiting on provider credentials",
    estimatedEffortSecs: 10 * HOUR,
    deadline: {
      mode: "fixed",
      originalWindowSecs: null,
      currentWindowSecs: null,
      dueAt: iso(-36),
      officialDueAt: iso(-36),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-300),
  }),

  /* In review — the manager's queue */
  baseTask({
    id: "t-08",
    title: "Ledger view — reversal handling",
    description:
      "A dispute writes a reversal; it never mutates the original entry.",
    status: "in_review",
    projectId: "pr-02",
    createdById: "e-01",
    estimatedEffortSecs: 6 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: 6 * HOUR,
      currentWindowSecs: 6 * HOUR,
      dueAt: iso(-4),
      officialDueAt: iso(-4),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-180),
  }),

  /* Reworked once, back in progress */
  baseTask({
    id: "t-09",
    title: "Reporting chain configuration",
    status: "in_progress",
    projectId: "pr-02",
    createdById: "e-01",
    estimatedEffortSecs: 5 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: 5 * HOUR,
      currentWindowSecs: 5 * HOUR,
      dueAt: iso(44),
      officialDueAt: iso(44),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-240),
  }),

  /* Pending approval — cross-department gate */
  baseTask({
    id: "t-10",
    title: "Quarterly goal rollover",
    status: "pending_approval",
    approvalReason: "cross_department",
    approverIds: ["e-01", "e-05"],
    createdById: "e-02",
    rootCreatorEmployeeId: "e-02",
    estimatedEffortSecs: 3 * HOUR,
    createdAt: iso(-8),
  }),

  /* Self-assigned, awaiting approver */
  baseTask({
    id: "t-11",
    title: "Audit the notification pipeline",
    type: "self_assigned",
    status: "pending_approval",
    approvalReason: "self_assignment",
    approverIds: ["e-01"],
    createdById: "e-06",
    rootCreatorEmployeeId: "e-01",
    estimatedEffortSecs: 4 * HOUR,
    createdAt: iso(-30),
  }),

  /* Recurring — does not score (O20) */
  baseTask({
    id: "t-12",
    title: "Daily deployment check",
    type: "recurring",
    status: "in_progress",
    isScoreEligible: false,
    createdById: "e-03",
    rootCreatorEmployeeId: "e-03",
    recurrence: {
      cadence: "daily",
      slotsPerOccurrence: 2,
      slotLabels: ["Morning", "Evening"],
      activeFrom: day(-30),
      activeTo: null,
    },
    createdAt: iso(-720),
  }),

  /* Goal-linked (C2) */
  baseTask({
    id: "t-13",
    title: "Ship the shell to internal beta",
    type: "goal",
    status: "in_progress",
    projectId: "pr-01",
    goalId: "g-01",
    createdById: "e-07",
    rootCreatorEmployeeId: "e-07",
    estimatedEffortSecs: 12 * HOUR,
    deadline: {
      mode: "fixed",
      originalWindowSecs: null,
      currentWindowSecs: null,
      dueAt: iso(240),
      officialDueAt: iso(240),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-500),
  }),

  /* Cancelled */
  baseTask({
    id: "t-14",
    title: "Third-party vendor brief",
    type: "external",
    status: "cancelled",
    isScoreEligible: false,
    createdById: "e-05",
    rootCreatorEmployeeId: "e-05",
    createdAt: iso(-400),
    updatedAt: iso(-200),
  }),

  /* Team tasks belonging to reports */
  baseTask({
    id: "t-15",
    title: "Design system — token audit",
    /* The fixture that shows the hierarchy: two requirements, one of them
       delegated to t-18 and one still the owner's to close. */
    requirements: reqs("t-15", [
      "Token naming reviewed across every surface",
      "Deprecated tokens removed from the build",
    ]),
    status: "in_progress",
    projectId: "pr-01",
    createdById: "e-01",
    estimatedEffortSecs: 5 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: 5 * HOUR,
      currentWindowSecs: 5 * HOUR,
      dueAt: iso(60),
      officialDueAt: iso(60),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-150),
  }),
  baseTask({
    id: "t-16",
    title: "Empty-state copy pass",
    status: "in_review",
    projectId: "pr-01",
    createdById: "e-01",
    estimatedEffortSecs: 3 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: 3 * HOUR,
      currentWindowSecs: 3 * HOUR,
      dueAt: iso(-2),
      officialDueAt: iso(-2),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-120),
  }),
  baseTask({
    id: "t-17",
    title: "Query performance — ledger range scans",
    status: "in_progress",
    projectId: "pr-02",
    createdById: "e-03",
    rootCreatorEmployeeId: "e-03",
    estimatedEffortSecs: 7 * HOUR,
    deadline: {
      mode: "timer",
      originalWindowSecs: 7 * HOUR,
      currentWindowSecs: 7 * HOUR,
      dueAt: iso(80),
      officialDueAt: iso(80),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-200),
  }),
  baseTask({
    id: "t-18",
    title: "Subtask — token naming review",
    /* Claims the first requirement on t-15, so the seeded fixture shows the
       hierarchy model rather than an orphan child with a suggestive title. */
    satisfiesRequirementIds: ["req-t-15-1"],
    status: "in_progress",
    departmentId: null,
    parentTaskId: "t-15",
    projectId: "pr-01",
    createdById: "e-01",
    estimatedEffortSecs: 2 * HOUR,
    createdAt: iso(-100),
  }),

  /* ── Delivered history ──────────────────────────────────────────────────
     Eight closed tasks spread across the trailing ten weeks.

     Added because the fixture previously contained exactly ONE completed task
     for Maya, which made two surfaces lie by omission: C1 · Task Execution was
     measured across a single unit — the degenerate case that made the pooled
     composite read as 97% attendance — and the workload-flow graph had no
     departures at all, so half its geometry could never exercise. Closed work
     is the most ordinary thing in a workspace and its absence was the
     unrealistic part. Every date here is plausible and internally consistent;
     the whole store is labelled sample data at the point of display. */
  baseTask({
    id: "t-40",
    title: "Score ledger — reversal handling",
    status: "completed",
    projectId: "pr-02",
    estimatedEffortSecs: 4 * HOUR,
    tags: ["scoring"].map(String),
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(-1572),
      officialDueAt: iso(-1572),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-1680),
    updatedAt: iso(-1560),
  }),
  baseTask({
    id: "t-41",
    title: "Deadline counter flow",
    status: "completed",
    projectId: "pr-01",
    estimatedEffortSecs: 4 * HOUR,
    tags: ["design"].map(String),
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(-1432),
      officialDueAt: iso(-1432),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-1510),
    updatedAt: iso(-1420),
  }),
  baseTask({
    id: "t-42",
    title: "Attendance import adapter",
    status: "completed",
    projectId: "pr-03",
    estimatedEffortSecs: 4 * HOUR,
    tags: ["integration"].map(String),
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(-1282),
      officialDueAt: iso(-1282),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-1350),
    updatedAt: iso(-1270),
  }),
  baseTask({
    id: "t-43",
    title: "Priority cascade preview",
    status: "completed",
    projectId: "pr-01",
    estimatedEffortSecs: 4 * HOUR,
    tags: ["design"].map(String),
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(-1117),
      officialDueAt: iso(-1117),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-1200),
    updatedAt: iso(-1105),
  }),
  baseTask({
    id: "t-44",
    title: "Component band — halftone pass",
    status: "completed",
    projectId: "pr-02",
    estimatedEffortSecs: 4 * HOUR,
    tags: ["design"].map(String),
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(-972),
      officialDueAt: iso(-972),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-1040),
    updatedAt: iso(-960),
  }),
  baseTask({
    id: "t-45",
    title: "Effort budget guard",
    status: "completed",
    projectId: "pr-01",
    estimatedEffortSecs: 4 * HOUR,
    tags: ["scoring"].map(String),
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(-812),
      officialDueAt: iso(-812),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-890),
    updatedAt: iso(-800),
  }),
  baseTask({
    id: "t-46",
    title: "Rework receipt copy",
    status: "completed",
    projectId: "pr-02",
    estimatedEffortSecs: 4 * HOUR,
    tags: ["copy"].map(String),
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(-652),
      officialDueAt: iso(-652),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-720),
    updatedAt: iso(-640),
  }),
  baseTask({
    id: "t-47",
    title: "Project milestone rollup",
    status: "completed",
    projectId: "pr-03",
    estimatedEffortSecs: 4 * HOUR,
    tags: ["projects"].map(String),
    deadline: {
      mode: "timer",
      originalWindowSecs: 4 * HOUR,
      currentWindowSecs: 4 * HOUR,
      dueAt: iso(-482),
      officialDueAt: iso(-482),
      operationalDueAt: null,
      clockStartsAt: null,
      clockStartsAtSource: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    createdAt: iso(-560),
    updatedAt: iso(-470),
  }),
];

/* ── Assignments (rank = per-person priority) ─────────────────────────────── */

/**
 * An assignment's timestamps follow ITS OWN TASK rather than a shared constant.
 *
 * Every assignment used to carry `iso(-200)`, which made a real fixture look
 * synthetic in three places at once: the task table's "last activity" column
 * read identically for every row, the workload-flow graph put all nine
 * assignments in a single week, and nothing in the product could show change
 * over time. Deriving from `task.createdAt` costs nothing and makes the whole
 * history plausible.
 */
function asg(
  id: string,
  taskId: string,
  employeeId: string,
  rank: number,
  over: Partial<TaskAssignment> = {},
): TaskAssignment {
  const created = tasks.find((t) => t.id === taskId)?.createdAt;
  const base = created
    ? new Date(created).getTime()
    : NOW.getTime() - 200 * 3600_000;
  const at = (hoursAfter: number) =>
    new Date(base + hoursAfter * 3600_000).toISOString();
  return {
    id,
    taskId,
    employeeId,
    rank,
    /* Never seeded. A queue position is a consequence of the whole queue and is
       filled in by the read; a fixture holding one would be asserting a position
       the derivation might not agree with. Same reasoning for its provisional
       counterpart. */
    queuePosition: null,
    provisionalPosition: null,
    assignedAt: at(1),
    confirmedAt: at(6),
    startedAt: at(10),
    isScoreSubject: true,
    ...over,
  };
}

export const assignments: TaskAssignment[] = [
  /* Maya — note t-01 and t-02 BOTH at rank 1: a live P1 conflict */
  asg("a-01", "t-01", "e-01", 1),
  asg("a-02", "t-02", "e-01", 1),
  asg("a-03", "t-03", "e-01", 3, { confirmedAt: null, startedAt: null }),
  asg("a-04", "t-04", "e-01", 4, { confirmedAt: null, startedAt: null }),
  asg("a-05", "t-05", "e-01", 2),
  asg("a-06", "t-06", "e-01", 5),
  asg("a-07", "t-08", "e-01", 6),
  asg("a-08", "t-12", "e-01", 7),
  asg("a-09", "t-13", "e-01", 8),

  /* Reports */
  asg("a-10", "t-07", "e-04", 1),
  asg("a-11", "t-09", "e-02", 1),
  asg("a-12", "t-15", "e-02", 2),
  asg("a-13", "t-16", "e-06", 1),
  asg("a-14", "t-17", "e-04", 2),
  asg("a-15", "t-18", "e-02", 3),
  asg("a-16", "t-10", "e-05", 1, { confirmedAt: null, startedAt: null }),
  asg("a-17", "t-11", "e-06", 2, { confirmedAt: null, startedAt: null }),
  /* Multi-assignee: only the primary scores (O9) */
  asg("a-18", "t-13", "e-02", 4, { isScoreSubject: false }),

  /* Delivered history — see the tasks block. */
  asg("a-40", "t-40", "e-01", 1),
  asg("a-41", "t-41", "e-01", 2),
  asg("a-42", "t-42", "e-01", 3),
  asg("a-43", "t-43", "e-01", 4),
  asg("a-44", "t-44", "e-01", 5),
  asg("a-45", "t-45", "e-01", 6),
  asg("a-46", "t-46", "e-01", 7),
  asg("a-47", "t-47", "e-01", 8),
];

/* ── Approvals ────────────────────────────────────────────────────────────── */

export const approvals: Approval[] = [
  {
    id: "ap-01",
    taskId: "t-10",
    submissionId: null,
    kind: "cross_department",
    stage: 1,
    side: "sender",
    approverId: "e-01",
    approverName: "Maya Ferreira",
    decision: "pending",
    reason: null,
    decidedAt: null,
  },
  {
    id: "ap-02",
    taskId: "t-10",
    submissionId: null,
    kind: "cross_department",
    stage: 2,
    side: "receiver",
    approverId: "e-05",
    approverName: "Hanne Vermeer",
    decision: "waiting",
    reason: null,
    decidedAt: null,
  },
  {
    id: "ap-03",
    taskId: "t-11",
    submissionId: null,
    kind: "self_assignment",
    stage: 1,
    side: null,
    approverId: "e-01",
    approverName: "Maya Ferreira",
    decision: "pending",
    reason: null,
    decidedAt: null,
  },
];

/* ── Deadline proposals ───────────────────────────────────────────────────── */

export const proposals: DeadlineProposal[] = [
  {
    id: "dp-01",
    taskId: "t-04",
    proposedById: "e-01",
    proposedDueAt: iso(28),
    windowSecs: 2 * HOUR,
    isExtension: false,
    previousWindowSecs: null,
    addedSecs: null,
    reason: "Two hours is enough for a first pass.",
    state: "pending",
    decidedById: null,
    decisionReason: null,
    createdAt: iso(-12),
    expiresAt: iso(36),
    decidedAt: null,
  },
  {
    id: "dp-02",
    taskId: "t-01",
    proposedById: "e-01",
    proposedDueAt: iso(30),
    windowSecs: 6 * HOUR,
    isExtension: false,
    previousWindowSecs: null,
    addedSecs: null,
    reason: null,
    state: "approved",
    decidedById: "e-07",
    decisionReason: null,
    createdAt: iso(-90),
    expiresAt: null,
    decidedAt: iso(-88),
  },
];

/* ── Submissions and reviews ──────────────────────────────────────────────── */

export const submissions: TaskSubmission[] = [
  {
    id: "sb-01",
    taskId: "t-08",
    outputId: null,
    attempt: 1,
    submittedById: "e-01",
    submittedAt: iso(-3),
    message:
      "Reversal path implemented — a dispute now appends a reversal entry and never mutates the original row.",
    attachmentIds: ["at-01"],
    attachments: [],
    reviewChain: ["e-07"],
    currentStage: 1,
    supersededById: null,
    wasLate: true,
  },
  {
    id: "sb-02",
    taskId: "t-16",
    outputId: null,
    attempt: 1,
    submittedById: "e-06",
    submittedAt: iso(-1),
    message: "Copy pass complete across all twelve empty states.",
    attachmentIds: [],
    attachments: [],
    reviewChain: ["e-01"],
    currentStage: 1,
    supersededById: null,
    wasLate: true,
  },
  {
    id: "sb-03",
    taskId: "t-09",
    outputId: null,
    attempt: 1,
    submittedById: "e-02",
    submittedAt: iso(-50),
    message: "First pass at the reporting chain resolver.",
    attachmentIds: [],
    attachments: [],
    reviewChain: ["e-01"],
    currentStage: 1,
    supersededById: null,
    wasLate: false,
  },
];

export const reviews = [
  {
    id: "rv-02",
    submissionId: "sb-03",
    taskId: "t-43",
    stage: 1,
    isFinalStage: true,
    reviewerId: "e-04",
    decision: "approved" as const,
    reason: null,
    reviewedAt: iso(-1100),
  },
  {
    id: "rv-03",
    submissionId: "sb-03",
    taskId: "t-46",
    stage: 1,
    isFinalStage: true,
    reviewerId: "e-04",
    decision: "approved" as const,
    reason: null,
    reviewedAt: iso(-640),
  },
  {
    id: "rv-04",
    submissionId: "sb-03",
    taskId: "t-42",
    stage: 1,
    isFinalStage: true,
    reviewerId: "e-04",
    decision: "rework" as const,
    reason: "Two states were missing from the counter table.",
    reviewedAt: iso(-1300),
  },
  {
    id: "rv-01",
    submissionId: "sb-03",
    taskId: "t-09",
    stage: 1,
    isFinalStage: true,
    reviewerId: "e-01",
    decision: "rework" as const,
    reason:
      "Cycle detection is missing — a self-referencing chain will hang the resolver.",
    reviewedAt: iso(-46),
  },
];

export const reworkRequests = [
  {
    id: "rw-01",
    reviewId: "rv-01",
    taskId: "t-09",
    occurrence: 1,
    reason:
      "Cycle detection is missing — a self-referencing chain will hang the resolver.",
    requestedById: "e-01",
    requestedAt: iso(-46),
    previousDueAt: iso(-20),
    newDueAt: iso(44),
    deductionWaived: false,
    waiverReason: null,
  },
];

/* ── Work ─────────────────────────────────────────────────────────────────── */

export const workCommits: WorkCommit[] = tenant<WorkCommit>([
  wc("wc-01", "t-01", "e-01", -5, 1.05, "Activation copy revision"),
  wc("wc-02", "t-05", "e-01", -3.5, 2.0, "Capability matrix drafted"),
  wc("wc-03", "t-02", "e-01", -26, 3.2, null),
  wc("wc-04", "t-09", "e-02", -4, 2.0, "Resolver rewrite"),
  wc("wc-05", "t-15", "e-02", -2, 0.75, null),
  wc("wc-06", "t-16", "e-06", -6, 1.5, "Twelve states"),
  wc("wc-07", "t-07", "e-04", -1.5, 0.15, "Blocked on credentials"),
  wc("wc-08", "t-17", "e-04", -28, 4.0, null),
]);

function wc(
  id: string,
  taskId: string,
  employeeId: string,
  startOffsetHours: number,
  durationHours: number,
  message: string | null,
): WorkCommit {
  return {
    organisationId: SEED_ORGANISATION_ID,
    id,
    taskId,
    employeeId,
    startedAt: iso(startOffsetHours),
    endedAt: iso(startOffsetHours + durationHours),
    durationSecs: Math.round(durationHours * HOUR),
    message,
    attachmentIds: [],
    pauseReason: "manual",
  };
}

/* ── Chat and events ──────────────────────────────────────────────────────── */

export const chatMessages: TaskChatMessage[] = [
  chat(
    "ch-01",
    "t-08",
    "chat",
    "e-01",
    "Maya Ferreira",
    "Ready for review — reversal path is in.",
    -3,
  ),
  chat(
    "ch-02",
    "t-08",
    "chat",
    "system",
    "System",
    "Maya Ferreira submitted work for review.",
    -3,
  ),
  chat(
    "ch-03",
    "t-09",
    "chat",
    "e-01",
    "Maya Ferreira",
    "Sent back — see the review note.",
    -46,
  ),
  chat(
    "ch-04",
    "t-09",
    "chat",
    "e-02",
    "Tobias Lund",
    "Understood, adding cycle detection now.",
    -44,
  ),
  chat(
    "ch-05",
    "t-04",
    "draft",
    "e-01",
    "Maya Ferreira",
    "Proposed two hours for this.",
    -12,
  ),
  chat(
    "ch-06",
    "t-03",
    "draft",
    "e-07",
    "Priya Raman",
    "Whenever you can get to it this week.",
    -19,
  ),
  chat(
    "ch-07",
    "t-01",
    "chat",
    "e-02",
    "Tobias Lund",
    "Do you want the empty state in this pass?",
    -8,
  ),
];

function chat(
  id: string,
  taskId: string,
  thread: "chat" | "draft",
  senderId: string,
  senderName: string,
  text: string,
  offsetHours: number,
): TaskChatMessage {
  return {
    id,
    taskId,
    thread,
    senderId,
    senderName,
    text,
    attachmentIds: [],
    attachments: [],
    messageType: senderId === "system" ? "system" : "text",
    createdAt: iso(offsetHours),
  };
}

export const taskEvents: TaskEvent[] = [
  ev("te-01", "t-09", 1, "created", "e-01", "Maya Ferreira", "Task created"),
  ev(
    "te-02",
    "t-09",
    2,
    "assigned",
    "e-01",
    "Maya Ferreira",
    "Assigned to Tobias Lund",
  ),
  ev(
    "te-03",
    "t-09",
    3,
    "confirmed",
    "e-02",
    "Tobias Lund",
    "Receipt confirmed",
  ),
  ev("te-04", "t-09", 4, "started", "e-02", "Tobias Lund", "Work started"),
  ev(
    "te-05",
    "t-09",
    5,
    "submitted",
    "e-02",
    "Tobias Lund",
    "Submitted for review",
  ),
  ev(
    "te-06",
    "t-09",
    6,
    "rework_requested",
    "e-01",
    "Maya Ferreira",
    "Rework requested — occurrence 1",
  ),
  ev("te-07", "t-08", 1, "created", "e-01", "Maya Ferreira", "Task created"),
  ev(
    "te-08",
    "t-08",
    2,
    "submitted",
    "e-01",
    "Maya Ferreira",
    "Submitted for review",
  ),
];

function ev(
  id: string,
  taskId: string,
  sequence: number,
  type: TaskEvent["type"],
  actorId: string,
  actorLabel: string,
  summary: string,
): TaskEvent {
  return {
    id,
    taskId,
    sequence,
    type,
    actorId,
    actorLabel,
    summary,
    payload: {},
    occurredAt: iso(-200 + sequence * 8),
  };
}

/* ── Goals ────────────────────────────────────────────────────────────────── */

export const goals: Goal[] = tenant<Goal>([
  {
    id: "g-01",
    title: "Ship the workspace shell to internal beta",
    description: "Forty seats, all six domains reachable.",
    ownerId: "e-01",
    periodKey: "2026-Q3",
    weightPercent: 35,
    maximumPoints: 3,
    targetValue: 40,
    achievedValue: 31,
    unit: "seats",
    status: "active",
    createdById: "e-07",
    createdAt: iso(-1000),
  },
  {
    id: "g-02",
    title: "Cut task hand-off time by a quarter",
    description: null,
    ownerId: "e-01",
    periodKey: "2026-Q3",
    weightPercent: 25,
    maximumPoints: 2,
    targetValue: 25,
    achievedValue: 14,
    unit: "% reduction",
    status: "active",
    createdById: "e-07",
    createdAt: iso(-900),
  },
  {
    id: "g-03",
    title: "Document every score component surface",
    description: null,
    ownerId: "e-01",
    periodKey: "2026-Q3",
    weightPercent: 20,
    maximumPoints: 2,
    targetValue: 4,
    achievedValue: 4,
    unit: "components",
    status: "active",
    createdById: "e-01",
    createdAt: iso(-800),
  },
]);

export const goalActivities: GoalActivity[] = [
  ga("ga-01", "g-01", "Shell and navigation", 1, -100, "approved", false),
  ga("ga-02", "g-01", "Task surfaces", 1, 200, "in_progress", false),
  ga("ga-03", "g-01", "Score surfaces", 1, 400, "pending", false),
  ga(
    "ga-04",
    "g-02",
    "Instrument the hand-off path",
    1,
    -200,
    "approved",
    false,
  ),
  ga("ga-05", "g-02", "Ship the reduction", 1, 300, "pending", false),
  ga("ga-06", "g-03", "C1 and C2 documented", 1, -300, "approved", false),
  ga("ga-07", "g-03", "C3 and C4 documented", 1, -50, "approved", true),
];

function ga(
  id: string,
  goalId: string,
  heading: string,
  points: number,
  dueOffsetHours: number,
  status: GoalActivity["status"],
  late: boolean,
): GoalActivity {
  return {
    id,
    goalId,
    heading,
    description: null,
    points,
    dueAt: iso(dueOffsetHours),
    assigneeIds: ["e-01"],
    status,
    submittedLate: late,
    report: null,
    reportRequestedAt: null,
    reportRequestedById: null,
    linkedTaskId: null,
  };
}

/* ── Conduct ──────────────────────────────────────────────────────────────── */

export const conductPolicies: ConductPolicy[] = tenant<ConductPolicy>([
  {
    id: "cp-01",
    name: "Missed mandatory security training",
    description: "Annual training not completed within the notice window.",
    severity: "moderate",
    /* A percentage off the score, not a point count — see `ConductPolicy`. */
    percent: 5,
    scope: "global",
    departmentIds: [],
    isActive: true,
    status: "approved",
    createdById: "GR0045",
    createdByName: "Rakesh Biswal",
    approverId: "E000",
    approverName: "Admin CEO",
    decidedByName: "Admin CEO",
    rejectedReason: null,
  },
  {
    id: "cp-02",
    name: "Unlogged client commitment",
    description: "A commitment made to a client without a corresponding task.",
    severity: "minor",
    percent: 2,
    scope: "global",
    departmentIds: [],
    isActive: true,
    status: "approved",
    createdById: "GR0045",
    createdByName: "Rakesh Biswal",
    approverId: "E000",
    approverName: "Admin CEO",
    decidedByName: "Admin CEO",
    rejectedReason: null,
  },
  {
    id: "cp-03",
    name: "Falsified completion record",
    description: "Work reported as complete that was not performed.",
    severity: "falsification",
    percent: 25,
    scope: "global",
    departmentIds: [],
    isActive: true,
    /* Written and waiting, so the approval queue has something in it on a
       demo tenant — the flow is the feature, and an empty queue shows none
       of it. */
    status: "pending",
    createdById: "GR0045",
    createdByName: "Rakesh Biswal",
    approverId: "E000",
    approverName: "Admin CEO",
    decidedByName: null,
    rejectedReason: null,
  },
]);

export const conductEvents: ConductEvent[] = [
  {
    id: "ce-01",
    employeeId: "e-01",
    policyId: "cp-02",
    policyName: "Unlogged client commitment",
    severity: "minor",
    description: "Commitment recorded in a meeting with no corresponding task.",
    occurredOn: day(-18),
    appliedById: "e-08",
    appliedByName: "Adaeze Okonkwo",
    appliedAt: iso(-420),
    disputeStatus: "none",
    disputeNote: null,
    reversalLedgerEntryId: null,
  },
  {
    id: "ce-02",
    employeeId: "e-04",
    policyId: "cp-01",
    policyName: "Missed mandatory security training",
    severity: "moderate",
    description: "Annual training overdue by eleven days.",
    occurredOn: day(-30),
    appliedById: "e-08",
    appliedByName: "Adaeze Okonkwo",
    appliedAt: iso(-700),
    disputeStatus: "requested",
    disputeNote: "Was on approved leave for the notice window.",
    reversalLedgerEntryId: null,
  },
];

/* ── Attendance ───────────────────────────────────────────────────────────── */

export function buildAttendance(
  employeeId: string,
  days: number,
): AttendanceDay[] {
  const out: AttendanceDay[] = [];
  // Deterministic pseudo-variation keyed off the index and employee id.
  const seedNum = employeeId.charCodeAt(employeeId.length - 1);
  for (let i = days; i >= 0; i--) {
    const d = new Date(NOW.getTime() - i * 86_400_000);
    const weekday = d.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const n = (i * 7 + seedNum) % 23;

    let status: AttendanceDay["status"] = "present";
    let lateMinutes = 0;
    let earlyDepartureMinutes = 0;

    if (isWeekend) status = "week_off";
    else if (n === 3) status = "leave";
    else if (n === 11) status = "absent";
    else if (n === 17) {
      status = "half_day";
      earlyDepartureMinutes = 210;
    } else if (n % 5 === 0) lateMinutes = 8 + (n % 4) * 9;

    out.push({
      organisationId: SEED_ORGANISATION_ID,
      id: `att-${employeeId}-${i}`,
      employeeId,
      date: d.toISOString().slice(0, 10),
      isExpectedWorkingDay: !isWeekend,
      scheduledStart: isWeekend ? null : "09:30",
      scheduledEnd: isWeekend ? null : "18:00",
      actualStart:
        status === "present" || status === "half_day"
          ? minutesToClock(9 * 60 + 30 + lateMinutes)
          : null,
      actualEnd:
        status === "present"
          ? "18:05"
          : status === "half_day"
            ? minutesToClock(18 * 60 - earlyDepartureMinutes)
            : null,
      lateMinutes,
      earlyDepartureMinutes,
      status,
    });
  }
  return out;
}

function minutesToClock(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/* ── Collaboration ────────────────────────────────────────────────────────── */

export const groups: Group[] = tenant<Group>([
  {
    id: "gr-01",
    name: "Product design",
    description: "Design crit and hand-off",
    memberIds: ["e-01", "e-02", "e-06"],
    ownerId: "e-01",
    createdAt: iso(-2000),
  },
  {
    id: "gr-02",
    name: "Platform",
    description: null,
    memberIds: ["e-03", "e-04"],
    ownerId: "e-03",
    createdAt: iso(-1800),
  },
]);

export const conversations: Conversation[] = tenant<Conversation>([
  {
    id: "cv-01",
    kind: "direct",
    participantIds: ["e-01", "e-02"],
    title: null,
    groupId: null,
    lastMessageAt: iso(-2),
    lastMessagePreview: "Adding cycle detection now.",
    unreadCount: 1,
  },
  {
    id: "cv-02",
    kind: "direct",
    participantIds: ["e-01", "e-07"],
    title: null,
    groupId: null,
    lastMessageAt: iso(-18),
    lastMessagePreview: "Whenever you can get to it this week.",
    unreadCount: 0,
  },
  {
    id: "cv-03",
    kind: "group",
    participantIds: ["e-01", "e-02", "e-06"],
    title: "Product design",
    groupId: "gr-01",
    lastMessageAt: iso(-30),
    lastMessagePreview: "Crit moved to Thursday.",
    unreadCount: 2,
  },
]);

export const messages: Message[] = [
  msg(
    "mg-01",
    "cv-01",
    "e-01",
    "Maya Ferreira",
    "Sent the reporting chain task back — see the note.",
    -46,
  ),
  msg(
    "mg-02",
    "cv-01",
    "e-02",
    "Tobias Lund",
    "Adding cycle detection now.",
    -2,
  ),
  msg(
    "mg-03",
    "cv-02",
    "e-07",
    "Priya Raman",
    "Whenever you can get to it this week.",
    -18,
  ),
  msg("mg-04", "cv-03", "e-06", "Jonas Weber", "Crit moved to Thursday.", -30),
];

function msg(
  id: string,
  conversationId: string,
  senderId: string,
  senderName: string,
  text: string,
  offsetHours: number,
): Message {
  return {
    id,
    conversationId,
    senderId,
    senderName,
    text,
    attachmentIds: [],
    attachments: [],
    replyToId: null,
    createdAt: iso(offsetHours),
    readBy: [senderId],
  };
}

export const meetings: Meeting[] = tenant<Meeting>([
  {
    id: "mt-01",
    title: "Design crit — task surfaces",
    description: "Walk the tasks list and detail.",
    organiserId: "e-01",
    participantIds: ["e-01", "e-02", "e-06"],
    startsAt: iso(4),
    endsAt: iso(5),
    status: "scheduled",
    joinToken: "cw-demo-token",
    recordingEnabled: false,
    hasSummary: false,
    livekitRoomName: null,
    agenda: [],
    taskId: null,
    projectId: null,
    startedAt: null,
    endedAt: null,
    actualDurationSecs: null,
    transcriptId: null,
    actionItems: [],
  },
  {
    id: "mt-02",
    title: "Platform sync",
    description: null,
    organiserId: "e-03",
    participantIds: ["e-03", "e-04", "e-01"],
    startsAt: iso(-20),
    endsAt: iso(-19),
    status: "completed",
    joinToken: null,
    recordingEnabled: true,
    hasSummary: true,
    livekitRoomName: null,
    agenda: [],
    taskId: null,
    projectId: null,
    startedAt: null,
    endedAt: null,
    actualDurationSecs: null,
    transcriptId: null,
    actionItems: [],
  },
]);

export const notifications: Notification[] = tenant<Notification>([
  notif(
    "nt-01",
    "review_requested",
    "Work submitted",
    "Jonas Weber submitted “Empty-state copy pass”.",
    -1,
    false,
    "task",
    "t-16",
  ),
  notif(
    "nt-02",
    "priority_cascade",
    "Deadlines shifted",
    "Two of your tasks moved because a higher-priority task took precedence.",
    -6,
    false,
    "task",
    "t-01",
  ),
  notif(
    "nt-03",
    "approval_requested",
    "Approval needed",
    "Tobias Lund needs cross-department approval for “Quarterly goal rollover”.",
    -8,
    false,
    "task",
    "t-10",
  ),
  notif(
    "nt-04",
    "deadline_proposed",
    "Deadline proposed",
    "You proposed 2h for “Meeting notes template”.",
    -12,
    true,
    "task",
    "t-04",
  ),
  notif(
    "nt-05",
    "rework_requested",
    "Rework requested",
    "“Reporting chain configuration” was sent back for rework.",
    -46,
    true,
    "task",
    "t-09",
  ),
  notif(
    "nt-06",
    "conduct_applied",
    "Conduct event recorded",
    "A minor conduct event was recorded on 7 July.",
    -420,
    true,
    "conduct",
    "ce-01",
  ),
]);

function notif(
  id: string,
  type: string,
  title: string,
  body: string,
  offsetHours: number,
  read: boolean,
  sourceType: string,
  sourceId: string,
): Notification {
  return {
    organisationId: SEED_ORGANISATION_ID,
    id,
    recipientId: CURRENT_EMPLOYEE_ID,
    type,
    title,
    body,
    data: {},
    sourceType,
    sourceId,
    channels: ["in_app", "push"],
    readAt: read ? iso(offsetHours + 1) : null,
    createdAt: iso(offsetHours),
  };
}

/* ── Project links and activity ───────────────────────────────────────────── */

export const projectTaskLinks: ProjectTaskLink[] = tasks
  .filter((t) => t.projectId)
  .map((t, i) => ({
    id: `ptl-${i + 1}`,
    projectId: t.projectId as string,
    taskId: t.id,
    linkedAt: t.createdAt,
    linkedById: "e-01",
    milestoneId:
      t.id === "t-06"
        ? "ms-01"
        : t.id === "t-01" || t.id === "t-02"
          ? "ms-02"
          : t.id === "t-08"
            ? "ms-03"
            : null,
  }));

export const projectActivity: ProjectActivity[] = [
  pa(
    "pa-01",
    "pr-01",
    "created",
    "e-01",
    "Maya Ferreira",
    "Project created",
    -960,
  ),
  pa(
    "pa-02",
    "pr-01",
    "member_added",
    "e-01",
    "Maya Ferreira",
    "Tobias Lund added as member",
    -940,
  ),
  pa(
    "pa-03",
    "pr-01",
    "milestone_completed",
    "system",
    "System",
    "“Deck and navigation complete” reached",
    -150,
  ),
  pa(
    "pa-04",
    "pr-01",
    "task_linked",
    "e-01",
    "Maya Ferreira",
    "“Onboarding flow — activation pass” linked",
    -96,
  ),
  pa(
    "pa-05",
    "pr-02",
    "created",
    "e-03",
    "Renata Alves",
    "Project created",
    -672,
  ),
  pa(
    "pa-06",
    "pr-02",
    "task_linked",
    "e-01",
    "Maya Ferreira",
    "“Ledger view — reversal handling” linked",
    -180,
  ),
  pa(
    "pa-07",
    "pr-03",
    "status_changed",
    "e-05",
    "Hanne Vermeer",
    "Status changed to On hold",
    -72,
  ),
];

function pa(
  id: string,
  projectId: string,
  type: ProjectActivity["type"],
  actorId: string,
  actorLabel: string,
  summary: string,
  offsetHours: number,
): ProjectActivity {
  return {
    id,
    projectId,
    type,
    actorId,
    actorLabel,
    summary,
    occurredAt: iso(offsetHours),
  };
}

export const attachments = [
  {
    id: "at-01",
    ownerId: "e-01",
    scope: { type: "submission" as const, id: "sb-01" },
    filename: "reversal-path.pdf",
    mimeType: "application/pdf",
    sizeBytes: 284_100,
    storageKey: "demo/reversal-path.pdf",
    uploadedAt: iso(-3),
    deletedAt: null,
  },
];
