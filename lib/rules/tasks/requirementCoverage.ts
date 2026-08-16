/**
 * Which of a parent's requirements a subtask has taken, and which nobody has.
 *
 * `completionState` already answers this per requirement — `claimants` tells you
 * who took one. What it does not do is answer it about the SET, which is the
 * question an owner actually asks while breaking work down: *four requirements,
 * two subtasks — what is left?*
 *
 * Counting that off a list by eye is exactly the arithmetic people get wrong,
 * and getting it wrong is expensive in one direction: a requirement nobody
 * claimed is work nobody is doing, and it stays invisible until the parent
 * cannot complete and nobody can say why.
 *
 * ## Assigned is not satisfied
 *
 * A requirement with a claimant is **assigned** — somebody has taken it on. It
 * becomes **satisfied** only when every subtask claiming it completes. This
 * module reports the first; `completionState` owns the second. Conflating them
 * would let a parent look finished because the work was handed out.
 *
 * ## Claiming twice is allowed, and worth saying out loud
 *
 * Two subtasks may claim one requirement, and `satisfiedByDelegation` then
 * requires BOTH to finish. That is a deliberate rule and this module does not
 * change it — it only makes sure somebody choosing an already-claimed
 * requirement is told what they are doing, rather than discovering later that
 * their requirement now waits on a second team's work.
 */

/** The shape this module needs from one `RequirementState`. */
export interface RequirementStateLike {
  requirement: { id: string; text: string };
  claimants: { id: string; title: string }[];
  isSatisfied: boolean;
}

export interface CoveredRequirement {
  id: string;
  text: string;
  /** Subtask titles that have taken this on. Never empty. */
  claimedBy: string[];
  isSatisfied: boolean;
}

export interface RequirementCoverage {
  /** Claimed by at least one live subtask. */
  assigned: CoveredRequirement[];
  /** Claimed by nothing. **The list somebody has to act on.** */
  pending: { id: string; text: string }[];
  total: number;
}

/**
 * Split a parent's requirements into assigned and pending.
 *
 * `exceptSubtaskId` removes one child's own claims from the reckoning, so an
 * existing subtask does not read as competing with itself. Creation passes
 * nothing, because a subtask that does not exist yet claims nothing.
 */
export function requirementCoverage(
  requirements: readonly RequirementStateLike[],
  exceptSubtaskId?: string | null,
): RequirementCoverage {
  const assigned: CoveredRequirement[] = [];
  const pending: { id: string; text: string }[] = [];

  for (const r of requirements) {
    const others = r.claimants.filter((c) => c.id !== exceptSubtaskId);
    if (others.length === 0) {
      pending.push({ id: r.requirement.id, text: r.requirement.text });
    } else {
      assigned.push({
        id: r.requirement.id,
        text: r.requirement.text,
        claimedBy: others.map((c) => c.title),
        isSatisfied: r.isSatisfied,
      });
    }
  }

  return { assigned, pending, total: requirements.length };
}

/**
 * The one line a parent shows about its own breakdown.
 *
 * States both halves always, rather than only the shortfall. "2 still pending"
 * on its own leaves a reader working out the total; naming both is what makes
 * it readable at a glance, which is the entire purpose of the line.
 */
export function coverageSummary(coverage: RequirementCoverage): string {
  const { assigned, pending, total } = coverage;
  if (total === 0) return "No completion requirements yet.";
  if (assigned.length === 0) {
    return total === 1
      ? "This requirement is not assigned to any subtask yet."
      : `None of the ${total} requirements is assigned to a subtask yet.`;
  }
  if (pending.length === 0) {
    return total === 1
      ? "The requirement is assigned to a subtask."
      : `All ${total} requirements are assigned to subtasks.`;
  }
  return `${assigned.length} of ${total} requirements assigned to subtasks · ${pending.length} still pending`;
}

/** One requirement the chooser is taking on that somebody already has. */
export interface DuplicateClaim {
  id: string;
  text: string;
  claimedBy: string[];
}

/**
 * Requirements in this selection that another subtask already claims.
 *
 * Not a refusal — see the note at the top. `subtaskRefusal` decides what is
 * forbidden and is untouched; this decides what somebody should be told.
 */
export function duplicateClaims(
  selectedIds: readonly string[],
  coverage: RequirementCoverage,
): DuplicateClaim[] {
  const picked = new Set(selectedIds);
  return coverage.assigned
    .filter((r) => picked.has(r.id))
    .map((r) => ({ id: r.id, text: r.text, claimedBy: r.claimedBy }));
}

/**
 * What is still nobody's after this subtask is created.
 *
 * The pending list minus what is being taken now. Shown while the form is open
 * rather than afterwards, because that is when it can still be acted on — the
 * owner can add another requirement to this subtask instead of discovering the
 * gap once the work is out.
 */
export function pendingAfter(
  selectedIds: readonly string[],
  coverage: RequirementCoverage,
): { id: string; text: string }[] {
  const picked = new Set(selectedIds);
  return coverage.pending.filter((r) => !picked.has(r.id));
}

/**
 * The sentence warning that a requirement is being taken twice.
 *
 * Says the CONSEQUENCE, not just the fact. "Already assigned" invites the
 * reader to assume it is handled; what they need to know is that claiming it
 * again makes their requirement wait on somebody else's subtask as well as
 * their own.
 */
export function duplicateClaimMessage(
  duplicates: readonly DuplicateClaim[],
): string | null {
  if (duplicates.length === 0) return null;
  const [first] = duplicates;
  const who = first.claimedBy.join(", ");
  if (duplicates.length === 1) {
    return `“${first.text}” is already assigned to ${who}. Choosing it again is allowed — it then counts as done only once both subtasks complete.`;
  }
  return `${duplicates.length} of the requirements you have chosen are already assigned to other subtasks, including “${first.text}” (${who}). Choosing them again is allowed — each counts as done only once every subtask claiming it completes.`;
}

/**
 * The sentence naming what nobody will be doing.
 *
 * Deliberately not phrased as an error. Leaving a requirement for later is
 * ordinary — the owner may intend to take it directly, or to delegate it in a
 * second subtask. What is not ordinary is forgetting it exists, which is what
 * this prevents.
 */
export function pendingMessage(
  pending: readonly { text: string }[],
): string | null {
  if (pending.length === 0) return null;
  const names = pending.map((r) => `“${r.text}”`).join(", ");
  return pending.length === 1
    ? `${names} will still have no subtask. Add it here, or leave it for the reviewer or a later subtask.`
    : `${pending.length} requirements will still have no subtask: ${names}. Add them here, or leave them for the reviewer or later subtasks.`;
}
