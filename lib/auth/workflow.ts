import type {
  ApprovalStage,
  ApprovalWorkflow,
  Department,
  Employee,
  EmployeeId,
  ReportingRelationship,
  ResolvedStage,
  Role,
  WorkflowTrigger,
} from "@/lib/domain";

/**
 * Turning a configured workflow into a list of real people.
 *
 * This is what replaced `#reviewChainFor`, which was the whole approval engine:
 *
 * ```ts
 * for (let i = 0; i < 3; i++) {          // climb the reporting line
 *   const rel = reporting.find(r => r.employeeId === cur && !r.effectiveTo);
 *   if (!rel) break;                     // ← silently shortens the chain
 *   chain.push(rel.managerId);
 * }
 * ```
 *
 * Three problems, all of which this file exists to fix. The depth was a
 * literal. The stages had no names, so `Employee → Supervisor → HOD → Manager`
 * could not be described even if the depth had been configurable. And a missing
 * link ended the chain quietly — work could reach "fully approved" having been
 * seen by fewer people than the process required, with nothing recording that.
 *
 * Here an unresolved stage is a *state*: it carries a reason, and the workflow
 * says whether to skip it or to block. Blocking is the default, because the
 * failure that matters is not "an approval is missing" — it is "an approval was
 * silently not required".
 */

export interface ResolveContext {
  employees: Employee[];
  reporting: ReportingRelationship[];
  departments: Department[];
  roles: Role[];
}

/**
 * Pick the workflow for a case.
 *
 * Most specific wins: a workflow naming departments beats one that names none,
 * and a cross-department-only workflow beats a general one when the work does
 * cross. Ties break on `order`, then on id so the choice is never arbitrary —
 * legacy's approver lookup was an unordered `limit(1)`, which could return a
 * different answer for the same input on two consecutive calls.
 */
export function workflowFor(
  workflows: ApprovalWorkflow[],
  trigger: WorkflowTrigger,
  opts: { departmentId?: string | null; crossDepartment?: boolean } = {},
): ApprovalWorkflow | null {
  const matches = workflows
    .filter((w) => w.isActive && w.trigger === trigger)
    .filter((w) => {
      if (w.appliesTo.crossDepartmentOnly && !opts.crossDepartment)
        return false;
      if (w.appliesTo.departmentIds.length === 0) return true;
      return (
        !!opts.departmentId &&
        w.appliesTo.departmentIds.includes(opts.departmentId)
      );
    });

  if (matches.length === 0) return null;

  const specificity = (w: ApprovalWorkflow) =>
    (w.appliesTo.departmentIds.length > 0 ? 2 : 0) +
    (w.appliesTo.crossDepartmentOnly ? 1 : 0);

  return matches.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
  )[0];
}

/** Walk the primary reporting line `levels` steps up from `from`. */
function managerAbove(
  ctx: ResolveContext,
  from: EmployeeId,
  levels: number,
): EmployeeId | null {
  let cur: EmployeeId | null = from;
  for (let i = 0; i < levels; i++) {
    const rel: ReportingRelationship | undefined = ctx.reporting.find(
      (r) => r.employeeId === cur && !r.effectiveTo && r.type === "primary",
    );
    if (!rel) return null;
    cur = rel.managerId;
  }
  return cur;
}

function nameOf(ctx: ResolveContext, id: EmployeeId | null): string | null {
  if (!id) return null;
  return ctx.employees.find((e) => e.id === id)?.displayName ?? null;
}

/**
 * Resolve one stage against real people.
 *
 * `subjectId` is whose work it is. `targetDepartmentId` matters only for
 * cross-department stages — it is the department the work is going TO.
 */
