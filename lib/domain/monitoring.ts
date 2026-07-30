import type { EmployeeId } from "./identity";

/**
 * Live monitoring contracts.
 *
 * Six independent feeds, deliberately kept apart rather than folded into one
 * "monitoring blob": a screen track comes from LiveKit, presence from the
 * status store, activity from an endpoint agent, performance from the scoring
 * engine, device facts from the client, and observations from whatever computes
 * them. They will arrive from different systems, at different rates, and will
 * fail independently — so each is its own repository call and each surface can
 * render loading, empty and error on its own.
 *
 * Nothing in this file is derived in the UI. Every figure is a value the
 * provider states, because a monitoring surface that computes its own numbers
 * from a partial feed will confidently show a manager something untrue.
 *
 * **Two boundaries are product constraints, not implementation details.**
 *
 *  1. Music and video listening are never monitoring inputs. Cowork's music
 *     surface is explicitly excluded from performance scoring, attendance,
 *     timers and manager monitoring, so `ActivityEvent` has no category for it
 *     and a provider must not emit one.
 *  2. Nothing here is framed as machine intelligence. `Observation` carries a
 *     stated basis so a manager reads a claim and the evidence for it, rather
 *     than a verdict from a system they cannot interrogate.
 */

/* ── Presence and identity ────────────────────────────────────────────────── */

/** Mirrors the employee-side status system; the manager reads it, never sets it. */
export type MonitoredPresence = "online" | "break" | "emergency" | "offline";

export interface MonitoringSubject {
  employeeId: EmployeeId;
  displayName: string;
  initials: string;
  hue: 0 | 1 | 2 | 3 | 4 | 5;
  departmentName: string | null;
  designation: string | null;
  /**
   * The realtime identity this person publishes under. The viewer matches
   * screen tracks against it, so the panel never shows one person's screen
   * under another person's name.
   */
  presenceIdentity: string;
  presence: MonitoredPresence;
  /** Epoch ms the current presence state began, or null when never started. */
  presenceSince: string | null;
  /** Seconds online today, across sessions. Stated by the provider. */
  onlineSecondsToday: number;
  /** What they are working on right now, in their own task's words. */
  currentActivity: string | null;
  currentTaskId: string | null;
  /** Local wall-clock zone, so a manager reads "their 4pm", not theirs. */
  timezone: string;
}

/* ── Activity timeline ────────────────────────────────────────────────────── */

/**
 * The kinds of event the timeline can show.
 *
 * `website` and `application` come from an endpoint agent that does not exist
 * yet; `task`, `meeting` and `attendance` come from Cowork itself. `idle` is a
 * gap the agent reports, not a gap the UI infers from missing events — absence
 * of data is not evidence of absence.
 */
export type ActivityKind =
  "website" | "application" | "task" | "meeting" | "attendance" | "idle";

export interface ActivityEvent {
  id: string;
  employeeId: EmployeeId;
  kind: ActivityKind;
  /** Short subject: a domain, an app name, a task title. */
  label: string;
  /** One line of context. Never required to understand the row. */
  detail: string | null;
  startedAt: string;
  /** Null while the event is still open. */
  endedAt: string | null;
  durationSecs: number;
  /** Whether the provider considers this event notable enough to stand out. */
  notable: boolean;
  /** Deep link into Cowork when the event is a Cowork object. */
  href: string | null;
}

/* ── Performance ──────────────────────────────────────────────────────────── */

export interface MonitoringPerformance {
  employeeId: EmployeeId;
  /**
   * The C1–C4 composite, as the scoring engine states it. Provisional while the
   * weights are undecided — the flag travels with the number so the UI can say
   * so rather than presenting it as settled.
   */
  productivityScore: number;
  provisional: boolean;
  /** Change against the previous comparable period, in points. */
  trend: number;
  activeSecondsToday: number;
  /** Uninterrupted work, as the provider defines it. */
  focusSecondsToday: number;
  tasksCompletedToday: number;
  tasksOpen: number;
  /** Percentage of expected working days attended in the current period. */
  attendanceRate: number;
  attendanceNote: string | null;
}

/* ── Daily summary ────────────────────────────────────────────────────────── */

export interface CompletedItem {
  id: string;
  title: string;
  /** When it landed, ISO. */
  completedAt: string;
  /** Whether it needed rework or an extension — C1 signal, not a verdict. */
  outcome: "on_time" | "late" | "reworked" | "extended";
  href: string | null;
}

