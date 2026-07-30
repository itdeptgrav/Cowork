import type {
  Capability,
  EmployeeId,
  Permission,
  Role,
  Scope,
  Viewer,
} from "@/lib/domain";

/**
 * The permission decision. One function, one answer.
 *
 * **This is the layer the audit found missing.** `Capability`, `Scope`,
 * `Permission` and `administrativeLevel` were fully modelled and fully seeded,
 * and then consulted by nothing: the whole permission system appeared in two
 * files, the type definitions and the fixture. What actually guarded writes was
 * twenty hand-written identity comparisons scattered through the repository.
 *
 * Those comparisons are not wrong — they correctly block self-approval, which
 * is the critical legacy defect (P1). They are just not a system. They cannot
 * answer "may this person do that to that person", they encode no scope, and
 * they never read `administrativeLevel` — the field whose entire purpose is
 * making "a team lead resets the administrator's password" structurally
 * impossible rather than merely undocumented.
 *
 * Every decision here is `(capability, scope, actor, target)` and nothing else.
 * There are no role-name comparisons in this file, and there must never be one:
 * the moment code asks `role === "manager"`, roles have stopped being data and
 * docs/architecture/PRODUCT.md's "don't hard-code today's company" is broken again.
 */

export interface PermissionContext {
  viewer: Viewer;
  roles: Role[];
  /** Direct reports of the viewer. */
  directReportIds: EmployeeId[];
  /** Transitive closure beneath the viewer. */
  hierarchyIds: EmployeeId[];
  /** Administrative level per employee, highest role wins. */
  levelOf: (id: EmployeeId) => number;
}

export type DenyReason =
  "no_capability" | "out_of_scope" | "administrative_floor" | "inactive";

export interface Decision {
  allowed: boolean;
  reason: DenyReason | null;
  /** The widest scope the viewer holds for this capability, if any. */
  scope: Scope | null;
  /** Renderable explanation. Never a bare "denied". */
  message: string;
}

const ALLOW: Decision = {
  allowed: true,
  reason: null,
  scope: null,
  message: "",
};

/** Widest first: a viewer holding two scopes for one capability gets the wider. */
const SCOPE_RANK: Record<Scope, number> = {
  self: 0,
  direct_reports: 1,
  hierarchy: 2,
  organisation: 3,
};

/** Every permission the viewer holds, across all their roles. */
export function permissionsOf(ctx: PermissionContext): Permission[] {
  const held = ctx.roles.filter((r) =>
    ctx.viewer.roles.some((v) => v.id === r.id),
  );
  return held.flatMap((r) => r.permissions);
}

/** The widest scope the viewer holds for a capability, or null if they lack it. */
export function scopeFor(
  ctx: PermissionContext,
  capability: Capability,
): Scope | null {
  let best: Scope | null = null;
  for (const p of permissionsOf(ctx)) {
    if (p.capability !== capability) continue;
    if (best === null || SCOPE_RANK[p.scope] > SCOPE_RANK[best]) best = p.scope;
  }
  return best;
}

/** Does `scope` reach `targetId` from this viewer? */
function reaches(
  ctx: PermissionContext,
  scope: Scope,
  targetId: EmployeeId,
): boolean {
  if (targetId === ctx.viewer.employeeId) return true;
  switch (scope) {
    case "self":
      return false;
    case "direct_reports":
      return ctx.directReportIds.includes(targetId);
    case "hierarchy":
      return ctx.hierarchyIds.includes(targetId);
    case "organisation":
      return true;
  }
}

/**
 * Capabilities that act ON a person rather than on work.
 *
 * These are the ones the administrative floor guards. Legacy let a team lead
 * reset the chief executive's password and revoke their sessions
 * (`cowork.js:379`) because the check was "is this person a TL", never "is the
 * target above me". Scope alone does not prevent it — People Operations holds
 * `organisation` scope on `people.reset_password` quite legitimately — so the
 * floor is a separate, additional test.
 */
const PERSON_TARGETING: Capability[] = [
  "people.deactivate",
  "people.delete",
  "people.reset_password",
  "people.change_role",
  "people.change_reporting",
  "score.adjust",
  "conduct.apply",
];

/**
 * May the viewer exercise `capability` against `targetId`?
 *
 * `targetId` omitted means "against themselves or against nothing in
 * particular" — configuration capabilities such as `integration.configure` take
 * no target.
 */
export function can(
  ctx: PermissionContext,
  capability: Capability,
  targetId?: EmployeeId,
): Decision {
  const scope = scopeFor(ctx, capability);

  if (scope === null) {
    return {
      allowed: false,
      reason: "no_capability",
      scope: null,
      message: `Your role does not include ${label(capability)}.`,
    };
  }

  if (targetId === undefined) return { ...ALLOW, scope };

  if (!reaches(ctx, scope, targetId)) {
    return {
      allowed: false,
      reason: "out_of_scope",
      scope,
      message:
        scope === "self"
          ? `You can only ${label(capability)} for yourself.`
          : `${label(capability)} reaches ${scopeLabel(scope)}, and this person is outside it.`,
    };
  }

  /* The administrative floor. Applied AFTER scope, because it is a further
     restriction and never a grant: passing the floor never makes an
     out-of-scope target reachable. */
  if (
    PERSON_TARGETING.includes(capability) &&
    targetId !== ctx.viewer.employeeId
  ) {
    const mine = ctx.levelOf(ctx.viewer.employeeId);
    const theirs = ctx.levelOf(targetId);
    if (theirs >= mine) {
      return {
        allowed: false,
        reason: "administrative_floor",
        scope,
        message:
          "You cannot act on someone at or above your own administrative level.",
      };
    }
  }

  return { ...ALLOW, scope };
}

/** True/false when the reason is not needed. */
export function allowed(
  ctx: PermissionContext,
  capability: Capability,
  targetId?: EmployeeId,
): boolean {
  return can(ctx, capability, targetId).allowed;
}

/**
 * Which people the viewer may exercise a capability against.
 *
 * Used to scope a list before it is rendered, rather than rendering everything
 * and hiding rows — a filter in the UI is not a permission.
 */
export function reachableIds(
  ctx: PermissionContext,
  capability: Capability,
  candidates: EmployeeId[],
): EmployeeId[] {
  const scope = scopeFor(ctx, capability);
  if (scope === null) return [];
  return candidates.filter((id) => can(ctx, capability, id).allowed);
}

/* ── Presentation ─────────────────────────────────────────────────────────── */

export function scopeLabel(scope: Scope): string {
  return {
    self: "yourself only",
    direct_reports: "your direct reports",
    hierarchy: "everyone beneath you",
    organisation: "the whole organisation",
  }[scope];
}

/** `task.priority.change` → `change task priority`. Readable in a sentence. */
export function label(capability: Capability): string {
  const [group, ...rest] = capability.split(".");
  const action = rest.join(" ").replace(/_/g, " ");
  return `${action} ${group}`.trim();
}

/**
 * Capabilities with no implementation behind them yet.
 *
 * They are grantable — the model is complete and an organisation may want them
 * configured ahead of the feature — but nothing calls them. The role editor
 * marks them so an administrator is never told a switch does something it does
 * not. Removing an entry from this list is part of shipping the feature.
 */
export const INERT_CAPABILITIES: Capability[] = [
  "people.reset_password",
  "people.delete",
  "people.create",
  "people.deactivate",
  "notification.broadcast",
  "integration.configure",
  "score.adjust",
  "conduct.review_dispute",
];
