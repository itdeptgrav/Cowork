/**
 * Project progress and health, derived from connected-task data.
 *
 * Brief §8.4: progress must be DERIVED. A manually entered number may never
 * become the source of truth. The weighting between completion, milestones and
 * overdue items is unresolved, so the rule is provisional and labelled
 * everywhere it surfaces.
 */

import type {
  Project,
  ProjectHealth,
  ProjectMilestone,
  ProjectProgress,
  ReworkRequest,
  Task,
} from "@/lib/domain";
import { PROVISIONAL_RULES, provisionalNumber } from "@/lib/config/provisional";

const WEIGHT_TASKS = 0.6;
const WEIGHT_MILESTONES = 0.3;
const WEIGHT_OVERDUE_PENALTY = 0.1;

export function computeProgress(
  project: Project,
  tasks: Task[],
  milestones: ProjectMilestone[],
  reworks: ReworkRequest[],
  now: Date,
): ProjectProgress {
  const live = tasks.filter((t) => t.status !== "cancelled" && !t.deletedAt);
  const completed = live.filter((t) => t.status === "completed");
  const open = live.filter((t) => t.status !== "completed");
  const inReview = live.filter((t) => t.status === "in_review");
  const blocked = live.filter((t) => t.isBlocked);
  const overdue = live.filter(
    (t) =>
      t.status !== "completed" &&
      t.deadline.dueAt !== null &&
      new Date(t.deadline.dueAt) < now,
  );
  const completedMilestones = milestones.filter((m) => m.completedAt);
  const taskIds = new Set(live.map((t) => t.id));
  const reworkCount = reworks.filter((r) => taskIds.has(r.taskId)).length;

  const taskRatio = live.length ? completed.length / live.length : 0;
  const milestoneRatio = milestones.length
    ? completedMilestones.length / milestones.length
    : taskRatio;
  const overdueRatio = live.length ? overdue.length / live.length : 0;

  const raw =
    taskRatio * WEIGHT_TASKS +
    milestoneRatio * WEIGHT_MILESTONES -
    overdueRatio * WEIGHT_OVERDUE_PENALTY;

  const progressPercent =
    project.status === "completed"
      ? 100
      : Math.max(0, Math.min(100, Math.round(raw * 100)));

  const atRisk = provisionalNumber("projectHealthAtRiskPercent");
  const offTrack = provisionalNumber("projectHealthOffTrackPercent");
  const overduePercent = overdueRatio * 100;

  let health: ProjectHealth = "on_track";
  if (!live.length) health = "unknown";
  else if (project.status === "completed") health = "on_track";
  else if (overduePercent >= offTrack || blocked.length > 2)
    health = "off_track";
  else if (overduePercent >= atRisk || blocked.length > 0) health = "at_risk";

  const nextDeadline =
    open
      .map((t) => t.deadline.dueAt)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null;

  return {
    projectId: project.id,
    totalTasks: live.length,
    completedTasks: completed.length,
    openTasks: open.length,
    overdueTasks: overdue.length,
    blockedTasks: blocked.length,
    inReviewTasks: inReview.length,
    reworkCount,
    totalMilestones: milestones.length,
    completedMilestones: completedMilestones.length,
    progressPercent,
    health,
    nextDeadline,
    ruleId: "projectProgressRule",
    ruleLabel: PROVISIONAL_RULES.projectProgressRule.label,
  };
}
