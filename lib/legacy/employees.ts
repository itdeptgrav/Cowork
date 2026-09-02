import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";
import { type LegacyRole, readRole } from "./permissions.ts";
import { type BiometricId, biometricId } from "./wire.ts";

/**
 * The employee directory and the reporting hierarchy, from legacy.
 *
 * **Two sources, and the split matters.**
 *
 * The directory is Firestore `cowork_employees`, served by
 * `GET /cowork/employee/list`. It carries the role, the department string and
 * the Cowork identity.
 *
 * The hierarchy is MongoDB `Employee.primaryManager` / `secondaryManager`,
 * served by `GET /cowork/employee/my-managers/:employeeId`, which bridges to
 * Mongo by `biometricId`. **A Cowork employee need not have an HR record at
 * all** — the endpoint answers with `success: true` and null managers, and that
 * is a real state, not a failure.
 *
 * Nothing here creates or caches a second copy of an employee. The engine's
 * list is the list.
 */

/* ── Directory ────────────────────────────────────────────────────────────── */

/** A `cowork_employees` document, as the engine returns it. */
export interface LegacyEmployeeDoc {
  /** Firestore document id. */
  id?: string;
  employeeId?: string;
  authUid?: string;
  name?: string;
  email?: string;
  mobile?: string;
  city?: string;
  department?: string;
  role?: string;
  profilePicUrl?: string | null;
  fcmTokens?: string[];
  createdAt?: unknown;
  passwordChanged?: boolean;
  /** Stripped by the engine on list responses. Never render it. */
  tempPassword?: string;
}

export interface LegacyEmployee {
  employeeId: BiometricId;
  name: string;
  email: string | null;
  mobile: string | null;
  department: string | null;
  role: LegacyRole;
  avatarUrl: string | null;
  authUid: string | null;
  /** True while the person is still on the engine's temporary password. */
  pendingFirstSignIn: boolean;
}

/**
 * One directory row.
 *
 * `employeeId` falls back to the Firestore document id because the engine seeds
 * the CEO record at document id `E000` and the two are the same value there.
 * A row with neither is unusable and is dropped by `readEmployees` rather than
 * rendered as a person with no identity.
 */
export function readEmployee(doc: LegacyEmployeeDoc): LegacyEmployee | null {
  const id = doc.employeeId ?? doc.id;
  if (!id) return null;

  return {
    employeeId: biometricId(id),
    name: doc.name?.trim() || id,
    email: doc.email?.trim() || null,
    mobile: doc.mobile?.trim() || null,
    department: doc.department?.trim() || null,
    role: readRole(doc.role),
    avatarUrl: doc.profilePicUrl || null,
    authUid: doc.authUid || null,
    pendingFirstSignIn: doc.passwordChanged === false,
  };
}

export function readEmployees(
  docs: readonly LegacyEmployeeDoc[],
): LegacyEmployee[] {
  return docs
    .map(readEmployee)
    .filter((e): e is LegacyEmployee => e !== null);
}

/**
 * The full directory. `GET /cowork/employee/list` — **CEO or TL only**.
 *
 * The engine caches this list server-side on its own TTL, so a newly created
 * employee may not appear immediately. That is the engine's behaviour and is
 * left alone; a client-side cache on top would only widen the window.
 */
export async function listEmployees(
  token: string,
): Promise<LegacyResult<LegacyEmployee[]>> {
  const r = await legacyFetch<LegacyEmployeeDoc[]>({
    path: "/cowork/employee/list",
    envelopeKey: "employees",
    token,
  });
  return r.ok ? { ok: true, data: readEmployees(r.data) } : r;
}

/**
 * The directory as an ordinary employee sees it.
 *
 * `GET /cowork/employee/list-members` is the endpoint that is not gated to
 * CEO/TL. A screen available to everybody must use this one, or it will render
 * an empty list with a permission error for most of the company.
 */
export async function listMembers(
  token: string,
): Promise<LegacyResult<LegacyEmployee[]>> {
  const r = await legacyFetch<LegacyEmployeeDoc[]>({
    path: "/cowork/employee/list-members",
    envelopeKey: "employees",
    token,
    /* The directory is the same bytes between reads far more often than not,
       and every feature that resolves a name or an avatar fetches it — the 99%
       duplicate traffic. Revalidating lets an unchanged copy come back as a
       304; the route sets the ETag. Freshness is unaffected: the request still
       goes out every time and a real change still returns the new list. */
    revalidate: true,
  });
  return r.ok ? { ok: true, data: readEmployees(r.data) } : r;
}

/** One employee. `GET /cowork/employee/:id`. */
export async function getEmployee(input: {
  token: string;
  employeeId: string;
}): Promise<LegacyResult<LegacyEmployee>> {
  const r = await legacyFetch<LegacyEmployeeDoc>({
    path: `/cowork/employee/${encodeURIComponent(input.employeeId)}`,
    envelopeKey: "employee",
    token: input.token,
  });
  if (!r.ok) return r;

  const employee = readEmployee(r.data);
  return employee
    ? { ok: true, data: employee }
    : {
        ok: false,
        error: {
          message: "That employee record is missing its identifier.",
          status: 0,
          kind: "malformed",
        },
      };
}

