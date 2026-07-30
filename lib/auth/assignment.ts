import type { EmployeeId } from "@/lib/domain";
import {
  can,
  reachableIds,
  type Decision,
  type PermissionContext,
} from "./can.ts";

/**
 * Who may be given work, and what has to happen first.
 *
 * **One resolver, three consumers.** The assignee picker, `createTask`'s
 * validation, and the approval routing all call into this file. They used to
 * disagree — the picker offered every employee, the write refused most of them,
 * and the reader found out only on submit — and the fix is not to make the UI
 * copy the rule but to give both the same function to ask.
 *
 * ── What legacy actually did ────────────────────────────────────────────────
 *
 * `cowork-old-backend` restricts assignment to nobody. `/task/create`
 * (`routes/task_routes/taskForward.js:135`) is guarded by `verifyEmployeeToken`,
 * which admits any authenticated user, and its only role test is
 * `["ceo","tl","employee"].includes(requesterRole)` — a list containing every
 * role the product has, so it can never reject. `createTask` in the service
 * layer performs no check at all, and the old client
 * (`app/coworking/tasks/page.js:2168`) loads the whole employee collection into
 * the picker unfiltered.
 *
 * Legacy restricted nothing because it could not afford to. Its org chart was
 * unreliable enough to need a hardcoded fallback approver (`E000`) for people
 * with no manager on file, and a permission model keyed on that data would have
 * blocked real work every day. So it substituted CONSENT for PROHIBITION:
 * anyone may raise work for anyone, and a manager has to agree before the work
 * actually lands. That is the model reproduced here.
 *
 * ── The two gates ───────────────────────────────────────────────────────────
 *
 * `upward` — legacy set `pending_tl_approval` when an employee assigned to
 * somebody whose role was `tl`. Reproduced through `administrativeLevel` rather
 * than a role name, because a literal `role === "tl"` is exactly the hard-coded
 * hierarchy docs/architecture/PRODUCT.md forbids. The approver is the senior assignee themselves,
 * matching legacy's `/task/:taskId/approve`, which requires the approver to be
 * in `task.assigneeIds`.
 *
 * `cross_department` stays where it already lives, in `createTask` — it needs
 * the configured workflows and the department heads resolved against them, and
 * this file deliberately holds no store access.
 *
 * ── Scope is still real ─────────────────────────────────────────────────────
 *
 * The seeded roles grant `task.create` at `organisation`, which reproduces
 * legacy. They are DATA: an organisation that wants a stricter rule narrows the
 * scope in the role editor, and because the picker and the write both resolve
 * through here, both follow it the same day. Widening the default is not the
 * same as removing the check.
 */

export type AssignmentGate = "none" | "upward" | "cross_department";

/**
 * Which of the four relationships this assignment is.
 *
 * A single name for the whole situation, so the words shown to a reader are one
 * lookup rather than a chain of conditionals rebuilt in every component. Two
 * booleans describe four cases; naming them is what stops the fourth being
 * forgotten somewhere.
 */
export type AssignmentRelation =
  /** The creator is the only assignee. */
  | "self"
  /** Every assignee reports to the creator, directly or further down. */
  | "in_line"
  /** No reporting line, and a department boundary is crossed. */
  | "cross_department"
  /** No reporting line, no boundary — a peer, or somebody senior. */
  | "outside_line";

export interface AssignmentRelationship {
  /** The named case, for anything that has to explain itself. */
  relation: AssignmentRelation;
  /** Every assignee is the creator or sits beneath them in the reporting line. */
  insideHierarchy: boolean;
  /** A department boundary is crossed AND no reporting line spans it. */
  crossesDepartment: boolean;
  /** Budget inside the reporting line, a fixed date outside it. */
  deadlineMode: "timer" | "fixed";
}

/**
 * The relationship between a creator and their assignees.
 *
 * One function, because this was computed twice — once in `createTask` and once
 * in the new-task form — and both copies carried the same defect.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * `crossesDepartment` was a plain department comparison, and the deadline rule
 * read `crossesDepartment || !insideHierarchy`. So a department boundary
 * overrode a reporting line that genuinely spanned it. Priya manages Maya and
 * sits in a different department; assigning to her own direct report produced a
 * fixed deadline she could not negotiate, and raised a cross-department
 * approval asking two heads to sanction a manager giving work to her own
 * report.
 *
 * The direction of the hierarchy check was never wrong — the closure had Maya
 * beneath Priya correctly. The bug was that the department test was allowed to
 * speak over it.
 *
 * Legacy answered this the same way. Its cross-department gate skipped entirely
 * when `assignerIsTargetsManager` — "the assigner already IS that manager" —
 * so a reporting line beat the boundary there too.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A reporting line is what authority runs along; a department is where someone
 * sits. Sharing a department grants nothing, and crossing one takes nothing
 * away when a line already spans it. So the reporting line is checked first and
 * the department only matters where no line exists.
 */