export function resolveStage(
  ctx: ResolveContext,
  stage: ApprovalStage,
  subjectId: EmployeeId,
  targetDepartmentId?: string | null,
  /** The person the work is going to — for `target_reporting_manager`. */
  targetEmployeeId?: EmployeeId | null,
): ResolvedStage {
  const subject = ctx.employees.find((e) => e.id === subjectId) ?? null;
  let approverId: EmployeeId | null = null;
  let reason: string | null = null;
  /* Set when the rule's first choice was unavailable and a fallback answered
     instead — so the UI can say "their manager, standing in" rather than
     implying the department has a head it does not have. */
  let via: "manager" | null = null;

  switch (stage.rule) {
    case "reporting_manager": {
      const levels = stage.levelsUp ?? 1;
      approverId = managerAbove(ctx, subjectId, levels);
      if (!approverId) {
        reason =
          levels === 1
            ? "This person has no manager on record."
            : `This person has fewer than ${levels} levels above them.`;
      }
      break;
    }
    case "department_hod": {
      /* Head of department, then the person's own manager.
       *
       * Legacy resolved this as a CHAIN, not a single lookup:
       * `resolveDepartmentApprover` tried the department's lead, fell through to
       * the person's `primaryManager`, and only then to a default approver —
       * hard-failing just when all of them were absent. Stopping at the first
       * link means one unfilled field on a department record blocks every
       * crossing anybody in it tries to make, which is a configuration gap
       * presented as a refusal. */
      const dept = ctx.departments.find((d) => d.id === subject?.departmentId);
      approverId = dept?.hodEmployeeId ?? null;
      if (!dept) reason = "This person is not in a department.";
      else if (!approverId) {
        approverId = managerAbove(ctx, subjectId, 1);
        via = approverId ? "manager" : null;
        if (!approverId)
          reason = `${dept.name} has no head of department, and nobody in it has a manager on record.`;
      }
      break;
    }
    case "target_department_hod": {
      /* Same chain as the sending side — see `department_hod`. The receiving
         person's own manager can accept work on their behalf when their
         department has no head. */
      const dept = ctx.departments.find((d) => d.id === targetDepartmentId);
      approverId = dept?.hodEmployeeId ?? null;
      if (!approverId && targetDepartmentId) {
        const receiver = ctx.employees.find(
          (e) => e.departmentId === targetDepartmentId,
        );
        approverId = receiver ? managerAbove(ctx, receiver.id, 1) : null;
        via = approverId ? "manager" : null;
      }
      if (!targetDepartmentId) reason = "No receiving department.";
      else if (!dept) reason = "The receiving department no longer exists.";
      else if (!approverId)
        reason = `${dept.name} has no head of department, and nobody in it has a manager on record.`;
      break;
    }
    case "target_reporting_manager": {
      /* The assignee's manager. Never the assignee: being sent work is not
         authority to approve being sent it. */
      if (!targetEmployeeId) {
        reason = "No receiving person.";
        break;
      }
      approverId = managerAbove(ctx, targetEmployeeId, 1);
      if (!approverId)
        reason = "The person receiving this has no manager on record.";
      break;
    }
    case "role_holder": {
      const role = ctx.roles.find((r) => r.id === stage.roleId);
      approverId =
        ctx.employees.find(
          (e) =>
            e.id !== subjectId &&
            stage.roleId &&
            e.roleIds.includes(stage.roleId),
        )?.id ?? null;
      if (!role) reason = "That role no longer exists.";
      else if (!approverId)
        reason = `Nobody currently holds ${role.displayName}.`;
      break;
    }
    case "specific_person": {
      approverId = stage.employeeId;
      if (!approverId) reason = "No person is set on this stage.";
      else if (!ctx.employees.some((e) => e.id === approverId)) {
        reason = "That person is no longer here.";
        approverId = null;
      }
      break;
    }
  }

  /* Nobody reviews their own work. This held in the old walk too and it is the
     one rule that survives every configuration — a workflow that resolved to
     the subject would hand them their own C1 credit.

     The exception is a stage that records CONSENT rather than review. A head of
     department asking for cross-department work has already given the sending
     department's consent by asking; refusing them means they can never assign
     outside their own department, which is not a control, it is a dead end. The
     stage says which kind it is, and the default is the strict one. */
  let selfSatisfied = false;
  if (approverId === subjectId) {
    if (stage.onSelfApproval === "satisfied") {
      selfSatisfied = true;
      approverId = null;
    } else {
      approverId = null;
      reason = "This would make the person their own approver.";
    }
  }

  return {
    stageId: stage.id,
    name: stage.name,
    order: stage.order,
    approverId,
    approverName: nameOf(ctx, approverId),
    rule: stage.rule,
    unresolvedReason: reason,
    resolvedVia: via,
    selfSatisfied,
    blocked:
      approverId === null && !selfSatisfied && stage.onUnresolved === "block",
  };
}

/** Every stage of a workflow, in order, resolved. */
export function resolveWorkflow(
  ctx: ResolveContext,
  workflow: ApprovalWorkflow,
  subjectId: EmployeeId,
  targetDepartmentId?: string | null,
  targetEmployeeId?: EmployeeId | null,
): ResolvedStage[] {
  return [...workflow.stages]
    .sort((a, b) => a.order - b.order)
    .map((st) =>
      resolveStage(ctx, st, subjectId, targetDepartmentId, targetEmployeeId),
    );
}

/**
 * The approver chain a submission actually runs through.
 *
 * Skipped stages drop out; blocked stages stop the chain where they are. The
 * caller gets both the usable chain and whatever blocked it, because "this
 * cannot be submitted until Platform has a head of department" is a sentence
 * someone needs to read — not an empty array.
 */
export function approverChain(
  ctx: ResolveContext,
  workflow: ApprovalWorkflow | null,
  subjectId: EmployeeId,
  targetDepartmentId?: string | null,
  targetEmployeeId?: EmployeeId | null,
): {
  chain: EmployeeId[];
  stages: ResolvedStage[];
  blockedBy: ResolvedStage | null;
} {
  if (!workflow) return { chain: [], stages: [], blockedBy: null };

  const stages = resolveWorkflow(
    ctx,
    workflow,
    subjectId,
    targetDepartmentId,
    targetEmployeeId,
  );
  const blockedBy = stages.find((s) => s.blocked) ?? null;
  const upTo = blockedBy ? stages.slice(0, stages.indexOf(blockedBy)) : stages;

  /* De-duplicated: one person can satisfy two stages — a small department where
     the manager IS the head — and asking them to approve the same work twice is
     theatre, not control. */
  const chain: EmployeeId[] = [];
  for (const s of upTo) {
    if (s.approverId && !chain.includes(s.approverId)) chain.push(s.approverId);
  }

  return { chain, stages, blockedBy };
}
