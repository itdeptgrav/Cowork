import { PROVISIONAL_RULES } from "./provisional.ts";

/**
 * Runtime rule values — the bridge between the admin editor and the engine.
 *
 * Before this existed the two had nothing to do with each other. The scoring
 * engine computed from `PROVISIONAL_RULES`, a frozen module constant, while
 * `/admin/scoring-rules` rendered `store.rules`, a separate display-only list.
 * Making those cards editable without this file would have produced the worst
 * possible outcome: an administrator changes the missed-deadline deduction from
 * 0.2 to 0.5, the card says 0.5, every score in the product is still computed
 * at 0.2, and nothing anywhere reports the discrepancy.
 *
 * So the engine's read goes through here. `PROVISIONAL_RULES` remains the
 * DEFAULT and the documentation — the legacy behaviour, the owner-decision
 * reference and the provisional note all still live there, and clearing an
 * override restores the seeded value exactly. What this adds is one layer of
 * "unless an administrator has published a different value".
 *
 * The overrides are module state, not React state, because the engine is called
 * from the repository — well below any component — and a rule value that
 * depended on render order would be a scoring bug, not a UI bug.
 */

type RuleValue = number | string;

const overrides = new Map<string, RuleValue>();

/** Set by the repository when a rule version is published. */
export function setRuleOverride(key: string, value: RuleValue): void {
  overrides.set(key, value);
}

export function clearRuleOverride(key: string): void {
  overrides.delete(key);
}

/** Used by the demo reset, so the prototype returns to its seeded state. */
export function clearAllRuleOverrides(): void {
  overrides.clear();
}

/**
 * The published overrides as a plain array, and back.
 *
 * Used only by the mock store's development persistence, which saves these
 * alongside the store: `store.rules` is what the admin cards render and this map
 * is what the engine computes with, so restoring one without the other would
 * recreate exactly the card-says-0.5-engine-says-0.2 divergence this file
 * exists to close.
 *
 * `import` replaces rather than merges — a restored session is the saved session
 * entire, not the saved session laid over whatever the current one had done.
 */
export function exportRuleOverrides(): [string, RuleValue][] {
  return [...overrides.entries()];
}

/**
 * Install the published overrides read from `cowork_settings/rule_overrides`.
 *
 * **Replaces, never merges.** The stored document is the whole set of decisions
 * an administrator has taken; a key absent from it means "no decision, use the
 * seeded placeholder". Merging would make a cleared override un-clearable — the
 * previous value would survive every subsequent load — and `isOverridden`, which
 * is how a reader tells a published decision from a placeholder, would keep
 * saying yes forever.
 *
 * Called from two places, and both are load-bearing: session start, so a
 * refresh does not silently restore the seeded values, and immediately after a
 * successful save, so the engine in this browser stops using the old figure
 * without waiting for a reload.
 */
export function applyRuleOverrides(next: Record<string, RuleValue>): void {
  overrides.clear();
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "number" || typeof value === "string") {
      overrides.set(key, value);
    }
  }
}

export function importRuleOverrides(entries: [string, RuleValue][]): void {
  overrides.clear();
  for (const [key, value] of entries) {
    if (typeof key !== "string") continue;
    if (typeof value !== "number" && typeof value !== "string") continue;
    overrides.set(key, value);
  }
}

/** Whether this value has been changed away from its seeded default. */
export function isOverridden(key: string): boolean {
  return overrides.has(key);
}

export function overriddenKeys(): string[] {
  return [...overrides.keys()];
}

/**
 * The effective value of a rule: the published override, else the seeded
 * default. Unknown keys throw rather than defaulting — a typo in a rule key
 * silently scoring everyone at zero is exactly the class of bug this whole
 * layer exists to prevent.
 */
export function ruleValue(key: string): RuleValue {
  const override = overrides.get(key);
  if (override !== undefined) return override;
  const seeded = PROVISIONAL_RULES[key as keyof typeof PROVISIONAL_RULES];
  if (!seeded) throw new Error(`Unknown scoring rule "${key}"`);
  return seeded.value;
}

/**
 * A value that has a code-level default rather than a `PROVISIONAL_RULES` entry.
 *
 * The rework deduction is owner-confirmed, so it is not provisional — but
 * confirmed is not the same as immutable, and an administrator must be able to
 * change it without a deployment. This resolves an override if one exists and
 * falls back to the constant the engine ships with.
 */
export function confirmedNumber(key: string, fallback: number): number {
  const override = overrides.get(key);
  if (typeof override === "number") return override;
  return fallback;
}

export function ruleNumber(key: string): number {
  const v = ruleValue(key);
  if (typeof v !== "number") {
    throw new Error(`Scoring rule "${key}" is not numeric`);
  }
  return v;
}
