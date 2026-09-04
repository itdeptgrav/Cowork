import type { Scope } from "../../domain/identity.ts";
import type { ReportingNode } from "../../legacy/hierarchy.ts";
import type { PersonBucket } from "./peopleRollup.ts";

/**
 * Who the Tasks list offers to filter by, and in what shape.
 *
 * ## The control this replaces
 *
 * There was a Task-wise / Person-wise switch beside the filters. Choosing
 * Person-wise did one thing: it revealed a dropdown. So the switch was a step
 * that existed to uncover a control — two clicks and a mode to answer a
 * question the dropdown answers on its own. The dropdown is now simply there,
 * and the mode is gone: picking a person narrows the list, picking **All
 * members** widens it again.
 *
 * ## Three shapes, because there are three kinds of reader
 *
 * The shape follows the viewer's `task.view` scope, which is the same rule that
 * already decides whether they get a My team tab at all. Nothing here grants
 * visibility — every person it offers is somebody the scope already lets them
 * see, and the task list itself is fetched and filtered by the repository. This
 * only decides what the control OFFERS.
 *
 *   · **`self` — an ordinary employee.** No reporting tree to draw, so there is
 *     no dropdown at all, and the toolbar looks exactly as it did before this
 *     existed. The exception is the one case where such a person genuinely has
 *     several people to compare: work they raised FOR other people. Those
 *     people are read off the list in front of them rather than off the tree —
 *     they are not this person's reports, and the tree would not name them.
 *
 *   · **`direct_reports` — a team lead.** A flat list of the people who report
 *     to them. No nesting: a lead's reports have no reports the lead can see,
 *     so an expander would open onto nothing.
 *
 *   · **`hierarchy` / `organisation` — chief level.** The tree, nested, so a
 *     branch opens to reveal the people under a lead. That is what makes the
 *     control an audit surface rather than a long alphabetical list: somebody
 *     at the top can walk down to any person through the structure that
 *     actually explains why they are there.
 *
 * ## Everybody in the closure, including the idle
 *
 * A person carrying nothing still appears, with a count of zero. The obvious
 * alternative — list only people who have a task in the current list — quietly
 * removes the very answer an audit is looking for. "Nobody has given this
 * person anything" is a finding, and a control that omits them cannot report
 * it. It also makes the tree stable: branches stop appearing and disappearing
 * as the Open/Closed filter changes underneath them.
 */

export interface PersonNode {
  /** Employee id. */
  id: string;
  name: string;
  /**
   * Tasks in the CURRENT list for this person alone — never a subtree total.
   *
   * Rolling a manager's branch into their own figure would read as their
   * workload, and a lead carrying nothing under a team of nine would show as
   * nine. The branch is there to be opened; the number beside a name is that
   * name's.
   */
  count: number;
  /** Their reports, already sorted. Empty for a leaf and for a flat list. */
  children: PersonNode[];
}

/** The id every list carries first: no person chosen, nothing narrowed. */
export const ALL_MEMBERS = "";

/**
 * The people this viewer may filter by, in the shape their scope earns.
 *
 * Returns `[]` when there is nobody worth choosing between, and the caller
 * renders no control at all rather than an empty menu.
 */
