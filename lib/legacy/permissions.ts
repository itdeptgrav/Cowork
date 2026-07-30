/**
 * Legacy's permission model, transcribed.
 *
 * The whole of it, from `Middlewear/coworkAuth.js`:
 *
 * ```js
 * const verifyCeoToken      = (req,res,next) => req.coworkUser?.role === "ceo" ? next() : 403;
 * const verifyCeoOrTL       = (req,res,next) => ["ceo","tl"].includes(req.coworkUser?.role) ? next() : 403;
 * const verifyEmployeeToken = (req,res,next) => req.coworkUser ? next() : 401;
 * ```
 *
 * Three predicates over one role string. That is the entire authorisation model
 * — there is no capability list, no scope, and no matrix. `verifyEmployeeToken`
 * is not a second authentication step; it only asserts that
 * `verifyCoworkToken` already populated the user, which is why the two appear
 * stacked on almost every route.
 *
 * **This module mirrors legacy; it does not improve on it.** The new project has
 * a richer model in `lib/auth/can.ts`, and using that here would produce a UI
 * that hides controls the engine would have allowed, or shows ones it refuses.
 * The rule while legacy is the source of truth: **ask this module what the
 * engine will do.**
 *
 * Role checks appear on only 92 of ~470 in-scope endpoints, so a `true` here
 * means "legacy will not refuse on role grounds" — not "this is safe". The
 * proxy routes carry the checks legacy omits.
 */

/** The complete set. Legacy compares these as bare strings. */
export type LegacyRole = "ceo" | "tl" | "employee";

export function isLegacyRole(value: unknown): value is LegacyRole {
  return value === "ceo" || value === "tl" || value === "employee";
}

/**
 * An unrecognised role reads as `employee`.
 *
 * The least privilege legacy grants to anybody it lets in. A role we do not
 * recognise must not be treated as more powerful than one we do — and legacy's
 * own predicates behave exactly this way, since anything that is not `"ceo"` or
 * `"tl"` falls through to the employee case.
 */
export function readRole(value: unknown): LegacyRole {
  return isLegacyRole(value) ? value : "employee";
}

/** `verifyCeoToken`. */
export function isCeo(role: unknown): boolean {
  return readRole(role) === "ceo";
}

/** `verifyCeoOrTL`. */
export function isCeoOrTl(role: unknown): boolean {
  const r = readRole(role);
  return r === "ceo" || r === "tl";
}

/**
 * `verifyEmployeeToken` — signed in at all.
 *
 * Takes the identity rather than the role, because that is what legacy checks:
 * the presence of `req.coworkUser`, not its contents.
 */
export function isAuthenticated(identity: unknown): boolean {
  return identity !== null && identity !== undefined;
}

/**
 * What the middleware on an endpoint requires.
 *
 * Named after legacy's own middleware so a call site can be checked against the
 * route file by eye.
 */
export type LegacyGate = "public" | "employee" | "ceo_or_tl" | "ceo";

export function allows(gate: LegacyGate, role: unknown): boolean {
  switch (gate) {
    case "public": return true;
    case "employee": return true;
    case "ceo_or_tl": return isCeoOrTl(role);
    case "ceo": return isCeo(role);
  }
}

/**
 * Why the engine will refuse, in legacy's own words, or null.
 *
 * The strings are copied verbatim from `coworkAuth.js` so that what the UI
 * predicts and what the network returns are the same sentence. A help article
 * or a support conversation that quotes one and receives the other is worse than
 * no prediction at all.
 */
export function gateRefusal(gate: LegacyGate, role: unknown): string | null {
  if (allows(gate, role)) return null;
  return gate === "ceo" ? "CEO only" : "CEO or TL only";
}

/**
 * Departmental scope, the one real constraint in the model.
 *
 * `POST /cowork/sop/bleach` enforces it: *"TL can only bleach employees in their
 * own department."* A CEO is unrestricted. It is checked per-endpoint in legacy
 * rather than centrally, so this is a helper for the endpoints that have it —
 * not a general rule.
 */
export function tlSharesDepartment(input: {
  actorRole: unknown;
  actorDepartment: string | null | undefined;
  targetDepartment: string | null | undefined;
}): boolean {
  if (isCeo(input.actorRole)) return true;
  if (!input.actorDepartment || !input.targetDepartment) return false;
  return input.actorDepartment === input.targetDepartment;
}

/**
 * Endpoints legacy leaves open that the proxy must close.
 *
 * Recorded as data so the proxy can assert against it and a reviewer can see the
 * list in one place. Each is authenticated but performs no authorisation:
 *
 * · `review-completion` — any employee can approve or reject any task, firing
 *   its C1 score.
 * · `change-role` / `change-department` — any employee can change anybody's,
 *   including their own. Privilege escalation.
 *
 * Two further routes (`force-repair-self-assign`, `self-assign-debug`) have no
 * middleware at all and are never to be proxied.
 */
export const UNGATED_LEGACY_ENDPOINTS: readonly {
  path: string;
  requiredGate: LegacyGate;
  reason: string;
}[] = [
  {
    path: "/cowork/task/:taskId/review-completion",
    requiredGate: "ceo_or_tl",
    reason:
      "Legacy performs no authorisation check; any employee could approve or reject any task and fire its score.",
  },
  {
    path: "/cowork/employee/:employeeId/change-role",
    requiredGate: "ceo",
    reason:
      "Legacy carries authentication only; any employee could change anybody's role, including their own.",
  },
  {
    path: "/cowork/employee/:employeeId/change-department",
    requiredGate: "ceo_or_tl",
    reason: "Legacy carries authentication only.",
  },
];

/** Paths that must never be reachable through the adapter. */
export const FORBIDDEN_LEGACY_PATHS: readonly string[] = [
  "/cowork/task/force-repair-self-assign",
  "/cowork/task/self-assign-debug",
];

export function isForbiddenPath(path: string): boolean {
  return FORBIDDEN_LEGACY_PATHS.some((p) => path.startsWith(p));
}
