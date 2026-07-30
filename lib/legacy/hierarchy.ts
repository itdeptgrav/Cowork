import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";

/**
 * The reporting tree, assembled from the only thing legacy will tell us.
 *
 * ## What legacy actually has
 *
 * **There is no org chart in Cowork.** Searching the old frontend for
 * "hierarchy" returns task hierarchy — parent tasks and subtasks — in every
 * case but one. The single employee-relationship surface is
 * `GET /cowork/employee/my-managers/:employeeId`, which the shell and the SOP
 * page both call to show one card: who my manager is.
 *
 * That endpoint is **upward, one level, one person at a time**. It returns
 * `{ primaryManager, secondaryManager }` and nothing else — no children, no
 * depth, no closure. Downward queries against `primaryManager.managerId` exist
 * in the monolith, but only under `/api/hr/*` and the leave module: a different
 * product behind a different credential, not reachable from Cowork's token.
 *
 * So a tree cannot be fetched. It can only be **derived**, by asking every
 * employee who their manager is and inverting the answers. That is what this
 * does, and it is why it is a separate module with its own cache rather than
 * something `getViewer` does quietly — N requests is a real cost and the caller
 * should be able to see where it is paid.
 *
 * ## Two ways a manager fails to resolve, and they differ
 *
 * The handler falls back to a bare `managerName` string when the Mongo
 * `ObjectId` reference is missing, returning `biometricId: ""`. So a manager
 * can be **named but unlinkable**. That is not the same as having no manager,
 * and the distinction survives here: `managerId` is null in both cases, but
 * `managerName` is set in the first. A tree cannot draw an edge to a name, but
 * a profile can still say who someone reports to.
 *
 * An employee absent from the HR system returns `success: true` with both
 * managers null — legacy treats "not in HR" as "no manager", not as an error,
 * and so does this.
 */

export interface LegacyManager {
  name: string;
  /** The Cowork employee id. **Empty when the HR record has only a name.** */
  biometricId: string;
  department: string;
  designation: string;
  email: string;
  profilePhotoUrl: string | null;
}

export interface LegacyManagers {
  primaryManager: LegacyManager | null;
  secondaryManager: LegacyManager | null;
}

/** `GET /cowork/employee/my-managers/:employeeId`. */
export async function fetchMyManagers(input: {
  token: string;
  employeeId: string;
}): Promise<LegacyResult<LegacyManagers>> {
  return legacyFetch<LegacyManagers>({
    path: `/cowork/employee/my-managers/${encodeURIComponent(input.employeeId)}`,
    token: input.token,
  });
}

/** One employee's place in the tree. */
export interface ReportingNode {
  employeeId: string;
  /** The primary manager's id, or null when there is none we can link to. */
  managerId: string | null;
  /** The primary manager's name, even when unlinkable. */
  managerName: string | null;
  /** The secondary manager's id, when linkable. Legacy's "dotted" line. */
  secondaryManagerId: string | null;
  secondaryManagerName: string | null;
  /** Direct reports, by primary line only. */
  directReportIds: string[];
  /** 0 for a root. Null when the chain cannot be resolved — see `readDepth`. */
  depth: number | null;
  /**
   * Whether this person is in the Cowork directory.
   *
   * False for a node inferred from somebody else's `primaryManager` — they
   * manage people but have no Cowork account, so they cannot sign in and have
   * no role. Distinguished because "manages eight people" and "is a Cowork
   * user" are different facts and a screen may need either.
   */
  isDirectoryMember: boolean;
}

export interface ReportingTree {
  byEmployee: Map<string, ReportingNode>;
  /** Everyone with no linkable primary manager. Usually one; not guaranteed. */
  rootIds: string[];
}

/**
 * Build the tree from per-employee manager answers.
 *
 * Pure, so the assembly is testable without a network.
 *
 * **Only the primary line forms the tree.** Secondary managers are recorded
 * because legacy stores them and a profile shows them, but they do not create
 * parent-child edges: a person with two managers would otherwise appear twice
 * in one tree and make depth ambiguous. Legacy's own `resolveDepartmentApprover`
 * consults the primary line alone, so this matches what the engine does.
 */