export function assignmentRelationship(input: {
  creatorId: EmployeeId | null;
  assigneeIds: EmployeeId[];
  /** Transitive closure beneath the creator — `Viewer.hierarchyIds`. */
  hierarchyIds: EmployeeId[];
  /**
   * The creator's DIRECT reports — `Viewer.directReportIds`.
   *
   * Separate from the closure because the two answer different questions, and
   * conflating them was a real defect. Legacy skips the cross-department gate
   * only when the assigner is the target's `primaryManager` — one level, never
   * transitive (`taskForward.js:180`). The deadline model, by contrast, follows
   * the whole reporting line.
   */
  directReportIds: EmployeeId[];
  creatorDepartmentId: string | null;
  departmentOf: (id: EmployeeId) => string | null;
}): AssignmentRelationship {
  const { creatorId, assigneeIds, hierarchyIds, creatorDepartmentId } = input;

  /* Self counts as inside: you are trivially within your own reporting line,
     and a task you raise for yourself has no one else's authority to respect. */
  const insideHierarchy =
    assigneeIds.length > 0 &&
    assigneeIds.every((id) => id === creatorId || hierarchyIds.includes(id));

  const departmentsDiffer =
    !!creatorDepartmentId &&
    assigneeIds.some((id) => {
      const dept = input.departmentOf(id);
      return !!dept && dept !== creatorDepartmentId;
    });

  /* Only a DIRECT manager clears the boundary. Legacy's skip is
     `targetHrEmp.primaryManager.managerId.biometricId === requester` — the
     immediate manager and nobody else. A skip-level manager assigning across a
     department still needs both heads to agree: the departments have a say in
     work crossing between them, and being two levels up is not the same as
     being the person accountable for that individual.

     Note this is deliberately NOT `insideHierarchy`. The deadline model uses
     the full line; the approval gate uses one level. They are different
     questions and they had the same answer only by accident. */
  const isDirectManager =
    assigneeIds.length > 0 &&
    assigneeIds.every(
      (id) => id === creatorId || input.directReportIds.includes(id),
    );
  const crossesDepartment = departmentsDiffer && !isDirectManager;

  /* Which reduces the deadline rule to the thing it always meant: you negotiate
     a budget with people in your reporting line, and set a date for everybody
     else. `crossesDepartment` no longer appears here because it can no longer
     be true while `insideHierarchy` is. */
  const onlySelf =
    assigneeIds.length > 0 && assigneeIds.every((id) => id === creatorId);

  /* `relation` describes the DEADLINE story — which model applies and why — so
     it keys on the reporting line. Whether a gate also applies is a separate
     answer, given by `crossesDepartment`: a skip-level manager assigning across
     a department gets a budget AND two approvers, which is coherent and was
     expressible in legacy too. */
  const relation: AssignmentRelation = onlySelf
    ? "self"
    : insideHierarchy
      ? "in_line"
      : crossesDepartment
        ? "cross_department"
        : "outside_line";

  return {
    relation,
    insideHierarchy,
    crossesDepartment,
    deadlineMode: insideHierarchy ? "timer" : "fixed",
  };
}

/** The people this viewer may be offered as assignees. */
export function assignableIds(
  ctx: PermissionContext,
  candidates: EmployeeId[],
): EmployeeId[] {
  return reachableIds(ctx, "task.create", candidates);
}

/**
 * The reason this viewer may not assign to one of these people, or null.
 *
 * Returns the FIRST refusal rather than collecting them: the caller is deciding
 * whether to proceed, and the reader needs one sentence about one person, not a
 * list of everyone who failed.
 */
export function assignmentRefusal(
  ctx: PermissionContext,
  assigneeIds: EmployeeId[],
): Decision | null {
  for (const id of assigneeIds) {
    const decision = can(ctx, "task.create", id);
    if (!decision.allowed) return decision;
  }
  return null;
}

/**
 * Assignees senior to the creator, who must consent before the work reaches
 * them.
 *
 * Legacy gated only when the CREATOR was an employee and the assignee was a TL.
 * Generalising to "the assignee sits above the creator" keeps that case
 * identical and closes the one legacy left open — a team lead handing work
 * upward arrived unannounced, because the check named a role instead of
 * comparing standing.
 *
 * Self-assignment never gates: you do not need your own permission, and legacy
 * agreed — its gate ran over other people's roles, and a task you raise for
 * yourself has no one else to consult.
 */
export function upwardApprovers(
  ctx: PermissionContext,
  assigneeIds: EmployeeId[],
): EmployeeId[] {
  const mine = ctx.levelOf(ctx.viewer.employeeId);
  return assigneeIds.filter(
    (id) => id !== ctx.viewer.employeeId && ctx.levelOf(id) > mine,
  );
}

/**
 * Which gate applies, for a form that wants to say so before anything is saved.
 *
 * `crossesDepartment` is passed in rather than computed: departments are store
 * data and this file stays free of it, so the caller that already knows the
 * answer supplies it.
 */
export function assignmentGate(
  ctx: PermissionContext,
  assigneeIds: EmployeeId[],
  crossesDepartment: boolean,
): AssignmentGate {
  /* Cross-department first: it is the heavier gate, needing both department
     heads rather than one person, and a task that is both should be described
     by the requirement that is harder to satisfy. */
  if (crossesDepartment) return "cross_department";
  if (upwardApprovers(ctx, assigneeIds).length > 0) return "upward";
  return "none";
}
