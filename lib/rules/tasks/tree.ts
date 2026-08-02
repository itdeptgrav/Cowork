/**
 * A flat task list, laid out as the tree it already is.
 *
 * Parent linkage is on every task and was never rendered: the list drew one row
 * per task in sort order, so a subtask sat wherever its title or rank put it —
 * usually nowhere near the work it belongs to. The old app drew a tree, and the
 * reason is not decoration: a subtask read on its own does not say what larger
 * piece of work it is part of, and a parent read on its own does not say that
 * its execution has been handed out.
 *
 * Pure, and generic over the row, so the table's `TaskView` and a test's plain
 * object go through the same code.
 */

export interface TreeNodeInput {
  id: string;
  parentId: string | null;
}

export interface TreeRow<T> {
  item: T;
  /** 0 for a root, 1 for a subtask. Depth of one is enforced upstream. */
  depth: number;
  /** True when this row has children in THIS list. */
  hasChildren: boolean;
  /** Children present here — not the task's true count, which may be larger. */
  childCount: number;
  /** The last child under its parent, so the connector can stop. */
  isLastChild: boolean;
}

/**
 * Order the rows parent-first, children immediately beneath, and say how deep
 * each one sits.
 *
 * **Incoming order is preserved on both levels.** The caller has already
 * sorted — by rank, by due date, by title — and re-sorting here would quietly
 * override the control the person just used. Roots keep their relative order;
 * each parent's children keep theirs.
 *
 * **An orphan is a root.** A subtask whose parent is not in this list — filtered
 * out by a status facet, or simply not visible to this viewer — is rendered at
 * the top level rather than dropped. Dropping it is how a subtask came to be
 * invisible in the first place, and a row in a slightly odd place beats a row
 * that does not exist.
 *
 * `collapsed` hides a parent's children without removing the parent, so the
 * chevron has something to toggle. A collapsed parent still reports
 * `hasChildren`, which is what keeps the chevron on screen.
 */
export function buildTaskTree<T>(
  items: readonly T[],
  read: (item: T) => TreeNodeInput,
  collapsed: ReadonlySet<string> = new Set(),
): TreeRow<T>[] {
  const present = new Set(items.map((i) => read(i).id));

  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const { parentId } = read(item);
    if (parentId && present.has(parentId)) {
      const bucket = childrenOf.get(parentId);
      if (bucket) bucket.push(item);
      else childrenOf.set(parentId, [item]);
    } else {
      roots.push(item);
    }
  }

  const rows: TreeRow<T>[] = [];
  for (const root of roots) {
    const id = read(root).id;
    const children = childrenOf.get(id) ?? [];
    rows.push({
      item: root,
      depth: 0,
      hasChildren: children.length > 0,
      childCount: children.length,
      isLastChild: false,
    });
    if (collapsed.has(id)) continue;
    children.forEach((child, i) => {
      rows.push({
        item: child,
        depth: 1,
        /* A subtask cannot be broken down again (`subtaskRefusal`), so this is
           false by construction rather than by looking. Computing it would
           invite a second, deeper level that no rule below here supports. */
        hasChildren: false,
        childCount: 0,
        isLastChild: i === children.length - 1,
      });
    });
  }
  return rows;
}

/**
 * The ids of every parent in a list that has children in it.
 *
 * For "collapse all" / "expand all", and for seeding the collapsed set so a
 * tree arrives folded rather than exploded across the screen.
 */
export function parentIdsIn<T>(
  items: readonly T[],
  read: (item: T) => TreeNodeInput,
): string[] {
  const present = new Set(items.map((i) => read(i).id));
  const parents = new Set<string>();
  for (const item of items) {
    const { parentId } = read(item);
    if (parentId && present.has(parentId)) parents.add(parentId);
  }
  return [...parents];
}
