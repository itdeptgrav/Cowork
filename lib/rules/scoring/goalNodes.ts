/**
 * C2 · the roadmap a goal task is delivered through.
 *
 * A goal task is worth `taskMaxPoints` (see `goalPoints.ts`). That pool is
 * spent across NODES — the steps the work is broken into. Each node carries a
 * heading, a description, a deadline and a share of the task's points, and it
 * pays out when it is approved having been submitted on or before its deadline.
 *
 * ## Typed, not distributed — OWNER DECISION
 *
 * The old Cowork distributed the points by formula: the final node took 40% and
 * the rest split what was left equally. That is gone. Each node's weight is
 * typed by whoever builds the roadmap, and the only rule is that the parts
 * cannot exceed the whole:
 *
 * ```
 *   nodePoints   = weightPercent × taskMaxPoints ÷ 100
 *   remaining    = taskMaxPoints − Σ(other nodes' points)
 *   a node is refused if its points exceed `remaining`
 * ```
 *
 * **The guard is per node, against the others.** Editing a node compares
 * against the pool minus every OTHER node, so raising one from 10 to 12 is
 * judged on the two points it adds rather than on the twelve it becomes —
 * which is what makes an edit possible at all once the pool is nearly spent.
 */

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** One step of the roadmap, as the rules see it. */
export interface GoalNode {
  id: string;
  heading: string;
  description: string;
  /** ISO. The instant after which a submission earns nothing. */
  deadline: string | null;
  /** Share of the task's pool, as a percentage. */
  weightPercent: number;
}

/** What a node claiming `weightPercent` of the task's pool is worth. */
export function nodePointsFor(
  weightPercent: number,
  taskMaxPoints: number,
): number {
  const w = Number(weightPercent);
  const t = Number(taskMaxPoints);
  if (!Number.isFinite(w) || !Number.isFinite(t)) return 0;
  if (w <= 0 || t <= 0) return 0;
  return round2((w * t) / 100);
}

/** What the given nodes have already claimed of the task's pool. */
export function assignedPoints(
  nodes: readonly Pick<GoalNode, "weightPercent">[],
  taskMaxPoints: number,
): number {
  return round2(
    nodes.reduce(
      (sum, n) => sum + nodePointsFor(n.weightPercent, taskMaxPoints),
      0,
    ),
  );
}

/**
 * Points still unspent, **excluding one node** where an id is given.
 *
 * The exclusion is what makes editing work: a node being changed must not be
 * counted against itself, or raising it by two points would be judged as if it
 * were being added from scratch.
 */
export function remainingPoints(input: {
  nodes: readonly GoalNode[];
  taskMaxPoints: number;
  excludeNodeId?: string | null;
}): number {
  const others = input.excludeNodeId
    ? input.nodes.filter((n) => n.id !== input.excludeNodeId)
    : input.nodes;
  return round2(
    Math.max(0, input.taskMaxPoints - assignedPoints(others, input.taskMaxPoints)),
  );
}

/**
 * Why this node cannot be saved, or null.
 *
 * Every rule the old Cowork's editor applied, in one testable place rather than
 * spread across a `canSave` expression and a disabled button. The wording names
 * the figure the person has to act on — "only 8 points are left" — because a
 * greyed-out Save with no sentence beside it is the thing a person cannot
 * recover from without guessing.
 */
export function nodeRefusal(input: {
  heading: string;
  description: string;
  deadline: string | null;
  weightPercent: number;
  taskMaxPoints: number;
  nodes: readonly GoalNode[];
  /** The node being edited, so it is not counted against itself. */
  excludeNodeId?: string | null;
}): string | null {
  if (!input.heading.trim()) return "Give this step a heading.";
  if (!input.description.trim())
    return "Say what this step involves — the person doing it reports against this.";
  if (!input.deadline)
    return "Give this step a deadline. Points are earned only when it is submitted on or before it.";

  const w = Number(input.weightPercent);
  if (!Number.isFinite(w) || w <= 0)
    return "Give this step a share of the goal's points, above zero.";
  if (w > 100) return "A step cannot claim more than the whole goal.";

  if (input.taskMaxPoints <= 0)
    return "This goal has no points to share out.";

  const points = nodePointsFor(w, input.taskMaxPoints);
  const left = remainingPoints({
    nodes: input.nodes,
    taskMaxPoints: input.taskMaxPoints,
    excludeNodeId: input.excludeNodeId ?? null,
  });
  if (points > left) {
    return `Only ${left} of this goal's ${input.taskMaxPoints} points are unspent, and this step asks for ${points}.`;
  }
  return null;
}

/** What the editor shows while somebody types: the figure and the refusal. */
export interface GoalNodeView {
  points: number;
  remaining: number;
  refusal: string | null;
}

