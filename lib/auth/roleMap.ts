import type { RoleArchetype } from "@/lib/domain";

/**
 * The legacy engine's role, as this product's archetype.
 *
 * Two models meet here. The engine has three roles compared as bare strings
 * (`coworkAuth.js`); Cowork has five archetypes driving a capability model. This
 * is the only place they are translated, so a change of policy is one edit
 * rather than a search.
 *
 * Owner-approved mapping, 2026-07-28:
 *
 * | Engine | Cowork | Consequence |
 * |---|---|---|
 * | `ceo` | `system_admin` | Opens `/admin` |
 * | `tl` | `manager` | Team surfaces; **not** `/admin` |
 * | anything else | `employee` | Own work only |
 *
 * **The fallthrough is the load-bearing part.** An unrecognised role becomes
 * `employee` — the least privilege — matching the engine's own behaviour, where
 * anything that is not `"ceo"` or `"tl"` fails both checks and lands in the
 * employee case. A mapping that guessed upward would grant access the engine
 * would then refuse, which reads to the user as a broken product and to a
 * reviewer as a privilege bug.
 *
 * Two Cowork archetypes have no engine equivalent and are never produced here:
 * `skip_level` and `people_ops`. They can only be held by an account this
 * mapping did not create, which is worth knowing before anyone assumes the
 * archetype field is fully described by the engine.
 */
export function archetypeForLegacyRole(role: unknown): RoleArchetype {
  if (role === "ceo") return "system_admin";
  if (role === "tl") return "manager";
  return "employee";
}

/**
 * Whether this role may open the administration area.
 *
 * **Deliberately separate from the hierarchy.** The archetype above describes a
 * position in the org; this describes a capability over the system, and mixing
 * them is what made "CEO" a special kind of manager rather than a manager who
 * also administers.
 *
 * Concretely: `archetypeForLegacyRole` is consulted for who reports to whom and
 * what a person may see of other people's work; this function is consulted for
 * one thing only — whether `/admin` opens. A CEO's reach over employees comes
 * from the reporting tree exactly as a TL's does, and holding this flag adds
 * nothing to it. Being an administrator is not a way of being everyone's
 * manager.
 *
 * Read off the legacy role because that is where the fact lives —
 * `cowork_employees.role`. No separate admin list, no second source to drift.
 */
export function canAccessAdminSettings(role: unknown): boolean {
  return role === "ceo";
}

/**
 * Where somebody lands after signing in.
 *
 * A constant rather than a function of role, because it does not vary: PRODUCT.md
 * weights the individual and the manager equally, so everyone starts at the
 * workspace. Sending a manager somewhere else would make their own work the
 * secondary view. Named rather than inlined so the decision stays visible if it
 * ever does need to branch.
 */
export const LEGACY_LANDING = "/home";
