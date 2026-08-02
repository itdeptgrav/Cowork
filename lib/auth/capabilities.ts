import type { Capability } from "@/lib/domain";

/**
 * Every capability, in one list.
 *
 * The `Capability` union is the source of truth for the type; this is the
 * runtime companion the role editor iterates. Keeping it explicit rather than
 * deriving it means adding a capability to the union without adding it here is
 * a visible omission — a capability nobody can grant is worse than one that
 * does not exist, because the model claims it works.
 */
export const ALL_CAPABILITIES: Capability[] = [
  "task.view",
  "task.create",
  "task.edit",
  "task.cancel",
  "task.delete",
  "task.priority.change",
  "deadline.propose",
  "deadline.decide",
  "deadline.extend",
  "deadline.extension.decide",
  "submission.create",
  "review.decide",
  "review.rework",
  "review.second_stage",
  "score.view",
  "score.compare",
  "score.configure",
  "score.adjust",
  "conduct.apply",
  "conduct.review_dispute",
  "attendance.record",
  "people.view",
  "people.create",
  "people.deactivate",
  "people.delete",
  "people.reset_password",
  "people.change_role",
  "people.change_reporting",
  "project.create",
  "project.edit",
  "project.manage_members",
  "project.link_tasks",
  "project.archive",
  "group.manage",
  "meeting.manage",
  "integration.configure",
  "notification.broadcast",
];
