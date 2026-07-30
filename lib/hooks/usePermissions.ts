"use client";

import { useQuery } from "./useRepository";
import {
  can,
  scopeFor,
  type Decision,
  type PermissionContext,
} from "@/lib/auth/can";
import type { Capability, EmployeeId, Scope } from "@/lib/domain";

/**
 * The viewer's permissions, for the UI.
 *
 * A component asking "may I show this button" and the repository asking "may I
 * perform this write" must reach the same answer from the same rules, so this
 * builds the identical `PermissionContext` the repository builds and calls the
 * identical `can()`.
 *
 * **This is presentation, not enforcement.** Hiding a control is a courtesy;
 * the repository refuses the write regardless. Anything that relies on the
 * button being absent has the security model backwards — which is exactly the
 * legacy defect where the frontend hid the Office Monitor nav item and the
 * route behind it had no check at all.
 */
export interface Permissions {
  ready: boolean;
  can: (capability: Capability, targetId?: EmployeeId) => boolean;
  /** The full decision, when the reason needs rendering. */
  check: (capability: Capability, targetId?: EmployeeId) => Decision;
  scopeFor: (capability: Capability) => Scope | null;
  employeeId: EmployeeId | null;
  administrativeLevel: number;
  /**
   * The resolved context, for the shared resolvers in `lib/auth/`.
   *
   * Exposed so a component that needs a rule beyond a yes/no — which assignees
   * will trigger an approval, say — calls the same function the repository
   * calls rather than reimplementing it locally. Null until the queries land.
   */
  ctx: PermissionContext | null;
}

const DENY_ALL: Decision = {
  allowed: false,
  reason: "no_capability",
  scope: null,
  message: "Loading your permissions.",
};

export function usePermissions(): Permissions {
  const viewer = useQuery((r) => r.getViewer(), []);
  const roles = useQuery((r) => r.listRoles(), []);
  const people = useQuery((r) => r.listEmployees(), []);

  const ready = !!viewer.data && !!roles.data && !!people.data;

  if (!ready) {
    return {
      ready: false,
      can: () => false,
      check: () => DENY_ALL,
      scopeFor: () => null,
      employeeId: viewer.data?.employeeId ?? null,
      administrativeLevel: 0,
      ctx: null,
    };
  }

  const v = viewer.data!;
  const allRoles = roles.data!;
  const allPeople = people.data!;

  const levelOf = (id: EmployeeId) => {
    const emp = allPeople.find((e) => e.id === id);
    if (!emp) return 0;
    const levels = allRoles
      .filter((r) => emp.roleIds.includes(r.id))
      .map((r) => r.administrativeLevel);
    return levels.length ? Math.max(...levels) : 0;
  };

  const ctx: PermissionContext = {
    viewer: v,
    roles: allRoles,
    directReportIds: v.directReportIds,
    hierarchyIds: v.hierarchyIds,
    levelOf,
  };

  return {
    ready: true,
    can: (capability, targetId) => can(ctx, capability, targetId).allowed,
    check: (capability, targetId) => can(ctx, capability, targetId),
    scopeFor: (capability) => scopeFor(ctx, capability),
    employeeId: v.employeeId,
    administrativeLevel: v.administrativeLevel,
    ctx,
  };
}

/**
 * The acting employee's id.
 *
 * Nine components had `"e-01"` written into them — the seeded viewer's id — so
 * they answered for that person no matter who the app was acting as. The score
 * pill showed Maya's score to everybody, task actions asked whether Maya was
 * the assignee, and the approval filter looked for approvals addressed to Maya.
 * None of that is visible until you can be somebody else, which is exactly what
 * the profile switcher made possible.
 */
export function useViewerId(): EmployeeId | null {
  const viewer = useQuery((r) => r.getViewer(), []);
  return viewer.data?.employeeId ?? null;
}
