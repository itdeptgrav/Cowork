/**
 * Coalesce concurrent calls to one async function into one call.
 *
 * ## The bug this closes
 *
 * "Create task" set `isPending` and disabled the button, but that guard lives
 * in React state — set with `setState`, applied to the DOM on the next commit.
 * A click handler runs synchronously the instant the event fires; the button
 * does not actually become `disabled` in the DOM until React has re-rendered
 * and painted. A second click landing inside that gap — a fast double-click, an
 * impatient double-tap on a phone, a stuck key repeating an Enter-to-submit
 * handler — fires the handler again while the button still LOOKS clickable,
 * and nothing before this stopped it: the mutation ran twice, and the record it
 * created did too.
 *
 * `disabled={isPending}` is still worth having — it is the visible feedback,
 * and it is what stops a second, deliberate click once the DOM has caught up.
 * It was never enough **on its own**, because it cannot close a gap that is
 * measured in render timing rather than in intent.
 *
 * ## The fix, and why it is not "disable faster"
 *
 * There is no version of "set state, then check state" that closes a
 * synchronous race — the check always runs after the render that would answer
 * it. What closes it is a check with no render in the loop at all: a plain
 * variable, read and written in the same tick the call is made, before any
 * `await` and before any `setState`. That is what this wraps around the
 * function everybody already calls — `execute()` in `useAction`, in
 * `lib/hooks/useRepository.ts` — so the guard applies to every action built on
 * it (currently 60+ call sites) without each one having to reason about the
 * race itself.
 *
 * ## Sharing the promise, not just refusing the call
 *
 * A second call while one is in flight does not fail and does not wait for a
 * fresh request — it receives the SAME promise the first call is already
 * awaiting, and resolves with the same result. That is what makes "only one
 * task is created" also mean "and everybody who clicked learns what happened
 * to it", rather than the second click silently doing nothing while the first
 * click's caller is the only one who finds out.
 *
 * ## Why it unlocks again on its own
 *
 * The in-flight marker is cleared in a `finally`, whether the call succeeded,
 * returned a typed failure, or threw — so a real failure (validation refused,
 * the network dropped) leaves the action callable again immediately. This is
 * exclusion for the length of ONE request, not a lock that outlives it.
 */
export function dedupeInFlight<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  let inFlight: Promise<R> | null = null;

  return (...args: Args): Promise<R> => {
    if (inFlight) return inFlight;

    const p = fn(...args).finally(() => {
      /* Only this call's own promise ever clears the marker. Irrelevant today
         — nothing here starts a second promise while `inFlight` is set — but
         it is the correct guard for a future caller who reads this file
         wondering whether it is safe to. */
      if (inFlight === p) inFlight = null;
    });

    inFlight = p;
    return p;
  };
}