export function goalNodeView(input: {
  heading: string;
  description: string;
  deadline: string | null;
  weightPercent: number;
  taskMaxPoints: number;
  nodes: readonly GoalNode[];
  excludeNodeId?: string | null;
}): GoalNodeView {
  return {
    points: nodePointsFor(input.weightPercent, input.taskMaxPoints),
    remaining: remainingPoints({
      nodes: input.nodes,
      taskMaxPoints: input.taskMaxPoints,
      excludeNodeId: input.excludeNodeId ?? null,
    }),
    refusal: nodeRefusal(input),
  };
}

/**
 * The share that would spend exactly what is left.
 *
 * The old editor offered this as a one-click "use the rest", and it is the
 * difference between a roadmap that adds up and one that leaves four points
 * stranded because nobody wanted to do the arithmetic.
 */
export function weightForRemaining(input: {
  nodes: readonly GoalNode[];
  taskMaxPoints: number;
  excludeNodeId?: string | null;
}): number {
  if (input.taskMaxPoints <= 0) return 0;
  const left = remainingPoints(input);
  return round2((left / input.taskMaxPoints) * 100);
}

/* ── Handing the roadmap over ─────────────────────────────────────────────── */

/**
 * Why this roadmap cannot be handed to the person doing the work, or null.
 *
 * One rule, carried from the old Cowork: there has to be at least one step.
 * Everything else about a roadmap is already guaranteed by `nodeRefusal` —
 * no step can exist without a heading, a description, a deadline and a share
 * that fits.
 *
 * **Unspent points are NOT a refusal.** A goal that shares out thirty of its
 * forty points can only ever earn thirty, and that may be exactly what was
 * intended — a reserve, or a goal deliberately worth less than its slice of the
 * pool. It is worth SAYING, which `unspentWarning` does, and it is not worth
 * blocking.
 */
export function submitRefusal(nodes: readonly GoalNode[]): string | null {
  if (!nodes.length)
    return "Add at least one step before handing this to the person doing the work.";
  return null;
}

/**
 * What the head should know before handing it over, or null.
 *
 * Said once, at the moment it stops being editable in practice, rather than
 * left to be discovered when the goal finishes short of its pool.
 */
export function unspentWarning(input: {
  nodes: readonly GoalNode[];
  taskMaxPoints: number;
}): string | null {
  if (!input.nodes.length || input.taskMaxPoints <= 0) return null;
  const left = remainingPoints(input);
  if (left <= 0) return null;
  return `${left} of this goal's ${input.taskMaxPoints} points are not shared out, so it can earn at most ${round2(input.taskMaxPoints - left)}.`;
}

/* ── Doing the work, and being paid for it ────────────────────────────────── */

/**
 * Where a step has got to.
 *
 * The engine's own words, and they are plain enough to keep: `"pending"` is
 * nobody has handed anything in, `"pending_approval"` is a report waiting on
 * the head, `"done"` is approved and settled.
 */
export type GoalNodeStatus = "pending" | "pending_approval" | "done";

/** Why this report cannot be sent, or null. */
export function reportRefusal(text: string): string | null {
  if (!text.trim())
    return "Say what you did. The person approving this reads it against the step.";
  return null;
}

/**
 * Was this handed in after the deadline?
 *
 * **On or before earns; after earns nothing.** Not reduced — nothing. That is
 * the rule carried from the old Cowork, and it is enforced twice: here so the
 * interface can say what will happen before anybody approves, and again in the
 * engine, which re-checks `submittedAt <= deadline` before it pays out.
 *
 * A step with no deadline cannot be late — there is nothing to be late for.
 */
export function submittedLate(input: {
  submittedAt: string | null;
  deadline: string | null;
}): boolean {
  if (!input.submittedAt || !input.deadline) return false;
  const at = Date.parse(input.submittedAt);
  const by = Date.parse(input.deadline);
  if (!Number.isFinite(at) || !Number.isFinite(by)) return false;
  return at > by;
}

/** What approving this step will do, said before it is done. */
export interface ApprovalOutcome {
  /** Whether the points will actually be paid. */
  earns: boolean;
  /** How many — zero when late. */
  points: number;
  /** One line, for the button's own explanation. */
  label: string;
}

/**
 * What approving a step is worth, and why.
 *
 * The head is about to decide something that moves somebody's score, so the
 * consequence is stated on the control rather than discovered afterwards. A
 * late step is still approved — the work was done, and refusing to acknowledge
 * it would be a different punishment — it simply earns nothing.
 */
export function approvalOutcome(input: {
  submittedAt: string | null;
  deadline: string | null;
  points: number;
}): ApprovalOutcome {
  const late = submittedLate(input);
  const points = Math.max(0, Number(input.points) || 0);
  if (points <= 0) {
    return { earns: false, points: 0, label: "Approve — this step carries no points" };
  }
  if (late) {
    return {
      earns: false,
      points: 0,
      label: `Approve — handed in after the deadline, so the ${points} points are not earned`,
    };
  }
  return {
    earns: true,
    points,
    label: `Approve — earns ${points} points`,
  };
}
