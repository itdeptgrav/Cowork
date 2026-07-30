import type {
  ActivityEvent,
  DailySummary,
  DeviceInfo,
  Employee,
  EmployeeId,
  MonitoringPerformance,
  MonitoringSubject,
  InterventionGroup,
  InterventionItem,
  Observation,
  TeamAnalytics,
  TeamMonitoringRow,
} from "@/lib/domain";
import { presenceIdentityFor } from "@/lib/integrations/livekit/identity";

/**
 * Sample monitoring data for the prototype.
 *
 * This file **does not monitor anything**. There is no endpoint agent, no
 * browser extension and no network capture behind it — it returns a fixed,
 * plausible day so the monitoring surfaces can be designed, reviewed and
 * accessibility-tested against realistic shapes. Every function here is
 * replaced wholesale when a real provider exists; nothing above the repository
 * boundary changes when that happens.
 *
 * Two rules this data obeys, because they are product constraints rather than
 * fixture conveniences:
 *
 *  · **No music, no video.** Cowork's music surface is excluded from scoring,
 *    attendance, timers and manager monitoring by an explicit product decision.
 *    A fixture that showed "YouTube — 42m" would quietly establish the opposite,
 *    and fixtures have a way of becoming specifications.
 *  · **No personal browsing.** The endpoint feed this stands in for reports
 *    work applications and work domains. Inventing a fixture where a manager
 *    reads someone's private browsing would design a surface for it.
 *
 * The clock is the prototype's fixed clock — 25 July 2026 — so screenshots and
 * tests do not drift.
 */

/** The prototype's frozen "now". Matches the rest of the mock store. */
const DAY = "2026-07-25";

/**
 * Sample times are written as the employee's own wall clock and converted here.
 *
 * The seeded people are in `Asia/Kolkata`, and the UI renders every time in the
 * subject's zone — so a fixture written in UTC would show a day starting at
 * 14:42 and a detail line claiming 09:12. Writing the fixture in local time and
 * converting once is the only way the two agree.
 */
const IST_OFFSET_MINS = 5 * 60 + 30;

function at(h: number, m: number): string {
  return new Date(Date.UTC(2026, 6, 25, h, m - IST_OFFSET_MINS)).toISOString();
}

const NOW = Date.parse(at(14, 5));

/**
 * Who publishes a screen where.
 *
 * Re-exported from `lib/livekit/identity`, which both halves of the room now
 * import. This file used to own a table that mapped ONE seeded employee onto
 * the fixed identity the publisher happened to use, and derived
 * `employee-<id>` for everybody else — so every other employee's screen was
 * unmatchable, and that one employee's profile showed whoever was publishing.
 */
export { presenceIdentityFor };

export function subjectFor(
  employee: Employee,
  presence: MonitoringSubject["presence"],
  onlineSecondsToday: number,
  currentActivity: string | null,
  currentTaskId: string | null,
): MonitoringSubject {
  return {
    employeeId: employee.id,
    displayName: employee.displayName,
    initials: employee.initials,
    hue: employee.hue,
    departmentName: employee.departmentName,
    designation: employee.designation,
    presenceIdentity: presenceIdentityFor(employee.id),
    presence,
    presenceSince: presence === "offline" ? null : at(9, 12),
    onlineSecondsToday,
    currentActivity,
    currentTaskId,
    timezone: employee.timezone,
  };
}

/* ── Per-person sample days ───────────────────────────────────────────────── */

interface SampleDay {
  presence: MonitoringSubject["presence"];
  onlineSecondsToday: number;
  currentActivity: string | null;
  currentTaskId: string | null;
  events: Omit<ActivityEvent, "id" | "employeeId">[];
  performance: Omit<MonitoringPerformance, "employeeId">;
  device: Omit<DeviceInfo, "employeeId">;
  summary: Omit<DailySummary, "employeeId" | "date">;
  observations: Omit<Observation, "id" | "employeeId">[];
}

function evt(
  kind: ActivityEvent["kind"],
  label: string,
  detail: string | null,
  startH: number,
  startM: number,
  durationMins: number,
  opts: { notable?: boolean; href?: string | null; open?: boolean } = {},
): Omit<ActivityEvent, "id" | "employeeId"> {
  const startedAt = at(startH, startM);
  const end = Date.UTC(2026, 6, 25, startH, startM + durationMins);
  return {
    kind,
    label,
    detail,
    startedAt,
    endedAt: opts.open ? null : new Date(end).toISOString(),
    durationSecs: durationMins * 60,
    notable: opts.notable ?? false,
    href: opts.href ?? null,
  };
}