export function buildPersonFilter(input: {
  /** The viewer's `task.view` scope. Null while permissions are loading. */
  scope: Scope | null;
  viewerId: string | null;
  /** The reporting closure, from `listReportingLines`. */
  reporting: readonly ReportingNode[];
  /** Display names, for people the roll-up has not seen. */
  employees: readonly { id: string; displayName: string }[];
  /** The current list, rolled up per person — the source of every count. */
  buckets: readonly PersonBucket[];
}): PersonNode[] {
  const { scope, viewerId, reporting, employees, buckets } = input;
  if (!scope || !viewerId) return [];

  const countOf = new Map<string, number>();
  for (const b of buckets) if (b.id) countOf.set(b.id, b.tasks.length);
  const nameOf = new Map<string, string>();
  for (const e of employees) nameOf.set(e.id, e.displayName);
  /* The roll-up is a second source of names, and a better one where the two
     disagree: it resolved the person off the task itself, so it can name
     somebody the directory read has not returned. */
  for (const b of buckets) if (b.id) nameOf.set(b.id, b.name);

  /* An employee whose name nothing can resolve is dropped rather than rendered
     as a blank row or as their id. A row nobody can read is not a choice. */
  const named = (id: string): string | null => nameOf.get(id) ?? null;

  if (scope === "self") {
    /* Read off the list, not the tree. These are people this person has given
       work to; none of them reports to them, so the tree does not connect
       them and would answer with nothing. */
    const out: PersonNode[] = [];
    for (const b of buckets) {
      if (!b.id || b.id === viewerId) continue;
      const name = named(b.id);
      if (!name) continue;
      out.push({ id: b.id, name, count: b.tasks.length, children: [] });
    }
    return sorted(out);
  }

  const byId = new Map<string, ReportingNode>();
  for (const n of reporting) byId.set(n.employeeId, n);

  const directOf = (id: string): string[] =>
    byId.get(id)?.directReportIds ?? [];

  const leaf = (id: string): PersonNode | null => {
    const name = named(id);
    if (!name) return null;
    return { id, name, count: countOf.get(id) ?? 0, children: [] };
  };

  if (scope === "direct_reports") {
    return sorted(
      directOf(viewerId)
        .map(leaf)
        .filter((n): n is PersonNode => n !== null),
    );
  }

  /* hierarchy / organisation — nested, and cycle-guarded. A loop in the tree
     would otherwise recurse until the stack ends, and legacy data has had
     them: the same guard `closureOf` carries, for the same reason. */
  const seen = new Set<string>([viewerId]);
  const build = (id: string, depth: number): PersonNode | null => {
    if (depth > 10 || seen.has(id)) return null;
    seen.add(id);
    const node = leaf(id);
    if (!node) return null;
    node.children = sorted(
      directOf(id)
        .map((child) => build(child, depth + 1))
        .filter((n): n is PersonNode => n !== null),
    );
    return node;
  };

  let roots = directOf(viewerId);
  /* **A chief with nobody directly under them still sees the company.** A
     system administrator, or anyone holding organisation scope from a role
     rather than from a position, can sit outside the reporting tree entirely.
     Walking down from them would find nothing, so the walk starts at the
     organisation's own roots instead — the people with no manager above them.
     Only at `organisation`: at `hierarchy` the scope IS the subtree, and
     showing the whole company for an empty one would hand out reach the
     permission does not carry. */
  if (roots.length === 0 && scope === "organisation") {
    roots = reporting
      .filter((n) => !n.managerId && n.employeeId !== viewerId)
      .map((n) => n.employeeId);
  }

  return sorted(
    roots.map((id) => build(id, 0)).filter((n): n is PersonNode => n !== null),
  );
}

/**
 * By name, always.
 *
 * The roll-up sorts busiest-first, which is right for a workload summary and
 * wrong for a picker: this is a list somebody is READING A NAME OUT OF, and a
 * name's position must not move because a task was closed underneath it.
 */
function sorted(nodes: PersonNode[]): PersonNode[] {
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every id in the tree, so a caller can tell whether a selection still exists. */
export function personIdsIn(nodes: readonly PersonNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly PersonNode[]) => {
    for (const n of list) {
      out.push(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** One person anywhere in the tree, by id. Null when the tree no longer offers them. */
export function findPerson(
  nodes: readonly PersonNode[],
  id: string,
): PersonNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const below = findPerson(n.children, id);
    if (below) return below;
  }
  return null;
}

/**
 * The path of ids down to a person, so the tree can open onto a selection.
 *
 * Returns `[]` when the person is not in the tree. Without this, a chief who
 * picks somebody four levels down and comes back to the page finds the branch
 * collapsed and their own selection invisible.
 */
export function pathTo(
  nodes: readonly PersonNode[],
  id: string,
): string[] {
  for (const n of nodes) {
    if (n.id === id) return [n.id];
    const below = pathTo(n.children, id);
    if (below.length) return [n.id, ...below];
  }
  return [];
}