export function buildReportingTree(
  answers: Map<string, LegacyManagers>,
): ReportingTree {
  const byEmployee = new Map<string, ReportingNode>();

  for (const [employeeId, managers] of answers) {
    const primary = managers.primaryManager;
    const secondary = managers.secondaryManager;
    /* An empty `biometricId` means "named but unlinkable" — see the header.
       Treated as no edge, but the name is kept. */
    const managerId = primary?.biometricId ? primary.biometricId : null;
    byEmployee.set(employeeId, {
      employeeId,
      /* A record naming itself as its own manager is discarded rather than
         trusted: it would be a self-loop, and `readDepth` would report the
         whole branch unresolvable. Bad data, contained to one edge. */
      managerId: managerId === employeeId ? null : managerId,
      managerName: primary?.name || null,
      secondaryManagerId:
        secondary?.biometricId && secondary.biometricId !== employeeId
          ? secondary.biometricId
          : null,
      secondaryManagerName: secondary?.name || null,
      directReportIds: [],
      depth: null,
      isDirectoryMember: true,
    });
  }

  /* **A manager named by an edge is a node, even if we never asked about
     them.**

     `answers` covers the Cowork directory; the HR records it joins to can name
     a manager who has no Cowork account. GR0000 is exactly that — the CEO in
     HR, absent from `cowork_employees`, and the manager of eight people.

     These used to get no node, so their reports pointed at nothing, depth was
     unresolvable for a third of the company, and the manager themselves had no
     `directReportIds` to read. Creating the node keeps the tree connected and
     honest: `managerId` stays null on it because we genuinely did not ask, and
     `isDirectoryMember: false` marks it as inferred from an edge rather than
     answered for. */
  for (const node of [...byEmployee.values()]) {
    if (!node.managerId || byEmployee.has(node.managerId)) continue;
    byEmployee.set(node.managerId, {
      employeeId: node.managerId,
      managerId: null,
      managerName: node.managerName,
      secondaryManagerId: null,
      secondaryManagerName: null,
      directReportIds: [],
      depth: null,
      isDirectoryMember: false,
    });
  }

  for (const node of byEmployee.values()) {
    if (!node.managerId) continue;
    byEmployee.get(node.managerId)?.directReportIds.push(node.employeeId);
  }
  for (const node of byEmployee.values()) {
    node.directReportIds.sort();
    node.depth = readDepth(byEmployee, node.employeeId);
  }

  const rootIds = [...byEmployee.values()]
    .filter((n) => n.depth === 0)
    .map((n) => n.employeeId)
    .sort();

  return { byEmployee, rootIds };
}

/**
 * Depth from the root, or null when the chain cannot be resolved.
 *
 * Null, not zero. A cycle or a manager outside the directory means we do not
 * know where this person sits — and rendering them at depth 0 would put them
 * beside the CEO, which is a specific and wrong claim rather than an absence
 * of one.
 */
export function readDepth(
  byEmployee: Map<string, ReportingNode>,
  employeeId: string,
): number | null {
  const seen = new Set<string>();
  let depth = 0;
  let current = employeeId;

  for (;;) {
    if (seen.has(current)) return null;
    seen.add(current);
    const node = byEmployee.get(current);
    if (!node) return null;
    if (!node.managerId) return depth;
    current = node.managerId;
    depth += 1;
  }
}

/**
 * Everyone beneath an employee, transitively — the closure `Viewer` wants.
 *
 * Excludes the employee themselves: `hierarchyIds` answers "whose work may I
 * see besides my own", and every caller already handles self separately.
 */
export function descendantsOf(
  tree: ReportingTree,
  employeeId: string,
): string[] {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const child of tree.byEmployee.get(id)?.directReportIds ?? []) {
      /* Guards a cycle. `readDepth` reports one as unresolvable, but this walk
         would spin on it, so it is stopped here too. */
      if (out.has(child)) continue;
      out.add(child);
      walk(child);
    }
  };
  walk(employeeId);
  out.delete(employeeId);
  return [...out].sort();
}