const DAYS: Record<string, SampleDay> = {
  /* Tobias Lund — a full working day, currently sharing. */
  "e-02": {
    presence: "online",
    onlineSecondsToday: 4 * 3600 + 38 * 60,
    currentActivity: "Empty-state copy pass",
    currentTaskId: "t-04",
    events: [
      evt(
        "attendance",
        "Signed in",
        "09:12, four minutes before schedule",
        9,
        12,
        1,
      ),
      evt("application", "Figma", "Workspace shell — empty states", 9, 14, 46),
      evt("task", "Started: Empty-state copy pass", "Timer running", 10, 0, 1, {
        href: "/tasks/t-04",
      }),
      evt("website", "cowork.internal", "Task detail, ledger view", 10, 1, 34),
      evt(
        "meeting",
        "Design crit — task surfaces",
        "3 people · 40 minutes",
        10,
        35,
        40,
        {
          href: "/meetings",
        },
      ),
      evt("idle", "Idle", "No input detected", 11, 15, 22, { notable: true }),
      evt("application", "Figma", "Workspace shell — empty states", 11, 37, 53),
      evt("attendance", "Break", "Away from keyboard", 12, 30, 45),
      evt("application", "VS Code", "cowork/components/ui", 13, 15, 28),
      evt(
        "task",
        "Submitted for review: Meeting notes template",
        null,
        13,
        43,
        2,
        {
          notable: true,
          href: "/tasks",
        },
      ),
      evt(
        "website",
        "developer.mozilla.org",
        "Dialog element, focus management",
        13,
        45,
        18,
      ),
      evt("application", "Figma", "Empty-state copy pass", 14, 3, 2, {
        open: true,
      }),
    ],
    performance: {
      productivityScore: 78,
      provisional: true,
      trend: -3,
      activeSecondsToday: 4 * 3600 + 12 * 60,
      focusSecondsToday: 2 * 3600 + 48 * 60,
      tasksCompletedToday: 2,
      tasksOpen: 6,
      attendanceRate: 96,
      attendanceNote: "One late start this period",
    },
    device: {
      deviceName: "Tobias — MacBook Pro",
      deviceModel: 'MacBook Pro 14" (M3)',
      operatingSystem: "macOS 15.4",
      browser: "Chrome 141",
      network: "Office Wi-Fi · Lisbon",
      networkQuality: "good",
      latencyMs: 34,
      sharedSurface: "entire_screen",
      displayCount: 2,
      lastSeenAt: at(14, 5),
    },
    summary: {
      stats: [
        { id: "active", label: "Active", value: "4h 12m", unit: null },
        { id: "focus", label: "Focus", value: "2h 48m", unit: null },
        { id: "done", label: "Completed", value: "2", unit: "tasks" },
        { id: "meetings", label: "In meetings", value: "40m", unit: null },
      ],
      completed: [
        {
          id: "c-1",
          title: "Reversal handling — ledger view",
          completedAt: at(11, 8),
          outcome: "on_time",
          href: "/tasks",
        },
        {
          id: "c-2",
          title: "Meeting notes template",
          completedAt: at(13, 43),
          outcome: "reworked",
          href: "/tasks",
        },
      ],
      quality: [
        {
          id: "q-rework",
          label: "Rework rate",
          value: 12,
          unit: "%",
          betterWhen: "lower",
          trend: 4,
        },
        {
          id: "q-ontime",
          label: "On time",
          value: 88,
          unit: "%",
          betterWhen: "higher",
          trend: -2,
        },
        {
          id: "q-first",
          label: "First-pass approval",
          value: 74,
          unit: "%",
          betterWhen: "higher",
          trend: 6,
        },
      ],
      trend: [
        { date: "2026-07-20", value: 81 },
        { date: "2026-07-21", value: 84 },
        { date: "2026-07-22", value: 79 },
        { date: "2026-07-23", value: 83 },
        { date: "2026-07-24", value: 81 },
        { date: DAY, value: 78 },
      ],
    },
    observations: [
      {
        kind: "workload",
        title: "Six open tasks against a four-hour day",
        detail:
          "Two carry today's deadline and one is already in review. The current mix leaves about 40 minutes for the third.",
        basis: "Open assignments and remaining scheduled hours",
        weight: 3,
        action: { label: "Open their task list", href: "/tasks?view=tasks" },
      },
      {
        kind: "unusual",
        title: "22 minutes idle before the crit",
        detail:
          "Longer than any other gap this week. It sits immediately before a meeting, which is the usual explanation.",
        basis: "Endpoint idle reports, compared with the trailing five days",
        weight: 2,
        action: null,
      },
      {
        kind: "suggestion",
        title: "Rework rate rose 4 points",
        detail:
          "One of two completions today came back for rework. A shorter review loop on the next submission would catch it earlier.",
        basis: "C1 · Task Execution events for this period",
        weight: 2,
        action: { label: "Open the score ledger", href: "/score/c1" },
      },
    ],
  },

  /* Jonas Weber — on a break, not sharing. Exercises the empty viewer. */
  "e-06": {
    presence: "break",
    onlineSecondsToday: 3 * 3600 + 5 * 60,
    currentActivity: null,
    currentTaskId: null,
    events: [
      evt(
        "attendance",
        "Signed in",
        "09:48, 18 minutes after schedule",
        9,
        48,
        1,
        {
          notable: true,
        },
      ),
      evt("application", "Notion", "Content model — task states", 9, 50, 62),
      evt("website", "cowork.internal", "Goals, C2 detail", 10, 52, 24),
      evt("task", "Started: Reversal copy review", "Timer running", 11, 16, 1, {
        href: "/tasks",
      }),
      evt("application", "Notion", "Reversal copy review", 11, 17, 71),
      evt("attendance", "Break", "Away from keyboard", 12, 28, 40),
      evt("application", "Slack", "#design", 13, 8, 19),
      evt("idle", "Idle", "No input detected", 13, 27, 38, { notable: true }),
    ],
    performance: {
      productivityScore: 71,
      provisional: true,
      trend: 2,
      activeSecondsToday: 2 * 3600 + 51 * 60,
      focusSecondsToday: 1 * 3600 + 34 * 60,
      tasksCompletedToday: 1,
      tasksOpen: 4,
      attendanceRate: 91,
      attendanceNote: "Two late starts this period",
    },
    device: {
      deviceName: "Jonas — ThinkPad X1",
      deviceModel: "ThinkPad X1 Carbon Gen 11",
      operatingSystem: "Windows 11 · 24H2",
      browser: "Edge 141",
      network: "Home broadband · Berlin",
      networkQuality: "degraded",
      latencyMs: 118,
      sharedSurface: null,
      displayCount: 1,
      lastSeenAt: at(13, 27),
    },
    summary: {
      stats: [
        { id: "active", label: "Active", value: "2h 51m", unit: null },
        { id: "focus", label: "Focus", value: "1h 34m", unit: null },
        { id: "done", label: "Completed", value: "1", unit: "task" },
        { id: "meetings", label: "In meetings", value: "0m", unit: null },
      ],
      completed: [
        {
          id: "c-3",
          title: "Reversal copy review",
          completedAt: at(12, 20),
          outcome: "late",
          href: "/tasks",
        },
      ],
      quality: [
        {
          id: "q-rework",
          label: "Rework rate",
          value: 8,
          unit: "%",
          betterWhen: "lower",
          trend: -3,
        },
        {
          id: "q-ontime",
          label: "On time",
          value: 76,
          unit: "%",
          betterWhen: "higher",
          trend: -5,
        },
        {
          id: "q-first",
          label: "First-pass approval",
          value: 81,
          unit: "%",
          betterWhen: "higher",
          trend: 1,
        },
      ],
      trend: [
        { date: "2026-07-20", value: 66 },
        { date: "2026-07-21", value: 68 },
        { date: "2026-07-22", value: 72 },
        { date: "2026-07-23", value: 69 },
        { date: "2026-07-24", value: 69 },
        { date: DAY, value: 71 },
      ],
    },
    observations: [
      {
        kind: "unusual",
        title: "Second late start this period",
        detail:
          "18 minutes after the scheduled start. C4 counts the period, not the day, so one more would move the component.",
        basis: "Attendance records against the work calendar",
        weight: 3,
        action: { label: "Open attendance", href: "/attendance" },
      },
      {
        kind: "workload",
        title: "No meetings today",
        detail:
          "The day is unbroken, which is the shape most of their focus time has come from this week.",
        basis: "Calendar and endpoint focus reports",
        weight: 1,
        action: null,
      },
    ],
  },
};

