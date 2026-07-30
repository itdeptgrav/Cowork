/**
 * No settings change without a record of who made it.
 *
 * **The requirement is "no silent changes", and silence was the default.**
 * `setOfficePolicy` wrote the document and nothing else — so a deadline that
 * moved for every live task in the company left no trace of who moved it, from
 * what, or when. The only way to answer "why did my due date change?" was to
 * guess.
 *
 * So the audit entry is built from the OLD and NEW values together, by a
 * function that cannot produce one without both. A caller that has not read the
 * previous value has nothing to pass, which is the point: an entry recording
 * only the new value answers "what is it now", a question the settings document
 * already answers.
 *
 * ## Only what changed
 *
 * The entry lists changed FIELDS, not whole documents. An office policy has
 * seven days, breaks and a holiday list; recording all of it on every save
 * makes "who changed Tuesday's closing time" a diffing exercise for whoever
 * reads the log. `diffFields` answers that at write time, once.
 */

export interface AuditField {
  /** Dotted, so a nested day reads `schedule.tuesday.outTime`. */
  path: string;
  oldValue: unknown;
  newValue: unknown;
}

/** The kinds of change recorded. One per settings area that can be written. */
export const OFFICE_POLICY_CHANGED = "OFFICE_POLICY_CHANGED";

export interface AuditEntry {
  id: string;
  /** Which settings area — `office`, `organisation`, `workflow`. */
  section: string;
  /** The event name, for a reader filtering a long log. */
  type: string;
  /** The employee id. Never a display name: names change, ids do not. */
  changedById: string;
  /** ISO. Supplied by the caller so the record is reproducible in a test. */
  changedAt: string;
  fields: AuditField[];
  /** Optional note from the person making the change. */
  reason: string | null;
  /**
   * Whether this change moves live deadlines.
   *
   * Stored rather than derived at read time: the paths that feed the chain can
   * change, and a log row must keep saying what it meant when it was written.
   */
  affectsDeadlines: boolean;
}

/** Values a settings document can hold, for the recursive walk below. */
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function isObject(v: unknown): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Every leaf that differs, as dotted paths.
 *
 * Arrays are compared WHOLE rather than by index: a holiday removed from the
 * middle of a list would otherwise report every entry after it as changed,
 * which is technically true and useless to read.
 */
export function diffFields(
  before: unknown,
  after: unknown,
  prefix = "",
): AuditField[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) =>
      diffFields(before[k], after[k], prefix ? `${prefix}.${k}` : k),
    );
  }
  /* Structural equality for anything that is not two objects — arrays,
     primitives, and the case where one side became an object. */
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: prefix, oldValue: before ?? null, newValue: after ?? null }];
}

/**
 * The entry for one save, or null when nothing actually changed.
 *
 * Null rather than an empty entry: a log full of "changed nothing" rows is a
 * log nobody reads, and pressing Save without editing is common.
 */
export function auditEntry(input: {
  id: string;
  section: string;
  type?: string;
  changedById: string | null;
  changedAt: string;
  before: unknown;
  after: unknown;
  reason?: string | null;
}): AuditEntry | null {
  const fields = diffFields(input.before, input.after);
  if (fields.length === 0) return null;
  return {
    id: input.id,
    section: input.section,
    type: input.type ?? `${input.section.toUpperCase()}_CHANGED`,
    /* Empty rather than null: the schema promises a string, and an unknown
       actor is a fact worth recording rather than a reason to drop the entry.
       A change that happened is logged even when we cannot name who made it. */
    changedById: input.changedById ?? "",
    changedAt: input.changedAt,
    fields,
    reason: input.reason ?? null,
    affectsDeadlines: affectsDeadlines(fields),
  };
}

/** One line per field, for a log a person reads rather than parses. */
export function describeField(field: AuditField): string {
  const show = (v: unknown) =>
    v === null || v === undefined
      ? "not set"
      : typeof v === "string"
        ? v
        : JSON.stringify(v);
  return `${field.path}: ${show(field.oldValue)} → ${show(field.newValue)}`;
}

/**
 * Does this change need confirming before it is made?
 *
 * Office hours and holidays feed the deadline chain, so saving them moves the
 * expected completion of every live task in the company. That is not something
 * to discover afterwards from a log.
 */
export function affectsDeadlines(fields: AuditField[]): boolean {
  return fields.some((f) =>
    /^(schedule|breaks|holidays|blockedDates)\b/.test(f.path),
  );
}
