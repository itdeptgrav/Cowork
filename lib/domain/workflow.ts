import type { EmployeeId, RoleId } from "./identity";

/**
 * Configurable approval workflows.
 *
 * This replaces the only approval logic the build had:
 *
 * ```ts
 * for (let i = 0; i < 3; i++) { ... }   // climb the reporting line, three times
 * ```
 *
 * That expressed exactly one flow, could not name its stages, could not route
 * to a department head, and could not vary by task type or by whether the work
 * crossed a department boundary. `Employee → Supervisor → HOD → Manager` was
 * not expressible, because nothing knew what an HOD was.
 *
 * The model here is deliberately small: a workflow is an ORDERED LIST OF
 * STAGES, and a stage says how to find its approver rather than naming a
 * person. Naming people in a workflow is what makes an org chart unmaintainable
 * — the rule survives a re-org, the name does not.
 *
 * Legacy's department approver was resolved by an unordered
 * `where(role == "tl").limit(1)` query, so a department with two team leads got
 * a coin flip. `department_hod` resolves to one named person or to nobody, and
 * "nobody" is a state the workflow has to handle rather than a silent skip.
 */

/** How a stage finds the person who must decide. */
export type ApproverRule =
  /** Walk up the primary reporting line from the subject. `levelsUp` says how far. */
  | "reporting_manager"
  /** The head of the subject's own department. */
  | "department_hod"
  /** The head of the department the work is going TO. Cross-department only. */
  | "target_department_hod"
  /**
   * The ASSIGNEE's own reporting manager — who accepts work entering their
   * team. Distinct from `target_department_hod`, and the reason it exists: a
   * department head who is also the assignee would otherwise be asked to
   * approve work being sent to themselves. The receiver is not an approval
   * authority over their own intake.
   */
  | "target_reporting_manager"
  /** Anyone holding a given role, within the subject's hierarchy. */
  | "role_holder"
  /** One named person. Escape hatch; survives no re-org, so it is last. */
  | "specific_person";

export interface ApprovalStage {
  id: string;
  /** Shown to people, and it is the organisation's own word — "HOD", "Supervisor". */
  name: string;
  /** 1-based. Stages run in this order; stage N+1 opens when N is approved. */
  order: number;
  rule: ApproverRule;
  /** `reporting_manager` only. 1 = direct manager, 2 = their manager, … */
  levelsUp: number | null;
  /** `role_holder` only. */
  roleId: RoleId | null;
  /** `specific_person` only. */
  employeeId: EmployeeId | null;
  /**
   * What happens when the rule resolves to nobody — an employee with no
   * manager, a department with no head.
   *
   * `skip` continues to the next stage; `block` stops and says so. Never
   * silently auto-approve: legacy's fallback chain quietly dropped gates when a
   * lookup failed, which is how work got approved by nobody at all.
   */
  onUnresolved: "skip" | "block";
  /**
   * What happens when the stage resolves to the very person who is asking.
   *
   * `block` is the default and the safe answer: for a stage that reviews
   * somebody's WORK, resolving to the subject means self-review, and legacy's
   * worst defect (P1) was exactly that.
   *
   * `satisfied` is for a stage that represents CONSENT rather than review. The
   * sending head of department agreeing to a cross-department request is
   * already agreeing by making it — blocking there means a head of department
   * can never assign outside their own department at all. Legacy handled the
   * same case the same way: "the assigner already IS that manager. Skip the
   * gate."
   */
  onSelfApproval?: "block" | "satisfied";
  /** Whether this stage may be waived by someone with a higher administrative level. */
  allowOverride: boolean;
}

/** What kind of decision this workflow governs. */
export type WorkflowTrigger =
  | "task_completion"
  | "self_assignment"
  | "cross_department"
  | "deadline_extension"
  | "effort_estimate";

export interface ApprovalWorkflow {
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
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  stages: ApprovalStage[];
  /**
   * Narrowing conditions. An empty list means "every case with this trigger".
   * The most specific matching workflow wins; ties break on `order`.
   */
  appliesTo: {
    /** Restrict to work originating in these departments. Empty = all. */
    departmentIds: string[];
    /** Only when the work crosses a department boundary. */
    crossDepartmentOnly: boolean;
  };
  /** Lower runs first when two workflows match the same case. */
  order: number;
  isActive: boolean;
  /** System workflows can be edited but not deleted — something must remain. */
  isSystem: boolean;
}

/**
 * A stage resolved against real people, ready to render or to act on.
 *
 * `approverId` is null when the rule found nobody; `blocked` says whether that
 * stops the chain. Keeping both means the UI can show "HOD — not set" rather
 * than silently shortening the chain, which is the failure mode legacy had.
 */
export interface ResolvedStage {
  stageId: string;
  name: string;
  order: number;
  approverId: EmployeeId | null;
  approverName: string | null;
  rule: ApproverRule;
  /** Why nobody was found, in the reader's language. Null when resolved. */
  unresolvedReason: string | null;
  /**
   * Set when a fallback answered instead of the rule's first choice — a
   * department with no head resolving to the person's own manager. Null when
   * the rule resolved directly.
   */
  resolvedVia: "manager" | null;
  blocked: boolean;
  /**
   * The stage needs no approver because the person it names is the person
   * asking. Distinct from `blocked` and from resolving to somebody: nobody has
   * to act, and nothing is missing.
   */
  selfSatisfied: boolean;
}