/** Anyone without a sample day gets a plain, honest "no feed" answer. */
const NO_FEED: SampleDay = {
  presence: "offline",
  onlineSecondsToday: 0,
  currentActivity: null,
  currentTaskId: null,
  events: [],
  performance: {
    productivityScore: 0,
    provisional: true,
    trend: 0,
    activeSecondsToday: 0,
    focusSecondsToday: 0,
    tasksCompletedToday: 0,
    tasksOpen: 0,
    attendanceRate: 0,
    attendanceNote: null,
  },
  device: {
    deviceName: "No device reporting",
    deviceModel: null,
    operatingSystem: "—",
    browser: "—",
    network: "—",
    networkQuality: "unknown",
    latencyMs: null,
    sharedSurface: null,
    displayCount: null,
    lastSeenAt: null,
  },
  summary: { stats: [], completed: [], quality: [], trend: [] },
  observations: [],
};

function dayFor(id: EmployeeId): SampleDay {
  return DAYS[id] ?? NO_FEED;
}

/* ── The provider surface the repository calls ────────────────────────────── */

export function monitoringSubject(employee: Employee): MonitoringSubject {
  const d = dayFor(employee.id);
  return subjectFor(
    employee,
    d.presence,
    d.onlineSecondsToday,
    d.currentActivity,
    d.currentTaskId,
  );
}

