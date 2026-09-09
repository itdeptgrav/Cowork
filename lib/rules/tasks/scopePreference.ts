import type { TaskScope } from "@/lib/repositories";

/**
 * Which scope the Tasks page opens on, and how a person changes that for good.
 *
 * ## Why there is a stored answer at all
 *
 * The page used to derive it: anybody with a team opened on **My team**, on the
 * grounds that a manager wants to see what the team is carrying. That reasoning
 * held for the list and broke everything else, because the same scope feeds the
 * Overview — and `team` deliberately drops a task whose only holder is the
 * viewer (`teamScopeKeeps`). A manager's own work was therefore missing from
 * their own summary until they pressed My tasks, at which point it appeared and
 * stayed. Two people reading the same screen disagreed about whether a task
 * existed, and both were looking at the truth for the scope they were in.
 *
 * So the default is **My tasks** — your own work, which is the one scope that is
 * never empty for the wrong reason — and preferring anything else is a choice
 * somebody makes deliberately and keeps.
 *
 * ## Per person, not per machine
 *
 * The opposite of `deviceMode`, and for the opposite reason: a device mode is a
 * fact about the screen in front of you, while "I manage a team and want to open
 * on theirs" is a fact about the person. It is stored under the viewer's id and
 * listed in `ACCOUNT_SCOPED_KEYS`, so signing in as somebody else does not hand
 * them another person's landing tab.
 *
 * ## Parsing here, storage at the call site
 *
 * The same split `readStoredMode` uses: this module is pure and testable, and
 * the component owns the `try`/`catch` around `localStorage`, which throws
 * outright in some privacy modes.
 */

/** Every scope a stored preference may name. */
const STORABLE: readonly string[] = [
  "mine",
  "team",
  "assigned_out",
  "self_assigned",
  "submitted",
  "all",
];

/**
 * The scope the Tasks page opens on when nobody has said otherwise.
 *
 * **Your own work.** It is the only scope that cannot be empty because of a
 * rule you did not know about: `team` hides what only you hold, `assigned_out`
 * hides everything you were given, and `all` is an organisation-scope answer to
 * a question most people did not ask.
 */
export const DEFAULT_TASK_SCOPE: TaskScope = "mine";

/**
 * Where one person's preference lives.
 *
 * Keyed by the viewer, so two people sharing a machine do not inherit each
 * other's landing tab even before the sign-out clear-down runs. The prefix is
 * what `ACCOUNT_SCOPED_KEYS` removes.
 */
export const TASK_SCOPE_KEY_PREFIX = "cowork.tasks.defaultScope.";

export function taskScopeKey(viewerId: string): string {
  return `${TASK_SCOPE_KEY_PREFIX}${viewerId}`;
}

/**
 * A stored value, or null where nothing usable is stored.
 *
 * Null for an unknown string rather than a guess: a scope this build does not
 * offer would land somebody on a tab that renders nothing, and the default is a
 * better answer than a tab that cannot be right.
 */
export function readStoredScope(raw: string | null): TaskScope | null {
  if (!raw) return null;
  return STORABLE.includes(raw) ? (raw as TaskScope) : null;
}

/**
 * Whether to ask "open here next time?" for the scope just chosen.
 *
 * Asked only when the answer would CHANGE something — the chosen scope is not
 * already what this person opens on — and only for a scope that is still
 * offered to them. Anything else is a prompt whose only outcome is dismissing
 * it, which is how a helpful question becomes noise.
 *
 * `null` for `stored` means they have never chosen, so the comparison is
 * against the default they are getting today.
 */
export function shouldOfferDefault(input: {
  chosen: TaskScope;
  stored: TaskScope | null;
  /** The scopes this viewer is actually offered. */
  offered: readonly TaskScope[];
  /** Scopes they have already declined to make default, this visit. */
  declined?: readonly TaskScope[];
}): boolean {
  if (!input.offered.includes(input.chosen)) return false;
  if ((input.declined ?? []).includes(input.chosen)) return false;
  return input.chosen !== (input.stored ?? DEFAULT_TASK_SCOPE);
}

/**
 * The scope to open on: what they chose this visit, else what they prefer, else
 * the default.
 *
 * A preference for a scope they can no longer reach — a manager who lost their
 * team, or an organisation-scope reader who did not stay one — falls back to
 * the default rather than selecting a tab that is not on the row.
 */
export function openingScope(input: {
  chosenThisVisit: TaskScope | null;
  stored: TaskScope | null;
  offered: readonly TaskScope[];
}): TaskScope {
  if (input.chosenThisVisit) return input.chosenThisVisit;
  if (input.stored && input.offered.includes(input.stored)) return input.stored;
  return DEFAULT_TASK_SCOPE;
}