/* ── Hierarchy ────────────────────────────────────────────────────────────── */

/** A manager as `my-managers` returns them, after Mongo population. */
export interface LegacyManagerDoc {
  name?: string;
  biometricId?: string;
  department?: string;
  designation?: string;
  jobTitle?: string;
  phone?: string;
  email?: string;
  profilePhoto?: string | null;
}

export interface LegacyManager {
  employeeId: BiometricId;
  name: string;
  department: string | null;
  designation: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Somebody's reporting lines.
 *
 * `inHrSystem: false` is the case worth designing for. It means the person
 * exists in Cowork but has no MongoDB `Employee` row, so they have no managers,
 * no department of record, no attendance and no SOP ledger. The engine reports
 * this as a success with a message, and a UI that renders it as "no managers"
 * tells somebody their reporting line is empty when the truth is that their HR
 * record is missing. Those need different words.
 */
export interface LegacyHierarchy {
  employeeId: BiometricId;
  primaryManager: LegacyManager | null;
  secondaryManager: LegacyManager | null;
  inHrSystem: boolean;
}

interface MyManagersResponse {
  success?: boolean;
  primaryManager?: LegacyManagerDoc | null;
  secondaryManager?: LegacyManagerDoc | null;
  message?: string;
}

export function readManager(
  doc: LegacyManagerDoc | null | undefined,
): LegacyManager | null {
  if (!doc?.biometricId) return null;
  return {
    employeeId: biometricId(doc.biometricId),
    name: doc.name?.trim() || doc.biometricId,
    department: doc.department?.trim() || null,
    designation: doc.designation?.trim() || doc.jobTitle?.trim() || null,
    email: doc.email?.trim() || null,
    avatarUrl: doc.profilePhoto || null,
  };
}

/**
 * The marker legacy uses for somebody absent from HR.
 *
 * Matched on the message because the endpoint gives no other signal — it
 * returns `success: true` either way. Matched loosely, on the distinctive part
 * of the sentence, so a change in punctuation does not silently turn a missing
 * record back into "no managers".
 */
const NOT_IN_HR = /not found in hr/i;

export function readHierarchy(
  employeeId: string,
  response: MyManagersResponse,
): LegacyHierarchy {
  const primary = readManager(response.primaryManager);
  const secondary = readManager(response.secondaryManager);
  return {
    employeeId: biometricId(employeeId),
    primaryManager: primary,
    secondaryManager: secondary,
    inHrSystem: !NOT_IN_HR.test(response.message ?? ""),
  };
}

/** `GET /cowork/employee/my-managers/:employeeId`. */
export async function fetchHierarchy(input: {
  token: string;
  employeeId: string;
}): Promise<LegacyResult<LegacyHierarchy>> {
  const r = await legacyFetch<MyManagersResponse>({
    path: `/cowork/employee/my-managers/${encodeURIComponent(input.employeeId)}`,
    token: input.token,
  });
  return r.ok
    ? { ok: true, data: readHierarchy(input.employeeId, r.data) }
    : r;
}

/**
 * Direct reports, assembled from the directory and each person's managers.
 *
 * **Legacy has no endpoint for this.** It exposes "who are my managers" and
 * nothing in the other direction, so the legacy client walked the tree by
 * repeated traversal — which is why this takes a resolved list rather than
 * fetching. Keeping the fan-out at the call site makes the cost visible instead
 * of hiding N requests inside a helper.
 *
 * PRIMARY lines only, matching the new project's `closureOf()` and legacy's
 * effective behaviour. A secondary manager is an additional relationship, not a
 * second reporting line.
 */
export function directReports(input: {
  managerId: string;
  hierarchies: readonly LegacyHierarchy[];
}): BiometricId[] {
  return input.hierarchies
    .filter(
      (h) =>
        h.primaryManager?.employeeId === input.managerId &&
        h.employeeId !== input.managerId,
    )
    .map((h) => h.employeeId);
}

/**
 * The chain upward from somebody, nearest manager first.
 *
 * Stops on a cycle rather than looping. Legacy has **no constraint against
 * cycles or self-reporting** — nothing in the schema or the write paths
 * prevents A reporting to B reporting to A — so a walker that trusts the data
 * hangs the browser. The guard is not defensive programming; it is the
 * documented state of the data.
 */
export function reportingChain(input: {
  employeeId: string;
  hierarchies: readonly LegacyHierarchy[];
  maxDepth?: number;
}): BiometricId[] {
  const byId = new Map(input.hierarchies.map((h) => [String(h.employeeId), h]));
  const chain: BiometricId[] = [];
  const seen = new Set<string>([input.employeeId]);

  let current = input.employeeId;
  for (let i = 0; i < (input.maxDepth ?? 20); i++) {
    const manager = byId.get(current)?.primaryManager;
    if (!manager) break;
    const next = String(manager.employeeId);
    if (seen.has(next)) break;
    seen.add(next);
    chain.push(manager.employeeId);
    current = next;
  }
  return chain;
}