export function activityEvents(id: EmployeeId, limit: number): ActivityEvent[] {
  return dayFor(id)
    .events.map((e, i) => ({ ...e, id: `ae-${id}-${i}`, employeeId: id }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export function monitoringPerformance(id: EmployeeId): MonitoringPerformance {
  return { ...dayFor(id).performance, employeeId: id };
}

export function dailySummary(id: EmployeeId): DailySummary {
  return { ...dayFor(id).summary, employeeId: id, date: DAY };
}

export function deviceInfo(id: EmployeeId): DeviceInfo {
  return { ...dayFor(id).device, employeeId: id };
}

export function observations(id: EmployeeId): Observation[] {
  return dayFor(id)
    .observations.map((o, i) => ({ ...o, id: `ob-${id}-${i}`, employeeId: id }))
    .sort((a, b) => b.weight - a.weight);
}

/** Exported so the UI can label elapsed time against the same clock. */
export const MONITORING_NOW = NOW;

/* ── Manager intervention ─────────────────────────────────────────────────── */

/**
 * What needs the manager, composed from several places.
 *
 * A real deployment builds this the same way — the alerts come from task
 * workflow, the pending actions from the approval queue, the unusual activity
 * from whatever analyses the endpoint feed — which is why it is one repository
 * call rather than four. The composition is the backend's job; the panel's job
 * is to render it in a fixed order.
 */
const INTERVENTIONS: Record<
  string,
  Omit<InterventionItem, "id" | "employeeId">[]
> = {
  "e-02": [
    {
      group: "alert",
      title: "Two tasks hold priority 1",
      detail:
        "Empty-state copy pass and Reversal handling both sit at P1. Only one can be worked first.",
      basis: "Priority ranks on their open assignments",
      since: at(9, 40),
      severity: "high",
      action: { label: "Resolve the conflict", href: "/tasks?view=tasks" },
    },
    {
      group: "alert",
      title: "One task is overdue",
      detail: "Ledger view — reversal handling passed its deadline yesterday.",
      basis: "Deadline against the work calendar",
      since: at(9, 0),
      severity: "high",
      action: { label: "Open the task", href: "/tasks?view=tasks" },
    },
    {
      group: "unusual",
      title: "22 minutes idle before the crit",
      detail:
        "Longer than any other gap this week. It sits immediately before a meeting, which is the usual explanation.",
      basis: "Endpoint idle reports against the trailing five days",
      since: at(11, 15),
      severity: "normal",
      action: null,
    },
    {
      group: "pending",
      title: "Submission waiting on your review",
      detail:
        "Meeting notes template, submitted 13:43. Nothing has been decided.",
      basis: "Your review queue",
      since: at(13, 43),
      severity: "high",
      action: { label: "Review it", href: "/tasks?view=approvals" },
    },
    {
      group: "pending",
      title: "Deadline being negotiated",
      detail: "They have proposed a later date on Meeting notes template.",
      basis: "Open deadline proposals",
      since: at(12, 5),
      severity: "normal",
      action: { label: "Decide", href: "/tasks?view=approvals" },
    },
    {
      group: "issue",
      title: "Six open tasks against a four-hour day",
      detail:
        "Two carry today's deadline and one is already in review. The current mix leaves about 40 minutes for the third.",
      basis: "Open assignments and remaining scheduled hours",
      since: null,
      severity: "normal",
      action: { label: "Open their task list", href: "/tasks?view=tasks" },
    },
    {
      group: "issue",
      title: "Rework rate rose 4 points",
      detail:
        "One of two completions today came back for rework. A shorter review loop on the next submission would catch it earlier.",
      basis: "C1 · Task Execution events for this period",
      since: null,
      severity: "normal",
      action: { label: "Open the score ledger", href: "/score/c1" },
    },
  ],
  "e-06": [
    {
      group: "alert",
      title: "Second late start this period",
      detail:
        "18 minutes after the scheduled start. C4 counts the period, not the day, so one more would move the component.",
      basis: "Attendance records against the work calendar",
      since: at(9, 48),
      severity: "high",
      action: { label: "Open attendance", href: "/attendance" },
    },
    {
      group: "unusual",
      title: "38 minutes idle this afternoon",
      detail: "Still open. No input has been reported since 13:27.",
      basis: "Endpoint idle reports",
      since: at(13, 27),
      severity: "normal",
      action: null,
    },
    {
      group: "pending",
      title: "Nothing waiting on you",
      detail: "No submissions, proposals or approvals from this person.",
      basis: "Your review queue",
      since: null,
      severity: "normal",
      action: null,
    },
    {
      group: "issue",
      title: "One completion landed late",
      detail:
        "Reversal copy review closed after its deadline. On-time rate fell 5 points.",
      basis: "C1 · Task Execution events for this period",
      since: at(12, 20),
      severity: "normal",
      action: { label: "Open the score ledger", href: "/score/c1" },
    },
  ],
};

export function interventions(id: EmployeeId): InterventionItem[] {
  const order: InterventionGroup[] = ["alert", "unusual", "pending", "issue"];
  return (INTERVENTIONS[id] ?? [])
    .map((x, i) => ({ ...x, id: `iv-${id}-${i}`, employeeId: id }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/* ── The team, at a glance ────────────────────────────────────────────────── */

const TEAM_ROWS: Record<string, Omit<TeamMonitoringRow, keyof IdentityBits>> = {
  "e-02": {
    presence: "online",
    workloadPercent: 118,
    workloadBand: "overloaded",
    openTasks: 6,
    overdueTasks: 1,
    currentActivity: "Empty-state copy pass",
  },
  "e-06": {
    presence: "break",
    workloadPercent: 72,
    workloadBand: "balanced",
    openTasks: 4,
    overdueTasks: 0,
    currentActivity: null,
  },
};

type IdentityBits = Pick<
  TeamMonitoringRow,
  "employeeId" | "displayName" | "initials" | "hue"
>;

const NO_ROW: Omit<TeamMonitoringRow, keyof IdentityBits> = {
  presence: "offline",
  workloadPercent: 0,
  workloadBand: "light",
  openTasks: 0,
  overdueTasks: 0,
  currentActivity: null,
};

export function teamRow(employee: Employee): TeamMonitoringRow {
  return {
    employeeId: employee.id,
    displayName: employee.displayName,
    initials: employee.initials,
    hue: employee.hue,
    ...(TEAM_ROWS[employee.id] ?? NO_ROW),
  };
}

/**
 * Team totals.
 *
 * Every presence state and every workload band is listed, including the ones at
 * zero. A distribution that silently drops its empty categories cannot be read
 * as a distribution — "two online" means nothing without knowing the other
 * three states were counted and came to nothing.
 */
export function teamAnalytics(rows: TeamMonitoringRow[]): TeamAnalytics {
  const states: MonitoringSubject["presence"][] = [
    "online",
    "break",
    "emergency",
    "offline",
  ];
  const bands: TeamMonitoringRow["workloadBand"][] = [
    "light",
    "balanced",
    "heavy",
    "overloaded",
  ];

  let focus = 0;
  let active = 0;
  for (const r of rows) {
    const d = dayFor(r.employeeId);
    focus += d.performance.focusSecondsToday;
    active += d.performance.activeSecondsToday;
  }
  const idle = rows.reduce(
    (s, r) =>
      s +
      dayFor(r.employeeId)
        .events.filter((e) => e.kind === "idle")
        .reduce((t, e) => t + e.durationSecs, 0),
    0,
  );

  return {
    headcount: rows.length,
    presence: states.map((state) => ({
      state,
      count: rows.filter((r) => r.presence === state).length,
    })),
    workload: bands.map((band) => ({
      band,
      count: rows.filter((r) => r.workloadBand === band).length,
    })),
    focusSecs: focus,
    activeSecs: active,
    idleSecs: idle,
  };
}
