/**
 * `cowork_settings/rule_overrides` — provisional values, made durable.
 *
 * ## The fake state this removes
 *
 * `lib/config/settings.ts` holds overrides in a module-level `Map`. It is the
 * right place for them at *read* time — the scoring engine is called from the
 * repository, well below any component, and a rule value that depended on render
 * order would be a scoring bug rather than a UI bug.
 *
 * But nothing ever wrote that map to anything. An administrator published a
 * value, the card showed it, the engine used it, and a page refresh restored the
 * seeded placeholder with nothing saying so. Two people looking at the same rule
 * on the same day could see different numbers depending on who had reloaded.
 * That is the frontend-only state, and it is what this document closes.
 *
 * ## Shape: a flat map, not a document per rule
 *
 * One document holding `{ key: value }` for every published override. Chosen over
 * a collection because the read is *all of them, at session start, before
 * anything scores* — a collection would be N reads on the critical path for a
 * map that is usually empty and never large.
 *
 * **Only overridden keys are stored.** A key absent from the document means "use
 * the seeded default", which is a different fact from "an administrator chose the
 * value that happens to equal the default". Clearing an override therefore
 * *removes* the key rather than writing the default back — otherwise the
 * `isOverridden` badge, which is how a reader tells a decision from a
 * placeholder, would be wrong forever after the first clear.
 */

import { PROVISIONAL_RULES } from "../../config/provisional.ts";

export type RuleValue = number | string;
export type RuleOverrides = Record<string, RuleValue>;

/**
 * The stored document as overrides, discarding anything unrecognised.
 *
 * Unknown keys are dropped rather than kept. `ruleValue` **throws** on an
 * unknown key — deliberately, because a typo silently scoring everybody at zero
 * is the bug that layer exists to prevent — so loading a stale key from
 * Firestore would turn a removed rule into a crash at scoring time, far from the
 * document that caused it.
 */
export function readRuleOverrides(
  doc: Record<string, unknown> | null,
): RuleOverrides {
  const raw = doc?.overrides;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: RuleOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in PROVISIONAL_RULES)) continue;
    const seeded = PROVISIONAL_RULES[key];
    /* The type must match the rule it overrides. A string where the engine
       expects a number reaches `ruleNumber`, which throws — and it would throw
       inside a score calculation rather than here, where the cause is visible. */
    if (typeof seeded.value === "number") {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
      continue;
    }
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

/**
 * Why these overrides cannot be saved, or null.
 *
 * The unit strings in `PROVISIONAL_RULES` carry the allowed values for the
 * enumerated rules — `"exclude | zero"`, `"binary | proportional"`. Parsing them
 * rather than restating the options keeps one source: a rule that grows a third
 * option is edited in one place, and this validation follows.
 */
export function validateRuleOverrides(
  overrides: RuleOverrides,
): string | null {
  for (const [key, value] of Object.entries(overrides)) {
    const seeded = PROVISIONAL_RULES[key];
    if (!seeded) return `"${key}" is not a rule this product knows about.`;

    if (typeof seeded.value === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${seeded.label} must be a number.`;
      }
      if (value < 0) {
        return `${seeded.label} cannot be negative.`;
      }
      continue;
    }

    const allowed = allowedValues(seeded.unit);
    if (allowed && !allowed.includes(String(value))) {
      return `${seeded.label} must be one of: ${allowed.join(", ")}.`;
    }
  }
  return null;
}

/**
 * The choices a rule permits, from its `unit` string, or null when it is free
 * text.
 *
 * The convention is pipe-separated (`"exclude | zero"`). A unit that is prose —
 * `"points per miss"` — is not a choice list, and returning one would refuse
 * every value an administrator could type.
 */
export function allowedValues(unit: string): string[] | null {
  if (!unit.includes("|")) return null;
  const parts = unit
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : null;
}

/** The document to write. */
export function writeRuleOverrides(
  overrides: RuleOverrides,
  updatedBy: string,
): Record<string, unknown> {
  return {
    overrides,
    updatedBy,
    updatedAt: new Date(),
  };
}

/**
 * The effective value of every rule, for the editor.
 *
 * Returns the seeded value AND the override separately rather than one resolved
 * figure. The screen has to show both — "0.5, published, placeholder was 0.2" —
 * because an administrator deciding whether to change a rule needs to know
 * whether the current figure was chosen by anybody.
 */
export function ruleRows(overrides: RuleOverrides): {
  key: string;
  label: string;
  decisionId: string;
  unit: string;
  note: string;
  legacyBehaviour: string;
  seededValue: RuleValue;
  overrideValue: RuleValue | null;
  effectiveValue: RuleValue;
  isOverridden: boolean;
  choices: string[] | null;
}[] {
  return Object.entries(PROVISIONAL_RULES).map(([key, rule]) => {
    const override = Object.prototype.hasOwnProperty.call(overrides, key)
      ? overrides[key]
      : null;
    return {
      key,
      label: rule.label,
      decisionId: rule.decisionId,
      unit: rule.unit,
      note: rule.note,
      legacyBehaviour: rule.legacyBehaviour,
      seededValue: rule.value,
      overrideValue: override,
      effectiveValue: override ?? rule.value,
      isOverridden: override !== null,
      choices: allowedValues(rule.unit),
    };
  });
}
