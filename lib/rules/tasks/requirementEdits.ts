/**
 * Changing the list of completion requirements on a task that already exists.
 *
 * ## Why the whole list, every time
 *
 * The engine stores requirements as a plain array of strings on the task
 * document, and `PATCH /task/:id/edit-details` replaces that array wholesale —
 * there is no per-item route and no stable server-side id to address one by.
 * `addRequirements` already worked this way: it read the current array and sent
 * it back with the new lines appended.
 *
 * So editing and deleting are the same operation as adding, with a different
 * array. Building that array is what this module does, purely, because the
 * alternative — index arithmetic written inline in a component — is where an
 * off-by-one silently deletes the wrong requirement and nothing says so.
 *
 * ## The ids are ours, not the engine's
 *
 * `CompletionRequirement.id` is minted by the mapper on read. It is stable
 * within one render and meaningless to the server, so every function here
 * addresses items by POSITION in the list as displayed. The caller passes the
 * texts in the order they are shown, and gets back a list to send.
 */

/** A change that has been applied to the list, and what to say about it. */
export interface RequirementEdit {
  texts: string[];
  /** What happened, for the prompt and the audit line. */
  kind: "added" | "edited" | "removed";
  /** The text that was added, removed, or the new text after an edit. */
  subject: string;
  /** For an edit only: the text BEFORE it changed, so the log can show
   *  "old" → "new". Absent on an add or a remove. */
  before?: string;
}

const clean = (t: string): string => String(t ?? "").trim();

/** Every non-empty line, trimmed — the shape the engine stores. */
export function normaliseTexts(texts: readonly string[]): string[] {
  return texts.map(clean).filter(Boolean);
}

/**
 * One or more requirements appended.
 *
 * Several at once because the existing composer takes one per line, and
 * splitting that into separate writes would ask for the time adjustment once
 * per line for what the person did as a single act.
 */
export function withRequirementsAdded(
  current: readonly string[],
  added: readonly string[],
): RequirementEdit | null {
  const fresh = normaliseTexts(added);
  if (fresh.length === 0) return null;
  return {
    texts: [...normaliseTexts(current), ...fresh],
    kind: "added",
    subject: fresh.length === 1 ? fresh[0] : `${fresh.length} requirements`,
  };
}

/**
 * One requirement's text replaced.
 *
 * Returns null when the text is unchanged or empty — neither is a write worth
 * making, and an empty one would silently delete the line while the person
 * believed they were editing it. Deleting has its own control and its own
 * confirmation, and the two must not be reachable by the same gesture.
 */
export function withRequirementEdited(
  current: readonly string[],
  index: number,
  text: string,
): RequirementEdit | null {
  const list = normaliseTexts(current);
  const next = clean(text);
  if (!inRange(list, index) || !next || next === list[index]) return null;
  const before = list[index];
  const texts = [...list];
  texts[index] = next;
  return { texts, kind: "edited", subject: next, before };
}

/**
 * One requirement removed.
 *
 * The last one may be removed. A task with no requirements is an ordinary task
 * — `ProjectPanel` already renders that state, and refusing it here would mean
 * a list that can only ever grow.
 */
export function withRequirementRemoved(
  current: readonly string[],
  index: number,
): RequirementEdit | null {
  const list = normaliseTexts(current);
  if (!inRange(list, index)) return null;
  return {
    texts: list.filter((_, i) => i !== index),
    kind: "removed",
    subject: list[index],
  };
}

function inRange(list: readonly string[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < list.length;
}

/**
 * Why this requirement cannot be removed, or null when it can.
 *
 * ## The constraint is in the data model, not a policy
 *
 * A requirement's id IS its position: `taskMap.ts` mints
 * `compositeId(taskId, "req-" + i)`, and a subtask records which parent
 * requirement it satisfies as that string. Nothing on the stored document
 * distinguishes one requirement from another except where it sits in the array.
 *
 * So removing the second of five renumbers the three below it. Every subtask
 * claiming `req-2` would afterwards point at what used to be `req-3` — the
 * claim still resolves, still renders, and now means something different.
 * Nothing would report an error; the breakdown would simply describe work
 * nobody agreed to.
 *
 * **Editing and appending are unaffected**, which is why they are allowed
 * freely: replacing the text at position 2 leaves position 2 where it is, and
 * adding to the end moves nothing.
 *
 * The honest answer is therefore to refuse the removal and say why, rather than
 * to renumber the claims — re-pointing them is a migration of somebody else's
 * agreed work, and it belongs to whoever decides the breakdown, not to a
 * delete button.
 */
export function removalRefusal(
  claimCounts: readonly number[],
  index: number,
): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= claimCounts.length) {
    return null;
  }
  if ((claimCounts[index] ?? 0) > 0) {
    return "A subtask has been broken out for this requirement. Remove or reassign that subtask first.";
  }
  /* Anything BELOW it would be renumbered by the removal. */
  const shifted = claimCounts.slice(index + 1).some((n) => (n ?? 0) > 0);
  if (shifted) {
    return "Removing this would move the requirements below it up a place, and subtasks are claiming those. Remove it after the ones below, or reassign those subtasks first.";
  }
  return null;
}

/**
 * Does this change call for the time prompt?
 *
 * **Adding and removing, not editing.** Adding work and dropping work are the
 * two that change how long the task takes. Rewording a requirement that was
 * always there does not, and asking every time somebody fixes a typo would
 * train people to dismiss the prompt — which is how the one that mattered gets
 * dismissed too.
 */
export function asksForTimeAdjustment(kind: RequirementEdit["kind"]): boolean {
  return kind === "added" || kind === "removed";
}

/** The prompt's opening line, naming what just happened. */
export function requirementChangeSummary(edit: RequirementEdit): string {
  if (edit.kind === "added") return `Added “${edit.subject}”.`;
  if (edit.kind === "removed") return `Removed “${edit.subject}”.`;
  return `Edited “${edit.subject}”.`;
}
