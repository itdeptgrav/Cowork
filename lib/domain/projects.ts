/**
 * Projects — richer task containers that live INSIDE the Tasks area
 * (brief §7, §8). Never a separate top-level module.
 *
 * A Project is not a bare grouping. It is a managed initiative with owner,
 * members, status, dates, milestones, progress, health and activity (brief
 * §8.1). Cowork has no folder type: work is grouped by project, or broken down
 * with subtasks, and nothing else pretends to be a container.
 *
 * Projects must not duplicate task logic and must not create a second score.
 * Tasks and goals inside them remain the scoring units (brief §8.5).
 */

import type { EmployeeId } from "./identity";
import type { TaskId } from "./tasks";

export type ProjectId = string;

export type ProjectStatus =
  "planning" | "active" | "on_hold" | "completed" | "archived";

/** Derived from connected-task data, never entered by hand (brief §8.4). */
export type ProjectHealth = "on_track" | "at_risk" | "off_track" | "unknown";

export type ProjectRole = "owner" | "lead" | "member" | "viewer";

export interface ProjectMember {
  id: string;
  projectId: ProjectId;
  employeeId: EmployeeId;
  role: ProjectRole;
  addedAt: string;
  addedById: EmployeeId;
}

/** A task belongs to a project by LINK, so unlinking never deletes the task. */
export interface ProjectTaskLink {
  id: string;
  projectId: ProjectId;
  taskId: TaskId;
  linkedAt: string;
  linkedById: EmployeeId;
  milestoneId: string | null;
}

export interface ProjectMilestone {
  id: string;
  projectId: ProjectId;
  title: string;
  targetDate: string;
  completedAt: string | null;
  taskIds: TaskId[];
  order: number;
}

export type ProjectActivityType =
  | "created"
  | "status_changed"
  | "member_added"
  | "member_removed"
  | "task_linked"
  | "task_unlinked"
  | "milestone_added"
  | "milestone_completed"
  | "update_posted"
  | "archived";

export interface ProjectActivity {
  id: string;
  projectId: ProjectId;
  type: ProjectActivityType;
  actorId: EmployeeId | "system";
  actorLabel: string;
  summary: string;
  occurredAt: string;
}

export interface Project {
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
  id: ProjectId;
  reference: string;
  name: string;
  description: string | null;
  ownerId: EmployeeId;
  status: ProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  tags: string[];
  /** Optional. Project priority is presentational; it never feeds scoring. */
  priority: "high" | "normal" | "low" | null;
  /** Restricted projects are visible only to members plus authorised scope. */
  isRestricted: boolean;
  /**
   * "Taskgoal" — a DESCRIPTIVE marker that this project is oriented around a
   * measurable objective. Deliberately separate from the C2 goal task
   * (`Task.isGoal` / `goalConfig` / the roadmap): it carries no weightage, no
   * points, no roadmap steps, and nothing here feeds scoring. It only stores
   * and displays. Absent on every project that was not marked.
   *
   * The two must never be conflated — see `lib/rules/projects/goalBased.ts`.
   */
  isGoalBased?: boolean;
  goalBased?: GoalBasedConfig | null;
  createdById: EmployeeId;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * What KIND of goal a Taskgoal is — so the marker fits ANY goal, not only a
 * number to hit. Descriptive; nothing branches on it beyond which fields are
 * worth showing.
 *
 *  · `numeric`     — a measurable target (120 → 500 users). The metric/unit and
 *                    the start/target numbers apply.
 *  · `milestone`   — a thing to ship or land ("Launch v2"). Done or not.
 *  · `qualitative` — an outcome judged by description ("Improve onboarding").
 *  · `other`       — anything that does not fit the three above.
 */
export type GoalKind = "numeric" | "milestone" | "qualitative" | "other";

/**
 * The objective behind a "Taskgoal" project. Descriptive only.
 *
 * NOT the C2 goal config: no `weightPercent`, no `maximumPoints`, no roadmap.
 * Just what the project is aiming at, for display.
 *
 * **Works for any goal type**, not only a numeric target. The `numeric` fields
 * (`metric`/`unit`/`targetValue`/`startValue`) apply when `goalType` is
 * `numeric`; every other type leans on `successCriteria` and `currentStatus`
 * instead. All of it is optional except the objective.
 */
export interface GoalBasedConfig {
  /** The outcome, in one line. The one field a Taskgoal must have. */
  objective: string;
  /** Which kind of goal this is. Defaults to `numeric` on older records. */
  goalType: GoalKind;
  /** How you will know it is achieved — the definition of done, in words.
      Carries a non-numeric goal the way the numbers carry a numeric one. */
  successCriteria: string | null;
  /** Where it stands now, in words — the baseline for a goal with no number. */
  currentStatus: string | null;
  /** What is measured — "Active users". Numeric goals. Optional. */
  metric: string | null;
  /** A unit for the numbers — "%", "users". Numeric goals. Optional. */
  unit: string | null;
  /** The number to reach. Numeric goals. Optional. */
  targetValue: number | null;
  /** Where it starts, so a reader can see the distance. Numeric goals. Optional. */
  startValue: number | null;
}

/**
 * Computed, never stored as a source of truth.
 *
 * PROVISIONAL RULE — the weighting between completion, milestones and overdue
 * items is unresolved (brief §8.4). See `lib/config/provisional.ts`.
 */
export interface ProjectProgress {
  projectId: ProjectId;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  inReviewTasks: number;
  reworkCount: number;
  totalMilestones: number;
  completedMilestones: number;
  /** 0–100. Derived. */
  progressPercent: number;
  health: ProjectHealth;
  nextDeadline: string | null;
  /** Which provisional rule produced `progressPercent`. */
  ruleId: string;
  ruleLabel: string;
}