export interface QualityMetric {
  id: string;
  label: string;
  value: number;
  /** `%`, `×`, or a bare count. */
  unit: string;
  /** Direction that counts as better, so the trend arrow can mean something. */
  betterWhen: "higher" | "lower";
  trend: number;
}

export interface DailySummary {
  employeeId: EmployeeId;
  date: string;
  /** Headline counts for today, in the order the provider wants them read. */
  stats: { id: string; label: string; value: string; unit: string | null }[];
  completed: CompletedItem[];
  quality: QualityMetric[];
  /** Daily productivity readings for a short trailing window, oldest first. */
  trend: { date: string; value: number }[];
}

/* ── Device ───────────────────────────────────────────────────────────────── */

export type NetworkQuality = "good" | "degraded" | "poor" | "unknown";

export interface DeviceInfo {
  employeeId: EmployeeId;
  deviceName: string;
  deviceModel: string | null;
  operatingSystem: string;
  browser: string;
  /** Coarse location string as reported. Never a precise coordinate. */
  network: string;
  networkQuality: NetworkQuality;
  /** Round-trip latency in ms, or null when the provider has no reading. */
  latencyMs: number | null;
  /** The screen the employee agreed to share, verified at capture. */
  sharedSurface: "entire_screen" | "window" | "browser_tab" | null;
  displayCount: number | null;
  lastSeenAt: string | null;
}

/* ── Observations ─────────────────────────────────────────────────────────── */

export type ObservationKind = "suggestion" | "unusual" | "workload";

/**
 * A stated observation about the working day.
 *
 * `basis` is required. docs/architecture/PRODUCT.md pins that Cowork is not an AI product and
 * must not be framed as one, and the honest form of that constraint is that
 * every claim shown to a manager carries the measurement it came from — a
 * manager can then disagree with the evidence rather than with an oracle.
 */
export interface Observation {
  id: string;
  employeeId: EmployeeId;
  kind: ObservationKind;
  title: string;
  detail: string;
  /** What the claim is computed from, in one line. */
  basis: string;
  /** Higher is more worth reading. Used for ordering only. */
  weight: number;
  /** An action the manager can take from here, when one exists. */
  action: { label: string; href: string } | null;
}

/* ── Manager intervention ─────────────────────────────────────────────────── */

/**
 * The four things a manager's intervention panel answers, in reading order.
 *
 * They are one list rather than four feeds because the question is "what needs
 * me", and a manager should not have to check four places to answer it. The
 * group travels on the item so the panel can section them without deciding
 * which is which — that judgement belongs to whatever composes the list.
 */
export type InterventionGroup = "alert" | "unusual" | "pending" | "issue";

export interface InterventionItem {
  id: string;
  employeeId: EmployeeId;
  group: InterventionGroup;
  title: string;
  detail: string;
  /** What the claim rests on. Required, for the reason `Observation` gives. */
  basis: string;
  /** ISO, when this started mattering. Null when it has no start. */
  since: string | null;
  /** `high` earns the state wash; everything else stays neutral. */
  severity: "high" | "normal";
  action: { label: string; href: string } | null;
}

/* ── The team, at a glance ────────────────────────────────────────────────── */

/** How committed someone is, as a band rather than a false-precision number. */
export type WorkloadBand = "light" | "balanced" | "heavy" | "overloaded";

export interface TeamMonitoringRow {
  employeeId: EmployeeId;
  displayName: string;
  initials: string;
  hue: 0 | 1 | 2 | 3 | 4 | 5;
  presence: MonitoredPresence;
  /** Share of the person's committed capacity, 0–100+. Stated, not derived. */
  workloadPercent: number;
  workloadBand: WorkloadBand;
  openTasks: number;
  overdueTasks: number;
  currentActivity: string | null;
}

export interface TeamAnalytics {
  headcount: number;
  /** Every state appears, including the ones at zero — a missing state reads
   *  as "nobody is offline" only if the reader knows the list was complete. */
  presence: { state: MonitoredPresence; count: number }[];
  workload: { band: WorkloadBand; count: number }[];
  /** Today's totals across the team, in seconds. */
  focusSecs: number;
  activeSecs: number;
  idleSecs: number;
}
