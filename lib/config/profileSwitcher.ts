/**
 * The development profile switcher.
 *
 * **This is not authentication and it must never become it.** The prototype has
 * no authentication at all — the repository answers as a seeded identity. This
 * changes which seeded identity that is, so real accounts can be exercised
 * without real accounts existing.
 *
 * It switches **people, not roles.** An earlier version listed six archetypes,
 * which was the wrong shape: a role label tells you nothing about whose tasks
 * you would see, whose manager approves your work, or what your score is. The
 * switcher now lists actual employees and swaps the acting identity wholesale,
 * so department, reporting line, roles, permissions, tasks, score, dashboard,
 * approvals and visibility all follow from that one change — because every one
 * of them already resolves from the acting employee.
 *
 * Three things keep it out of production:
 *
 *  1. `NEXT_PUBLIC_ENABLE_PROFILE_SWITCHER` must be exactly `"true"`. Next.js
 *     inlines the literal at build time, so in a build without the flag the
 *     condition folds to `false` and every consumer is dead-code eliminated.
 *  2. `process.env.NODE_ENV !== "production"` is required IN ADDITION, so
 *     setting the flag on a production build still does nothing. A flag someone
 *     can turn on by accident is not a safeguard.
 *  3. Nothing here is read by any permission decision. `can()` resolves against
 *     whoever the repository is acting as; this only chooses that person, the
 *     same way a login would. Switching cannot grant a capability the chosen
 *     person's roles do not already carry — which is what makes it a faithful
 *     test rather than a bypass.
 *
 * The list is not hard-coded. It is built from the seeded employees at runtime,
 * so adding a person to the fixture adds them here with no second edit — the
 * class of drift where a switcher offers a profile that no longer exists.
 */

export const PROFILE_SWITCHER_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_PROFILE_SWITCHER === "true" &&
  process.env.NODE_ENV !== "production";

export const PROFILE_STORAGE_KEY = "cowork-dev-profile";
