/**
 * Who may reorder whose queue.
 *
 * **The rule: your rank is set by whoever manages you, not by you.** Priority
 * is the order a person works through their day, and letting the person being
 * measured also set that order makes it an assertion rather than an
 * instruction. Legacy had no rule at all — priority was written client-side
 * straight to Firestore with no route, no role check and no audit record of who
 * changed it (`docs/specs/TASK_LOGIC_SPEC.md` §2.4). This is the rule that replaces it,
 * owner decision 2026-07-28.
 *
 * **The one exception is somebody with no manager.** For them there is nobody
 * to set it, so a universal refusal would freeze the top of the organisation's
 * queue at whatever ranks its tasks were created with. Having no manager is
 * exactly the condition, not seniority and not a role: an administrator who
 * reports to someone still has their order set by that person.
 *
 * Separate from the capability check rather than folded into it, because the
 * two answer different questions and both have to hold. `can()` answers "may
 * this actor touch this person's queue at all", and its `reaches()` returns
 * true for yourself before scope is even consulted — so the capability alone
 * can never express "not your own". This answers "may they touch their OWN".
 */

export interface SelfReorderInput {
  /** Who is performing the change. */
  actorId: string;
  /** Whose queue is being reordered. */
  subjectId: string;
  /** Whether the ACTOR has an active primary manager. */
  actorHasManager: boolean;
}

/**
 * Why this reorder is refused, or null.
 *
 * Returns the message the repository fails with and the dialog can show before
 * a round trip, so the form never offers something the server will reject.
 */
export function selfReorderRefusal(input: SelfReorderInput): string | null {
  if (input.actorId !== input.subjectId) return null;
  if (!input.actorHasManager) return null;
  return "You cannot change your own priority. The order of your work is set by your manager.";
}

/**
 * Whether this actor may reorder this subject's queue, ignoring capability.
 *
 * The affordance form of the same rule — the UI decides whether to render a
 * control from this, and the repository decides whether to accept the write
 * from `selfReorderRefusal`. One predicate, so the two cannot answer
 * differently.
 */
export function mayReorder(input: SelfReorderInput): boolean {
  return selfReorderRefusal(input) === null;
}
